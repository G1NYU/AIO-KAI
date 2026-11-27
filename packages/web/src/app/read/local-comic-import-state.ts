export const MAX_LOCAL_COMIC_ARCHIVE_BYTES = 256 * 1024 * 1024;
export const MAX_LOCAL_COMIC_EXPANDED_BYTES = 512 * 1024 * 1024;
export const MAX_LOCAL_COMIC_PAGES = 2000;

export type LocalComicReview = {
  reviewId: string; title: string; archiveSha256: string; archiveBytes: number;
  expandedBytes: number; pageCount: number; duplicate: boolean;
};
export type LocalComicResult =
  | { reviewId: string; status: 'imported' | 'already-imported'; mangaId: number; title: string; pageCount: number }
  | { reviewId: string; status: 'published-unregistered'; title: string; pageCount: number }
  | { reviewId?: string; status: 'cancelled' };
export type LocalComicAction = { kind: 'begin-local-import' }
  | { kind: 'begin-vault-comic-import'; jobId: string }
  | { kind: 'apply-local-import' | 'cancel-local-import'; reviewId: string };
export type LocalComicRequest = (action: LocalComicAction) => Promise<unknown>;
export type LocalComicError = 'invalid' | 'expired' | 'folder' | 'unreadable' | 'vault' | 'chapter' | 'choose' | 'unconfirmed' | 'cancel';
export type LocalComicImportState = {
  phase: 'idle' | 'choosing' | 'review' | 'applying' | 'cancelling' | 'finished' | 'failed';
  review: LocalComicReview | null; result: LocalComicResult | null; error: LocalComicError | null;
};

function invalid(): never { throw new Error('Invalid local comic import response.'); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function integer(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= max;
}
function token(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{32}$/.test(value); }
function title(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value && [...value].length <= 200 && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}
export function parseLocalComicReview(value: unknown): LocalComicReview | { cancelled: true } {
  const raw = object(value);
  if (raw.cancelled === true) {
    if (Object.keys(raw).length !== 1) invalid();
    return { cancelled: true };
  }
  if (raw.cancelled !== undefined || !token(raw.reviewId) || !title(raw.title) || typeof raw.archiveSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(raw.archiveSha256) ||
      !integer(raw.archiveBytes, MAX_LOCAL_COMIC_ARCHIVE_BYTES) || !integer(raw.expandedBytes, MAX_LOCAL_COMIC_EXPANDED_BYTES) ||
      !integer(raw.pageCount, MAX_LOCAL_COMIC_PAGES) || typeof raw.duplicate !== 'boolean') invalid();
  return { reviewId: raw.reviewId, title: raw.title, archiveSha256: raw.archiveSha256, archiveBytes: raw.archiveBytes,
    expandedBytes: raw.expandedBytes, pageCount: raw.pageCount, duplicate: raw.duplicate };
}
export function parseLocalComicResult(value: unknown, review: LocalComicReview): LocalComicResult {
  const raw = object(value);
  if (raw.reviewId !== review.reviewId) invalid();
  if (raw.status === 'cancelled') {
    if (raw.mangaId !== undefined || raw.title !== undefined || raw.pageCount !== undefined) invalid();
    return { reviewId: review.reviewId, status: 'cancelled' };
  }
  if (raw.title !== review.title || raw.pageCount !== review.pageCount) invalid();
  if (raw.status === 'published-unregistered') {
    if (raw.mangaId !== undefined) invalid();
    return { reviewId: review.reviewId, status: raw.status, title: review.title, pageCount: review.pageCount };
  }
  if (!['imported', 'already-imported'].includes(raw.status as string) || !integer(raw.mangaId, 2147483647)) invalid();
  return { reviewId: review.reviewId, status: raw.status as 'imported' | 'already-imported', mangaId: raw.mangaId, title: review.title, pageCount: review.pageCount };
}
function parseCancellation(value: unknown, reviewId: string) {
  const raw = object(value);
  if (raw.reviewId !== reviewId || typeof raw.cancelled !== 'boolean') invalid();
}

// Fixed native errors only. Raw errors and file paths are never kept in state.
/* eslint-disable lingui/no-unlocalized-strings */
const knownErrors = new Map<string, LocalComicError>([
  ['The CBZ archive could not be safely imported. Choose a supported PNG/JPEG archive within the import limits.', 'invalid'],
  ['The CBZ import review expired or changed. Choose the archive again.', 'expired'],
  ['CBZ import requires the default private local manga folder.', 'folder'],
  ['The completed Vault CBZ is unavailable. Check the original download and review it again.', 'vault'],
  ['Close the current chapter before reviewing a Vault comic.', 'chapter'],
  ['The selected CBZ could not be read. Close other applications using it and choose it again.', 'unreadable'],
]);
/* eslint-enable lingui/no-unlocalized-strings */
function failure(reason: unknown, fallback: LocalComicError): LocalComicError {
  return reason instanceof Error ? knownErrors.get(reason.message) || fallback : fallback;
}
export function localComicImportBusy(state: LocalComicImportState) {
  return state.phase === 'choosing' || state.phase === 'applying' || state.phase === 'cancelling';
}

// Review capabilities are native-owned and one-use. Only explicit actions send
// requests; neither a partial result nor a lost reply repeats an apply operation.
export class LocalComicImportController {
  private state: LocalComicImportState = { phase: 'idle', review: null, result: null, error: null };
  private listeners = new Set<() => void>();
  private flight = false;
  private generation = 0;
  private mounted = true;
  constructor(private request: LocalComicRequest) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(state: LocalComicImportState) { this.state = state; if (this.mounted) this.listeners.forEach(listener => listener()); }
  private async release(reviewId: string) { parseCancellation(await this.request({ kind: 'cancel-local-import', reviewId }), reviewId); }
  setMounted(mounted: boolean) {
    this.mounted = mounted;
    if (mounted) return;
    this.generation++;
    const review = this.state.review;
    this.update({ phase: 'idle', review: null, result: null, error: null });
    if (review) void this.release(review.reviewId).catch(() => { /* Native expiry/restart cleanup remains authoritative. */ });
  }
  async begin(vaultJobId?: string): Promise<boolean> {
    if (this.flight || !this.mounted) return false;
    this.flight = true;
    const generation = ++this.generation;
    // A new native begin drops the old review before selecting or validating an archive.
    this.update({ phase: 'choosing', review: null, result: null, error: null });
    try {
      const result = parseLocalComicReview(await this.request(vaultJobId === undefined ? { kind: 'begin-local-import' } : { kind: 'begin-vault-comic-import', jobId: vaultJobId }));
      if (!this.mounted || generation !== this.generation) {
        if ('reviewId' in result) await this.release(result.reviewId).catch(() => {});
        return false;
      }
      this.update('cancelled' in result ? { phase: 'finished', review: null, result: { status: 'cancelled' }, error: null }
        : { phase: 'review', review: result, result: null, error: null });
      return 'reviewId' in result;
    } catch (reason) {
      if (this.mounted && generation === this.generation) this.update({ phase: 'failed', review: null, result: null, error: failure(reason, 'choose') });
      return false;
    } finally { this.flight = false; }
  }
  async apply(): Promise<LocalComicResult | null> {
    const review = this.state.review;
    if (this.flight || !this.mounted || !review) return null;
    this.flight = true;
    const generation = ++this.generation;
    this.update({ phase: 'applying', review: null, result: null, error: null });
    try {
      const result = parseLocalComicResult(await this.request({ kind: 'apply-local-import', reviewId: review.reviewId }), review);
      if (!this.mounted || generation !== this.generation) return null;
      this.update({ phase: 'finished', review: null, result, error: null });
      return result;
    } catch (reason) {
      if (this.mounted && generation === this.generation) this.update({ phase: 'failed', review: null, result: null, error: failure(reason, 'unconfirmed') });
      return null;
    } finally { this.flight = false; }
  }
  async cancel(): Promise<boolean> {
    if (this.flight || !this.mounted) return false;
    const review = this.state.review;
    if (!review) return true;
    this.flight = true;
    const generation = ++this.generation;
    this.update({ phase: 'cancelling', review: null, result: null, error: null });
    try {
      await this.release(review.reviewId);
      if (!this.mounted || generation !== this.generation) return false;
      this.update({ phase: 'finished', review: null, result: { status: 'cancelled' }, error: null });
      return true;
    } catch {
      if (this.mounted && generation === this.generation) this.update({ phase: 'failed', review: null, result: null, error: 'cancel' });
      return false;
    } finally { this.flight = false; }
  }
}
