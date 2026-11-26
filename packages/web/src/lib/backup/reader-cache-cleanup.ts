import { readRequest, supportsReading } from '../hosts/shell/reading';
import { reviewRestoreSection, runRestoreSection } from './restore-session';

const GROUPS = ['pages', 'thumbnails'] as const;
const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 512 * 1024 * 1024;
const MAX_BYTES = 2 * 1024 * 1024 * 1024;
const REVIEW_ID = /^[a-f\d]{32}$/;

export type ReaderCacheGroup = { kind: typeof GROUPS[number]; files: number; bytes: number };
export type ReaderCacheReview = {
  reviewId: string; groups: ReaderCacheGroup[]; totalFiles: number; totalBytes: number; expiresInSeconds: 600;
};
export type ReaderCacheCancellation = { reviewId: string; status: 'cancelled' };
export type ReaderCacheResult = {
  reviewId: string; status: 'removed' | 'partial';
  groups: { kind: ReaderCacheGroup['kind']; removedFiles: number; removedBytes: number }[];
  removedFiles: number; removedBytes: number; runtimeReady: boolean; message: string;
};
type NativeRefusalCode = 'native-changed' | 'native-unsafe' | 'native-unverified' | 'native-in-use' | 'native-busy' | 'native-reader-open' | 'native-closing';
type ErrorCode = 'unsupported' | 'locks' | 'active-reader' | 'response' | 'empty' | NativeRefusalCode;
// Only these exact native errors are guaranteed to precede file removal.
// Unknown errors, including transport loss, must retain an uncertain outcome.
/* eslint-disable lingui/no-unlocalized-strings -- Exact native protocol keys; the Settings component localizes their feedback. */
const NATIVE_REFUSALS = new Map<string, NativeRefusalCode>([
  ['The Reader image cache changed or the review expired. Review the cache again. No images were removed.', 'native-changed'],
  ['A Reader image cache path is redirected, shared, or outside private storage. No images were removed.', 'native-unsafe'],
  ['The Reader image cache could not be verified within its safety limits. No images were removed.', 'native-unverified'],
  ['A Reader image cache file is in use or cannot be removed. Close it and review the cache again. No images were removed.', 'native-in-use'],
  ['Finish Reader downloads and library updates, and disable automatic jobs before clearing cached images. No images were removed.', 'native-busy'],
  ['The Reader image cache review is no longer available. Review the cache again. No images were removed.', 'native-changed'],
  ['Close the open manga chapter before clearing cached images. No images were removed.', 'native-reader-open'],
  ['Reading is closing. No images were removed.', 'native-closing'],
]);
/* eslint-enable lingui/no-unlocalized-strings */
export class ReaderCacheCleanupError extends Error {
  constructor(readonly code: ErrorCode) { super('reader-cache-cleanup-' + code); this.name = 'ReaderCacheCleanupError'; }
  get noImagesRemoved() { return this.code.startsWith('native-'); }
}
function invalid(): never { throw new ReaderCacheCleanupError('response'); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function exact(row: Record<string, unknown>, keys: string[]) {
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(row, key))) invalid();
}
function integer(value: unknown, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum) return invalid();
  return value;
}
function reviewId(value: unknown): string {
  if (typeof value !== 'string' || !REVIEW_ID.test(value)) return invalid();
  return value;
}
function counts(files: unknown, bytes: unknown) {
  const count = integer(files, MAX_FILES), size = integer(bytes, MAX_BYTES);
  if (size > count * MAX_FILE_BYTES) invalid();
  return { files: count, bytes: size };
}
function message(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 256 ||
    /[\x00-\x1f\x7f-\x9f]|:\/\/|[a-z]:[\\/]|^\s*[\\/]/i.test(value)) return invalid();
  return value;
}
export function parseReaderCacheReview(value: unknown): ReaderCacheReview {
  const row = object(value);
  exact(row, ['reviewId', 'groups', 'totalFiles', 'totalBytes', 'expiresInSeconds']);
  if (!Array.isArray(row.groups) || row.groups.length !== GROUPS.length || row.expiresInSeconds !== 600) return invalid();
  const groups = row.groups.map((value, index): ReaderCacheGroup => {
    const group = object(value); exact(group, ['kind', 'files', 'bytes']);
    if (group.kind !== GROUPS[index]) return invalid();
    return { kind: GROUPS[index], ...counts(group.files, group.bytes) };
  });
  const total = counts(row.totalFiles, row.totalBytes);
  if (groups.reduce((sum, group) => sum + group.files, 0) !== total.files ||
    groups.reduce((sum, group) => sum + group.bytes, 0) !== total.bytes) invalid();
  return { reviewId: reviewId(row.reviewId), groups, totalFiles: total.files, totalBytes: total.bytes, expiresInSeconds: 600 };
}
export function parseReaderCacheCancellation(value: unknown, expectedId: string): ReaderCacheCancellation {
  const row = object(value); exact(row, ['reviewId', 'status']);
  if (reviewId(row.reviewId) !== reviewId(expectedId) || row.status !== 'cancelled') return invalid();
  return { reviewId: expectedId, status: 'cancelled' };
}
export function parseReaderCacheResult(value: unknown, reviewed: ReaderCacheReview): ReaderCacheResult | ReaderCacheCancellation {
  const review = parseReaderCacheReview(reviewed), row = object(value);
  if (row.status === 'cancelled') return parseReaderCacheCancellation(value, review.reviewId);
  exact(row, ['reviewId', 'status', 'groups', 'removedFiles', 'removedBytes', 'runtimeReady', 'message']);
  if (reviewId(row.reviewId) !== review.reviewId || (row.status !== 'removed' && row.status !== 'partial') ||
    typeof row.runtimeReady !== 'boolean' || !Array.isArray(row.groups) || row.groups.length !== GROUPS.length) return invalid();
  const groups = row.groups.map((value, index) => {
    const group = object(value); exact(group, ['kind', 'removedFiles', 'removedBytes']);
    if (group.kind !== GROUPS[index]) return invalid();
    const removed = counts(group.removedFiles, group.removedBytes), expected = review.groups[index];
    if (removed.files > expected.files || removed.bytes > expected.bytes ||
      (removed.files === expected.files && removed.bytes !== expected.bytes)) invalid();
    counts(expected.files - removed.files, expected.bytes - removed.bytes);
    return { kind: GROUPS[index], removedFiles: removed.files, removedBytes: removed.bytes };
  });
  const removed = counts(row.removedFiles, row.removedBytes);
  if (groups.reduce((sum, group) => sum + group.removedFiles, 0) !== removed.files ||
    groups.reduce((sum, group) => sum + group.removedBytes, 0) !== removed.bytes) invalid();
  const complete = removed.files === review.totalFiles && removed.bytes === review.totalBytes;
  if ((row.status === 'removed') !== complete) invalid();
  return { reviewId: review.reviewId, status: row.status, groups, removedFiles: removed.files,
    removedBytes: removed.bytes, runtimeReady: row.runtimeReady, message: message(row.message) };
}

export function supportsReaderCacheCleanup() { return supportsReading(); }
function requireReady() {
  if (!supportsReaderCacheCleanup()) throw new ReaderCacheCleanupError('unsupported');
  if (typeof navigator === 'undefined' || !navigator.locks) throw new ReaderCacheCleanupError('locks');
  reviewRestoreSection('manga', undefined);
  if (typeof document !== 'undefined' && document.querySelector('[data-ui="tsugi-book-reader"], .tsugi-chapter-reader'))
    throw new ReaderCacheCleanupError('active-reader');
}
async function guarded<T>(work: () => Promise<T>): Promise<T> {
  requireReady();
  return runRestoreSection('manga', undefined, undefined, async () => {
    requireReady();
    try { return await work(); }
    catch (reason) {
      const refusal = reason instanceof Error ? NATIVE_REFUSALS.get(reason.message) : undefined;
      if (refusal) throw new ReaderCacheCleanupError(refusal);
      throw reason;
    }
  });
}
export async function reviewReaderCacheCleanup(): Promise<ReaderCacheReview> {
  return guarded(async () => {
    const review = parseReaderCacheReview(await readRequest<unknown>({ kind: 'review-image-cache-cleanup' }));
    requireReady(); return review;
  });
}
export async function cancelReaderCacheCleanup(reviewed: ReaderCacheReview): Promise<ReaderCacheCancellation> {
  const review = parseReaderCacheReview(reviewed);
  return guarded(async () => parseReaderCacheCancellation(
    await readRequest<unknown>({ kind: 'cancel-image-cache-cleanup', reviewId: review.reviewId }), review.reviewId));
}
export async function applyReaderCacheCleanup(reviewed: ReaderCacheReview, onDispatched?: () => void): Promise<ReaderCacheResult | ReaderCacheCancellation> {
  const review = parseReaderCacheReview(reviewed);
  if (!review.totalFiles) throw new ReaderCacheCleanupError('empty');
  return guarded(async () => {
    requireReady(); onDispatched?.();
    const response = await readRequest<unknown>({ kind: 'apply-image-cache-cleanup', reviewId: review.reviewId });
    return parseReaderCacheResult(response, review);
  });
}
