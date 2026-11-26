// Real importer UI and gzip/protobuf decoding with a synthetic native bridge.
// The native identity vectors are computed independently with Node SHA256.
// Physical Android-exported backup acceptance remains a separate check.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fixtureChapters, fixtureIdentity, mihonFixture } from './mihon-fixture.mjs';

function nativeIdentity(domain, first, second) {
  const hash = createHash('sha256');
  for (const value of [domain, first, second]) {
    const text = Buffer.from(value), size = Buffer.alloc(8);
    size.writeBigUInt64BE(BigInt(text.length));
    hash.update(size).update(text);
  }
  return hash.digest('hex');
}

function installMihonFixture(model) {
  if (window.top !== window) return;
  localStorage.setItem('tsugi-onboarding-complete-v1', 'true');
  const host = window.aiostreamsApp, state = window.__readerFixture;
  const send = host.send.bind(host), subscribe = host.subscribe.bind(host);
  const listeners = new Set();
  state.mihon = model;
  state.categories = [{ id: 1, name: 'Reading', order: 1 }, { id: 2, name: 'Unrelated shelf', order: 2 }];
  state.categorySequence = 2;
  // Seed the base fixture's category membership, then exclude setup from the
  // observation log. Actual import creates/assigns through its normal bridge.
  send({ type: 'read-request', request: 'mihon-fixture-seed', action: { kind: 'assign-category', mangaId: 1, categoryId: 2, assigned: true } });
  state.requests = [];
  host.subscribe = listener => {
    listeners.add(listener);
    const remove = subscribe(listener);
    return () => { listeners.delete(listener); remove(); };
  };
  const respond = (request, data, error = null) => queueMicrotask(() => {
    for (const listener of listeners) listener({ type: 'read-result', request, data, error });
  });
  const checkpoint = kind => {
    const journal = JSON.parse(localStorage.getItem('tsugi-portable-restore-session-v1') ?? 'null');
    if (!journal || journal.steps.find(step => step.kind === kind)?.state !== 'running') throw Error('Mihon fixture mutation requires a running checkpoint step');
    for (const name of [journal.source.name, journal.recovery.name]) {
      if (!state.managedBackups?.some(copy => copy.row.name === name)) throw Error('Mihon fixture mutation requires both saved copies');
    }
  };
  host.send = message => {
    if (message.type !== 'read-request') return send(message);
    const action = message.action;
    if (action.kind === 'backup-manga' && action.id === 1) {
      state.requests.push(action);
      const data = { ...state.mihon.manga, categories: state.categories.filter(row => state.mihon.categoryIds.includes(row.id)).map(row => row.name) };
      respond(message.request, structuredClone(data)); return;
    }
    if (action.kind === 'restore-manga-progress') {
      state.requests.push(action);
      try {
        checkpoint('manga');
        const manga = state.mihon.manga;
        if (action.id !== manga.id || action.identity !== manga.identity || !action.changes.length || action.changes.length > 2000) throw Error('Unexpected Mihon fixture target');
        const seen = new Set();
        // Validate the entire batch before any write, mirroring the native
        // expected-state gate rather than accepting arbitrary fixture patches.
        for (const patch of action.changes) {
          const chapter = manga.chapters.find(row => row.identity === patch.identity);
          if (!chapter || seen.has(patch.identity)) throw Error('Unknown or repeated Mihon fixture chapter');
          seen.add(patch.identity);
          if (patch.expectedRead !== chapter.isRead || patch.expectedBookmarked !== chapter.isBookmarked || patch.expectedLastPage !== chapter.lastPageRead || patch.expectedPageCount !== chapter.pageCount || patch.expectedLastReadAt !== chapter.lastReadAt) throw Error('Mihon fixture progress changed since preview');
          if ((!patch.markRead && !patch.bookmark && patch.page === undefined) || (patch.markRead && chapter.isRead) || (patch.bookmark && chapter.isBookmarked) || (patch.page !== undefined && (chapter.isRead || patch.markRead || patch.page <= chapter.lastPageRead || patch.page >= chapter.pageCount))) throw Error('Mihon fixture refused a destructive patch');
        }
        for (const patch of action.changes) {
          const chapter = manga.chapters.find(row => row.identity === patch.identity);
          chapter.isRead ||= patch.markRead;
          chapter.isBookmarked ||= patch.bookmark;
          if (patch.page !== undefined) chapter.lastPageRead = patch.page;
          if (patch.markRead || patch.page !== undefined) chapter.lastReadAt = '1800000000';
        }
        state.mihon.mutations.push({ kind: action.kind, changes: structuredClone(action.changes) });
        respond(message.request, { confirmed: action.changes.length, total: action.changes.length, complete: true });
      } catch (reason) {
        state.mihon.rejected.push(reason.message);
        respond(message.request, null, reason.message);
      }
      return;
    }
    if (action.kind === 'save-category' || action.kind === 'assign-category') {
      checkpoint('categories');
      const result = send(message);
      if (action.kind === 'assign-category') {
        if (action.mangaId !== 1 || !action.assigned) throw Error('Unexpected Mihon fixture category operation');
        if (!state.mihon.categoryIds.includes(action.categoryId)) state.mihon.categoryIds.push(action.categoryId);
      }
      state.mihon.mutations.push({ kind: action.kind });
      return result;
    }
    return send(message);
  };
}

export async function verifyMihonImportBrowser({ browser, origin, installDesktopFixture, screenshotDir }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-GB', reducedMotion: 'reduce' });
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const mangaIdentity = nativeIdentity('tsugi-manga-v1', fixtureIdentity.sourceId, fixtureIdentity.url);
  const model = {
    manga: { id: 1, identity: mangaIdentity, sourceId: fixtureIdentity.sourceId, title: fixtureIdentity.title, chapters: fixtureChapters.map((row, index) => ({
      id: 11 + index, identity: nativeIdentity('tsugi-chapter-v1', mangaIdentity, row.url), name: row.name,
      isRead: false, isBookmarked: false, lastPageRead: index === 2 ? 2 : 0, pageCount: 20, lastReadAt: '0',
    })) }, categoryIds: [2], mutations: [], rejected: [],
  };
  const journal = () => page.evaluate(() => JSON.parse(localStorage.getItem('tsugi-portable-restore-session-v1')));
  const data = () => page.evaluate(() => structuredClone(window.__readerFixture.mihon));
  try {
    await page.addInitScript({ content: `(${installDesktopFixture.toString()})();(${installMihonFixture.toString()})(${JSON.stringify(model)});` });
    await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'App settings', exact: true }).click();
    const settings = page.getByRole('dialog');
    const portable = settings.getByRole('region', { name: 'Portable backup', exact: true });
    const mihon = settings.getByRole('region', { name: 'Mihon backup import', exact: true });
    const review = mihon.getByRole('region', { name: 'Review Mihon import', exact: true });
    const upload = async () => {
      await mihon.getByLabel('Choose a Mihon backup', { exact: true }).setInputFiles({ name: 'matched-fixture.tachibk', mimeType: 'application/gzip', buffer: gzipSync(mihonFixture()) });
      await mihon.getByRole('heading', { name: 'Decoded backup', exact: true }).waitFor();
      assert.equal(await mihon.getByRole('checkbox', { name: /Include eligible partial page positions/ }).isChecked(), false, 'partial pages always require opt-in for a newly chosen file');
      await mihon.getByRole('checkbox', { name: /Include eligible partial page positions/ }).check();
    };
    const prepare = async () => {
      await mihon.getByRole('button', { name: 'Prepare Mihon import checkpoint', exact: true }).click();
      await mihon.getByRole('status').filter({ hasText: 'The recovery checkpoint is saved.' }).waitFor();
      await review.getByRole('button', { name: 'Review Mihon import', exact: true }).click();
      await review.getByRole('heading', { name: 'Manga restore preview', exact: true }).waitFor();
    };
    const finish = async () => {
      await portable.getByLabel('I have reviewed the current state and want to finish this restore record.').check();
      await portable.getByRole('button', { name: 'Finish restore record', exact: true }).click();
      await portable.getByRole('status').filter({ hasText: 'Restore record finished.' }).waitFor();
      await mihon.getByRole('button', { name: 'Prepare Mihon import checkpoint', exact: true }).waitFor();
      assert.equal(await journal(), null);
    };
    const stat = async (label) => Number(await review.getByText(label, { exact: true }).locator('xpath=following-sibling::dd[1]').textContent());

    await upload();
    assert.equal(await journal(), null);
    assert.deepEqual((await data()).mutations, [], 'protobuf decoding never mutates Reader');
    await prepare();
    assert.equal(await stat('Titles ready'), 1);
    assert.equal(await stat('Missing titles'), 0);
    assert.equal(await stat('Chapter changes'), 3);
    assert.deepEqual((await data()).mutations, [], 'checkpoint capture and preview do not apply changes');
    assert.equal(await page.evaluate(() => window.__readerFixture.managedBackups.length), 2);
    if (screenshotDir) { await mkdir(screenshotDir, { recursive: true }); await mihon.screenshot({ path: join(screenshotDir, 'mihon-matched-preview.png'), animations: 'disabled' }); }

    await review.getByRole('button', { name: 'Restore matched manga progress', exact: true }).click();
    await review.getByRole('status').filter({ hasText: 'Restored progress or bookmarks for 3 chapters.' }).waitFor();
    const applied = await data();
    assert.equal(applied.manga.chapters[0].isRead, true);
    assert.equal(applied.manga.chapters[1].isBookmarked, true);
    assert.equal(applied.manga.chapters[2].lastPageRead, 7);
    assert.equal(applied.mutations[0].changes[2].expectedPageCount, 20);
    assert.equal((await journal()).steps.find(step => step.kind === 'manga').state, 'done');
    await review.getByRole('button', { name: 'Review Mihon import', exact: true }).click();
    await review.getByRole('heading', { name: 'Category restore preview', exact: true }).waitFor();
    assert.equal(await stat('Chapter changes'), 0);
    await review.getByRole('button', { name: 'Restore matched categories', exact: true }).click();
    await review.getByRole('status').filter({ hasText: 'Created 1 categories, added 2 assignments' }).waitFor();
    const first = await data();
    assert.deepEqual(first.categoryIds.slice().sort(), [1, 2, 3], 'existing unrelated shelf membership survives the merge');
    assert.deepEqual(await page.evaluate(() => window.__readerFixture.categories.map(row => row.name)), ['Reading', 'Unrelated shelf', 'Later']);
    assert.deepEqual(first.mutations.map(row => row.kind), ['restore-manga-progress', 'save-category', 'assign-category', 'assign-category']);
    assert.ok((await journal()).steps.every(step => step.state === 'done'));
    await finish();

    await upload(); await prepare();
    assert.equal(await stat('Chapter changes'), 0);
    assert.equal(await review.getByRole('button', { name: 'Restore matched manga progress', exact: true }).isEnabled(), false);
    assert.equal(await review.getByRole('button', { name: 'Restore matched categories', exact: true }).isEnabled(), false);
    assert.deepEqual((await data()).mutations, first.mutations, 'reimporting the same gzip is idempotent');
    assert.equal(await page.evaluate(() => window.__readerFixture.managedBackups.length), 4);
    await finish();

    // Model later local reading and an intentional return to unread. A fresh
    // preview must preserve both while still unioning an absent bookmark.
    await page.evaluate(() => {
      const chapters = window.__readerFixture.mihon.manga.chapters;
      chapters[0].isRead = false; chapters[0].lastReadAt = '1900000000';
      chapters[1].isBookmarked = false; chapters[1].lastReadAt = '1900000000';
      chapters[2].lastPageRead = 9; chapters[2].lastReadAt = '1900000000';
    });
    await upload(); await prepare();
    assert.equal(await stat('Chapter changes'), 1);
    assert.equal(await stat('Newer or incompatible positions kept'), 1);
    await review.getByRole('button', { name: 'Restore matched manga progress', exact: true }).click();
    await review.getByRole('status').filter({ hasText: 'Restored progress or bookmarks for 1 chapters.' }).waitFor();
    const newer = await data();
    assert.equal(newer.manga.chapters[0].isRead, false);
    assert.equal(newer.manga.chapters[0].lastReadAt, '1900000000');
    assert.equal(newer.manga.chapters[1].isBookmarked, true);
    assert.equal(newer.manga.chapters[2].lastPageRead, 9);
    assert.deepEqual(newer.mutations.at(-1).changes.map(patch => ({ markRead: patch.markRead, bookmark: patch.bookmark, page: patch.page })), [{ markRead: false, bookmark: true, page: undefined }]);
    await finish();
    assert.deepEqual(newer.rejected, []);
    assert.deepEqual(errors, []);
    console.log('PASS: matched Mihon gzip import, guarded read/bookmark/page/category merge, idempotent reimport and newer local progress preservation.');
  } catch (reason) {
    console.error('Matched Mihon fixture alerts:', await page.getByRole('alert').allTextContents());
    if (screenshotDir) { await mkdir(screenshotDir, { recursive: true }); await page.screenshot({ path: join(screenshotDir, 'mihon-matched-failure.png'), animations: 'disabled' }).catch(() => {}); }
    throw reason;
  } finally { await page.close(); }
}
