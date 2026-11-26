import { describe, expect, it, vi } from 'vitest';
import { MAX_FEED_PAGE, MAX_FEED_TITLES, SourceFeedController, parseFeedCatalogue, parseFeedSourceInventory, type FeedRequest, type FeedSource } from '../src/app/read/source-feed-state';
import type { SourceFeedPreferences } from '../src/app/read/source-feed-preferences';

const sources: FeedSource[] = [
  { id: '-9223372036854775808', name: 'Original A', lang: 'en', supportsLatest: true },
  { id: '9007199254740993', name: 'Original B', lang: 'fr', supportsLatest: false },
];
const choices: SourceFeedPreferences = { version: 1, sources: sources.map(source => ({ sourceId: source.id, mode: 'popular' })) };
function catalogue(source = sources[0].id, page = 1, hasNextPage = true) {
  return { mangas: [{ id: page, sourceId: source, title: 'Original page ' + page, author: null, thumbnailUrl: null, inLibrary: false }], hasNextPage };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { for (let i = 0; i < 4; i++) await Promise.resolve(); }
function fixture(preferences = choices) {
  const pending: ReturnType<typeof deferred<unknown>>[] = [];
  const requests: FeedRequest[] = [];
  let concurrent = 0, maximum = 0;
  const controller = new SourceFeedController(request => {
    requests.push(request); concurrent++; maximum = Math.max(maximum, concurrent);
    const next = deferred<unknown>(); pending.push(next);
    return next.promise.finally(() => { concurrent--; });
  });
  controller.configure(preferences, sources); controller.setActive(true);
  return { controller, pending, requests, maximum: () => maximum };
}

describe('bounded source Feed responses', () => {
  it('accepts a complete scan with unavailable raw rows and retains exact signed 64-bit identities', () => {
    expect(parseFeedSourceInventory({ complete: true, totalCount: 103, nodes: [{ ...sources[0], id: '0' }, ...sources] })).toEqual(sources);
    expect(parseFeedSourceInventory({ complete: true, totalCount: 3, nodes: [] })).toEqual([]);
  });
  it('refuses incomplete, excessive, duplicate, rounded or malformed source inventories', () => {
    const good = { complete: true, totalCount: 2, nodes: sources };
    for (const value of [
      { ...good, complete: false }, { ...good, totalCount: 1001 }, { ...good, totalCount: 1 },
      { ...good, nodes: [sources[0], sources[0]] }, { ...good, totalCount: 2.1 },
      ...[9007199254740993, '+1', '-0', '01', '9223372036854775808', '-9223372036854775809'].map(id => ({ ...good, nodes: [{ ...sources[0], id }] })),
      { ...good, nodes: [{ ...sources[0], name: 'bad\nlabel' }] }, { ...good, nodes: [{ ...sources[0], supportsLatest: 'true' }] },
    ]) expect(() => parseFeedSourceInventory(value)).toThrow();
  });
  it('projects bounded card data and refuses mixed sources, duplicate or unsafe title identities', () => {
    const good = catalogue();
    expect(parseFeedCatalogue({ ...good, ignored: 'not copied' }, sources[0].id)).toEqual(good);
    expect(parseFeedCatalogue({ ...good, mangas: [{ ...good.mangas[0], id: '12' }] }, sources[0].id).mangas[0].id).toBe(12);
    for (const value of [
      { ...good, hasNextPage: 1 }, { ...good, mangas: Array(MAX_FEED_TITLES + 1).fill(good.mangas[0]) },
      { ...good, mangas: [good.mangas[0], good.mangas[0]] },
      ...[0, -1, 1.5, 2147483648, '01'].map(id => ({ ...good, mangas: [{ ...good.mangas[0], id }] })),
      { ...good, mangas: [{ ...good.mangas[0], sourceId: sources[1].id }] },
      { ...good, mangas: [{ ...good.mangas[0], title: 'a'.repeat(1001) }] },
      { ...good, mangas: [{ ...good.mangas[0], inLibrary: 'false' }] },
    ]) expect(() => parseFeedCatalogue(value, sources[0].id)).toThrow();
  });
});

describe('explicit sequential source Feed', () => {
  it('never contacts catalogues for opening, configuration, visibility changes or missing saved sources', () => {
    const { controller, requests } = fixture({ version: 1, sources: [...choices.sources, { sourceId: '19', mode: 'latest' }] });
    controller.setActive(false); controller.setActive(true); controller.configure(choices, sources);
    expect(requests).toEqual([]);
    expect(controller.getSnapshot().rows).toHaveLength(2);
  });
  it('runs only selected supported sources, one at a time, and continues after an isolated failure', async () => {
    const { controller, pending, requests, maximum } = fixture();
    expect(controller.refresh()).toBe(true);
    expect(requests).toEqual([{ source: sources[0].id, mode: 'popular', page: 1 }]);
    expect(controller.refresh()).toBe(false);
    expect(controller.next(sources[0].id)).toBe(false);
    pending[0].reject(new Error('private provider URL must not escape'));
    await flush();
    expect(requests).toHaveLength(2);
    pending[1].resolve(catalogue(sources[1].id)); await flush();
    expect(maximum()).toBe(1);
    const state = controller.getSnapshot();
    expect(state.rows[0].error).toBe('request');
    expect(state.rows[1].result?.mangas[0].sourceId).toBe(sources[1].id);
    expect(state.completed).toBe(2); expect(state.phase).toBe('complete');
    expect(JSON.stringify(state)).not.toContain('private provider');
  });
  it('skips missing sources and unsupported Latest without silently substituting Popular', async () => {
    const preferences: SourceFeedPreferences = { version: 1, sources: [choices.sources[0], { sourceId: sources[1].id, mode: 'latest' }, { sourceId: '19', mode: 'popular' }] };
    const { controller, requests, pending } = fixture(preferences);
    controller.refresh(); pending[0].resolve(catalogue()); await flush();
    expect(requests).toHaveLength(1);
    expect(controller.getSnapshot().rows).toHaveLength(3);
    expect(controller.refreshSource(sources[1].id)).toBe(false);
    expect(controller.refreshSource('19')).toBe(false);
  });
  it('stops after the issued source, accepts its result and leaves later sources untouched', async () => {
    const { controller, pending, requests } = fixture();
    controller.refresh(); controller.stopAfterCurrent();
    expect(controller.getSnapshot().stopping).toBe(true);
    pending[0].resolve(catalogue()); await flush();
    expect(requests).toHaveLength(1);
    expect(controller.getSnapshot()).toMatchObject({ busy: false, phase: 'stopped', completed: 1, total: 2 });
    expect(controller.getSnapshot().rows[0].result).toBeDefined();
    expect(controller.getSnapshot().rows[1].status).toBe('idle');
  });
  it('discards late replies and queued sources after leaving Feed, including immediate return', async () => {
    const { controller, pending, requests } = fixture();
    controller.refresh(); controller.setActive(false); controller.setActive(true);
    expect(controller.refresh()).toBe(false); // The old native request is still finishing.
    pending[0].resolve(catalogue()); await flush();
    expect(requests).toHaveLength(1);
    expect(controller.getSnapshot().rows.every(row => !row.result)).toBe(true);
    expect(controller.getSnapshot().busy).toBe(false);
    expect(controller.refresh()).toBe(true);
    pending[1].resolve(catalogue()); await flush();
    pending[2].resolve(catalogue(sources[1].id)); await flush();
    expect(controller.getSnapshot().completed).toBe(2);
  });
  it('invalidates in-flight replies on selection/mode/restore changes without fetching replacement choices', async () => {
    const { controller, pending, requests } = fixture();
    controller.refresh();
    controller.configure({ version: 1, sources: [{ sourceId: sources[0].id, mode: 'latest' }] }, sources);
    pending[0].resolve(catalogue()); await flush();
    expect(requests).toHaveLength(1);
    expect(controller.getSnapshot().rows).toEqual([{ sourceId: sources[0].id, mode: 'latest', page: 1, status: 'idle' }]);
    controller.refresh(); expect(requests[1].mode).toBe('latest');
    pending[1].resolve(catalogue()); await flush();
  });
  it('keeps finished pages on a Music/detail round trip and ignores a cancelled later page', async () => {
    const { controller, pending } = fixture({ version: 1, sources: [choices.sources[0]] });
    controller.refresh(); pending[0].resolve(catalogue()); await flush();
    controller.next(sources[0].id); controller.cancel(); controller.setActive(false);
    pending[1].resolve(catalogue(sources[0].id, 2)); await flush();
    controller.setActive(true);
    expect(controller.getSnapshot().rows[0].page).toBe(1);
    expect(controller.getSnapshot().rows[0].result?.mangas).toEqual(catalogue().mangas);
    expect(controller.getSnapshot().rows[0].status).toBe('ready');
  });
  it('paginates and retries one source while preserving the others and showing only its current page', async () => {
    const { controller, pending, requests } = fixture();
    controller.refresh(); pending[0].resolve(catalogue()); await flush();
    pending[1].resolve(catalogue(sources[1].id, 1, false)); await flush();
    const second = controller.getSnapshot().rows[1];
    expect(controller.previous(sources[0].id)).toBe(false);
    expect(controller.next(sources[1].id)).toBe(false);
    controller.next(sources[0].id); pending[2].reject(new Error('temporary')); await flush();
    expect(controller.getSnapshot().rows[0]).toMatchObject({ page: 1, requestedPage: 2, status: 'error' });
    expect(controller.retry(sources[0].id)).toBe(true);
    expect(requests[3]).toEqual({ source: sources[0].id, mode: 'popular', page: 2 });
    pending[3].resolve(catalogue(sources[0].id, 2, false)); await flush();
    expect(controller.getSnapshot().rows[0].result?.mangas).toEqual(catalogue(sources[0].id, 2).mangas);
    expect(controller.getSnapshot().rows[1]).toEqual(second);
    controller.previous(sources[0].id); pending[4].resolve(catalogue()); await flush();
    expect(controller.getSnapshot().rows[0].page).toBe(1);
  });
  it('refuses a malformed result while other sources remain usable', async () => {
    const { controller, pending } = fixture();
    controller.refresh(); pending[0].resolve(catalogue('wrong source')); await flush();
    pending[1].resolve(catalogue(sources[1].id)); await flush();
    expect(controller.getSnapshot().rows[0].error).toBe('invalid');
    expect(controller.getSnapshot().rows[1].status).toBe('ready');
  });
  it('enforces the last-page bound even when a provider always advertises another page', async () => {
    const request = vi.fn(async (request: FeedRequest) => catalogue(request.source, request.page, true));
    const controller = new SourceFeedController(request);
    controller.configure({ version: 1, sources: [choices.sources[0]] }, sources); controller.setActive(true);
    controller.refresh(); await flush();
    for (let page = 2; page <= MAX_FEED_PAGE; page++) {
      expect(controller.next(sources[0].id)).toBe(true); await flush();
    }
    expect(controller.next(sources[0].id)).toBe(false);
    expect(request).toHaveBeenCalledTimes(MAX_FEED_PAGE);
    expect(controller.getSnapshot().rows[0].result?.mangas).toHaveLength(1);
  });
});
