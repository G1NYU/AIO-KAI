import { sha256 } from '@noble/hashes/sha2.js';
import { readRequest, supportsReading } from '../hosts/shell/reading';
import { capturePortableArchive, parsePortableArchive, type PortableArchive } from './archive';
import { openManagedArchive, parseManagedBackup, saveManagedArchive, supportsManagedBackups, type ManagedBackup } from './managed-archive';
import { parseMangaBackup } from './manga';
import { reviewRestoreSection, runRestoreSection, RestoreSessionError } from './restore-session';

export const DOWNLOAD_CLEANUP_PAGE_SIZE = 100;
export const DOWNLOAD_CLEANUP_SELECTION_LIMIT = 50;
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const MAX_REVIEW_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_CANDIDATES = 10_000;
const HASH = /^[a-f\d]{64}$/;
const REVIEW_ID = /^[a-f\d]{32}$/;

export type DownloadCleanupItem = {
  chapterId: number; mangaId: number; mangaIdentity: string; chapterIdentity: string;
  mangaTitle: string; chapterName: string; sourceName: string;
  bytes: number; files: number; format: 'folder' | 'cbz';
};
export type DownloadCleanupCandidates = { items: DownloadCleanupItem[]; totalCount: number; totalBytes: number; offset: number };
export type DownloadCleanupReview = { reviewId: string; items: DownloadCleanupItem[]; totalBytes: number };
export type DownloadCleanupCancelled = { reviewId: string; cancelled: true };
export type DownloadCleanupResult = {
  reviewId: string;
  items: { chapterId: number; status: 'removed' | 'failed' | 'not-attempted'; bytes: number; error?: string }[];
  removedCount: number; removedBytes: number; metadataPreserved: boolean;
};
type CleanupErrorCode = 'unsupported' | 'response' | 'selection' | 'selection-size' | 'active-reader' | 'locks' | 'backup' | 'coverage' | 'changed' | 'expired';
export class DownloadCleanupError extends Error {
  constructor(readonly code: CleanupErrorCode) { super('download-cleanup-' + code); this.name = 'DownloadCleanupError'; }
}
function invalid(): never { throw new DownloadCleanupError('response'); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function exact(row: Record<string, unknown>, keys: string[]) {
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(row, key))) invalid();
}
function integer(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) return invalid();
  return value;
}
function label(value: unknown, maximum = 500): string {
  if (typeof value !== 'string' || !value.trim() || [...value].length > maximum ||
    new TextEncoder().encode(value).length > 2000 || /[\x00-\x1f\x7f-\x9f]|:\/\//.test(value)) return invalid();
  return value;
}
function hash(value: unknown): string { if (typeof value !== 'string' || !HASH.test(value)) return invalid(); return value; }
function reviewId(value: unknown): string { if (typeof value !== 'string' || !REVIEW_ID.test(value)) return invalid(); return value; }
function item(value: unknown): DownloadCleanupItem {
  const row = object(value);
  exact(row, ['chapterId', 'mangaId', 'mangaIdentity', 'chapterIdentity', 'mangaTitle', 'chapterName', 'sourceName', 'bytes', 'files', 'format']);
  if (row.format !== 'folder' && row.format !== 'cbz') return invalid();
  const files = integer(row.files, 1, 2001);
  if (row.format === 'cbz' && files !== 1) return invalid();
  return {
    chapterId: integer(row.chapterId, 1, 2147483647), mangaId: integer(row.mangaId, 1, 2147483647),
    mangaIdentity: hash(row.mangaIdentity), chapterIdentity: hash(row.chapterIdentity),
    mangaTitle: label(row.mangaTitle), chapterName: label(row.chapterName), sourceName: label(row.sourceName),
    bytes: integer(row.bytes, 1, MAX_DOWNLOAD_BYTES), files, format: row.format,
  };
}
function items(value: unknown, minimum: number, maximum: number): DownloadCleanupItem[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) return invalid();
  const rows = value.map(item);
  if (new Set(rows.map(row => row.chapterId)).size !== rows.length || new Set(rows.map(row => row.chapterIdentity)).size !== rows.length) invalid();
  const manga = new Map<number, string>(), identities = new Map<string, number>();
  for (const row of rows) {
    if ((manga.has(row.mangaId) && manga.get(row.mangaId) !== row.mangaIdentity) ||
      (identities.has(row.mangaIdentity) && identities.get(row.mangaIdentity) !== row.mangaId)) invalid();
    manga.set(row.mangaId, row.mangaIdentity); identities.set(row.mangaIdentity, row.mangaId);
  }
  return rows;
}
export function parseDownloadCleanupCandidates(value: unknown): DownloadCleanupCandidates {
  const row = object(value); exact(row, ['items', 'totalCount', 'totalBytes', 'offset']);
  const result = {
    items: items(row.items, 0, DOWNLOAD_CLEANUP_PAGE_SIZE),
    totalCount: integer(row.totalCount, 0, MAX_CANDIDATES),
    totalBytes: integer(row.totalBytes, 0, MAX_CANDIDATES * MAX_DOWNLOAD_BYTES),
    offset: integer(row.offset, 0, MAX_CANDIDATES),
  };
  const pageBytes = result.items.reduce((sum, entry) => sum + entry.bytes, 0);
  if (result.offset % DOWNLOAD_CLEANUP_PAGE_SIZE ||
    (result.totalCount === 0 ? result.offset !== 0 || result.totalBytes !== 0 : result.offset >= result.totalCount || result.totalBytes === 0) ||
    result.items.length !== Math.min(DOWNLOAD_CLEANUP_PAGE_SIZE, result.totalCount - result.offset) ||
    result.totalBytes < pageBytes || (result.items.length === result.totalCount && result.totalBytes !== pageBytes)) invalid();
  return result;
}
export function parseDownloadCleanupReview(value: unknown): DownloadCleanupReview {
  const row = object(value); exact(row, ['reviewId', 'items', 'totalBytes']);
  const result = { reviewId: reviewId(row.reviewId), items: items(row.items, 1, DOWNLOAD_CLEANUP_SELECTION_LIMIT), totalBytes: integer(row.totalBytes, 1, MAX_REVIEW_BYTES) };
  if (result.items.reduce((sum, entry) => sum + entry.bytes, 0) !== result.totalBytes) invalid();
  return result;
}
export function parseDownloadCleanupCancellation(value: unknown, expectedId: string): DownloadCleanupCancelled {
  const row = object(value); exact(row, ['reviewId', 'cancelled']);
  if (reviewId(row.reviewId) !== reviewId(expectedId) || row.cancelled !== true) return invalid();
  return { reviewId: expectedId, cancelled: true };
}
export function parseDownloadCleanupResult(value: unknown, reviewed: DownloadCleanupReview): DownloadCleanupResult | DownloadCleanupCancelled {
  const review = parseDownloadCleanupReview(reviewed), row = object(value);
  if (Object.prototype.hasOwnProperty.call(row, 'cancelled')) return parseDownloadCleanupCancellation(value, review.reviewId);
  exact(row, ['reviewId', 'items', 'removedCount', 'removedBytes', 'metadataPreserved']);
  if (reviewId(row.reviewId) !== review.reviewId || !Array.isArray(row.items) || row.items.length !== review.items.length || typeof row.metadataPreserved !== 'boolean') return invalid();
  let failed = false;
  const results: DownloadCleanupResult['items'] = row.items.map((value, index): DownloadCleanupResult['items'][number] => {
    const entry = object(value);
    exact(entry, ['chapterId', 'status', 'bytes', ...(Object.prototype.hasOwnProperty.call(entry, 'error') ? ['error'] : [])]);
    const chapterId = integer(entry.chapterId, 1, 2147483647), bytes = integer(entry.bytes, 0, MAX_DOWNLOAD_BYTES);
    if (chapterId !== review.items[index].chapterId) return invalid();
    const status = entry.status;
    if (status !== 'removed' && status !== 'failed' && status !== 'not-attempted') return invalid();
    if (status === 'removed') {
      if (failed || bytes !== review.items[index].bytes || 'error' in entry) invalid();
    } else {
      if (bytes !== 0 || (status === 'failed' ? failed : !failed)) invalid();
      failed = true;
    }
    return { chapterId, status, bytes, ...('error' in entry ? { error: label(entry.error, 256) } : {}) };
  });
  const removedCount = integer(row.removedCount, 0, review.items.length), removedBytes = integer(row.removedBytes, 0, review.totalBytes);
  if (removedCount !== results.filter(entry => entry.status === 'removed').length || removedBytes !== results.reduce((sum, entry) => sum + entry.bytes, 0) ||
    (!failed && !row.metadataPreserved)) invalid();
  return { reviewId: review.reviewId, items: results, removedCount, removedBytes, metadataPreserved: row.metadataPreserved };
}

export function supportsDownloadCleanup() { return supportsReading() && supportsManagedBackups(); }
function requireReady() {
  if (!supportsDownloadCleanup()) throw new DownloadCleanupError('unsupported');
  // Standalone restore writes permit a legacy lock fallback. Cleanup is
  // destructive, so require the actual shared cross-window lock service.
  if (typeof navigator === 'undefined' || !navigator.locks) throw new DownloadCleanupError('locks');
  reviewRestoreSection('manga', undefined);
  if (typeof document !== 'undefined' && document.querySelector('[data-ui="tsugi-book-reader"], .tsugi-chapter-reader'))
    throw new DownloadCleanupError('active-reader');
}
async function guarded<T>(work: () => Promise<T>): Promise<T> {
  requireReady();
  return runRestoreSection('manga', undefined, undefined, async () => { requireReady(); return work(); });
}
export async function listDownloadCleanupCandidates(offset = 0): Promise<DownloadCleanupCandidates> {
  integer(offset, 0, MAX_CANDIDATES);
  if (offset % DOWNLOAD_CLEANUP_PAGE_SIZE) throw new DownloadCleanupError('selection');
  return guarded(async () => {
    const result = parseDownloadCleanupCandidates(await readRequest<unknown>({ kind: 'download-cleanup-candidates', offset }));
    if (result.offset !== offset) throw new DownloadCleanupError('changed');
    requireReady(); return result;
  });
}
export async function reviewDownloadCleanup(selected: readonly DownloadCleanupItem[]): Promise<DownloadCleanupReview> {
  const requested = items(selected, 1, DOWNLOAD_CLEANUP_SELECTION_LIMIT);
  if (requested.reduce((sum, row) => sum + row.bytes, 0) > MAX_REVIEW_BYTES) throw new DownloadCleanupError('selection-size');
  return guarded(async () => {
    const result = parseDownloadCleanupReview(await readRequest<unknown>({ kind: 'review-download-cleanup', ids: requested.map(row => row.chapterId) }));
    if (result.items.length !== requested.length || result.items.some((row, index) => {
      const expected = requested[index];
      return row.chapterId !== expected.chapterId || row.mangaId !== expected.mangaId || row.mangaIdentity !== expected.mangaIdentity || row.chapterIdentity !== expected.chapterIdentity;
    })) throw new DownloadCleanupError('changed');
    requireReady(); return result;
  });
}
export async function cancelDownloadCleanup(review: DownloadCleanupReview): Promise<DownloadCleanupCancelled> {
  const id = parseDownloadCleanupReview(review).reviewId;
  return guarded(async () => parseDownloadCleanupCancellation(await readRequest<unknown>({ kind: 'cancel-download-cleanup', reviewId: id }), id));
}
function canonicalArchive(archive: PortableArchive) { return parsePortableArchive(JSON.stringify(archive)); }
function archiveDigest(archive: PortableArchive) {
  return Array.from(sha256(new TextEncoder().encode(JSON.stringify(canonicalArchive(archive)))), byte => byte.toString(16).padStart(2, '0')).join('');
}
function requireCoverage(archive: PortableArchive, review: DownloadCleanupReview) {
  const section = archive.entries.find(entry => entry.kind === 'manga');
  if (!section || archive.entries.length !== 4) throw new DownloadCleanupError('coverage');
  const manga = new Map(parseMangaBackup(section.payload).manga.map(row => [row.identity, row]));
  for (const selected of review.items) {
    const chapter = manga.get(selected.mangaIdentity)?.chapters.find(row => row.identity === selected.chapterIdentity);
    if (!chapter || !chapter.isRead || chapter.isBookmarked) throw new DownloadCleanupError('coverage');
  }
}
export type DownloadCleanupApplyOptions = {
  onStage?(stage: 'backup' | 'confirm'): void;
  onBackup?(backup: ManagedBackup): void;
  onDispatched?(): void;
};
export async function applyDownloadCleanup(reviewed: DownloadCleanupReview, options: DownloadCleanupApplyOptions = {}): Promise<{
  backup: ManagedBackup; outcome: DownloadCleanupResult | DownloadCleanupCancelled;
}> {
  const review = parseDownloadCleanupReview(reviewed);
  return guarded(async () => {
    options.onStage?.('backup');
    let backup: ManagedBackup;
    try {
      const archive = canonicalArchive(await capturePortableArchive(true));
      requireReady(); requireCoverage(archive, review);
      const expected = archiveDigest(archive);
      backup = parseManagedBackup(await saveManagedArchive(archive));
      if (!backup.name.startsWith('tsugi-backup-') || !backup.readable || backup.bytes !== new TextEncoder().encode(JSON.stringify(archive)).length) throw new DownloadCleanupError('backup');
      const reopened = canonicalArchive(await openManagedArchive(backup.name));
      if (archiveDigest(reopened) !== expected) throw new DownloadCleanupError('backup');
      requireCoverage(reopened, review);
    } catch (reason) {
      if (reason instanceof DownloadCleanupError || reason instanceof RestoreSessionError) throw reason;
      throw new DownloadCleanupError('backup');
    }
    options.onBackup?.(backup);
    requireReady(); options.onStage?.('confirm'); options.onDispatched?.();
    let response: unknown;
    try { response = await readRequest<unknown>({ kind: 'apply-download-cleanup', reviewId: review.reviewId }); }
    catch (reason) {
      // These exact native errors are guaranteed to precede every mutation.
      // The same wording inside a per-item result can follow earlier removals
      // and must retain that result's partial-work accounting instead.
      if (reason instanceof Error && reason.message === 'The cleanup review expired or the Reader restarted. Review the selection again.') throw new DownloadCleanupError('expired');
      if (reason instanceof Error && reason.message === 'The reviewed downloads or reading state changed. Review the selection again.') throw new DownloadCleanupError('changed');
      throw reason;
    }
    const outcome = parseDownloadCleanupResult(response, review);
    return { backup, outcome };
  });
}
