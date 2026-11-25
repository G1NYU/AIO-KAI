// Browser-level test using the real standalone Tsugi web application and
// an original, deterministic fake native bridge. No external manga source,
// desktop EXE, Java download, user credentials or package artifact is used.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
const { chromium } = await import(pathToFileURL(process.env.TSUGI_READER_PLAYWRIGHT).href);
const origin = 'http://127.0.0.1:4179';
const deadline = Date.now() + 180_000;
while (true) {
  try {
    const r = await fetch(origin, { signal: AbortSignal.timeout(4000) });
    if (r.ok) break;
  } catch { /* dev server is still compiling */ }
  if (Date.now() > deadline) throw new Error('Tsugi reader dev server did not start');
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' });
  page.setDefaultTimeout(30_000);
  const screenshotDir = process.env.TSUGI_DESIGN_SCREENSHOTS;
  if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
  const capture = async (name) => { if (screenshotDir) await page.screenshot({ path: join(screenshotDir, name + '.png'), animations: 'disabled' }); };
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const listeners = new Set();
    const manga = { id: '1', title: 'Tsugi Original Fixture', author: 'Tsugi', thumbnailUrl: '/api/v1/manga/1/thumbnail', inLibrary: true, unreadCount: 2, description: '**Original fixture** for reader tests.', genre: ['Adventure'] };
    const chapters = [{ id: 11, name: 'Chapter 1', chapterNumber: 1, scanlator: 'Original', isRead: false, lastPageRead: 0, pageCount: 4 }, { id: 12, name: 'Chapter 2', chapterNumber: 2, scanlator: 'Original', isRead: false, lastPageRead: 0, pageCount: 4 }];
    const state = window.__readerFixture = { requests: [], lastPath: '', serial: 0, installed: false, stores: [], progress: [], nativeMessages: [], nativeRequest: null };
    const nodes = (items) => ({ nodes: items, totalCount: items.length });
    const emit = (message) => queueMicrotask(() => { for (const listener of listeners) listener(message); });
    window.aiostreamsApp = {
      protocol: 2, version: 'fixture', platform: 'windows', reading: true, readingSetup: true, youtubeMusic: true, nativeMusicAudio: true, device: 'Fixture',
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      send(message) {
        if (message.type === 'youtube-music-request') {
          const data = message.operation === 'search' ? { musicResponsiveListItemRenderer: {
            playlistItemData: { videoId: 'abcdefghijk' },
            flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Native fixture track' }] } } }],
            thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: 'https://lh3.googleusercontent.com/tsugi-fixture=w120-h120', width: 120, height: 120 }] } } },
          } } : message.operation === 'audio' ? { url: 'https://www.youtube.com/watch?v=abcdefghijk', format: 'fixture' } : {};
          emit({ type: 'youtube-music-result', request: message.request, data, error: null });
          return;
        }
        if (message.type === 'music-audio-load' || message.type === 'music-audio-control') {
          state.nativeMessages.push(message);
          if (message.type === 'music-audio-load') {
            state.nativeRequest = message.request;
            emit({ type: 'music-audio-state', request: message.request, status: 'playing', position: 0, duration: 180, error: null });
          } else if (message.request === state.nativeRequest && message.action === 'pause') {
            emit({ type: 'music-audio-state', request: message.request, status: message.value ? 'paused' : 'playing', position: 1, duration: 180, error: null });
          } else if (message.action === 'stop') state.nativeRequest = null;
          return;
        }
        if (message.type !== 'read-request') return;
        const a = message.action;
        state.requests.push(a);
        let data;
        let error = null;
        switch (a.kind) {
          case 'library': data = nodes([manga, { id: '2', title: 'ZZ Missing Fixture', author: 'Tsugi', inLibrary: true, unreadCount: 0 }]); break;
          case 'trackers': data = nodes([{ id: 1, name: 'MyAnimeList', isLoggedIn: !!state.trackerConnected, supportsReadingDates: true, supportsPrivateTracking: false }]); break;
          case 'tracker-login': state.trackerConnected = true; data = { isLoggedIn: true }; break;
          case 'tracker-logout': state.trackerConnected = false; data = { isLoggedIn: false }; break;
          case 'track-records': data = nodes(state.trackRecord ? [state.trackRecord] : []); break;
          case 'tracker-search': data = { trackSearches: [{ remoteId: '44', title: 'Original tracker match', totalChapters: 2, publishingType: 'Manga', publishingStatus: 'Finished', startDate: '2025' }] }; break;
          case 'tracker-bind': if (a.remoteId !== '44') throw new Error('Expected lossless tracker ID'); state.trackRecord = { id: 91, trackerId: 1, title: 'Original tracker match', lastChapterRead: 0, totalChapters: 2 }; data = { trackRecord: state.trackRecord }; break;
          case 'tracker-sync': state.trackRecord.lastChapterRead = 1; data = { trackRecords: [state.trackRecord] }; break;
          case 'tracker-unbind': state.trackRecord = null; data = { clientMutationId: null }; break;
          case 'chapter-flags': data = { chapters: chapters.filter((chapter) => a.ids.includes(chapter.id)).map((chapter) => { if (typeof a.read === 'boolean') { chapter.isRead = a.read; if (!a.read) chapter.lastPageRead = 0; } if (typeof a.bookmarked === 'boolean') chapter.isBookmarked = a.bookmarked; return { id: chapter.id, isRead: chapter.isRead, isBookmarked: !!chapter.isBookmarked, lastPageRead: chapter.lastPageRead }; }) }; break;
          case 'stores': data = nodes(state.stores); break;
          case 'add-store': state.stores.push({ name: 'Original fixture store', indexUrl: a.index }); data = { ok: true }; break;
          case 'refresh-extensions': data = { ok: true }; break;
          case 'extensions': data = nodes(state.stores.length && (a.installed === undefined || a.installed === state.installed) && (!a.language || a.language === 'en') ? [{ pkgName: 'org.tsugi.fixture', name: 'Original extension', lang: 'en', versionName: '1.6', storeIndexUrl: state.stores[0].indexUrl, isInstalled: state.installed, isObsolete: false }] : []); break;
          case 'install-extension': state.installed = true; data = { ok: true }; break;
          case 'sources': data = nodes(state.installed ? [{ id: '12345', name: 'Original source', lang: 'en', supportsLatest: true }] : []); break;
          case 'catalogue': data = { mangas: [manga], hasNextPage: false }; break;
          case 'manga': data = { manga, chapters }; break;
          case 'chapter': data = { id: a.id, pageCount: 4 }; break;
          case 'cover':
          case 'page':
            state.lastPath = '/__tsugi_read/page/' + ++state.serial;
            data = { path: state.lastPath, ...(a.kind === 'page' ? { index: a.index } : {}) };
            break;
          case 'progress':
            state.progress.push(a);
            data = { chapter: { id: a.chapterId, lastPageRead: a.index, isRead: a.finished } };
            break;
          default: error = 'Unexpected fixture request: ' + a.kind;
        }
        queueMicrotask(() => { for (const listener of listeners) listener({ type: 'read-result', request: message.request, data, error }); });
      },
    };
  });
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAYCAIAAAB8wupbAAAAHUlEQVR4nGOsqF3FQApgIkn1qIZRDaMaRjWQrAEA4jkBz8UryC4AAAAASUVORK5CYII=', 'base64');
  await page.route('**/__tsugi_read/page/*', async (route) => {
    const current = await page.evaluate(() => window.__readerFixture.lastPath);
    await route.fulfill(new URL(route.request().url()).pathname === current
      ? { status: 200, contentType: 'image/png', body: image, headers: { 'cache-control': 'no-store' } }
      : { status: 404, body: 'expired image capability' });
  });
  // Deny unrelated external requests; the test uses only original fixtures.
  await page.route('**/*', (route) => route.request().url().startsWith(origin + '/') ? route.fallback() : route.abort());
  const artworkRequests = [];
  await page.route('https://lh3.googleusercontent.com/tsugi-fixture=*', async route => {
    artworkRequests.push(route.request().url());
    // Simulate a CDN refusing the larger variant. The original must still display.
    if (route.request().url().endsWith('=w1024-h1024')) await route.fulfill({ status:404 });
    else await route.fulfill({ status:200, contentType:'image/png', body:image });
  });
  const coverQueries = [];
  await page.route('https://api.jikan.moe/v4/manga?*', async route => {
    coverQueries.push(new URL(route.request().url()).searchParams.get('q'));
    await route.fulfill({ json: { data: [{ mal_id: 42, title: 'ZZ Missing Fixture', authors: [{ name: 'Tsugi' }], images: { jpg: { large_image_url: 'https://cdn.myanimelist.net/images/manga/1/2.jpg' } } }] }, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.route('https://cdn.myanimelist.net/images/manga/1/2.jpg', route => route.fulfill({ contentType: 'image/png', body: image }));
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  const landing = page.locator('[data-page="desktop-landing"]');
  await landing.getByRole('button', { name: 'Movies & TV', exact: true }).waitFor();
  await page.waitForFunction(() => document.documentElement.dataset.tsugiTheme === 'sumi');
  assert.deepEqual(await landing.locator('.tsugi-index-link').allTextContents(), ['Movies & TV', 'Music', 'Read']);
  assert.equal(await landing.locator('.tsugi-index-link svg').count(), 3);
  assert.equal(await landing.locator('.tsugi-index-kanji').count(), 0);
  assert.equal(await landing.getByRole('heading', { name: 'Tsugi', exact: true }).count(), 1);
  const thread = landing.locator('.tsugi-index-pattern');
  assert.equal(await thread.count(), 1);
  assert.equal(await thread.evaluate(node => getComputedStyle(node).pointerEvents), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.equal(await thread.evaluate(node => getComputedStyle(node, '::before').animationName), 'tsugi-thread-drift');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await thread.evaluate(node => getComputedStyle(node, '::before').animationName), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.equal(await landing.locator('.tsugi-index-link').first().evaluate(node => getComputedStyle(node).borderRadius), '8px');
  await capture('01-launcher');
  await landing.getByRole('button', { name: 'Movies & TV', exact: true }).click();
  const entry = page.locator('.tsugi-video-entry');
  const field = entry.getByRole('textbox', { name: /Server address/ });
  await field.waitFor();
  await page.locator('.tsugi-index-pattern').waitFor({ state: 'detached' });
  await field.focus();
  assert.equal(await field.evaluate((node) => getComputedStyle(node).outlineColor), 'rgb(213, 213, 220)');
  assert.equal(await field.evaluate((node) => getComputedStyle(node).borderRadius), '8px');
  assert.equal(await entry.locator('[data-ui="auth-card"]').evaluate((node) => getComputedStyle(node).borderRadius), '0px');
  assert.equal(await entry.getByRole('button', { name: 'Connect', exact: true }).evaluate((node) => getComputedStyle(node).borderRadius), '8px');
  assert.equal(await entry.evaluate((node) => getComputedStyle(node).backgroundColor), 'rgb(16, 18, 20)');
  const brand = await entry.locator('.tsugi-auth-brand').boundingBox();
  const card = await entry.locator('[data-ui="auth-card"]').boundingBox();
  assert.ok(Math.abs((brand.x + brand.width / 2) - (card.x + card.width / 2)) < 3, 'auth brand is centered over the form');
  await capture('02-movie-setup');
  const mediaNav = page.locator('.tsugi-entry-media-nav');
  await mediaNav.getByRole('button', { name: 'App settings', exact: true }).click();
  const globalDialog = page.getByRole('dialog');
  assert.equal(await globalDialog.evaluate(node => getComputedStyle(node).borderRadius), '14px');
  const dialogFont = await globalDialog.evaluate(node => getComputedStyle(node).fontFamily);
  assert.equal(await entry.evaluate(node => getComputedStyle(node).fontFamily), dialogFont);
  const paletteButton = globalDialog.getByRole('button', { name: 'Mocha', exact: true });
  assert.equal(await paletteButton.evaluate(node => getComputedStyle(node).borderRadius), '8px');
  await paletteButton.click();
  await globalDialog.getByRole('button', { name: 'Amber', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.tsugiAccent === 'amber' && document.documentElement.style.getPropertyValue('--tsugi-accent') === '#E4BA87');
  await globalDialog.getByRole('button', { name: 'Close', exact: true }).click();
  await field.focus();
  assert.equal(await field.evaluate((node) => getComputedStyle(node).outlineColor), 'rgb(213, 213, 220)');
  await mediaNav.getByRole('button', { name: 'All media', exact: true }).click();
  await landing.waitFor();
  console.log('PASS: shared movie entry canvas, centered brand, restrained corner radii and palette-independent field focus.');
  await page.getByRole('button', { name: 'App settings', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Carbon', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.tsugiTheme === 'carbon' && document.documentElement.style.getPropertyValue('--background') === document.documentElement.style.getPropertyValue('--tsugi-canvas'));
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('[data-page="desktop-landing"]').getByRole('button', { name: 'Read', exact: true }).click();
  const rail = page.locator('.tsugi-reading-rail');
  const readMedia = page.locator('.tsugi-read-media-header');
  assert.equal(await page.locator('html').getAttribute('data-tsugi-accent'), 'amber');
  await readMedia.getByRole('button', { name: 'App settings', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Carbon', exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog').getByRole('button', { name: 'Carbon', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('dialog').getByRole('button', { name: 'Mocha', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.tsugiTheme === 'mocha');
  await page.getByRole('dialog').getByRole('button', { name: 'Default', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  assert.equal(await page.locator('[data-page="read"]').evaluate(node => getComputedStyle(node).fontFamily), dialogFont);
  await capture('03-reading-library');
  assert.deepEqual(coverQueries, []);
  await rail.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: /Reader Set the default reading layout/ }).click();
  await page.getByRole('checkbox', { name: /Find missing library covers/ }).check();
  await rail.getByRole('button', { name: 'Library', exact: true }).click();
  await page.locator('.tsugi-manga-card').filter({ hasText: 'ZZ Missing Fixture' }).locator('img[data-cover-origin="metadata"]').waitFor();
  await page.locator('.tsugi-manga-card').filter({ hasText: 'Tsugi Original Fixture' }).locator('img[data-cover-origin="source"]').waitFor();
  assert.deepEqual(coverQueries, ['ZZ Missing Fixture']);
  await rail.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: /Trackers See tracking services/ }).click();
  await page.getByText('MyAnimeList', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).waitFor();
  await rail.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: /Browse Manage manga sources/ }).click();
  await page.getByRole('button', { name: /Sources Manage extension sources/ }).click();
  await page.getByRole('button', { name: /Extension repositories Add or remove/ }).click();
  await page.getByRole('textbox', { name: 'Repository index URL' }).fill('https://example.test/index.pb');
  await page.getByRole('button', { name: 'Add repository', exact: true }).click();
  await page.getByText('Original fixture store', { exact: true }).waitFor();
  await rail.getByRole('button', { name: 'Extensions', exact: true }).click();
  await page.getByRole('button', { name: 'Install', exact: true }).click();
  await page.getByRole('button', { name: 'Uninstall', exact: true }).waitFor();
  await page.getByRole('combobox', { name: 'Extension language' }).selectOption('en');
  await page.getByRole('combobox', { name: 'Extension status' }).selectOption('installed');
  await page.getByRole('button', { name: 'Uninstall', exact: true }).waitFor();
  await rail.getByRole('button', { name: 'Browse', exact: true }).click();
  await page.getByRole('button', { name: /Original source/ }).click();
  await page.locator('.tsugi-manga-card').first().click();
  await page.getByRole('heading', { name: 'Tsugi Original Fixture' }).waitFor();
  assert.equal(await page.locator('.tsugi-series-layout').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length), 2);
  const artColumn = await page.locator('.tsugi-series-layout .tsugi-manga-detail').boundingBox();
  const chapterColumn = await page.locator('.tsugi-series-chapters').boundingBox();
  assert.ok(artColumn.x + artColumn.width < chapterColumn.x, 'manga metadata and chapters occupy distinct columns');
  const readPrimary = await page.getByRole('button', { name: /Start or resume reading/ }).boundingBox();
  const trackingAction = await page.getByRole('button', { name: 'Tracking', exact: true }).boundingBox();
  assert.ok(readPrimary.y + readPrimary.height < 900 && trackingAction.y + trackingAction.height < 900, 'primary reading and tracking controls fit above the fold');
  await capture('04-reading-details');
  await page.getByRole('button', { name: 'Bookmark chapter', exact: true }).first().click();
  await page.getByRole('button', { name: 'Remove bookmark', exact: true }).first().waitFor();
  await page.getByRole('checkbox', { name: 'Select chapter Chapter 1', exact: true }).check();
  await page.getByRole('button', { name: 'Mark read', exact: true }).click();
  await page.waitForFunction(() => window.__readerFixture.requests.some((a) => a.kind === 'chapter-flags' && a.read === true && a.ids.includes(11)));
  await page.getByRole('checkbox', { name: 'Select chapter Chapter 1', exact: true }).check();
  await page.getByRole('button', { name: 'Mark unread', exact: true }).click();
  await page.waitForFunction(() => window.__readerFixture.requests.some((a) => a.kind === 'chapter-flags' && a.read === false && a.ids.includes(11)));
  await page.getByRole('button', { name: 'Tracking', exact: true }).click();
  await page.getByRole('button', { name: 'Load tracking', exact: true }).click();
  await page.getByRole('button', { name: 'Search tracker', exact: true }).click();
  await page.getByRole('button', { name: /Original tracker match/ }).click();
  await page.getByRole('button', { name: 'Link selected series', exact: true }).click();
  await page.getByRole('button', { name: 'Sync completed chapters', exact: true }).click();
  await page.getByText(/Sync requested/).waitFor();
  await page.getByRole('button', { name: 'Unlink', exact: true }).click();
  await page.getByRole('button', { name: 'Search tracker', exact: true }).waitFor();
  await page.getByRole('button', { name: /Start or resume reading/ }).click();
  const reader = page.locator('.tsugi-chapter-reader');
  await reader.waitFor();
  assert.equal(await reader.getAttribute('data-mode'), 'scroll');
  await page.waitForFunction(() => [...document.querySelectorAll('.tsugi-chapter-page img')].filter((img) => img.complete && img.naturalWidth > 0).length >= 2);
  await capture('05-reader');
  await page.locator('.tsugi-chapter-viewport').evaluate((root) => {
    const target = root.querySelector('[data-reader-page="1"]');
    root.scrollTop += target.getBoundingClientRect().top - root.getBoundingClientRect().top;
  });
  await page.waitForFunction(() => window.__readerFixture.progress.some((p) => p.chapterId === 11 && p.index === 1 && !p.finished));
  await reader.getByRole('button', { name: 'Reader settings', exact: true }).click();
  await reader.getByRole('button', { name: /Spread Two pages/ }).click();
  assert.equal(await reader.getAttribute('data-mode'), 'spread');
  await reader.getByRole('button', { name: 'Appearance', exact: true }).click();
  await reader.getByRole('button', { name: 'Graphite', exact: true }).click();
  assert.equal(await reader.getAttribute('data-background'), 'graphite');
  await reader.getByRole('button', { name: 'Close settings', exact: true }).click();
  await reader.getByRole('button', { name: 'Chapter list', exact: true }).click();
  await reader.getByRole('button', { name: /Chapter 2 Original/ }).click();
  await page.waitForFunction(() => window.__readerFixture.requests.some((a) => a.kind === 'chapter' && a.id === 12));
  await page.waitForFunction(() => document.querySelector('.tsugi-chapter-toolbar h2')?.textContent === 'Tsugi Original Fixture' && document.querySelector('.tsugi-chapter-toolbar p')?.textContent?.includes('Chapter 2'));
  assert.equal(await page.locator('.tsugi-chapter-reader').getAttribute('data-mode'), 'spread');
  // A real local WAV exercises the HTML audio element, not just a policy
  // function or synthetic native status. Keep it playing through the Read
  // transition, then verify the video environment stops competing audio.
  await reader.getByRole('button', { name: 'Chapters', exact: true }).click();
  await readMedia.getByRole('button', { name: 'Music', exact: true }).click();
  const music = page.locator('[data-page="music"]');
  await music.waitFor({ state: 'visible' });
  const musicSettings = music.getByRole('dialog', { name: 'Music settings' });
  if (await musicSettings.isVisible()) await musicSettings.getByRole('button', { name: 'Close', exact: true }).click();
  await music.getByRole('button', { name: 'Library', exact: true }).click();
  await music.getByRole('button', { name: /Local music/ }).waitFor();
  await music.getByRole('textbox', { name: 'Find tracks', exact: true }).waitFor();
  const sampleRate = 8000, samples = sampleRate * 45;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(1000 * Math.sin(2 * Math.PI * 220 * i / sampleRate)), 44 + i * 2);
  await music.locator('input[aria-label="Open local audio"]').setInputFiles({ name: 'Tsugi audio fixture.wav', mimeType: 'audio/wav', buffer: wav });
  await music.getByRole('textbox', { name: 'Find tracks', exact: true }).fill('not a match');
  await music.getByText('No matching tracks', { exact: true }).waitFor();
  await music.getByRole('textbox', { name: 'Find tracks', exact: true }).fill('Tsugi audio fixture');
  await music.getByRole('button', { name: /Tsugi audio fixture/ }).click();
  await page.waitForFunction(() => { const audio = document.querySelector('[data-ui="tsugi-audio-engine"]'); return audio && !audio.paused && audio.currentTime > 0.1; });
  assert.equal(await music.getByRole('heading', { name: 'Library', exact: true }).count(), 1);
  assert.equal(await music.getByRole('navigation', { name: 'Music sections', exact: true }).count(), 1);
  await capture('06-music-library');
  const timeBefore = await page.locator('[data-ui="tsugi-audio-engine"]').evaluate((audio) => audio.currentTime);
  await music.getByRole('button', { name: 'Read', exact: true }).click();
  await rail.waitFor();
  await page.waitForFunction((before) => { const audio = document.querySelector('[data-ui="tsugi-audio-engine"]'); return audio && !audio.paused && audio.currentTime > before + 0.2; }, timeBefore);
  const dock = page.locator('[data-ui="reading-music-controls"]');
  await dock.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-ui="tsugi-audio-engine"]')?.paused === true);
  await dock.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-ui="tsugi-audio-engine"]')?.paused === false);
  await page.getByRole('button', { name: /Start or resume reading/ }).click();
  await reader.waitFor({ state: 'visible' });
  await page.waitForFunction(() => [...document.querySelectorAll('.tsugi-chapter-page img')].some((img) => img.complete && img.naturalWidth > 0));
  const inside = await page.locator('[data-ui="tsugi-audio-engine"]').evaluate((audio) => audio.currentTime);
  await page.waitForFunction((before) => { const audio = document.querySelector('[data-ui="tsugi-audio-engine"]'); return audio && !audio.paused && audio.currentTime > before + 0.2; }, inside);
  await reader.getByRole('button', { name: 'Focus mode', exact: true }).click();
  await page.mouse.move(700, 400);
  await dock.waitFor({ state: 'hidden' });
  await page.keyboard.press('f');
  await dock.waitFor({ state: 'visible' });
  await dock.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-ui="tsugi-audio-engine"]')?.paused === true);
  await dock.getByRole('button', { name: 'Play', exact: true }).click();
  await reader.getByRole('button', { name: 'Next page', exact: true }).click();
  const chapterBefore = await reader.locator('.tsugi-chapter-toolbar p').first().textContent();
  const visiblePages = await reader.locator('.tsugi-chapter-page').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-reader-page')));
  await reader.getByRole('button', { name: 'Music', exact: true }).click();
  await music.waitFor({ state: 'visible' });
  await reader.waitFor({ state: 'hidden' });
  await music.getByRole('button', { name: 'Read', exact: true }).click();
  await reader.waitFor({ state: 'visible' });
  assert.equal(await reader.locator('.tsugi-chapter-toolbar p').first().textContent(), chapterBefore);
  assert.deepEqual(await reader.locator('.tsugi-chapter-page').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-reader-page'))), visiblePages);
  assert.equal(await page.locator('[data-ui="tsugi-audio-engine"]').evaluate(audio => audio.paused), false);
  assert.equal(await reader.getByRole('button', { name: 'Chapters', exact: true }).isEnabled(), true);
  await capture('07-reading-with-music');
  await reader.getByRole('button', { name: 'Chapters', exact: true }).click();
  await readMedia.getByRole('button', { name: 'Movies & TV', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-ui="tsugi-audio-engine"]')?.paused === true);
  console.log('PASS: real local WAV playback continues in a chapter, focus mode and Music round trip; video entry pauses music.');
  // Exercise the real frontend native audio protocol with synthetic metadata
  // and a fake native transport. Never contact YouTube or resolve a real URL.
  await mediaNav.getByRole('button', { name: 'Music', exact: true }).click();
  await music.waitFor({ state: 'visible' });
  await music.getByRole('button', { name: 'Music settings', exact: true }).click();
  await musicSettings.getByRole('button', { name: 'Connect YouTube Music', exact: true }).click();
  await music.getByRole('textbox', { name: 'Search music', exact: true }).fill('Native fixture track');
  await music.getByRole('button', { name: 'Search', exact: true }).last().click();
  await music.locator('[data-ui="music-track-row"]').filter({ hasText: 'Native fixture track' }).click();
  await page.waitForFunction(() => window.__readerFixture.nativeMessages.some(m => m.type === 'music-audio-load'));
  const nativeRequest = await page.evaluate(() => window.__readerFixture.nativeRequest);
  assert.ok(nativeRequest);
  const miniQueue = music.locator('[data-ui="mini-queue"]');
  await miniQueue.locator('summary').click();
  await miniQueue.locator('button[aria-current="true"]').filter({ hasText: 'Native fixture track' }).waitFor();
  await miniQueue.locator('summary').click();
  assert.equal(await miniQueue.getAttribute('open'), null);
  const miniSave = music.getByRole('button', { name: 'Save playing track', exact: true });
  await miniSave.waitFor();
  const wasSaved = await miniSave.getAttribute('aria-pressed');
  const changedSaved = wasSaved === 'true' ? 'false' : 'true';
  await miniSave.click();
  await music.locator('[aria-label="Save playing track"][aria-pressed="' + changedSaved + '"]').waitFor();
  await page.waitForFunction(({ saved }) => {
    const lists = JSON.parse(localStorage.getItem('tsugi-independent-playlists-v1') || '[]');
    const track = lists.find(list => list.id === 'tsugi-saved-tracks')?.tracks.find(item => item.id === 'abcdefghijk');
    return saved ? !!track && track.artist === '' && !!track.sourceId : !track;
  }, { saved: changedSaved === 'true' });
  await miniSave.click();
  await music.locator('[aria-label="Save playing track"][aria-pressed="' + wasSaved + '"]').waitFor();
  assert.equal(await music.getByRole('heading', { name: 'Search music', exact: true }).count(), 1);
  await music.locator('.tsugi-search-results-heading').waitFor();
  await capture('08-mini-player');
  await music.getByRole('button', { name: 'Expand player', exact: true }).click();
  const expanded = music.getByRole('dialog', { name: 'Now playing', exact: true });
  await expanded.waitFor();
  await expanded.locator('img[src*="tsugi-fixture=w120-h120"]').waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.tsugi-player-dialog img')].some(img => img.src.includes('tsugi-fixture=w120-h120') && img.complete && img.naturalWidth > 0));
  assert.ok(artworkRequests.some(url => url.endsWith('=w1024-h1024')), 'expanded player requests a larger original');
  await capture('08-expanded-player');
  await expanded.getByRole('button', { name: 'Minimise player', exact: true }).click();
  await music.getByRole('button', { name: 'Read', exact: true }).click();
  await rail.waitFor();
  await page.locator('.tsugi-manga-card').first().click();
  await page.getByRole('button', { name: /Start or resume reading/ }).click();
  await reader.waitFor({ state: 'visible' });
  await dock.getByRole('button', { name: 'Pause', exact: true }).click();
  await dock.getByRole('button', { name: 'Play', exact: true }).click();
  await dock.getByRole('button', { name: 'Pause', exact: true }).waitFor();
  await reader.getByRole('button', { name: 'Music', exact: true }).click();
  await music.waitFor({ state: 'visible' });
  await music.getByRole('button', { name: 'Read', exact: true }).click();
  await reader.waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => window.__readerFixture.nativeRequest), nativeRequest);
  const nativeMessages = await page.evaluate(() => window.__readerFixture.nativeMessages);
  assert.equal(nativeMessages.filter(m => m.type === 'music-audio-load').length, 1);
  assert.equal(nativeMessages.filter(m => m.action === 'stop').length, 0);
  assert.deepEqual(nativeMessages.filter(m => m.action === 'pause').map(m => m.value), [1, 0]);
  await reader.getByRole('button', { name: 'Chapters', exact: true }).click();
  await readMedia.getByRole('button', { name: 'Movies & TV', exact: true }).click();
  await page.waitForFunction(() => window.__readerFixture.nativeMessages.some(m => m.action === 'stop'));
  console.log('PASS: simulated native music transport remains loaded through Read and Music round trip; video entry sends stop.');
  assert.deepEqual(errors, []);
  console.log('PASS: readable launcher/labels, repository registration, catalogue filter, extension install, source browse, image transfer, scroll progress, reader settings and chapter switching (mock bridge).');
} finally { await browser.close(); }
