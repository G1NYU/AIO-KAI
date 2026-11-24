// Browser-level test using the real standalone Tsugi web application and
// an original, deterministic fake native bridge. No external manga source,
// desktop EXE, Java download, user credentials or package artifact is used.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
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
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const listeners = new Set();
    const manga = { id: '1', title: 'Tsugi Original Fixture', author: 'Tsugi', thumbnailUrl: '/api/v1/manga/1/thumbnail', inLibrary: true, unreadCount: 2, description: '**Original fixture** for reader tests.', genre: ['Adventure'] };
    const chapters = [{ id: 11, name: 'Chapter 1', chapterNumber: 1, scanlator: 'Original', isRead: false, lastPageRead: 0, pageCount: 4 }, { id: 12, name: 'Chapter 2', chapterNumber: 2, scanlator: 'Original', isRead: false, lastPageRead: 0, pageCount: 4 }];
    const state = window.__readerFixture = { requests: [], lastPath: '', serial: 0, installed: false, stores: [], progress: [] };
    const nodes = (items) => ({ nodes: items, totalCount: items.length });
    window.aiostreamsApp = {
      protocol: 2, version: 'fixture', platform: 'windows', reading: true, readingSetup: true, device: 'Fixture',
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      send(message) {
        if (message.type !== 'read-request') return;
        const a = message.action;
        state.requests.push(a);
        let data;
        let error = null;
        switch (a.kind) {
          case 'library': data = nodes([manga]); break;
          case 'trackers': data = nodes([{ id: 1, name: 'MyAnimeList', isLoggedIn: false, supportsReadingDates: true, supportsPrivateTracking: false }]); break;
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
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'App settings', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Carbon', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.tsugiTheme === 'carbon' && document.documentElement.style.getPropertyValue('--background') === document.documentElement.style.getPropertyValue('--tsugi-canvas'));
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('[data-page="desktop-landing"]').getByRole('button', { name: 'Read', exact: true }).click();
  const rail = page.locator('.tsugi-reading-rail');
  await rail.getByRole('button', { name: 'App settings', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Carbon', exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog').getByRole('button', { name: 'Carbon', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('dialog').getByRole('button', { name: 'Mocha', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await rail.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: /Trackers See tracking services/ }).click();
  await page.getByText('MyAnimeList', { exact: true }).waitFor();
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
  await page.getByRole('button', { name: 'Bookmark chapter', exact: true }).first().click();
  await page.getByRole('button', { name: 'Remove bookmark', exact: true }).first().waitFor();
  await page.getByRole('checkbox', { name: 'Select chapter Chapter 1', exact: true }).check();
  await page.getByRole('button', { name: 'Mark read', exact: true }).click();
  await page.waitForFunction(() => window.__readerFixture.requests.some((a) => a.kind === 'chapter-flags' && a.read === true && a.ids.includes(11)));
  await page.getByRole('checkbox', { name: 'Select chapter Chapter 1', exact: true }).check();
  await page.getByRole('button', { name: 'Mark unread', exact: true }).click();
  await page.waitForFunction(() => window.__readerFixture.requests.some((a) => a.kind === 'chapter-flags' && a.read === false && a.ids.includes(11)));
  await page.getByRole('button', { name: /Start or resume reading/ }).click();
  const reader = page.locator('.tsugi-chapter-reader');
  await reader.waitFor();
  assert.equal(await reader.getAttribute('data-mode'), 'scroll');
  await page.waitForFunction(() => [...document.querySelectorAll('.tsugi-chapter-page img')].filter((img) => img.complete && img.naturalWidth > 0).length >= 2);
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
  await rail.getByRole('button', { name: 'Music', exact: true }).click();
  const music = page.locator('[data-page="music"]');
  await music.waitFor({ state: 'visible' });
  const musicSettings = music.getByRole('dialog', { name: 'Music settings' });
  if (await musicSettings.isVisible()) await musicSettings.getByRole('button', { name: 'Close', exact: true }).click();
  await music.getByRole('button', { name: 'Library', exact: true }).click();
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
  await music.getByRole('button', { name: /Tsugi audio fixture/ }).click();
  await page.waitForFunction(() => { const audio = document.querySelector('[data-page="music"] audio'); return audio && !audio.paused && audio.currentTime > 0.1; });
  const timeBefore = await page.locator('[data-page="music"] audio').evaluate((audio) => audio.currentTime);
  await music.getByRole('button', { name: 'Read', exact: true }).click();
  await rail.waitFor();
  await page.waitForFunction((before) => { const audio = document.querySelector('[data-page="music"] audio'); return audio && !audio.paused && audio.currentTime > before + 0.2; }, timeBefore);
  const dock = page.locator('[data-ui="reading-music-controls"]');
  await dock.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-page="music"] audio')?.paused === true);
  await dock.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-page="music"] audio')?.paused === false);
  await rail.getByRole('button', { name: 'Movies & TV', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-page="music"] audio')?.paused === true);
  console.log('PASS: real local WAV playback continues through Read, dock pause/resume works, video entry pauses music.');
  assert.deepEqual(errors, []);
  console.log('PASS: readable launcher/labels, repository registration, catalogue filter, extension install, source browse, image transfer, scroll progress, reader settings and chapter switching (mock bridge).');
} finally { await browser.close(); }
