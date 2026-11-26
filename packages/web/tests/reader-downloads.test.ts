import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOWNLOAD_POLL_MS, ReaderDownloadsController, parseReaderDownloadStatus, validateDownloadIds, type DownloadRequest, type ReaderDownload, type ReaderDownloadStatus } from '../src/app/read/reader-downloads-state';

const item: ReaderDownload = { id: 11, mangaId: 1, mangaTitle: 'Original title', chapterName: 'Original chapter', pageCount: -1, isDownloaded: false, state: 'QUEUED', progress: 0, tries: 0, position: 0 };
function status(rows: ReaderDownload[] = [item], state: ReaderDownloadStatus['state'] = 'STARTED'): ReaderDownloadStatus { return { state, queue: rows }; }
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { for (let index = 0; index < 8; index++) await Promise.resolve(); }
afterEach(() => { vi.useRealTimers(); });

describe('Reader download response boundaries', () => {
  it('accepts native unknown pages, large retry counters, fractional progress and original Unicode labels', () => {
    const row = { ...item, id: 2147483647, mangaTitle: '物語 📚', tries: 2147483647, progress: 0.375 };
    expect(parseReaderDownloadStatus(status([row]))).toEqual(status([row]));
    expect(parseReaderDownloadStatus({ ...status(), uncertain: true }).uncertain).toBe(true);
  });
  it('rejects unsafe identities, ambiguous positions, unknown states and invalid progress instead of claiming completion', () => {
    for (const patch of [
      { id: 0 }, { id: 2147483648 }, { mangaId: '1' }, { pageCount: -2 }, { pageCount: 0.5 },
      { isDownloaded: 1 }, { state: 'CANCELLED' }, { progress: NaN }, { progress: Infinity }, { progress: -0.1 },
      { progress: 1.01 }, { tries: -1 }, { tries: 0.5 }, { position: 1 }, { mangaTitle: '' },
      { chapterName: 'hidden\ntext' }, { mangaTitle: 'a'.repeat(501) },
    ]) expect(() => parseReaderDownloadStatus(status([{ ...item, ...patch } as ReaderDownload]))).toThrow();
    for (const value of [null, {}, { state: 'PAUSED', queue: [] }, { ...status(), uncertain: false },
      status([item, { ...item, position: 1 }]), status(Array.from({ length: 1001 }, (_, position) => ({ ...item, id: position + 1, position })))]) {
      expect(() => parseReaderDownloadStatus(value)).toThrow();
    }
  });
  it('projects only supported queue fields and validates bounded unique selections without changing them', () => {
    expect(parseReaderDownloadStatus({ ...status([{ ...item, rawUrl: 'private-marker' } as ReaderDownload]), token: 'private-marker' })).toEqual(status());
    const ids = [11, 2147483647]; expect(validateDownloadIds(ids)).toEqual(ids); expect(validateDownloadIds(ids)).not.toBe(ids);
    for (const ids of [[], [11, 11], [0], [-1], [1.5], [2147483648], Array.from({ length: 101 }, (_, index) => index + 1)]) expect(() => validateDownloadIds(ids)).toThrow();
  });
});

describe('visible, sequential Reader download observation', () => {
  it('does not fetch on construction, shares a StrictMode request and stops polling when hidden', async () => {
    vi.useFakeTimers();
    const pending = deferred<unknown>();
    const request = vi.fn<DownloadRequest>().mockReturnValue(pending.promise);
    const controller = new ReaderDownloadsController(request);
    expect(request).not.toHaveBeenCalled();
    controller.setActive(true); controller.setActive(false); controller.setActive(true);
    expect(request).toHaveBeenCalledTimes(1);
    pending.resolve(status()); await flush();
    await vi.advanceTimersByTimeAsync(DOWNLOAD_POLL_MS - 1); expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(request).toHaveBeenCalledTimes(2);
    controller.setActive(false);
    await vi.advanceTimersByTimeAsync(5 * DOWNLOAD_POLL_MS); expect(request).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().stale).toBe(true);
  });
  it('never overlaps a slow poll or starts hidden follow-up polling after its response', async () => {
    vi.useFakeTimers();
    const pending = deferred<unknown>();
    const request = vi.fn<DownloadRequest>().mockResolvedValueOnce(status()).mockReturnValue(pending.promise);
    const controller = new ReaderDownloadsController(request);
    controller.setActive(true); await flush();
    await vi.advanceTimersByTimeAsync(DOWNLOAD_POLL_MS);
    await vi.advanceTimersByTimeAsync(5 * DOWNLOAD_POLL_MS);
    expect(request).toHaveBeenCalledTimes(2);
    controller.setActive(false); pending.resolve(status()); await flush();
    await vi.advanceTimersByTimeAsync(5 * DOWNLOAD_POLL_MS);
    expect(request).toHaveBeenCalledTimes(2); expect(controller.getSnapshot().busy).toBe(false);
  });
  it('retains explicitly stale rows on failure, blocks changes, and recovers through a manual refresh', async () => {
    vi.useFakeTimers();
    const request = vi.fn<DownloadRequest>().mockResolvedValueOnce(status()).mockRejectedValueOnce(new Error('private provider URL')).mockResolvedValue(status([], 'STOPPED'));
    const controller = new ReaderDownloadsController(request); controller.setActive(true); await flush();
    await vi.advanceTimersByTimeAsync(DOWNLOAD_POLL_MS);
    expect(controller.getSnapshot()).toMatchObject({ stale: true, error: true, status: status() });
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('private provider');
    expect(await controller.change({ kind: 'cancel-downloads', ids: [11] })).toBe(false);
    await vi.advanceTimersByTimeAsync(5 * DOWNLOAD_POLL_MS); expect(request).toHaveBeenCalledTimes(2);
    expect(await controller.refresh()).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({ stale: false, error: false, status: status([], 'STOPPED') });
    controller.setActive(false);
  });
  it('does not poll a stopped or failed-only queue', async () => {
    vi.useFakeTimers();
    for (const data of [status([item], 'STOPPED'), status([{ ...item, state: 'ERROR' }]), status([])]) {
      const request = vi.fn<DownloadRequest>().mockResolvedValue(data);
      const controller = new ReaderDownloadsController(request); controller.setActive(true); await flush();
      await vi.advanceTimersByTimeAsync(3 * DOWNLOAD_POLL_MS); expect(request).toHaveBeenCalledTimes(1);
      controller.setActive(false);
    }
  });
});

describe('explicit queue changes and uncertain outcomes', () => {
  it('enqueues only explicit selected IDs, even outside Downloads, without starting background polling', async () => {
    vi.useFakeTimers();
    const request = vi.fn<DownloadRequest>().mockResolvedValue(status());
    const controller = new ReaderDownloadsController(request);
    expect(await controller.change({ kind: 'enqueue-downloads', ids: [11] })).toBe(true);
    expect(request.mock.calls).toEqual([[{ kind: 'enqueue-downloads', ids: [11] }]]);
    await vi.advanceTimersByTimeAsync(5 * DOWNLOAD_POLL_MS); expect(request).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().notice).toBe('enqueue-downloads');
  });
  it('refreshes an uncertain mutation exactly once without repeating it', async () => {
    const request = vi.fn<DownloadRequest>().mockResolvedValueOnce({ ...status(), uncertain: true }).mockResolvedValueOnce(status([], 'STOPPED'));
    const controller = new ReaderDownloadsController(request);
    expect(await controller.change({ kind: 'enqueue-downloads', ids: [11] })).toBe(false);
    expect(request.mock.calls).toEqual([[{ kind: 'enqueue-downloads', ids: [11] }], [{ kind: 'download-status' }]]);
    expect(controller.getSnapshot()).toMatchObject({ notice: 'uncertain', error: false, status: status([], 'STOPPED') });
  });
  it('treats a lost mutation response and failed reconciliation as uncertain and requires a fresh review', async () => {
    const request = vi.fn<DownloadRequest>().mockRejectedValue(new Error('private failure detail'));
    const controller = new ReaderDownloadsController(request);
    expect(await controller.change({ kind: 'enqueue-downloads', ids: [11] })).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot()).toMatchObject({ notice: 'uncertain', stale: true, error: true, busy: false });
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('private failure');
    expect(await controller.change({ kind: 'resume-downloads' })).toBe(false);
    expect(await controller.change({ kind: 'enqueue-downloads', ids: [12] })).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('distinguishes a fixed native preflight refusal from an uncertain mutation and refreshes its state', async () => {
    const request = vi.fn<DownloadRequest>().mockRejectedValueOnce(new Error('A selected chapter is already queued. Refresh download status or use Retry for failed downloads.')).mockResolvedValueOnce(status());
    const controller = new ReaderDownloadsController(request);
    expect(await controller.change({ kind: 'enqueue-downloads', ids: [11] })).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({ rejection: 'queued', notice: null, error: false, stale: false });
    expect(request.mock.calls).toEqual([[{ kind: 'enqueue-downloads', ids: [11] }], [{ kind: 'download-status' }]]);
  });
  it('revalidates selected membership and error state before retry, and cancels completed entries without a delete action', async () => {
    const rows: ReaderDownload[] = [item, { ...item, id: 12, position: 1, state: 'ERROR' }, { ...item, id: 13, position: 2, state: 'FINISHED', isDownloaded: true, progress: 1 }];
    const request = vi.fn<DownloadRequest>().mockResolvedValue(status(rows, 'STOPPED'));
    const controller = new ReaderDownloadsController(request); controller.setActive(true); await flush();
    expect(await controller.change({ kind: 'retry-downloads', ids: [11, 12] })).toBe(false);
    expect(await controller.change({ kind: 'cancel-downloads', ids: [99] })).toBe(false);
    expect(await controller.change({ kind: 'retry-downloads', ids: [12] })).toBe(true);
    expect(await controller.change({ kind: 'cancel-downloads', ids: [13] })).toBe(true);
    expect(request.mock.calls.map(call => call[0])).toEqual([{ kind: 'download-status' }, { kind: 'retry-downloads', ids: [12] }, { kind: 'cancel-downloads', ids: [13] }]);
    controller.setActive(false);
  });
});
