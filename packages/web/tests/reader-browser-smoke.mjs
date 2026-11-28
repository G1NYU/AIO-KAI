// Browser-level test using the real standalone Tsugi web application and
// an original, deterministic fake native bridge. No external manga source,
// desktop EXE, Java download, user credentials or package artifact is used.
import assert from 'node:assert/strict';
import { pdfFixture, epubFixture } from './ebook-fixtures.mjs';
import { verifyAppSeparatorsBrowser } from './app-separators-browser.mjs';
import { verifyMoviesLayoutBrowser } from './movies-layout-browser.mjs';
import { verifyMusicAudioBrowser } from './music-audio-browser.mjs';
import { verifyUpNextBrowser } from './up-next-browser.mjs';
import { verifyMusicReactivityBrowser } from './music-reactivity-browser.mjs';
import { verifyMusicArtworkBrowser } from './music-artwork-browser.mjs';
import { verifyMusicPlayerLayoutBrowser } from './music-player-layout-browser.mjs';
import { verifyMusicLyricsBrowser } from './music-lyrics-browser.mjs';
import { verifyBrushHeadingsBrowser } from './brush-headings-browser.mjs';
import { verifyRestoreSessionBrowser } from './restore-session-browser.mjs';
import { verifyExtensionUpdatesBrowser } from './extension-updates-browser.mjs';
import { verifyMihonImportBrowser } from './mihon-import-browser.mjs';
import { verifyMalMangaBrowser } from './mal-manga-browser.mjs';
import { verifyMihonReconstructionBrowser } from './mihon-reconstruction-browser.mjs';
import { verifyDiscordPresenceBrowser } from './discord-presence-browser.mjs';
import { verifyYouTubeSessionBrowser } from './youtube-session-browser.mjs';
import { verifySoundCloudBrowser } from './soundcloud-browser.mjs';
import { verifyDownloadCleanupBrowser, verifyReaderReleaseBrowser } from './download-cleanup-browser.mjs';
import { verifyReaderCacheCleanupBrowser } from './reader-cache-cleanup-browser.mjs';
import { verifySourceFeedBrowser } from './source-feed-browser.mjs';
import { verifySourceMetadataBrowser } from './source-metadata-browser.mjs';
import { verifySourceSettingsBrowser } from './source-settings-browser.mjs';
import { verifySourceIconsBrowser } from './source-icons-browser.mjs';
import { verifyReaderSettingsSearchBrowser } from './reader-settings-search-browser.mjs';
import { verifyReaderRepositoriesBrowser } from './reader-repositories-browser.mjs';
import { verifySupportSummaryBrowser } from './support-summary-browser.mjs';
import { verifyReaderDownloadsBrowser } from './reader-downloads-browser.mjs';
import { verifyLocalComicImportBrowser } from './local-comic-import-browser.mjs';
import { verifyStremioAddonsBrowser } from './stremio-addons-browser.mjs';
import { verifyVaultAudioImportsBrowser } from './vault-audio-import-browser.mjs';
import { verifyVaultBookImportsBrowser } from './vault-book-import-browser.mjs';
import { verifyLandscapeDecorationBrowser } from './landscape-decoration-browser.mjs';
import { pathToFileURL } from 'node:url';
import { mkdir, readFile } from 'node:fs/promises';
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
  function installDesktopFixture() {
    if (window.top !== window) return;
    const listeners = new Set();
    const manga = { id: '1', title: 'Tsugi Original Fixture', author: 'Tsugi', thumbnailUrl: '/api/v1/manga/1/thumbnail', inLibrary: true, unreadCount: 2, description: '**Original fixture** for reader tests.', genre: ['Adventure'] };
    const chapters = [{ id: 11, name: 'Chapter 1', chapterNumber: 1, scanlator: 'Original', isRead: false, lastPageRead: 0, pageCount: 4 }, { id: 12, name: 'Chapter 2', chapterNumber: 2, scanlator: 'Original', isRead: false, lastPageRead: 0, pageCount: 4 }];
    manga.categories = { nodes: [] };
    manga.sourceId = '12345';
    manga.readerIdentity = '1'.padStart(64,'0');
    const replacement = { id: '3', sourceId: '67890', readerIdentity: '3'.padStart(64,'0'), title: 'Tsugi Original Fixture', author: 'Tsugi', inLibrary: false, categories: { nodes: [] } };
    const replacementChapters = [{ id: 31, name: 'Chapter 1', chapterNumber: 1, isRead: false, isBookmarked: false, lastPageRead: 0, pageCount: 4 }];
    const batchTitle = { id: '4', sourceId: '67890', title: 'Batch Fixture', author: 'Tsugi', inLibrary: false, categories: { nodes: [] } };
    const state = window.__readerFixture = { requests: [], lastPath: '', serial: 0, installed: false, stores: [], progress: [], nativeMessages: [], nativeRequest: null, vaultJobs: [], vaultRequests: [], categories: [], categorySequence: 0, updateChecks: 0 };
    state.enableMigrationPages = () => {
      state.migrationPages = true;
      Object.assign(chapters[0], { isRead: false, lastPageRead: 2, pageCount: 4 });
      Object.assign(replacementChapters[0], { scanlator: 'Original', isRead: false, lastPageRead: 0, pageCount: 4 });
    };
    const nodes = (items) => ({ nodes: items, totalCount: items.length });
    const emit = (message) => queueMicrotask(() => { for (const listener of listeners) listener(message); });
    state.emitLink = url => emit({ type: 'link', url });
    window.aiostreamsApp = {
      protocol: 2, version: 'fixture', platform: 'windows', reading: !new URLSearchParams(location.search).has('readerSetup'), readingSetup: true, backupStore: true, tsugiReleaseCheck: true, youtubeMusic: true, nativeMusicAudio: true, torbox: true, device: 'Fixture',
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      send(message) {
        if(message.type==='tsugi-release-check'){
          const data={latestTag:'v0.1.0',latestCommit:'a'.repeat(40),currentCommit:'c'.repeat(40),status:'different-build',packageBytes:173235714,sha256:'b'.repeat(64),notes:'Fixture release notes'};
          emit({type:'tsugi-release-result',request:message.request,data,error:null});return;
        }
        if(message.type==='backup-request'){
          const a=message.action;
          const backups=state.managedBackups??=([]);
          let data,error=null;
          if(a.kind==='save'||a.kind==='save-scheduled'){
            const createdMs=1760000000000+backups.length;
            const name=(a.kind==='save-scheduled'?'tsugi-auto-backup-':'tsugi-backup-')+createdMs+'-'+(backups.length+1).toString(16).padStart(32,'0')+'.json';
            const row={name,createdMs,bytes:new TextEncoder().encode(a.archive).length,readable:true};
            backups.push({row,archive:a.archive});data=a.kind==='save-scheduled'?{backup:row,removed:0,retentionIncomplete:false}:row;
          }else if(a.kind==='storage')data={rows:['backups','reader','webview','logs','downloads','other',...(a.detailed?['readerChapters','readerCache','webCache']:[])].map((kind,i)=>({kind,bytes:1024*(i+1),files:1,skipped:i===2?1:0,complete:i!==2}))};
          else if(a.kind==='list')data={folder:'C:/Fixture/data/backups',backups:backups.map(item=>item.row)};
          else if(a.kind==='open'){
            const item=backups.find(item=>item.row.name===a.name);
            if(item)data={archive:item.archive};else error='missing';
          }else error='unsupported';
          emit({type:'backup-result',request:message.request,data,error});return;
        }
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
          } else if (message.request === state.nativeRequest && message.action === 'dsp') {
            emit({ type: 'music-audio-dsp', request: message.request, error: null });
            if ((message.value & 8) !== 0) emit({type:'music-audio-meter',request:message.request,level:.72});
          } else if (message.action === 'stop') state.nativeRequest = null;
          return;
        }
        if (message.type !== 'read-request') return;
        const a = message.action;
        state.requests.push(a);
        let data;
        let error = null;
        switch (a.kind) {
          case 'library': data = nodes([state.heroFeatured ? {...manga,lastReadChapter:{...chapters[0],lastReadAt:200}} : manga, { id: '2', title: 'ZZ Missing Fixture', author: 'Tsugi', inLibrary: true, unreadCount: 0, ...(state.heroFeatured?{lastReadChapter:{...chapters[0],id:21,lastReadAt:100}}:{}) }, ...(state.titleSettingsFixture ? [{...replacement,title:'Second reader fixture',inLibrary:true}] : [replacement, batchTitle].filter(item => item.inLibrary))]); break;
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
          case 'assign-category': {
            const target=[manga,replacement,batchTitle].find(item=>Number(item.id)===a.mangaId);
            if(!target||!state.categories.some(item=>item.id===a.categoryId))throw Error('Unexpected category assignment');
            target.categories.nodes=target.categories.nodes.filter(item=>item.id!==a.categoryId);
            if(a.assigned)target.categories.nodes.push({id:a.categoryId});
            data={manga:target};break;
          }
          case 'delete-category':
            state.categories = state.categories.filter(item => item.id !== a.id);
            for(const target of [manga,replacement,batchTitle])target.categories.nodes=target.categories.nodes.filter(item=>item.id!==a.id);
            data = { category: { id: a.id } }; break;
          case 'history': data = nodes([{ ...chapters[0], ...(state.titleSettingsFixture?{lastPageRead:2,isRead:false}:{}), lastReadAt: 1760000000000, manga }]); break;
          case 'updates': data = nodes([{ ...chapters[1], fetchedAt: 1760000000000, manga }]); break;
          case 'backup-manga': {
            const item=[manga,{id:2,sourceId:'12345',title:'ZZ Missing Fixture'},replacement,batchTitle].find(m=>Number(m.id)===a.id);
            if(!item)throw Error('Missing backup fixture');
            const hash=n=>n.toString(16).padStart(64,'0');
            if (state.migrationPages && [1,3].includes(a.id)) {
              const rows = a.id === 1 ? chapters : replacementChapters;
              data = { id: a.id, identity: hash(a.id), sourceId: item.sourceId, title: item.title,
                categories: state.categories.filter(category=>item.categories?.nodes.some(node=>node.id===category.id)).map(category=>category.name),
                chapters: rows.map(row=>({ id: row.id, identity: hash(row.id), name: row.name, isRead: row.isRead,
                  isBookmarked: !!row.isBookmarked, lastPageRead: row.lastPageRead, pageCount: row.pageCount, lastReadAt: '0' })) };
              break;
            }
            data={id:a.id,identity:hash(a.id),sourceId:item.sourceId,title:item.title,categories:state.categories.filter(category=>item.categories?.nodes.some(node=>node.id===category.id)).map(category=>category.name),chapters:a.id===1?[{id:11,identity:hash(11),name:'Chapter one',isRead:false,isBookmarked:!!state.backupBookmarked,lastPageRead:state.backupPage||0,pageCount:4,lastReadAt:'0'}]:[]};
            break;
          }
          case 'restore-manga-progress': {
            if (state.migrationPages && a.id === 3) {
              const change = a.changes[0], row = replacementChapters[0];
              if (a.identity !== '3'.padStart(64,'0') || a.changes.length !== 1 ||
                  change.identity !== '1f'.padStart(64,'0') || change.page !== 2 ||
                  change.expectedLastPage !== 0 || change.expectedPageCount !== 4 ||
                  change.expectedRead !== false || change.expectedLastReadAt !== '0' ||
                  change.markRead !== false || change.bookmark !== false || row.lastPageRead !== 0)
                throw Error('Unexpected migration page patch');
              row.lastPageRead = change.page;
              data = { confirmed: 1, total: 1, complete: true };
              break;
            }
            if(a.id!==1||a.changes.length!==1||a.changes[0].identity!=='b'.padStart(64,'0'))throw Error('Unexpected restore fixture');
            const change=a.changes[0];
            if(change.bookmark)state.backupBookmarked=true;
            if(change.page!==undefined)state.backupPage=change.page;
            data={confirmed:1,total:1,complete:true};break;
          }
          case 'cached-manga': data = a.id === 3 ? { manga: state.titleSettingsFixture?{...replacement,title:'Second reader fixture',inLibrary:true}:replacement, chapters: replacementChapters } : a.id === 4 ? { manga: batchTitle, chapters: [] } : { manga, chapters: state.titleSettingsFixture ? [{...chapters[0],lastPageRead:2,isRead:false},chapters[1]] : chapters }; break;
          case 'start-library-update': state.updateChecks++; data = { jobsInfo: { isRunning: true, totalJobs: 1, finishedJobs: 0, skippedCategoriesCount: 0, skippedMangasCount: 0 } }; break;
          case 'library-update-status': data = { jobsInfo: { isRunning: false, totalJobs: state.updateChecks ? 1 : 0, finishedJobs: state.updateChecks ? 1 : 0, skippedCategoriesCount: 0, skippedMangasCount: 0 } }; break;
          case 'trackers': data = nodes([{ id: 1, name: 'MyAnimeList', isLoggedIn: !!state.trackerConnected, supportsReadingDates: true, supportsPrivateTracking: false }]); break;
          case 'tracker-login': state.trackerConnected = true; data = { isLoggedIn: true }; break;
          case 'tracker-logout': state.trackerConnected = false; data = { isLoggedIn: false }; break;
          case 'track-records': data = nodes(state.migrationPages
            ? (a.mangaId===1 ? [{id:91,trackerId:1,remoteId:'44',title:'Original tracker match'}] : [])
            : (state.trackRecord ? [state.trackRecord] : [])); break;
          case 'copy-tracker-binding':
            if(a.originalId!==1||a.replacementId!==3||a.trackerId!==1||a.remoteId!=='44'||a.recordId!==91||
              !a.originalIdentity||!a.replacementIdentity||a.originalIdentity===a.replacementIdentity)throw Error('Unexpected binding migration');
            data={verified:true};break;
          case 'tracker-search': data = { trackSearches: [{ remoteId: '44', title: 'Original tracker match', totalChapters: 2, publishingType: 'Manga', publishingStatus: 'Finished', startDate: '2025' }] }; break;
          case 'tracker-bind': if (a.remoteId !== '44') throw new Error('Expected lossless tracker ID'); state.trackRecord = { id: 91, trackerId: 1, title: 'Original tracker match', lastChapterRead: 0, totalChapters: 2 }; data = { trackRecord: state.trackRecord }; break;
          case 'tracker-sync': state.trackRecord.lastChapterRead = 1; data = { trackRecords: [state.trackRecord] }; break;
          case 'tracker-unbind': state.trackRecord = null; data = { clientMutationId: null }; break;
          case 'chapter-flags': data = { chapters: [...chapters, ...replacementChapters].filter((chapter) => a.ids.includes(chapter.id)).map((chapter) => { if (typeof a.read === 'boolean') { chapter.isRead = a.read; if (!a.read) chapter.lastPageRead = 0; } if (typeof a.bookmarked === 'boolean') chapter.isBookmarked = a.bookmarked; return { id: chapter.id, isRead: chapter.isRead, isBookmarked: !!chapter.isBookmarked, lastPageRead: chapter.lastPageRead }; }) }; break;
          case 'stores': data = nodes(state.stores); break;
          case 'add-store': state.stores.push({ name: 'Original fixture store', indexUrl: a.index }); data = { ok: true }; break;
          case 'refresh-extensions': data = { ok: true }; break;
          case 'extensions': data = nodes(state.stores.length && (a.installed === undefined || a.installed === state.installed) && (!a.language || a.language === 'en') && (!a.updatesOnly || (state.installed && state.fixtureHasUpdate)) ? [{ pkgName: 'org.tsugi.fixture', name: 'Original extension', lang: 'en', versionName: '1.6', storeIndexUrl: state.stores[0].indexUrl, isInstalled: state.installed, isObsolete: false, hasUpdate: !!state.fixtureHasUpdate && state.installed }] : []); break;
          case 'install-extension': state.installed = true; data = { ok: true }; break;
          case 'sources':
          case 'source-inventory': data = { ...nodes(state.installed ? [{ id: '12345', name: 'Original source', lang: 'en', supportsLatest: true }, ...(state.transferEnabled ? [{ id: '67890', name: 'Replacement source', lang: 'en', supportsLatest: true }] : []), ...(state.searchLayout ? [{ id: '23456', name: 'Additional source', lang: 'fr', supportsLatest: true }, { id: '34567', name: 'Empty source', lang: 'en', supportsLatest: true }, { id: '45678', name: 'Unavailable source', lang: 'en', supportsLatest: true }] : [])] : []), complete: true }; break;
          case 'catalogue':
            if (a.source === '45678') error = 'Fixture source unavailable';
            else data = { mangas: a.source === '34567' ? [] : a.source === '67890' ? a.query === 'Batch Fixture' ? [batchTitle] : [replacement] : [manga], hasNextPage: false };
            break;
          case 'manga': data = a.id === 3 ? { manga: state.titleSettingsFixture?{...replacement,title:'Second reader fixture',inLibrary:true}:replacement, chapters: replacementChapters } : { manga, chapters }; break;
          case 'chapter':
            state.activeChapter = { id: a.id, session: 'chapter-' + ++state.serial };
            data = { ...state.activeChapter, pageCount: state.invalidChapterPages ? 0 : 4 };
            if (state.deferChapterReply) {
              const opened = data;
              state.completeChapterOpen = () => emit({ type: 'read-result', request: message.request, data: opened, error: null });
              return;
            }
            break;
          case 'close-chapter':
            if (state.failCloseOnce) { state.failCloseOnce = false; error = 'Fixture close busy'; break; }
            data = { closed: state.activeChapter?.id === a.chapterId && state.activeChapter?.session === a.session };
            if (data.closed) state.activeChapter = null;
            break;
          case 'cover':
          case 'page':
            if (a.kind === 'page' && state.activeChapter?.id !== a.chapterId) { error = 'Open the reading chapter first.'; break; }
            state.lastPath = '/__tsugi_read/page/' + ++state.serial;
            data = { path: state.lastPath, ...(a.kind === 'page' ? { index: a.index } : {}) };
            break;
          case 'progress':
            if (state.activeChapter?.id !== a.chapterId) { error = 'Open the reading chapter first.'; break; }
            state.progress.push(a);
            data = { chapter: { id: a.chapterId, lastPageRead: a.index, isRead: a.finished } };
            break;
          default: error = 'Unexpected fixture request: ' + a.kind;
        }
        queueMicrotask(() => { for (const listener of listeners) listener({ type: 'read-result', request: message.request, data, error }); });
      },
    };
  }
  await verifyStremioAddonsBrowser({ browser, origin, installDesktopFixture, screenshotDir });
  await page.addInitScript(installDesktopFixture);
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
    await route.fulfill({ json: { data: [1,2].map(id=>({ attributes: { adult: false, ageRating: 'PG', coverImage: { large: 'https://media.kitsu.io/manga/cover_images/'+id+'/large.jpg' } } })) }, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.route('https://media.kitsu.io/manga/cover_images/1/large.jpg', async route => {
    heroRequests.push('kitsu-image');
    await route.fulfill({ status: 404 });
  });
  await page.route('https://media.kitsu.io/manga/cover_images/2/large.jpg', async route => {
    heroRequests.push('kitsu-image-2');
    await route.fulfill({ contentType: 'image/svg+xml', body: wideArt.replace('#37495b','#7a4563') });
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
    else {
      const size = Number(/=w(\d+)-h\d+$/.exec(route.request().url())?.[1] || 120);
      await route.fulfill({ status:200, contentType:'image/svg+xml', body:`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="#40516d"/></svg>` });
    }
  });
  const coverQueries = [];
  await page.route('https://api.jikan.moe/v4/manga?*', async route => {
    coverQueries.push(new URL(route.request().url()).searchParams.get('q'));
    await route.fulfill({ json: { data: [{ mal_id: 42, title: 'ZZ Missing Fixture', authors: [{ name: 'Tsugi' }], images: { jpg: { large_image_url: 'https://cdn.myanimelist.net/images/manga/1/2.jpg' } } }] }, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.route('https://cdn.myanimelist.net/images/manga/1/2.jpg', route => route.fulfill({ contentType: 'image/png', body: image }));
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  const landing = page.locator('[data-page="desktop-landing"]');
  await landing.locator('.tsugi-world-card[data-world="video"]').waitFor();
  const onboarding = page.locator('[data-ui="tsugi-onboarding"]');
  assert.equal(await landing.getAttribute('data-view'), 'welcome');
  assert.equal(await onboarding.isVisible(), false, 'first launch does not force setup');
  const welcomeHero=landing.locator('[data-ui="tsugi-world-hero"] img');
  await welcomeHero.evaluate(image => image.decode());
  assert.equal(await welcomeHero.getAttribute('src'),'/design/launch/launch-purple.jpg');
  assert.equal(await welcomeHero.evaluate(image=>getComputedStyle(image).filter),'blur(2px)','purple wallpaper receives only the slight illustration finish');
  assert.equal(await landing.locator('.tsugi-world-card').count(), 4);
  const welcomeArt=await landing.locator('.tsugi-world-hero img').evaluateAll(images=>Promise.all(images.map(async image=>{await image.decode();return image.getAttribute('src');})));
  assert.equal(welcomeArt.length,1);
  assert.equal(await landing.getByText('Your next world starts here.',{exact:true}).count(),0);
  const worldArtwork=landing.locator('.tsugi-world-card img');
  const expectedWorldArtwork=['video','music','read','vault'].map(area=>'/design/launch/world-'+area+'.webp');
  assert.deepEqual(await worldArtwork.evaluateAll(images=>Promise.all(images.map(async image=>{await image.decode();if(image.naturalWidth!==960||image.naturalHeight<500)throw new Error('Invalid category artwork dimensions');return image.getAttribute('src');}))),expectedWorldArtwork);
  assert.ok(await landing.locator('.tsugi-world-card').evaluateAll(cards=>cards.every(card=>{
    const a=card.getBoundingClientRect(),b=card.querySelector('.tsugi-world-card-copy').getBoundingClientRect();
    return Math.abs(a.x+a.width/2-b.x-b.width/2)<2&&Math.abs(a.y+a.height/2-b.y-b.height/2)<2;
  })),'minimal welcome card copy is centered');
  await capture('00-illustrated-welcome');
  await landing.getByRole('button', { name: 'Make it yours', exact: true }).click();
  await onboarding.waitFor({ state: 'visible' });
  await onboarding.getByLabel('What should we call you?').fill('Fixture');
  const favoriteMusic = onboarding.getByRole('button', { name: 'Music', exact: true });
  await favoriteMusic.click();
  assert.equal(await favoriteMusic.getAttribute('aria-pressed'), 'false');
  await favoriteMusic.click();
  assert.equal(await favoriteMusic.getAttribute('aria-pressed'), 'true');
  await onboarding.locator('.tsugi-intro-art img').evaluate(image=>image.decode());
  assert.equal(await onboarding.locator('.tsugi-intro-art img').getAttribute('src'),'/design/launch/personalization-room.webp');
  assert.equal(await onboarding.locator('.tsugi-intro-art img').evaluate(image=>getComputedStyle(image).filter),'blur(2px)');
  assert.equal(await onboarding.locator('.tsugi-world-choices img').count(),0,'no repeated card artwork during personalization');
  assert.ok(await onboarding.locator('.tsugi-intro-art img').evaluate(image=>image.naturalWidth>0));
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await onboarding.locator('.tsugi-intro-art img').evaluate(image=>getComputedStyle(image).animationName),'none');
  await page.emulateMedia({reducedMotion:'no-preference'});
  assert.equal(await onboarding.evaluate(node => getComputedStyle(node).borderRadius), '14px');
  assert.equal(await onboarding.locator('.tsugi-global-swatch').first().evaluate(node => getComputedStyle(node).borderRadius), '6px');
  await onboarding.getByRole('button', { name: 'Mocha', exact: true }).click();
  await onboarding.getByRole('button', { name: 'Blue', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.tsugiTheme === 'mocha' && document.documentElement.dataset.tsugiAccent === 'blue');
  await capture('00-first-boot-appearance');
  await onboarding.getByRole('button', { name: 'Enter Tsugi' }).click();
  await onboarding.waitFor({ state: 'hidden' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await landing.locator('.tsugi-world-card[data-world="video"]').waitFor();
  await page.waitForFunction(() => document.documentElement.dataset.tsugiTheme === 'mocha' && document.documentElement.dataset.tsugiAccent === 'blue');
  assert.equal(await onboarding.isVisible(), false, 'onboarding does not reopen after completion');
  assert.equal(await landing.getAttribute('data-view'), 'home');
  await landing.locator('.tsugi-world-shared-rail').getByRole('button',{name:'Movies & TV',exact:true}).waitFor();
  assert.equal(await landing.locator('.tsugi-world-hero img').getAttribute('src'),'/design/launch/world-hero.webp');
  assert.ok(!welcomeArt.includes(await landing.locator('.tsugi-world-hero img').getAttribute('src')),'distinct returning-home hero');
  await landing.getByRole('heading', { name: 'Welcome, Fixture.', exact: true }).waitFor();
  await landing.getByRole('button', { name: 'Introduction', exact: true }).click();
  await onboarding.waitFor({ state: 'visible' });
  await page.setViewportSize({ width:440, height:500 });
  assert.ok(await onboarding.evaluate(node=>node.scrollWidth<=node.clientWidth+1),'compact introduction does not overflow horizontally');
  await onboarding.getByRole('button',{name:'Skip for now',exact:true}).click();
  await onboarding.waitFor({state:'hidden'});
  await page.setViewportSize({ width:1440,height:900 });
  await landing.locator('.tsugi-world-toolbar').getByRole('button', { name: 'App settings', exact: true }).click();
  const bootSettings = page.getByRole('dialog');
  assert.equal(await bootSettings.getByLabel('Default visualizer').inputValue(),'wave');
  const startup = bootSettings.getByLabel('Open on startup');
  await startup.selectOption('music');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('tsugi-startup-area-v1'))), 'music');
  await startup.selectOption('auto');
  const prefs=bootSettings.getByRole('region',{name:'Preferences backup',exact:true});
  const downloadEvent=page.waitForEvent('download');
  await prefs.getByRole('button',{name:'Export preferences',exact:true}).click();
  const exported=await downloadEvent;
  assert.equal(exported.suggestedFilename(),'tsugi-preferences.json');
  const exportedPrefs=JSON.parse(await readFile(await exported.path(),'utf8'));
  assert.equal(exportedPrefs.format,'tsugi-preferences');
  assert.equal(exportedPrefs.settings.theme,'mocha');
  const file={format:'tsugi-preferences',version:1,settings:{theme:'carbon',accent:'amber',startup:'auto',matrix:'wave',layout:'default',audioProfile:'flat',reader:{mode:'scroll',width:55,gap:false,rtl:false,fit:'width',background:'black',focus:false,autoNext:false,wheelZoom:true,resume:true}}};
  await prefs.locator('input[type=file]').setInputFiles({name:'preferences.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(file))});
  await prefs.getByRole('heading',{name:'Restore preview',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.tsugiTheme),'mocha');
  await prefs.getByRole('button',{name:'Apply preferences',exact:true}).click();
  await page.waitForFunction(()=>document.documentElement.dataset.tsugiTheme==='carbon'&&document.documentElement.dataset.tsugiAccent==='amber');
  await prefs.getByRole('status').waitFor();
  const musicBackup=bootSettings.getByRole('region',{name:'Music library backup',exact:true});
  const musicExportEvent=page.waitForEvent('download');
  await musicBackup.getByRole('button',{name:'Export music library',exact:true}).click();
  const musicExported=await musicExportEvent;
  assert.equal(musicExported.suggestedFilename(),'tsugi-music-library.json');
  const musicData=JSON.parse(await readFile(await musicExported.path(),'utf8'));
  assert.equal(musicData.format,'tsugi-music-library');
  await musicBackup.locator('input[type=file]').setInputFiles({name:'music.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(musicData))});
  await musicBackup.getByRole('heading',{name:'Music restore preview',exact:true}).waitFor();
  await musicBackup.getByRole('button',{name:'Cancel music restore',exact:true}).click();
  const mangaBackup=bootSettings.getByRole('region',{name:'Manga progress backup',exact:true});
  const mangaExportEvent=page.waitForEvent('download');
  await mangaBackup.getByRole('button',{name:'Export manga progress',exact:true}).click();
  const mangaExported=await mangaExportEvent;
  assert.equal(mangaExported.suggestedFilename(),'tsugi-manga-progress.json');
  const mangaData=JSON.parse(await readFile(await mangaExported.path(),'utf8'));
  assert.equal(mangaData.format,'tsugi-manga-progress');
  assert.equal(mangaData.version,2);
  assert.deepEqual(mangaData.categories,[]);
  const savedManga=mangaData.manga.find(row=>row.title==='Tsugi Original Fixture');
  assert.ok(savedManga.identity);
  assert.equal(savedManga.id,undefined);
  const absentSource={...mangaData,manga:[{...savedManga,identity:'f'.repeat(64),sourceId:'9007199254740993'}]};
  await mangaBackup.locator('input[type=file]').setInputFiles({name:'missing-source.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(absentSource))});
  await mangaBackup.getByText('Sources for missing titles',{exact:true}).click();
  await mangaBackup.getByText('Source 9007199254740993 · Titles: 1',{exact:true}).waitFor();
  await mangaBackup.getByText('Reconnect the original trusted source.',{exact:true}).waitFor();
  assert.equal(await mangaBackup.getByRole('button',{name:'Restore matched manga progress'}).isEnabled(),false);
  savedManga.chapters=[{identity:'b'.padStart(64,'0'),name:'Chapter one',isRead:false,isBookmarked:true,lastPageRead:2,pageCount:4,lastReadAt:'100'}];
  await mangaBackup.locator('input[type=file]').setInputFiles({name:'manga.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(mangaData))});
  await mangaBackup.getByRole('heading',{name:'Manga restore preview',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__readerFixture.backupPage),undefined,'preview performs no writes');
  await mangaBackup.getByRole('button',{name:'Restore matched manga progress',exact:true}).click();
  await mangaBackup.getByText('Restored progress or bookmarks for 1 chapters. Refresh your manga library to see the changes.',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>[window.__readerFixture.backupPage,window.__readerFixture.backupBookmarked]),[2,true]);
  const portable=bootSettings.getByRole('region',{name:'Portable backup',exact:true});
  const archiveDownload=page.waitForEvent('download');
  await portable.getByRole('button',{name:'Export portable backup',exact:true}).click();
  const archiveFile=await archiveDownload;
  assert.match(archiveFile.suggestedFilename(),/^tsugi-portable-.*\.json$/);
  const archiveData=JSON.parse(await readFile(await archiveFile.path(),'utf8'));
  assert.equal(archiveData.format,'tsugi-portable');
  assert.deepEqual(archiveData.entries.map(entry=>entry.kind),['preferences','music','books','manga']);
  // A separate browser context gives the destination fresh origin storage and bridge state.
  const destination=await browser.newPage({locale:'en-GB',viewport:{width:1440,height:900}});
  try {
    await destination.addInitScript(installDesktopFixture);
    await destination.route('**/*', route => route.request().url().startsWith(origin+'/') ? route.continue() : route.abort());
    await destination.goto(origin,{waitUntil:'domcontentloaded'});
    await destination.getByRole('button',{name:'Explore first',exact:true}).click();
    assert.equal(await destination.locator('[data-page="desktop-landing"]').getAttribute('data-view'),'home');
    assert.equal(await destination.locator('[data-ui="tsugi-onboarding"]').isVisible(),false);
    await destination.locator('[data-page="desktop-landing"] .tsugi-world-toolbar').getByRole('button',{name:'App settings',exact:true}).click();
    const settings=destination.getByRole('dialog');
    const restore=settings.getByRole('region',{name:'Portable backup',exact:true});
    const before=await destination.evaluate(()=>document.documentElement.dataset.tsugiTheme);
    assert.notEqual(before,'carbon');
    await restore.locator('input[type=file]').setInputFiles(await archiveFile.path());
    await restore.getByRole('heading',{name:'Portable backup preview',exact:true}).waitFor();
    await restore.getByText(/Reader sources represented:/).waitFor();
    assert.equal(await destination.evaluate(()=>document.documentElement.dataset.tsugiTheme),before);
    await restore.getByRole('button',{name:'Prepare restore checkpoint',exact:true}).click();
    await restore.getByRole('status').filter({hasText:'Restore checkpoint prepared.'}).waitFor();
    const pref=settings.getByRole('region',{name:'Preferences backup',exact:true});
    await pref.getByRole('button',{name:'Review archived preferences'}).click();
    await pref.getByRole('button',{name:'Apply preferences'}).click();
    await destination.waitForFunction(()=>document.documentElement.dataset.tsugiTheme==='carbon');
    const mangaRestore=settings.getByRole('region',{name:'Manga progress backup',exact:true});
    await mangaRestore.getByRole('button',{name:'Review archived manga'}).click();
    await mangaRestore.getByRole('button',{name:'Restore matched manga progress'}).click();
    await mangaRestore.getByRole('status').filter({hasText:'Restored progress or bookmarks for 1 chapters'}).waitFor();
    assert.deepEqual(await destination.evaluate(()=>[window.__readerFixture.backupPage,window.__readerFixture.backupBookmarked]),[2,true]);
    await destination.reload({waitUntil:'domcontentloaded'});
    await destination.waitForFunction(()=>document.documentElement.dataset.tsugiTheme==='carbon');
    console.log('PASS: exported archive restores into independent origin storage with synthetic Reader state.');
  } finally { await destination.close(); }
  const corrupt={...archiveData,entries:archiveData.entries.map((entry,i)=>i===0?{...entry,sha256:'0'.repeat(64)}:entry)};
  await portable.locator('input[type=file]').setInputFiles({name:'damaged.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(corrupt))});
  await portable.getByRole('alert').filter({hasText:'Invalid, damaged or unsupported portable backup. Nothing was restored.'}).waitFor();
  await portable.locator('input[type=file]').setInputFiles({name:'portable.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(archiveData))});
  await portable.getByRole('heading',{name:'Portable backup preview',exact:true}).waitFor();
  await portable.getByRole('button',{name:'Prepare restore checkpoint',exact:true}).click();
  await portable.getByRole('status').filter({hasText:'Restore checkpoint prepared.'}).waitFor();
  await bootSettings.getByRole('button',{name:'Default',exact:true}).click();
  await page.waitForFunction(()=>document.documentElement.dataset.tsugiTheme==='sumi');
  await prefs.getByRole('button',{name:'Review archived preferences',exact:true}).click();
  await prefs.getByRole('heading',{name:'Restore preview',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.tsugiTheme),'sumi','archive review does not change preferences');
  await startup.selectOption('music');
  await prefs.getByRole('button',{name:'Apply preferences',exact:true}).click();
  await prefs.getByRole('alert').filter({hasText:'Preferences changed after review'}).waitFor();
  assert.equal(await startup.inputValue(),'music','stale restore preserves the newer startup preference');
  await prefs.getByRole('button',{name:'Review archived preferences',exact:true}).click();
  await prefs.getByRole('button',{name:'Apply preferences',exact:true}).click();
  await page.waitForFunction(()=>document.documentElement.dataset.tsugiTheme==='carbon');
  await musicBackup.getByRole('button',{name:'Review archived music',exact:true}).click();
  await musicBackup.getByRole('heading',{name:'Music restore preview',exact:true}).waitFor();
  await portable.getByRole('button',{name:'Close portable backup',exact:true}).click();
  assert.equal(await musicBackup.getByRole('button',{name:'Merge music library',exact:true}).count(),0,'closing an archive invalidates outstanding section reviews');
  await portable.getByRole('checkbox',{name:'I have reviewed the current state and want to finish this restore record.'}).check();
  await portable.getByRole('button',{name:'Finish restore record',exact:true}).click();
  await portable.getByRole('status').filter({hasText:'Restore record finished.'}).waitFor();
  console.log('PASS: validated portable archive, checkpoint, explicit per-domain review and finish.');
  const shelfData={...mangaData,categories:['Recovered shelf','Empty shelf'],manga:mangaData.manga.map(row=>({...row,categories:row.identity===savedManga.identity?['Recovered shelf']:[],chapters:[]}))};
  await mangaBackup.locator('input[type=file]').setInputFiles({name:'shelves.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(shelfData))});
  await mangaBackup.getByRole('heading',{name:'Category restore preview',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__readerFixture.categories.length),0,'category preview must not write');
  await mangaBackup.getByRole('button',{name:'Restore matched categories',exact:true}).click();
  await mangaBackup.getByRole('status').filter({hasText:'Created 2 categories, added 1 assignments'}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.__readerFixture.categories.map(row=>row.name)),['Recovered shelf','Empty shelf']);
  await mangaBackup.locator('input[type=file]').setInputFiles({name:'shelves.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(shelfData))});
  await mangaBackup.getByRole('heading',{name:'Category restore preview',exact:true}).waitFor();
  assert.equal(await mangaBackup.getByRole('button',{name:'Restore matched categories',exact:true}).isEnabled(),false,'reimport is idempotent');
  await mangaBackup.getByRole('button',{name:'Cancel manga restore',exact:true}).click();
  console.log('PASS: reviewed shelf recovery preserves empty shelves and is idempotent.');
  const checkpointCopies=await page.evaluate(()=>window.__readerFixture.managedBackups.length);
  assert.equal(checkpointCopies,2,'incoming and pre-restore metadata copies remain available');
  await portable.getByRole('button',{name:'Save managed backup',exact:true}).click();
  await portable.getByRole('status').filter({hasText:'Managed backup written and verified:'}).waitFor();
  const savedManagedName=await page.evaluate(()=>window.__readerFixture.managedBackups.at(-1).row.name);
  const savedManagedRow=portable.locator('.tsugi-read-row').filter({hasText:savedManagedName});
  await savedManagedRow.getByRole('button',{name:'Open and verify',exact:true}).click();
  await portable.getByRole('heading',{name:'Portable backup preview',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__readerFixture.managedBackups.length),checkpointCopies+1);
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.tsugiTheme),'carbon','opening a managed copy does not apply preferences');
  await portable.getByRole('button',{name:'Close portable backup',exact:true}).click();
  await page.evaluate(()=>{window.__readerFixture.managedBackups.at(-1).archive='damaged';});
  await savedManagedRow.getByRole('button',{name:'Open and verify',exact:true}).click();
  await portable.getByRole('alert').filter({hasText:'Could not verify this managed backup.'}).waitFor();
  assert.equal(await portable.getByRole('heading',{name:'Portable backup preview',exact:true}).count(),0);
  console.log('PASS: managed backup bridge save, list, reopen and damaged copy rejection.');
  const storage=bootSettings.getByRole('region',{name:'Storage management',exact:true});
  await storage.getByRole('button',{name:'Scan app storage',exact:true}).click();
  await storage.getByText('App data measured',{exact:true}).waitFor();
  await storage.getByText('Partial scan',{exact:false}).waitFor();
  assert.equal(await storage.locator('progress').count(),9);
  await storage.getByRole('progressbar',{name:'Downloaded manga chapters',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__readerFixture.managedBackups.length),checkpointCopies+1,'storage scan does not modify backups');
  // Populate only this browser fixture's artwork cache. A non-artwork row must survive.
  await page.evaluate(async()=>{
    const db=await new Promise((ok,fail)=>{
      const q=indexedDB.open('aiostreams-web-cache',1);
      q.onsuccess=()=>ok(q.result);q.onerror=()=>fail(q.error);
    });
    window.__readerFixture.cacheRows=async(action)=>{
      const tx=db.transaction(['entries','bodies'],'readwrite');
      const entries=tx.objectStore('entries'), bodies=tx.objectStore('bodies');
      if(action==='seed'||action==='replace'){
        for(const [id,category] of [['fixture-image','artwork'],['fixture-query','titles']]){
          entries.put({id,category,scope:'',size:4,usedAt:1,revision:action});
          bodies.put({id,blob:new Blob(['data'])});
        }
      }
      const keys=bodies.getAllKeys();
      await new Promise((ok,fail)=>{tx.oncomplete=ok;tx.onabort=tx.onerror=()=>fail(tx.error);});
      return keys.result;
    };
    await window.__readerFixture.cacheRows('seed');
  });
  const reviewArt=storage.getByRole('button',{name:'Review cached artwork',exact:true});
  const removeArt=storage.getByRole('button',{name:'Remove reviewed artwork',exact:true});
  await reviewArt.click();
  await storage.getByText('Cached images selected: 1 (4 B).',{exact:true}).waitFor();
  await storage.getByRole('button',{name:'Close artwork review',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.__readerFixture.cacheRows('inspect')),['fixture-image','fixture-query']);
  await reviewArt.click();
  await removeArt.waitFor();
  await page.evaluate(()=>window.__readerFixture.cacheRows('replace'));
  await removeArt.click();
  await storage.getByRole('alert').filter({hasText:'Review the current cache again'}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.__readerFixture.cacheRows('inspect')),['fixture-image','fixture-query']);
  await reviewArt.click();
  await removeArt.click();
  await storage.getByText('Reviewed artwork removed from the device cache.',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.__readerFixture.cacheRows('inspect')),['fixture-query']);
  await reviewArt.click();
  await storage.getByText('Cached images selected: 0 (0 B).',{exact:true}).waitFor();
  assert.equal(await removeArt.count(),0);
  console.log('PASS: read-only storage inventory exposes partial results.');
  const releaseSettings=bootSettings.getByRole('region',{name:'Tsugi updates',exact:true});
  await releaseSettings.getByRole('button',{name:'Check stable release',exact:true}).click();
  await releaseSettings.getByText('v0.1.0',{exact:true}).waitFor();
  await releaseSettings.getByText(/This build differs from the stable release/).waitFor();
  assert.equal(await releaseSettings.getByRole('link',{name:'Open official release'}).getAttribute('href'),'https://github.com/G1NYU/TSUGI/releases/tag/v0.1.0');
  assert.equal(await releaseSettings.locator('[data-ui="tsugi-cicada-update"]').count(),1);
  assert.equal(await releaseSettings.getByRole('link',{name:'Browse GitHub releases',exact:true}).getAttribute('href'),'https://github.com/G1NYU/TSUGI/releases');
  await releaseSettings.scrollIntoViewIfNeeded();
  if(screenshotDir)await page.screenshot({path:join(screenshotDir,'tsugi-cicada-updater.png'),animations:'disabled'});
  console.log('PASS: cicada updater links to official GitHub Releases and distinguishes source revision and release tag.');
  await portable.getByRole('combobox',{name:'Backup frequency'}).selectOption('daily');
  await portable.getByRole('combobox',{name:'Scheduled copy retention'}).selectOption('7');
  await page.evaluate(()=>{const key='tsugi-backup-schedule-v1';const state=JSON.parse(localStorage.getItem(key));localStorage.setItem(key,JSON.stringify({...state,dueMs:Date.now()-1}));window.dispatchEvent(new Event('focus'));});
  assert.equal(await page.evaluate(()=>window.__readerFixture.managedBackups.length),checkpointCopies+1,'settings dialog defers due backup');

  await bootSettings.getByRole('button', { name: 'Default', exact: true }).click();
  await bootSettings.getByRole('button', { name: 'Silver', exact: true }).click();
  await bootSettings.getByRole('button', { name: 'Close', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.tsugiTheme === 'sumi' && document.documentElement.dataset.tsugiAccent === 'silver');
  await bootSettings.waitFor({state:'hidden'});
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(count=>window.__readerFixture.managedBackups.length===count+2&&JSON.parse(localStorage.getItem('tsugi-backup-schedule-v1')).result==='saved',checkpointCopies);
  assert.ok(await page.evaluate(()=>window.__readerFixture.managedBackups.at(-1).row.name.startsWith('tsugi-auto-backup-')));
  await page.evaluate(()=>{const key='tsugi-backup-schedule-v1';const state=JSON.parse(localStorage.getItem(key));localStorage.setItem(key,JSON.stringify({...state,cadence:'off',dueMs:0}));window.dispatchEvent(new Event('tsugi-backup-schedule-change'));});
  console.log('PASS: opt-in schedule defers during settings, then saves verified automatic copy.');
  assert.deepEqual(await landing.locator('.tsugi-world-card').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label'))), ['Movies & TV', 'Music', 'Read', 'Vault']);
  assert.equal(await landing.locator('.tsugi-world-card .tsugi-world-card-top .tsugi-media-icon').count(), 4);
  const homeNav=landing.locator('.tsugi-world-shared-rail .tsugi-rail-local');
  for(const label of ['Home','Up next']){
    const item=homeNav.getByRole('button',{name:label,exact:true});
    assert.equal(await item.locator('span').textContent(),label);
    assert.ok(await item.evaluate(button=>{const text=button.querySelector('span'),icon=button.querySelector('svg'),a=text.getBoundingClientRect(),b=icon.getBoundingClientRect(),r=button.getBoundingClientRect();return getComputedStyle(text).display!=='none'&&parseFloat(getComputedStyle(text).fontSize)>0&&a.width>0&&a.left>=b.right&&a.right<=r.right+1;}),'visible sidebar label next to icon: '+label);
  }
  const homeArtwork=landing.locator('.tsugi-world-card img');
  assert.ok(await homeArtwork.evaluateAll(images=>images.length===4&&images.every(image=>getComputedStyle(image).filter.includes('blur(2px)'))),'all returning-home card artwork has only a slight blur');
  assert.ok(await landing.locator('.tsugi-world-card-copy,.tsugi-world-card-top').evaluateAll(nodes=>nodes.every(node=>getComputedStyle(node).filter==='none')),'category copy and icons stay sharp');
  assert.deepEqual(await homeArtwork.evaluateAll(images=>Promise.all(images.map(async image=>{await image.decode();return image.getAttribute('src');}))),expectedWorldArtwork,'each returning-home world has distinct dark artwork');
  assert.equal(await page.locator('html').getAttribute('class').then(value => value.includes('tsugi-desktop-boot')), true);
  const assertLauncherGeometry = async () => {
    const hero = await landing.locator('.tsugi-world-hero').boundingBox();
    const grid = await landing.locator('.tsugi-world-grid').boundingBox();
    assert.ok(hero && grid && grid.y >= hero.y + hero.height, 'illustrated destinations below the hero');
    const buttons = await landing.locator('.tsugi-world-card').evaluateAll(nodes => nodes.map(node => {
      const { y, width } = node.getBoundingClientRect();
      return { y, width };
    }));
    assert.ok(buttons.every(button => Math.abs(button.y - buttons[0].y) < 2 && Math.abs(button.width - buttons[0].width) < 2), 'equal-width illustrated destinations on one baseline');
    assert.ok(await landing.evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'launcher has no horizontal overflow');
    const artBounds=await homeArtwork.evaluateAll(nodes=>nodes.map(node=>{const {width,height}=node.getBoundingClientRect();return {width,height};}));
    assert.equal(artBounds.length,4);
    assert.ok(artBounds.every(({width,height})=>width>0&&height>0),'all four world illustrations have visible geometry');
    assert.ok(await landing.locator('.tsugi-world-card').evaluateAll(cards=>cards.every(card=>{
      const a=card.getBoundingClientRect(),b=card.querySelector('.tsugi-world-card-copy').getBoundingClientRect();
      return Math.abs(a.x+a.width/2-b.x-b.width/2)<2&&Math.abs(a.y+a.height/2-b.y-b.height/2)<2;
    })),'returning-home card copy stays centered');
    await landing.locator('.tsugi-world-hero img').evaluate(image => image.decode());
  };
  const assertCenteredWordmark = async rail => {
    const signature = rail.locator('.tsugi-rail-signature');
    await signature.waitFor({ state: 'visible' });
    assert.equal(await signature.locator('svg').count(), 0, 'sidebar has no brush seal');
    const wordmark = signature.locator('.tsugi-brand-wordmark');
    await wordmark.waitFor({ state: 'visible' });
    const [a, b] = await Promise.all([rail.boundingBox(), wordmark.boundingBox()]);
    assert.ok(a && b && b.width > 0 && Math.abs(a.x + a.width / 2 - b.x - b.width / 2) <= 2, 'lettering is centered in the shared rail');
  };
  await assertLauncherGeometry();
  await assertCenteredWordmark(landing.locator('.tsugi-world-shared-rail'));
  const wordmarkAsset = await landing.locator('.tsugi-world-shared-rail .tsugi-rail-signature .tsugi-brand-wordmark').evaluate(async node => {
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
  await page.setViewportSize({ width: 440, height: 700 });
  assert.ok(await landing.evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'compact illustrated home has no horizontal overflow');
  await assertCenteredWordmark(landing.locator('.tsugi-world-shared-rail'));
  await page.setViewportSize({ width: 1440, height: 900 });
  await landing.locator('.tsugi-world-card[data-world="vault"]').click();
  const vault = page.locator('[data-page="vault"]');
  await vault.waitFor();
  await assertCenteredWordmark(vault.locator('[data-ui="tsugi-desktop-rail"]'));
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
  const vaultShell=vault.locator('.tsugi-vault-workspace');
  assert.equal(await vaultShell.evaluate(node=>getComputedStyle(node).gridTemplateColumns.split(' ').length),2);
  assert.equal(await vaultShell.locator('.tsugi-dashboard-metrics > div').count(),4);
  assert.equal(await vaultShell.locator('.tsugi-dashboard-right').getByRole('heading',{name:'Save to',exact:true}).count(),1);
  // Compare rendered colors, not raw CSS variable text: the column must
  // match the media rail across theme changes while selected rows retain contrast.
  const assertWorkspaceSurfaces = async (container, selector, token='--tsugi-canvas', minimum=2) => {
    const colors = await container.evaluate((node, {selector,token}) => {
      const probe = document.createElement('span');
      probe.style.cssText = `position:absolute;visibility:hidden;background:var(${token})`;
      node.appendChild(probe);
      const canvas = getComputedStyle(probe).backgroundColor;
      probe.remove();
      const columns = [...node.querySelectorAll(selector)].map(column => {
        let surface = column;
        while (surface) {
          const color = getComputedStyle(surface).backgroundColor;
          if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') return color;
          surface = surface.parentElement;
        }
        return 'transparent';
      });
      return { canvas, columns };
    }, {selector,token});
    assert.ok(colors.columns.length >= minimum, 'workspace management surfaces are present');
    assert.ok(colors.columns.every(color => color === colors.canvas), 'workspace backing matches its shared palette role: ' + JSON.stringify(colors));
  };
  await assertWorkspaceSurfaces(vaultShell, '.tsugi-dashboard-center,.tsugi-dashboard-right');
  const vaultSelection = await vault.locator('[data-ui="kura-download-navigation"] .tsugi-dashboard-nav[aria-pressed="true"]').first().evaluate(node => ({
    row: getComputedStyle(node).backgroundColor, column: getComputedStyle(node.closest('.tsugi-desktop-rail')).backgroundColor
  }));
  assert.notEqual(vaultSelection.row, vaultSelection.column, 'selected Vault row remains distinguishable');
  const decodedDecoration = async (container, previous = '') => {
    await page.waitForFunction(({ node, previous }) => {
      const image = node.querySelector('img[data-artwork-provider]');
      return image && image.getAttribute('src') !== previous && image.complete && image.naturalWidth >= 800 && getComputedStyle(image).opacity === '1';
    }, { node: await container.elementHandle(), previous }, { timeout: 20_000 });
    return container.locator('img[data-artwork-provider]').getAttribute('src');
  };
  await decodedDecoration(vault.locator('[data-ui="kura-hero"]'));
  assert.equal(heroRequests.filter(value=>value==='kitsu').length,1,'hidden media workspaces do not fetch decorative catalogues');
  await vault.locator('[data-ui="kura-hero"]').getByRole('button',{name:'Use local artwork',exact:true}).click();
  const localArtworkRequestCount = heroRequests.length;
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
  await landing.locator('.tsugi-world-card[data-world="video"]').click();
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
  assert.equal(await entry.locator('.tsugi-atmosphere').count(), 0, 'server setup keeps one identity in its navigation');
  const connectionForm = await entry.locator('[data-ui="auth-card"]').boundingBox();
  const entryBounds = await entry.boundingBox();
  assert.ok(connectionForm.width <= 440, 'server setup remains readable on a wide window');
  assert.ok(Math.abs(connectionForm.x + connectionForm.width / 2 - entryBounds.x - entryBounds.width / 2) <= 2, 'server setup is centered inside the usable window without a sideways offset: ' + JSON.stringify({ connectionForm, entryBounds }));
  assert.equal(await entry.getByRole('button', { name: 'Connect', exact: true }).evaluate((node) => getComputedStyle(node).borderRadius), '8px');
  assert.equal(await entry.evaluate((node) => getComputedStyle(node).backgroundColor), 'rgb(12, 13, 16)');
  assert.equal(await entry.locator('.tsugi-auth-brand').count(), 0, 'desktop setup has no redundant foreground wordmark');
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
  console.log('PASS: centered unboxed movie setup, consistent controls and palette-independent field focus.');
  await landing.locator('.tsugi-world-toolbar').getByRole('button', { name: 'App settings', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Carbon', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.tsugiTheme === 'carbon' && document.documentElement.style.getPropertyValue('--background') === document.documentElement.style.getPropertyValue('--tsugi-canvas'));
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await landing.locator('.tsugi-world-card[data-world="read"]').click();
  const rail = page.locator('.tsugi-reading-rail');
  const readMedia = page.locator('.tsugi-read-media-header');
  const railGeometry = async (locator) => locator.evaluate(node => {
    const rect = node.getBoundingClientRect();
    const media = node.querySelector('.tsugi-rail-media');
    const controls = [...media.querySelectorAll('button')].map(button => {
      const r = button.getBoundingClientRect();
      return [Math.round(r.x - rect.x), Math.round(r.width), Math.round(r.height)];
    });
    const rules = [...node.querySelectorAll('.tsugi-pixel-rule')];
    return { width: Math.round(rect.width), top: Math.round(rect.y), controls, font: getComputedStyle(node).fontFamily, border: getComputedStyle(node).borderInlineEndWidth, separatorsHidden: rules.every(rule=>getComputedStyle(rule).display==='none') };
  });
  await rail.waitFor({ state: 'visible' });
  await assertCenteredWordmark(rail);
  const readRailGeometry = await railGeometry(rail);
  assert.equal(readRailGeometry.width, 208);
  assert.equal(readRailGeometry.border, '0px');
  assert.ok(readRailGeometry.font.startsWith('Interface'));
  assert.equal(readRailGeometry.separatorsHidden, true, 'navigation groups use spacing without separator lines');
  assert.equal(await rail.locator('.tsugi-rail-context').textContent(),'Read');
  assert.equal(await rail.locator('.tsugi-rail-signature .tsugi-brand-wordmark').count(),1,'sidebar keeps the established TSUGI signature');
  assert.ok(await rail.locator('.tsugi-rail-local button').first().evaluate(node=>parseFloat(getComputedStyle(node).fontSize)>=11),'desktop sidebar labels are visible');
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
  const hero = page.locator('[data-ui="landscape-spotlight"]');
  await hero.locator('img[src="/design/yomi/hero-torii.webp"]').waitFor();
  assert.equal(heroRequests.length,localArtworkRequestCount,'the shared local-only choice prevents external decoration in Read');
  await hero.getByRole('button',{name:'Enable external illustration',exact:true}).click();
  await hero.getByRole('button',{name:'Next illustration',exact:true}).waitFor();
  const initialIllustration = await decodedDecoration(hero);
  assert.equal(heroRequests.filter(value=>value==='kitsu').length,1,'Read reuses the shared catalogue instead of restarting the popular-first request');
  await page.bringToFront();
  await hero.getByRole('button',{name:'Next illustration',exact:true}).click();
  const manualIllustration = await decodedDecoration(hero, initialIllustration);
  await decodedDecoration(hero, manualIllustration); // automatic visible rotation without a fixed provider order
  assert.equal(heroRequests.filter(value=>value==='kitsu').length,1,'manual and automatic illustration changes reuse the catalogue');
  await page.locator('.tsugi-library-controls').waitFor();
  await capture('03-reading-library');
  await page.evaluate(()=>window.__readerFixture.heroFeatured=true);
  await page.getByRole('button',{name:'Refresh library',exact:true}).click();
  await hero.getByRole('heading',{name:'Tsugi Original Fixture',exact:true}).waitFor();
  await hero.locator('.tsugi-spotlight-source-cover img[data-cover-origin="source"]').waitFor();
  assert.equal(await hero.getAttribute('data-artwork-mode'),'featured');
  await hero.getByRole('button',{name:'Next featured title',exact:true}).click();
  await hero.getByRole('heading',{name:'ZZ Missing Fixture',exact:true}).waitFor();
  assert.equal(await hero.locator('.tsugi-spotlight-source-cover img').count(),0,'missing featured cover never invents a title cover');
  assert.equal(await hero.locator('.tsugi-design-illustration[src="/design/yomi/hero-torii.webp"]').count(),1,'missing featured cover retains the bundled illustration');
  assert.equal(await hero.locator('[data-ui="landscape-decoration"]').count(),1,'decorative landscape stays separate from the actual featured cover');
  await page.evaluate(()=>window.__readerFixture.heroFeatured=false);
  await page.getByRole('button',{name:'Refresh library',exact:true}).click();
  await hero.getByRole('heading',{name:'A world between pages.',exact:true}).waitFor();
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
  await page.getByText("Paste the HTTPS extension repository index URL you use with Mihon, Komikku or another compatible Tachiyomi fork. Adding a repository lists its extensions; install the ones you want from Extensions.",{exact:true}).waitFor();
  await page.getByRole('textbox', { name: 'Repository index URL' }).fill('https://example.test/index.pb');
  await page.getByRole('button', { name: 'Add repository', exact: true }).click();
  await page.getByText('Original fixture store', { exact: true }).waitFor();
  await rail.getByRole('button', { name: 'Extensions', exact: true }).click();
  await page.getByRole('button', { name: 'Install', exact: true }).click();
  await page.getByRole('button', { name: 'Uninstall', exact: true }).waitFor();
  await page.getByRole('combobox', { name: 'Extension language' }).selectOption('en');
  await page.getByRole('combobox', { name: 'Extension status' }).selectOption('installed');
  await page.getByRole('button', { name: 'Uninstall', exact: true }).waitFor();
  await page.evaluate(()=>{window.__readerFixture.fixtureHasUpdate=true;});
  await page.getByRole('combobox', { name: 'Extension status' }).selectOption('updates');
  await page.getByText('Update available',{exact:true}).waitFor();
  assert.ok(await page.evaluate(()=>window.__readerFixture.requests.some(a=>a.kind==='extensions'&&a.updatesOnly===true&&a.installed===true)));
  await page.evaluate(()=>{window.__readerFixture.fixtureHasUpdate=false;});
  await page.getByRole('button',{name:'Check extension updates',exact:true}).click();
  await page.getByText('No matching extensions.',{exact:true}).waitFor();
  await page.getByRole('combobox', { name: 'Extension status' }).selectOption('installed');
  await page.getByRole('button', { name: 'Uninstall', exact: true }).waitFor();
  await page.evaluate(() => { window.__readerFixture.searchLayout = true; });
  await rail.getByRole('button', { name: 'Global search', exact: true }).click();
  const search=page.locator('.tsugi-global-search-workspace');
  await search.waitFor();
  assert.equal(await page.getByRole('textbox',{name:'Global manga search',exact:true}).count(),1,'one global search input');
  await search.getByRole('textbox',{name:'Global manga search',exact:true}).fill('Tsugi');
  await search.getByRole('button',{name:'Search',exact:true}).click();
  await search.getByRole('heading',{name:'Original source',exact:true}).waitFor();
  await search.getByText('Fixture source unavailable',{exact:true}).waitFor();
  assert.equal(await search.getByText('Results: 1',{exact:true}).count(),2);
  assert.equal(await search.locator('.tsugi-manga-card').count(),2);
  assert.equal(await search.locator('progress').getAttribute('value'),'4');
  for (const width of [1440, 800]) {
    await page.setViewportSize({ width, height: 900 });
    const sourceGeometry = await search.locator('.tsugi-search-source').evaluateAll(groups => groups.map(group => {
      const box = group.getBoundingClientRect();
      const header = group.querySelector('header');
      const heading = header.querySelector('h3');
      const card = group.querySelector('.tsugi-manga-card');
      const style = getComputedStyle(group);
      return {
        top: box.top, bottom: box.bottom,
        headerTop: header.getBoundingClientRect().top,
        headingGap: card ? card.getBoundingClientRect().top - heading.getBoundingClientRect().bottom : null,
        headerBorder: parseFloat(getComputedStyle(header).borderBottomWidth) + parseFloat(getComputedStyle(heading).borderBottomWidth),
        groupBorder: parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth),
        background: style.backgroundColor,
      };
    }));
    for (const [index, group] of sourceGeometry.entries()) {
      assert.equal(group.headerBorder + group.groupBorder, 0, 'source groups and headings have no separator lines');
      assert.equal(group.background, 'rgba(0, 0, 0, 0)', 'source artwork groups have no broad grey background');
      assert.ok(Math.abs(group.headerTop - group.top) <= 1, 'source title aligns with its unframed content');
      if (group.headingGap !== null) assert.ok(group.headingGap >= 11, 'source heading has breathing room above artwork');
      if (index) {
        assert.ok(group.top - sourceGeometry[index - 1].bottom >= 20, 'populated, empty and failed source groups remain distinct through spacing');
      }
    }
    await capture(width === 1440 ? '03-reader-global-search' : '03-reader-global-search-narrow');
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { window.__readerFixture.searchLayout = false; });
  await rail.getByRole('button', { name: 'Browse', exact: true }).click();
  await page.getByRole('button', { name: /Original source/ }).click();
  await page.locator('.tsugi-manga-card').first().click();
  await page.getByRole('heading', { name: 'Tsugi Original Fixture' }).waitFor();
  assert.equal(await page.locator('.tsugi-series-layout').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length), 1);
  assert.equal(await page.locator('.yomi-series-body').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length), 2);
  const seriesHero = await page.locator('.tsugi-series-layout .tsugi-manga-detail').boundingBox();
  const chapterColumn = await page.locator('.tsugi-series-chapters').boundingBox();
  const summaryColumn = await page.locator('.yomi-series-summary').boundingBox();
  assert.ok(seriesHero.y + seriesHero.height < chapterColumn.y, 'full-width series hero sits above the chapter workspace');
  assert.ok(chapterColumn.x + chapterColumn.width < summaryColumn.x, 'chapters and synopsis occupy distinct columns');
  assert.ok(Math.abs(seriesHero.width - (summaryColumn.x + summaryColumn.width - chapterColumn.x)) <= 1, 'series hero spans the chapter and synopsis workspace');
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
  const firstReaderSession = await page.evaluate(() => window.__readerFixture.activeChapter.session);
  await reader.getByRole('button', { name: 'Chapter list', exact: true }).click();
  await reader.getByRole('button', { name: /Chapter 2 Original/ }).click();
  await page.waitForFunction(() => window.__readerFixture.requests.some((a) => a.kind === 'chapter' && a.id === 12));
  await page.waitForFunction(() => document.querySelector('.tsugi-chapter-toolbar h2')?.textContent === 'Tsugi Original Fixture' && document.querySelector('.tsugi-chapter-toolbar p')?.textContent?.includes('Chapter 2'));
  assert.equal(await page.locator('.tsugi-chapter-reader').getAttribute('data-mode'), 'spread');
  const secondReaderSession = await page.evaluate(() => window.__readerFixture.activeChapter.session);
  assert.notEqual(firstReaderSession, secondReaderSession);
  assert.ok(await page.evaluate(session => {
    const rows = window.__readerFixture.requests;
    const release = rows.findIndex(a => a.kind === 'close-chapter' && a.session === session);
    const next = rows.findIndex(a => a.kind === 'chapter' && a.id === 12);
    return release >= 0 && release < next;
  }, firstReaderSession), 'chapter switching releases the previous native capability before opening the next');
  await page.evaluate(session => window.aiostreamsApp.send({ type: 'read-request', request: 'stale-close-probe', action: { kind: 'close-chapter', chapterId: 11, session } }), firstReaderSession);
  assert.equal(await page.evaluate(() => window.__readerFixture.activeChapter.session), secondReaderSession, 'a delayed old release retains the current chapter');
  // A real local WAV exercises the HTML audio element, not just a policy
  // function or synthetic native status. Keep it playing through the Read
  // transition, then verify the video environment stops competing audio.
  await page.evaluate(() => { window.__readerFixture.failCloseOnce = true; });
  await reader.getByRole('button', { name: 'Chapters', exact: true }).click();
  await reader.getByRole('alert').filter({ hasText: 'Fixture close busy' }).waitFor();
  assert.equal(await page.evaluate(() => window.__readerFixture.activeChapter.session), secondReaderSession, 'failed release keeps the reader open for retry');
  await reader.getByRole('button', { name: 'Chapters', exact: true }).click();
  await reader.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => window.__readerFixture.activeChapter), null);
  console.log('PASS: Reader close and chapter switch release the exact native session; failed and stale releases preserve active chapters.');
  await readMedia.getByRole('button', { name: 'Music', exact: true }).click();
  const music = page.locator('[data-page="music"]');
  await music.waitFor({ state: 'visible' });
  await page.setViewportSize({ width: 2560, height: 1440 });
  await assertCenteredWordmark(music.locator('[data-ui="tsugi-desktop-rail"]'));
  const musicRailGeometry = await railGeometry(music.locator('[data-ui="tsugi-desktop-rail"]'));
  assert.deepEqual(musicRailGeometry, readRailGeometry, 'Music and Read share sidebar width, control sizing and typography; footer height follows the live player');
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
  assert.ok((await music.locator('.tsugi-music-workspace').boundingBox()).width > 2200, 'wide desktop music workspace uses the canvas beside the labelled sidebar');
  await musicSettings.getByRole('button', { name: 'Addon store', exact: true }).click();
  await musicSettings.getByRole('heading', { name: 'Eclipse community addon store', exact: true }).waitFor();
  const sourceTabs = await musicSettings.locator('.tsugi-source-tabs > button').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor));
  assert.ok(sourceTabs.length === 2 && sourceTabs.every(color => ['transparent', 'rgba(0, 0, 0, 0)'].includes(color)), 'Music source categories are unboxed');
  const storeSurfaces = await musicSettings.locator('.tsugi-source-addon').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor));
  assert.ok(storeSurfaces.length > 0 && storeSurfaces.every(color => ['transparent', 'rgba(0, 0, 0, 0)'].includes(color)), 'addon store metadata has no decorative cards');
  await capture('10-addon-store');
  await musicSettings.getByRole('button', { name: /Installed sources/ }).click();
  await musicSettings.getByRole('heading', { name: 'Connect a music source', exact: true }).waitFor();
  const connectButton = musicSettings.getByRole('button', { name: 'Connect', exact: true });
  const connectPadding = await connectButton.evaluate(node => ({left:parseFloat(getComputedStyle(node).paddingLeft),right:parseFloat(getComputedStyle(node).paddingRight)}));
  assert.ok(connectPadding.left >= 16 && connectPadding.right >= 16, 'source Connect button leaves space around label');
  await capture('10-wide-music-sources');
  await page.setViewportSize({ width: 1440, height: 900 });
  if (await musicSettings.isVisible()) await musicSettings.getByRole('button', { name: 'Close', exact: true }).click();
  await music.getByRole('button', { name: 'Library', exact: true }).click();
  await music.getByRole('heading',{name:'Your music, organized.',exact:true}).waitFor();
  assert.equal(await music.locator('.tsugi-library-shell').evaluate(node=>getComputedStyle(node).gridTemplateColumns.split(' ').length),2);
  await music.locator('.tsugi-hub-inspector').getByRole('heading',{name:'Your music sources',exact:true}).waitFor();
  await assertWorkspaceSurfaces(music.locator('.tsugi-library-shell'), '.tsugi-library-sidebar,.tsugi-hub-inspector','--tsugi-surface');
  assert.equal(await music.locator('.tsugi-atmosphere[data-placement="library"]').count(),0);
  const libraryNavFits = await music.locator('.tsugi-library-sidebar').evaluate(sidebar => {
    const edge = sidebar.getBoundingClientRect();
    return Array.from(sidebar.querySelectorAll('.tsugi-library-nav')).every(button => {
      const rect = button.getBoundingClientRect();
      return rect.left >= edge.left - 1 && rect.right <= edge.right + 1;
    });
  });
  assert.ok(libraryNavFits, 'collection navigation stays inside its sidebar');
  await capture('06-music-library-overview');
  await music.getByRole('group',{name:'Filter music source'}).getByRole('button',{name:'Local',exact:true}).click();
  assert.equal(await music.getByRole('group',{name:'Filter music source'}).getByRole('button',{name:'Local',exact:true}).getAttribute('aria-pressed'),'true','Overview source selection survives synchronized sidebar navigation');
  await music.getByRole('navigation',{name:'Music sections'}).getByRole('button',{name:'Library',exact:true}).click();
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
  const trackColumnOffsets = await music.locator('.tsugi-music-hub').evaluate(hub => {
    const header = hub.querySelector('.tsugi-hub-columns');
    const row = hub.querySelector('.tsugi-collection-play');
    return Array.from(header.children).slice(0,5).map((node,i) =>
      Math.abs(node.getBoundingClientRect().left - row.children[i].getBoundingClientRect().left));
  });
  assert.ok(trackColumnOffsets.every(offset => offset < 3), 'track headers align with their cells: ' + trackColumnOffsets.join(','));
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
  const retainedReaderSession = await page.evaluate(() => window.__readerFixture.activeChapter.session);
  await reader.getByRole('button', { name: 'Music', exact: true }).click();
  await music.waitFor({ state: 'visible' });
  await reader.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => window.__readerFixture.activeChapter.session), retainedReaderSession, 'Music keeps the hidden Reader capability in use');
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
  await music.locator('img.oto-feature-backdrop').waitFor();
  assert.equal(await music.locator('[data-ui="landscape-decoration"],[data-ui="landscape-artwork-controls"]').count(),0,'Music does not use anime decoration or its controls');
  assert.equal(await music.locator('.oto-feature .oto-feature-cover img').count(),1,'Music preserves the actual featured catalogue artwork');
  assert.equal(await music.getByRole('heading', { name: 'Discover', exact: true }).count(), 1);
  await music.locator('.tsugi-catalog-lane').filter({ hasText: 'Fixture recommendations' }).waitFor();
  await page.setViewportSize({ width: 2560, height: 1440 });
  assert.ok((await music.locator('.tsugi-music-workspace').boundingBox()).width > 2200);
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
  assert.ok(trackBounds.width>1000&&trackBounds.width<=1440,'collection tracks use the available wide canvas');
  assert.equal(await detail.locator('.tsugi-hub-collection').evaluate(node=>getComputedStyle(node).display),'block');
  await assertWorkspaceSurfaces(detail.locator('.tsugi-hub-collection'), '.tsugi-hub-inspector','--tsugi-surface',1);
  assert.equal(await detail.locator('.tsugi-hub-remote-columns').getByText('Source',{exact:true}).count(),1);
  const trackGrid=detail.locator('.tsugi-music-detail-track-grid');
  const assertTrackSeam = async () => {
    const gap = await trackGrid.evaluate(node => ({ header: node.previousElementSibling.getBoundingClientRect().bottom, row: node.firstElementChild.getBoundingClientRect().top }));
    assert.ok(Math.abs(gap.row-gap.header)<=1,'collection header and first row meet: '+JSON.stringify(gap));
  };
  await assertTrackSeam();
  assert.equal(await trackGrid.evaluate(node=>getComputedStyle(node).gridTemplateColumns.split(' ').length),1);
  await music.locator('.oto-mini-player').getByRole('button', { name: 'Expand player', exact: true }).click({ trial: true });
  const collectionBottom = await detail.boundingBox();
  const collectionPlayer = await music.locator('.oto-mini-player').boundingBox();
  assert.ok(collectionBottom.y + collectionBottom.height <= collectionPlayer.y + 1, 'collection keeps the live mini-player controls exposed');
  await page.setViewportSize({width:800,height:900});
  assert.equal(await trackGrid.evaluate(node=>getComputedStyle(node).gridTemplateColumns.split(' ').length),1);
  await assertTrackSeam();
  await music.locator('.oto-mini-player').getByRole('button', { name: 'Expand player', exact: true }).click({ trial: true });
  await page.setViewportSize({width:1440,height:900});
  await detail.getByRole('textbox',{name:'Find collection tracks'}).fill('Collection track 12');
  assert.equal(await detail.locator('.tsugi-music-detail-track').count(),1);
  await detail.getByRole('textbox',{name:'Find collection tracks'}).fill('');
  const saveCollection = detail.getByRole('button',{name:'Save collection to library',exact:true});
  await saveCollection.click();
  await detail.getByRole('button',{name:'Saved to library',exact:true}).waitFor();
  assert.equal(await detail.getByRole('button',{name:'Saved to library',exact:true}).isDisabled(),true);
  const saveRow = detail.locator('.tsugi-music-detail-track').first().getByRole('button',{name:'Save track to library',exact:true});
  await saveRow.click();
  assert.equal(await saveRow.getAttribute('aria-pressed'),'true');
  await saveRow.click();
  assert.equal(await saveRow.getAttribute('aria-pressed'),'false');
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('tsugi-independent-playlists-v1')||'[]').some(list=>list.name==='Fixture playlist'&&list.collection?.type==='playlist'&&list.tracks.length===12));
  await capture('11-music-collection-redesign');
  await detail.getByRole('button', { name: 'Back to music', exact: true }).click();
  await detail.waitFor({ state: 'detached' });
  const bulkSave=music.getByRole('button',{name:'Save all tracks',exact:true});
  await bulkSave.click();
  assert.equal(await bulkSave.isDisabled(),true);
  await music.getByRole('button',{name:'Save track to library',exact:true}).click();
  assert.equal(await bulkSave.isEnabled(),true);
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
  assert.ok(['transparent', 'rgba(0, 0, 0, 0)'].includes(await selectedVaultQueue.locator('.tsugi-vault-transfer-settings > summary').evaluate(node => getComputedStyle(node).backgroundColor)), 'transfer settings disclosure uses the same unboxed settings label treatment');
  for (const width of [1440,2560,1664,1024,800]) {
    await page.setViewportSize({width,height:900});
    const sizing=await selectedVaultQueue.locator('.tsugi-dashboard-panel').filter({has:page.getByText('Transfer settings',{exact:true})}).evaluate(panel=>{
      const rect=panel.getBoundingClientRect();
      const bounds=[...panel.querySelectorAll('select,button,.tsugi-dashboard-sparkline,.tsugi-vault-saved-path')].map(node=>{
        const box=node.getBoundingClientRect();
        return {left:box.left,right:box.right};
      });
      return {left:rect.left,right:rect.right,viewport:innerWidth,bounds,scroll:panel.scrollWidth,client:panel.clientWidth};
    });
    assert.ok(sizing.right<=sizing.viewport+1 && sizing.scroll<=sizing.client+1 && sizing.bounds.every(box=>box.left>=sizing.left-1&&box.right<=sizing.right+1), 'expanded Vault inspector fits at '+width+': '+JSON.stringify(sizing));
    if(width===1664) await capture('12-vault-expanded-transfer-settings');
  }
  await page.setViewportSize({width:1440,height:900});
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
  assert.ok(await miniQueue.locator('.tsugi-queue-art').count() >= 1);
  await capture('08-mini-queue');
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
  assert.equal(await expanded.locator('.tsugi-player-brand, [data-ui="tsugi-brand"], .tsugi-brand-wordmark').count(), 0, 'native expanded player has no branding');
  await expanded.locator('canvas[data-mode="wave"]').waitFor();
  await expanded.locator('img[src*="tsugi-fixture=w544-h544"]').waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.tsugi-player-dialog img')].some(img => img.src.includes('tsugi-fixture=w544-h544') && img.complete && img.naturalWidth === 544 && img.naturalHeight === 544));
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
    await settings.getByRole('combobox', { name: 'Pixel matrix' }).selectOption('immersive');
    await settings.getByRole('button', { name: 'Close', exact: true }).click();
    const stage = expanded.locator('[data-layout="' + layout + '"]');
    await stage.waitFor();
    assert.equal(await expanded.getByRole('button', { name: 'Minimise player', exact: true }).count(), 1);
    assert.equal(await expanded.getByRole('button', { name: 'Player settings', exact: true }).count(), 1);
    assert.equal(await stage.getByRole('button', { name: 'Next track', exact: true }).count(), 1);
    assert.equal(await stage.getByRole('button', { name: 'Previous track', exact: true }).count(), 1);
    const columns = await stage.evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length);
    assert.equal(columns, layout === 'default' ? 1 : 2);
    const geometry = await stage.evaluate(node => {
      const art = node.querySelector('.tsugi-junction-art').getBoundingClientRect();
      const content = node.querySelector('.tsugi-junction-content').getBoundingClientRect();
      return { width: node.getBoundingClientRect().width, art: art.width, artHeight: art.height, artX: art.x, artBottom: art.bottom, contentX: content.x, contentY: content.y, contentWidth: content.width, viewport: innerWidth };
    });
    assert.ok(geometry.width >= geometry.viewport * .96, 'native stage fills the viewport');
    assert.ok(Math.abs(geometry.art - geometry.artHeight) <= 1, 'native artwork remains square');
    if (layout === 'default') {
      assert.ok(geometry.art >= 200 && geometry.art <= 440 && geometry.contentY >= geometry.artBottom, 'Default uses a stacked cover and controls');
      assert.ok(Math.abs(geometry.artX + geometry.art / 2 - geometry.contentX - geometry.contentWidth / 2) <= 2, 'Default centers the listening composition');
    } else if (layout === 'junction') {
      assert.ok(geometry.art >= 440 && geometry.contentX >= geometry.artX + geometry.art + 24, 'Junction retains a large split workspace');
    } else {
      assert.ok(geometry.art >= 200 && geometry.art <= 280 && geometry.contentX >= geometry.artX + geometry.art + 24, 'Nocturne uses smaller artwork against its cinematic backdrop');
    }
    await stage.locator('canvas[data-ui="tsugi-pixel-matrix"]').waitFor();
    assert.equal(await stage.locator('.tsugi-nocturne-backdrop').count(), layout === 'nocturne' ? 1 : 0);
    if (layout === 'default') {
      const motion=await stage.locator('canvas[data-mode="immersive"]').evaluate(async canvas=>{
        const ctx=canvas.getContext('2d');
        const first=ctx.getImageData(0,0,canvas.width,canvas.height).data;
        await new Promise(resolve=>setTimeout(resolve,300));
        const second=ctx.getImageData(0,0,canvas.width,canvas.height).data;
        let changed=0, bright=0;
        for(let i=3;i<second.length;i+=4){if(first[i]!==second[i])changed++;if(second[i]>100)bright++;}
        return {changed,bright};
      });
      assert.ok(motion.changed>100&&motion.bright>100,'immersive field visibly animates');
    }
    if (layout === 'nocturne') {
      await stage.getByRole('button', { name: 'Queue', exact: true }).click();
      await stage.getByRole('region', { name: 'Playback queue', exact: true }).waitFor();
      await capture('08-expanded-queue');
      await stage.getByRole('button', { name: 'Close queue', exact: true }).click();
    }
    if (layout !== 'default') {
      await page.setViewportSize({ width: 2560, height: 1440 });
      const wide = await stage.evaluate(node => {
        const art = node.querySelector('.tsugi-junction-art').getBoundingClientRect();
        const content = node.querySelector('.tsugi-junction-content').getBoundingClientRect();
        const bounds = node.getBoundingClientRect();
        return { art: { width: art.width, height: art.height, left: art.left, right: art.right }, content: { left: content.left, right: content.right }, stage: { left: bounds.left, right: bounds.right }, viewport: innerWidth, scroll: node.scrollWidth, client: node.clientWidth };
      });
      if (layout === 'junction') assert.ok(wide.art.width >= 700 && wide.art.width <= 760, 'wide Junction retains the balanced large artwork scale');
      else assert.ok(wide.art.width >= 240 && wide.art.width <= 280, 'wide Nocturne retains its compact foreground cover');
      assert.ok(Math.abs(wide.art.width - wide.art.height) <= 1, 'wide artwork remains square');
      assert.ok(wide.content.left - wide.art.right >= 24, 'wide artwork and listening controls remain distinct columns');
      assert.ok(wide.art.left >= wide.stage.left && wide.content.right <= wide.stage.right + 1 && wide.stage.right <= wide.viewport && wide.scroll <= wide.client + 1, 'wide player content fits without horizontal clipping');
      await capture('08-expanded-' + layout + '-wide');
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    await capture('08-expanded-' + layout);
  }
  await page.setViewportSize({ width: 440, height: 900 });
  await expanded.getByRole('button', { name: 'Player settings', exact: true }).click();
  const narrowSettings = expanded.getByRole('dialog', { name: 'Player settings' });
  const narrowHeaderToggle = narrowSettings.getByRole('checkbox', { name: 'Show player header' });
  const narrowHeaderWasChecked = await narrowHeaderToggle.isChecked();
  await narrowHeaderToggle.uncheck();
  await narrowSettings.getByRole('button', { name: 'Close', exact: true }).click();
  for (const name of ['Minimise player', 'Player settings', 'Download track']) {
    const control = expanded.getByRole('button', { name, exact: true });
    assert.equal(await control.isVisible(), true, name + ' remains visible with the player header disabled');
    const bounds = await control.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 440 && bounds.y >= 0 && bounds.y + bounds.height <= 900, name + ' fits the narrow player');
  }
  await expanded.getByRole('button', { name: 'Player settings', exact: true }).click();
  assert.equal(await narrowHeaderToggle.isChecked(), false, 'hidden player context does not hide access to its settings');
  await narrowHeaderToggle.setChecked(narrowHeaderWasChecked);
  await narrowSettings.getByRole('button', { name: 'Close', exact: true }).click();
  await page.setViewportSize({ width: 720, height: 900 });
  const narrowStage = expanded.locator('[data-layout="nocturne"]');
  const narrowGeometry = await narrowStage.evaluate(node => {
    const art = node.querySelector('.tsugi-junction-art').getBoundingClientRect();
    return { columns: getComputedStyle(node).gridTemplateColumns.split(' ').length, artLeft: art.left, artRight: art.right, viewport: innerWidth };
  });
  assert.equal(narrowGeometry.columns, 1, 'narrow Nocturne stacks the artwork and transport');
  assert.ok(narrowGeometry.artLeft >= 0 && narrowGeometry.artRight <= narrowGeometry.viewport, 'narrow artwork fits the viewport');
  await capture('08-expanded-nocturne-narrow');
  await page.setViewportSize({ width: 1440, height: 900 });
  await expanded.getByRole('button', { name: 'Player settings', exact: true }).click();
  const matrixSettings = expanded.getByRole('dialog', { name: 'Player settings' });
  await matrixSettings.getByRole('combobox', { name: 'Pixel matrix' }).selectOption('wave');
  const eqToggle = matrixSettings.getByRole('checkbox', { name: 'Enable equalizer' });
  assert.equal(await eqToggle.isEnabled(),true,'native YouTube Music EQ is available');
  await matrixSettings.getByLabel('Sound profile').selectOption('bass');
  await eqToggle.check();
  await page.waitForFunction(() => window.__readerFixture.nativeMessages.some(m => m.action === 'dsp' && m.value === 11));
  await matrixSettings.getByRole('button', { name: 'Close', exact: true }).click();
  await expanded.locator('canvas[data-mode="wave"]').waitFor();
  await expanded.getByText('Audio-reactive dot wave',{exact:true}).waitFor();
  await capture('08-expanded-wave');
  await expanded.getByRole('button', { name: 'Player settings', exact: true }).click();
  await matrixSettings.getByRole('checkbox', { name: 'Enable equalizer' }).uncheck();
  await matrixSettings.getByRole('combobox', { name: 'Pixel matrix' }).selectOption('minimal');
  await matrixSettings.getByRole('button', { name: 'Close', exact: true }).click();
  await expanded.locator('canvas[data-ui="tsugi-pixel-matrix"][data-mode="minimal"]').waitFor();
  const upperPixels = await expanded.locator('canvas[data-mode="minimal"]').evaluate(node => {
    const data = node.getContext('2d').getImageData(0,0,node.width,Math.floor(node.height*.5)).data;
    return data.some((value,index) => index % 4 === 3 && value > 0);
  });
  assert.equal(upperPixels,false,'minimal mode does not fill the upper canvas');
  await expanded.getByRole('button', { name: 'Player settings', exact: true }).click();
  assert.equal(await expanded.getByRole('combobox', { name: 'Pixel matrix' }).inputValue(), 'minimal');
  await expanded.getByRole('combobox', { name: 'Pixel matrix' }).selectOption('off');
  await expanded.getByRole('dialog', { name: 'Player settings' }).getByRole('button', { name: 'Close', exact: true }).click();
  assert.equal(await expanded.locator('canvas[data-ui="tsugi-pixel-matrix"]').count(), 0);
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
  await page.evaluate(() => { window.__readerFixture.transferEnabled = true; window.__readerFixture.enableMigrationPages(); });
  await mediaNav.getByRole('button', { name: 'Read', exact: true }).click();
  await rail.waitFor();
  await rail.getByRole('button', { name: 'Migrate', exact: true }).click();
  await page.getByRole('combobox', { name: 'Original title', exact: true }).selectOption('1');
  await page.getByRole('combobox', { name: 'Replacement source', exact: true }).selectOption('67890');
  await page.getByRole('button', { name: 'Search replacement', exact: true }).click();
  await page.locator('.tsugi-transfer-workspace').getByRole('button', { name: /Tsugi Original Fixture/ }).click();
  await page.getByRole('heading', { name: 'Transfer preview', exact: true }).waitFor();
  const migratePages = page.getByRole('checkbox', { name: 'Copy eligible unfinished page positions', exact: true });
  assert.equal(await migratePages.isChecked(), false, 'partial-page transfer is opt-in');
  await migratePages.check();
  await page.getByRole('button',{name:'Review tracker bindings'}).click();
  const bindingChoice=page.getByRole('checkbox',{name:'Copy these local tracker bindings'});
  assert.equal(await bindingChoice.isChecked(),false);
  await bindingChoice.check();
  await capture('10-reader-migration');
  await page.getByRole('button', { name: 'Copy progress and keep original', exact: true }).click();
  await page.getByText(/Replacement verified. Original retained/).waitFor();
  assert.ok(await page.evaluate(()=>window.__readerFixture.requests.some(a=>a.kind==='copy-tracker-binding')));
  assert.ok(await page.evaluate(() => window.__readerFixture.requests.some(a => a.kind === 'set-library' && a.id === 3 && a.inLibrary)));
  assert.ok(await page.evaluate(() => window.__readerFixture.requests.some(a => a.kind === 'restore-manga-progress' && a.id === 3 && a.changes.length === 1 && a.changes[0].page === 2)));
  assert.equal(await page.evaluate(() => window.__readerFixture.requests.some(a => a.kind === 'restore-manga-progress' && a.id === 3 && a.changes.some(c => c.markRead))), false);
  await page.evaluate(() => { window.__readerFixture.migrationPages = false; });
  assert.ok(await page.evaluate(()=>{const state=window.__readerFixture;const shelf=state.categories.find(row=>row.name==='Recovered shelf');return !!shelf&&state.requests.some(a=>a.kind==='assign-category'&&a.mangaId===3&&a.categoryId===shelf.id&&a.assigned);}), 'migration copies the recovered category');
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
  const batchInput = page.getByRole('textbox', { name: 'Titles to import', exact: true });
  const diskPicker = page.getByLabel('Choose import file', { exact: true });
  const csv = 'title,status\nTsugi Original Fixture,read\nBatch Fixture,unread\n';
  await diskPicker.setInputFiles({ name: 'batch.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await page.getByText('batch.csv', { exact: true }).waitFor();
  assert.equal(await page.getByRole('combobox', { name: 'Import format', exact: true }).inputValue(), 'csv');
  assert.equal(await batchInput.inputValue(), csv);
  await diskPicker.setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"backupManga": [', 'utf8') });
  await page.getByRole('alert').waitFor();
  assert.equal(await batchInput.inputValue(), csv, 'invalid file cannot replace accepted input');
  await diskPicker.setInputFiles({ name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from([0xc3, 0x28]) });
  await page.getByRole('alert').waitFor();
  assert.equal(await batchInput.inputValue(), csv);
  const json = JSON.stringify({ backupManga: [{ title: 'Tsugi Original Fixture' }, { title: 'Batch Fixture' }] });
  await diskPicker.setInputFiles({ name: 'batch.json', mimeType: 'application/json', buffer: Buffer.from(json, 'utf8') });
  await page.getByText('batch.json', { exact: true }).waitFor();
  assert.equal(await page.getByRole('combobox', { name: 'Import format', exact: true }).inputValue(), 'mihon');
  assert.equal(await batchInput.inputValue(), json);
  await diskPicker.setInputFiles({ name: 'large.csv', mimeType: 'text/csv', buffer: Buffer.alloc(2_000_001, 65) });
  await page.getByText('Import files must be 2 MB or smaller.', { exact: true }).waitFor();
  assert.equal(await batchInput.inputValue(), json, 'oversized file leaves current draft intact');
  await page.getByRole('button', { name: 'Find matches', exact: true }).click();
  await page.getByText('Search complete. Review the matches before adding.', { exact: true }).waitFor();
  assert.equal(await page.locator('.tsugi-batch-row').count(), 2, 'file import still uses the existing reviewed match flow');
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
  await landing.locator('.tsugi-world-card[data-world="read"]').click();
  await page.locator('[data-page="read"] .tsugi-reading-rail').getByRole('button',{name:'Books',exact:true}).click();
  await books.locator('.tsugi-manga-card').filter({hasText:'Tsugi Original EPUB'}).waitFor();
  await books.locator('.tsugi-manga-card').filter({hasText:'Tsugi PDF Fixture'}).click();
  await books.getByRole('button',{name:'Resume reading',exact:true}).click();
  await bookReader.getByRole('spinbutton').waitFor();
  assert.equal(await bookReader.getByRole('spinbutton').inputValue(),'2');
  await bookReader.getByRole('button',{name:'Back to books',exact:true}).click();
  console.log('PASS: real isolated local EPUB/PDF rendering, disabled book scripts and persistent PDF resume.');
  await books.getByRole('button',{name:'App settings',exact:true}).click();
  const bookSettings=page.getByRole('dialog');
  const bookBackup=bookSettings.getByRole('region',{name:'Book progress backup',exact:true});
  const bookExportEvent=page.waitForEvent('download');
  await bookBackup.getByRole('button',{name:'Export book progress',exact:true}).click();
  const bookExported=await bookExportEvent;
  assert.equal(bookExported.suggestedFilename(),'tsugi-book-progress.json');
  const bookData=JSON.parse(await readFile(await bookExported.path(),'utf8'));
  const pdfProgress=bookData.books.find(row=>row.format==='pdf');
  assert.equal(pdfProgress.progress.position,2);
  assert.match(pdfProgress.sha256,/^[a-f0-9]{64}$/);
  await bookSettings.getByRole('button',{name:'Close',exact:true}).click();
  await books.locator('.tsugi-manga-card').filter({hasText:'Tsugi PDF Fixture'}).click();
  await books.getByRole('button',{name:'Remove from library',exact:true}).click();
  await books.getByRole('button',{name:'Remove saved copy',exact:true}).click();
  // The card is absent while its details are open, so a detached-card wait
  // alone does not establish that the asynchronous deletion finished.
  await books.getByRole('heading',{name:'Your collection',exact:false}).waitFor();
  await books.locator('.tsugi-library-summary strong').filter({hasText:/^1$/}).waitFor();
  await books.locator('.tsugi-manga-card').filter({hasText:'Tsugi PDF Fixture'}).waitFor({state:'detached'});
  await books.getByLabel('Choose ebook files').setInputFiles({name:'Tsugi PDF Fixture.pdf',mimeType:'application/pdf',buffer:pdfFixture()});
  await books.locator('.tsugi-library-summary strong').filter({hasText:/^2$/}).waitFor();
  await books.locator('.tsugi-manga-card').filter({hasText:'Tsugi PDF Fixture'}).getByText('Not started',{exact:true}).waitFor();
  await books.getByRole('button',{name:'App settings',exact:true}).click();
  const freshExportEvent=page.waitForEvent('download');
  await bookBackup.getByRole('button',{name:'Export book progress',exact:true}).click();
  const freshExport=await freshExportEvent;
  const freshData=JSON.parse(await readFile(await freshExport.path(),'utf8'));
  const freshPdf=freshData.books.find(row=>row.format==='pdf');
  assert.notEqual(freshPdf.id,pdfProgress.id,'PDF was reimported with a fresh identity');
  assert.equal(freshPdf.sha256,pdfProgress.sha256,'identical file bytes');
  assert.equal(freshPdf.progress,null,'newly imported file has no reading progress');
  await bookBackup.locator('input[type=file]').setInputFiles({name:'books.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bookData))});
  await bookBackup.getByRole('heading',{name:'Book restore preview',exact:true}).waitFor();
  assert.match(await bookBackup.locator('dl').innerText(),/Ready to restore\s+1/,'restore preview must match exactly one fresh book');
  await bookBackup.getByRole('button',{name:'Restore matched book progress',exact:true}).click();
  await bookBackup.getByText('Matched book metadata and progress restored. Existing files were not replaced.',{exact:true}).waitFor();
  await bookSettings.getByRole('button',{name:'Close',exact:true}).click();
  await books.locator('.tsugi-manga-card').filter({hasText:'Tsugi PDF Fixture'}).getByText('100%',{exact:true}).waitFor();
  await books.locator('.tsugi-manga-card').filter({hasText:'Tsugi PDF Fixture'}).click();
  await books.getByRole('button',{name:'Resume reading',exact:true}).click();
  await bookReader.getByRole('spinbutton').waitFor();
  assert.equal(await bookReader.getByRole('spinbutton').inputValue(),'2');
  await bookReader.getByRole('button',{name:'Back to books',exact:true}).click();
  console.log('PASS: content-matched book progress restored to a freshly imported PDF.');
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
  await page.locator('[data-ui="vault-book-import-review"]').getByRole('button',{name:'Confirm import',exact:true}).click();
  await nativeQueue.locator('[data-vault-import-state="imported"]').waitFor();
  await nativeQueue.getByRole('button',{name:'Open Books',exact:true}).click();
  await books.locator('.tsugi-manga-card').filter({hasText:'Vault imported fixture'}).waitFor();
  await books.locator('[data-ui="tsugi-desktop-rail"]').getByRole('button',{name:'Vault',exact:true}).click();
  await nativeQueue.getByRole('button',{name:'Open Books',exact:true}).click();
  await books.locator('.tsugi-manga-card').filter({hasText:'Vault imported fixture'}).waitFor();
  assert.equal(await books.locator('.tsugi-manga-card').filter({hasText:'Vault imported fixture'}).count(),1);
  await books.locator('[data-ui="tsugi-desktop-rail"]').getByRole('button',{name:'Vault',exact:true}).click();
  await nativeQueue.getByRole('button',{name:'Open in Music',exact:true}).click();
  await music.getByText('Vault imported audio',{exact:true}).waitFor();
  console.log('PASS: completed Vault file import into persistent Books and session Music; duplicate book guarded.');
  await page.evaluate(()=>localStorage.setItem('tsugi-startup-area-v1',JSON.stringify('welcome')));
  await page.goto(origin+'/?readerSetup=1',{waitUntil:'domcontentloaded'});
  await landing.locator('.tsugi-world-card[data-world="read"]').click();
  const setup=page.locator('[data-page="read-setup"]');
  await setup.getByRole('heading',{name:'Mihon-compatible extensions',exact:true}).waitFor();
  await setup.getByText("Already use Mihon, Komikku or another Tachiyomi-compatible fork? Tsugi supports the same compatible extension repositories. After setup, add a trusted repository URL in Settings → Browse → Sources → Extension repositories, then install individual extensions from Extensions. Sources are not bundled, and compatibility varies by extension.",{exact:true}).waitFor();
  const bannerWidth = await setup.locator(':scope > .yomi-banner').evaluate(el => el.getBoundingClientRect().width);
  const cardWidth = await setup.locator(':scope > section:not(.yomi-banner)').evaluate(el => el.getBoundingClientRect().width);
  assert.ok(Math.abs(bannerWidth - cardWidth) < 2, `Reader setup card and artwork banner must share a width: ${bannerWidth} vs ${cardWidth}`);
  await capture('13-reader-setup-compatibility');
  assert.deepEqual(errors, []);
  // Each verifier creates its own browser page and owns its cleanup. Preserve
  // every assertion, but report all independent regression failures in one run.
  const independentFailures = [];
  for (const [name, verify] of [
    ['verifyLandscapeDecorationBrowser', () => verifyLandscapeDecorationBrowser({ browser, origin, installDesktopFixture, screenshotDir })],
    ['verifyAppSeparatorsBrowser', () => verifyAppSeparatorsBrowser({ browser, origin, installDesktopFixture, screenshotDir })],
    ['verifyMoviesLayoutBrowser', () => verifyMoviesLayoutBrowser({ browser, origin, installDesktopFixture, screenshotDir })],
    ['verifyMusicAudioBrowser', () => verifyMusicAudioBrowser({ browser, origin, installDesktopFixture, screenshotDir })],
    ['verifyMusicReactivityBrowser', () => verifyMusicReactivityBrowser({ browser, origin, installDesktopFixture })],
    ['verifyUpNextBrowser', () => verifyUpNextBrowser({ browser, origin, installDesktopFixture })],
    ['verifyMusicArtworkBrowser', () => verifyMusicArtworkBrowser({ browser, origin, installDesktopFixture, screenshotDir })],
    ['verifyMusicPlayerLayoutBrowser', () => verifyMusicPlayerLayoutBrowser({ browser, origin, installDesktopFixture, screenshotDir })],
    ['verifyMusicLyricsBrowser', () => verifyMusicLyricsBrowser({ browser, origin, installDesktopFixture, screenshotDir })],
    ['verifyBrushHeadingsBrowser', () => verifyBrushHeadingsBrowser({ browser, origin, installDesktopFixture, screenshotDir })],
    ['verifyYouTubeSessionBrowser', () => verifyYouTubeSessionBrowser({ browser, origin, installDesktopFixture, screenshotDir })],
    ['verifySoundCloudBrowser', () => verifySoundCloudBrowser({ browser, origin, installDesktopFixture })],
    ['verifyRestoreSessionBrowser', () => verifyRestoreSessionBrowser({ browser, origin, installDesktopFixture, screenshotDir })],
    ['verifyExtensionUpdatesBrowser', () => verifyExtensionUpdatesBrowser({ browser, origin, installDesktopFixture, screenshotDir })],
    ['verifyMihonImportBrowser', () => verifyMihonImportBrowser({ browser, origin, installDesktopFixture, screenshotDir })],
    ['verifyMalMangaBrowser', () => verifyMalMangaBrowser({ browser, origin, installDesktopFixture, screenshotDir })],
    ['verifyMihonReconstructionBrowser', () => verifyMihonReconstructionBrowser({ browser, origin, installDesktopFixture })],
    ['verifyDiscordPresenceBrowser', () => verifyDiscordPresenceBrowser({ browser, origin, installDesktopFixture, screenshotDir })],
    ['verifyDownloadCleanupBrowser', () => verifyDownloadCleanupBrowser({ browser, origin, installDesktopFixture, screenshotDir })],
    ['verifyReaderCacheCleanupBrowser', () => verifyReaderCacheCleanupBrowser({ browser, origin, installDesktopFixture, screenshotDir })],
    ['verifyReaderReleaseBrowser', () => verifyReaderReleaseBrowser({ browser, origin, installDesktopFixture })],
    ['verifySourceFeedBrowser', () => verifySourceFeedBrowser({ browser, origin, installDesktopFixture, screenshotDir })],
    ['verifySourceMetadataBrowser', () => verifySourceMetadataBrowser({ browser, origin, installDesktopFixture, screenshotDir })],
    ['verifySourceSettingsBrowser', () => verifySourceSettingsBrowser({ browser, origin, installDesktopFixture, screenshotDir })],
    ['verifySourceIconsBrowser', () => verifySourceIconsBrowser({ browser, origin, installDesktopFixture, screenshotDir })],
    ['verifyReaderSettingsSearchBrowser', () => verifyReaderSettingsSearchBrowser({ browser, origin, installDesktopFixture, screenshotDir })],
    ['verifyReaderRepositoriesBrowser', () => verifyReaderRepositoriesBrowser({ browser, origin, installDesktopFixture, screenshotDir })],
    ['verifyVaultBookImportsBrowser', () => verifyVaultBookImportsBrowser({ browser, origin, installDesktopFixture, screenshotDir })],
    ['verifyVaultAudioImportsBrowser', () => verifyVaultAudioImportsBrowser({ browser, origin, installDesktopFixture })],
    ['verifySupportSummaryBrowser', () => verifySupportSummaryBrowser({ browser, origin, installDesktopFixture, screenshotDir })],
    ['verifyReaderDownloadsBrowser', () => verifyReaderDownloadsBrowser({ browser, origin, installDesktopFixture, screenshotDir })],
    ['verifyLocalComicImportBrowser', () => verifyLocalComicImportBrowser({ browser, origin, installDesktopFixture, screenshotDir })],
  ]) {
    try { await verify(); }
    catch (error) {
      console.error(`FAIL: ${name}`, error);
      independentFailures.push(new Error(name, { cause: error }));
    }
  }
  if (independentFailures.length) throw new AggregateError(independentFailures, `${independentFailures.length} independent browser regression(s) failed`);
} finally { await browser.close(); }
