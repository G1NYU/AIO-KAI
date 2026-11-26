// Real Settings controls with an original, deterministic native cache fixture.
// Filesystem ownership and JVM restart are verified by the native runtime tests.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

function installImageCacheFixture() {
  if (window.top !== window) return;
  localStorage.setItem('tsugi-onboarding-complete-v1', 'true');
  localStorage.setItem('fixture-cache-private-session', 'private-fixture-kept');
  const host = window.aiostreamsApp, state = window.__readerFixture;
  const send = host.send.bind(host), subscribe = host.subscribe.bind(host), listeners = new Set();
  const data = state.imageCleanup = { sequence: 0, review: null, calls: [], mode: 'success', removals: 0, restarts: 0,
    groups: [{ kind: 'pages', files: 2, bytes: 8192 }, { kind: 'thumbnails', files: 1, bytes: 1024 }] };
  data.reset = () => { data.mode = 'success'; data.review = null; data.groups = [{ kind: 'pages', files: 2, bytes: 8192 }, { kind: 'thumbnails', files: 1, bytes: 1024 }]; };
  host.subscribe = listener => { listeners.add(listener); const remove = subscribe(listener); return () => { listeners.delete(listener); remove(); }; };
  const respond = (request, result, error = null) => queueMicrotask(() => { for (const listener of listeners) listener({ type: 'read-result', request, data: result, error }); });
  host.send = message => {
    if (message.type !== 'read-request' || !['review-image-cache-cleanup', 'apply-image-cache-cleanup', 'cancel-image-cache-cleanup'].includes(message.action.kind)) return send(message);
    const action = message.action;
    data.calls.push(structuredClone(action)); state.requests.push(action);
    try {
      if (document.querySelector('[data-ui="tsugi-book-reader"], .tsugi-chapter-reader') || localStorage.getItem('tsugi-portable-restore-session-v1') !== null)
        throw Error('Fixture must not receive image cleanup while a reader or restore is active');
      if (action.kind === 'review-image-cache-cleanup') {
        if (Object.keys(action).length !== 1) throw Error('Image review does not accept paths');
        const groups = structuredClone(data.groups);
        data.review = { reviewId: (++data.sequence).toString(16).padStart(32, '0'), groups,
          totalFiles: groups.reduce((sum, group) => sum + group.files, 0), totalBytes: groups.reduce((sum, group) => sum + group.bytes, 0), expiresInSeconds: 600 };
        respond(message.request, data.mode === 'invalid-review' ? { ...data.review, totalBytes: data.review.totalBytes + 1 } : structuredClone(data.review)); return;
      }
      if (Object.keys(action).length !== 2 || typeof action.reviewId !== 'string') throw Error('Only an opaque review ID may be applied');
      const review = data.review;
      if (!review || review.reviewId !== action.reviewId) throw Error('Expired fixture review');
      data.review = null;
      if (action.kind === 'cancel-image-cache-cleanup' || data.mode === 'cancel') { respond(message.request, { reviewId: review.reviewId, status: 'cancelled' }); return; }
      if (data.mode === 'stale') { respond(message.request, null, 'The Reader image cache changed or the review expired. Review the cache again. No images were removed.'); return; }
      if (data.mode === 'expired') { respond(message.request, null, 'The Reader image cache review is no longer available. Review the cache again. No images were removed.'); return; }
      const partial = data.mode === 'partial';
      const groups = review.groups.map(group => ({ kind: group.kind,
        removedFiles: partial ? group.kind === 'pages' ? 1 : 0 : group.files,
        removedBytes: partial ? group.kind === 'pages' ? 4096 : 0 : group.bytes }));
      for (let index = 0; index < groups.length; index++) { data.groups[index].files -= groups[index].removedFiles; data.groups[index].bytes -= groups[index].removedBytes; }
      data.removals++; data.restarts++;
      if (data.mode === 'lost-reply') { respond(message.request, null, 'Synthetic interrupted native response'); return; }
      respond(message.request, { reviewId: review.reviewId, status: partial ? 'partial' : 'removed', groups,
        removedFiles: groups.reduce((sum, group) => sum + group.removedFiles, 0), removedBytes: groups.reduce((sum, group) => sum + group.removedBytes, 0),
        runtimeReady: data.mode !== 'restart-failed', message: data.mode === 'tainted-result' ? 'C:/Users/private-fixture/cache' : partial ? 'Some temporary images remain. Review the cache again.' : 'Reviewed temporary images were removed.' });
    } catch (reason) { respond(message.request, null, reason.message); }
  };
}

export async function verifyReaderCacheCleanupBrowser({ browser, origin, installDesktopFixture, screenshotDir }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-GB', reducedMotion: 'reduce' });
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const capture = async name => {
    if (!screenshotDir) return;
    await mkdir(screenshotDir, { recursive: true });
    await page.screenshot({ path: join(screenshotDir, name + '.png'), animations: 'disabled' });
  };
  try {
    await page.addInitScript({ content: `(${installDesktopFixture.toString()})();(${installImageCacheFixture.toString()})();` });
    await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'App settings', exact: true }).click();
    const storage = page.getByRole('region', { name: 'Storage management', exact: true });
    const cleanup = storage.getByRole('region', { name: 'Temporary Reader images', exact: true });
    const review = cleanup.getByRole('region', { name: 'Temporary image removal review', exact: true });
    const scan = cleanup.getByRole('button', { name: 'Review temporary Reader images', exact: true });
    const apply = () => review.getByRole('button', { name: 'Remove reviewed temporary images', exact: true }).click();
    const cancel = () => review.getByRole('button', { name: 'Cancel image cleanup review', exact: true }).click();
    const state = () => page.evaluate(() => ({ groups: structuredClone(window.__readerFixture.imageCleanup.groups), calls: [...window.__readerFixture.imageCleanup.calls],
      removals: window.__readerFixture.imageCleanup.removals, restarts: window.__readerFixture.imageCleanup.restarts,
      copies: window.__readerFixture.managedBackups?.length ?? 0, privateSession: localStorage.getItem('fixture-cache-private-session'), journal: localStorage.getItem('tsugi-portable-restore-session-v1') }));
    const prepare = async (mode = 'success') => {
      await page.evaluate(mode => { const data = window.__readerFixture.imageCleanup; data.reset(); data.mode = mode; }, mode);
      await scan.click(); await review.waitFor();
    };
    await prepare();
    await review.getByText('Temporary images selected: 3 files (9.0 KiB).', { exact: true }).waitFor();
    assert.deepEqual((await state()).calls, [{ kind: 'review-image-cache-cleanup' }]);
    assert.equal((await state()).removals, 0); assert.equal((await state()).restarts, 0);
    assert.equal((await state()).copies, 0, 'reviewing regenerable images does not create a metadata backup');
    const surface = await cleanup.evaluate(node => ({ background: getComputedStyle(node).backgroundColor, image: getComputedStyle(node).backgroundImage }));
    assert.deepEqual(surface, { background: 'rgba(0, 0, 0, 0)', image: 'none' }, 'cleanup section retains the unframed Settings design');
    assert.ok(await review.locator('dl > div').evaluateAll(rows => rows.length === 2 && rows.every(row =>
      getComputedStyle(row).backgroundColor === 'rgba(0, 0, 0, 0)' && getComputedStyle(row).backgroundImage === 'none')), 'read-only counts have no decorative row panels');
    await review.getByText('1 file · 1.0 KiB', { exact: true }).waitFor();
    await review.getByText('2 files · 8.0 KiB', { exact: true }).waitFor();
    await review.scrollIntoViewIfNeeded(); await capture('reader-image-cache-review-1440');
    await page.setViewportSize({ width: 390, height: 844 });
    await review.scrollIntoViewIfNeeded();
    const bounds = await review.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391, 'review fits the narrow viewport');
    assert.ok(await cleanup.evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'cache scope and counts wrap without horizontal overflow');
    await review.getByRole('button', { name: 'Remove reviewed temporary images', exact: true }).focus();
    await page.keyboard.press('Tab');
    assert.equal(await review.getByRole('button', { name: 'Cancel image cleanup review', exact: true }).evaluate(node => node === document.activeElement), true);
    await capture('reader-image-cache-review-390');
    await page.keyboard.press('Enter');
    await cleanup.getByRole('status').filter({ hasText: 'Image cleanup cancelled.' }).waitFor();
    assert.equal((await state()).removals, 0); assert.equal((await state()).restarts, 0);
    await page.setViewportSize({ width: 1440, height: 1000 });

    await prepare('cancel'); await apply();
    await cleanup.getByRole('status').filter({ hasText: 'Image cleanup cancelled.' }).waitFor();
    assert.equal((await state()).removals, 0, 'native confirmation cancellation leaves the cache intact');

    for (const mode of ['stale', 'expired']) {
      await prepare(mode); const before = await state(); await apply();
      await cleanup.getByRole('alert').filter({ hasText: 'No images were removed.' }).waitFor();
      assert.ok(!(await cleanup.innerText()).includes('result could not be confirmed'), 'an exact pre-write refusal has a known no-removal outcome');
      assert.equal((await state()).removals, before.removals, `${mode} review does not remove images`);
      assert.equal((await state()).calls.length, before.calls.length + 1, `${mode} apply is never automatically replayed`);
      assert.equal(await review.count(), 0, `${mode} requires a new review`);
    }

    await page.evaluate(() => { window.__readerFixture.imageCleanup.reset(); window.__readerFixture.imageCleanup.mode = 'invalid-review'; });
    await scan.click();
    await cleanup.getByRole('alert').filter({ hasText: 'review could not be verified' }).waitFor();
    assert.equal(await review.count(), 0, 'invalid accounting cannot enable removal');

    await prepare();
    await storage.getByRole('button', { name: 'Scan app storage', exact: true }).click();
    await storage.getByText('App data measured', { exact: true }).waitFor();
    await storage.getByText('Reader browser data', { exact: true }).waitFor();
    const beforeSuccess = await state(); await apply();
    await cleanup.getByRole('status').filter({ hasText: 'Verified removal: 3 temporary image files (9.0 KiB).' }).waitFor();
    const succeeded = await state();
    assert.equal(succeeded.removals, beforeSuccess.removals + 1); assert.equal(succeeded.restarts, beforeSuccess.restarts + 1);
    assert.equal(succeeded.privateSession, 'private-fixture-kept'); assert.equal(succeeded.journal, null); assert.equal(succeeded.copies, 0);
    assert.ok(succeeded.groups.every(group => group.files === 0 && group.bytes === 0));
    assert.equal(await storage.getByText('App data measured', { exact: true }).count(), 0, 'removal invalidates stale storage totals');
    await scan.click(); await review.getByText('Temporary images selected: 0 files (0 B).', { exact: true }).waitFor();
    assert.equal(await review.getByRole('button', { name: 'Remove reviewed temporary images', exact: true }).count(), 0);
    await cancel(); await review.waitFor({ state: 'hidden' });

    await page.evaluate(() => { window.__readerFixture.imageCleanup.groups = [{ kind: 'pages', files: 1, bytes: 4096 }, { kind: 'thumbnails', files: 0, bytes: 0 }]; });
    await scan.click(); await review.getByText('Temporary images selected: 1 file (4.0 KiB).', { exact: true }).waitFor();
    await cancel(); await review.waitFor({ state: 'hidden' });

    await prepare('partial'); await apply();
    await cleanup.getByRole('status').filter({ hasText: 'Verified removal: 1 temporary image file (4.0 KiB).' }).waitFor();
    assert.ok(await cleanup.getByRole('region', { name: 'Temporary image cleanup result', exact: true }).locator('dl > div').evaluateAll(rows => rows.length === 2 && rows.every(row =>
      getComputedStyle(row).backgroundColor === 'rgba(0, 0, 0, 0)' && getComputedStyle(row).backgroundImage === 'none')), 'verified result counts remain unframed');
    await cleanup.getByRole('alert').filter({ hasText: 'Some temporary images could not be removed or verified.' }).waitFor();
    assert.deepEqual((await state()).groups, [{ kind: 'pages', files: 1, bytes: 4096 }, { kind: 'thumbnails', files: 1, bytes: 1024 }]);

    for (const mode of ['lost-reply', 'tainted-result']) {
      await prepare(mode); const before = await state(); await apply();
      await cleanup.getByRole('alert').filter({ hasText: 'removal result could not be confirmed' }).waitFor();
      const after = await state();
      assert.equal(after.calls.length, before.calls.length + 1, 'an uncertain dispatched operation is never replayed');
      assert.equal(await cleanup.getByRole('region', { name: 'Temporary image cleanup result', exact: true }).count(), 0, 'uncertainty cannot show a verified success');
      assert.ok(!(await cleanup.innerText()).includes('private-fixture'), 'private native values are never rendered');
    }

    const beforeGuard = await state();
    await page.evaluate(() => { const reader = document.createElement('div'); reader.className = 'tsugi-chapter-reader'; reader.id = 'image-cleanup-active-reader'; reader.hidden = true; document.body.appendChild(reader); });
    await scan.click(); await cleanup.getByRole('alert').filter({ hasText: 'Close the current book or chapter' }).waitFor();
    assert.deepEqual((await state()).calls, beforeGuard.calls, 'a hidden chapter still blocks native image cleanup');
    await page.evaluate(() => { document.getElementById('image-cleanup-active-reader').remove(); localStorage.setItem('tsugi-portable-restore-session-v1', '{damaged'); window.dispatchEvent(new Event('tsugi-restore-session-change')); });
    await cleanup.getByRole('status').filter({ hasText: 'Resolve the saved restore record' }).waitFor();
    assert.equal(await scan.isDisabled(), true);
    await page.evaluate(() => { localStorage.removeItem('tsugi-portable-restore-session-v1'); window.dispatchEvent(new Event('tsugi-restore-session-change')); });
    await page.evaluate(() => { window.__imageCleanupLock = navigator.locks.request('tsugi-portable-restore', () => new Promise(resolve => { window.__imageCleanupUnlock = resolve; })); });
    await page.waitForFunction(() => typeof window.__imageCleanupUnlock === 'function');
    await scan.click(); await cleanup.getByRole('alert').filter({ hasText: 'Another backup, restore or cleanup operation is running.' }).waitFor();
    assert.deepEqual((await state()).calls, beforeGuard.calls, 'a competing lock blocks native dispatch');
    await page.evaluate(() => { window.__imageCleanupUnlock(); return window.__imageCleanupLock; });

    await prepare('restart-failed'); await apply();
    await cleanup.getByRole('status').filter({ hasText: 'Verified removal: 3 temporary image files (9.0 KiB).' }).waitFor();
    await cleanup.getByRole('alert').filter({ hasText: 'Reader did not restart.' }).waitFor();
    assert.equal(await scan.isDisabled(), true, 'the failed runtime must be recovered by restarting Tsugi before another cleanup');
    assert.ok((await state()).groups.every(group => group.files === 0), 'restart failure does not conceal independently verified removal');
    assert.deepEqual(errors, []);
    console.log('PASS: reviewed temporary Reader image cleanup, exact scope/accounting, cancellation, stale/partial/uncertain outcomes, restart failure, restore/reader locks and narrow keyboard layout.');
  } catch (error) {
    await capture('reader-image-cache-failure').catch(() => {});
    throw error;
  } finally { await page.close(); }
}
