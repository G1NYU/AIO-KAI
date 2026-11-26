// Real image decoding and the real Reader UI, with original package metadata
// and a single-slot synthetic native image capability. No provider traffic.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

function installSourceIconsFixture() {
  if (window.top !== window) return;
  localStorage.setItem('tsugi-onboarding-complete-v1', 'true');
  localStorage.setItem('tsugi-startup-area-v1', JSON.stringify('read'));
  const host = window.aiostreamsApp, base = window.__readerFixture;
  const repository = 'https://icons.example.invalid/index.pb';
  base.installed = true;
  base.stores = [{ name: 'Original icon repository', indexUrl: repository }];
  const state = window.__sourceIconsFixture = { calls: [], revision: 1, capabilities: {}, revoked: [], created: [] };
  const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = blob => { const url = create(blob); state.created.push(url); return url; };
  URL.revokeObjectURL = url => { state.revoked.push(url); revoke(url); };
  const extension = (suffix, name) => ({ pkgName: `org.tsugi.icons.${suffix}`, name, lang: 'en', contentWarning: 'SAFE',
    versionName: `1.6.${state.revision}`, versionCodeLong: String(state.revision), isInstalled: true,
    hasUpdate: false, isObsolete: false, storeIndexUrl: repository });
  const extensions = () => [extension('shared', 'Original shared bundle'), extension('missing', 'Original missing bundle'), extension('malformed', 'Original malformed bundle')];
  const sources = () => {
    const row = (id, name, owner) => ({ id, name, displayName: name, lang: 'en', contentWarning: 'SAFE',
      supportsLatest: true, isConfigurable: false, extension: owner });
    const [shared, missing, malformed] = extensions();
    return [row('12345', 'Original shared source A', shared), row('9007199254740993', 'Original shared source B', shared),
      row('12347', 'Original missing source', missing), row('12348', 'Original malformed source', malformed),
      ...Array.from({ length: 24 }, (_, index) => row(String(20_000 + index), `Original spacing source ${index}`, extension('padding', 'Original spacing bundle'))),
      row('50000', 'Original distant source', extension('distant', 'Original distant bundle'))];
  };
  const send = host.send.bind(host), subscribe = host.subscribe.bind(host), listeners = new Set();
  host.subscribe = listener => { listeners.add(listener); const remove = subscribe(listener); return () => { listeners.delete(listener); remove(); }; };
  const emit = (request, data, error = null) => queueMicrotask(() => {
    for (const listener of listeners) listener({ type: 'read-result', request, data, error });
  });
  host.send = message => {
    if (message.type !== 'read-request') return send(message);
    const action = message.action;
    state.calls.push(action);
    if (action.kind === 'source-inventory') {
      base.requests.push(action); const rows = sources();
      return emit(message.request, { nodes: rows, totalCount: rows.length, complete: true });
    }
    if (action.kind === 'extensions') {
      base.requests.push(action);
      const rows = extensions().filter(row => !action.query || row.name.toLowerCase().includes(action.query.toLowerCase()));
      return emit(message.request, { nodes: rows, totalCount: rows.length });
    }
    if (action.kind === 'extension-icon') {
      base.requests.push(action);
      if (action.package === 'org.tsugi.icons.missing') return emit(message.request, null, 'This extension icon is unavailable.');
      const path = base.lastPath = '/__tsugi_read/page/' + ++base.serial;
      state.capabilities[path] = action;
      return emit(message.request, { path });
    }
    return send(message);
  };
}

export async function verifySourceIconsBrowser({ browser, origin, installDesktopFixture, screenshotDir }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-GB', reducedMotion: 'reduce' });
  page.setDefaultTimeout(20_000);
  const errors = [], expired = [], transfers = [];
  page.on('pageerror', error => errors.push(error.message));
  const read = page.locator('[data-page="read"]'), rail = read.locator('.tsugi-reading-rail');
  const sources = page.locator('[data-ui="source-browser"]'), extensions = page.locator('[data-ui="extension-browser"]');
  const row = id => sources.locator(`[data-source-id="${id}"]`);
  const icon = id => row(id).locator('[data-extension-icon]');
  const iconCalls = suffix => page.evaluate(suffix => window.__sourceIconsFixture.calls.filter(action => action.kind === 'extension-icon' && action.package === `org.tsugi.icons.${suffix}`).length, suffix);
  const ready = async locator => {
    await locator.locator('img').waitFor();
    await page.waitForFunction(selector => [...document.querySelectorAll(selector)].every(node => {
      const img = node.querySelector('img'); return img?.complete && img.naturalWidth === 16 && img.naturalHeight === 24;
    }), await locator.evaluate(node => `[data-source-id="${node.closest('[data-source-id]')?.dataset.sourceId}"] [data-extension-icon]`));
  };
  try {
    await page.addInitScript({ content: `(${installDesktopFixture.toString()})();(${installSourceIconsFixture.toString()})();` });
    await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.fallback() : route.abort());
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAYCAIAAAB8wupbAAAAHUlEQVR4nGOsqF3FQApgIkn1qIZRDaMaRjWQrAEA4jkBz8UryC4AAAAASUVORK5CYII=', 'base64');
    await page.route('**/__tsugi_read/page/*', async route => {
      const path = new URL(route.request().url()).pathname;
      const current = await page.evaluate(path => ({ path: window.__readerFixture.lastPath, action: window.__sourceIconsFixture.capabilities[path] }), path);
      if (current.path !== path) { expired.push(path); await route.fulfill({ status: 404, body: 'expired image capability' }); return; }
      // Keep transfers asynchronous: another native image request must not
      // replace the capability until this image has become a local Blob.
      await new Promise(resolve => setTimeout(resolve, 15));
      const latest = await page.evaluate(() => window.__readerFixture.lastPath);
      if (latest !== path) expired.push(path);
      transfers.push(current.action?.kind || 'page-or-cover');
      await route.fulfill({ contentType: 'image/png', body: current.action?.package === 'org.tsugi.icons.malformed' ? Buffer.from('not a raster') : png });
    });
    await page.goto(origin + '/?actualImages', { waitUntil: 'domcontentloaded' });
    await rail.getByRole('button', { name: 'Browse', exact: true }).click();
    await ready(icon('12345')); await ready(icon('9007199254740993'));
    assert.equal(await iconCalls('shared'), 1, 'two source rows share one compressed icon transfer');
    assert.equal(await iconCalls('distant'), 0, 'offscreen source icons are not requested');
    assert.equal(await row('12345').getAttribute('role'), null);
    assert.equal(await row('12345').getByRole('img').count(), 0, 'decorative images do not alter the source button name');
    assert.equal(await row('12345').getByRole('button').count(), 0, 'icons do not add nested controls');

    await row('12347').scrollIntoViewIfNeeded();
    await icon('12347').locator('svg').waitFor();
    await page.waitForFunction(() => document.querySelector('[data-source-id="12347"] [data-extension-icon]')?.dataset.iconState === 'fallback');
    await row('12348').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('[data-source-id="12348"] [data-extension-icon]')?.dataset.iconState === 'fallback');
    assert.equal(await icon('12348').locator('img').count(), 0, 'a browser decode failure keeps the ordinary icon fallback');
    assert.equal(await read.getByRole('alert').count(), 0, 'optional image errors do not become page failures');

    await row('50000').scrollIntoViewIfNeeded(); await ready(icon('50000'));
    assert.equal(await iconCalls('distant'), 1);
    const distantUrl = await icon('50000').locator('img').getAttribute('src');
    await row('12345').scrollIntoViewIfNeeded(); await ready(icon('12345'));
    await page.waitForFunction(url => window.__sourceIconsFixture.revoked.includes(url), distantUrl);
    await row('50000').scrollIntoViewIfNeeded(); await ready(icon('50000'));
    assert.equal(await iconCalls('distant'), 1, 'scrolling back reuses compressed bytes with a fresh object URL');

    await rail.getByRole('button', { name: 'Extensions', exact: true }).click();
    const extensionIcon = extensions.locator('[data-extension-package="org.tsugi.icons.shared"] [data-extension-icon]');
    await extensionIcon.locator('img').waitFor();
    assert.equal(await iconCalls('shared'), 1, 'Sources and Extensions share the same package revision cache');
    assert.equal(await extensionIcon.getAttribute('aria-hidden'), 'true');
    await page.evaluate(() => { window.__sourceIconsFixture.revision = 2; });
    await rail.getByRole('button', { name: 'Browse', exact: true }).click();
    await ready(icon('12345')); await ready(icon('9007199254740993'));
    assert.equal(await iconCalls('shared'), 2, 'a changed package revision reloads once for both sources');
    const allIconCalls = await page.evaluate(() => window.__sourceIconsFixture.calls.filter(action => action.kind === 'extension-icon'));
    assert.ok(allIconCalls.every(action => Object.keys(action).sort().join(',') === 'kind,package'), 'cache revisions and URLs never enter the native action');
    if (screenshotDir) { await mkdir(screenshotDir, { recursive: true }); await page.screenshot({ path: join(screenshotDir, 'source-icons-wide.png'), animations: 'disabled' }); }

    await page.setViewportSize({ width: 600, height: 860 });
    await row('12345').scrollIntoViewIfNeeded(); await ready(icon('12345'));
    assert.ok(await read.evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'source icons preserve the narrow layout');
    const box = await icon('12345').boundingBox(); assert.ok(box.width <= 32 && box.height <= 32);
    if (screenshotDir) await page.screenshot({ path: join(screenshotDir, 'source-icons-narrow.png'), animations: 'disabled' });

    // Keyboard activation still opens the source, then pages use the same
    // serialized single-slot transfer path after icon navigation/unmount.
    const sourceButton = sources.getByRole('button', { name: /Original shared source A/ });
    await sourceButton.focus(); await page.keyboard.press('Enter');
    await page.locator('.tsugi-manga-card').first().click();
    await read.getByRole('button', { name: 'Start or resume reading', exact: true }).click();
    await page.getByRole('img', { name: 'Reading page 1', exact: true }).waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.tsugi-chapter-page img')].some(img => img.complete && img.naturalWidth === 16));
    assert.deepEqual(expired, [], 'icons/covers/reading pages preserve the single-slot image capability');
    assert.ok(transfers.includes('extension-icon') && transfers.includes('page-or-cover'));
    assert.deepEqual(errors, []);
    console.log('PASS: original cached icons decoded in Sources/Extensions; lazy loading, shared revision cache, fallback, object URL release, narrow keyboard layout and Reader image transfer passed.');
  } finally { await page.close(); }
}
