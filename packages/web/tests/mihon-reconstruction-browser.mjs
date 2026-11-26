// Actual file decode/review/apply UI with a controlled native capability.
// Native protocol and recovery are verified separately by the JVM fixture.
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { mihonFixture, mangaWire, bytes, message, integer } from './mihon-fixture.mjs';

function installReconstructionFixture() {
  if (window.top !== window) return;
  localStorage.setItem('tsugi-onboarding-complete-v1', 'true');
  localStorage.setItem('tsugi-startup-area-v1', JSON.stringify('read'));
  const host = window.aiostreamsApp, send = host.send.bind(host), subscribe = host.subscribe.bind(host), listeners = new Set();
  const state = window.__mihonReconstruction = { calls: [], review: null, serial: 0, outcome: 'imported', imports: 0 };
  host.subscribe = listener => { listeners.add(listener); const stop = subscribe(listener); return () => { listeners.delete(listener); stop(); }; };
  const respond = (request, data, error = null) => queueMicrotask(() => { for (const listener of listeners) listener({ type: 'read-result', request, data, error }); });
  host.send = message => {
    const action = message.type === 'read-request' ? message.action : null;
    if (!action || !['review-mihon-import', 'apply-mihon-import', 'cancel-mihon-import'].includes(action.kind)) return send(message);
    state.calls.push(structuredClone(action));
    if (action.kind === 'review-mihon-import') {
      if (localStorage.getItem('tsugi-portable-restore-session-v1')) throw Error('Native import must not overlap a portable restore');
      const reviewId = String(++state.serial).padStart(32, '0');
      const rows = action.input.manga.map(row => ({ title: row.title, sourceId: row.sourceId, state: state.imports ? 'merge' : 'new', chapters: state.imports ? 0 : row.chapters.length, history: state.imports ? 0 : row.chapters.length, trackers: action.input.includeTrackers && !state.imports ? row.trackers.length : 0, trackerConflicts: 0, partialSkipped: 1 }));
      state.review = { reviewId, rows, categories: action.input.categories, includesTrackers: action.input.includeTrackers, includesPartialPages: action.input.includePartialPages };
      return respond(message.request, structuredClone(state.review));
    }
    if (action.kind === 'cancel-mihon-import') { state.review = null; return respond(message.request, { cancelled: true }); }
    if (Object.keys(action).sort().join(',') !== 'kind,reviewId') throw Error('Only a native-owned capability may be applied');
    if (!state.review || state.review.reviewId !== action.reviewId) return respond(message.request, null, 'stale review');
    const rows = state.review.rows; state.review = null;
    if (state.outcome === 'lost') return respond(message.request, null, 'private-error-marker');
    if (state.outcome === 'imported') state.imports++;
    respond(message.request, { status: state.outcome, checkpointId: 'native-private-copy', rows });
  };
}

export async function verifyMihonReconstructionBrowser({ browser, origin, installDesktopFixture }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-GB', reducedMotion: 'reduce' });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(20000);
  try {
    await page.addInitScript({ content: `(${installDesktopFixture.toString()})();(${installReconstructionFixture.toString()})();` });
    await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-page="read"]').getByRole('button', { name: /Tsugi Original Fixture/ }).first().waitFor();
    await page.getByRole('button', { name: 'App settings', exact: true }).click();
    const mihon = page.getByRole('region', { name: 'Mihon backup import', exact: true });
    const complete = mihon.getByRole('region', { name: 'Complete Mihon library import', exact: true });
    const extra = message(18, bytes(integer(1, 1), integer(100, 44)));
    const file = gzipSync(mihonFixture({ manga: [mangaWire({ extra }), mangaWire({ url: '/private?token=private-identity-marker', title: 'Private identity title' })] }));
    await mihon.getByLabel('Choose a Mihon backup', { exact: true }).setInputFiles({ name: 'authored.tachibk', mimeType: 'application/gzip', buffer: file });
    await complete.waitFor();
    assert.equal(await page.evaluate(() => window.__mihonReconstruction.calls.length), 0, 'decoding never dispatches native reconstruction');
    assert.ok(!(await mihon.innerText()).includes('private-identity-marker'));
    assert.equal(await complete.getByRole('checkbox', { name: /Import MyAnimeList/ }).isChecked(), false);
    await complete.getByRole('checkbox', { name: /Import MyAnimeList/ }).check();
    const review = async () => { await complete.getByRole('button', { name: 'Review complete library import', exact: true }).click(); await complete.getByRole('button', { name: 'Apply complete library import', exact: true }).waitFor(); };
    await review();
    const calls = await page.evaluate(() => window.__mihonReconstruction.calls);
    assert.equal(calls[0].input.manga.length, 1, 'unsafe raw identities never cross the native bridge');
    assert.ok(!JSON.stringify(calls).includes('private-identity-marker'));
    assert.equal(calls[0].input.includeTrackers, true);
    assert.equal(await page.evaluate(() => window.__mihonReconstruction.imports), 0);
    await complete.getByRole('button', { name: 'Cancel import review', exact: true }).click();
    await complete.getByRole('status').filter({ hasText: 'The import was cancelled.' }).waitFor();
    assert.equal(await page.evaluate(() => window.__mihonReconstruction.imports), 0);
    await review();
    const previousRequests = await page.evaluate(() => window.__readerFixture.requests.length);
    await complete.getByRole('button', { name: 'Apply complete library import', exact: true }).focus(); await page.keyboard.press('Enter');
    await complete.getByRole('status').filter({ hasText: 'The reviewed library import was verified after restart.' }).waitFor();
    assert.equal(await page.evaluate(() => window.__mihonReconstruction.imports), 1);
    await page.waitForFunction(start => {
      const kinds = window.__readerFixture.requests.slice(start).map(action => action.kind);
      return ['library', 'categories', 'history', 'updates'].every(kind => kinds.includes(kind));
    }, previousRequests);
    await page.evaluate(() => { window.__mihonReconstruction.outcome = 'rolled-back'; });
    await review(); await complete.getByRole('button', { name: 'Apply complete library import', exact: true }).click();
    await complete.getByRole('alert').filter({ hasText: 'The previous Reader metadata was restored.' }).waitFor();
    await page.evaluate(() => { window.__mihonReconstruction.outcome = 'lost'; });
    await review(); await complete.getByRole('button', { name: 'Apply complete library import', exact: true }).click();
    await complete.getByRole('alert').filter({ hasText: 'The import was not confirmed.' }).waitFor();
    assert.ok(!(await mihon.innerText()).includes('private-error-marker'));
    assert.equal(await complete.getByRole('button', { name: 'Apply complete library import', exact: true }).count(), 0, 'failed or consumed capabilities cannot be replayed');
    assert.deepEqual(errors, []);
    console.log('PASS: complete Mihon import uses explicit native review/apply, excludes private identities, preserves tracker opt-in and reports cancellation, rollback and uncertain completion.');
  } finally { await page.close(); }
}
