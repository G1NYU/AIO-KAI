import { describe, expect, it, vi } from 'vitest';
import { vaultTarget, vaultResponseAllowed } from '../src/app/vault/transfer';
import { LocalComicImportController, MAX_LOCAL_COMIC_ARCHIVE_BYTES, MAX_LOCAL_COMIC_EXPANDED_BYTES, parseLocalComicReview, parseLocalComicResult, type LocalComicRequest, type LocalComicReview } from '../src/app/read/local-comic-import-state';

function review(patch: Partial<LocalComicReview> = {}): LocalComicReview {
  return { reviewId: 'a'.repeat(32), title: 'Original local comic', archiveSha256: 'b'.repeat(64), archiveBytes: 1024, expandedBytes: 2048, pageCount: 4, duplicate: false, ...patch };
}
function result(value = review(), status = 'imported') { return { reviewId: value.reviewId, status, mangaId: 42, title: value.title, pageCount: value.pageCount }; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

describe('bounded native CBZ reviews', () => {
  it('accepts exact limits and Unicode titles while dropping unrequested private fields', () => {
    const value = review({ title: '📚'.repeat(200), archiveBytes: MAX_LOCAL_COMIC_ARCHIVE_BYTES, expandedBytes: MAX_LOCAL_COMIC_EXPANDED_BYTES, pageCount: 2000 });
    expect(parseLocalComicReview({ ...value, path: 'C:/private-marker/original.cbz', filename: 'private-marker' })).toEqual(value);
    expect(parseLocalComicReview({ cancelled: true })).toEqual({ cancelled: true });
  });
  it('rejects malformed capabilities, labels, counters, mixed cancellation and unbounded archives', () => {
    for (const patch of [
      { reviewId: 'A'.repeat(32) }, { reviewId: 'a'.repeat(31) }, { archiveSha256: 'f'.repeat(63) },
      { title: '' }, { title: ' trailing ' }, { title: 'a'.repeat(201) }, { title: 'hidden\nlabel' },
      { archiveBytes: 0 }, { archiveBytes: MAX_LOCAL_COMIC_ARCHIVE_BYTES + 1 }, { archiveBytes: '1024' },
      { expandedBytes: MAX_LOCAL_COMIC_EXPANDED_BYTES + 1 }, { expandedBytes: Infinity },
      { pageCount: 0 }, { pageCount: 1.5 }, { pageCount: 2001 }, { duplicate: 'true' }, { cancelled: false },
    ]) expect(() => parseLocalComicReview({ ...review(), ...patch })).toThrow();
    for (const value of [null, [], {}, { ...review(), cancelled: true }]) expect(() => parseLocalComicReview(value)).toThrow();
  });
  it('binds confirmed, duplicate, partial and cancelled results to their exact reviewed metadata', () => {
    const value = review();
    expect(parseLocalComicResult(result(), value)).toEqual(result());
    expect(parseLocalComicResult({ ...result(value, 'already-imported'), privatePath: 'private-marker' }, value)).toEqual(result(value, 'already-imported'));
    expect(parseLocalComicResult({ reviewId: value.reviewId, status: 'published-unregistered', title: value.title, pageCount: value.pageCount }, value)).toEqual({ reviewId: value.reviewId, status: 'published-unregistered', title: value.title, pageCount: value.pageCount });
    expect(parseLocalComicResult({ reviewId: value.reviewId, status: 'cancelled' }, value)).toEqual({ reviewId: value.reviewId, status: 'cancelled' });
    for (const patch of [{ reviewId: 'c'.repeat(32) }, { title: 'Different comic' }, { pageCount: 5 }, { mangaId: 0 }, { mangaId: '42' }, { mangaId: 2147483648 }, { status: 'unknown' }, { status: 'cancelled' }, { status: 'published-unregistered' }]) {
      expect(() => parseLocalComicResult({ ...result(), ...patch }, value)).toThrow();
    }
  });
});

describe('explicit local comic import lifecycle', () => {
  it('accepts bounded CBZ transfers and reviews a completed Vault job using only its ID', async () => {
    expect(vaultTarget('https://example.org/comic.cbz').extension).toBe('cbz');
    for (const mime of ['application/zip', 'application/vnd.comicbook+zip', 'application/x-cbz', 'application/octet-stream']) expect(vaultResponseAllowed('cbz', mime)).toBe(true);
    expect(vaultResponseAllowed('cbz', 'text/html')).toBe(false);
    const request = vi.fn<LocalComicRequest>().mockResolvedValueOnce(review()).mockResolvedValueOnce({ reviewId: review().reviewId, cancelled: true });
    const controller = new LocalComicImportController(request);
    expect(await controller.begin('vault-comic')).toBe(true);
    expect(await controller.cancel()).toBe(true);
    expect(request.mock.calls).toEqual([[{ kind: 'begin-vault-comic-import', jobId: 'vault-comic' }], [{ kind: 'cancel-local-import', reviewId: review().reviewId }]]);
  });
  it('keeps a missing Vault archive distinct from a cancelled picker', async () => {
    const request = vi.fn<LocalComicRequest>().mockRejectedValueOnce(new Error('The completed Vault CBZ is unavailable. Check the original download and review it again.'));
    const controller = new LocalComicImportController(request);
    expect(await controller.begin('vault-comic')).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({ phase: 'failed', review: null, error: 'vault' });
    expect(await controller.apply()).toBeNull();
  });
  it('opens the picker only explicitly, serializes a slow review and applies only the opaque capability once', async () => {
    const pending = deferred<unknown>();
    const request = vi.fn<LocalComicRequest>().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(result());
    const controller = new LocalComicImportController(request);
    expect(request).not.toHaveBeenCalled();
    const first = controller.begin();
    expect(await controller.begin()).toBe(false); expect(await controller.apply()).toBeNull(); expect(await controller.cancel()).toBe(false);
    pending.resolve(review()); expect(await first).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({ phase: 'review', review: review() });
    expect(await controller.apply()).toEqual(result());
    expect(await controller.apply()).toBeNull();
    expect(request.mock.calls).toEqual([[{ kind: 'begin-local-import' }], [{ kind: 'apply-local-import', reviewId: review().reviewId }]]);
    expect(controller.getSnapshot()).toMatchObject({ phase: 'finished', review: null, error: null });
  });
  it('handles picker and native-confirmation cancellation without retrying or publishing another request', async () => {
    const request = vi.fn<LocalComicRequest>().mockResolvedValueOnce({ cancelled: true }).mockResolvedValueOnce(review()).mockResolvedValueOnce({ reviewId: review().reviewId, status: 'cancelled' });
    const controller = new LocalComicImportController(request);
    expect(await controller.begin()).toBe(false);
    expect(controller.getSnapshot().result).toEqual({ status: 'cancelled' });
    expect(await controller.apply()).toBeNull();
    await controller.begin(); await controller.apply();
    expect(controller.getSnapshot().result?.status).toBe('cancelled');
    expect(await controller.apply()).toBeNull(); expect(request).toHaveBeenCalledTimes(3);
  });
  it('reuses duplicate content through the same capability without issuing any progress, bookmark or category mutation', async () => {
    const value = review({ duplicate: true });
    const request = vi.fn<LocalComicRequest>().mockResolvedValueOnce(value).mockResolvedValueOnce(result(value, 'already-imported'));
    const controller = new LocalComicImportController(request);
    await controller.begin(); await controller.apply();
    expect(controller.getSnapshot().result).toEqual(result(value, 'already-imported'));
    expect(request.mock.calls.map(call => call[0].kind)).toEqual(['begin-local-import', 'apply-local-import']);
  });
  it('keeps partial registration distinct from success and requires a new review to finish it', async () => {
    const next = review({ reviewId: 'c'.repeat(32), duplicate: true });
    const partial = { reviewId: review().reviewId, status: 'published-unregistered', title: review().title, pageCount: 4 };
    const request = vi.fn<LocalComicRequest>().mockResolvedValueOnce(review()).mockResolvedValueOnce(partial).mockResolvedValueOnce(next).mockResolvedValueOnce(result(next, 'already-imported'));
    const controller = new LocalComicImportController(request);
    await controller.begin(); await controller.apply();
    expect(controller.getSnapshot().result).toEqual(partial);
    expect(await controller.apply()).toBeNull(); expect(request).toHaveBeenCalledTimes(2);
    await controller.begin(); await controller.apply();
    expect(request.mock.calls[3][0]).toEqual({ kind: 'apply-local-import', reviewId: next.reviewId });
    expect(controller.getSnapshot().result).toEqual(result(next, 'already-imported'));
  });
  it('never repeats a transport-uncertain apply and does not retain raw failure text', async () => {
    const request = vi.fn<LocalComicRequest>().mockResolvedValueOnce(review()).mockRejectedValueOnce(new Error('C:/private-marker/secret.cbz'));
    const controller = new LocalComicImportController(request);
    await controller.begin(); expect(await controller.apply()).toBeNull();
    expect(controller.getSnapshot()).toMatchObject({ phase: 'failed', review: null, result: null, error: 'unconfirmed' });
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('private-marker');
    expect(await controller.apply()).toBeNull(); expect(request).toHaveBeenCalledTimes(2);
  });
  it('treats an invalid apply result as uncertain rather than opening the wrong comic', async () => {
    const request = vi.fn<LocalComicRequest>().mockResolvedValueOnce(review()).mockResolvedValueOnce({ ...result(), title: 'Other local comic' });
    const controller = new LocalComicImportController(request);
    await controller.begin(); expect(await controller.apply()).toBeNull();
    expect(controller.getSnapshot().error).toBe('unconfirmed'); expect(controller.getSnapshot().result).toBeNull();
  });
  it('surfaces only the known expired-review reason and discards the consumed capability', async () => {
    const request = vi.fn<LocalComicRequest>().mockResolvedValueOnce(review()).mockRejectedValueOnce(new Error('The CBZ import review expired or changed. Choose the archive again.'));
    const controller = new LocalComicImportController(request);
    await controller.begin(); await controller.apply();
    expect(controller.getSnapshot()).toMatchObject({ phase: 'failed', review: null, error: 'expired' });
    expect(await controller.apply()).toBeNull();
  });
  it('cancels the exact review, accepts already-expired cancellation and discards unconfirmed cancellation locally', async () => {
    for (const reply of [{ reviewId: review().reviewId, cancelled: true }, { reviewId: review().reviewId, cancelled: false }, { reviewId: 'f'.repeat(32), cancelled: true }]) {
      const request = vi.fn<LocalComicRequest>().mockResolvedValueOnce(review()).mockResolvedValueOnce(reply);
      const controller = new LocalComicImportController(request);
      await controller.begin(); const cancelled = await controller.cancel();
      expect(cancelled).toBe(reply.reviewId === review().reviewId);
      expect(request.mock.calls[1][0]).toEqual({ kind: 'cancel-local-import', reviewId: review().reviewId });
      expect(controller.getSnapshot().review).toBeNull();
      expect(await controller.apply()).toBeNull(); expect(request).toHaveBeenCalledTimes(2);
    }
  });
  it('releases a late staged review after unmount without applying it or reactivating the dialog', async () => {
    const pending = deferred<unknown>();
    const request = vi.fn<LocalComicRequest>().mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ reviewId: review().reviewId, cancelled: true });
    const controller = new LocalComicImportController(request);
    const opening = controller.begin(); controller.setMounted(false); pending.resolve(review());
    expect(await opening).toBe(false);
    expect(request.mock.calls).toEqual([[{ kind: 'begin-local-import' }], [{ kind: 'cancel-local-import', reviewId: review().reviewId }]]);
    expect(controller.getSnapshot()).toMatchObject({ phase: 'idle', review: null, result: null });
  });
});
