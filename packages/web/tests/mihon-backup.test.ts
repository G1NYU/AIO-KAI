import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { MIHON_BACKUP_LIMIT, MIHON_EXPANDED_LIMIT, canReconstructMihonIdentity, parseMihonBackup, prepareMihonProgress } from '../src/lib/backup/mihon';
import { planMangaRestore, type LocalManga } from '../src/lib/backup/manga';
import { planCategoryRestore } from '../src/lib/backup/manga-categories';
import { bytes, categoryWire, fixtureChapters, fixtureIdentity, integer, mangaWire, message, mihonFixture, string, varint } from './mihon-fixture.mjs';

async function fixture() { return parseMihonBackup(mihonFixture()); }
async function localFixture(): Promise<LocalManga[]> {
  const parsed = await fixture();
  return parsed.backup.manga.map((row, i) => ({ ...row, id: i + 1, categories: [], chapters: row.chapters.map((chapter, j) => ({ ...chapter, id: j + 11, isRead: false, isBookmarked: false, lastPageRead: 0, pageCount: 20, lastReadAt: '0' })) }));
}

describe('Mihon maintained protobuf schema', () => {
  it('decodes raw protobuf and matches the native length-prefixed SHA256 identity vectors', async () => {
    const parsed = await fixture();
    expect(parsed.compression).toBe('none');
    expect(parsed.backup.manga[0]).toMatchObject({ identity: 'b92c11a5a35500e74fc531b1631e1e7debf2d89b6cd618c34ed22ad0b81390b9', sourceId: '9007199254740993', title: 'Mihon fixture', categories: ['Reading', 'Later'] });
    expect(parsed.backup.manga[0].chapters.map(chapter => chapter.identity)).toEqual([
      '9c8535a9c2351379babb3fd352366abb587f376dd13183abce43f8a8491d25fd',
      '333c88fa9b128c34a2bfc93d3a2053c2bce27b5b25373861a39a5283d35b310a',
      'c21349ac8b4a143a962c7cb8096877a272c7a18197cd15ff5861fd909aefa809',
    ]);
    expect(parsed.backup.manga[0].chapters.map(chapter => chapter.lastReadAt)).toEqual(['1700000000', '1700000000', '1700000000']);
    expect(parsed.report).toMatchObject({ titles: 1, chapters: 3, categories: 2, sources: 1, partialPositions: 1, historyRecords: 3, historyMatched: 3 });
    expect(JSON.stringify(parsed)).not.toContain('/manga/');
  });

  it('decodes an actual gzip container with identical metadata and validates its trailer', async () => {
    const raw = mihonFixture();
    const compressed = gzipSync(raw);
    const parsed = await parseMihonBackup(compressed);
    expect(parsed.backup).toEqual((await fixture()).backup);
    expect(parsed.compression).toBe('gzip');
    await expect(parseMihonBackup(compressed.subarray(0, compressed.length - 3))).rejects.toThrow();
    const corrupt = Buffer.from(compressed); corrupt[corrupt.length - 5] ^= 1;
    await expect(parseMihonBackup(corrupt)).rejects.toThrow();
  });

  it.each(['0', '9007199254740993', '9223372036854775807', '-9223372036854775808', '-9007199254740993'])('preserves source %s without rounding or unsigned conversion', async sourceId => {
    const parsed = await parseMihonBackup(mihonFixture({ manga: [mangaWire({ sourceId })], sourceId }));
    expect(parsed.backup.manga[0].sourceId).toBe(sourceId);
    expect(parsed.sources[0].id).toBe(sourceId);
  });

  it('maps category order, never category id or array index, including packed repeated Longs', async () => {
    const raw = mihonFixture({ manga: [mangaWire({ categories: ['9007199254740993', 8], packed: true })], categories: [categoryWire('Other order', 99, 8), categoryWire('Large order', '9007199254740993', 2), categoryWire('Later', 8, 999)] });
    const parsed = await parseMihonBackup(raw);
    expect(parsed.backup.manga[0].categories).toEqual(['Large order', 'Later']);
    const emptyPacked = await parseMihonBackup(mihonFixture({ manga: [mangaWire({ categories: [], packed: true })] }));
    expect(emptyPacked.backup.manga[0].categories).toEqual([]);
  });

  it('retains older schema defaults and empty shelves', async () => {
    const minimal = bytes(string(2, '/local/title'), string(3, 'Local title'), message(16, bytes(string(1, '/local/chapter'), string(2, 'Chapter'))));
    const parsed = await parseMihonBackup(mihonFixture({ manga: [minimal], sourceId: '0', categories: [categoryWire('Empty shelf', 1)] }));
    expect(parsed.backup.manga[0]).toMatchObject({ sourceId: '0', categories: [] });
    expect(parsed.backup.manga[0].chapters[0]).toMatchObject({ isRead: false, isBookmarked: false, lastPageRead: 0, pageCount: 0, lastReadAt: '0' });
    expect(parsed.backup.version === 2 && parsed.backup.categories).toEqual(['Empty shelf']);
  });

  it('does not copy credentials, tracker payloads, extension repositories, or metadata URLs', async () => {
    const privateValue = 'fixture-private-value-must-not-survive';
    const raw = mihonFixture({
      manga: [mangaWire({ title: 'https://private.example/title', extra: bytes(message(18, bytes(integer(1, 99), string(4, privateValue))), string(9, 'https://private.example/cover'), message(9000, string(1, privateValue))) })],
      extra: bytes(message(104, string(1, privateValue)), message(105, string(2, privateValue)), message(106, string(1, 'https://private.example/repository'))),
    });
    const parsed = await parseMihonBackup(raw);
    const output = JSON.stringify(parsed);
    expect(output).not.toContain(privateValue);
    expect(output).not.toContain('https://');
    expect(parsed.backup.manga[0].title).toBe('untitled-manga');
    expect(parsed.report).toMatchObject({ trackingRecords: 1, appPreferences: 1, sourcePreferences: 1, extensionStores: 1, labelsReplaced: 1 });
  });

  it('skips ambiguous category orders and unsafe names without inventing assignments', async () => {
    const raw = mihonFixture({ categories: [categoryWire('One', 2), categoryWire('Two', 2), categoryWire('https://private.example/shelf', 8), categoryWire('Empty', 100)] });
    const parsed = await parseMihonBackup(raw);
    expect(parsed.backup.manga[0].categories).toEqual([]);
    expect(parsed.report).toMatchObject({ categories: 1, categoriesSkipped: 3, categoryAssignmentsSkipped: 2 });
  });

  it('uses the latest duplicate history time only for its exact chapter and reports unmatched history', async () => {
    const raw = mihonFixture({ manga: [mangaWire({ history: [{ url: fixtureChapters[0].url, at: 9007199254740993n }, { url: fixtureChapters[0].url, at: 1001n }, { url: '/chapter-not-in-backup', at: 2001n }] })] });
    const parsed = await parseMihonBackup(raw);
    expect(parsed.backup.manga[0].chapters[0].lastReadAt).toBe('9007199254740');
    expect(parsed.backup.manga[0].chapters[1].lastReadAt).toBe('0');
    expect(parsed.report).toMatchObject({ historyRecords: 3, historyMatched: 1, historyUnmatched: 1 });
  });

  it('does not turn read entries outside the Mihon library into imported library titles', async () => {
    const parsed = await parseMihonBackup(mihonFixture({ manga: [mangaWire({ favorite: false })] }));
    expect(parsed.backup.manga).toEqual([]);
    expect(parsed.report.nonLibraryTitles).toBe(1);
  });
});

describe('Mihon reviewed non-destructive merge', () => {
  it('defaults to read and bookmark flags without inventing page counts', async () => {
    const parsed = await fixture(), local = await localFixture();
    const projected = prepareMihonProgress(parsed, local);
    const plan = planMangaRestore(projected.backup, local);
    expect(projected.pages).toMatchObject({ requested: 1, eligible: 0, disabled: 1 });
    expect(plan.changes[0].changes).toHaveLength(2);
    expect(plan.changes[0].changes[0]).toMatchObject({ markRead: true, bookmark: false });
    expect(plan.changes[0].changes[1]).toMatchObject({ bookmark: true, markRead: false });
    expect(plan.changes[0].changes.every(change => change.page === undefined)).toBe(true);
    expect(parsed.backup.manga[0].chapters[2].pageCount).toBe(0);
  });

  it('allows reviewed in-range partial positions only on exact cached chapters', async () => {
    const parsed = await fixture(), local = await localFixture();
    const projected = prepareMihonProgress(parsed, local, true);
    const plan = planMangaRestore(projected.backup, local);
    expect(projected.pages).toMatchObject({ requested: 1, eligible: 1 });
    expect(plan.changes[0].changes[2]).toMatchObject({ page: 7, expectedPageCount: 20, expectedLastPage: 0, expectedLastReadAt: '0' });
    expect(parsed.backup.manga[0].chapters[2].pageCount).toBe(0);
    const changedPageCount = structuredClone(local); changedPageCount[0].chapters[2].pageCount = 21;
    expect(planMangaRestore(projected.backup, changedPageCount).changes[0].changes.every(change => change.page === undefined)).toBe(true);
  });

  it('keeps newer progress and complete chapters, but unions bookmarks', async () => {
    const parsed = await fixture(), local = await localFixture();
    for (const chapter of local[0].chapters) chapter.lastReadAt = '1700000001';
    const projected = prepareMihonProgress(parsed, local, true);
    const plan = planMangaRestore(projected.backup, local);
    expect(projected.pages.newerOrComplete).toBe(1);
    expect(plan.changes[0].changes).toEqual([expect.objectContaining({ bookmark: true, markRead: false })]);
    local[0].chapters[2].lastReadAt = '0'; local[0].chapters[2].isRead = true;
    expect(prepareMihonProgress(parsed, local, true).pages.newerOrComplete).toBe(1);
  });

  it('preserves progress without history evidence if the local chapter was already visited', async () => {
    const parsed = await parseMihonBackup(mihonFixture({ manga: [mangaWire({ history: [] })] }));
    const local = await localFixture();
    local[0].chapters[0].lastReadAt = '1'; local[0].chapters[2].lastReadAt = '1';
    const projected = prepareMihonProgress(parsed, local, true);
    expect(projected.pages.newerOrComplete).toBe(1);
    expect(planMangaRestore(projected.backup, local).changes[0].changes).toHaveLength(1);
  });

  it.each([0, 7, 6])('leaves positions unchanged for unknown or insufficient page count %d', async pageCount => {
    const parsed = await fixture(), local = await localFixture();
    local[0].chapters[2].pageCount = pageCount;
    expect(prepareMihonProgress(parsed, local, true).pages).toMatchObject({ eligible: 0, unavailableOrOutOfRange: 1 });
  });

  it('keeps a later local page and refuses a different source even with a matching title', async () => {
    const parsed = await fixture(), local = await localFixture();
    local[0].chapters[2].lastPageRead = 9;
    expect(prepareMihonProgress(parsed, local, true).pages.alreadyAhead).toBe(1);
    local[0].sourceId = '42';
    const projected = prepareMihonProgress(parsed, local, true);
    expect(projected.pages.unmatched).toBe(1);
    expect(planMangaRestore(projected.backup, local).rows[0].state).toBe('missing');
  });

  it('reuses matching categories, preserves existing shelves and is idempotent after apply', async () => {
    const parsed = await fixture(), local = await localFixture();
    const projected = prepareMihonProgress(parsed, local, true);
    const categoryPlan = planCategoryRestore(projected.backup, local, [{ id: 1, name: 'Reading' }, { id: 2, name: 'Unrelated' }]);
    expect(categoryPlan.create).toEqual(['Later']);
    expect(categoryPlan.reuse).toEqual([{ id: 1, name: 'Reading' }]);
    expect(categoryPlan.assignments).toHaveLength(2);
    const plan = planMangaRestore(projected.backup, local);
    for (const patch of plan.changes[0].changes) {
      const chapter = local[0].chapters.find(chapter => chapter.identity === patch.identity)!;
      chapter.isRead ||= patch.markRead; chapter.isBookmarked ||= patch.bookmark;
      if (patch.page !== undefined) chapter.lastPageRead = patch.page;
      chapter.lastReadAt = '1800000000';
    }
    local[0].categories = ['Reading', 'Later'];
    const second = prepareMihonProgress(parsed, local, true);
    expect(planMangaRestore(second.backup, local).changes).toEqual([]);
    expect(planCategoryRestore(second.backup, local, [{ id: 1, name: 'Reading' }, { id: 2, name: 'Unrelated' }, { id: 3, name: 'Later' }]).assignments).toEqual([]);
  });
});

describe('Mihon malformed and bounded decoding', () => {
  it.each([
    new Uint8Array(), new Uint8Array([0]), new Uint8Array([11]), integer(1, 1),
    new TextEncoder().encode('{"backupManga":[]}'), bytes(varint(10), varint(50), new Uint8Array([1])),
    new Uint8Array([0x8a, 0, 0]), bytes(varint(10), new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 2])),
  ])('rejects malformed, unsupported or truncated input without a projection', async raw => {
    await expect(parseMihonBackup(raw)).rejects.toThrow();
  });

  it('rejects duplicate title, chapter, source and singular identity fields', async () => {
    for (const raw of [
      mihonFixture({ manga: [mangaWire(), mangaWire()] }),
      mihonFixture({ manga: [mangaWire({ chapters: [fixtureChapters[0], fixtureChapters[0]] })] }),
      mihonFixture({ extra: message(101, bytes(string(1, 'Another source'), integer(2, fixtureIdentity.sourceId))) }),
      mihonFixture({ manga: [mangaWire({ extra: string(2, '/different-identity') })] }),
    ]) await expect(parseMihonBackup(raw)).rejects.toThrow(/duplicate/);
  });

  it('rejects invalid UTF-8, missing identities, invalid bools and unsafe 64-bit page values', async () => {
    for (const manga of [
      bytes(integer(1, 1), message(2, new Uint8Array([0xc3, 0x28]))),
      string(3, 'Missing identity'),
      bytes(string(2, '/m'), integer(100, 2)),
      mangaWire({ chapters: [{ ...fixtureChapters[0], page: '9007199254740993' }] }),
      mangaWire({ chapters: [{ ...fixtureChapters[0], page: -1 }] }),
      mangaWire({ history: [{ url: fixtureChapters[0].url, at: -1 }] }),
    ]) await expect(parseMihonBackup(mihonFixture({ manga: [manga] }))).rejects.toThrow();
  });

  it('bounds files, expanded gzip, nested messages and collection counts', async () => {
    await expect(parseMihonBackup(new Uint8Array(MIHON_BACKUP_LIMIT + 1))).rejects.toThrow('mihon-size');
    await expect(parseMihonBackup(gzipSync(new Uint8Array(MIHON_EXPANDED_LIMIT + 1)))).rejects.toThrow('mihon-expanded-size');
    await expect(parseMihonBackup(message(1, new Uint8Array(8 * 1024 * 1024 + 1)))).rejects.toThrow('mihon-field-size');
    await expect(parseMihonBackup(mihonFixture({ manga: Array.from({ length: 1001 }, () => mangaWire({ chapters: [], history: [] })) }))).rejects.toThrow('mihon-title-limit');
    await expect(parseMihonBackup(mihonFixture({ manga: [mangaWire({ chapters: Array.from({ length: 10001 }, () => fixtureChapters[0]), history: [] })] }))).rejects.toThrow('mihon-chapter-limit');
  });
});


describe('Mihon complete reconstruction projection', () => {
  it('keeps exact reconstruction identities operation-local and outside JSON exports', async () => {
    const parsed = await fixture();
    expect(parsed.reconstruction.manga[0].url).toBe(fixtureIdentity.url);
    expect(parsed.reconstruction.manga[0].chapters[0].lastReadAt).toBe('1700000000');
    expect(Object.keys(parsed)).not.toContain('reconstruction');
    expect(JSON.stringify(parsed)).not.toContain(fixtureIdentity.url);
  });
  it('maps only supported public tracker IDs, including legacy field precedence, and drops account data', async () => {
    const parsed = await parseMihonBackup(mihonFixture({ manga: [mangaWire({ extra: bytes(
      message(18, bytes(integer(1, 1), integer(2, 777), integer(3, 44), integer(100, 45), string(4, 'https://private.example/token/value'))),
      message(18, bytes(integer(1, 2), integer(100, '9007199254740993'))),
      message(18, bytes(integer(1, 99), integer(100, 88))),
      message(18, bytes(integer(1, 1), integer(100, 0))),
    ) })] }));
    expect(parsed.reconstruction.manga[0].trackers).toEqual([{ trackerId: 1, remoteId: '44' }, { trackerId: 2, remoteId: '9007199254740993' }]);
    expect(parsed.report.trackingRecords).toBe(4);
    expect(JSON.stringify(parsed.reconstruction)).not.toContain('private.example');
    expect(JSON.stringify(parsed.reconstruction)).not.toContain('777');
  });
  it.each(['/manga/public', 'manga/public/chapter-1', '/manga?id=123&lang=en', 'https://reader.example.com/manga/chapter-1'])('accepts exact public identifier %s', value => {
    expect(canReconstructMihonIdentity(value)).toBe(true);
  });
  it.each(['https://user:secret@example.com/a', '//example.com/a', '/manga?token=secret', '/manga?X-Amz-Signature=private', '/manga?unknown=private', '/manga#private', 'file:///private/file', 'http://example.com/a', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://localhost./a', 'https://intranet.local/a', '/manga/%0a/private', '/token/private/manga', '/%74oken/private/manga', ' /manga'])('excludes private or unsupported identifier %s', value => {
    expect(canReconstructMihonIdentity(value)).toBe(false);
  });
  it('reports excluded identities without exposing them or losing the hash-only exact-merge projection', async () => {
    const secret = 'private-identity-value';
    const parsed = await parseMihonBackup(mihonFixture({ manga: [
      mangaWire({ url: `/manga?token=${secret}`, title: 'Excluded title' }),
      mangaWire({ url: '/public/manga', title: 'Public title', chapters: [{ ...fixtureChapters[0], url: `/chapter?signature=${secret}` }, fixtureChapters[1]] }),
    ] }));
    expect(parsed.backup.manga).toHaveLength(2);
    expect(parsed.reconstruction.manga).toHaveLength(1);
    expect(parsed.reconstruction.manga[0].chapters).toHaveLength(1);
    expect(parsed.reconstructionSkipped).toEqual([
      { title: 'Excluded title', sourceId: fixtureIdentity.sourceId, titleSkipped: true, chaptersSkipped: 3 },
      { title: 'Public title', sourceId: fixtureIdentity.sourceId, titleSkipped: false, chaptersSkipped: 1 },
    ]);
    expect(JSON.stringify(parsed)).not.toContain(secret);
    expect(JSON.stringify(parsed.reconstruction)).not.toContain(secret);
  });
});
