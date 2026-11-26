import { parseSourceFeedPreferences, type SourceFeedMode, type SourceFeedPreferences } from './source-feed-preferences';

export type FeedSource = { id: string; name: string; lang: string; displayName?: string; supportsLatest: boolean };
export type FeedManga = { id: number; sourceId: string; title: string; author: string | null; thumbnailUrl: string | null; inLibrary: boolean };
export type FeedCatalogue = { mangas: FeedManga[]; hasNextPage: boolean };
export type FeedRequest = { source: string; mode: SourceFeedMode; page: number };
export type FeedRow = {
  sourceId: string; mode: SourceFeedMode; page: number; requestedPage?: number;
  status: 'idle' | 'queued' | 'loading' | 'ready' | 'error';
  result?: FeedCatalogue; error?: 'request' | 'invalid';
};
export type SourceFeedSnapshot = {
  rows: FeedRow[]; busy: boolean; stopping: boolean; completed: number; total: number;
  phase: 'idle' | 'running' | 'complete' | 'stopped';
};
export const MAX_FEED_PAGE = 1000;
export const MAX_FEED_TITLES = 200;
class InvalidFeedResponse extends Error {}
function invalid(): never { throw new InvalidFeedResponse('invalid-feed-response'); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function label(value: unknown, maximum: number, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.trim()) || [...value].length > maximum || /[\u0000-\u001f\u007f-\u009f]/.test(value)) return invalid();
  return value;
}
function sourceId(value: unknown): string {
  if (typeof value !== 'string' || !/^(0|-?[1-9]\d{0,18})$/.test(value)) return invalid();
  const id = BigInt(value);
  if (id < -9223372036854775808n || id > 9223372036854775807n) return invalid();
  return value;
}
/** totalCount includes unavailable database rows. complete means the native
 * adapter scanned every bounded raw page, not that every row could be loaded. */
export function parseFeedSourceInventory(value: unknown): FeedSource[] {
  const root = record(value);
  if (root.complete !== true || !Number.isSafeInteger(root.totalCount) || Number(root.totalCount) < 0 || Number(root.totalCount) > 1000 ||
      !Array.isArray(root.nodes) || root.nodes.length > Number(root.totalCount)) return invalid();
  const seen = new Set<string>();
  return root.nodes.map(value => {
    const row = record(value), id = sourceId(row.id);
    if (seen.has(id) || typeof row.supportsLatest !== 'boolean') return invalid();
    seen.add(id);
    return { id, name: label(row.name, 500), lang: label(row.lang, 64, true), supportsLatest: row.supportsLatest,
      ...(row.displayName == null ? {} : { displayName: label(row.displayName, 500, true) }) };
  }).filter(row => row.id !== '0');
}
/** Project only the bounded card fields. Provider errors and URLs are never
 * persisted by Feed; artwork still goes through the existing native cover API. */
export function parseFeedCatalogue(value: unknown, expectedSource: string): FeedCatalogue {
  const root = record(value);
  if (typeof root.hasNextPage !== 'boolean' || !Array.isArray(root.mangas) || root.mangas.length > MAX_FEED_TITLES) return invalid();
  const seen = new Set<number>();
  const mangas = root.mangas.map(value => {
    const row = record(value);
    const id = typeof row.id === 'string' && /^[1-9]\d{0,9}$/.test(row.id) ? Number(row.id) : row.id;
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 1 || id > 2147483647 || seen.has(id) ||
        sourceId(row.sourceId) !== expectedSource || typeof row.inLibrary !== 'boolean') return invalid();
    seen.add(id);
    return { id, sourceId: expectedSource, title: label(row.title, 1000),
      author: row.author == null ? null : label(row.author, 1000, true),
      thumbnailUrl: row.thumbnailUrl == null ? null : label(row.thumbnailUrl, 4096, true), inLibrary: row.inLibrary };
  });
  return { mangas, hasNextPage: root.hasNextPage };
}

/** One catalogue request at a time. An issued native request cannot be aborted;
 * cancellation invalidates its reply and stops dispatching further sources. */
export class SourceFeedController {
  private sources = new Map<string, FeedSource>();
  private configuration = '';
  private active = false;
  private generation = 0;
  private queue: FeedRequest[] = [];
  private listeners = new Set<() => void>();
  private state: SourceFeedSnapshot = { rows: [], busy: false, stopping: false, completed: 0, total: 0, phase: 'idle' };
  constructor(private fetchCatalogue: (request: FeedRequest) => Promise<unknown>) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<SourceFeedSnapshot>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  configure(preferences: SourceFeedPreferences, sources: FeedSource[]) {
    const selection = parseSourceFeedPreferences(preferences);
    const configuration = JSON.stringify([selection.sources, sources]);
    if (configuration === this.configuration) return;
    this.cancel();
    const previous = this.sources, rows = this.state.rows;
    this.sources = new Map(sources.map(source => [source.id, source]));
    this.configuration = configuration;
    this.publish({ rows: selection.sources.map(choice => {
      const old = rows.find(row => row.sourceId === choice.sourceId && row.mode === choice.mode);
      return old && JSON.stringify(previous.get(choice.sourceId)) === JSON.stringify(this.sources.get(choice.sourceId))
        ? old : { ...choice, page: 1, status: 'idle' };
    }) });
  }
  setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    if (!active) this.cancel();
  }
  eligible(row: Pick<FeedRow, 'sourceId' | 'mode'>) {
    const source = this.sources.get(row.sourceId);
    return !!source && (row.mode === 'popular' || source.supportsLatest);
  }
  cancel() {
    this.generation++;
    this.queue = [];
    this.publish({ stopping: this.state.busy, completed: 0, total: 0, phase: 'idle',
      rows: this.state.rows.map(row => row.status === 'loading' || row.status === 'queued'
        ? { ...row, status: row.result ? 'ready' : 'idle', requestedPage: undefined, error: undefined } : row) });
  }
  stopAfterCurrent() {
    if (!this.state.busy) return;
    this.queue = [];
    this.publish({ stopping: true, rows: this.state.rows.map(row => row.status === 'queued'
      ? { ...row, status: row.result ? 'ready' : 'idle', requestedPage: undefined } : row) });
  }
  refresh() {
    if (!this.active || this.state.busy) return false;
    return this.start(this.state.rows.filter(row => this.eligible(row)).map(row => ({ source: row.sourceId, mode: row.mode, page: 1 })));
  }
  refreshSource(source: string) { return this.requestPage(source, 1); }
  retry(source: string) {
    const row = this.state.rows.find(row => row.sourceId === source);
    return row?.status === 'error' ? this.requestPage(source, row.requestedPage ?? 1) : false;
  }
  previous(source: string) {
    const row = this.state.rows.find(row => row.sourceId === source);
    return row?.result && row.page > 1 ? this.requestPage(source, row.page - 1) : false;
  }
  next(source: string) {
    const row = this.state.rows.find(row => row.sourceId === source);
    return row?.result?.hasNextPage && row.page < MAX_FEED_PAGE ? this.requestPage(source, row.page + 1) : false;
  }
  private requestPage(source: string, page: number) {
    const row = this.state.rows.find(row => row.sourceId === source);
    if (!this.active || this.state.busy || !row || !this.eligible(row) || !Number.isInteger(page) || page < 1 || page > MAX_FEED_PAGE) return false;
    return this.start([{ source, mode: row.mode, page }]);
  }
  private start(requests: FeedRequest[]) {
    if (!requests.length) return false;
    this.queue = requests;
    this.publish({ busy: true, stopping: false, completed: 0, total: requests.length, phase: 'running',
      rows: this.state.rows.map(row => {
        const request = requests.find(request => request.source === row.sourceId);
        return request ? { ...row, status: 'queued', requestedPage: request.page, error: undefined } : row;
      }) });
    void this.drain(this.generation);
    return true;
  }
  private async drain(generation: number) {
    while (this.active && generation === this.generation && this.queue.length) {
      const request = this.queue.shift()!;
      this.publish({ rows: this.state.rows.map(row => row.sourceId === request.source ? { ...row, status: 'loading' } : row) });
      let result: FeedCatalogue | undefined, error: FeedRow['error'];
      try { result = parseFeedCatalogue(await this.fetchCatalogue(request), request.source); }
      catch (reason) { error = reason instanceof InvalidFeedResponse ? 'invalid' : 'request'; }
      if (!this.active || generation !== this.generation) break;
      this.publish({ completed: this.state.completed + 1, rows: this.state.rows.map(row => row.sourceId !== request.source ? row : result
        ? { ...row, page: request.page, result, status: 'ready', error: undefined, requestedPage: undefined }
        : { ...row, status: 'error', error, requestedPage: request.page }) });
    }
    this.publish({ busy: false, stopping: false, phase: generation !== this.generation ? 'idle' : this.state.stopping ? 'stopped' : 'complete' });
  }
}
