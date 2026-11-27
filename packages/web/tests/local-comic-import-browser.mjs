// The native picker/validator is an authored fixture; real CBZ validation has
// separate native tests. This exercises the actual review and existing Reader.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

function installLocalComicImportFixture() {
  if (window.top !== window) return;
  localStorage.setItem('tsugi-onboarding-complete-v1', 'true');
  localStorage.setItem('tsugi-startup-area-v1', JSON.stringify('read'));
  localStorage.setItem('tsugi-reader-preferences', JSON.stringify({ mode: 'single', fit: 'height', resume: true, width: 80, gap: true, rtl: false, focus: false, autoNext: false, wheelZoom: true, background: 'ink' }));
  const host = window.aiostreamsApp, base = window.__readerFixture;
  const manga = { id: 91, sourceId: '0', title: 'Original offline comic', author: null, inLibrary: true, categories: { nodes: [] } };
  const chapter = { id: 901, name: 'Original local chapter', chapterNumber: 1, sourceOrder: 0, pageCount: 4, lastPageRead: 0, isRead: false, isBookmarked: false, isDownloaded: true };
  const original = { id: 1, sourceId: '12345', title: 'Tsugi Original Fixture', inLibrary: true, categories: { nodes: [] } };
  const fixture = window.__localComicImportFixture = { calls: [], serial: 0, review: null, nextBegin: 'review', nextApply: 'confirmed', published: false, registered: false, copies: 0, manga, chapter };
  base.categories = [{ id: 7, name: 'Local originals', order: 1 }];
  const send = host.send.bind(host), subscribe = host.subscribe.bind(host), listeners = new Set();
  host.subscribe = listener => { listeners.add(listener); const remove = subscribe(listener); return () => { listeners.delete(listener); remove(); }; };
  const emit = (request, data, error = null) => queueMicrotask(() => { for (const listener of listeners) listener({ type: 'read-result', request, data, error }); });
  host.send = message => {
    if (message.type !== 'read-request') return send(message);
    const action = message.action;
    fixture.calls.push(structuredClone(action));
    if (action.kind === 'begin-local-import' || action.kind === 'begin-vault-comic-import') {
      if (action.kind === 'begin-local-import' && Object.keys(action).join(',') !== 'kind') throw new Error('Web supplied an unexpected picker argument');
      if (action.kind === 'begin-vault-comic-import' && (Object.keys(action).sort().join(',') !== 'jobId,kind' || action.jobId !== 'vault-comic-fixture')) throw new Error('Web supplied an unexpected Vault comic argument');
      fixture.review = null;
      const outcome = fixture.nextBegin; fixture.nextBegin = 'review';
      if (outcome === 'cancelled') return emit(message.request, { cancelled: true });
      if (outcome === 'invalid') return emit(message.request, null, 'The CBZ archive could not be safely imported. Choose a supported PNG/JPEG archive within the import limits.');
      const reviewId = (++fixture.serial).toString(16).padStart(32, '0');
      fixture.review = { reviewId, title: manga.title, archiveSha256: 'c'.repeat(64), archiveBytes: 8192, expandedBytes: 32768, pageCount: 4, duplicate: fixture.published };
      return emit(message.request, { ...fixture.review, ignoredPrivatePath: 'private-path-marker-must-not-appear' });
    }
    if (action.kind === 'cancel-local-import') {
      const cancelled = fixture.review?.reviewId === action.reviewId;
      if (cancelled) fixture.review = null;
      return emit(message.request, { reviewId: action.reviewId, cancelled });
    }
    if (action.kind === 'apply-local-import') {
      if (Object.keys(action).sort().join(',') !== 'kind,reviewId') throw new Error('Web supplied file paths or changed import metadata');
      const review = fixture.review; fixture.review = null;
      if (!review || review.reviewId !== action.reviewId) return emit(message.request, null, 'The CBZ import review expired or changed. Choose the archive again.');
      const outcome = fixture.nextApply; fixture.nextApply = 'confirmed';
      if (outcome === 'stale') return emit(message.request, null, 'The CBZ import review expired or changed. Choose the archive again.');
      if (outcome === 'cancelled') return emit(message.request, { reviewId: action.reviewId, status: 'cancelled' });
      if (!fixture.published) { fixture.published = true; fixture.copies++; }
      if (outcome === 'partial') return emit(message.request, { reviewId: action.reviewId, status: 'published-unregistered', title: manga.title, pageCount: 4 });
      fixture.registered = true;
      if (outcome === 'lost') return emit(message.request, null, 'private-provider-or-file-marker-must-not-appear');
      return emit(message.request, { reviewId: action.reviewId, status: review.duplicate ? 'already-imported' : 'imported', mangaId: manga.id, title: manga.title, pageCount: 4 });
    }
    if (action.kind === 'library') {
      const nodes = [original, ...(fixture.registered ? [structuredClone(manga)] : [])];
      return emit(message.request, { nodes, totalCount: nodes.length });
    }
    if ((action.kind === 'cached-manga' || action.kind === 'manga') && action.id === manga.id) {
      return emit(message.request, { manga: structuredClone(manga), chapters: [structuredClone(chapter)] });
    }
    if (action.kind === 'chapter-flags' && action.ids.includes(chapter.id)) {
      if (typeof action.bookmarked === 'boolean') chapter.isBookmarked = action.bookmarked;
      if (typeof action.read === 'boolean') chapter.isRead = action.read;
      return emit(message.request, { chapters: [structuredClone(chapter)] });
    }
    if (action.kind === 'progress' && action.chapterId === chapter.id) { chapter.lastPageRead = action.index; chapter.isRead ||= action.finished; }
    return send(message);
  };
}

export async function verifyLocalComicImportBrowser({ browser, origin, installDesktopFixture, screenshotDir }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-GB', reducedMotion: 'reduce' });
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const read = page.locator('[data-page="read"]');
  const dialog = page.getByRole('dialog', { name: 'Import local comic', exact: true });
  const reader = page.locator('.tsugi-chapter-reader');
  const calls = kind => page.evaluate(kind => window.__localComicImportFixture.calls.filter(action => action.kind === kind), kind);
  const frames = () => page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
  const reviewed = async () => { await dialog.locator('[data-local-comic-review]').waitFor(); await frames(); };
  const choose = async () => { await dialog.getByRole('button', { name: 'Choose CBZ', exact: true }).click(); await reviewed(); };
  const open = async () => { await read.getByRole('button', { name: 'Import CBZ', exact: true }).click(); await dialog.waitFor(); };
  const backToLibrary = async () => {
    await reader.getByRole('button', { name: 'Chapters', exact: true }).click(); await reader.waitFor({ state: 'hidden' });
    await read.getByRole('button', { name: 'Back', exact: true }).click();
    await read.getByRole('button', { name: 'Import CBZ', exact: true }).waitFor();
  };
  try {
    await page.addInitScript({ content: `(${installDesktopFixture.toString()})();(${installLocalComicImportFixture.toString()})();` });
    await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAYCAIAAAB8wupbAAAAHUlEQVR4nGOsqF3FQApgIkn1qIZRDaMaRjWQrAEA4jkBz8UryC4AAAAASUVORK5CYII=', 'base64');
    await page.route('**/__tsugi_read/page/*', route => route.fulfill({ contentType: 'image/png', body: png }));
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await read.getByRole('button', { name: 'Import CBZ', exact: true }).waitFor();
    assert.equal((await calls('begin-local-import')).length, 0, 'opening Read never opens a file picker automatically');
    await page.evaluate(() => { window.__localComicImportFixture.nextBegin = 'cancelled'; });
    await open(); await dialog.locator('[data-local-comic-result="cancelled"]').waitFor();
    assert.equal((await calls('begin-local-import')).length, 1, 'StrictMode does not duplicate the explicit picker request');
    assert.equal((await calls('apply-local-import')).length, 0);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();

    await page.evaluate(() => { window.__localComicImportFixture.nextBegin = 'invalid'; });
    await open();
    await dialog.getByRole('alert').getByText('The CBZ archive could not be safely imported. Choose a supported PNG/JPEG archive within the import limits.', { exact: true }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: 'Add to Read', exact: true }).count(), 0);
    await choose();
    await dialog.getByRole('heading', { name: 'Original offline comic', exact: true }).waitFor();
    await dialog.getByText('Portable backups save library and reading metadata. They do not include the CBZ or its page images; keep a separate copy of your original archive.', { exact: true }).waitFor();
    assert.equal(await dialog.locator('[data-local-comic-duplicate]').getAttribute('data-local-comic-duplicate'), 'false');
    assert.equal((await calls('apply-local-import')).length, 0, 'reviewing does not publish or register the comic');
    assert.ok(!(await dialog.innerText()).includes('private-path-marker'));
    const tones = await dialog.locator('dl > div').evaluateAll(rows => rows.map(row => ({ background: getComputedStyle(row).backgroundColor, border: getComputedStyle(row).borderBottomWidth })));
    assert.notEqual(tones[0].background, tones[1].background); assert.ok(tones.every(row => row.border === '0px'));
    if (screenshotDir) { await mkdir(screenshotDir, { recursive: true }); await page.screenshot({ path: join(screenshotDir, 'local-comic-import-review.png'), animations: 'disabled' }); }
    await page.setViewportSize({ width: 440, height: 900 }); await frames();
    assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, 'review has no narrow horizontal overflow');
    if (screenshotDir) await page.screenshot({ path: join(screenshotDir, 'local-comic-import-narrow.png'), animations: 'disabled' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    const cancelledReview = await dialog.locator('[data-local-comic-review]').getAttribute('data-local-comic-review');
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    assert.deepEqual(await calls('cancel-local-import'), [{ kind: 'cancel-local-import', reviewId: cancelledReview }]);
    assert.equal(await page.evaluate(() => window.__localComicImportFixture.copies), 0);

    await open(); await reviewed();
    await page.evaluate(() => { window.__localComicImportFixture.nextApply = 'cancelled'; });
    await dialog.getByRole('button', { name: 'Add to Read', exact: true }).click();
    await dialog.locator('[data-local-comic-result="cancelled"]').waitFor();
    assert.equal(await page.evaluate(() => window.__localComicImportFixture.copies), 0);
    await choose();
    await dialog.getByRole('button', { name: 'Add to Read', exact: true }).click();
    await dialog.locator('[data-local-comic-result="imported"]').waitFor();
    assert.equal(await dialog.getByRole('button', { name: 'Open in Reader', exact: true }).count(), 1);
    assert.equal(await reader.count(), 0, 'a confirmed new import still waits for an explicit Open action');
    await choose(); await page.evaluate(() => { window.__localComicImportFixture.nextApply = 'partial'; });
    await dialog.getByRole('button', { name: 'Use existing copy', exact: true }).click();
    await dialog.locator('[data-local-comic-result="published-unregistered"]').waitFor();
    assert.equal(await dialog.getByRole('button', { name: 'Open in Reader', exact: true }).count(), 0);
    const partialApplies = (await calls('apply-local-import')).length; await frames();
    assert.equal((await calls('apply-local-import')).length, partialApplies, 'partial registration does not replay the consumed review');
    assert.equal(await page.evaluate(() => window.__localComicImportFixture.copies), 1);
    await choose();
    assert.equal(await dialog.locator('[data-local-comic-duplicate]').getAttribute('data-local-comic-duplicate'), 'true');
    await dialog.getByRole('button', { name: 'Use existing copy', exact: true }).focus(); await page.keyboard.press('Enter');
    await dialog.locator('[data-local-comic-result="already-imported"]').waitFor();
    assert.equal(await page.evaluate(() => window.__localComicImportFixture.copies), 1, 'retry reuses already-published media');
    assert.equal(await reader.count(), 0, 'adding a comic does not open it without a separate action');
    assert.equal((await calls('cached-manga')).filter(action => action.id === 91).length, 0);
    await dialog.getByRole('button', { name: 'Open existing comic', exact: true }).click();
    await reader.locator('[data-reader-page="0"] img').waitFor();
    assert.equal(await reader.getAttribute('data-mode'), 'single');
    assert.equal((await calls('cached-manga')).filter(action => action.id === 91).length, 1);
    assert.equal((await calls('manga')).filter(action => action.id === 91).length, 0, 'opening a local comic uses cached metadata');
    await reader.getByRole('button', { name: 'Next page', exact: true }).click();
    await reader.locator('[data-reader-page="1"] img').waitFor();
    await reader.getByRole('button', { name: 'Chapters', exact: true }).click(); await reader.waitFor({ state: 'hidden' });
    await read.getByRole('button', { name: 'Bookmark chapter', exact: true }).click();
    await read.getByRole('button', { name: 'Remove bookmark', exact: true }).waitFor();
    await page.evaluate(() => { window.__localComicImportFixture.manga.categories.nodes = [{ id: 7 }]; });
    const retained = await page.evaluate(() => ({ chapter: structuredClone(window.__localComicImportFixture.chapter), categories: structuredClone(window.__localComicImportFixture.manga.categories) }));
    assert.equal(retained.chapter.lastPageRead, 1); assert.equal(retained.chapter.isBookmarked, true);
    await read.getByRole('button', { name: 'Back', exact: true }).click();

    await open(); await reviewed();
    const progressBefore = (await calls('progress')).length, flagsBefore = (await calls('chapter-flags')).length;
    await dialog.getByRole('button', { name: 'Use existing copy', exact: true }).click();
    await dialog.locator('[data-local-comic-result="already-imported"]').waitFor();
    assert.deepEqual(await page.evaluate(() => ({ chapter: window.__localComicImportFixture.chapter, categories: window.__localComicImportFixture.manga.categories })), retained);
    assert.equal((await calls('progress')).length, progressBefore); assert.equal((await calls('chapter-flags')).length, flagsBefore);
    assert.equal(await page.evaluate(() => window.__localComicImportFixture.copies), 1);
    await dialog.getByRole('button', { name: 'Open existing comic', exact: true }).click();
    await reader.locator('[data-reader-page="1"] img').waitFor();
    assert.equal(await reader.locator('[data-reader-page="0"]').count(), 0, 'duplicate import resumes the existing saved page');
    if (screenshotDir) await page.screenshot({ path: join(screenshotDir, 'local-comic-existing-reader.png'), animations: 'disabled' });
    await backToLibrary();
    assert.equal(await read.locator('.tsugi-manga-card').filter({ hasText: 'Original offline comic' }).count(), 1);

    await open(); await reviewed();
    await page.evaluate(() => { window.__localComicImportFixture.nextApply = 'lost'; });
    const beforeLost = (await calls('apply-local-import')).length;
    await dialog.getByRole('button', { name: 'Use existing copy', exact: true }).click();
    await dialog.getByRole('alert').getByText('The import result could not be confirmed. Check your library, or choose the same CBZ again for a fresh review. The import was not repeated automatically.', { exact: true }).waitFor();
    assert.equal((await calls('apply-local-import')).length, beforeLost + 1);
    assert.equal(await dialog.getByRole('button', { name: 'Use existing copy', exact: true }).count(), 0);
    assert.ok(!(await dialog.innerText()).includes('private-provider-or-file-marker'));
    await choose(); await page.evaluate(() => { window.__localComicImportFixture.nextApply = 'stale'; });
    await dialog.getByRole('button', { name: 'Use existing copy', exact: true }).click();
    await dialog.getByRole('alert').getByText('The CBZ import review expired or changed. Choose the archive again.', { exact: true }).waitFor();
    assert.equal(await dialog.locator('[data-local-comic-review]').count(), 0);
    await choose(); await dialog.getByRole('button', { name: 'Use existing copy', exact: true }).click();
    await dialog.locator('[data-local-comic-result="already-imported"]').waitFor();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__localComicImportFixture.copies), 1);
    assert.equal((await calls('catalogue')).length, 0); assert.equal((await calls('set-library')).length, 0);
    assert.equal((await calls('enqueue-downloads')).length, 0);
    // The completed download enters the same review without opening a picker,
    // sending a path or using the webview byte-transfer route.
    const pickerCount = (await calls('begin-local-import')).length;
    const applyCount = (await calls('apply-local-import')).length;
    let vaultReads = 0;
    await page.route('**/__tsugi_vault/file/*', route => { vaultReads++; return route.abort(); });
    await page.evaluate(() => {
      window.__readerFixture.vaultJobs = [
        { id: 'vault-comic-fixture', vault_title: 'Original offline comic.cbz', state: 'done', bytes: 8192, total: 8192, error: null },
        { id: 'vault-comic-pending', vault_title: 'Pending.cbz', state: 'queued', bytes: 0, total: null, error: null },
      ];
    });
    await read.locator('[data-ui="tsugi-desktop-rail"]').getByRole('button', { name: 'Vault', exact: true }).click();
    const vault = page.locator('[data-page="vault"]');
    const complete = vault.locator('[data-vault-job-id="vault-comic-fixture"]');
    await complete.getByRole('button', { name: 'Import into Read', exact: true }).waitFor();
    assert.equal(await vault.locator('[data-vault-job-id="vault-comic-pending"]').getByRole('button', { name: 'Import into Read', exact: true }).count(), 0);
    assert.equal(await complete.getByRole('button', { name: 'Open in Music', exact: true }).count(), 0);
    await complete.getByRole('button', { name: 'Import into Read', exact: true }).click();
    await reviewed();
    assert.deepEqual(await calls('begin-vault-comic-import'), [{ kind: 'begin-vault-comic-import', jobId: 'vault-comic-fixture' }]);
    assert.equal((await calls('begin-local-import')).length, pickerCount);
    assert.equal((await calls('apply-local-import')).length, applyCount);
    await dialog.getByRole('button', { name: 'Review Vault comic again', exact: true }).click();
    await reviewed();
    await dialog.getByRole('button', { name: 'Use existing copy', exact: true }).click();
    await dialog.locator('[data-local-comic-result="already-imported"]').waitFor();
    assert.equal(vaultReads, 0);
    assert.equal(await page.evaluate(() => window.__localComicImportFixture.copies), 1);
    await dialog.getByRole('button', { name: 'Open existing comic', exact: true }).click();
    await reader.locator('[data-reader-page="1"] img').waitFor();
    await backToLibrary();
    assert.deepEqual(errors, []);
    console.log('PASS: explicit CBZ picker/review, tonal metadata and backup limits, cancellation/invalid/partial/stale/uncertain recovery without replay, duplicate preservation and existing Reader resume without catalogue requests.');
  } finally { await page.close(); }
}
