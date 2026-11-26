// Repository management uses the original native fixture, with no provider requests.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

function installRepositoryFixture() {
  if (window.top !== window) return;
  localStorage.setItem('tsugi-onboarding-complete-v1', 'true');
  localStorage.setItem('tsugi-startup-area-v1', JSON.stringify('read'));
  localStorage.setItem('tsugi.landscape.local-only', 'true');
  const fixture = window.__readerRepositoryFixture = { hold: false, failAdd: false, complete: null };
  window.__readerFixture.stores.push({ name: 'Original fixture store', indexUrl: 'https://example.test/reader-repository/index.min.json' });
  const bridge = window.aiostreamsApp;
  const send = bridge.send.bind(bridge), subscribe = bridge.subscribe.bind(bridge);
  const listeners = new Set();
  bridge.subscribe = listener => {
    listeners.add(listener);
    const unsubscribe = subscribe(listener);
    return () => { listeners.delete(listener); unsubscribe(); };
  };
  const reply = (message, data, error = null) => queueMicrotask(() => {
    for (const listener of listeners) listener({ type: 'read-result', request: message.request, data, error });
  });
  bridge.send = message => {
    if (message.type !== 'read-request' || !['add-store', 'remove-store'].includes(message.action.kind)) return send(message);
    const complete = () => {
      fixture.complete = null;
      if (message.action.kind === 'add-store' && fixture.failAdd) {
        window.__readerFixture.requests.push(message.action);
        reply(message, null, 'Fixture repository unavailable');
      } else if (message.action.kind === 'remove-store') {
        window.__readerFixture.requests.push(message.action);
        window.__readerFixture.stores = window.__readerFixture.stores.filter(store => store.indexUrl !== message.action.index);
        reply(message, { ok: true });
      } else send(message);
    };
    if (fixture.hold) { fixture.hold = false; fixture.complete = complete; }
    else complete();
  };
}

async function repositoryGeometry(page, settings, narrow) {
  const geometry = await settings.evaluate(element => {
    const rect = target => {
      const { left, right, top, bottom, width, height } = target.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    const form = element.querySelector('form');
    const rows = [...element.querySelectorAll('li')].map(row => ({
      rect: rect(row), identity: rect(row.firstElementChild), action: rect(row.querySelector('button')),
      background: getComputedStyle(row).backgroundColor, image: getComputedStyle(row).backgroundImage,
      overflow: row.scrollWidth > row.clientWidth + 1,
    }));
    return { form: rect(form), input: rect(form.querySelector('input')), add: rect(form.querySelector('button')), rows,
      list: rect(element.querySelector('ul')), width: innerWidth,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      inputBackground: getComputedStyle(form.querySelector('input')).backgroundColor };
  });
  assert.equal(geometry.overflow, false, 'repository settings fit the window');
  assert.ok(geometry.list.top - geometry.form.bottom >= 20, 'saved repositories are separated from the add form');
  assert.notEqual(geometry.inputBackground, 'rgba(0, 0, 0, 0)', 'the editable input retains its control surface');
  assert.ok(Math.abs(geometry.input.height - geometry.add.height) <= 1, 'input and add action align in height');
  for (const row of geometry.rows) {
    assert.equal(row.background, 'rgba(0, 0, 0, 0)', 'repository identity has no broad data-row background');
    assert.equal(row.image, 'none');
    assert.equal(row.overflow, false, 'repository names and full URLs wrap within the row');
    assert.ok(Math.abs(row.rect.left - geometry.form.left) <= 1, 'form and saved identities share a leading edge');
    assert.ok(row.action.left >= 0 && row.action.right <= geometry.width, 'remove action stays reachable');
    if (narrow) assert.ok(row.action.top >= row.identity.bottom + 10, 'narrow rows put Remove below the complete identity');
    else assert.ok(row.action.left >= row.identity.right + 20, 'desktop identity and Remove have independent space');
  }
  if (narrow) assert.ok(geometry.add.top >= geometry.input.bottom + 10, 'narrow add form stacks without squeezing the URL');
}

export async function verifyReaderRepositoriesBrowser({ browser, origin, installDesktopFixture, screenshotDir }) {
  const page = await browser.newPage({ viewport: { width: 2048, height: 1124 }, locale: 'en-GB', reducedMotion: 'reduce' });
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const read = page.locator('[data-page="read"]');
  const settings = read.locator('[data-ui="reader-repositories"]');
  const input = settings.getByRole('textbox', { name: 'Repository index URL', exact: true });
  const add = settings.getByRole('button', { name: 'Add repository', exact: true });
  const originalUrl = 'https://example.test/reader-repository/index.min.json';
  const longUrl = 'https://example.test/' + 'original-repository-'.repeat(12) + '/index.min.json';
  const capture = async name => {
    if (!screenshotDir) return;
    await mkdir(screenshotDir, { recursive: true });
    await page.screenshot({ path: join(screenshotDir, name + '.png'), animations: 'disabled' });
  };
  try {
    await page.addInitScript({ content: `(${installDesktopFixture.toString()})();(${installRepositoryFixture.toString()})();` });
    await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await read.locator('.tsugi-reading-rail').getByRole('button', { name: 'Settings', exact: true }).click();
    await read.getByRole('button', { name: /Browse Manage manga sources and extensions/ }).click();
    await read.getByRole('button', { name: /Sources Manage extension sources and repositories/ }).click();
    await read.getByRole('button', { name: /Extension repositories Add or remove trusted extension stores/ }).click();
    await settings.getByText(originalUrl, { exact: true }).waitFor();
    await settings.getByText('Only install extensions from publishers you trust. Extensions run with your Windows account permissions; their signatures are not independently verified.', { exact: true }).waitFor();
    assert.equal(await add.isDisabled(), true);
    await repositoryGeometry(page, settings, false);
    await capture('reader-repositories-2048');
    await page.setViewportSize({ width: 1440, height: 900 });
    await repositoryGeometry(page, settings, false);
    await capture('reader-repositories-1440');

    await input.fill(longUrl);
    await page.evaluate(() => { window.__readerRepositoryFixture.hold = true; });
    await add.click();
    await page.waitForFunction(() => window.__readerRepositoryFixture.complete !== null);
    assert.equal(await add.isDisabled(), true, 'pending add prevents a duplicate submission');
    assert.equal(await settings.getByRole('button', { name: 'Remove', exact: true }).isDisabled(), true, 'pending add prevents competing removal');
    await page.evaluate(() => window.__readerRepositoryFixture.complete());
    await settings.getByText(longUrl, { exact: true }).waitFor();
    assert.equal(await input.inputValue(), '');
    assert.equal(await settings.getByRole('listitem').count(), 2);
    await page.setViewportSize({ width: 390, height: 844 });
    await settings.scrollIntoViewIfNeeded();
    await repositoryGeometry(page, settings, true);
    await capture('reader-repositories-390');
    await input.click();
    await page.keyboard.press('Tab');
    const firstRemove = settings.getByRole('listitem').filter({ hasText: originalUrl }).getByRole('button', { name: 'Remove', exact: true });
    const focus = await firstRemove.evaluate(button => ({ active: button === document.activeElement, outline: getComputedStyle(button).outlineWidth, activeLabel: document.activeElement?.textContent, activeClass: document.activeElement?.className }));
    assert.ok(focus.active && parseFloat(focus.outline) >= 2, `keyboard focus reaches the first enabled removal with a visible ring: ${JSON.stringify(focus)}`);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await input.evaluate(field => document.activeElement === field), true, 'Shift+Tab keeps native reverse navigation');
    assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-pointer-focus')), false);
    await input.click();
    assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-pointer-focus')), true, 'an actual pointer interaction restores pointer modality');

    await input.fill('https://example.test/unavailable/index.min.json');
    await page.evaluate(() => { window.__readerRepositoryFixture.failAdd = true; });
    await add.click();
    await read.getByRole('alert').getByText('Fixture repository unavailable', { exact: true }).waitFor();
    assert.equal(await settings.getByRole('listitem').count(), 2, 'failed addition preserves saved repositories');
    assert.equal(await input.inputValue(), 'https://example.test/unavailable/index.min.json', 'failed addition retains the address for correction');
    assert.equal(await add.isEnabled(), true);
    await firstRemove.click();
    await settings.getByText(originalUrl, { exact: true }).waitFor({ state: 'detached' });
    assert.equal(await settings.getByText(longUrl, { exact: true }).isVisible(), true, 'removal addresses the selected repository only');
    await settings.getByRole('button', { name: 'Remove', exact: true }).click();
    await settings.getByText('No repositories added yet.', { exact: true }).waitFor();
    assert.equal(await settings.getByRole('listitem').count(), 0);
    const changes = await page.evaluate(() => window.__readerFixture.requests.filter(action => ['add-store', 'remove-store'].includes(action.kind)));
    assert.deepEqual(changes.map(action => action.kind), ['add-store', 'add-store', 'remove-store', 'remove-store']);
    assert.deepEqual(changes.filter(action => action.kind === 'remove-store').map(action => action.index), [originalUrl, longUrl]);
    await settings.getByRole('button', { name: 'Return to Browse', exact: true }).click();
    await read.locator('[data-ui="source-browser"]').waitFor();
    assert.deepEqual(errors, []);
    console.log('PASS: unboxed Reader repository identities, wide/narrow geometry, full URL wrapping, keyboard focus, busy/error/empty states and exact add/remove callbacks.');
  } catch (error) {
    await capture('reader-repositories-failure');
    throw error;
  } finally { await page.close(); }
}
