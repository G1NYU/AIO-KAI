import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { BiArrowBack, BiDisc, BiPlay } from 'react-icons/bi';
import { FiArrowUpRight, FiPlay, FiSettings } from 'react-icons/fi';
import {
  catalogTrack,
  type EclipseCatalogDefinition, type EclipseCatalogItem, type EclipseDetail, type EclipseTrack,
} from '@/lib/music/eclipse';
import type { MusicConnection } from '@/lib/music/connections';
import { providerFor } from '@/lib/music/providers';
import type { TrendingRecording } from '@/lib/music/discovery';
import { MusicCharts } from './charts';
import { suggestMusicFromHistory, type RecentMusicPlay } from '@/lib/music/history';

export type PlayCollection = (source: MusicConnection, songs: EclipseTrack[], at: number) => void;

type Shelf = {
  catalog: EclipseCatalogDefinition;
  items: EclipseCatalogItem[];
  unavailable: boolean;
};

function Cover({ src, size = 'full' }: { src?: string; size?: 'full' | 'small' }) {
  const box = size === 'small' ? 'size-11' : 'aspect-square w-full';
  return src
    ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer"
        className={box + ' shrink-0 rounded-xl border border-white/10 object-cover'} />
    : <span className={box + ' flex shrink-0 items-center justify-center rounded-xl bg-[#292335]'}>
        <BiDisc aria-hidden className="text-3xl text-violet-200/70" />
      </span>;
}

/** Each collection is loaded through the addon that supplied its item id. */
export function MusicCollection({
  source, selected, onClose, onPlay,
}: {
  source: MusicConnection;
  selected: EclipseCatalogItem | null;
  onClose(): void;
  onPlay: PlayCollection;
}) {
  const [detail, setDetail] = React.useState<EclipseDetail | null>(null);
  const [nested, setNested] = React.useState<EclipseCatalogItem | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const current = nested ?? selected;

  React.useEffect(() => setNested(null), [selected, source.id]);
  React.useEffect(() => {
    if (!current) return;
    const controller = new AbortController();
    setDetail(null);
    setError('');
    setLoading(true);
    providerFor(source).detail(current, controller.signal).then((result) => {
      if (!controller.signal.aborted) setDetail(result);
    }).catch(() => {
      if (!controller.signal.aborted) setError(t`This collection is unavailable from the addon.`);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [current, source]);

  React.useEffect(() => {
    if (!selected) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [selected, onClose]);

  if (!current) return null;
  return (
    <section role="dialog" aria-modal="true" aria-label={t`Music collection`}
      className="tsugi-player-dialog fixed inset-0 z-40 overflow-y-auto">
      <div className="min-h-screen w-full px-6 pb-32 pt-14 sm:px-[3vw]">
        <button type="button" onClick={nested ? () => setNested(null) : onClose}
          className="mb-9 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-white/65 hover:bg-white/10">
          <BiArrowBack aria-hidden /> <Trans>Back to music</Trans>
        </button>
        <header className="mb-9 flex flex-wrap items-end gap-7">
          <div className="w-44 sm:w-56"><Cover src={current.artworkURL} /></div>
          <div className="min-w-0 flex-1">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.3em] text-violet-200/70">
              {current.type}
            </p>
            <h1 className="text-3xl font-semibold sm:text-5xl">{detail?.title ?? current.title}</h1>
            <p className="mt-3 text-white/50">{detail?.artist ?? current.artist ?? source.manifest.name}</p>
            {detail?.description && <p className="mt-3 max-w-2xl text-sm text-white/45">{detail.description}</p>}
          </div>
        </header>
        {loading && <p role="status" className="text-sm text-white/50"><Trans>Loading music…</Trans></p>}
        {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
        {detail && detail.tracks.length > 0 && (
          <section aria-label={t`Collection tracks`} className="space-y-2">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold"><Trans>Tracks</Trans></h2>
              <button type="button" onClick={() => { onPlay(source, detail.tracks, 0); onClose(); }}
                className="inline-flex items-center gap-2 rounded-full bg-violet-200 px-5 py-2.5 font-semibold text-[#171420]">
                <BiPlay aria-hidden /> <Trans>Play all</Trans>
              </button>
            </div>
            {detail.tracks.map((track, at) => (
              <button key={track.id + ':' + at} type="button"
                onClick={() => { onPlay(source, detail.tracks, at); onClose(); }}
                className="flex w-full items-center gap-4 border-b border-white/[0.08] px-4 py-3 text-left transition-colors hover:bg-white/[0.04]">
                <span className="w-6 text-right text-xs text-white/35">{at + 1}</span>
                <Cover src={track.artworkURL} size="small" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{track.title}</span>
                  <span className="block truncate text-xs text-white/50">{track.artist}</span>
                </span>
              </button>
            ))}
          </section>
        )}
        {detail && detail.albums.length > 0 && (
          <section className="mt-12">
            <h2 className="mb-4 text-xl font-semibold"><Trans>Albums</Trans></h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {detail.albums.map((album) => (
                <button key={album.id} type="button" onClick={() => setNested(album)}
                  className="min-w-0 text-left hover:brightness-110">
                  <Cover src={album.artworkURL} />
                  <span className="mt-2 block truncate text-sm font-semibold">{album.title}</span>
                </button>
              ))}
            </div>
          </section>
        )}
        {detail && !detail.tracks.length && !detail.albums.length && (
          <p className="text-white/50"><Trans>No tracks available from this addon.</Trans></p>
        )}
      </div>
    </section>
  );
}

export function MusicDiscover({
  source, onPlay, onFind, recent, onPlayRecent, onConfigure,
}: {
  source: MusicConnection | undefined;
  onPlay: PlayCollection;
  onFind(recording: TrendingRecording): void;
  recent: RecentMusicPlay[];
  onPlayRecent(item: RecentMusicPlay): void;
  onConfigure(): void;
}) {
  const [shelves, setShelves] = React.useState<Shelf[]>([]);
  const [shelfSourceId, setShelfSourceId] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [selected, setSelected] = React.useState<EclipseCatalogItem | null>(null);
  const [hasCatalog, setHasCatalog] = React.useState(false);

  React.useEffect(() => {
    if (!source) {
      setShelves([]);
      setHasCatalog(false);
      return;
    }
    const controller = new AbortController();
    setShelves([]);
    setSelected(null);
    setError('');
    setLoading(true);
    async function refresh() {
      if (!source) return;
      try {
        const provider = providerFor(source);
        const catalogs = await provider.catalogs(controller.signal);
        if (controller.signal.aborted) return;
        setHasCatalog(catalogs.length > 0);
        const rows = await Promise.all(catalogs.map(async (catalog): Promise<Shelf> => {
          try {
            return { catalog, items: await provider.catalog(catalog, 0, controller.signal), unavailable: false };
          } catch {
            return { catalog, items: [], unavailable: true };
          }
        }));
        if (!controller.signal.aborted) {
          setShelfSourceId(source.id);
          setShelves(rows);
        }
      } catch {
        if (!controller.signal.aborted) setError(t`Could not load this addon's music catalogs.`);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void refresh();
    return () => controller.abort();
  }, [source]);

  function openCatalogItem(row: Shelf, item: EclipseCatalogItem) {
    if (!source) return;
    if (item.type === 'track') {
      const songs = row.items.filter((entry) => entry.type === 'track').map(catalogTrack);
      const at = songs.findIndex((song) => song.id === item.id);
      if (at >= 0) onPlay(source, songs, at);
    } else {
      setSelected(item);
    }
  }

  const visibleShelves = shelfSourceId === source?.id ? shelves : [];
  const filled = visibleShelves.filter((row) => row.items.length > 0);
  const featuredRow = filled.find((row) => row.items.some((item) => item.artworkURL)) ?? filled[0];
  const featured = featuredRow?.items.find((item) => item.artworkURL) ?? featuredRow?.items[0];
  const recentFromSource = recent.filter((item) => item.sourceId === source?.id);
  const suggested = source?.kind === 'youtube-music'
    ? suggestMusicFromHistory(filled.flatMap(row => row.items), recentFromSource, source.id) : [];
  const displayShelves: Shelf[] = suggested.length ? [{
    catalog: { id: 'local:artists', type: 'track', name: t`More from your artists` },
    items: suggested, unavailable: false,
  }, ...visibleShelves] : visibleShelves;

  if (!source) return (
    <section className="tsugi-hub-empty py-24 text-center">
      <BiDisc aria-hidden className="mx-auto mb-7 text-6xl text-[--tsugi-muted]" />
      <h2 className="text-3xl font-semibold"><Trans>Your music starts here</Trans></h2>
      <p className="mx-auto mt-4 max-w-lg text-sm leading-6 text-[--tsugi-muted]">
        <Trans>Connect a music source to browse albums, playlists and tracks.</Trans>
      </p>
      <button type="button" className="tsugi-primary-action mt-8 inline-flex items-center gap-2"
        onClick={onConfigure}><FiSettings aria-hidden /><Trans>Manage music sources</Trans></button>
    </section>
  );

  return (
    <section aria-label={t`Music discovery`} className="tsugi-hub space-y-14">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="tsugi-eyebrow"><Trans>Listen</Trans></p>
          <h2 className="mt-2 text-[clamp(2rem,4vw,4rem)] font-semibold tracking-[-.05em]">
            <Trans>Discover</Trans>
          </h2>
        </div>
        <span className="text-xs text-[--tsugi-muted]">{source.manifest.name}</span>
      </header>

      {loading && <p role="status" className="text-sm text-[--tsugi-muted]"><Trans>Loading music…</Trans></p>}
      {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}

      {featured && featuredRow && (
        <section className="tsugi-hub-feature relative grid min-h-[310px] overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(230px,37%)]"
          aria-label={t`Featured music`}>
          <div className="relative z-10 flex min-w-0 flex-col justify-center px-3 py-8 sm:px-7 lg:py-12">
            <span className="tsugi-eyebrow"><Trans>Featured from your source</Trans></span>
            <h3 className="mt-5 line-clamp-2 text-[clamp(2.4rem,4vw,5rem)] font-semibold leading-tight tracking-[-.06em]">
              {featured.title}
            </h3>
            <p className="mt-3 truncate text-sm text-[--tsugi-muted]">{featured.artist ?? featured.album ?? featuredRow.catalog.name}</p>
            <button type="button" className="tsugi-primary-action mt-8 inline-flex w-fit items-center gap-2"
              onClick={() => openCatalogItem(featuredRow, featured)}>
              {featured.type === 'track' ? <FiPlay aria-hidden /> : <FiArrowUpRight aria-hidden />}
              {featured.type === 'track' ? <Trans>Play</Trans> : <Trans>Explore</Trans>}
            </button>
          </div>
          {featured.artworkURL && (
            <div className="tsugi-hub-feature-art relative overflow-hidden">
              <img src={featured.artworkURL} alt="" draggable={false} loading="eager"
                referrerPolicy="no-referrer" className="h-full w-full object-cover" />
            </div>
          )}
        </section>
      )}

      {recentFromSource.length > 0 && (
        <section aria-label={t`Recently played`}>
          <div className="mb-5 flex items-center justify-between gap-4">
            <h3 className="text-2xl font-semibold"><Trans>Recently played</Trans></h3>
            <span className="text-xs text-[--tsugi-muted]"><Trans>Your rotation</Trans></span>
          </div>
          <div className="tsugi-music-shelf flex gap-5 overflow-x-auto pb-5">
            {recentFromSource.slice(0, 12).map((item) => (
              <button type="button" key={item.sourceId + ':' + item.track.id}
                onClick={() => onPlayRecent(item)} className="tsugi-music-tile group w-40 shrink-0 text-left sm:w-44">
                <Cover src={item.track.artworkURL} />
                <span className="mt-3 block truncate text-sm font-medium">{item.track.title}</span>
                <span className="mt-1 block truncate text-xs text-[--tsugi-muted]">{item.track.artist}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {!loading && !error && !hasCatalog && (
        <p className="text-sm text-[--tsugi-muted]">
          {source.kind === 'youtube-music'
            ? <Trans>No YouTube Music shelves are available right now. Explore independent charts below or use Search.</Trans>
            : <Trans>This addon does not publish shelves. Explore independent charts below or use Search.</Trans>}
        </p>
      )}

      {displayShelves.map((row) => (
        <section key={row.catalog.id} className="tsugi-catalog-lane">
          <div className="mb-5 flex items-baseline justify-between gap-4">
            <h3 className="text-2xl font-semibold tracking-tight">{row.catalog.name}</h3>
            <span className="text-xs uppercase tracking-widest text-[--tsugi-muted]">{row.catalog.type}</span>
          </div>
          {row.unavailable && <p className="text-sm text-[--tsugi-muted]"><Trans>This shelf is temporarily unavailable.</Trans></p>}
          {row.items.length > 0 && (
            <div className="tsugi-music-shelf flex snap-x gap-5 overflow-x-auto pb-6">
              {row.items.map((item, index) => (
                <button key={item.id + ':' + index} type="button"
                  onClick={() => openCatalogItem(row, item)}
                  className="tsugi-music-tile group w-40 shrink-0 snap-start text-left sm:w-48">
                  <Cover src={item.artworkURL} />
                  <span className="mt-3 block truncate text-sm font-medium">{item.title}</span>
                  <span className="mt-1 block truncate text-xs text-[--tsugi-muted]">{item.artist ?? item.album ?? ''}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      ))}

      <MusicCharts onFind={onFind} />
      <MusicCollection source={source} selected={selected}
        onClose={() => setSelected(null)} onPlay={onPlay} />
    </section>
  );
}
