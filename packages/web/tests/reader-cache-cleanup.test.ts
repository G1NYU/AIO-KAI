import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ reader: vi.fn(), read: vi.fn(), bridge: vi.fn(), ask: vi.fn() }));
vi.mock('@lingui/core/macro', () => ({ t: (descriptor: { message: string }) => descriptor.message }));
vi.mock('../src/lib/hosts/shell/reading', () => ({ supportsReading: mock.reader, readRequest: mock.read }));
vi.mock('../src/lib/hosts/shell/bridge', () => ({ appBridge: mock.bridge, ask: mock.ask }));

import {
  applyReaderCacheCleanup, cancelReaderCacheCleanup, parseReaderCacheCancellation, parseReaderCacheResult,
  parseReaderCacheReview, reviewReaderCacheCleanup, ReaderCacheCleanupError, type ReaderCacheReview,
} from '../src/lib/backup/reader-cache-cleanup';
import { RESTORE_SESSION_KEY, restoreSessionBusy, runRestoreSection } from '../src/lib/backup/restore-session';

function review(): ReaderCacheReview {
  return { reviewId: 'a'.repeat(32), groups: [{ kind: 'pages', files: 2, bytes: 8192 }, { kind: 'thumbnails', files: 1, bytes: 1024 }],
    totalFiles: 3, totalBytes: 9216, expiresInSeconds: 600 };
}
function result(value = review()) {
  return { reviewId: value.reviewId, status: 'removed',
    groups: value.groups.map(group => ({ kind: group.kind, removedFiles: group.files, removedBytes: group.bytes })),
    removedFiles: value.totalFiles, removedBytes: value.totalBytes, runtimeReady: true, message: 'Reviewed temporary images were removed.' };
}
function partial() {
  return { ...result(), status: 'partial', groups: [{ kind: 'pages', removedFiles: 1, removedBytes: 4096 }, { kind: 'thumbnails', removedFiles: 0, removedBytes: 0 }],
    removedFiles: 1, removedBytes: 4096, message: 'Some temporary images remain. Review the cache again.' };
}
const storage = new Map<string, string>();
let held = false;
const locks: string[] = [];
beforeEach(() => {
  vi.resetAllMocks(); storage.clear(); held = false; locks.length = 0;
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  vi.stubGlobal('document', { querySelector: () => null });
  vi.stubGlobal('navigator', { locks: { request: async (name: string, _options: unknown, callback: (lock: object | null) => Promise<unknown>) => {
    locks.push(name); if (held) return callback(null); held = true;
    try { return await callback({}); } finally { held = false; }
  } } });
  mock.reader.mockReturnValue(true);
  mock.bridge.mockReturnValue({ platform: 'windows', reading: true });
  mock.read.mockImplementation(async (action: { kind: string; reviewId?: string }) => {
    if (action.kind === 'review-image-cache-cleanup') return review();
    if (action.kind === 'cancel-image-cache-cleanup') return { reviewId: action.reviewId, status: 'cancelled' };
    if (action.kind === 'apply-image-cache-cleanup') return result();
    throw Error('unexpected-action');
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('Reader temporary image cleanup contract', () => {
  it('accepts only the two owned groups with consistent bounded logical totals, including empty and zero-byte files', () => {
    expect(parseReaderCacheReview(review())).toEqual(review());
    const empty = { ...review(), groups: [{ kind: 'pages', files: 0, bytes: 0 }, { kind: 'thumbnails', files: 0, bytes: 0 }], totalFiles: 0, totalBytes: 0 };
    expect(parseReaderCacheReview(empty).totalFiles).toBe(0);
    expect(parseReaderCacheReview({ ...empty, groups: [{ kind: 'pages', files: 1, bytes: 0 }, empty.groups[1]], totalFiles: 1 }).totalBytes).toBe(0);
  });

  it('rejects private fields, unknown groups, duplicate groups, malformed review IDs and inconsistent accounting', () => {
    for (const value of [
      { ...review(), path: 'C:/private/source' }, { ...review(), reviewId: '../private' }, { ...review(), reviewId: 'A'.repeat(32) },
      { ...review(), expiresInSeconds: 3600 }, { ...review(), totalBytes: 9217 }, { ...review(), totalFiles: 4 },
      { ...review(), groups: [...review().groups].reverse() }, { ...review(), groups: [review().groups[0], review().groups[0]] },
      { ...review(), groups: [{ ...review().groups[0], kind: 'cookies' }, review().groups[1]] },
      { ...review(), groups: [{ ...review().groups[0], url: 'https://private.invalid' }, review().groups[1]] },
    ]) expect(() => parseReaderCacheReview(value)).toThrow();
  });

  it('rejects negative, fractional, non-finite, oversized and impossible file/byte values', () => {
    for (const files of [-1, 0.5, NaN, Infinity, 20_001]) {
      expect(() => parseReaderCacheReview({ ...review(), groups: [{ kind: 'pages', files, bytes: 8192 }, review().groups[1]] })).toThrow();
    }
    for (const bytes of [-1, 0.5, NaN, Infinity, 2 * 1024 ** 3 + 1]) {
      expect(() => parseReaderCacheReview({ ...review(), groups: [{ kind: 'pages', files: 2, bytes }, review().groups[1]] })).toThrow();
    }
    expect(() => parseReaderCacheReview({ ...review(), groups: [{ kind: 'pages', files: 0, bytes: 1 }, { kind: 'thumbnails', files: 0, bytes: 0 }], totalFiles: 0, totalBytes: 1 })).toThrow();
    expect(() => parseReaderCacheReview({ ...review(), groups: [{ kind: 'pages', files: 1, bytes: 512 * 1024 ** 2 + 1 }, { kind: 'thumbnails', files: 0, bytes: 0 }], totalFiles: 1, totalBytes: 512 * 1024 ** 2 + 1 })).toThrow();
    expect(() => parseReaderCacheReview({ ...review(), groups: [{ kind: 'pages', files: 10_001, bytes: 0 }, { kind: 'thumbnails', files: 10_000, bytes: 0 }], totalFiles: 20_001, totalBytes: 0 })).toThrow();
  });

  it('binds cancellation and removal to the exact reviewed token without allowing extra fields', () => {
    const cancelled = { reviewId: review().reviewId, status: 'cancelled' };
    expect(parseReaderCacheCancellation(cancelled, review().reviewId)).toEqual(cancelled);
    expect(parseReaderCacheResult(cancelled, review())).toEqual(cancelled);
    expect(() => parseReaderCacheCancellation({ ...cancelled, removedBytes: 0 }, review().reviewId)).toThrow();
    expect(() => parseReaderCacheResult({ ...result(), reviewId: 'b'.repeat(32) }, review())).toThrow();
    expect(() => parseReaderCacheResult({ ...cancelled, reviewId: 'b'.repeat(32) }, review())).toThrow();
  });

  it('separates verified removal from runtime restart and admits honest partial results', () => {
    expect(parseReaderCacheResult(result(), review())).toEqual(result());
    const stopped = { ...result(), runtimeReady: false, message: 'Reader did not restart. Restart Tsugi before continuing.' };
    expect(parseReaderCacheResult(stopped, review())).toEqual(stopped);
    expect(parseReaderCacheResult(partial(), review())).toEqual(partial());
    const refused = { ...partial(), groups: review().groups.map(group => ({ kind: group.kind, removedFiles: 0, removedBytes: 0 })), removedFiles: 0, removedBytes: 0, runtimeReady: false };
    expect(parseReaderCacheResult(refused, review())).toEqual(refused);
  });

  it('rejects invented removal totals, mislabeled completion and unsafe native messages', () => {
    for (const value of [
      { ...result(), removedFiles: 4 }, { ...result(), removedBytes: 9217 }, { ...result(), status: 'partial' },
      { ...partial(), status: 'removed' }, { ...result(), runtimeReady: 'true' },
      { ...partial(), groups: [{ kind: 'pages', removedFiles: 2, removedBytes: 4096 }, partial().groups[1]], removedFiles: 2 },
      { ...partial(), groups: [{ kind: 'pages', removedFiles: 0, removedBytes: 4096 }, partial().groups[1]], removedFiles: 0 },
      { ...result(), message: 'https://private.invalid/token' }, { ...result(), message: 'C:/Users/private/cache' },
      { ...result(), message: '\\Users\\private\\cache' }, { ...result(), message: '\u0001unsafe' }, { ...result(), message: '' },
    ]) expect(() => parseReaderCacheResult(value, review())).toThrow();
  });

  it('requires the unconfirmed remainder to fit the reviewed per-file bound while allowing zero-byte files', () => {
    const reviewed = { ...review(), groups: [{ kind: 'pages', files: 2, bytes: 1024 ** 3 }, { kind: 'thumbnails', files: 0, bytes: 0 }], totalFiles: 2, totalBytes: 1024 ** 3 };
    const impossible = { ...partial(), groups: [{ kind: 'pages', removedFiles: 1, removedBytes: 1 }, { kind: 'thumbnails', removedFiles: 0, removedBytes: 0 }], removedFiles: 1, removedBytes: 1 };
    expect(() => parseReaderCacheResult(impossible, reviewed)).toThrow();
    const withZeroByteFile = { ...reviewed, groups: [{ kind: 'pages', files: 2, bytes: 4096 }, { kind: 'thumbnails', files: 0, bytes: 0 }], totalBytes: 4096 };
    expect(parseReaderCacheResult(partial(), withZeroByteFile)).toEqual(partial());
  });
});

describe('guarded Reader image cleanup', () => {
  it('reviews and cancels without a backup or mutation request, and sends only closed actions and opaque IDs', async () => {
    const value = await reviewReaderCacheCleanup();
    expect(value).toEqual(review());
    expect(await cancelReaderCacheCleanup(value)).toEqual({ reviewId: value.reviewId, status: 'cancelled' });
    expect(mock.read.mock.calls.map(call => call[0])).toEqual([{ kind: 'review-image-cache-cleanup' }, { kind: 'cancel-image-cache-cleanup', reviewId: value.reviewId }]);
    expect(storage.size).toBe(0);
    expect(locks).toEqual(['tsugi-portable-restore', 'tsugi-portable-restore']);
  });

  it.each(['open-reader', 'missing-locks', 'invalid-restore', 'unavailable-storage', 'missing-reader'])('blocks %s before review or native removal', async condition => {
    if (condition === 'open-reader') vi.stubGlobal('document', { querySelector: () => ({}) });
    if (condition === 'missing-locks') vi.stubGlobal('navigator', {});
    if (condition === 'invalid-restore') storage.set(RESTORE_SESSION_KEY, 'damaged intent');
    if (condition === 'unavailable-storage') vi.stubGlobal('localStorage', { getItem: () => { throw Error('blocked'); } });
    if (condition === 'missing-reader') mock.reader.mockReturnValue(false);
    await expect(reviewReaderCacheCleanup()).rejects.toThrow();
    await expect(applyReaderCacheCleanup(review())).rejects.toThrow();
    expect(mock.read).not.toHaveBeenCalled();
  });

  it('rechecks open readers and restore intent after asynchronous review', async () => {
    mock.read.mockImplementationOnce(async () => { vi.stubGlobal('document', { querySelector: () => ({}) }); return review(); });
    await expect(reviewReaderCacheCleanup()).rejects.toThrow('active-reader');
    vi.stubGlobal('document', { querySelector: () => null });
    mock.read.mockImplementationOnce(async () => { storage.set(RESTORE_SESSION_KEY, 'new intent'); return review(); });
    await expect(reviewReaderCacheCleanup()).rejects.toThrow('restore-invalid');
    expect(mock.read.mock.calls.every(call => call[0].kind === 'review-image-cache-cleanup')).toBe(true);
  });

  it('refuses malformed or empty reviews before marking an operation dispatched', async () => {
    const dispatched = vi.fn();
    await expect(applyReaderCacheCleanup({ ...review(), totalBytes: 1 }, dispatched)).rejects.toThrow();
    await expect(applyReaderCacheCleanup({ ...review(), groups: review().groups.map(group => ({ kind: group.kind, files: 0, bytes: 0 })), totalFiles: 0, totalBytes: 0 }, dispatched)).rejects.toThrow('empty');
    expect(dispatched).not.toHaveBeenCalled(); expect(mock.read).not.toHaveBeenCalled();
  });

  it('holds the shared restore lock across native confirmation and restart', async () => {
    let finish!: (value: unknown) => void;
    mock.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const dispatched = vi.fn(), running = applyReaderCacheCleanup(review(), dispatched);
    await vi.waitFor(() => expect(dispatched).toHaveBeenCalledOnce());
    expect(restoreSessionBusy()).toBe(true);
    const write = vi.fn();
    await expect(runRestoreSection('music', undefined, undefined, write)).rejects.toThrow('restore-busy');
    await expect(reviewReaderCacheCleanup()).rejects.toThrow('restore-busy');
    expect(write).not.toHaveBeenCalled(); expect(mock.read).toHaveBeenCalledOnce();
    finish(result());
    await expect(running).resolves.toEqual(result());
    expect(restoreSessionBusy()).toBe(false);
  });

  it('returns native cancellation and partial outcomes without retrying or claiming a complete removal', async () => {
    mock.read.mockResolvedValueOnce({ reviewId: review().reviewId, status: 'cancelled' });
    await expect(applyReaderCacheCleanup(review())).resolves.toEqual({ reviewId: review().reviewId, status: 'cancelled' });
    mock.read.mockResolvedValueOnce(partial());
    await expect(applyReaderCacheCleanup(review())).resolves.toEqual(partial());
    expect(mock.read).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['The Reader image cache changed or the review expired. Review the cache again. No images were removed.', 'native-changed'],
    ['A Reader image cache path is redirected, shared, or outside private storage. No images were removed.', 'native-unsafe'],
    ['The Reader image cache could not be verified within its safety limits. No images were removed.', 'native-unverified'],
    ['A Reader image cache file is in use or cannot be removed. Close it and review the cache again. No images were removed.', 'native-in-use'],
    ['Finish Reader downloads and library updates, and disable automatic jobs before clearing cached images. No images were removed.', 'native-busy'],
    ['The Reader image cache review is no longer available. Review the cache again. No images were removed.', 'native-changed'],
    ['Close the open manga chapter before clearing cached images. No images were removed.', 'native-reader-open'],
    ['Reading is closing. No images were removed.', 'native-closing'],
  ])('recognizes only the exact native pre-write refusal: %s', async (message, code) => {
    const dispatched = vi.fn();
    mock.read.mockRejectedValueOnce(Error(message));
    const failure = await applyReaderCacheCleanup(review(), dispatched).catch(reason => reason);
    expect(failure).toBeInstanceOf(ReaderCacheCleanupError);
    expect(failure).toMatchObject({ code, noImagesRemoved: true });
    expect(dispatched).toHaveBeenCalledOnce(); expect(mock.read).toHaveBeenCalledOnce();
    expect(restoreSessionBusy()).toBe(false);
  });

  it.each([
    'Lost reply. No images were removed.',
    'The Reader image cache changed or the review expired. Review the cache again. No images were removed. C:/Users/private/cache',
    ' Reading is closing. No images were removed.',
  ])('does not convert an unknown or embellished native error into a no-removal guarantee: %s', async message => {
    const original = Error(message);
    mock.read.mockRejectedValueOnce(original);
    await expect(applyReaderCacheCleanup(review())).rejects.toBe(original);
    expect(mock.read).toHaveBeenCalledOnce();
  });

  it.each(['transport', 'malformed-result'])('does not replay an uncertain %s operation', async failure => {
    const dispatched = vi.fn();
    if (failure === 'transport') mock.read.mockRejectedValueOnce(Error('lost reply'));
    else mock.read.mockResolvedValueOnce({ ...result(), removedBytes: 0 });
    await expect(applyReaderCacheCleanup(review(), dispatched)).rejects.toThrow();
    expect(dispatched).toHaveBeenCalledOnce(); expect(mock.read).toHaveBeenCalledOnce();
    expect(restoreSessionBusy()).toBe(false); expect(storage.size).toBe(0);
  });

  it('drains an exact pending native chapter release before image review and apply, using the long operation timeout', async () => {
    const reading = await vi.importActual<typeof import('../src/lib/hosts/shell/reading')>('../src/lib/hosts/shell/reading');
    mock.ask.mockResolvedValueOnce({ data: null, error: 'Busy fixture' });
    await expect(reading.closeReadingChapter(11, 'chapter-11')).rejects.toThrow('Busy fixture');
    mock.ask.mockImplementation(async (request: { action: { kind: string } }) => ({ data: request.action.kind === 'close-chapter' ? { closed: true } : review(), error: null }));
    await reading.readRequest({ kind: 'review-image-cache-cleanup' });
    expect(mock.ask.mock.calls.map(call => call[0].action.kind)).toEqual(['close-chapter', 'close-chapter', 'review-image-cache-cleanup']);
    expect(mock.ask.mock.calls[1][0].action).toEqual({ kind: 'close-chapter', chapterId: 11, session: 'chapter-11' });
    await reading.readRequest({ kind: 'apply-image-cache-cleanup', reviewId: review().reviewId });
    expect(mock.ask.mock.lastCall?.[2].timeoutMs).toBe(10 * 60_000);
  });
});
