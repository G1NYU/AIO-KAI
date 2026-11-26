// Real Reader UI with original synthetic native update results. This checks
// sequencing and presentation; native execution/recovery has a separate gate.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

function installExtensionUpdateFixture() {
  if (window.top !== window) return;
  localStorage.setItem('tsugi-onboarding-complete-v1', 'true');
  localStorage.setItem('tsugi-startup-area-v1', JSON.stringify('read'));
  const bridge = window.aiostreamsApp;
  const base = window.__readerFixture;
  const repository = 'https://extensions.example.invalid/index.pb';
  base.installed = true;
  base.stores = [{ name: 'Original update fixtures', indexUrl: repository }];
  const state = window.__extensionUpdateFixture = {
    rows: ['Alpha', 'Beta', 'Gamma', 'Obsolete'].map((name, i) => ({
      name: `${name} original extension`, pkgName: `org.tsugi.updatefixture${i + 1}`,
      lang: 'en', versionName: '1.6.1', versionCodeLong: 1,
      storeIndexUrl: repository, isInstalled: true, hasUpdate: true, isObsolete: i === 3,
    })),
    requests: [], outcomes: {}, active: 0, maxActive: 0, hold: '', release: null,
  };
  const listeners = new Set();
  const subscribe = bridge.subscribe.bind(bridge);
  const send = bridge.send.bind(bridge);
  bridge.subscribe = listener => {
    listeners.add(listener);
    const unsubscribe = subscribe(listener);
    return () => { listeners.delete(listener); unsubscribe(); };
  };
  const emit = (request, data, error = null) => queueMicrotask(() => {
    for (const listener of listeners) listener({ type: 'read-result', request, data, error });
  });
  bridge.send = message => {
    if (message.type !== 'read-request') return send(message);
    const action = message.action;
    if (action.kind === 'extensions') {
      base.requests.push(action);
      const rows = state.rows.filter(row =>
        (action.installed === undefined || action.installed === row.isInstalled) &&
        (!action.updatesOnly || row.hasUpdate) && (!action.store || action.store === row.storeIndexUrl) &&
        (!action.language || action.language === row.lang) &&
        (!action.query || row.name.toLowerCase().includes(action.query.toLowerCase())));
      return emit(message.request, { nodes: rows.slice(action.offset, action.offset + 100), totalCount: rows.length });
    }
    if (action.kind !== 'update-extension') return send(message);
    base.requests.push(action);
    state.requests.push(action.package);
    state.active++;
    state.maxActive = Math.max(state.maxActive, state.active);
    const finish = () => {
      state.release = null;
      state.active--;
      const row = state.rows.find(item => item.pkgName === action.package);
      if (!row || row.isObsolete || !row.isInstalled || !row.hasUpdate) throw Error('Invalid synthetic extension update');
      const outcome = state.outcomes[action.package] || 'updated';
      if (outcome === 'error') return emit(message.request, null, 'Synthetic native update was cancelled.');
      if (outcome === 'updated') { row.versionName = '1.6.2'; row.versionCodeLong = 2; row.hasUpdate = false; }
      emit(message.request, {
        package: action.package, status: outcome, versionName: row.versionName,
        checkpointId: state.requests.length.toString(16).padStart(32, '0'),
        ...(outcome === 'rolled-back' ? { error: 'Synthetic incompatible update; previous state restored.' } : {}),
      });
    };
    if (state.hold === action.package) state.release = finish;
    else queueMicrotask(finish);
  };
}

export async function verifyExtensionUpdatesBrowser({ browser, origin, installDesktopFixture, screenshotDir }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-GB', reducedMotion: 'reduce' });
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const pkg = n => `org.tsugi.updatefixture${n}`;
  const names = ['Alpha', 'Beta', 'Gamma', 'Obsolete'].map(name => `${name} original extension`);
  const row = name => page.locator('.tsugi-read-row').filter({
    has: page.getByRole('button', { name: 'Uninstall', exact: true }),
  }).filter({ hasText: name });
  const results = page.getByRole('region', { name: 'Extension update results', exact: true });
  const requests = () => page.evaluate(() => window.__extensionUpdateFixture.requests);
  const chooseAll = async () => {
    await page.getByRole('button', { name: 'Select updates on this page', exact: true }).click();
    await page.getByRole('button', { name: 'Update selected (3)', exact: true }).click();
  };
  const ready = async () => {
    await page.locator('.tsugi-reading-rail').getByRole('button', { name: 'Extensions', exact: true }).click();
    await row(names[0]).getByRole('button', { name: 'Update', exact: true }).waitFor();
  };
  const fresh = async () => { await page.reload({ waitUntil: 'domcontentloaded' }); await ready(); };
  const idle = () => page.waitForFunction(() =>
    !window.__extensionUpdateFixture.active &&
    [...document.querySelectorAll('button')].some(button => button.textContent === 'Check extension updates' && !button.disabled));
  try {
    // Use one init script so the wrapper always follows the base bridge.
    await page.addInitScript({ content: `(${installDesktopFixture.toString()})();(${installExtensionUpdateFixture.toString()})();` });
    await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await ready();
    assert.equal(await row(names[3]).getByRole('checkbox').count(), 0, 'obsolete extensions cannot be selected');
    assert.equal(await row(names[3]).getByRole('button', { name: 'Update', exact: true }).count(), 0, 'obsolete extensions cannot be updated');
    await row(names[0]).getByRole('button', { name: 'Update', exact: true }).click();
    await results.getByText('Updated to 1.6.2.', { exact: true }).waitFor();
    await idle();
    assert.deepEqual(await requests(), [pkg(1)], 'single update targets exactly one installed package');
    assert.equal(await row(names[0]).getByRole('button', { name: 'Update', exact: true }).count(), 0);

    await fresh();
    await page.evaluate(packageName => { window.__extensionUpdateFixture.hold = packageName; }, pkg(1));
    await chooseAll();
    await page.waitForFunction(() => typeof window.__extensionUpdateFixture.release === 'function');
    assert.deepEqual(await requests(), [pkg(1)], 'batch waits for the first native result');
    assert.equal(await page.getByRole('checkbox', { name: `Select update for ${names[1]}` }).isDisabled(), true);
    await page.evaluate(() => window.__extensionUpdateFixture.release());
    await idle();
    assert.deepEqual(await requests(), [pkg(1), pkg(2), pkg(3)], 'selected updates run in display order and exclude obsolete packages');
    assert.equal(await page.evaluate(() => window.__extensionUpdateFixture.maxActive), 1, 'native updates never overlap');
    assert.equal(await results.getByText('Updated to 1.6.2.', { exact: true }).count(), 3);

    await fresh();
    await page.evaluate(packageName => { window.__extensionUpdateFixture.outcomes[packageName] = 'rolled-back'; }, pkg(2));
    await chooseAll();
    await results.getByText(/Synthetic incompatible update; previous state restored/).waitFor();
    await idle();
    assert.deepEqual(await requests(), [pkg(1), pkg(2)], 'rollback stops the remaining batch');
    await row(names[1]).getByRole('alert').filter({ hasText: 'previous state restored' }).waitFor();
    assert.equal(await row(names[2]).getByRole('button', { name: 'Update', exact: true }).count(), 1, 'unattempted update remains available');
    if (screenshotDir) {
      await mkdir(screenshotDir, { recursive: true });
      await page.screenshot({ path: join(screenshotDir, 'extension-update-rollback.png'), animations: 'disabled' });
    }
    await page.evaluate(packageName => { window.__extensionUpdateFixture.outcomes[packageName] = 'updated'; }, pkg(2));
    await row(names[1]).getByRole('button', { name: 'Update', exact: true }).click();
    await results.getByText('Updated to 1.6.2.', { exact: true }).waitFor();
    await idle();
    assert.deepEqual(await requests(), [pkg(1), pkg(2), pkg(2)], 'retry explicitly reattempts only the failed item');
    assert.equal(await row(names[1]).getByRole('alert').count(), 0, 'successful retry clears the prior row error');

    await fresh();
    await page.evaluate(packageName => { window.__extensionUpdateFixture.outcomes[packageName] = 'error'; }, pkg(1));
    await chooseAll();
    await row(names[0]).getByRole('alert').filter({ hasText: 'cancelled' }).waitFor();
    await idle();
    assert.deepEqual(await requests(), [pkg(1)], 'native rejection/cancellation stops before another item');
    assert.equal(await row(names[0]).getByRole('button', { name: 'Update', exact: true }).count(), 1, 'cancelled update remains available');

    await fresh();
    await page.evaluate(packageName => { window.__extensionUpdateFixture.hold = packageName; }, pkg(1));
    await chooseAll();
    await page.waitForFunction(() => typeof window.__extensionUpdateFixture.release === 'function');
    await page.getByRole('button', { name: 'Stop after current update', exact: true }).click();
    await page.getByRole('button', { name: 'Stopping after this update…', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__extensionUpdateFixture.active), 1, 'stop preserves the in-flight native operation');
    await page.evaluate(() => window.__extensionUpdateFixture.release());
    await idle();
    assert.deepEqual(await requests(), [pkg(1)], 'stop never starts the next selected update');
    assert.equal(await row(names[1]).getByRole('button', { name: 'Update', exact: true }).count(), 1);
    assert.equal(await row(names[2]).getByRole('button', { name: 'Update', exact: true }).count(), 1);
    assert.deepEqual(errors, [], 'extension update UI has no uncaught errors');
    console.log('PASS: extension single/selected updates, sequential execution, obsolete exclusion, rollback/error stops, retry and stop-after-current.');
  } finally {
    await page.close();
  }
}
