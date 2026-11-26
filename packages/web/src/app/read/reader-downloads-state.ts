export const MAX_READER_DOWNLOADS = 1000;
export const MAX_DOWNLOAD_SELECTION = 100;
export const DOWNLOAD_POLL_MS = 4000;

export type ReaderDownload = {
  id: number; mangaId: number; mangaTitle: string; chapterName: string;
  pageCount: number; isDownloaded: boolean;
  state: 'QUEUED' | 'DOWNLOADING' | 'FINISHED' | 'ERROR';
  progress: number; tries: number; position: number;
};
export type ReaderDownloadStatus = { state: 'STARTED' | 'STOPPED'; queue: ReaderDownload[]; uncertain?: true };
export type DownloadMutation =
  | { kind: 'enqueue-downloads' | 'cancel-downloads' | 'retry-downloads'; ids: number[] }
  | { kind: 'pause-downloads' | 'resume-downloads' };
export type DownloadRequest = (action: DownloadMutation | { kind: 'download-status' }) => Promise<unknown>;
export type DownloadNotice = DownloadMutation['kind'] | 'uncertain' | null;
export type DownloadRejection = 'queued' | 'downloaded' | 'local' | 'unavailable' | 'changed' | 'capacity' | 'selection';
export type ReaderDownloadsState = {
  status: ReaderDownloadStatus | null; busy: boolean; stale: boolean;
  error: boolean; notice: DownloadNotice; rejection: DownloadRejection | null;
};

// Protocol matching only; translated presentation lives in DownloadFeedback.
/* eslint-disable lingui/no-unlocalized-strings */
const preflightRejections = new Map<string, DownloadRejection>([
  ['A selected chapter is already queued. Refresh download status or use Retry for failed downloads.', 'queued'],
  ['A selected chapter is already marked downloaded. Refresh the chapter list.', 'downloaded'],
  ['Select chapters from an installed online source; local chapters do not need downloading.', 'local'],
  ['The selected chapter source is unavailable. Reload installed sources before downloading.', 'unavailable'],
  ['The selected downloads changed. Refresh download status and select them again.', 'changed'],
  ['The download queue would exceed 1000 chapters.', 'capacity'],
  ['Select between 1 and 100 different chapters to download.', 'selection'],
]);
/* eslint-enable lingui/no-unlocalized-strings */

function invalid(): never { throw new Error('Invalid Reader download status.'); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function integer(value: unknown, min = 0, max = 2147483647): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}
function label(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && [...value].length <= 500 && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}
export function validateDownloadIds(ids: readonly number[]): number[] {
  if (!ids.length || ids.length > MAX_DOWNLOAD_SELECTION || new Set(ids).size !== ids.length || ids.some(id => !integer(id, 1))) invalid();
  return [...ids];
}
export function parseReaderDownloadStatus(value: unknown): ReaderDownloadStatus {
  const raw = object(value);
  if (!['STARTED', 'STOPPED'].includes(raw.state as string) || !Array.isArray(raw.queue) || raw.queue.length > MAX_READER_DOWNLOADS ||
      (raw.uncertain !== undefined && raw.uncertain !== true)) invalid();
  const ids = new Set<number>();
  const queue = raw.queue.map((value, position): ReaderDownload => {
    const row = object(value);
    if (!integer(row.id, 1) || !integer(row.mangaId, 1) || ids.has(row.id) || !label(row.mangaTitle) || !label(row.chapterName) ||
        !integer(row.pageCount, -1) || typeof row.isDownloaded !== 'boolean' || !['QUEUED', 'DOWNLOADING', 'FINISHED', 'ERROR'].includes(row.state as string) ||
        typeof row.progress !== 'number' || !Number.isFinite(row.progress) || row.progress < 0 || row.progress > 1 ||
        !integer(row.tries) || row.position !== position) invalid();
    ids.add(row.id);
    return { id: row.id, mangaId: row.mangaId, mangaTitle: row.mangaTitle, chapterName: row.chapterName,
      pageCount: row.pageCount, isDownloaded: row.isDownloaded, state: row.state as ReaderDownload['state'],
      progress: row.progress, tries: row.tries, position };
  });
  return { state: raw.state as ReaderDownloadStatus['state'], queue, ...(raw.uncertain === true ? { uncertain: true } : {}) };
}

// The engine owns the queue. This controller serializes requests, observes it
// only while visible, and never repeats a mutation to resolve an uncertain reply.
export class ReaderDownloadsController {
  private state: ReaderDownloadsState = { status: null, busy: false, stale: true, error: false, notice: null, rejection: null };
  private listeners = new Set<() => void>();
  private active = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flight: Promise<boolean> | null = null;
  constructor(private request: DownloadRequest) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<ReaderDownloadsState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener());
  }
  private clearTimer() { clearTimeout(this.timer); this.timer = undefined; }
  private schedule() {
    this.clearTimer();
    if (this.active && !this.state.stale && !this.state.error && this.state.status?.state === 'STARTED' &&
        this.state.status.queue.some(item => item.state === 'QUEUED' || item.state === 'DOWNLOADING')) {
      this.timer = setTimeout(() => { this.timer = undefined; void this.refresh(); }, DOWNLOAD_POLL_MS);
    }
  }
  setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    this.clearTimer();
    if (active) void this.refresh();
    else if (this.state.status) this.update({ stale: true });
  }
  private async status(): Promise<void> {
    const status = parseReaderDownloadStatus(await this.request({ kind: 'download-status' }));
    if (status.uncertain) invalid();
    this.update({ status, stale: false, error: false });
  }
  refresh(): Promise<boolean> {
    if (this.flight) return this.flight;
    this.clearTimer();
    this.update({ busy: true, error: false });
    this.flight = (async () => {
      try { await this.status(); return true; }
      catch { this.update({ stale: true, error: true }); return false; }
      finally { this.flight = null; this.update({ busy: false }); this.schedule(); }
    })();
    return this.flight;
  }
  change(action: DownloadMutation): Promise<boolean> {
    if (this.flight) return Promise.resolve(false);
    if (this.state.notice === 'uncertain' && this.state.error) return Promise.resolve(false);
    if ('ids' in action) action = { ...action, ids: validateDownloadIds(action.ids) };
    if (action.kind !== 'enqueue-downloads' && (this.state.stale || !this.state.status)) return Promise.resolve(false);
    if (action.kind === 'cancel-downloads' || action.kind === 'retry-downloads') {
      const queue = this.state.status!.queue;
      if (action.ids.some(id => !queue.some(item => item.id === id && (action.kind !== 'retry-downloads' || item.state === 'ERROR')))) return Promise.resolve(false);
    }
    this.clearTimer();
    this.update({ busy: true, error: false, notice: null, rejection: null });
    this.flight = (async () => {
      try {
        let rejection: DownloadRejection | null = null;
        try {
          const status = parseReaderDownloadStatus(await this.request(action));
          this.update({ status, stale: !!status.uncertain });
          if (!status.uncertain) { this.update({ notice: action.kind }); return true; }
        } catch (reason) {
          // Only these fixed native preflight errors prove no mutation ran.
          // Everything else, including transport failure, remains uncertain.
          rejection = reason instanceof Error ? preflightRejections.get(reason.message) || null : null;
        }
        this.update({ stale: true, notice: rejection ? null : 'uncertain', rejection });
        try { await this.status(); }
        catch { this.update({ stale: true, error: true }); }
        return false;
      } finally { this.flight = null; this.update({ busy: false }); this.schedule(); }
    })();
    return this.flight;
  }
}
