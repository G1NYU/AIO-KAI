import { t } from '@lingui/core/macro';
import { appBridge, ask } from './bridge';

export type MangaProgressPatch = {
  identity:string; expectedRead:boolean; expectedBookmarked:boolean;
  expectedLastPage:number; expectedPageCount:number; expectedLastReadAt:string;
  markRead:boolean; bookmark:boolean; page?:number;
};

export type ReadAction =
  | { kind: 'prepare' | 'status' | 'sources' | 'source-inventory' | 'library' | 'history' | 'updates' | 'categories' | 'library-update-status' | 'start-library-update' | 'stores' | 'refresh-extensions' | 'trackers' }
  | { kind: 'library-page'; offset: number }
  | { kind: 'save-category'; id?: number; name: string }
  | { kind: 'delete-category' | 'cached-manga' | 'backup-manga'; id: number }
  | { kind: 'restore-manga-progress'; id:number; identity:string; changes:MangaProgressPatch[] }
  | { kind: 'assign-category'; mangaId: number; categoryId: number; assigned: boolean }
  | { kind: 'add-store' | 'remove-store'; index: string }
  | { kind: 'extensions'; offset: number; query?: string; store?: string; language?: string; installed?: boolean; updatesOnly?: boolean; obsoleteOnly?: boolean; contentWarning?: 'SAFE' | 'MIXED' | 'NSFW' }
  | { kind: 'install-extension' | 'update-extension' | 'uninstall-extension'; package: string }
  | { kind: 'extension-icon'; package: string }
  | { kind: 'source-preferences'; source: string }
  | { kind: 'cancel-source-preferences'; reviewId: string }
  | { kind: 'apply-source-preference'; reviewId: string; controlId: string; value: boolean | number }
  | { kind: 'catalogue'; source: string; page: number; mode: 'popular' | 'latest' | 'search'; query?: string }
  | { kind: 'manga' | 'chapter' | 'cover'; id: number }
  | { kind: 'close-chapter'; chapterId: number; session: string }
  | { kind: 'download-cleanup-candidates'; offset: number }
  | { kind: 'download-status' | 'pause-downloads' | 'resume-downloads' }
  | { kind: 'enqueue-downloads' | 'cancel-downloads' | 'retry-downloads'; ids: number[] }
  | { kind: 'begin-local-import' }
  | { kind: 'apply-local-import' | 'cancel-local-import'; reviewId: string }
  | { kind: 'review-download-cleanup'; ids: number[] }
  | { kind: 'apply-download-cleanup' | 'cancel-download-cleanup'; reviewId: string }
  | { kind: 'set-library'; id: number; inLibrary: boolean }
  | { kind: 'page'; chapterId: number; index: number }
  | { kind: 'progress'; chapterId: number; index: number; finished: boolean }
  | { kind: 'chapter-flags'; ids: number[]; read?: boolean; bookmarked?: boolean }
  | { kind: 'tracker-login' | 'tracker-logout'; id: number }
  | { kind: 'track-records' | 'tracker-sync'; mangaId: number }
  | { kind: 'tracker-search'; id: number; query: string }
  | { kind: 'tracker-bind'; mangaId: number; id: number; remoteId: string }
  | { kind: 'tracker-unbind'; mangaId: number; recordId: number };

export function supportsReadingSection(): boolean {
  const bridge = appBridge();
  return bridge?.platform === 'windows' && (bridge.reading === true || bridge.readingSetup === true);
}

let preparedInSession = false;

export function supportsReading(): boolean {
  const bridge = appBridge();
  return bridge?.platform === 'windows' && (bridge.reading === true || preparedInSession);
}

let sequence = 0;
// An unmounted reader may encounter a busy native queue while releasing its
// capability. Retry that exact, idempotent release before a cleanup request.
const closingChapters = new Map<string, number>();
export async function readRequest<T>(action: ReadAction): Promise<T> {
  if (action.kind === 'prepare' ? !supportsReadingSection() : !supportsReading()) throw new Error(t({ id: "Reading is not available in this app.", message: "Reading is not available in this app." }));
  if (action.kind === 'download-cleanup-candidates' || action.kind === 'review-download-cleanup' || action.kind === 'apply-download-cleanup' || action.kind === 'source-preferences' || action.kind === 'apply-source-preference' || action.kind === 'begin-local-import' || action.kind === 'apply-local-import') {
    for (const [session, chapterId] of [...closingChapters]) await closeReadingChapter(chapterId, session);
  }
  const request = 'read-' + Date.now() + '-' + ++sequence;
  const response = await ask({ type: 'read-request', request, action }, 'read-result', {
    timeoutMs: action.kind === 'prepare' ? 20 * 60_000 : action.kind === 'update-extension' || action.kind === 'apply-download-cleanup' || action.kind === 'review-download-cleanup' || action.kind === 'apply-source-preference' || action.kind === 'begin-local-import' || action.kind === 'apply-local-import' ? 10 * 60_000 : action.kind === 'tracker-login' ? 240_000 : 180_000, matches: (message) => message.request === request,
  });
  if (response.error || response.data == null) throw new Error(response.error || t({ id: "Reading request returned no data.", message: "Reading request returned no data." }));
  return response.data as T;
}

export async function closeReadingChapter(chapterId: number, session: string): Promise<void> {
  if (!Number.isSafeInteger(chapterId) || chapterId <= 0 || !/^chapter-[1-9]\d{0,19}$/.test(session)) {
    throw new Error(t({ id: "The reading session could not be closed.", message: "The reading session could not be closed." }));
  }
  closingChapters.set(session, chapterId);
  const result = await readRequest<{ closed: boolean }>({ kind: 'close-chapter', chapterId, session });
  if (typeof result.closed !== 'boolean') throw new Error(t({ id: "The reading session could not be closed.", message: "The reading session could not be closed." }));
  closingChapters.delete(session);
}

export async function prepareReading(): Promise<void> {
  const result = await readRequest<{ ready: boolean }>({ kind: 'prepare' });
  if (result.ready !== true) throw new Error(t({ id: "Reading setup did not complete.", message: "Reading setup did not complete." }));
  preparedInSession = true;
}

export function isReaderPagePath(path: unknown): path is string {
  return typeof path === 'string' && /^\/__tsugi_read\/page\/\d+$/.test(path);
}

// The native image capability is a single-slot cache. Transfer each image
// completely into a local blob before issuing the next image operation.
// Reading pages take priority over queued covers, while one in-flight native
// transfer remains atomic. Covers and icons cache compressed bytes only, not object URLs.
type ImageAction = Extract<ReadAction, { kind: 'page' | 'extension-icon' }> | { kind: 'cover'; id: number };
type ImageJob = { action: ImageAction; signal?: AbortSignal; cacheTag?: string; resolve(url: string): void; reject(error: unknown): void };
const imageQueue: ImageJob[] = [];
const coverCache = new Map<number, Blob>();
const iconCache = new Map<string, Blob>();
let coverBytes = 0;
let iconBytes = 0;
let imageRunning = false;
function cachedIcon(key: string) {
  const blob = iconCache.get(key);
  if (blob) { iconCache.delete(key); iconCache.set(key, blob); }
  return blob;
}
function rememberIcon(key: string, blob: Blob) {
  const prior = iconCache.get(key);
  if (prior) iconBytes -= prior.size;
  iconCache.delete(key); iconCache.set(key, blob); iconBytes += blob.size;
  while (iconCache.size > 64 || iconBytes > 8 * 1024 * 1024) {
    const oldest = iconCache.keys().next().value;
    if (oldest === undefined) break;
    iconBytes -= iconCache.get(oldest)!.size; iconCache.delete(oldest);
  }
}
function cachedCover(id: number) {
  const blob = coverCache.get(id);
  if (blob) { coverCache.delete(id); coverCache.set(id, blob); }
  return blob;
}
function rememberCover(id: number, blob: Blob) {
  const prior = coverCache.get(id);
  if (prior) coverBytes -= prior.size;
  coverCache.delete(id);
  coverCache.set(id, blob);
  coverBytes += blob.size;
  while (coverCache.size > 48 || coverBytes > 32 * 1024 * 1024) {
    const oldest = coverCache.keys().next().value;
    if (oldest === undefined) break;
    coverBytes -= coverCache.get(oldest)!.size;
    coverCache.delete(oldest);
  }
}
async function transferImage(action: ImageAction, signal?: AbortSignal, cacheTag?: string): Promise<string> {
  signal?.throwIfAborted();
  const iconKey = action.kind === 'extension-icon' ? JSON.stringify([action.package, cacheTag || '']) : undefined;
  const cached = action.kind === 'cover' ? cachedCover(action.id) : iconKey ? cachedIcon(iconKey) : undefined;
  if (cached) return URL.createObjectURL(cached);
  const result = await readRequest<{ path: string; index?: number }>(action);
  signal?.throwIfAborted();
  if (!isReaderPagePath(result.path) || (action.kind === 'page' && result.index !== action.index))
    throw new Error(t({ id: "Invalid reading image.", message: "Invalid reading image." }));
  const response = await fetch(result.path, { cache: 'no-store', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(t({ id: "Could not load reading image.", message: "Could not load reading image." }));
  const blob = await response.blob();
  signal?.throwIfAborted();
  const limit = action.kind === 'extension-icon' ? 512 * 1024 : action.kind === 'cover' ? 4 * 1024 * 1024 : 24 * 1024 * 1024;
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(blob.type) || blob.size === 0 || blob.size > limit)
    throw new Error(t({ id: "Invalid reading image.", message: "Invalid reading image." }));
  if (action.kind === 'cover') rememberCover(action.id, blob);
  if (iconKey) rememberIcon(iconKey, blob);
  return URL.createObjectURL(blob);
}
function pumpImages() {
  if (imageRunning) return;
  while (imageQueue.length) {
    const priority = imageQueue.findIndex((job) => job.action.kind === 'page');
    const [job] = imageQueue.splice(priority < 0 ? 0 : priority, 1);
    if (job.signal?.aborted) { job.reject(job.signal.reason); continue; }
    imageRunning = true;
    void transferImage(job.action, job.signal, job.cacheTag).then(job.resolve, job.reject).finally(() => { imageRunning = false; pumpImages(); });
    return;
  }
}
export function readImage(action: ImageAction, signal?: AbortSignal, cacheTag?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    imageQueue.push({ action, signal, cacheTag, resolve, reject });
    pumpImages();
  });
}
