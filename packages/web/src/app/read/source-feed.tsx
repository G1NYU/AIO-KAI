import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { readRequest } from '@/lib/hosts/shell/reading';
import {
  MAX_FEED_SOURCES, SOURCE_FEED_PREFERENCE_EVENT, SOURCE_FEED_PREFERENCE_KEY,
  readSourceFeedPreferences, saveSourceFeedPreferences, type SourceFeedPreferences, type SourceFeedMode,
} from './source-feed-preferences';
import { MAX_FEED_PAGE, SourceFeedController, parseFeedSourceInventory, type FeedSource, type FeedManga } from './source-feed-state';

type StoredChoices = { preferences: SourceFeedPreferences; error: boolean };
function readChoices(): StoredChoices {
  try { return { preferences: readSourceFeedPreferences(), error: false }; }
  catch { return { preferences: { version: 1, sources: [] }, error: true }; }
}
export function useSourceFeed(visible: boolean) {
  const [controller] = React.useState(() => new SourceFeedController(request => readRequest({ kind: 'catalogue', ...request })));
  const snapshot = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [stored, setStored] = React.useState(readChoices);
  const [sources, setSources] = React.useState<FeedSource[]>([]);
  const [inventoryStatus, setInventoryStatus] = React.useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const mounted = React.useRef(false), inventoryGeneration = React.useRef(0), attemptedInventory = React.useRef(false);
  const inventoryFlight = React.useRef<Promise<FeedSource[]> | null>(null);
  React.useLayoutEffect(() => {
    controller.configure(stored.preferences, stored.error ? [] : sources);
    controller.setActive(visible && !stored.error && inventoryStatus === 'ready');
    return () => controller.setActive(false);
  }, [controller, visible, stored, sources, inventoryStatus]);
  React.useEffect(() => {
    mounted.current = true;
    const changed = (event: Event) => {
      if (event instanceof StorageEvent && event.key !== SOURCE_FEED_PREFERENCE_KEY && event.key !== null) return;
      controller.cancel();
      setStored(readChoices());
    };
    window.addEventListener(SOURCE_FEED_PREFERENCE_EVENT, changed);
    window.addEventListener('storage', changed);
    return () => {
      mounted.current = false;
      inventoryGeneration.current++;
      attemptedInventory.current = false;
      controller.setActive(false);
      window.removeEventListener(SOURCE_FEED_PREFERENCE_EVENT, changed);
      window.removeEventListener('storage', changed);
    };
  }, [controller]);
  const reloadSources = React.useCallback(async () => {
    if (controller.getSnapshot().busy) return;
    const generation = ++inventoryGeneration.current;
    setInventoryStatus('loading');
    try {
      let flight = inventoryFlight.current;
      if (!flight) {
        flight = readRequest({ kind: 'source-inventory' }).then(parseFeedSourceInventory).finally(() => {
          if (inventoryFlight.current === flight) inventoryFlight.current = null;
        });
        inventoryFlight.current = flight;
      }
      const rows = await flight;
      if (!mounted.current || generation !== inventoryGeneration.current) return;
      setSources(rows); setInventoryStatus('ready');
    } catch {
      if (mounted.current && generation === inventoryGeneration.current) setInventoryStatus('error');
    }
  }, [controller]);
  React.useEffect(() => {
    if (!visible || attemptedInventory.current) return;
    attemptedInventory.current = true;
    void reloadSources();
  }, [visible, reloadSources]);
  function save(preferences: SourceFeedPreferences) {
    controller.cancel();
    try { setStored({ preferences: saveSourceFeedPreferences(preferences), error: false }); }
    catch { setStored(previous => ({ ...previous, error: true })); }
  }
  return { controller, snapshot, preferences: stored.preferences, storageError: stored.error, sources, inventoryStatus,
    reloadSources, save, reloadChoices: () => { controller.cancel(); setStored(readChoices()); } };
}

type FeedState = ReturnType<typeof useSourceFeed>;
export function SourceFeed({ feed, busy, renderManga, onOpen, onRequest }: {
  feed: FeedState; busy: boolean;
  renderManga(items: FeedManga[], select: (item: FeedManga) => void): React.ReactNode;
  onOpen(item: FeedManga): void;
  onRequest(): void;
}) {
  const { controller, snapshot, preferences, storageError, sources, inventoryStatus } = feed;
  const [addition, setAddition] = React.useState('');
  const selected = new Set(preferences.sources.map(choice => choice.sourceId));
  const available = sources.filter(source => !selected.has(source.id)).sort((a, b) => (a.displayName || a.name).localeCompare(b.displayName || b.name) || a.lang.localeCompare(b.lang));
  const inventoryReady = inventoryStatus === 'ready';
  const blocked = busy || storageError || !inventoryReady;
  const fetching = busy || snapshot.busy || storageError || !inventoryReady;
  const eligible = snapshot.rows.some(row => controller.eligible(row));
  function changeMode(sourceId: string, mode: SourceFeedMode) {
    feed.save({ version: 1, sources: preferences.sources.map(choice => choice.sourceId === sourceId ? { sourceId, mode } : choice) });
  }
  function remove(sourceId: string) {
    feed.save({ version: 1, sources: preferences.sources.filter(choice => choice.sourceId !== sourceId) });
  }
  function add() {
    if (blocked || selected.size >= MAX_FEED_SOURCES || !available.some(source => source.id === addition)) return;
    feed.save({ version: 1, sources: [...preferences.sources, { sourceId: addition, mode: 'popular' }] });
    setAddition('');
  }
  function request(work: () => boolean) { if (work()) onRequest(); }
  function open(item: FeedManga) {
    // The native worker finishes its current request before opening the title.
    // Its obsolete catalogue reply cannot repopulate this view afterwards.
    controller.cancel();
    onOpen(item);
  }
  return <section data-ui="source-feed" aria-label={t({ id: 'Source Feed', message: 'Source Feed' })}>
    <div className="tsugi-source-feed-intro mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-2xl"><h2 className="text-xl font-semibold"><Trans id="Discover at your own pace">Discover at your own pace</Trans></h2>
        <p className="mt-2 text-sm text-[--tsugi-muted]"><Trans id="Choose up to eight sources, then refresh Popular or Latest when you want new suggestions. Chapter updates for your library stay in Updates.">Choose up to eight sources, then refresh Popular or Latest when you want new suggestions. Chapter updates for your library stay in Updates.</Trans></p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="tsugi-read-action" disabled={fetching || !eligible} onClick={() => request(() => controller.refresh())}><Trans id="Refresh feed">Refresh feed</Trans></button>
        {snapshot.busy && <button className="tsugi-read-action" disabled={snapshot.stopping} onClick={() => controller.stopAfterCurrent()}>{snapshot.stopping
          ? t({ id: 'Finishing current request…', message: 'Finishing current request…' })
          : t({ id: 'Stop after current source', message: 'Stop after current source' })}</button>}
      </div>
    </div>
    {storageError && <div className="tsugi-read-error mb-4" role="alert">
      <p><Trans id="Feed choices could not be read or saved reliably. Reload them before refreshing, or explicitly reset the choices.">Feed choices could not be read or saved reliably. Reload them before refreshing, or explicitly reset the choices.</Trans></p>
      <div className="mt-3 flex flex-wrap gap-2"><button className="tsugi-read-action" disabled={busy} onClick={feed.reloadChoices}><Trans id="Reload saved Feed choices">Reload saved Feed choices</Trans></button>
        <button className="tsugi-read-action" disabled={busy} onClick={() => feed.save({ version: 1, sources: [] })}><Trans id="Reset Feed choices">Reset Feed choices</Trans></button></div>
    </div>}
    <section className="mb-6" aria-label={t({ id: 'Feed source choices', message: 'Feed source choices' })}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold"><Trans id="Selected sources">Selected sources</Trans> <span className="text-sm text-[--tsugi-muted]">{selected.size} / {MAX_FEED_SOURCES}</span></h3>
        <button className="tsugi-read-action" disabled={busy || snapshot.busy || inventoryStatus === 'loading'} onClick={() => void feed.reloadSources()}><Trans id="Reload installed sources">Reload installed sources</Trans></button>
      </div>
      {inventoryStatus === 'loading' && <p role="status" className="mb-3 text-sm text-[--tsugi-muted]"><Trans id="Loading installed sources…">Loading installed sources…</Trans></p>}
      {inventoryStatus === 'error' && <p role="alert" className="mb-3 text-sm"><Trans id="The complete installed-source list could not be verified. Reload sources to try again. Your saved choices are kept.">The complete installed-source list could not be verified. Reload sources to try again. Your saved choices are kept.</Trans></p>}
      <div>{preferences.sources.map(choice => {
        const source = sources.find(source => source.id === choice.sourceId);
        const name = source?.displayName || source?.name || (inventoryReady ? t({ id: 'Unavailable source', message: 'Unavailable source' }) : t({ id: 'Saved source', message: 'Saved source' }));
        return <div key={choice.sourceId} className="tsugi-read-row flex-wrap" data-feed-choice={choice.sourceId}>
          <div className="min-w-0 basis-full sm:basis-0 sm:flex-1"><strong className="block break-words">{name}</strong><small className="block break-all text-[--tsugi-muted]">{source ? source.lang.toUpperCase() : choice.sourceId}</small></div>
          <label className="flex items-center gap-2 text-sm"><span><Trans id="Show">Show</Trans></span><select className="tsugi-read-input" aria-label={t({ id: 'Feed mode for {name}', message: `Feed mode for ${name}` })} value={choice.mode} disabled={blocked} onChange={event => changeMode(choice.sourceId, event.target.value as SourceFeedMode)}>
            <option value="popular"><Trans id="Popular">Popular</Trans></option><option value="latest" disabled={!source?.supportsLatest}><Trans id="Latest">Latest</Trans></option>
          </select></label>
          <button className="tsugi-read-action" disabled={busy || storageError} aria-label={t({ id: 'Remove {name} from Feed', message: `Remove ${name} from Feed` })} onClick={() => remove(choice.sourceId)}><Trans id="Remove">Remove</Trans></button>
          {source && !source.supportsLatest && <p className="basis-full text-xs text-[--tsugi-muted]"><Trans id="This source does not support Latest.">This source does not support Latest.</Trans></p>}
        </div>;
      })}</div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select className="tsugi-read-input min-w-0 max-w-full sm:min-w-72" aria-label={t({ id: 'Add a Feed source', message: 'Add a Feed source' })} value={available.some(source => source.id === addition) ? addition : ''} disabled={blocked || selected.size >= MAX_FEED_SOURCES} onChange={event => setAddition(event.target.value)}>
          <option value=""><Trans id="Choose an installed source">Choose an installed source</Trans></option>
          {available.map(source => <option key={source.id} value={source.id}>{source.displayName || source.name} · {source.lang.toUpperCase()}</option>)}
        </select>
        <button className="tsugi-read-action" disabled={blocked || selected.size >= MAX_FEED_SOURCES || !available.some(source => source.id === addition)} onClick={add}><Trans id="Add to Feed">Add to Feed</Trans></button>
      </div>
      {!preferences.sources.length && !storageError && <p className="mt-3 text-sm text-[--tsugi-muted]"><Trans id="Your Feed is empty. Add a source to get started; nothing is fetched until you refresh.">Your Feed is empty. Add a source to get started; nothing is fetched until you refresh.</Trans></p>}
      {inventoryReady && !sources.length && <p className="mt-3 text-sm text-[--tsugi-muted]"><Trans id="No installed sources are available. Install a trusted source from Extensions, then reload this list.">No installed sources are available. Install a trusted source from Extensions, then reload this list.</Trans></p>}
    </section>
    {(snapshot.busy || snapshot.phase !== 'idle') && <p role="status" className="mb-3 text-sm text-[--tsugi-muted]">{snapshot.phase === 'stopped'
      ? t({ id: 'Feed stopped after the current source.', message: 'Feed stopped after the current source.' })
      : snapshot.busy && snapshot.stopping ? t({ id: 'Finishing current request…', message: 'Finishing current request…' })
      : snapshot.busy ? t({ id: 'Refreshing Feed…', message: 'Refreshing Feed…' })
      : t({ id: 'Feed refresh finished.', message: 'Feed refresh finished.' })} {snapshot.total > 0 && <span>{snapshot.completed} / {snapshot.total}</span>}</p>}
    <div>{snapshot.rows.map(row => {
      const source = sources.find(source => source.id === row.sourceId);
      const name = source?.displayName || source?.name || (inventoryReady ? t({ id: 'Unavailable source', message: 'Unavailable source' }) : t({ id: 'Saved source', message: 'Saved source' }));
      const mode = row.mode === 'latest' ? t({ id: 'Latest', message: 'Latest' }) : t({ id: 'Popular', message: 'Popular' });
      const page = row.page, requestedPage = row.requestedPage;
      return <section key={row.sourceId} className="tsugi-search-source" data-feed-source={row.sourceId} data-result-state={row.status === 'error' ? 'error' : row.result?.mangas.length ? 'matches' : 'empty'} aria-label={name}>
        <header className="tsugi-search-source-header"><div className="tsugi-search-source-label"><h3>{name}</h3><span className="tsugi-search-language">{source?.lang.toUpperCase()}</span></div><span className="tsugi-search-result-count">{mode}{row.result && <> · <Trans id="Page {page}">Page {page}</Trans></>}</span></header>
        {!inventoryReady ? <p className="py-3 text-sm text-[--tsugi-muted]"><Trans id="Waiting for a verified source list.">Waiting for a verified source list.</Trans></p>
          : !source ? <p className="py-3 text-sm text-[--tsugi-muted]"><Trans id="This saved source is unavailable. Its choice is kept so you can reconnect it through Extensions.">This saved source is unavailable. Its choice is kept so you can reconnect it through Extensions.</Trans> <span className="break-all">{row.sourceId}</span></p>
          : !controller.eligible(row) ? <p className="py-3 text-sm text-[--tsugi-muted]"><Trans id="Latest is unavailable for this source. Choose Popular above to refresh it.">Latest is unavailable for this source. Choose Popular above to refresh it.</Trans></p>
          : <>
            {row.status === 'loading' && <p role="status" className="py-3 text-sm text-[--tsugi-muted]"><Trans id="Loading page {requestedPage}…">Loading page {requestedPage}…</Trans></p>}
            {row.status === 'queued' && <p className="py-3 text-sm text-[--tsugi-muted]"><Trans id="Waiting for the current source…">Waiting for the current source…</Trans></p>}
            {row.status === 'error' && <p role="alert" className="py-3 text-sm">{row.error === 'invalid'
              ? t({ id: 'This source returned an unsupported or oversized catalogue. Other sources remain available.', message: 'This source returned an unsupported or oversized catalogue. Other sources remain available.' })
              : t({ id: 'This page could not be loaded. You can retry this source independently.', message: 'This page could not be loaded. You can retry this source independently.' })}</p>}
            {row.result?.mangas.length ? renderManga(row.result.mangas, open) : row.result ? <p className="py-3 text-sm text-[--tsugi-muted]"><Trans id="No titles on this page.">No titles on this page.</Trans></p>
              : row.status === 'idle' && <p className="py-3 text-sm text-[--tsugi-muted]"><Trans id="Ready when you are. Refresh to load this source.">Ready when you are. Refresh to load this source.</Trans></p>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {row.status === 'error' ? <button className="tsugi-read-action" disabled={fetching} onClick={() => request(() => controller.retry(row.sourceId))}><Trans id="Retry this source">Retry this source</Trans></button>
                : <button className="tsugi-read-action" disabled={fetching} onClick={() => request(() => controller.refreshSource(row.sourceId))}><Trans id="Refresh this source">Refresh this source</Trans></button>}
              {row.result && <><button className="tsugi-read-action" disabled={fetching || page <= 1} onClick={() => request(() => controller.previous(row.sourceId))}><Trans id="Previous page">Previous page</Trans></button>
                <button className="tsugi-read-action" disabled={fetching || !row.result.hasNextPage || page >= MAX_FEED_PAGE} onClick={() => request(() => controller.next(row.sourceId))}><Trans id="Next page">Next page</Trans></button></>}
            </div>
            {page === MAX_FEED_PAGE && row.result?.hasNextPage && <p className="mt-2 text-xs text-[--tsugi-muted]"><Trans id="Feed supports up to 1,000 pages per source.">Feed supports up to 1,000 pages per source.</Trans></p>}
          </>}
      </section>;
    })}</div>
  </section>;
}
