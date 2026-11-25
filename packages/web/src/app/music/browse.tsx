import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { BiArrowBack, BiDisc, BiPlay } from 'react-icons/bi';
import { FiPlay, FiSettings } from 'react-icons/fi';
import {
  catalogTrack,
  type EclipseCatalogDefinition, type EclipseCatalogItem, type EclipseDetail, type EclipseTrack,
} from '@/lib/music/eclipse';
import type { MusicConnection } from '@/lib/music/connections';
import { providerFor } from '@/lib/music/providers';
import type { TrendingRecording } from '@/lib/music/discovery';
import { MusicCharts } from './charts';
import { MusicArtwork } from './music-artwork';
import { TsugiAtmosphere } from '@/components/tsugi-atmosphere';
import type { RecentMusicPlay } from '@/lib/music/history';

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
        className={box + ' tsugi-discovery-cover shrink-0 object-cover'} />
    : <span className={box + ' tsugi-discovery-cover tsugi-discovery-placeholder flex shrink-0 items-center justify-center'}>
        <BiDisc aria-hidden className="text-3xl" />
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
      className="tsugi-player-dialog tsugi-music-detail fixed inset-0 z-40 overflow-y-auto">
      <div className="tsugi-music-detail-canvas min-h-screen w-full px-6 pb-32 pt-14 sm:px-[3vw]">
        <TsugiAtmosphere key={current.id} placement="collection" artwork={current.artworkURL} />
        <button type="button" onClick={nested ? () => setNested(null) : onClose}
          className="tsugi-music-detail-back mb-9 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-white/65 hover:bg-white/10">
          <BiArrowBack aria-hidden /> <Trans>Back to music</Trans>
        </button>
        <header className="tsugi-music-detail-hero mb-9 flex flex-wrap items-end gap-7">
          <div className="w-44 sm:w-56"><Cover src={current.artworkURL} /></div>
          <div className="min-w-0 flex-1">
            <p className="tsugi-music-detail-kicker mb-3 text-xs font-semibold uppercase tracking-[0.3em] text-violet-200/70">
              {current.type}
            </p>
            <h1 className="text-3xl font-semibold sm:text-5xl">{detail?.title ?? current.title}</h1>
            <p className="mt-3 text-white/50">{detail?.artist ?? current.artist ?? source.manifest.name}</p>
            {detail?.description && <p className="mt-3 max-w-2xl text-sm text-white/45">{detail.description}</p>}
            {detail && detail.tracks.length > 0 && <p className="tsugi-music-detail-count mt-3 text-sm">{detail.tracks.length} <Trans>tracks</Trans></p>}
            {detail && detail.tracks.length > 0 && <button type="button" onClick={() => { onPlay(source, detail.tracks, 0); onClose(); }}
              className="tsugi-music-detail-play mt-5 inline-flex items-center gap-2 rounded-full bg-violet-200 px-5 py-2.5 font-semibold text-[#171420]">
              <BiPlay aria-hidden /> <Trans>Play all</Trans>
            </button>}
          </div>
        </header>
        {loading && <p role="status" className="text-sm text-white/50"><Trans>Loading music…</Trans></p>}
        {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
        {detail && detail.tracks.length > 0 && (
          <section aria-label={t`Collection tracks`} className="tsugi-music-detail-tracks space-y-2">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold"><Trans>Tracks</Trans></h2>
            </div>
            {detail.tracks.map((track, at) => (
              <button key={track.id + ':' + at} type="button"
                onClick={() => { onPlay(source, detail.tracks, at); onClose(); }}
                className="tsugi-music-detail-track flex w-full items-center gap-4 border-b border-white/[0.08] px-4 py-3 text-left transition-colors hover:bg-white/[0.04]">
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
          <section className="tsugi-music-detail-albums mt-12">
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
  source, onPlay, onFind, recent, onPlayRecent, onConfigure, onLibrary,
}: {
  source: MusicConnection | undefined;
  onPlay: PlayCollection;
  onFind(recording: TrendingRecording): void;
  recent: RecentMusicPlay[];
  onPlayRecent(item: RecentMusicPlay): void;
  onConfigure(): void;
  onLibrary(): void;
}) {
  const [shelves, setShelves] = React.useState<Shelf[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [selected, setSelected] = React.useState<EclipseCatalogItem | null>(null);
  const [hasCatalog, setHasCatalog] = React.useState(false);
  const [spotlight, setSpotlight] = React.useState(0);

  React.useEffect(() => {
    if (!source) {
      setShelves([]);
      setHasCatalog(false);
      return;
    }
    const controller = new AbortController();
    setShelves([]);
    setSpotlight(0);
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
        if (!controller.signal.aborted) setShelves(rows);
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

  const filled = shelves.filter((row) => row.items.length > 0);
  const heroItems = filled.flatMap(row => row.items.filter(item => !!item.artworkURL).map(item => ({ row, item })))
    .filter((entry, index, all) => all.findIndex(other => other.item.id === entry.item.id) === index).slice(0, 6);
  const hero = heroItems[spotlight % Math.max(heroItems.length, 1)];
  const featuredRow = hero?.row ?? filled[0];
  const featured = hero?.item ?? featuredRow?.items[0];
  const recentFromSource = recent.filter((item) => item.sourceId === source?.id);

  if (!source) return (
    <section className="tsugi-hub-empty py-24 text-center">
      <BiDisc aria-hidden className="mx-auto mb-7 text-6xl text-[--tsugi-muted]" />
      <h2 className="text-3xl font-semibold"><Trans>Your music starts here</Trans></h2>
      <p className="mx-auto mt-4 max-w-lg text-sm leading-6 text-[--tsugi-muted]">
        <Trans>Connect a music source to browse albums, playlists and tracks.</Trans>
      </p>
      <div className="tsugi-empty-actions">
        <button type="button" className="tsugi-read-action tsugi-empty-primary" onClick={onConfigure}><FiSettings aria-hidden /><Trans>Manage music sources</Trans></button>
        <button type="button" className="tsugi-read-action" onClick={onLibrary}><Trans id="Open local library">Open local library</Trans></button>
      </div>
    </section>
  );

  return (
    <section aria-label={t`Music discovery`} className="tsugi-hub tsugi-discovery-workspace">
      <header className="tsugi-discovery-source">
        <span><Trans>Browsing</Trans> <strong>{source.manifest.name}</strong></span>
      </header>

      {loading && <p role="status" className="text-sm text-[--tsugi-muted]"><Trans>Loading music…</Trans></p>}
      {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}

      {featured && featuredRow && (
        <section className="tsugi-spotlight tsugi-music-spotlight" data-art={featured.artworkURL ? 'true' : 'false'}
          aria-label={t`Featured music`}>
          {featured.artworkURL && <div className="tsugi-spotlight-backdrop" aria-hidden="true"><MusicArtwork source={featured.artworkURL} className="tsugi-spotlight-image" /></div>}
          <div className="tsugi-feature-copy tsugi-spotlight-copy">
            <p className="tsugi-feature-kicker">{featuredRow.catalog.name}</p>
            <h2 className="line-clamp-3 text-[clamp(1.85rem,3.2vw,3.4rem)] font-semibold leading-tight tracking-[-.045em]">
              {featured.title}
            </h2>
            {(featured.artist || featured.album) && <p className="mt-3 truncate text-sm text-[--tsugi-muted]">{featured.artist || featured.album}</p>}
            <button type="button" className="tsugi-read-action tsugi-series-primary mt-6 inline-flex w-fit items-center gap-2"
              onClick={() => openCatalogItem(featuredRow, featured)}>
              {featured.type === 'track' && <FiPlay aria-hidden />}
              {featured.type === 'track' ? <Trans>Play</Trans> : <Trans>Explore</Trans>}
            </button>
          </div>
          {featured.artworkURL && (
            <div className="tsugi-spotlight-cover">
              <MusicArtwork source={featured.artworkURL} className="size-full object-cover" />
            </div>
          )}
          {heroItems.length > 1 && <div className="tsugi-spotlight-steps" aria-label={t`Featured music`}>{heroItems.map((entry, at) => <button type="button" key={entry.item.id} aria-label={entry.item.title} aria-pressed={spotlight === at} onClick={() => setSpotlight(at)} />)}</div>}
        </section>
      )}

      {recentFromSource.length > 0 && (
        <section aria-label={t`Recently played`}>
          <div className="mb-5 flex items-center justify-between gap-4">
            <h3 className="text-2xl font-semibold"><Trans>Recently played</Trans></h3>
          </div>
          <div className="tsugi-recent-music-grid">
            {recentFromSource.slice(0, 12).map((item) => (
              <button type="button" key={item.sourceId + ':' + item.track.id}
                onClick={() => onPlayRecent(item)} className="tsugi-recent-music-card">
                <Cover src={item.track.artworkURL} size="small" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{item.track.title}</span>
                  {item.track.artist && <span className="block truncate text-xs text-[--tsugi-muted]">{item.track.artist}</span>}
                </span>
                <FiPlay aria-hidden />
              </button>
            ))}
          </div>
        </section>
      )}

      {!loading && !error && !hasCatalog && (
        <div className="tsugi-discovery-note">
          <p className="text-sm text-[--tsugi-muted]">
            {source.kind === 'youtube-music'
              ? <Trans>No YouTube Music shelves are available right now. Explore independent charts below or use Search.</Trans>
              : <Trans>This addon does not publish shelves. Explore independent charts below or use Search.</Trans>}
          </p>
        </div>
      )}

      {shelves.map((row) => (
        <section key={row.catalog.id} className="tsugi-catalog-lane">
          <div className="mb-5 flex items-baseline justify-between gap-4">
            <h3 className="text-2xl font-semibold tracking-tight">{row.catalog.name}</h3>
            <span className="tsugi-shelf-count">{row.items.length > 0 ? row.items.length : ''}</span>
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
