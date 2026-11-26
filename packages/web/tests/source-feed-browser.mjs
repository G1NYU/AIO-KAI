// Real Feed UI with manually completed synthetic native catalogue requests.
// No live source, source URL, credentials or native media is used here.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

function installFeedFixture() {
  if (window.top !== window) return;
  localStorage.setItem('tsugi-onboarding-complete-v1', 'true');
  localStorage.setItem('tsugi-startup-area-v1', JSON.stringify('read'));
  const key = 'tsugi-reader-feed-v1';
  if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify({ version: 1, sources: [
    { sourceId: '12345', mode: 'popular' }, { sourceId: '9223372036854775807', mode: 'latest' },
    { sourceId: '9007199254740993', mode: 'popular' }, { sourceId: '-9', mode: 'popular' }, { sourceId: '888', mode: 'latest' },
  ] }));
  const host = window.aiostreamsApp, send = host.send.bind(host), subscribe = host.subscribe.bind(host), listeners = new Set();
  const rows = [
    { id: '0', name: 'Local fixture', lang: '', supportsLatest: false },
    { id: '12345', name: 'Alpha fixture', lang: 'en', supportsLatest: true },
    { id: '9007199254740993', name: 'Beta fixture', lang: 'ja', supportsLatest: true },
    { id: '-9', name: 'Gamma fixture', lang: 'fr', supportsLatest: true },
    { id: '888', name: 'Popular only fixture', lang: 'en', supportsLatest: false },
    ...['222', '333', '444', '555'].map(id => ({ id, name: 'Extra fixture ' + id, lang: 'en', supportsLatest: true })),
  ];
  const fixture = window.__feedFixture = { calls: [], inventoryCalls: 0, pending: [], afterCatalogue: [], active: 0, maximumActive: 0, failMangaOnce: false, storageFailure: null };
  const storageGet = Storage.prototype.getItem, storageSet = Storage.prototype.setItem;
  let failReadback = false;
  Storage.prototype.getItem = function (name) {
    if (this === localStorage && name === key && failReadback) { failReadback = false; throw Error('Original fixture readback failure'); }
    return storageGet.call(this, name);
  };
  Storage.prototype.setItem = function (name, value) {
    if (this === localStorage && name === key && fixture.storageFailure === 'write') throw Error('Original fixture write failure');
    storageSet.call(this, name, value);
    if (this === localStorage && name === key && fixture.storageFailure === 'readback') { fixture.storageFailure = null; failReadback = true; }
  };
  host.subscribe = listener => { listeners.add(listener); const remove = subscribe(listener); return () => { listeners.delete(listener); remove(); }; };
  const respond = (request, data, error = null) => queueMicrotask(() => {
    for (const listener of listeners) listener({ type: 'read-result', request, data, error });
  });
  fixture.complete = (outcome = 'success', tag = '') => {
    if (fixture.pending.length !== 1) throw Error('Expected exactly one pending original catalogue');
    const { request, action } = fixture.pending.shift();
    fixture.active--;
    if (outcome === 'error') respond(request, null, 'Original fixture source declined.');
    else {
      const source = rows.find(row => row.id === action.source);
      respond(request, { hasNextPage: action.page === 1, mangas: [{
        id: action.source === '12345' ? 1 : action.source === '9007199254740993' ? 3 : 4,
        sourceId: action.source, title: `${source.name} ${action.mode} page ${action.page}${tag ? ' ' + tag : ''}`,
        author: 'Tsugi CI', thumbnailUrl: null, inLibrary: action.source === '12345',
      }] });
    }
    for (const finish of fixture.afterCatalogue.splice(0)) queueMicrotask(finish);
  };
  host.send = message => {
    if (message.type !== 'read-request') return send(message);
    const action = message.action;
    if (action.kind === 'source-inventory') {
      fixture.inventoryCalls++;
      respond(message.request, { nodes: rows, totalCount: rows.length + 3, complete: true }); return;
    }
    if (action.kind === 'manga') {
      const finish = () => {
        if (fixture.failMangaOnce) { fixture.failMangaOnce = false; respond(message.request, null, 'Reading request failed.'); }
        else send(message);
      };
      if (fixture.pending.length) fixture.afterCatalogue.push(finish); else finish();
      return;
    }
    if (action.kind !== 'catalogue') return send(message);
    fixture.calls.push({ source: action.source, mode: action.mode, page: action.page });
    fixture.pending.push({ request: message.request, action });
    fixture.active++;
    fixture.maximumActive = Math.max(fixture.maximumActive, fixture.active);
  };
}

export async function verifySourceFeedBrowser({ browser, origin, installDesktopFixture, screenshotDir }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-GB', reducedMotion: 'reduce' });
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript({ content: `(${installDesktopFixture.toString()})();(${installFeedFixture.toString()})();` });
    await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAYCAIAAAB8wupbAAAAHUlEQVR4nGOsqF3FQApgIkn1qIZRDaMaRjWQrAEA4jkBz8UryC4AAAAASUVORK5CYII=', 'base64');
    await page.route('**/__tsugi_read/page/*', route => route.fulfill({ contentType: 'image/png', body: png }));
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    const read = page.locator('[data-page="read"]');
    const rail = read.locator('.tsugi-reading-rail');
    const feed = page.locator('[data-ui="source-feed"]');
    const source = id => feed.locator(`[data-feed-source="${id}"]`);
    const choice = id => feed.locator(`[data-feed-choice="${id}"]`);
    const refresh = () => feed.getByRole('button', { name: 'Refresh feed', exact: true });
    const frames = () => page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
    const calls = () => page.evaluate(() => window.__feedFixture.calls);
    const preferences = () => page.evaluate(() => JSON.parse(localStorage.getItem('tsugi-reader-feed-v1')));
    const pending = expected => page.waitForFunction(expected => window.__feedFixture.pending.length === 1 &&
      (!expected || window.__feedFixture.pending[0].action.source === expected), expected);
    const complete = async (outcome = 'success', tag = '') => { await page.evaluate(({ outcome, tag }) => window.__feedFixture.complete(outcome, tag), { outcome, tag }); };
    const idle = async () => { await page.waitForFunction(() => window.__feedFixture.pending.length === 0); await frames(); assert.equal(await refresh().isEnabled(), true); };
    const openFeed = async () => { await rail.getByRole('button', { name: 'Feed', exact: true }).click(); await feed.waitFor(); await feed.getByRole('button', { name: 'Reload installed sources', exact: true }).waitFor(); await frames(); };
    const assertNoNew = async before => { await frames(); assert.deepEqual(await calls(), before); };

    await openFeed();
    await choice('9007199254740993').waitFor();
    await source('9223372036854775807').getByText(/This saved source is unavailable/).waitFor();
    await source('888').getByText(/Latest is unavailable for this source/).waitFor();
    assert.equal(await choice('888').locator('option[value="latest"]').evaluate(option => option.disabled), true, 'unsupported Latest is disabled on the native select option');
    assert.equal(await feed.getByRole('combobox', { name: 'Add a Feed source', exact: true }).locator('option[value="0"]').count(), 0);
    assert.deepEqual(await calls(), [], 'opening Feed only reads source inventory');
    for (const id of ['222', '333', '444']) {
      await feed.getByRole('combobox', { name: 'Add a Feed source', exact: true }).selectOption(id);
      await feed.getByRole('button', { name: 'Add to Feed', exact: true }).click();
      await choice(id).waitFor();
    }
    assert.equal((await preferences()).sources.length, 8);
    assert.equal(await feed.getByRole('combobox', { name: 'Add a Feed source', exact: true }).isDisabled(), true);
    assert.equal(await feed.getByRole('button', { name: 'Add to Feed', exact: true }).isDisabled(), true);
    const tones = await feed.locator('[data-feed-choice]').evaluateAll(rows => rows.slice(0, 2).map(row => ({
      background: getComputedStyle(row).backgroundColor, border: getComputedStyle(row).borderBottomWidth,
    })));
    assert.notEqual(tones[0].background, tones[1].background, 'selected sources use alternating tonal rows');
    assert.ok(tones.every(row => row.border === '0px'), 'source choices have no separator rules');
    await choice('12345').getByRole('combobox').focus();
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('tsugi-reader-feed-v1')).sources[0].mode === 'latest');
    await page.keyboard.press('ArrowUp');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('tsugi-reader-feed-v1')).sources[0].mode === 'popular');
    await page.keyboard.press('Tab');
    assert.match(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? ''), /Remove Alpha fixture from Feed/);
    if (screenshotDir) { await mkdir(screenshotDir, { recursive: true }); await page.screenshot({ path: join(screenshotDir, 'source-feed-choices.png'), animations: 'disabled' }); }
    await page.setViewportSize({ width: 440, height: 1000 });
    await frames();
    assert.equal(await feed.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, 'Feed choices fit the narrow content column');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'Feed has no document overflow');
    const narrowName = await choice('12345').locator('strong').boundingBox();
    assert.ok(narrowName.width >= 160 && narrowName.height < 60, 'narrow source names remain readable rather than wrapping one character per line');
    if (screenshotDir) await page.screenshot({ path: join(screenshotDir, 'source-feed-narrow.png'), animations: 'disabled' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const id of ['222', '333', '444']) await choice(id).getByRole('button', { name: /Remove .* from Feed/ }).click();
    await feed.getByRole('button', { name: 'Reload installed sources', exact: true }).click();
    await page.waitForFunction(() => window.__feedFixture.inventoryCalls === 2);
    await frames();
    assert.deepEqual(await calls(), [], 'choices, mode changes and source reload never fetch catalogues');
    assert.ok((await preferences()).sources.some(row => row.sourceId === '9223372036854775807'), 'unavailable choice is retained');

    await refresh().focus(); await page.keyboard.press('Enter');
    await pending('12345');
    assert.equal((await calls()).length, 1, 'other selected sources wait for the first reply');
    await complete(); await pending('9007199254740993');
    await complete('error'); await pending('-9');
    await complete(); await idle();
    assert.deepEqual((await calls()).map(row => row.source), ['12345', '9007199254740993', '-9']);
    await source('9007199254740993').getByRole('alert').getByText(/This page could not be loaded/).waitFor();
    assert.ok(!(await feed.innerText()).includes('Original fixture source declined.'), 'provider errors are not copied into UI');
    await source('9007199254740993').getByRole('button', { name: 'Retry this source', exact: true }).click();
    await pending('9007199254740993'); await complete(); await idle();
    const preserved = await source('-9').locator('.tsugi-manga-title').allTextContents();
    for (const [label, number] of [['Next page', 2], ['Previous page', 1], ['Next page', 2]]) {
      const before = (await calls()).length;
      await source('12345').getByRole('button', { name: label, exact: true }).click();
      await pending('12345'); assert.equal((await calls()).at(-1).page, number);
      await complete(); await idle();
      assert.equal((await calls()).length, before + 1);
      assert.deepEqual(await source('12345').locator('.tsugi-manga-title').allTextContents(), [`Alpha fixture popular page ${number}`]);
      assert.deepEqual(await source('-9').locator('.tsugi-manga-title').allTextContents(), preserved);
    }
    assert.equal(await source('12345').getByRole('button', { name: 'Next page', exact: true }).isDisabled(), true);
    const beforeInventoryReload = await calls();
    const retainedTitles = await feed.locator('.tsugi-manga-title').allTextContents();
    await feed.getByRole('button', { name: 'Reload installed sources', exact: true }).click();
    await page.waitForFunction(() => window.__feedFixture.inventoryCalls === 3);
    await idle();
    assert.deepEqual(await feed.locator('.tsugi-manga-title').allTextContents(), retainedTitles, 'reloading the source list keeps completed Feed pages');
    await assertNoNew(beforeInventoryReload);

    let before = (await calls()).length;
    await refresh().click(); await pending('12345');
    await feed.getByRole('button', { name: 'Stop after current source', exact: true }).click();
    await complete('success', 'stopped'); await idle();
    assert.equal((await calls()).length, before + 1);
    await feed.getByRole('status').filter({ hasText: 'Feed stopped after the current source.' }).waitFor();
    await source('12345').locator('.tsugi-manga-title').filter({ hasText: /^Alpha fixture popular page 1 stopped$/ }).waitFor();

    before = (await calls()).length;
    await refresh().click(); await pending('12345');
    await choice('12345').getByRole('combobox').selectOption('latest');
    assert.equal(await refresh().isDisabled(), true, 'a changed choice cannot overlap an outstanding native request');
    await complete('success', 'obsolete-choice'); await idle();
    assert.equal((await calls()).length, before + 1);
    assert.equal(await source('12345').locator('.tsugi-manga-title').count(), 0, 'mode change discards the old mode and its late reply');
    await choice('12345').getByRole('combobox').selectOption('popular');
    await frames();

    before = (await calls()).length;
    await refresh().click(); await pending('12345');
    await read.getByRole('button', { name: 'Music', exact: true }).click();
    const music = page.locator('[data-page="music"]');
    await music.waitFor();
    await complete('success', 'obsolete-music'); await frames();
    assert.equal((await calls()).length, before + 1);
    const musicSources = music.getByRole('dialog', { name: 'Music sources', exact: true });
    if (await musicSources.isVisible()) await musicSources.getByRole('button', { name: 'Close', exact: true }).click();
    await music.getByRole('button', { name: 'Read', exact: true }).click();
    await feed.waitFor(); await idle();
    assert.equal(await feed.getByText(/obsolete-music/).count(), 0);
    assert.equal((await calls()).length, before + 1, 'returning from Music never auto-refreshes');

    before = (await calls()).length;
    await refresh().click(); await pending('12345');
    await rail.getByRole('button', { name: 'Library', exact: true }).click();
    await complete('success', 'obsolete-view'); await frames();
    await openFeed(); await idle();
    assert.equal((await calls()).length, before + 1);
    assert.equal(await feed.getByText(/obsolete-view/).count(), 0);

    before = (await calls()).length;
    await refresh().click(); await pending('12345');
    await page.evaluate(() => {
      localStorage.setItem('tsugi-reader-feed-v1', JSON.stringify({ version: 1, sources: [
        { sourceId: '12345', mode: 'latest' }, { sourceId: '9223372036854775807', mode: 'popular' },
      ] }));
      window.dispatchEvent(new Event('tsugi-source-feed-preferences-change'));
    });
    await complete('success', 'obsolete-restore'); await idle();
    assert.equal((await calls()).length, before + 1, 'restoring preferences does not contact providers');
    assert.equal(await feed.getByText(/obsolete-restore/).count(), 0);
    assert.equal(await source('12345').locator('.tsugi-manga-title').count(), 0);
    assert.equal(await choice('9007199254740993').count(), 0);

    await refresh().click(); await pending('12345'); await complete(); await idle();
    await source('12345').getByRole('button', { name: 'Next page', exact: true }).click();
    await pending('12345'); await complete(); await idle();
    before = (await calls()).length;
    await refresh().click(); await pending('12345');
    await source('12345').locator('.tsugi-manga-card').focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__feedFixture.afterCatalogue.length === 1);
    await complete('success', 'obsolete-details');
    await read.getByRole('heading', { name: 'Series', exact: true }).waitFor();
    await read.getByRole('button', { name: 'Back', exact: true }).click();
    await feed.waitFor(); await idle();
    assert.equal((await calls()).length, before + 1);
    assert.deepEqual(await source('12345').locator('.tsugi-manga-title').allTextContents(), ['Alpha fixture latest page 2'], 'returning from a card keeps its Feed page');
    assert.equal(await feed.getByText(/obsolete-details/).count(), 0);
    before = (await calls()).length;
    await refresh().click(); await pending('12345');
    await page.evaluate(() => { window.__feedFixture.failMangaOnce = true; });
    await source('12345').locator('.tsugi-manga-card').click();
    await page.waitForFunction(() => window.__feedFixture.afterCatalogue.length === 1);
    await complete('success', 'obsolete-failed-details');
    await read.getByRole('alert').getByText('Reading request failed.', { exact: true }).waitFor();
    await idle();
    assert.deepEqual(await source('12345').locator('.tsugi-manga-title').allTextContents(), ['Alpha fixture latest page 2']);
    assert.equal(await read.getByRole('heading', { name: 'Series', exact: true }).count(), 0);
    assert.equal((await calls()).length, before + 1, 'failed card opening does not resume the cancelled feed');
    await refresh().click(); await pending('12345');
    assert.equal(await read.getByRole('alert').getByText('Reading request failed.', { exact: true }).count(), 0, 'explicit refresh clears the previous card-opening error');
    await complete(); await idle();
    assert.equal((await calls()).length, before + 2, 'explicit refresh recovers after a failed card opening');
    assert.deepEqual(await source('12345').locator('.tsugi-manga-title').allTextContents(), ['Alpha fixture latest page 1']);
    await rail.getByRole('button', { name: 'Library', exact: true }).click();
    await openFeed(); await idle();
    assert.equal((await calls()).length, before + 2);
    assert.deepEqual(await source('12345').locator('.tsugi-manga-title').allTextContents(), ['Alpha fixture latest page 1']);
    assert.equal(await page.evaluate(() => window.__feedFixture.maximumActive), 1);
    if (screenshotDir) await page.screenshot({ path: join(screenshotDir, 'source-feed-results.png'), animations: 'disabled' });
    const saved = await preferences();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openFeed();
    assert.deepEqual(await preferences(), saved);
    await assertNoNew([]);
    assert.equal(await feed.locator('.tsugi-manga-card').count(), 0, 'catalogue results are not persisted');
    const savedBytes = await page.evaluate(() => localStorage.getItem('tsugi-reader-feed-v1'));
    for (const failure of ['write', 'readback']) {
      await page.evaluate(failure => { window.__feedFixture.storageFailure = failure; }, failure);
      await choice('12345').getByRole('combobox').selectOption('popular');
      await feed.getByRole('alert').getByText(/Feed choices could not be read or saved reliably/).waitFor();
      assert.equal(await refresh().isDisabled(), true);
      assert.equal(await choice('12345').getByRole('combobox').isDisabled(), true);
      assert.equal(await choice('12345').getByRole('combobox').inputValue(), 'latest', 'unconfirmed choices never replace the last confirmed selection');
      assert.equal(await page.evaluate(() => localStorage.getItem('tsugi-reader-feed-v1')), savedBytes, 'failed saves restore the exact previous stored bytes');
      await assertNoNew([]);
      await page.evaluate(() => { window.__feedFixture.storageFailure = null; });
      if (failure === 'write') {
        await feed.getByRole('button', { name: 'Reload saved Feed choices', exact: true }).click();
        await idle();
        assert.deepEqual(await preferences(), saved);
      } else {
        await feed.getByRole('button', { name: 'Reset Feed choices', exact: true }).click();
        await feed.getByText(/Your Feed is empty/).waitFor();
        assert.deepEqual(await preferences(), { version: 1, sources: [] });
        assert.equal(await feed.locator('[data-feed-choice]').count(), 0);
        assert.equal(await refresh().isDisabled(), true);
        assert.equal(await feed.getByRole('combobox', { name: 'Add a Feed source', exact: true }).isEnabled(), true);
      }
      assert.equal(await feed.getByRole('alert').count(), 0);
      await assertNoNew([]);
    }
    assert.deepEqual(errors, []);
    console.log('PASS: opt-in Feed choices, exact IDs, eight-source limit, sequential retry/pagination, stop/cancellation, card failure, storage rollback/reload/reset, saved-source retention, keyboard and narrow tonal layout.');
  } finally { await page.close(); }
}
