// Actual Settings UI and metadata capture with synthetic native download
// ownership/results. Native filesystem and Windows confirmation are tested
// separately; this helper never removes files from the host running the test.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

function installCleanupFixture() {
  if (window.top !== window) return;
  localStorage.setItem('tsugi-onboarding-complete-v1', 'true');
  localStorage.setItem('fixture-cleanup-private-token', 'fixture-value-never-export');
  const host = window.aiostreamsApp, state = window.__readerFixture;
  const send = host.send.bind(host), subscribe = host.subscribe.bind(host), listeners = new Set();
  const hash = value => value.toString(16).padStart(64, '0');
  const mangaIdentity = hash(1);
  state.cleanup = {
    items: Array.from({ length: 103 }, (_, index) => ({ chapterId: 1001 + index, mangaId: 1, mangaIdentity, chapterIdentity: hash(1001 + index),
      mangaTitle: 'Tsugi Original Fixture', chapterName: 'Downloaded chapter ' + (index + 1), sourceName: 'Original fixture (EN)',
      bytes: 4096 + index, files: index % 2 ? 1 : 4, format: index % 2 ? 'cbz' : 'folder' })),
    sequence: 0, review: null, mode: 'success', readbackFailure: false, opened: new Set(), calls: [], applied: [], refused: [],
  };
  const data = state.cleanup;
  data.metadata = { id: 1, identity: mangaIdentity, sourceId: '12345', title: 'Tsugi Original Fixture', categories: [],
    chapters: data.items.map(item => ({ id: item.chapterId, identity: item.chapterIdentity, name: item.chapterName, isRead: true, isBookmarked: false,
      lastPageRead: 3, pageCount: 4, lastReadAt: '1700000000' })) };
  host.subscribe = listener => { listeners.add(listener); const remove = subscribe(listener); return () => { listeners.delete(listener); remove(); }; };
  const respond = (type, request, result, error = null) => queueMicrotask(() => { for (const listener of listeners) listener({ type, request, data: result, error }); });
  host.send = message => {
    if (message.type === 'backup-request') {
      if (message.action.kind === 'save') data.calls.push('backup-save');
      if (message.action.kind === 'open') {
        data.calls.push('backup-open');
        if (data.readbackFailure) { respond('backup-result', message.request, { archive: 'damaged fixture copy' }); return; }
        data.opened.add(message.action.name);
      }
      return send(message);
    }
    if (message.type !== 'read-request') return send(message);
    const action = message.action;
    if (action.kind === 'backup-manga' && action.id === 1) { respond('read-result', message.request, structuredClone(data.metadata)); return; }
    if (!['download-cleanup-candidates', 'review-download-cleanup', 'apply-download-cleanup', 'cancel-download-cleanup'].includes(action.kind)) return send(message);
    data.calls.push(action.kind); state.requests.push(action);
    try {
      if (document.querySelector('[data-ui="tsugi-book-reader"], .tsugi-chapter-reader') || localStorage.getItem('tsugi-portable-restore-session-v1') !== null)
        throw Error('Fixture cleanup must not run during an open reader or restore');
      if (action.kind === 'download-cleanup-candidates') {
        data.review = null;
        respond('read-result', message.request, { items: structuredClone(data.items.slice(action.offset, action.offset + 100)),
          totalCount: data.items.length, totalBytes: data.items.reduce((sum, item) => sum + item.bytes, 0), offset: action.offset }); return;
      }
      if (action.kind === 'review-download-cleanup') {
        if (!action.ids.length || action.ids.length > 50 || new Set(action.ids).size !== action.ids.length) throw Error('Invalid fixture selection');
        const selected = action.ids.map(id => data.items.find(item => item.chapterId === id));
        if (selected.some(item => !item)) throw Error('Stale fixture selection');
        data.review = { reviewId: (++data.sequence).toString(16).padStart(32, '0'), items: structuredClone(selected), totalBytes: selected.reduce((sum, item) => sum + item.bytes, 0) };
        respond('read-result', message.request, structuredClone(data.review)); return;
      }
      const reviewed = data.review;
      if (!reviewed || reviewed.reviewId !== action.reviewId) throw Error('The cleanup review expired or the Reader restarted. Review the selection again.');
      data.review = null;
      if (action.kind === 'cancel-download-cleanup') { respond('read-result', message.request, { reviewId: action.reviewId, cancelled: true }); return; }
      const latest = state.managedBackups?.at(-1);
      if (!latest || !data.opened.has(latest.row.name)) throw Error('Fixture cleanup requires a saved and reopened backup');
      const archive = JSON.parse(latest.archive), manga = JSON.parse(archive.entries.find(entry => entry.kind === 'manga').payload).manga;
      for (const item of reviewed.items) {
        const chapter = manga.find(row => row.identity === item.mangaIdentity)?.chapters.find(row => row.identity === item.chapterIdentity);
        if (!chapter?.isRead || chapter.isBookmarked) throw Error('Fixture cleanup backup must cover the selected chapter');
      }
      if (data.mode === 'cancel') { respond('read-result', message.request, { reviewId: action.reviewId, cancelled: true }); return; }
      if (data.mode === 'stale') { respond('read-result', message.request, null, 'The reviewed downloads or reading state changed. Review the selection again.'); return; }
      if (data.mode === 'expired') { respond('read-result', message.request, null, 'The cleanup review expired or the Reader restarted. Review the selection again.'); return; }
      let stopped = false;
      const results = reviewed.items.map((item, index) => {
        if (stopped) return { chapterId: item.chapterId, status: 'not-attempted', bytes: 0 };
        if (data.mode === 'partial' && index === 1) { stopped = true; return { chapterId: item.chapterId, status: 'failed', bytes: 0, error: 'The downloaded files remain. Review this chapter again.' }; }
        data.items = data.items.filter(row => row.chapterId !== item.chapterId); data.applied.push(item.chapterId);
        return { chapterId: item.chapterId, status: 'removed', bytes: item.bytes };
      });
      respond('read-result', message.request, { reviewId: action.reviewId, items: results, removedCount: results.filter(item => item.status === 'removed').length,
        removedBytes: results.reduce((sum, item) => sum + item.bytes, 0), metadataPreserved: true });
    } catch (reason) { data.refused.push(reason.message); respond('read-result', message.request, null, reason.message); }
  };
}

export async function verifyDownloadCleanupBrowser({ browser, origin, installDesktopFixture, screenshotDir }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-GB', reducedMotion: 'reduce' });
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript({ content: `(${installDesktopFixture.toString()})();(${installCleanupFixture.toString()})();` });
    await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'App settings', exact: true }).click();
    const storage = page.getByRole('region', { name: 'Storage management', exact: true });
    const cleanup = storage.getByRole('region', { name: 'Downloaded chapter cleanup', exact: true });
    const scan = () => cleanup.getByRole('button', { name: 'Find eligible chapter downloads', exact: true }).click();
    const nativeState = () => page.evaluate(() => ({ count: window.__readerFixture.cleanup.items.length, applied: [...window.__readerFixture.cleanup.applied],
      calls: [...window.__readerFixture.cleanup.calls], copies: window.__readerFixture.managedBackups?.length ?? 0, metadata: window.__readerFixture.cleanup.metadata,
      journal: localStorage.getItem('tsugi-portable-restore-session-v1') }));
    const selected = () => cleanup.getByRole('list', { name: 'Eligible downloaded chapters', exact: true }).getByRole('checkbox');
    const review = cleanup.getByRole('region', { name: 'Chapter download removal review', exact: true });
    const prepare = async count => {
      await scan();
      await selected().first().waitFor();
      for (let index = 0; index < count; index++) await selected().nth(index).check();
      await cleanup.getByRole('button', { name: 'Review selected downloads', exact: true }).click();
      await review.waitFor();
    };
    const apply = () => review.getByRole('button', { name: 'Remove reviewed chapter downloads', exact: true }).click();
    await scan();
    await cleanup.getByRole('status').filter({ hasText: 'Eligible chapters: 103' }).waitFor();
    assert.equal(await selected().count(), 100);
    const tones = await cleanup.getByRole('list', { name: 'Eligible downloaded chapters', exact: true }).locator('li').evaluateAll(rows => rows.slice(0, 2).map(row => ({
      background: getComputedStyle(row).backgroundColor, border: getComputedStyle(row).borderBottomWidth,
    })));
    assert.notEqual(tones[0].background, tones[1].background, 'chapter rows use alternating tonal surfaces');
    assert.ok(tones.every(row => row.border === '0px'), 'chapter rows have no separator lines');
    await selected().first().check();
    await cleanup.getByRole('button', { name: 'Next download page', exact: true }).click();
    await cleanup.getByText('Showing 101–103 of 103. Select up to 50 chapters on this page.', { exact: true }).waitFor();
    assert.equal(await selected().count(), 3); assert.equal(await selected().evaluateAll(rows => rows.filter(row => row.checked).length), 0);
    assert.equal(await cleanup.getByRole('button', { name: 'Review selected downloads', exact: true }).isDisabled(), true, 'changing pages clears selection');
    await cleanup.getByRole('button', { name: 'Previous download page', exact: true }).click();
    await cleanup.getByText('Showing 1–100 of 103. Select up to 50 chapters on this page.', { exact: true }).waitFor();

    await prepare(2);
    assert.equal((await nativeState()).copies, 0, 'listing and review do not create a backup or remove media');
    assert.equal((await nativeState()).applied.length, 0);
    if (screenshotDir) {
      await mkdir(screenshotDir, { recursive: true }); await review.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(screenshotDir, 'chapter-download-review.png'), animations: 'disabled' });
    }
    await review.getByRole('button', { name: 'Cancel chapter cleanup review', exact: true }).click();
    await cleanup.getByRole('status').filter({ hasText: 'Download cleanup cancelled.' }).waitFor();
    assert.equal((await nativeState()).copies, 0);
    assert.equal((await nativeState()).count, 103);

    await prepare(1);
    await page.evaluate(() => { window.__readerFixture.cleanup.mode = 'cancel'; });
    await apply();
    await cleanup.getByRole('status').filter({ hasText: 'Download cleanup cancelled.' }).waitFor();
    assert.equal((await nativeState()).copies, 1, 'Windows cancellation keeps the verified metadata copy');
    assert.equal((await nativeState()).count, 103);
    assert.equal((await nativeState()).journal, null);

    await prepare(1);
    await page.evaluate(() => { window.__readerFixture.cleanup.mode = 'success'; window.__readerFixture.cleanup.readbackFailure = true; });
    const beforeBadCopy = await nativeState();
    await apply();
    await cleanup.getByRole('alert').filter({ hasText: 'metadata safety backup could not be saved and verified' }).waitFor();
    assert.equal((await nativeState()).calls.filter(value => value === 'apply-download-cleanup').length,
      beforeBadCopy.calls.filter(value => value === 'apply-download-cleanup').length, 'failed readback never dispatches removal');
    assert.equal((await nativeState()).count, 103);
    await page.evaluate(() => { window.__readerFixture.cleanup.readbackFailure = false; });

    await prepare(1);
    await page.evaluate(() => { window.__readerFixture.cleanup.mode = 'stale'; });
    await apply();
    await cleanup.getByRole('alert').filter({ hasText: 'download list changed' }).waitFor();
    assert.equal((await nativeState()).count, 103);
    assert.equal(await review.count(), 0, 'a stale native review cannot be reused');

    await storage.getByRole('button', { name: 'Scan app storage', exact: true }).click();
    await storage.getByText('App data measured', { exact: true }).waitFor();
    await prepare(1);
    const beforeSuccess = await nativeState();
    await page.evaluate(() => { window.__readerFixture.cleanup.mode = 'success'; });
    await apply();
    await cleanup.getByRole('status').filter({ hasText: 'Verified removal: 1 chapter downloads' }).waitFor();
    const succeeded = await nativeState();
    assert.equal(succeeded.count, 102); assert.deepEqual(succeeded.applied, [1001]);
    assert.deepEqual(succeeded.metadata, beforeSuccess.metadata, 'read/bookmark/page/history state is unchanged');
    assert.equal(succeeded.journal, null, 'a safety backup does not leave an unfinished restore journal');
    assert.equal(await storage.getByText('App data measured', { exact: true }).count(), 0, 'successful removal invalidates old storage totals');
    const saved = await page.evaluate(() => window.__readerFixture.managedBackups.at(-1));
    assert.equal(JSON.parse(saved.archive).entries.length, 4);
    assert.ok(!saved.archive.includes('fixture-value-never-export'), 'credentials outside the archive allowlist are excluded');
    await cleanup.getByText(saved.row.name, { exact: true }).waitFor();

    await prepare(3);
    await page.evaluate(() => { window.__readerFixture.cleanup.mode = 'partial'; });
    await apply();
    await cleanup.getByText('The batch stopped at the first failure. Refresh the list and review any remaining downloads before trying again.', { exact: true }).waitFor();
    const results = cleanup.getByRole('list', { name: 'Chapter cleanup results', exact: true });
    await results.getByText('Removed', { exact: true }).waitFor();
    await results.getByText('Removal could not be verified', { exact: true }).waitFor();
    await results.getByText('Not attempted', { exact: true }).waitFor();
    const partial = await nativeState();
    assert.equal(partial.count, 101); assert.deepEqual(partial.applied, [1001, 1002]);
    assert.deepEqual(partial.metadata, beforeSuccess.metadata);

    const beforeReader = await nativeState();
    await page.evaluate(() => { const reader = document.createElement('div'); reader.className = 'tsugi-chapter-reader'; reader.id = 'cleanup-open-reader'; reader.hidden = true; document.body.appendChild(reader); });
    await scan();
    await cleanup.getByRole('alert').filter({ hasText: 'Close the current book or chapter' }).waitFor();
    assert.deepEqual((await nativeState()).calls, beforeReader.calls, 'a hidden Reader still blocks native cleanup requests');
    await page.evaluate(() => { document.getElementById('cleanup-open-reader').remove(); localStorage.setItem('tsugi-portable-restore-session-v1', '{damaged'); window.dispatchEvent(new Event('tsugi-restore-session-change')); });
    await cleanup.getByRole('status').filter({ hasText: 'Resolve the saved restore record' }).waitFor();
    assert.equal(await cleanup.getByRole('button', { name: 'Find eligible chapter downloads', exact: true }).isDisabled(), true);
    await page.evaluate(() => { localStorage.removeItem('tsugi-portable-restore-session-v1'); window.dispatchEvent(new Event('tsugi-restore-session-change')); });
    assert.deepEqual(await page.evaluate(() => window.__readerFixture.cleanup.refused), []);
    assert.deepEqual(errors, []);
    console.log('PASS: chapter cleanup pagination, tonal selection/review, cancellation, verified backup, stale/partial results and open-reader/restore guards.');
  } finally { await page.close(); }
}

// A native video deep link can unmount Read even while its local controls are
// disabled. Exercise a delayed chapter reply without ever mounting its reader.
async function verifyTsugiUpdateNotice({browser,origin,installDesktopFixture}){
  for(const status of ['newer-release','different-build']){
    const page=await browser.newPage({viewport:{width:1440,height:900},locale:'en-GB'});
    try{
      await page.addInitScript({content:`(${installDesktopFixture.toString()})();(function(){
        if(window.top!==window)return;
        localStorage.setItem('tsugi-onboarding-complete-v1','true');
        localStorage.setItem('tsugi-startup-area-v1',JSON.stringify('welcome'));
        const host=window.aiostreamsApp,send=host.send.bind(host),subscribe=host.subscribe.bind(host),listeners=new Set();
        window.__releaseChecks=0;
        host.subscribe=listener=>{listeners.add(listener);const remove=subscribe(listener);return()=>{listeners.delete(listener);remove();};};
        host.send=message=>{
          if(message.type!=='tsugi-release-check')return send(message);
          window.__releaseChecks++;
          const data={latestTag:'v0.2.0',latestCommit:'a'.repeat(40),currentCommit:'c'.repeat(40),status:${JSON.stringify(status)},packageBytes:12345,sha256:'b'.repeat(64),notes:'Original test release'};
          queueMicrotask(()=>{for(const listener of listeners)listener({type:'tsugi-release-result',request:message.request,data,error:null});});
        };
      })();`});
      await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
      await page.goto(origin,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>window.__releaseChecks===1);
      const notice=page.locator('[data-ui="tsugi-update-notice"]');
      if(status==='newer-release'){
        await notice.waitFor();
        const link=notice.getByRole('link',{name:'Open official release',exact:true});
        assert.equal(await link.getAttribute('href'),'https://github.com/G1NYU/TSUGI/releases/tag/v0.2.0');
        assert.equal(await link.getAttribute('rel'),'noopener noreferrer');
        await notice.getByRole('button',{name:'Later',exact:true}).click();
        await notice.waitFor({state:'hidden'});
      }else{
        await page.waitForTimeout(300);
        assert.equal(await notice.count(),0,'a different build is not an advertised upgrade');
      }
      assert.equal(await page.evaluate(()=>window.__releaseChecks),1);
    }finally{await page.close();}
  }
  console.log('PASS: startup Tsugi release notice offers only a proven newer release, links to GitHub, and dismisses without downloading.');
}

export async function verifyReaderReleaseBrowser({ browser, origin, installDesktopFixture }) {
  await verifyTsugiUpdateNotice({browser,origin,installDesktopFixture});
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-GB' });
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript({ content: `(${installDesktopFixture.toString()})();(${installCleanupFixture.toString()})();localStorage.setItem('tsugi-startup-area-v1',JSON.stringify('read'));` });
    await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    const read = page.locator('[data-page="read"]');
    await read.locator('.tsugi-manga-card').filter({ hasText: 'Tsugi Original Fixture' }).click();
    await page.evaluate(() => { window.__readerFixture.deferChapterReply = true; });
    await read.getByRole('button', { name: 'Start or resume reading', exact: true }).click();
    await page.waitForFunction(() => typeof window.__readerFixture.completeChapterOpen === 'function');
    await page.evaluate(() => window.__readerFixture.emitLink('aiostreams://search?q=original-fixture'));
    await read.waitFor({ state: 'detached' });
    await page.evaluate(() => { window.__readerFixture.failCloseOnce = true; window.__readerFixture.completeChapterOpen(); });
    await page.waitForFunction(() => window.__readerFixture.requests.some(action => action.kind === 'close-chapter'));
    assert.notEqual(await page.evaluate(() => window.__readerFixture.activeChapter), null, 'failed late release remains pending');
    assert.equal(await page.locator('.tsugi-chapter-reader').count(), 0, 'late reply cannot recreate an unmounted Reader');
    await page.getByRole('button', { name: 'App settings', exact: true }).click();
    const cleanup = page.getByRole('region', { name: 'Downloaded chapter cleanup', exact: true });
    await cleanup.getByRole('button', { name: 'Find eligible chapter downloads', exact: true }).click();
    await cleanup.getByRole('status').filter({ hasText: 'Eligible chapters: 103' }).waitFor();
    assert.equal(await page.evaluate(() => window.__readerFixture.activeChapter), null, 'cleanup retries the exact pending release before inventory');
    assert.equal(await page.evaluate(() => window.__readerFixture.requests.filter(action => action.kind === 'close-chapter').length), 2);
    await page.getByRole('dialog', { name: 'App settings', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Read', exact: true }).click();
    await read.locator('.tsugi-manga-card').filter({ hasText: 'Tsugi Original Fixture' }).click();
    await page.evaluate(() => { window.__readerFixture.deferChapterReply = false; window.__readerFixture.invalidChapterPages = true; });
    await read.getByRole('button', { name: 'Start or resume reading', exact: true }).click();
    await read.getByRole('alert').filter({ hasText: 'This chapter has no supported pages.' }).waitFor();
    assert.equal(await page.evaluate(() => window.__readerFixture.activeChapter), null, 'a rejected chapter response releases its valid native session');
    assert.deepEqual(errors, []);
    console.log('PASS: delayed chapter replies after native video navigation and invalid chapter pages release their exact session; a failed release retries before cleanup.');
  } finally { await page.close(); }
}
