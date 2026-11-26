// Original source/extension metadata against the real Reader UI. No provider
// catalogues or executable extension mutations are needed to change filters.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

function installSourceMetadataFixture() {
  if (window.top !== window) return;
  localStorage.setItem('tsugi-onboarding-complete-v1', 'true');
  localStorage.setItem('tsugi-startup-area-v1', JSON.stringify('read'));
  const host = window.aiostreamsApp;
  const base = window.__readerFixture;
  const repository = 'https://metadata.example.invalid/index.pb';
  base.installed = true;
  base.stores = [{ name: 'Original metadata repository', indexUrl: repository }];
  const extension = (id, name, lang, warning, patch = {}) => ({
    pkgName: `org.tsugi.metadata.${id}`, name, lang, versionName: '1.6.4', versionCodeLong: '4',
    storeIndexUrl: repository, isInstalled: true, hasUpdate: false, isObsolete: false,
    ...(warning ? { contentWarning: warning } : {}), ...patch,
  });
  const extensions = [
    extension('alpha', 'Alpha bundle', 'en', 'SAFE', { hasUpdate: true }),
    extension('beta', 'Beta bundle', 'ja', 'MIXED', { hasUpdate: true }),
    extension('gamma', 'Gamma bundle', 'en', 'NSFW'),
    extension('unknown', 'Unrated bundle', 'en', undefined),
    extension('multi', 'Multilingual bundle', 'all', 'MIXED'),
    extension('obsolete', 'Obsolete bundle', 'en', 'SAFE', { isObsolete: true, hasUpdate: true }),
    ...Array.from({ length: 100 }, (_, i) => extension(`page${i}`, `Pagination bundle ${String(i).padStart(3, '0')}`, 'en', 'SAFE', { isInstalled: false })),
  ];
  const source = (id, name, owner, configurable) => ({
    id, name, displayName: name, lang: owner.lang, supportsLatest: true, isConfigurable: configurable,
    ...(owner.contentWarning ? { contentWarning: owner.contentWarning } : {}),
    extension: Object.fromEntries(['name', 'pkgName', 'versionName', 'versionCodeLong', 'storeIndexUrl', 'isInstalled', 'hasUpdate', 'isObsolete']
      .map(key => [key, owner[key]])),
  });
  const sources = [
    { id: '0', name: 'Local fixture', lang: '', supportsLatest: false, contentWarning: 'SAFE', isConfigurable: false },
    source('12345', 'Alpha source', extensions[0], true),
    source('9007199254740993', 'Beta source', extensions[1], false),
    source('-9', 'Gamma source', extensions[2], true),
    source('42', 'Unrated source', extensions[3], false),
    source('43', 'Multilingual source', extensions[4], false),
  ];
  const state = window.__sourceMetadataFixture = { calls: [], failSources: false, failExtensions: false, failRefreshAfterMutation: false, acceptedMutations: [] };
  const send = host.send.bind(host), subscribe = host.subscribe.bind(host), listeners = new Set();
  host.subscribe = listener => {
    listeners.add(listener);
    const remove = subscribe(listener);
    return () => { listeners.delete(listener); remove(); };
  };
  const emit = (request, data, error = null) => queueMicrotask(() => {
    for (const listener of listeners) listener({ type: 'read-result', request, data, error });
  });
  host.send = message => {
    if (message.type !== 'read-request') return send(message);
    const action = message.action;
    state.calls.push(action);
    if (action.kind === 'source-inventory') {
      base.requests.push(action);
      if (state.failSources) return emit(message.request, null, 'The original source inventory could not be verified.');
      return emit(message.request, { nodes: sources, totalCount: sources.length + 2, complete: true });
    }
    if (action.kind === 'extensions') {
      base.requests.push(action);
      if (state.failExtensions) return emit(message.request, null, 'The original extension catalogue could not be verified.');
      const rows = extensions.filter(row =>
        (action.installed === undefined || action.installed === row.isInstalled) &&
        (!action.updatesOnly || row.hasUpdate) && (!action.obsoleteOnly || (row.isInstalled && row.isObsolete)) &&
        (!action.language || row.lang === action.language) &&
        (!action.contentWarning || row.contentWarning === action.contentWarning) &&
        (!action.store || row.storeIndexUrl === action.store) &&
        (!action.query || row.name.toLowerCase().includes(action.query.toLowerCase())));
      return emit(message.request, { nodes: rows.slice(action.offset, action.offset + 100), totalCount: rows.length });
    }
    if (action.kind === 'catalogue') {
      base.requests.push(action);
      return emit(message.request, { mangas: [], hasNextPage: false });
    }
    if (action.kind === 'install-extension' || action.kind === 'uninstall-extension') {
      base.requests.push(action);
      const row = extensions.find(row => row.pkgName === action.package);
      if (!row) return emit(message.request, null, 'The original extension fixture is missing.');
      row.isInstalled = action.kind === 'install-extension';
      state.acceptedMutations.push(action);
      if (state.failRefreshAfterMutation) state.failExtensions = true;
      return emit(message.request, { ok: true });
    }
    return send(message);
  };
}

export async function verifySourceMetadataBrowser({ browser, origin, installDesktopFixture, screenshotDir }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-GB', reducedMotion: 'reduce' });
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const read = page.locator('[data-page="read"]');
  const rail = read.locator('.tsugi-reading-rail');
  const sources = page.locator('[data-ui="source-browser"]');
  const extensions = page.locator('[data-ui="extension-browser"]');
  const sourceRow = id => sources.locator(`[data-source-id="${id}"]`);
  const extensionRow = id => extensions.locator(`[data-extension-package="org.tsugi.metadata.${id}"]`);
  const sourceLanguage = () => sources.getByRole('combobox', { name: 'Source language', exact: true });
  const sourceContent = () => sources.getByRole('combobox', { name: 'Source content', exact: true });
  const extensionLanguage = () => extensions.getByRole('combobox', { name: 'Extension language', exact: true });
  const extensionContent = () => extensions.getByRole('combobox', { name: 'Extension content', exact: true });
  const extensionStatus = () => extensions.getByRole('combobox', { name: 'Extension status', exact: true });
  const calls = kind => page.evaluate(kind => window.__sourceMetadataFixture.calls.filter(action => action.kind === kind), kind);
  const frames = () => page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
  const sourceIds = async () => { await frames(); return sources.locator('[data-source-id]').evaluateAll(rows => rows.map(row => row.dataset.sourceId)); };
  const extensionIdle = async () => {
    await page.waitForFunction(() => {
      const buttons = document.querySelector('[data-ui="extension-browser"]')?.querySelectorAll('button') ?? [];
      const search = [...buttons].find(button => button.textContent.trim() === 'Search');
      return search && !search.disabled;
    });
    await frames();
  };
  const extensionIds = async () => { await extensionIdle(); return extensions.locator('[data-extension-package]').evaluateAll(rows => rows.map(row => row.dataset.extensionPackage)); };
  const changeExtension = async (control, value) => { await control().selectOption(value); await extensionIdle(); };
  const lastExtensionRequest = async () => (await calls('extensions')).at(-1);
  const openSources = async () => { await rail.getByRole('button', { name: 'Browse', exact: true }).click(); await sources.waitFor(); await frames(); };
  try {
    await page.addInitScript({ content: `(${installDesktopFixture.toString()})();(${installSourceMetadataFixture.toString()})();` });
    await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAYCAIAAAB8wupbAAAAHUlEQVR4nGOsqF3FQApgIkn1qIZRDaMaRjWQrAEA4jkBz8UryC4AAAAASUVORK5CYII=', 'base64');
    await page.route('**/__tsugi_read/page/*', route => route.fulfill({ contentType: 'image/png', body: png }));
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await openSources();
    await sourceRow('12345').waitFor();
    assert.deepEqual(await sourceIds(), ['12345', '9007199254740993', '-9', '42', '43']);
    assert.equal(await sourceContent().inputValue(), '');
    assert.equal(await sourceLanguage().inputValue(), '');
    await sourceRow('12345').getByText('Not flagged', { exact: true }).waitFor();
    await sourceRow('9007199254740993').getByText('Mixed content', { exact: true }).waitFor();
    await sourceRow('-9').getByText('18+ content', { exact: true }).waitFor();
    await sourceRow('42').getByText('Unknown', { exact: true }).waitFor();
    assert.equal(await sourceContent().getByRole('option', { name: /^(safe|sfw)$/i }).count(), 0);
    assert.match(await sourceRow('12345').innerText(), /Alpha bundle/);
    assert.match(await sourceRow('12345').innerText(), /1\.6\.4/);
    const inventoryCalls = (await calls('source-inventory')).length;

    await sourceContent().focus(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown');
    assert.equal(await sourceContent().inputValue(), 'SAFE', 'keyboard selection chooses the declared Not flagged filter');
    assert.deepEqual(await sourceIds(), ['12345'], 'missing metadata is not admitted by Not flagged');
    await sourceContent().selectOption('NSFW');
    assert.deepEqual(await sourceIds(), ['-9']);
    await sourceContent().selectOption('MIXED');
    assert.deepEqual(await sourceIds(), ['9007199254740993', '43']);
    await sourceLanguage().selectOption('all');
    assert.deepEqual(await sourceIds(), ['43'], 'Multilingual is an exact language value');
    await sourceLanguage().selectOption('en');
    assert.deepEqual(await sourceIds(), [], 'language and content filters intersect');
    await sourceContent().selectOption('');
    assert.deepEqual(await sourceIds(), ['12345', '-9', '42'], 'All content includes unclassified sources');
    const sourceSearch = sources.getByRole('textbox', { name: 'Filter installed sources', exact: true });
    await sourceSearch.fill('unrated'); assert.deepEqual(await sourceIds(), ['42']);
    await sourceSearch.fill(''); await sourceLanguage().selectOption('ja');
    assert.deepEqual(await sourceIds(), ['9007199254740993']);
    assert.equal((await calls('source-inventory')).length, inventoryCalls, 'local source filters do not repeat the complete native inventory');
    assert.deepEqual(await calls('catalogue'), [], 'source filters never request provider catalogues');
    await sourceRow('9007199254740993').focus(); await page.keyboard.press('Enter');
    await read.getByRole('heading', { name: 'Beta source', exact: true }).waitFor();
    assert.deepEqual((await calls('catalogue')).map(({ kind, source, mode, page }) => ({ kind, source, mode, page })),
      [{ kind: 'catalogue', source: '9007199254740993', mode: 'popular', page: 1 }], 'keyboard activation retains the exact signed64 source ID');
    await read.locator('button.tsugi-read-action').filter({ hasText: /^Sources$/ }).click();
    await sources.waitFor();
    await sourceLanguage().selectOption('');
    if (screenshotDir) {
      await mkdir(screenshotDir, { recursive: true });
      await page.screenshot({ path: join(screenshotDir, 'source-metadata-wide.png'), animations: 'disabled' });
    }
    await page.setViewportSize({ width: 440, height: 1000 }); await frames();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'source metadata fits a narrow window');
    if (screenshotDir) await page.screenshot({ path: join(screenshotDir, 'source-metadata-narrow.png'), animations: 'disabled' });
    await page.setViewportSize({ width: 1440, height: 1000 });

    await rail.getByRole('button', { name: 'Extensions', exact: true }).click(); await extensions.waitFor(); await extensionIdle();
    assert.equal((await extensionIds()).length, 100);
    await extensionRow('alpha').getByText('Not flagged', { exact: true }).waitFor();
    await extensionRow('beta').getByText('Mixed content', { exact: true }).waitFor();
    await extensionRow('gamma').getByText('18+ content', { exact: true }).waitFor();
    await extensionRow('unknown').getByText('Unknown', { exact: true }).waitFor();
    assert.equal(await extensionContent().getByRole('option', { name: /^(safe|sfw)$/i }).count(), 0);
    assert.match(await extensionRow('alpha').innerText(), /Original metadata repository/);
    assert.match(await extensionRow('alpha').innerText(), /1\.6\.4/);
    await extensions.getByRole('button', { name: 'Next', exact: true }).click(); await extensionIdle();
    assert.equal((await lastExtensionRequest()).offset, 100);
    assert.equal((await extensionIds()).length, 6);
    await extensionContent().focus(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown'); await extensionIdle();
    assert.equal(await extensionContent().inputValue(), 'SAFE');
    assert.equal((await lastExtensionRequest()).contentWarning, 'SAFE');
    assert.equal((await lastExtensionRequest()).offset, 0, 'content changes reset native pagination');
    assert.equal(await extensionRow('unknown').count(), 0);
    await changeExtension(extensionLanguage, 'ja');
    assert.deepEqual(await extensionIds(), []);
    await changeExtension(extensionContent, 'MIXED');
    assert.deepEqual(await extensionIds(), ['org.tsugi.metadata.beta']);
    assert.match(await extensions.innerText(), /1 matching extensions/);
    await changeExtension(extensionStatus, 'updates');
    assert.deepEqual(await extensionIds(), ['org.tsugi.metadata.beta']);
    assert.equal((await lastExtensionRequest()).installed, true);
    assert.equal((await lastExtensionRequest()).updatesOnly, true);
    assert.equal((await lastExtensionRequest()).language, 'ja');
    assert.equal((await lastExtensionRequest()).contentWarning, 'MIXED');
    await extensionRow('beta').getByRole('checkbox').check();
    await page.evaluate(() => { window.__sourceMetadataFixture.failExtensions = true; });
    await extensionContent().selectOption('NSFW'); await extensionIdle();
    await read.getByRole('alert').waitFor();
    assert.deepEqual(await extensionIds(), [], 'a failed filtered load cannot leave stale extension rows actionable');
    assert.equal(await extensions.getByRole('checkbox').count(), 0);
    assert.equal(await extensions.getByRole('button', { name: /^Update selected/ }).count(), 0);
    await page.evaluate(() => { window.__sourceMetadataFixture.failExtensions = false; });
    await extensions.getByRole('button', { name: 'Search', exact: true }).click(); await extensionIdle();
    assert.equal((await lastExtensionRequest()).contentWarning, 'NSFW', 'retry keeps the chosen content filter');
    assert.equal((await lastExtensionRequest()).language, 'ja');
    assert.equal((await lastExtensionRequest()).updatesOnly, true);
    assert.equal(await read.getByRole('alert').count(), 0);
    await changeExtension(extensionLanguage, 'en');
    assert.deepEqual(await extensionIds(), [], 'a matching content rating does not bypass Updates');
    await changeExtension(extensionStatus, 'installed');
    assert.deepEqual(await extensionIds(), ['org.tsugi.metadata.gamma']);
    await changeExtension(extensionContent, '');
    await changeExtension(extensionStatus, 'obsolete');
    assert.deepEqual(await extensionIds(), ['org.tsugi.metadata.obsolete']);
    assert.equal((await lastExtensionRequest()).obsoleteOnly, true);
    assert.equal((await lastExtensionRequest()).installed, true);
    assert.equal(await extensionRow('obsolete').getByRole('button', { name: 'Update', exact: true }).count(), 0);
    assert.equal(await extensionRow('obsolete').getByText('Update available', { exact: true }).count(), 0, 'an obsolete row cannot advertise a stale update candidate');
    if (screenshotDir) await page.screenshot({ path: join(screenshotDir, 'extension-metadata-filter.png'), animations: 'disabled' });
    assert.equal((await calls('catalogue')).length, 1, 'extension filters do not perform source discovery');
    assert.deepEqual((await page.evaluate(() => window.__sourceMetadataFixture.calls)).filter(action => /^(install|update|uninstall)-extension$/.test(action.kind)), [], 'filtering never mutates installed packages');

    await changeExtension(extensionStatus, 'all');
    await changeExtension(extensionContent, 'NSFW');
    await page.evaluate(() => { window.__sourceMetadataFixture.failRefreshAfterMutation = true; });
    for (const [label, kind, nextLabel] of [['Uninstall', 'uninstall-extension', 'Install'], ['Install', 'install-extension', 'Uninstall']]) {
      await extensionRow('gamma').getByRole('button', { name: label, exact: true }).click(); await extensionIdle();
      const alert = read.getByRole('alert');
      await alert.waitFor();
      assert.match(await alert.innerText(), /The original extension catalogue could not be verified\./, 'a failed post-mutation refresh stays visible after its row is removed');
      assert.deepEqual(await extensionIds(), [], 'accepted mutation with failed refresh cannot leave the old action state visible');
      assert.deepEqual(await page.evaluate(() => window.__sourceMetadataFixture.acceptedMutations.at(-1)), { kind, package: 'org.tsugi.metadata.gamma' });
      await page.evaluate(() => { window.__sourceMetadataFixture.failExtensions = false; });
      await extensions.getByRole('button', { name: 'Search', exact: true }).click(); await extensionIdle();
      assert.equal(await read.getByRole('alert').count(), 0);
      await extensionRow('gamma').getByRole('button', { name: nextLabel, exact: true }).waitFor();
      assert.equal((await lastExtensionRequest()).contentWarning, 'NSFW');
      assert.equal((await lastExtensionRequest()).language, 'en');
      assert.equal(await extensionStatus().inputValue(), 'all');
    }

    await page.reload({ waitUntil: 'domcontentloaded' });
    await rail.getByRole('button', { name: 'Browse', exact: true }).waitFor();
    await page.evaluate(() => { window.__sourceMetadataFixture.failSources = true; });
    await openSources();
    await read.getByRole('alert').waitFor();
    assert.deepEqual(await sourceIds(), [], 'a failed first inventory does not present unverified source rows');
    assert.deepEqual(await calls('catalogue'), []);
    await page.evaluate(() => { window.__sourceMetadataFixture.failSources = false; });
    await openSources(); await sourceRow('12345').waitFor();
    assert.equal(await read.getByRole('alert').count(), 0);
    assert.equal((await sourceIds()).length, 5, 'explicit inventory retry recovers the source list');
    assert.deepEqual(errors, [], 'metadata filters have no uncaught browser errors');
    console.log('PASS: source and extension content/language metadata, exact local filters, native pagination/counts, keyboard selection, unknown ratings, error recovery, obsolete/update separation and accepted install/uninstall refresh failures.');
  } finally { await page.close(); }
}
