// Browser-level test using the real standalone Tsugi web application and
// an original, deterministic fake native bridge. No external manga source,
// desktop EXE, Java download, user credentials or package artifact is used.
import assert from 'node:assert/strict';
import { pdfFixture, epubFixture } from './ebook-fixtures.mjs';
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
  // These previews use deliberately synthetic media artwork and mocked provider metadata.
  // They verify layout and interaction, not live-server artwork quality or native Windows rendering.
  const screenshotDir = process.env.TSUGI_DESIGN_SCREENSHOTS;
  if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
  const capture = async (name) => { if (screenshotDir) await page.screenshot({ path: join(screenshotDir, name + '.png'), animations: 'disabled' }); };
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    if (window.top !== window) return;
    const listeners = new Set();
    const manga = { id: '1', title: 'Tsugi Original Fixture', author: 'Tsugi', thumbnailUrl: '/api/v1/manga/1/thumbnail', inLibrary: true, unreadCount: 2, description: '**Original fixture** for reader tests.', genre: ['Adventure'] };
    const chapters = [{ id: 11, name: 'Chapter 1', chapterNumber: 1, scanlator: 'Original', isRead: false, lastPageRead: 0, pageCount: 4 }, { id: 12, name: 'Chapter 2', chapterNumber: 2, scanlator: 'Original', isRead: false, lastPageRead: 0, pageCount: 4 }];
    manga.categories = { nodes: [] };
    manga.sourceId = '12345';
    const replacement = { id: '3', sourceId: '67890', title: 'Tsugi Original Fixture', author: 'Tsugi', inLibrary: false, categories: { nodes: [] } };
    const replacementChapters = [{ id: 31, name: 'Chapter 1', chapterNumber: 1, isRead: false, isBookmarked: false, lastPageRead: 0, pageCount: 4 }];
    const batchTitle = { id: '4', sourceId: '67890', title: 'Batch Fixture', author: 'Tsugi', inLibrary: false, categories: { nodes: [] } };
    const state = window.__readerFixture = { requests: [], lastPath: '', serial: 0, installed: false, stores: [], progress: [], nativeMessages: [], nativeRequest: null, vaultJobs: [], vaultRequests: [], categories: [], categorySequence: 0, updateChecks: 0 };
    const nodes = (items) => ({ nodes: items, totalCount: items.length });
    const emit = (message) => queueMicrotask(() => { for (const listener of listeners) listener(message); });
    window.aiostreamsApp = {
      protocol: 2, version: 'fixture', platform: 'windows', reading: true, readingSetup: true, youtubeMusic: true, nativeMusicAudio: true, torbox: true, device: 'Fixture',
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      send(message) {
        if(message.type==='torbox-request'){
          (state.torboxOperations??=[]).push(message.operation);
          if(message.operation==='connect')state.torboxConnected=message.value==='fixture-key';
          if(message.operation==='disconnect')state.torboxConnected=false;
          if(message.operation==='submit')state.torboxLink=message.value;
          const authenticated=!!state.torboxConnected;
          emit({type:'torbox-result',request:message.request,data:{connected:authenticated,items:authenticated?[{id:1,name:'Fixture cloud archive.zip',state:'completed',finished:true},{id:2,name:'Fixture pending audio.m4a',state:'downloading',finished:false}]:[]},error:message.operation==='connect'&&!authenticated?'auth':null});
          return;
        }
        if (message.type === 'download-config') {state.vaultConcurrent=message.concurrent;return;}
        if (message.type === 'vault-rate') {state.vaultRate=message.mib;emit({type:'download-state',folder:'Fixture downloads',jobs:state.vaultJobs,vault_rate_mib:state.vaultRate,aria2_available:true});return;}
        if (message.type === 'download-list') {
          emit({type:'download-state',folder:'Fixture downloads',jobs:state.vaultJobs,vault_rate_mib:state.vaultRate??0,aria2_available:true});return;
        }
        if (message.type === 'download-add') {
          state.vaultRequests.push(message);
          for(const job of message.jobs)state.vaultJobs.push({id:job.id,state:'queued',bytes:0,total:null,error:null,vault_title:job.title});
          emit({type:'download-state',folder:'Fixture downloads',jobs:state.vaultJobs,vault_rate_mib:state.vaultRate??0,aria2_available:true});return;
        }
        if (message.type === 'youtube-music-request') {
          const fixturePlaylist = { musicTwoRowItemRenderer: {
            title: { runs: [{ text: 'Fixture playlist' }] },
            navigationEndpoint: { browseEndpoint: { browseId: 'VLfixtureplaylist' } },
            thumbnailRenderer: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: 'https://lh3.googleusercontent.com/tsugi-fixture=w120-h120', width: 120, height: 120 }] } } },
          } };
          const fixtureTrack = { musicResponsiveListItemRenderer: {
            playlistItemData: { videoId: 'abcdefghijk' },
            flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Native fixture track' }] } } }],
            thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: 'https://lh3.googleusercontent.com/tsugi-fixture=w120-h120', width: 120, height: 120 }] } } },
          } };
          const data = message.operation === 'search' ? [fixtureTrack, fixturePlaylist] : message.operation === 'browse' ? Array.from({length:12},(_,i)=>({musicResponsiveListItemRenderer:{...fixtureTrack.musicResponsiveListItemRenderer,playlistItemData:{videoId:'abcdefghij'+i.toString(36)},flexColumns:[{musicResponsiveListItemFlexColumnRenderer:{text:{runs:[{text:'Collection track '+(i+1)}]}}}]}})) : message.operation === 'home' ? { musicCarouselShelfRenderer: {
            header: { musicCarouselShelfBasicHeaderRenderer: { title: { runs: [{ text: 'Fixture recommendations' }] } } },
            contents: [{ musicResponsiveListItemRenderer: {
              playlistItemData: { videoId: 'abcdefghijk' },
              flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Native fixture track' }] } } }],
              thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: 'https://lh3.googleusercontent.com/tsugi-fixture=w120-h120', width: 120, height: 120 }] } } },
            } }],
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
          case 'library': data = nodes([manga, { id: '2', title: 'ZZ Missing Fixture', author: 'Tsugi', inLibrary: true, unreadCount: 0 }, ...[replacement, batchTitle].filter(item => item.inLibrary)]); break;
          case 'set-library': {
            const target = [manga, replacement, batchTitle].find(item => Number(item.id) === a.id);
            if (!target) throw new Error('Unknown saved title');
            target.inLibrary = a.inLibrary; data = { manga: target }; break;
          }
          case 'categories': data = nodes(state.categories); break;
          case 'save-category': {
            let category = state.categories.find(item => item.id === a.id);
            if (category) category.name = a.name;
            else { category = { id: ++state.categorySequence, name: a.name, order: state.categorySequence }; state.categories.push(category); }
            data = { category }; break;
          }
          case 'assign-category':
            if (a.mangaId !== 1) throw new Error('Unexpected category assignment');
            manga.categories.nodes = manga.categories.nodes.filter(item => item.id !== a.categoryId);
            if (a.assigned) manga.categories.nodes.push({ id: a.categoryId });
            data = { manga }; break;
          case 'delete-category':
            state.categories = state.categories.filter(item => item.id !== a.id);
            manga.categories.nodes = manga.categories.nodes.filter(item => item.id !== a.id);
            data = { category: { id: a.id } }; break;
          case 'history': data = nodes([{ ...chapters[0], lastReadAt: 1760000000000, manga }]); break;
          case 'updates': data = nodes([{ ...chapters[1], fetchedAt: 1760000000000, manga }]); break;
          case 'cached-manga': data = a.id === 3 ? { manga: replacement, chapters: replacementChapters } : a.id === 4 ? { manga: batchTitle, chapters: [] } : { manga, chapters }; break;
          case 'start-library-update': state.updateChecks++; data = { jobsInfo: { isRunning: true, totalJobs: 1, finishedJobs: 0, skippedCategoriesCount: 0, skippedMangasCount: 0 } }; break;
          case 'library-update-status': data = { jobsInfo: { isRunning: false, totalJobs: state.updateChecks ? 1 : 0, finishedJobs: state.updateChecks ? 1 : 0, skippedCategoriesCount: 0, skippedMangasCount: 0 } }; break;
          case 'trackers': data = nodes([{ id: 1, name: 'MyAnimeList', isLoggedIn: !!state.trackerConnected, supportsReadingDates: true, supportsPrivateTracking: false }]); break;
          case 'tracker-login': state.trackerConnected = true; data = { isLoggedIn: true }; break;
          case 'tracker-logout': state.trackerConnected = false; data = { isLoggedIn: false }; break;
          case 'track-records': data = nodes(state.trackRecord ? [state.trackRecord] : []); break;
          case 'tracker-search': data = { trackSearches: [{ remoteId: '44', title: 'Original tracker match', totalChapters: 2, publishingType: 'Manga', publishingStatus: 'Finished', startDate: '2025' }] }; break;
          case 'tracker-bind': if (a.remoteId !== '44') throw new Error('Expected lossless tracker ID'); state.trackRecord = { id: 91, trackerId: 1, title: 'Original tracker match', lastChapterRead: 0, totalChapters: 2 }; data = { trackRecord: state.trackRecord }; break;
          case 'tracker-sync': state.trackRecord.lastChapterRead = 1; data = { trackRecords: [state.trackRecord] }; break;
          case 'tracker-unbind': state.trackRecord = null; data = { clientMutationId: null }; break;
          case 'chapter-flags': data = { chapters: [...chapters, ...replacementChapters].filter((chapter) => a.ids.includes(chapter.id)).map((chapter) => { if (typeof a.read === 'boolean') { chapter.isRead = a.read; if (!a.read) chapter.lastPageRead = 0; } if (typeof a.bookmarked === 'boolean') chapter.isBookmarked = a.bookmarked; return { id: chapter.id, isRead: chapter.isRead, isBookmarked: !!chapter.isBookmarked, lastPageRead: chapter.lastPageRead }; }) }; break;
          case 'stores': data = nodes(state.stores); break;
          case 'add-store': state.stores.push({ name: 'Original fixture store', indexUrl: a.index }); data = { ok: true }; break;
          case 'refresh-extensions': data = { ok: true }; break;
          case 'extensions': data = nodes(state.stores.length && (a.installed === undefined || a.installed === state.installed) && (!a.language || a.language === 'en') ? [{ pkgName: 'org.tsugi.fixture', name: 'Original extension', lang: 'en', versionName: '1.6', storeIndexUrl: state.stores[0].indexUrl, isInstalled: state.installed, isObsolete: false }] : []); break;
          case 'install-extension': state.installed = true; data = { ok: true }; break;
          case 'sources': data = nodes(state.installed ? [{ id: '12345', name: 'Original source', lang: 'en', supportsLatest: true }, ...(state.transferEnabled ? [{ id: '67890', name: 'Replacement source', lang: 'en', supportsLatest: true }] : [])] : []); break;
          case 'catalogue': data = { mangas: a.source === '67890' ? a.query === 'Batch Fixture' ? [batchTitle] : [replacement] : [manga], hasNextPage: false }; break;
          case 'manga': data = a.id === 3 ? { manga: replacement, chapters: replacementChapters } : { manga, chapters }; break;
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
  await page.route('**/*', (route) => (route.request().url().startsWith(origin + '/') || route.request().url().startsWith('http://localhost:4179/tsugi-books/')) ? route.fallback() : route.abort());
  const heroRequests = [];
  const wideArt = '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="600"><rect width="1600" height="600" fill="#37495b"/></svg>';
  await page.route('https://kitsu.io/api/edge/manga?*', async route => {
    heroRequests.push('kitsu');
    await route.fulfill({ json: { data: [{ attributes: { adult: false, ageRating: 'PG', coverImage: { large: 'https://media.kitsu.io/manga/cover_images/1/large.jpg' } } }] }, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.route('https://media.kitsu.io/manga/cover_images/1/large.jpg', async route => {
    heroRequests.push('kitsu-image');
    await route.fulfill({ status: 404 });
  });
  await page.route('https://api.nekosapi.com/v4/images/random/file?*', async route => {
    heroRequests.push('nekos');
    await route.fulfill({ contentType: 'image/svg+xml', body: wideArt });
  });
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
  const onboarding = page.locator('[data-ui="tsugi-onboarding"]');
  await onboarding.waitFor({ state: 'visible' });
  assert.equal(await onboarding.evaluate(node => getComputedStyle(node).borderRadius), '14px');
  assert.equal(await onboarding.locator('.tsugi-global-swatch').first().evaluate(node => getComputedStyle(node).borderRadius), '6px');
  await onboarding.getByRole('button', { name: 'Mocha', exact: true }).click();
  await onboarding.getByRole('button', { name: 'Blue', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.tsugiTheme === 'mocha' && document.documentElement.dataset.tsugiAccent === 'blue');
  await capture('00-first-boot-appearance');
  await onboarding.getByRole('button', { name: 'Enter Tsugi' }).click();
  await onboarding.waitFor({ state: 'hidden' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await landing.getByRole('button', { name: 'Movies & TV', exact: true }).waitFor();
  await page.waitForFunction(() => document.documentElement.dataset.tsugiTheme === 'mocha' && document.documentElement.dataset.tsugiAccent === 'blue');
  assert.equal(await onboarding.isVisible(), false, 'onboarding does not reopen after completion');
  await landing.getByRole('button', { name: 'App settings', exact: true }).click();
  const bootSettings = page.getByRole('dialog');
  await bootSettings.getByRole('button', { name: 'Default', exact: true }).click();
  await bootSettings.getByRole('button', { name: 'Silver', exact: true }).click();
  await bootSettings.getByRole('button', { name: 'Close', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.tsugiTheme === 'sumi' && document.documentElement.dataset.tsugiAccent === 'silver');
  assert.deepEqual(await landing.locator('.tsugi-index-link').allTextContents(), ['Movies & TV', 'Music', 'Read', 'Vault']);
  assert.equal(await landing.locator('.tsugi-index-link svg').count(), 4);
  assert.equal(await landing.locator('.tsugi-index-kanji').count(), 0);
  assert.equal(await landing.getByRole('heading', { name: 'Tsugi', exact: true }).count(), 1);
  assert.equal(await landing.locator('.tsugi-index-pattern').count(), 0);
  assert.equal(await page.locator('html').getAttribute('class').then(value => value.includes('tsugi-desktop-boot')), true);
  assert.equal(await landing.locator('.tsugi-index-link').first().evaluate(node => getComputedStyle(node).borderRadius), '8px');
  const assertLauncherGeometry = async () => {
    const width = await page.evaluate(() => document.documentElement.clientWidth);
    const height = await page.evaluate(() => window.innerHeight);
    const canvas = await landing.boundingBox();
    const brandBox = await landing.locator('.tsugi-index-wordmark').boundingBox();
    const choices = await landing.locator('.tsugi-index-destinations').boundingBox();
    const buttons = await landing.locator('.tsugi-index-link').evaluateAll(nodes => nodes.map(node => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height };
    }));
    const center = canvas.x + canvas.width / 2;
    assert.ok(Math.abs(center - width / 2) <= 8, 'launcher canvas centered within viewport including scrollbar: ' + JSON.stringify({ canvas, width }));
    assert.ok(Math.abs(brandBox.x + brandBox.width / 2 - center) < 3, 'launcher brand centered: ' + JSON.stringify({ brandBox, canvas }));
    assert.ok(Math.abs(choices.x + choices.width / 2 - center) < 3, 'launcher destinations centered: ' + JSON.stringify({ choices, canvas }));
    assert.ok(brandBox.y + brandBox.height / 2 < height * .53, 'brand raised above the midpoint');
    assert.ok(choices.y > brandBox.y + brandBox.height && choices.y + choices.height <= height, 'destination row below wordmark and within viewport');
    assert.ok(buttons.every(button => Math.abs(button.y - buttons[0].y) < 2 && Math.abs(button.width - buttons[0].width) < 2), 'equal-width destinations on one baseline');
  };
  await assertLauncherGeometry();
  const wordmarkAsset = await landing.locator('.tsugi-index-wordmark').evaluate(async node => {
    const mask = getComputedStyle(node, '::before').maskImage;
    const url = mask.match(/^url\(["']?(.*?)["']?\)$/)?.[1];
    if (!url) return null;
    const img = new Image();
    img.src = url;
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight };
  });
  assert.deepEqual(wordmarkAsset, { width: 432, height: 285 }, 'bundled signature artwork loads without a local font');
  await capture('01-launcher');
  await page.setViewportSize({ width: 2560, height: 1440 });
  await assertLauncherGeometry();
  await capture('01-launcher-wide');
  await page.setViewportSize({ width: 1440, height: 900 });
  await landing.getByRole('button', { name: 'Vault', exact: true }).click();
  const vault = page.locator('[data-page="vault"]');
  await vault.waitFor();
  assert.equal(await vault.locator('[data-ui="tsugi-desktop-rail"] [aria-current="page"]').getAttribute('aria-label'), 'Vault');
  assert.equal(await vault.locator('.tsugi-landscape-fallback').count(), 0);
  const glyphs=await vault.locator('[data-ui="tsugi-desktop-rail"] button[aria-label]').evaluateAll(nodes=>nodes.flatMap(node=>{
    if(!['Movies & TV','Music','Read','Vault','App settings'].includes(node.getAttribute('aria-label')))return [];
    const svg=node.querySelector('svg');if(!svg)return [];
    const b=svg.getBBox();
    return [{label:node.getAttribute('aria-label'),width:b.width,height:b.height,stroke:svg.getAttribute('stroke-width'),fill:svg.getAttribute('fill')}];
  }));
  assert.equal(glyphs.length,5);
  for(const label of ['Vault','App settings']){
    const glyph=glyphs.find(g=>g.label===label);
    assert.equal(glyph.stroke,'1.7');
    assert.equal(glyph.fill,'none');
    assert.ok(glyph.width<=18.1&&glyph.height<=17.5&&glyph.width>=13&&glyph.height>=13,label+' must match existing compact outline proportions');
  }
  await vault.getByRole('region',{name:'Getting started with Vault'}).waitFor();
  assert.equal(await vault.locator('.tsugi-vault-intake').count(),1);
  assert.deepEqual(heroRequests,[],'Vault does not fetch remote decorative artwork');
  await capture('01-vault-onboarding');
  await vault.getByRole('button',{name:'Got it',exact:true}).click();
  assert.equal(await vault.getByRole('region',{name:'Getting started with Vault'}).count(),0);
  assert.equal(await page.evaluate(()=>localStorage.getItem('tsugi.vault.intro')),'seen');
  await vault.getByRole('button',{name:'How it works',exact:true}).click();
  await vault.getByRole('region',{name:'Getting started with Vault'}).waitFor();
  await vault.getByRole('button',{name:'Got it',exact:true}).click();
  await capture('01-vault');
  await vault.getByRole('button', { name: 'All media', exact: true }).click();
  await landing.waitFor();
  await landing.getByRole('button', { name: 'Movies & TV', exact: true }).click();
  const entry = page.locator('.tsugi-video-entry');
  const field = entry.getByRole('textbox', { name: /Server address/ });
  await field.waitFor();
  await page.locator('.tsugi-index-pattern').waitFor({ state: 'detached' });
  await field.focus();
  assert.equal(await field.evaluate((node) => getComputedStyle(node).outlineColor), 'rgb(213, 213, 220)');
  assert.equal(await field.evaluate((node) => getComputedStyle(node).borderRadius), '8px');
  assert.equal(await entry.locator('[data-ui="auth-card"]').evaluate((node) => getComputedStyle(node).borderRadius), '0px');
  assert.equal(await entry.locator('[data-ui="auth-card"]').evaluate((node) => getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0)');
  assert.equal(await entry.locator('[data-ui="auth-card"]').evaluate(node=>getComputedStyle(node).boxShadow),'none');
  const entryAtmosphere = entry.locator('.tsugi-atmosphere[data-placement="entry"]');
  assert.equal(await entryAtmosphere.getAttribute('aria-hidden'), 'true');
  assert.equal(await entryAtmosphere.evaluate(node => getComputedStyle(node).pointerEvents), 'none');
  assert.ok((await entryAtmosphere.locator('.tsugi-brand-wordmark').boundingBox()).width > 240);
  assert.equal(await entryAtmosphere.locator('svg').count(),0,'only signature text in background');
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
  console.log('PASS: atmospheric movie entry, matte panel, aligned foreground brand and palette-independent field focus.');
  await page.getByRole('button', { name: 'App settings', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Carbon', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.tsugiTheme === 'carbon' && document.documentElement.style.getPropertyValue('--background') === document.documentElement.style.getPropertyValue('--tsugi-canvas'));
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('[data-page="desktop-landing"]').getByRole('button', { name: 'Read', exact: true }).click();
  const rail = page.locator('.tsugi-reading-rail');
  const readMedia = page.locator('.tsugi-read-media-header');
  const railGeometry = async (locator) => locator.evaluate(node => {
    const rect = node.getBoundingClientRect();
    const media = node.querySelector('.tsugi-rail-media');
    const controls = [...media.querySelectorAll('button')].map(button => {
      const r = button.getBoundingClientRect();
      return [Math.round(r.x - rect.x), Math.round(r.y - rect.y), Math.round(r.width), Math.round(r.height)];
    });
    const rule = getComputedStyle(node.querySelector('.tsugi-pixel-rule'));
    return { width: Math.round(rect.width), top: Math.round(rect.y), controls, font: getComputedStyle(node).fontFamily, border: getComputedStyle(node).borderInlineEndWidth, separator: rule.backgroundImage.split('repeating-linear-gradient').length - 1 };
  });
  await rail.waitFor({ state: 'visible' });
  const readRailGeometry = await railGeometry(rail);
  assert.equal(readRailGeometry.width, 80);
  assert.equal(readRailGeometry.border, '0px');
  assert.ok(readRailGeometry.font.startsWith('Inter'));
  assert.equal(readRailGeometry.separator, 2);
  assert.equal(await page.locator('html').getAttribute('data-tsugi-accent'), 'amber');
  await rail.getByRole('button', { name: 'App settings', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Carbon', exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog').getByRole('button', { name: 'Carbon', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('dialog').getByRole('button', { name: 'Mocha', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.tsugiTheme === 'mocha');
  await page.getByRole('dialog').getByRole('button', { name: 'Default', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  assert.equal(await page.locator('[data-page="read"]').evaluate(node => getComputedStyle(node).fontFamily), dialogFont);
  await page.locator('.tsugi-library-grid-heading').waitFor();
  assert.equal(await page.locator('.tsugi-library-grid-heading > span').textContent(), '2');
  await capture('03-reading-library');
  assert.deepEqual(coverQueries, []);
  await rail.getByRole('button', { name: 'Categories', exact: true }).click();
  await page.getByRole('textbox', { name: 'New category', exact: true }).fill('Seinen');
  await page.getByRole('button', { name: 'Create category', exact: true }).click();
  await page.getByRole('heading', { name: 'Seinen', exact: true }).waitFor();
  await page.getByRole('checkbox', { name: 'Tsugi Original Fixture', exact: true }).check();
  await page.getByRole('button', { name: 'Open shelf', exact: true }).click();
  await page.locator('.tsugi-library-grid-heading').waitFor();
  assert.equal(await page.locator('.tsugi-manga-card').count(), 1);
  await page.getByRole('button', { name: 'All shelves', exact: true }).click();
  assert.equal(await page.locator('.tsugi-manga-card').count(), 2);
  await rail.getByRole('button', { name: 'Categories', exact: true }).click();
  await page.getByRole('textbox', { name: 'Category name', exact: true }).fill('Manga shelf');
  await page.getByRole('button', { name: 'Rename category', exact: true }).click();
  await page.getByRole('heading', { name: 'Manga shelf', exact: true }).waitFor();
  await capture('03-reader-categories');
  await page.getByRole('button', { name: 'Delete category', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm category deletion', exact: true }).click();
  await page.getByRole('heading', { name: 'Organize your collection', exact: true }).waitFor();
  await rail.getByRole('button', { name: 'History', exact: true }).click();
  await page.locator('.tsugi-reader-activity-row').first().waitFor();
  await capture('03-reader-history');
  await rail.getByRole('button', { name: 'Chapter updates', exact: true }).click();
  await page.locator('.tsugi-reader-activity-row').first().waitFor();
  await page.getByRole('button', { name: 'Check for chapters', exact: true }).click();
  await page.getByText('Checking library', { exact: true }).waitFor();
  await page.getByText('Library update idle', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__readerFixture.updateChecks), 1);
  await capture('03-reader-updates');
  await rail.getByRole('button', { name: 'Library', exact: true }).click();
  await page.locator('.tsugi-manga-card').first().waitFor();
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
  await page.setViewportSize({ width: 2560, height: 1440 });
  const musicRailGeometry = await railGeometry(music.locator('[data-ui="tsugi-desktop-rail"]'));
  assert.deepEqual(musicRailGeometry, readRailGeometry, 'Music and Read share exact media rail geometry and typography');
  const musicSettings = music.getByRole('dialog', { name: 'Music sources' });
  if (!(await musicSettings.isVisible())) await music.getByRole('button', { name: 'Music sources', exact: true }).click();
  await musicSettings.waitFor();
  const drawer = await musicSettings.boundingBox();
  const backdrop = await music.locator('.tsugi-source-backdrop').boundingBox();
  // Measure the fixed-position containing block independently of the drawer.
  // Chromium can report the nominal clientWidth despite a reserved scrollbar.
  const fixedViewport = await page.evaluate(() => {
    const probe = document.createElement('div');
    Object.assign(probe.style, { position: 'fixed', inset: '0', visibility: 'hidden', pointerEvents: 'none' });
    document.body.appendChild(probe);
    const { x, y, width, height, right } = probe.getBoundingClientRect();
    probe.remove();
    return { x, y, width, height, right, nominal: window.innerWidth };
  });
  const geometry = JSON.stringify({ drawer, backdrop, fixedViewport });
  assert.ok(fixedViewport.nominal - fixedViewport.right >= -1 && fixedViewport.nominal - fixedViewport.right <= 9, 'fixed viewport excludes at most the 8px scrollbar: ' + geometry);
  assert.ok(Math.abs(drawer.x + drawer.width - fixedViewport.right) < 2, 'music sources drawer is flush to the fixed viewport edge: ' + geometry);
  assert.ok(['x', 'y', 'width', 'height'].every(key => Math.abs(backdrop[key] - fixedViewport[key]) < 2), 'music sources backdrop covers the fixed viewport: ' + geometry);
  assert.ok((await music.locator('.tsugi-music-workspace').boundingBox()).width > 2400, 'wide desktop music workspace uses the canvas');
  await capture('10-wide-music-sources');
  await page.setViewportSize({ width: 1440, height: 900 });
  if (await musicSettings.isVisible()) await musicSettings.getByRole('button', { name: 'Close', exact: true }).click();
  await music.getByRole('button', { name: 'Library', exact: true }).click();
  await music.getByRole('heading',{name:'Your music, organized.',exact:true}).waitFor();
  assert.equal(await music.locator('.tsugi-atmosphere[data-placement="library"]').count(),0);
  await capture('06-music-library-overview');
  await music.getByRole('navigation',{name:'Music collection'}).getByRole('button',{name:/Local music/}).click();
  await music.getByRole('textbox',{name:'Find tracks',exact:true}).waitFor();
  const musicLibraryGlyph = await music.getByRole('navigation', { name: 'Music sections' }).getByRole('button', { name: 'Library', exact: true }).locator('svg path').first().getAttribute('d');
  const readerGlyph = await music.getByRole('button', { name: 'Read', exact: true }).locator('svg path').first().getAttribute('d');
  assert.notEqual(musicLibraryGlyph, readerGlyph, 'music library and reading category use distinct glyphs');
  await capture('06-music-library-empty');
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
  await music.getByRole('button', { name: 'Music sources', exact: true }).click();
  await musicSettings.getByRole('button', { name: 'Connect YouTube Music', exact: true }).click();
  await music.getByRole('button', { name: 'Discover', exact: true }).click();
  await music.getByRole('heading', { name: 'Native fixture track', exact: true }).waitFor();
  assert.equal(await music.getByRole('heading', { name: 'Discover', exact: true }).count(), 1);
  await music.locator('.tsugi-catalog-lane').filter({ hasText: 'Fixture recommendations' }).waitFor();
  await page.setViewportSize({ width: 2560, height: 1440 });
  assert.ok((await music.locator('.tsugi-music-workspace').boundingBox()).width > 2400);
  await capture('09-music-discover-wide');
  await page.setViewportSize({ width: 1440, height: 900 });
  await capture('09-music-discover');
  await music.getByRole('navigation', { name: 'Music sections' }).getByRole('button', { name: 'Search', exact: true }).click();
  await music.getByRole('textbox', { name: 'Search music', exact: true }).fill('Native fixture track');
  await music.getByRole('button', { name: 'Search', exact: true }).last().click();
  await music.getByRole('button', { name: /Fixture playlist/ }).click();
  const detail = page.getByRole('dialog', { name: 'Music collection', exact: true });
  await detail.getByRole('heading', { name: 'Fixture playlist', exact: true }).waitFor();
  await detail.getByRole('button', { name: 'Play all', exact: true }).waitFor();
  assert.equal(await detail.locator('.tsugi-atmosphere').count(),0);
  const trackBounds = await detail.getByRole('region', { name: 'Collection tracks' }).boundingBox();
  assert.ok(trackBounds.width>1200);
  const trackGrid=detail.locator('.tsugi-music-detail-track-grid');
  assert.equal(await trackGrid.evaluate(node=>getComputedStyle(node).gridTemplateColumns.split(' ').length),2);
  await page.setViewportSize({width:800,height:900});
  assert.equal(await trackGrid.evaluate(node=>getComputedStyle(node).gridTemplateColumns.split(' ').length),1);
  await page.setViewportSize({width:1440,height:900});
  await detail.getByRole('textbox',{name:'Find collection tracks'}).fill('Collection track 12');
  assert.equal(await detail.locator('.tsugi-music-detail-track').count(),1);
  await detail.getByRole('textbox',{name:'Find collection tracks'}).fill('');
  await capture('11-music-collection-redesign');
  await detail.getByRole('button', { name: 'Back to music', exact: true }).click();
  await detail.waitFor({ state: 'detached' });
  await music.getByRole('button',{name:'Send track to Vault',exact:true}).click();
  const selectedVaultQueue=vault.locator('[data-ui="tsugi-native-vault-queue"]');
  await selectedVaultQueue.getByRole('textbox',{name:'YouTube Music track link'}).waitFor();
  assert.equal(await selectedVaultQueue.getByRole('textbox',{name:'YouTube Music track link'}).inputValue(),'https://www.youtube.com/watch?v=abcdefghijk');
  const queueTrack=selectedVaultQueue.getByRole('button',{name:'Queue local download'});
  assert.equal(await queueTrack.isEnabled(),false,'permission is required before export');
  await selectedVaultQueue.getByRole('checkbox',{name:/I have permission/}).check();
  await queueTrack.click();
  await selectedVaultQueue.getByText('Native fixture track - abcdefghijk.m4a',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__readerFixture.vaultRequests[0].jobs[0].files[0].url),'https://www.youtube.com/watch?v=abcdefghijk');
  await selectedVaultQueue.getByRole('button',{name:'Batch links',exact:true}).click();
  await selectedVaultQueue.getByLabel('Download links (one per line)').fill('https://example.org/first.epub\nhttps://example.org/second.mp3\nhttps://youtu.be/abcdefghijk');
  await selectedVaultQueue.getByRole('checkbox',{name:/I have permission/}).check();
  await selectedVaultQueue.getByRole('button',{name:'Add batch to queue',exact:true}).click();
  await selectedVaultQueue.getByText('second.mp3',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__readerFixture.vaultRequests[1].jobs.length),3);
  await selectedVaultQueue.getByText('Transfer settings',{exact:true}).click();
  await selectedVaultQueue.getByLabel('Simultaneous local downloads').selectOption('4');
  await page.waitForFunction(()=>window.__readerFixture.vaultConcurrent===4);
  await selectedVaultQueue.getByLabel('Local transfer speed limit (MiB/s)').selectOption('2');
  await page.waitForFunction(()=>window.__readerFixture.vaultRate===2);
  await selectedVaultQueue.getByRole('button',{name:'Refresh local downloads',exact:true}).click();
  assert.equal(await selectedVaultQueue.getByLabel('Local transfer speed limit (MiB/s)').inputValue(),'2');
  await selectedVaultQueue.getByLabel('Local transfer speed limit (MiB/s)').selectOption('0');
  await page.waitForFunction(()=>window.__readerFixture.vaultRate===0);
  console.log('PASS: Vault accepts mixed independent batch jobs and configures shared native concurrency.');
  await selectedVaultQueue.getByText('Managed engine ready',{exact:true}).waitFor();
  await selectedVaultQueue.getByText('Transfer settings',{exact:true}).click();
  await selectedVaultQueue.getByRole('group',{name:'Download destination'}).getByRole('button',{name:/TorBox/}).click();
  const cloud=selectedVaultQueue.locator('[data-ui="tsugi-torbox"]');
  await cloud.getByLabel('TorBox API key').fill('fixture-key');
  await cloud.getByRole('button',{name:'Connect TorBox',exact:true}).click();
  await cloud.getByLabel('Cloud download URL').waitFor();
  assert.equal(await cloud.getByText('Fixture cloud archive.zip',{exact:true}).count(),0,'never render account inventory');
  assert.equal(await cloud.getByRole('table').count(),0);
  assert.equal(await page.evaluate(()=>window.__readerFixture.torboxOperations.includes('list')),false,'no automatic cloud inventory request');
  await capture('12-vault-torbox');
  await cloud.getByLabel('Cloud download URL').fill('https://example.org/fixture.zip');
  await cloud.getByRole('checkbox',{name:/I have permission/}).check();
  await cloud.getByRole('button',{name:'Send to TorBox',exact:true}).click();
  await cloud.getByText('Sent to TorBox. Follow the transfer in your TorBox dashboard.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__readerFixture.torboxLink),'https://example.org/fixture.zip');
  assert.equal(await page.evaluate(()=>window.__readerFixture.torboxOperations.includes('list')),false);
  await cloud.getByText('Account',{exact:true}).click();
  await cloud.getByRole('button',{name:'Disconnect TorBox',exact:true}).click();
  await cloud.getByRole('button',{name:'Connect TorBox',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__readerFixture.torboxConnected),false);
  await selectedVaultQueue.getByRole('group',{name:'Download destination'}).getByRole('button',{name:/This PC/}).click();
  await selectedVaultQueue.getByRole('button',{name:/^All downloads/}).click();
  await selectedVaultQueue.getByText('second.mp3',{exact:true}).waitFor();
  await vault.locator('[data-ui="tsugi-desktop-rail"]').getByRole('button',{name:'Music',exact:true}).click();
  await music.locator('[data-ui="music-track-row"]').filter({ hasText: 'Native fixture track' }).click();
  await page.waitForFunction(() => window.__readerFixture.nativeMessages.some(m => m.type === 'music-audio-load'));
  await music.getByRole('button',{name:'Download track',exact:true}).click();
  const downloadDialog=page.getByRole('dialog',{name:'Download track',exact:true});
  await downloadDialog.getByRole('checkbox',{name:/I have permission/}).check();
  await downloadDialog.getByRole('button',{name:'Download',exact:true}).click();
  await downloadDialog.getByText('Added to Vault. You can follow the download there.',{exact:true}).waitFor();
  await downloadDialog.getByRole('button',{name:'Send to TorBox',exact:true}).click();
  await downloadDialog.getByLabel('TorBox API key').fill('fixture-key');
  await downloadDialog.getByRole('button',{name:'Connect TorBox'}).click();
  await downloadDialog.getByRole('checkbox',{name:/I have permission/}).check();
  await downloadDialog.locator('[data-ui="tsugi-torbox"]').getByRole('button',{name:'Send to TorBox',exact:true}).click();
  await downloadDialog.getByText('Sent to TorBox. Follow the transfer in your TorBox dashboard.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__readerFixture.torboxLink),'https://www.youtube.com/watch?v=abcdefghijk');
  await downloadDialog.getByRole('button',{name:'Close',exact:true}).click();
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
  await expanded.locator('img[src*="tsugi-fixture=w544-h544"]').waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.tsugi-player-dialog img')].some(img => img.src.includes('tsugi-fixture=w544-h544') && img.complete && img.naturalWidth > 0));
  assert.ok(artworkRequests.some(url => url.endsWith('=w1024-h1024')), 'expanded player requests a larger original');
  for (const layout of ['default', 'junction', 'nocturne']) {
    await expanded.getByRole('button', { name: 'Player settings', exact: true }).click();
    const settings = expanded.getByRole('dialog', { name: 'Player settings' });
    const headerToggle = settings.getByRole('checkbox', { name: 'Show player header' });
    assert.equal(await headerToggle.evaluate(node => getComputedStyle(node).borderRadius), '5px');
    const headerWasChecked = await headerToggle.isChecked();
    await headerToggle.click();
    assert.equal(await headerToggle.isChecked(), !headerWasChecked);
    await headerToggle.click();
    assert.equal(await headerToggle.isChecked(), headerWasChecked);
    await settings.getByRole('combobox', { name: 'Player layout' }).selectOption(layout);
    await settings.getByRole('button', { name: 'Close', exact: true }).click();
    const stage = expanded.locator('[data-layout="' + layout + '"]');
    await stage.waitFor();
    assert.equal(await expanded.getByRole('button', { name: 'Minimise player', exact: true }).count(), 1);
    assert.equal(await expanded.getByRole('button', { name: 'Player settings', exact: true }).count(), 1);
    assert.equal(await stage.getByRole('button', { name: 'Next track', exact: true }).count(), 1);
    assert.equal(await stage.getByRole('button', { name: 'Previous track', exact: true }).count(), 1);
    const columns = await stage.evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length);
    assert.equal(columns, layout === 'default' ? 1 : 2);
    assert.equal(await stage.locator('.tsugi-nocturne-backdrop').count(), layout === 'nocturne' ? 1 : 0);
    await capture('08-expanded-' + layout);
  }
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
  await page.evaluate(() => { window.__readerFixture.transferEnabled = true; });
  await mediaNav.getByRole('button', { name: 'Read', exact: true }).click();
  await rail.waitFor();
  await rail.getByRole('button', { name: 'Migrate', exact: true }).click();
  await page.getByRole('combobox', { name: 'Original title', exact: true }).selectOption('1');
  await page.getByRole('combobox', { name: 'Replacement source', exact: true }).selectOption('67890');
  await page.getByRole('button', { name: 'Search replacement', exact: true }).click();
  await page.locator('.tsugi-transfer-workspace').getByRole('button', { name: /Tsugi Original Fixture/ }).click();
  await page.getByRole('heading', { name: 'Transfer preview', exact: true }).waitFor();
  await capture('10-reader-migration');
  await page.getByRole('button', { name: 'Copy progress and keep original', exact: true }).click();
  await page.getByText(/Replacement verified. Original retained/).waitFor();
  assert.ok(await page.evaluate(() => window.__readerFixture.requests.some(a => a.kind === 'set-library' && a.id === 3 && a.inLibrary)));
  assert.equal(await page.evaluate(() => window.__readerFixture.requests.some(a => a.kind === 'set-library' && a.id === 1 && !a.inLibrary)), false);
  await rail.getByRole('button', { name: 'Batch Add', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search source', exact: true }).selectOption('67890');
  await page.getByRole('textbox', { name: 'Titles to import', exact: true }).fill('Batch Fixture\nBatch Fixture\nTsugi Original Fixture');
  await page.getByRole('button', { name: 'Find matches', exact: true }).click();
  await page.getByText('Search complete. Review the matches before adding.', { exact: true }).waitFor();
  assert.equal(await page.locator('.tsugi-batch-row').count(), 2);
  await capture('11-reader-batch');
  await page.getByRole('button', { name: 'Add reviewed titles (1)', exact: true }).click();
  await page.getByText('1 titles added. Existing entries were not overwritten.', { exact: true }).waitFor();
  assert.ok(await page.evaluate(() => window.__readerFixture.requests.some(a => a.kind === 'set-library' && a.id === 4 && a.inLibrary)));
  assert.deepEqual(errors, []);
  console.log('PASS: migration preview preserves original; reviewed batch import skips duplicate titles.');
  // Real local book files, actual renderer, and real browser IndexedDB.
  await rail.getByRole('button', {name:'Books', exact:true}).click();
  const books = page.locator('[data-page="books"]');
  await books.waitFor();
  await books.getByLabel('Choose ebook files').setInputFiles([
    {name:'Tsugi PDF Fixture.pdf',mimeType:'application/pdf',buffer:pdfFixture()},
    {name:'Tsugi EPUB Fixture.epub',mimeType:'application/epub+zip',buffer:epubFixture()},
  ]);
  await books.locator('.tsugi-manga-card').filter({hasText:'Tsugi PDF Fixture'}).click();
  await books.getByRole('button',{name:'Read book',exact:true}).click();
  const bookReader=books.locator('[data-ui="tsugi-book-reader"]');
  await bookReader.getByRole('button',{name:'Next page',exact:true}).waitFor();
  const bookFrame=bookReader.frameLocator('iframe');
  await bookFrame.locator('canvas').waitFor({timeout:30000});
  await bookReader.locator('[data-ui="book-progress"]').getByText('50%',{exact:true}).waitFor();
  assert.equal(await bookReader.locator('iframe').evaluate(el=>{
    try { return !!el.contentWindow.document; } catch { return false; }
  }),false,'ebook document is cross-origin from privileged page');
  const frame=page.frames().find(f=>f.url().startsWith('http://localhost:4179/tsugi-books/index.html'));
  assert.ok(frame);
  assert.equal(await frame.evaluate(()=>typeof window.aiostreamsApp),'undefined','desktop bridge absent from ebook origin');
  await bookReader.getByRole('button',{name:'Next page',exact:true}).click();
  await bookReader.locator('[data-ui="book-progress"]').getByText('100%',{exact:true}).waitFor();
  await capture('12-book-pdf');
  await bookReader.getByRole('button',{name:'Back to books',exact:true}).click();
  await books.locator('.tsugi-manga-card').filter({hasText:'Tsugi PDF Fixture'}).locator('img').waitFor();
  await books.locator('.tsugi-manga-card').filter({hasText:'Tsugi PDF Fixture'}).click();
  await books.getByRole('button',{name:'Resume reading',exact:true}).click();
  await bookReader.getByRole('spinbutton',{name:'Page',exact:false}).waitFor();
  assert.equal(await bookReader.getByRole('spinbutton').inputValue(),'2');
  await bookReader.getByRole('button',{name:'Back to books',exact:true}).click();
  await books.locator('.tsugi-manga-card').filter({hasText:'Tsugi EPUB Fixture'}).click();
  await books.getByRole('button',{name:'Read book',exact:true}).click();
  await bookReader.getByRole('combobox',{name:'Contents',exact:true}).waitFor({timeout:30000});
  const epubFrame=page.frames().find(f=>f.url().startsWith('http://localhost:4179/tsugi-books/index.html'));
  assert.ok(epubFrame);
  await epubFrame.waitForFunction(()=>document.querySelector('foliate-view')?.renderer?.getContents?.().some(item=>item.doc?.body?.textContent.includes('Original words for the first chapter.')));
  assert.equal(await epubFrame.evaluate(()=>document.querySelector('foliate-view').renderer.getContents().some(item=>item.doc?.body?.hasAttribute('data-unsafe-script-ran'))),false);
  await bookReader.getByRole('combobox',{name:'Contents',exact:true}).selectOption({label:'Chapter two'});
  await epubFrame.waitForFunction(()=>document.querySelector('foliate-view')?.renderer?.getContents?.().some(item=>item.doc?.body?.textContent.includes('Original words for the second chapter.')));
  await bookReader.getByRole('combobox',{name:'Paper',exact:true}).selectOption('paper');
  await capture('13-book-epub');
  await bookReader.getByRole('button',{name:'Back to books',exact:true}).click();
  // Reload the actual application, re-enter Read/Books, and check saved file
  // metadata and PDF page survive a full page reload.
  await page.reload({waitUntil:'domcontentloaded'});
  await landing.getByRole('button',{name:'Read',exact:true}).click();
  await page.locator('[data-page="read"] .tsugi-reading-rail').getByRole('button',{name:'Books',exact:true}).click();
  await books.locator('.tsugi-manga-card').filter({hasText:'Tsugi Original EPUB'}).waitFor();
  await books.locator('.tsugi-manga-card').filter({hasText:'Tsugi PDF Fixture'}).click();
  await books.getByRole('button',{name:'Resume reading',exact:true}).click();
  await bookReader.getByRole('spinbutton').waitFor();
  assert.equal(await bookReader.getByRole('spinbutton').inputValue(),'2');
  await bookReader.getByRole('button',{name:'Back to books',exact:true}).click();
  console.log('PASS: real isolated local EPUB/PDF rendering, disabled book scripts and persistent PDF resume.');
  // Test the actual Vault UI and browser storage, with a synthetic native file response.
  await page.route('**/__tsugi_vault/file/vault-fixture-pdf', async route=>{
    assert.equal(route.request().headers()['x-tsugi-vault-import'],'1');
    await route.fulfill({contentType:'application/pdf',body:pdfFixture()});
  });
  await page.route('**/__tsugi_vault/file/vault-fixture-audio', async route=>{
    assert.equal(route.request().headers()['x-tsugi-vault-import'],'1');
    await route.fulfill({contentType:'audio/wav',body:wav});
  });
  await page.evaluate(()=>{
    window.__readerFixture.vaultJobs=[
      {id:'vault-fixture-pdf',state:'done',bytes:900,total:900,error:null,vault_title:'Vault imported fixture.pdf'},
      {id:'vault-fixture-audio',state:'done',bytes:1024,total:1024,error:null,vault_title:'Vault imported audio.wav'},
    ];
  });
  await books.locator('[data-ui="tsugi-desktop-rail"]').getByRole('button',{name:'Vault',exact:true}).click();
  const nativeQueue=vault.locator('[data-ui="tsugi-native-vault-queue"]');
  await nativeQueue.getByRole('button',{name:'Import into Books',exact:true}).click();
  await books.locator('.tsugi-manga-card').filter({hasText:'Vault imported fixture'}).waitFor();
  await books.locator('[data-ui="tsugi-desktop-rail"]').getByRole('button',{name:'Vault',exact:true}).click();
  await nativeQueue.getByRole('button',{name:'Import into Books',exact:true}).click();
  await books.locator('.tsugi-manga-card').filter({hasText:'Vault imported fixture'}).waitFor();
  assert.equal(await books.locator('.tsugi-manga-card').filter({hasText:'Vault imported fixture'}).count(),1);
  await books.locator('[data-ui="tsugi-desktop-rail"]').getByRole('button',{name:'Vault',exact:true}).click();
  await nativeQueue.getByRole('button',{name:'Open in Music',exact:true}).click();
  await music.getByText('Vault imported audio',{exact:true}).waitFor();
  console.log('PASS: completed Vault file import into persistent Books and session Music; duplicate book guarded.');
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
