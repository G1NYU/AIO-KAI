// Original chapter queue fixture against the real Reader UI. No provider traffic.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

function installReaderDownloadsFixture() {
  if (window.top !== window) return;
  localStorage.setItem('tsugi-onboarding-complete-v1', 'true');
  localStorage.setItem('tsugi-startup-area-v1', JSON.stringify('read'));
  const host = window.aiostreamsApp, base = window.__readerFixture;
  const manga = { id: 1, sourceId: '12345', title: 'Tsugi Original Fixture', author: 'Tsugi', inLibrary: true, categories: { nodes: [] } };
  const chapters = Array.from({ length: 103 }, (_, index) => ({ id: index + 11, name: 'Chapter ' + (index + 1), chapterNumber: index + 1,
    isRead: index === 2, isBookmarked: index === 0, lastPageRead: index === 0 ? 2 : 0, pageCount: 4, isDownloaded: index === 1 }));
  const row = (id, state = 'QUEUED') => ({ id, mangaId: 1, mangaTitle: manga.title, chapterName: chapters.find(chapter => chapter.id === id)?.name || 'Original queue chapter ' + id,
    pageCount: 4, isDownloaded: false, state, progress: state === 'DOWNLOADING' ? 0.375 : 0, tries: state === 'ERROR' ? 8 : 0, position: 0 });
  const fixture = window.__readerDownloadsFixture = { calls: [], mutations: [], state: 'STOPPED', queue: [row(13, 'ERROR')], chapters,
    failStatus: false, nextOutcome: 'confirmed', cachedFiles: { 11: ['original-page-0'], 12: ['original-page-0', 'original-page-1'] } };
  fixture.row = row;
  const snapshot = () => ({ state: fixture.state, queue: fixture.queue.map((entry, position) => ({ ...entry, position })) });
  const send = host.send.bind(host), subscribe = host.subscribe.bind(host), listeners = new Set();
  host.subscribe = listener => { listeners.add(listener); const remove = subscribe(listener); return () => { listeners.delete(listener); remove(); }; };
  const emit = (request, data, error = null) => queueMicrotask(() => { for (const listener of listeners) listener({ type: 'read-result', request, data, error }); });
  host.send = message => {
    if (message.type !== 'read-request') return send(message);
    const action = message.action;
    fixture.calls.push(action);
    if ((action.kind === 'manga' || action.kind === 'cached-manga') && action.id === 1) {
      base.requests.push(action);
      return emit(message.request, { manga, chapters: structuredClone(chapters) });
    }
    if (action.kind === 'download-status') return fixture.failStatus ? emit(message.request, null, 'private-provider-detail-must-not-appear') : emit(message.request, snapshot());
    if (!['enqueue-downloads', 'cancel-downloads', 'retry-downloads', 'pause-downloads', 'resume-downloads'].includes(action.kind)) return send(message);
    if ('ids' in action && (!Array.isArray(action.ids) || !action.ids.length || action.ids.length > 100 || new Set(action.ids).size !== action.ids.length || action.ids.some(id => !Number.isInteger(id) || id <= 0 || id > 2147483647))) throw new Error('Invalid queue selection in original fixture');
    fixture.mutations.push(structuredClone(action));
    if (action.kind === 'enqueue-downloads') {
      if (action.ids.some(id => fixture.queue.some(entry => entry.id === id))) return emit(message.request, null, 'A selected chapter is already queued. Refresh download status or use Retry for failed downloads.');
      if (action.ids.some(id => chapters.find(chapter => chapter.id === id)?.isDownloaded)) return emit(message.request, null, 'A selected chapter is already marked downloaded. Refresh the chapter list.');
      fixture.queue.push(...action.ids.map(id => row(id, 'DOWNLOADING'))); fixture.state = 'STARTED';
    } else if (action.kind === 'cancel-downloads') {
      if (action.ids.some(id => !fixture.queue.some(entry => entry.id === id))) throw new Error('Cancelling an absent fixture entry');
      fixture.queue = fixture.queue.filter(entry => !action.ids.includes(entry.id));
      if (!fixture.queue.length) fixture.state = 'STOPPED';
    } else if (action.kind === 'retry-downloads') {
      if (action.ids.some(id => !fixture.queue.some(entry => entry.id === id && entry.state === 'ERROR'))) throw new Error('Retrying a nonfailed fixture entry');
      fixture.queue = fixture.queue.map(entry => action.ids.includes(entry.id) ? { ...entry, state: 'QUEUED', progress: 0, tries: entry.tries + 1 } : entry);
      fixture.state = 'STARTED';
    } else if (action.kind === 'pause-downloads') fixture.state = 'STOPPED';
    else if (fixture.queue.some(entry => ['QUEUED', 'DOWNLOADING'].includes(entry.state))) fixture.state = 'STARTED';
    const outcome = fixture.nextOutcome; fixture.nextOutcome = 'confirmed';
    if (outcome === 'lost') return emit(message.request, null, 'The download operation may have changed the queue. Refresh download status before trying another action.');
    return emit(message.request, { ...snapshot(), ...(outcome === 'uncertain' ? { uncertain: true } : {}) });
  };
}

export async function verifyReaderDownloadsBrowser({ browser, origin, installDesktopFixture, screenshotDir }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-GB', reducedMotion: 'reduce' });
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const read = page.locator('[data-page="read"]'), rail = read.locator('.tsugi-reading-rail');
  const downloads = page.locator('[data-ui="reader-downloads"]');
  const calls = kind => page.evaluate(kind => window.__readerDownloadsFixture.calls.filter(action => action.kind === kind), kind);
  const frames = () => page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
  const queueRow = id => downloads.locator('[data-download-id="' + id + '"]');
  const current = () => downloads.locator('[data-ui="download-queue-state"]');
  const idle = async () => { await page.waitForFunction(() => !document.querySelector('[data-ui="reader-downloads"] button')?.disabled); await frames(); };
  const refresh = async () => { await downloads.getByRole('button', { name: 'Refresh downloads', exact: true }).click(); await idle(); };
  try {
    await page.addInitScript({ content: `(${installDesktopFixture.toString()})();(${installReaderDownloadsFixture.toString()})();` });
    await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAYCAIAAAB8wupbAAAAHUlEQVR4nGOsqF3FQApgIkn1qIZRDaMaRjWQrAEA4jkBz8UryC4AAAAASUVORK5CYII=', 'base64');
    await page.route('**/__tsugi_read/page/*', route => route.fulfill({ contentType: 'image/png', body: png }));
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await read.locator('.tsugi-manga-card').filter({ hasText: 'Tsugi Original Fixture' }).waitFor();
    assert.equal((await calls('download-status')).length, 0, 'opening Read does not observe or mutate the queue');
    const original = await page.evaluate(() => ({ chapters: structuredClone(window.__readerDownloadsFixture.chapters), files: structuredClone(window.__readerDownloadsFixture.cachedFiles) }));
    await read.locator('.tsugi-manga-card').filter({ hasText: 'Tsugi Original Fixture' }).click();
    await read.getByRole('checkbox', { name: 'Select visible chapters', exact: true }).check();
    assert.equal(await read.getByRole('button', { name: 'Download selected', exact: true }).isDisabled(), true, '103 chapters cannot become an oversized request');
    await read.getByText('Select at most 100 chapters to download at once.', { exact: true }).waitFor();
    await read.getByRole('button', { name: 'Clear selection', exact: true }).click();
    await read.getByRole('checkbox', { name: 'Select chapter Chapter 1', exact: true }).check();
    await read.getByRole('checkbox', { name: 'Select chapter Chapter 2', exact: true }).check();
    await read.getByText('Already downloaded chapters are skipped.', { exact: true }).waitFor();
    await read.getByRole('button', { name: 'Download selected', exact: true }).focus(); await page.keyboard.press('Enter');
    await read.getByRole('button', { name: 'Download selected', exact: true }).waitFor({ state: 'hidden' });
    assert.deepEqual(await calls('enqueue-downloads'), [{ kind: 'enqueue-downloads', ids: [11] }]);
    assert.equal((await calls('cached-manga')).length, 1, 'enqueue refreshes cached chapter status without a source fetch');
    assert.equal(await read.locator('[data-chapter-downloaded="12"]').count(), 1);
    assert.equal((await calls('download-status')).length, 0, 'the title view does not start queue polling');
    await read.getByRole('button', { name: 'View Downloads', exact: true }).click(); await idle();
    assert.equal((await calls('download-status')).length, 1);
    await downloads.getByText('The download queue resumes automatically when the Reader engine restarts. Cancelling a queue entry keeps any cached files.', { exact: true }).waitFor();
    await downloads.getByText("Downloaded is the reading engine's status. It does not guarantee that every page is available offline.", { exact: true }).waitFor();
    assert.equal(await queueRow(11).getByRole('progressbar').getAttribute('value'), '0.375');
    await queueRow(13).getByText('Failed', { exact: true }).waitFor();
    assert.match(await queueRow(13).innerText(), /Attempts: 8/);
    const tones = await downloads.locator('[data-download-id]').evaluateAll(rows => rows.map(row => ({ background: getComputedStyle(row).backgroundColor, border: getComputedStyle(row).borderBottomWidth })));
    assert.notEqual(tones[0].background, tones[1].background); assert.ok(tones.every(row => row.border === '0px'));
    if (screenshotDir) { await mkdir(screenshotDir, { recursive: true }); await page.screenshot({ path: join(screenshotDir, 'reader-downloads-wide.png'), animations: 'disabled' }); }
    await page.setViewportSize({ width: 440, height: 1000 }); await frames();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'queue controls and rows fit a narrow window');
    if (screenshotDir) await page.screenshot({ path: join(screenshotDir, 'reader-downloads-narrow.png'), animations: 'disabled' });
    await page.setViewportSize({ width: 1440, height: 1000 });

    await queueRow(11).getByRole('checkbox').check(); await queueRow(13).getByRole('checkbox').check();
    await downloads.getByRole('button', { name: 'Retry selected failed downloads', exact: true }).click(); await idle();
    assert.deepEqual(await calls('retry-downloads'), [{ kind: 'retry-downloads', ids: [13] }]);
    await downloads.getByRole('button', { name: 'Pause downloads', exact: true }).click(); await idle();
    assert.match(await current().innerText(), /Downloader stopped/);
    await downloads.getByRole('button', { name: 'Resume downloads', exact: true }).click(); await idle();
    assert.match(await current().innerText(), /Downloader running/);
    await queueRow(11).getByRole('checkbox').check();
    await downloads.getByRole('button', { name: 'Cancel selected downloads', exact: true }).click(); await idle();
    assert.deepEqual(await calls('cancel-downloads'), [{ kind: 'cancel-downloads', ids: [11] }]);
    assert.equal(await queueRow(11).count(), 0);
    assert.deepEqual(await page.evaluate(() => window.__readerDownloadsFixture.cachedFiles), original.files, 'cancellation keeps cached media');
    assert.deepEqual(await page.evaluate(() => window.__readerDownloadsFixture.chapters), original.chapters, 'queue actions preserve reading progress and bookmarks');

    await page.evaluate(() => {
      const fixture = window.__readerDownloadsFixture;
      fixture.state = 'STOPPED'; fixture.queue[0].state = 'ERROR';
    }); await refresh();
    assert.equal(await downloads.getByRole('button', { name: 'Resume downloads', exact: true }).isDisabled(), true, 'a failed-only queue requires an explicit Retry');
    await queueRow(13).getByRole('checkbox').check();
    await downloads.getByRole('button', { name: 'Retry selected failed downloads', exact: true }).click(); await idle();
    assert.match(await current().innerText(), /Downloader running/);

    await read.getByRole('button', { name: 'Music', exact: true }).click();
    const hiddenCalls = (await calls('download-status')).length;
    await page.waitForTimeout(4500);
    assert.equal((await calls('download-status')).length, hiddenCalls, 'hidden Read does not poll while Music is visible');
    const music = page.locator('[data-page="music"]');
    const musicSources = music.getByRole('dialog', { name: 'Music sources', exact: true });
    if (await musicSources.isVisible()) await musicSources.getByRole('button', { name: 'Close', exact: true }).click();
    await music.getByRole('button', { name: 'Read', exact: true }).click(); await idle();
    assert.equal((await calls('download-status')).length, hiddenCalls + 1, 'returning refreshes the queue once');
    await page.evaluate(() => { window.__readerDownloadsFixture.failStatus = true; });
    await downloads.getByRole('alert').getByText('Download status could not be refreshed. The shown queue may be out of date. Refresh to try again.', { exact: true }).waitFor();
    assert.equal(await downloads.getAttribute('data-download-status'), 'stale');
    assert.equal(await queueRow(13).count(), 1, 'a failed poll retains labeled last-known rows');
    assert.equal(await downloads.getByRole('button', { name: 'Pause downloads', exact: true }).isDisabled(), true);
    assert.ok(!(await downloads.innerText()).includes('private-provider-detail'));
    const failedCalls = (await calls('download-status')).length;
    await page.waitForTimeout(4500);
    assert.equal((await calls('download-status')).length, failedCalls, 'an error stops automatic polling');
    await page.evaluate(() => { window.__readerDownloadsFixture.failStatus = false; }); await refresh();
    assert.equal(await downloads.getAttribute('data-download-status'), 'current');

    await page.evaluate(() => { window.__readerDownloadsFixture.nextOutcome = 'uncertain'; });
    const beforePause = (await calls('pause-downloads')).length, beforeReconcile = (await calls('download-status')).length;
    await downloads.getByRole('button', { name: 'Pause downloads', exact: true }).click(); await idle();
    await downloads.getByRole('alert').getByText('The previous download request could not be confirmed. Status was refreshed without repeating it. Check the queue before trying again.', { exact: true }).waitFor();
    assert.equal((await calls('pause-downloads')).length, beforePause + 1);
    assert.equal((await calls('download-status')).length, beforeReconcile + 1);
    assert.match(await current().innerText(), /Downloader stopped/);
    await page.evaluate(() => { window.__readerDownloadsFixture.nextOutcome = 'lost'; });
    const beforeResume = (await calls('resume-downloads')).length, beforeLostReconcile = (await calls('download-status')).length;
    await downloads.getByRole('button', { name: 'Resume downloads', exact: true }).click(); await idle();
    assert.equal((await calls('resume-downloads')).length, beforeResume + 1);
    assert.equal((await calls('download-status')).length, beforeLostReconcile + 1, 'a lost mutation reply only re-reads status');
    assert.match(await current().innerText(), /Downloader running/);

    await page.evaluate(() => {
      const fixture = window.__readerDownloadsFixture;
      fixture.state = 'STOPPED'; fixture.queue = [];
      fixture.chapters.find(chapter => chapter.id === 13).isDownloaded = true;
    }); await refresh();
    await downloads.getByRole('heading', { name: 'No queued chapters', exact: true }).waitFor();
    await rail.getByRole('button', { name: 'Library', exact: true }).click();
    await read.locator('.tsugi-manga-card').filter({ hasText: 'Tsugi Original Fixture' }).click();
    await read.getByRole('button', { name: 'Refresh download status', exact: true }).click();
    await read.locator('[data-chapter-downloaded="13"]').waitFor();
    assert.deepEqual(await page.evaluate(() => window.__readerDownloadsFixture.chapters.map(({ isDownloaded, ...chapter }) => chapter)), original.chapters.map(({ isDownloaded, ...chapter }) => chapter));
    assert.equal((await calls('manga')).length, 2, 'refreshing download flags uses persisted chapter metadata');

    await read.getByRole('button', { name: 'View Downloads', exact: true }).click(); await idle();
    await page.evaluate(() => {
      const fixture = window.__readerDownloadsFixture;
      fixture.queue = Array.from({ length: 101 }, (_, index) => fixture.row(index + 1000));
    }); await refresh();
    assert.equal(await downloads.locator('[data-download-id]').count(), 100, 'large queues render bounded pages');
    await downloads.getByRole('checkbox', { name: 'Select visible downloads', exact: true }).check();
    assert.equal(await downloads.locator('[data-download-id] input:checked').count(), 100);
    await downloads.getByRole('button', { name: 'Next page', exact: true }).click();
    assert.equal(await downloads.locator('[data-download-id]').count(), 1);
    assert.equal(await downloads.getByRole('button', { name: 'Cancel selected downloads', exact: true }).isDisabled(), true, 'changing pages clears selection');
    assert.equal((await calls('catalogue')).length, 0);
    assert.equal((await calls('progress')).length, 0);
    assert.equal((await calls('chapter-flags')).length, 0);
    assert.equal((await calls('apply-download-cleanup')).length, 0);
    assert.deepEqual(errors, []);
    console.log('PASS: explicit bounded chapter downloads, cached status refresh, tonal queue progress, pause/resume, selected retry/cancel, visible-only polling, stale recovery, uncertainty without replay and preserved progress/media.');
  } finally { await page.close(); }
}
