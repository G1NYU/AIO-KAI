import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ capture: vi.fn(), save: vi.fn(), open: vi.fn(), managed: vi.fn(), reader: vi.fn(), read: vi.fn() }));
vi.mock('../src/lib/backup/archive', async original => ({ ...await original<typeof import('../src/lib/backup/archive')>(), capturePortableArchive: mock.capture }));
vi.mock('../src/lib/backup/managed-archive', async original => ({ ...await original<typeof import('../src/lib/backup/managed-archive')>(), saveManagedArchive: mock.save, openManagedArchive: mock.open, supportsManagedBackups: mock.managed }));
vi.mock('../src/lib/hosts/shell/reading', () => ({ supportsReading: mock.reader, readRequest: mock.read }));
vi.mock('../src/lib/hosts/shell/bridge', () => ({ appBridge: () => undefined, ask: vi.fn() }));

import { createPortableArchive, type PortableArchive } from '../src/lib/backup/archive';
import type { MangaBackup } from '../src/lib/backup/manga';
import type { PreferencesBackup } from '../src/lib/backup/preferences';
import { RESTORE_SESSION_KEY, restoreSessionBusy, runRestoreSection } from '../src/lib/backup/restore-session';
import {
  applyDownloadCleanup, cancelDownloadCleanup, listDownloadCleanupCandidates,
  parseDownloadCleanupCandidates, parseDownloadCleanupResult, parseDownloadCleanupReview, reviewDownloadCleanup,
  type DownloadCleanupItem, type DownloadCleanupReview,
} from '../src/lib/backup/download-cleanup';

const preferences: PreferencesBackup = { format: 'tsugi-preferences', version: 1, settings: { theme: 'mocha', accent: 'blue', startup: 'auto', matrix: 'wave', layout: 'default', audioProfile: 'flat', reader: { mode: 'scroll', width: 55, gap: false, rtl: false, fit: 'width', background: 'black', focus: false, autoNext: false, wheelZoom: true, resume: true } } };
function candidate(chapterId = 11, change: Partial<DownloadCleanupItem> = {}): DownloadCleanupItem {
  return { chapterId, mangaId: 1, mangaIdentity: 'a'.repeat(64), chapterIdentity: chapterId.toString(16).padStart(64, '0'),
    mangaTitle: 'Original fixture', chapterName: 'Chapter ' + chapterId, sourceName: 'Fixture (EN)', bytes: 4096, files: 4, format: 'folder', ...change };
}
function review(rows = [candidate(), candidate(12)]): DownloadCleanupReview {
  return { reviewId: 'b'.repeat(32), items: rows, totalBytes: rows.reduce((sum, item) => sum + item.bytes, 0) };
}
function result(value = review()) {
  return { reviewId: value.reviewId, items: value.items.map(row => ({ chapterId: row.chapterId, status: 'removed', bytes: row.bytes })),
    removedCount: value.items.length, removedBytes: value.totalBytes, metadataPreserved: true };
}
function archive(rows = review().items, options: { omitManga?: boolean; missingChapter?: boolean; read?: boolean; bookmark?: boolean; changed?: boolean } = {}): PortableArchive {
  const manga: MangaBackup = { format: 'tsugi-manga-progress', version: 2, categories: ['Reading'], manga: [{
    identity: 'a'.repeat(64), sourceId: '12345', title: 'Original fixture', categories: ['Reading'],
    chapters: (options.missingChapter ? rows.slice(1) : rows).map(row => ({ identity: row.chapterIdentity, name: row.chapterName,
      isRead: options.read ?? true, isBookmarked: options.bookmark ?? false, lastPageRead: 3, pageCount: 4, lastReadAt: '1700000000' })),
  }] };
  return createPortableArchive({ preferences: { ...preferences, settings: { ...preferences.settings, matrix: options.changed ? 'off' : 'wave' } },
    music: { format: 'tsugi-music-library', version: 1, playlists: [] }, books: { format: 'tsugi-book-progress', version: 1, books: [] },
    ...(!options.omitManga ? { manga } : {}) }, '2026-01-01T00:00:00.000Z');
}
const storage = new Map<string, string>(), copies = new Map<string, PortableArchive>();
let held = false, nextCopy = 0;
const locks: string[] = [], order: string[] = [];
function journal() {
  return JSON.stringify({ format: 'tsugi-restore-session', version: 1, id: '12345678-1234-4123-8123-123456789abc', revision: 0, createdAt: '2026-01-01T00:00:00.000Z',
    source: { name: 'tsugi-backup-1760000000000-' + '1'.repeat(32) + '.json', sha256: 'a'.repeat(64) },
    recovery: { name: 'tsugi-backup-1760000000000-' + '2'.repeat(32) + '.json', sha256: 'b'.repeat(64) },
    steps: [{ kind: 'manga', state: 'pending', attempts: 0 }] });
}

beforeEach(() => {
  vi.resetAllMocks(); storage.clear(); copies.clear(); locks.length = 0; order.length = 0; held = false; nextCopy = 0;
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  vi.stubGlobal('document', { querySelector: () => null });
  vi.stubGlobal('navigator', { locks: { request: async (name: string, _options: unknown, callback: (lock: object | null) => Promise<unknown>) => {
    locks.push(name); if (held) return callback(null); held = true; try { return await callback({}); } finally { held = false; }
  } } });
  mock.reader.mockReturnValue(true); mock.managed.mockReturnValue(true);
  mock.capture.mockImplementation(async () => { order.push('capture'); return archive(); });
  mock.save.mockImplementation(async (value: PortableArchive) => {
    order.push('save'); const name = 'tsugi-backup-1760000000000-' + (++nextCopy).toString(16).padStart(32, '0') + '.json';
    copies.set(name, structuredClone(value));
    return { name, createdMs: 1760000000000, bytes: new TextEncoder().encode(JSON.stringify(value)).length, readable: true };
  });
  mock.open.mockImplementation(async (name: string) => { order.push('open'); if (!copies.has(name)) throw Error('missing'); return structuredClone(copies.get(name)!); });
  mock.read.mockImplementation(async (action: { kind: string; ids?: number[]; reviewId?: string; offset?: number }) => {
    order.push(action.kind);
    if (action.kind === 'download-cleanup-candidates') return { items: review().items, totalCount: 2, totalBytes: 8192, offset: 0 };
    if (action.kind === 'review-download-cleanup') return review(action.ids!.map(id => candidate(id)));
    if (action.kind === 'cancel-download-cleanup') return { reviewId: action.reviewId, cancelled: true };
    if (action.kind === 'apply-download-cleanup') return result();
    throw Error('unexpected-action');
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('managed chapter cleanup response validation', () => {
  it('accepts complete bounded pages and refuses ambiguous or incomplete inventory metadata', () => {
    const rows = Array.from({ length: 102 }, (_, index) => candidate(index + 1));
    const first = { items: rows.slice(0, 100), offset: 0, totalCount: 102, totalBytes: 102 * 4096 };
    expect(parseDownloadCleanupCandidates(first)).toEqual(first);
    expect(parseDownloadCleanupCandidates({ ...first, items: rows.slice(100), offset: 100 }).items).toHaveLength(2);
    expect(parseDownloadCleanupCandidates({ items: [], offset: 0, totalCount: 0, totalBytes: 0 }).items).toEqual([]);
    for (const invalid of [{ ...first, token: 'private' }, { ...first, offset: 1 }, { ...first, totalCount: 10001 },
      { ...first, totalBytes: Number.MAX_SAFE_INTEGER }, { ...first, items: rows.slice(0, 99) }, { ...first, items: [...first.items.slice(1), rows[1]] },
      { items: [], offset: 100, totalCount: 0, totalBytes: 0 }, { items: [candidate()], offset: 0, totalCount: 1, totalBytes: 1 }])
      expect(() => parseDownloadCleanupCandidates(invalid)).toThrow();
  });

  it('rejects unsafe paths, duplicate identities, conflicting manga mappings and out-of-bound item values', () => {
    for (const change of [{ chapterId: 0 }, { chapterId: 2147483648 }, { bytes: 0 }, { bytes: 536870913 }, { files: 0 }, { files: 2002 },
      { format: 'cbz', files: 2 }, { format: 'zip' }, { mangaIdentity: 'A'.repeat(64) }, { chapterIdentity: '../chapter' },
      { mangaTitle: 'https://private.example/title' }, { chapterName: 'bad\nlabel' }, { sourceName: 'x'.repeat(501) }, { path: 'C:/private' }])
      expect(() => parseDownloadCleanupReview(review([{ ...candidate(), ...change } as DownloadCleanupItem]))).toThrow();
    expect(() => parseDownloadCleanupReview(review([candidate(), candidate(12, { chapterIdentity: candidate().chapterIdentity })]))).toThrow();
    expect(() => parseDownloadCleanupReview(review([candidate(), candidate(12, { mangaIdentity: 'c'.repeat(64) })]))).toThrow();
    expect(() => parseDownloadCleanupReview(review([candidate(), candidate(12, { mangaId: 2 })]))).toThrow();
    expect(parseDownloadCleanupReview(review([candidate(11, { mangaTitle: '原作 🦊', format: 'cbz', files: 1 })])).items[0].mangaTitle).toBe('原作 🦊');
  });

  it('bounds review size and binds cancellation and every item result to the exact native review', () => {
    const inspected = review(), success = result();
    expect(parseDownloadCleanupResult(success, inspected)).toEqual(success);
    expect(parseDownloadCleanupResult({ reviewId: inspected.reviewId, cancelled: true }, inspected)).toEqual({ reviewId: inspected.reviewId, cancelled: true });
    for (const invalid of [{ ...success, reviewId: 'c'.repeat(32) }, { ...success, removedCount: 1 }, { ...success, removedBytes: 1 },
      { ...success, metadataPreserved: false }, { ...success, items: success.items.slice(1) }, { ...success, items: [...success.items].reverse() },
      { ...success, items: [{ ...success.items[0], bytes: 1 }, success.items[1]] }, { ...success, items: [{ ...success.items[0], error: 'Unexpected' }, success.items[1]] },
      { reviewId: inspected.reviewId, cancelled: false }, { reviewId: inspected.reviewId, cancelled: true, removedCount: 0 }])
      expect(() => parseDownloadCleanupResult(invalid, inspected)).toThrow();
    expect(() => parseDownloadCleanupReview({ ...inspected, totalBytes: 1 })).toThrow();
    expect(() => parseDownloadCleanupReview(review([]))).toThrow();
    expect(() => parseDownloadCleanupReview(review(Array.from({ length: 51 }, (_, index) => candidate(index + 1))))).toThrow();
    expect(() => parseDownloadCleanupReview(review(Array.from({ length: 5 }, (_, index) => candidate(index + 1, { bytes: 536870912 }))))).toThrow();
  });

  it('accepts a stopped batch with honest zero-byte failures and rejects continued work or invented freed bytes', () => {
    const inspected = review([candidate(11), candidate(12), candidate(13)]);
    const partial = { reviewId: inspected.reviewId, items: [{ chapterId: 11, status: 'removed', bytes: 4096 },
      { chapterId: 12, status: 'failed', bytes: 0, error: 'Files remain.' }, { chapterId: 13, status: 'not-attempted', bytes: 0 }],
      removedCount: 1, removedBytes: 4096, metadataPreserved: true };
    expect(parseDownloadCleanupResult(partial, inspected)).toEqual(partial);
    expect(parseDownloadCleanupResult({ ...partial, metadataPreserved: false }, inspected).metadataPreserved).toBe(false);
    for (const changed of [{ ...partial, removedBytes: 8192 }, { ...partial, items: partial.items.map(row => row.chapterId === 12 ? { ...row, bytes: 4096 } : row) },
      { ...partial, items: partial.items.map(row => row.chapterId === 13 ? { ...row, status: 'removed', bytes: 4096 } : row) },
      { ...partial, items: partial.items.map(row => row.chapterId === 12 ? { ...row, status: 'not-attempted' } : row) },
      { ...partial, items: partial.items.map(row => row.chapterId === 12 ? { ...row, error: 'https://private.example' } : row) }])
      expect(() => parseDownloadCleanupResult(changed, inspected)).toThrow();
  });
});

describe('guarded downloaded chapter cleanup', () => {
  it('lists and reviews specific identities without writing a backup or changing downloads', async () => {
    expect((await listDownloadCleanupCandidates()).totalCount).toBe(2);
    const inspected = await reviewDownloadCleanup(review().items);
    expect(mock.read).toHaveBeenNthCalledWith(1, { kind: 'download-cleanup-candidates', offset: 0 });
    expect(mock.read).toHaveBeenNthCalledWith(2, { kind: 'review-download-cleanup', ids: [11, 12] });
    await cancelDownloadCleanup(inspected);
    expect(mock.read).toHaveBeenLastCalledWith({ kind: 'cancel-download-cleanup', reviewId: inspected.reviewId });
    expect(mock.capture).not.toHaveBeenCalled(); expect(mock.save).not.toHaveBeenCalled();
    expect(locks).toEqual(['tsugi-portable-restore', 'tsugi-portable-restore', 'tsugi-portable-restore']);
    expect(storage.has(RESTORE_SESSION_KEY)).toBe(false);
  });

  it('rejects changed identities or pages and oversized selections before presenting a review', async () => {
    mock.read.mockResolvedValueOnce({ items: [candidate()], offset: 100, totalCount: 101, totalBytes: 101 * 4096 });
    await expect(listDownloadCleanupCandidates()).rejects.toThrow('download-cleanup-changed');
    mock.read.mockResolvedValueOnce(review([candidate(11, { chapterIdentity: 'd'.repeat(64) }), candidate(12)]));
    await expect(reviewDownloadCleanup(review().items)).rejects.toThrow('download-cleanup-changed');
    mock.read.mockClear();
    await expect(reviewDownloadCleanup(Array.from({ length: 5 }, (_, index) => candidate(index + 1, { bytes: 536870912 })))).rejects.toThrow('selection-size');
    expect(mock.read).not.toHaveBeenCalled();
  });

  it.each(['open-reader', 'missing-locks', 'unfinished-restore', 'damaged-restore', 'missing-reader', 'missing-backups'])('blocks %s before capture, staging or native cleanup', async condition => {
    if (condition === 'open-reader') vi.stubGlobal('document', { querySelector: () => ({}) });
    if (condition === 'missing-locks') vi.stubGlobal('navigator', {});
    if (condition === 'unfinished-restore') storage.set(RESTORE_SESSION_KEY, journal());
    if (condition === 'damaged-restore') storage.set(RESTORE_SESSION_KEY, '{broken');
    if (condition === 'missing-reader') mock.reader.mockReturnValue(false);
    if (condition === 'missing-backups') mock.managed.mockReturnValue(false);
    await expect(listDownloadCleanupCandidates()).rejects.toThrow();
    await expect(applyDownloadCleanup(review())).rejects.toThrow();
    expect(mock.capture).not.toHaveBeenCalled(); expect(mock.save).not.toHaveBeenCalled(); expect(mock.read).not.toHaveBeenCalled();
  });

  it('captures, saves and reopens a complete metadata copy before asking native code to apply, without creating a restore journal', async () => {
    const onBackup = vi.fn(), onDispatched = vi.fn(() => {
      expect(order).toEqual(['capture', 'save', 'open']); expect(restoreSessionBusy()).toBe(true); expect(storage.has(RESTORE_SESSION_KEY)).toBe(false);
    });
    const applied = await applyDownloadCleanup(review(), { onBackup, onDispatched });
    expect(mock.capture).toHaveBeenCalledWith(true);
    expect(order).toEqual(['capture', 'save', 'open', 'apply-download-cleanup']);
    expect(applied.outcome).toEqual(result()); expect(copies.get(applied.backup.name)).toEqual(archive());
    expect(onBackup).toHaveBeenCalledWith(applied.backup); expect(onDispatched).toHaveBeenCalledOnce();
    expect(storage.has(RESTORE_SESSION_KEY)).toBe(false); expect(restoreSessionBusy()).toBe(false);
  });

  it.each(['capture', 'save', 'readback', 'substituted-copy', 'wrong-size', 'automatic-copy'])('refuses %s backup failures before native deletion', async failure => {
    if (failure === 'capture') mock.capture.mockRejectedValueOnce(Error('library-unavailable'));
    if (failure === 'save') mock.save.mockRejectedValueOnce(Error('disk-full'));
    if (failure === 'readback') mock.open.mockRejectedValueOnce(Error('missing-copy'));
    if (failure === 'substituted-copy') mock.open.mockResolvedValueOnce(archive(undefined, { changed: true }));
    if (failure === 'wrong-size' || failure === 'automatic-copy') mock.save.mockResolvedValueOnce({
      name: (failure === 'automatic-copy' ? 'tsugi-auto-backup-' : 'tsugi-backup-') + '1760000000000-' + 'a'.repeat(32) + '.json',
      createdMs: 1760000000000, bytes: failure === 'wrong-size' ? 1 : new TextEncoder().encode(JSON.stringify(archive())).length, readable: true,
    });
    await expect(applyDownloadCleanup(review())).rejects.toThrow('download-cleanup-backup');
    expect(mock.read).not.toHaveBeenCalled(); expect(storage.has(RESTORE_SESSION_KEY)).toBe(false);
  });

  it.each([{ omitManga: true }, { missingChapter: true }, { read: false }, { bookmark: true }])('requires the backup to cover every eligible chapter: %j', async options => {
    mock.capture.mockResolvedValueOnce(archive(undefined, options));
    await expect(applyDownloadCleanup(review())).rejects.toThrow('download-cleanup-coverage');
    expect(mock.save).not.toHaveBeenCalled(); expect(mock.read).not.toHaveBeenCalled();
  });

  it('rechecks open readers and the restore record after asynchronous capture and readback', async () => {
    mock.capture.mockImplementationOnce(async () => { vi.stubGlobal('document', { querySelector: () => ({}) }); return archive(); });
    await expect(applyDownloadCleanup(review())).rejects.toThrow('active-reader');
    expect(mock.save).not.toHaveBeenCalled();
    vi.stubGlobal('document', { querySelector: () => null });
    mock.open.mockImplementationOnce(async name => { storage.set(RESTORE_SESSION_KEY, journal()); return structuredClone(copies.get(name)!); });
    await expect(applyDownloadCleanup(review())).rejects.toThrow('restore-different');
    expect(mock.read).not.toHaveBeenCalled(); expect(copies.size).toBe(1);
  });

  it('holds the shared restore lock across native confirmation and mutation, blocking concurrent cleanup and restore writes', async () => {
    let release!: () => void;
    mock.read.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(result()); }));
    const applying = applyDownloadCleanup(review());
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const otherWrite = vi.fn();
    await expect(listDownloadCleanupCandidates()).rejects.toThrow('restore-busy');
    await expect(runRestoreSection('books', undefined, undefined, otherWrite)).rejects.toThrow('restore-busy');
    expect(otherWrite).not.toHaveBeenCalled(); expect(restoreSessionBusy()).toBe(true);
    release(); await applying; expect(restoreSessionBusy()).toBe(false);
  });

  it('keeps the verified safety copy on Windows cancellation without inventing removals', async () => {
    mock.read.mockResolvedValueOnce({ reviewId: review().reviewId, cancelled: true });
    const applied = await applyDownloadCleanup(review());
    expect(applied.outcome).toEqual({ reviewId: review().reviewId, cancelled: true });
    expect(copies.has(applied.backup.name)).toBe(true); expect(mock.read).toHaveBeenCalledOnce();
  });

  it.each([
    ['The cleanup review expired or the Reader restarted. Review the selection again.', 'expired'],
    ['The reviewed downloads or reading state changed. Review the selection again.', 'changed'],
  ])('recognizes the guaranteed pre-mutation native refusal: %s', async (message, code) => {
    mock.read.mockRejectedValueOnce(Error(message));
    await expect(applyDownloadCleanup(review())).rejects.toThrow('download-cleanup-' + code);
    expect(mock.read).toHaveBeenCalledOnce(); expect(copies.size).toBe(1);
  });

  it('never retries an uncertain native operation and leaves its already verified backup available', async () => {
    mock.read.mockRejectedValueOnce(Error('transport-disconnected'));
    const saved = vi.fn(), dispatched = vi.fn();
    await expect(applyDownloadCleanup(review(), { onBackup: saved, onDispatched: dispatched })).rejects.toThrow('transport-disconnected');
    expect(saved).toHaveBeenCalledOnce(); expect(dispatched).toHaveBeenCalledOnce();
    expect(mock.read).toHaveBeenCalledOnce(); expect(copies.has(saved.mock.calls[0][0].name)).toBe(true);
    expect(storage.has(RESTORE_SESSION_KEY)).toBe(false);
  });
});
