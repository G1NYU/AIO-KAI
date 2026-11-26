import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { BiArrowBack, BiDisc, BiPlay } from 'react-icons/bi';
import { FiPlay, FiPlus, FiCheck, FiArrowRight, FiChevronLeft, FiChevronRight, FiFolder, FiMusic } from 'react-icons/fi';
import { BrushPlug } from '@/components/tsugi-icons';
import { BrushHeading } from '@/components/brush-heading';
import {
  catalogTrack,
  type EclipseCatalogDefinition, type EclipseCatalogItem, type EclipseDetail, type EclipseTrack,
} from '@/lib/music/eclipse';
import type { MusicConnection } from '@/lib/music/connections';
import { providerFor } from '@/lib/music/providers';
import type { TrendingRecording } from '@/lib/music/discovery';
import { MusicCharts } from './charts';
import { MusicArtwork } from './music-artwork';
import type { RecentMusicPlay } from '@/lib/music/history';

export type PlayCollection = (source: MusicConnection, songs: EclipseTrack[], at: number) => void;
type CollectionSaving = {
  isTrackSaved(source: MusicConnection, track: EclipseTrack): boolean;
  isCollectionSaved(source: MusicConnection, item: EclipseCatalogItem): boolean;
  onToggleTrack(source: MusicConnection, track: EclipseTrack): boolean;
  onSaveCollection(source: MusicConnection, item: EclipseCatalogItem, title: string, tracks: EclipseTrack[]): boolean;
};

type Shelf = {
  catalog: EclipseCatalogDefinition;
  items: EclipseCatalogItem[];
  unavailable: boolean;
};

function Cover({ src, size = 'full' }: { src?: string; size?: 'full' | 'small' }) {
  const box = size === 'small' ? 'size-11' : 'aspect-square w-full';
  return src
    ? <MusicArtwork source={src} target={size === 'small' ? 160 : 384} loading="lazy"
        className={box + ' tsugi-discovery-cover shrink-0 object-cover'} />
    : <span className={box + ' tsugi-discovery-cover tsugi-discovery-placeholder flex shrink-0 items-center justify-center'}>
        <BiDisc aria-hidden className="text-3xl" />
      </span>;
}

/** Each collection is loaded through the addon that supplied its item id. */
export function MusicCollection({
  source, selected, onClose, onPlay, saving,
}: {
  source: MusicConnection;
  selected: EclipseCatalogItem | null;
  onClose(): void;
  onPlay: PlayCollection;
  saving: CollectionSaving;
}) {
  const [loaded, setLoaded] = React.useState<{ source: MusicConnection; item: EclipseCatalogItem; detail: EclipseDetail } | null>(null);
  const [nested, setNested] = React.useState<EclipseCatalogItem | null>(null);
  const [trackFilter,setTrackFilter]=React.useState('');
  const [saveNotice,setSaveNotice]=React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const current = nested ?? selected;
  const detail = loaded?.source === source && loaded.item === current ? loaded.detail : null;

  React.useEffect(() => setNested(null), [selected, source.id]);
  React.useEffect(() => {
    if (!current) return;
    const controller = new AbortController();
    setLoaded(null);
    setTrackFilter('');
    setSaveNotice('');
    setError('');
    setLoading(true);
    providerFor(source).detail(current, controller.signal).then((result) => {
      if (!controller.signal.aborted) setLoaded({ source, item: current, detail: result });
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
  const collectionSaved = saving.isCollectionSaved(source,current);
  const visibleTracks=detail?.tracks.map((track,at)=>({track,at})).filter(({track})=>[track.title,track.artist,track.album].join(' ').toLocaleLowerCase().includes(trackFilter.trim().toLocaleLowerCase()))||[];
  return (
    <section role="dialog" aria-modal="true" aria-label={t`Music collection`}
      className="tsugi-player-dialog tsugi-music-detail fixed inset-0 z-40 overflow-y-auto">
      <div className="tsugi-music-detail-canvas tsugi-hub-collection min-h-screen w-full px-6 pb-32 pt-14 sm:px-[3vw]">
        <div className="tsugi-hub-collection-main">
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
            {detail && detail.tracks.length > 0 && <div className="tsugi-collection-actions mt-5">
              <button type="button" onClick={() => { onPlay(source, detail.tracks, 0); onClose(); }}
                className="tsugi-music-detail-play inline-flex items-center gap-2 rounded-full bg-violet-200 px-5 py-2.5 font-semibold text-[#171420]"><BiPlay aria-hidden/><Trans>Play all</Trans></button>
              <button type="button" className="tsugi-read-action" onClick={()=>{const tracks=[...detail.tracks];for(let i=tracks.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[tracks[i],tracks[j]]=[tracks[j],tracks[i]];}onPlay(source,tracks,0);onClose();}}><Trans>Shuffle</Trans></button>
              {current.type !== 'track' && <button type="button" className="tsugi-read-action tsugi-save-track" disabled={collectionSaved} aria-pressed={collectionSaved} onClick={()=>setSaveNotice(saving.onSaveCollection(source,current,detail.title||current.title,detail.tracks)?t`Collection saved to your library.`:t`Could not save this collection. Check storage and library limits.`)}>{collectionSaved?<FiCheck aria-hidden/>:<FiPlus aria-hidden/>}{collectionSaved?t`Saved to library`:t`Save collection to library`}</button>}
            </div>}
          </div>
        </header>
        {saveNotice && <p role="status" className="text-sm text-[--tsugi-muted]">{saveNotice}</p>}
        {loading && <p role="status" className="text-sm text-white/50"><Trans>Loading music…</Trans></p>}
        {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
        {detail && detail.tracks.length > 0 && (
          <section aria-label={t`Collection tracks`} className="tsugi-music-detail-tracks space-y-2">
            <div className="tsugi-library-section-head">
              <h2 className="text-xl font-semibold"><Trans>Tracks</Trans> <small className="tsugi-library-muted">{visibleTracks.length}</small></h2>
              <input className="tsugi-read-input tsugi-detail-search" value={trackFilter} onChange={event=>setTrackFilter(event.target.value)} aria-label={t`Find collection tracks`} placeholder={t`Find tracks in collection`}/>
            </div>
            {visibleTracks.length===0&&<p className="tsugi-library-muted"><Trans>No matching tracks.</Trans></p>}
            <div className="tsugi-hub-remote-columns"><span>#</span><span><Trans>Title</Trans></span><span><Trans>Album</Trans></span><span><Trans>Source</Trans></span><span><Trans>Time</Trans></span><span aria-hidden/></div>
            <div className="tsugi-music-detail-track-grid">
            {visibleTracks.map(({track,at}) => (
              <div key={track.id + ':' + at} className="tsugi-music-detail-track">
              <button type="button" onClick={() => { onPlay(source, detail.tracks, at); onClose(); }} className="tsugi-remote-track-play text-left">
                <span className="w-6 text-right text-xs text-white/35">{at + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{track.title}</span>
                  <span className="block truncate text-xs text-white/50">{track.artist}</span>
                </span>
                <span className="tsugi-hub-remote-album" title={track.album}>{track.album||current.title}</span><span className="tsugi-hub-source"><span>{source.manifest.name}</span></span>
                <span className="tsugi-track-duration">{typeof track.duration==='number'?Math.floor(track.duration/60)+':'+String(Math.floor(track.duration%60)).padStart(2,'0'):'—'}</span>
              </button>
              <button type="button" className="tsugi-icon-action tsugi-save-track" aria-label={t`Save track to library`} aria-pressed={saving.isTrackSaved(source,track)} title={saving.isTrackSaved(source,track)?t`Remove from saved tracks`:t`Save track to library`} onClick={()=>setSaveNotice(saving.onToggleTrack(source,track)?t`Saved tracks updated.`:t`Could not update saved tracks. Check storage and library limits.`)}>{saving.isTrackSaved(source,track)?<FiCheck aria-hidden/>:<FiPlus aria-hidden/>}</button>
              </div>
            ))}
            </div>
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
        </div><aside className="tsugi-dashboard-right tsugi-hub-inspector"><section className="tsugi-dashboard-panel"><h3><Trans>Collection details</Trans></h3><dl className="tsugi-hub-details"><div><dt><Trans>Title</Trans></dt><dd>{detail?.title||current.title}</dd></div><div><dt><Trans>Artist</Trans></dt><dd>{detail?.artist||current.artist||'—'}</dd></div>{current.year&&<div><dt><Trans>Year</Trans></dt><dd>{current.year}</dd></div>}<div><dt><Trans>Tracks</Trans></dt><dd>{detail?.tracks.length??'—'}</dd></div></dl></section><section className="tsugi-dashboard-panel"><h3><Trans>Sources & plugins</Trans></h3><div className="tsugi-dashboard-service"><span>{source.manifest.name}</span><small><Trans>Current source</Trans></small></div></section></aside>
      </div>
    </section>
  );
}

export function MusicDiscover({
  source, onPlay, onFind, recent, onPlayRecent, onConfigure, onLibrary, onSearch, saving,
}: {
  source: MusicConnection | undefined;
  onPlay: PlayCollection;
  saving: CollectionSaving;
  onFind(recording: TrendingRecording): void;
  recent: RecentMusicPlay[];
  onPlayRecent(item: RecentMusicPlay): void;
  onConfigure(): void;
  onLibrary(): void;
  onSearch(): void;
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

  const featureHero = <section className="oto-feature" aria-label={t`Featured music`} data-featured={!!featured}>
    {featured?.artworkURL && <MusicArtwork source={featured.artworkURL} target={1024} responsive className="oto-feature-backdrop [&>svg]:hidden" />}
    <div className="oto-feature-copy">
      <p className="oto-overline">{featuredRow?.catalog.name || t`A little escape, a little closer`}</p>
      <BrushHeading as="h2">{featured?.title || <Trans>A world between notes</Trans>}</BrushHeading>
      <p className="oto-feature-description">{featured?.artist || featured?.album || <Trans>Find a little escape in the music you love.</Trans>}</p>
      {source && <p className="oto-feature-source"><span aria-hidden />{source.manifest.name}</p>}
      <div className="oto-feature-actions">
        <button type="button" className="tsugi-read-action oto-primary" onClick={() => featured && featuredRow ? openCatalogItem(featuredRow, featured) : source ? onSearch() : onConfigure()}>
          {featured?.type === 'track' ? <FiPlay aria-hidden /> : source ? <FiMusic aria-hidden /> : <FiPlus aria-hidden />}
          {featured ? featured.type === 'track' ? <Trans>Play</Trans> : <Trans>Explore</Trans> : source ? <Trans>Search music</Trans> : <Trans>Connect a music source</Trans>}
        </button>
        <button type="button" className="tsugi-read-action oto-feature-secondary" onClick={onLibrary}><Trans>Open library</Trans><FiArrowRight aria-hidden /></button>
      </div>
    </div>
    {featured?.artworkURL && <div className="oto-feature-cover"><MusicArtwork source={featured.artworkURL} target={768} className="size-full object-cover" /></div>}
    <span className="oto-feature-japanese" aria-hidden="true" lang="ja"><Trans>夜の向こうへ</Trans></span>
    {heroItems.length > 1 && <div className="oto-feature-controls">
      <span>{String(spotlight + 1).padStart(2, '0')} <span aria-hidden>/</span> {String(heroItems.length).padStart(2, '0')}</span>
      <button type="button" onClick={() => setSpotlight((spotlight + heroItems.length - 1) % heroItems.length)} aria-label={t`Previous featured music`}><FiChevronLeft aria-hidden /></button>
      <button type="button" onClick={() => setSpotlight((spotlight + 1) % heroItems.length)} aria-label={t`Next featured music`}><FiChevronRight aria-hidden /></button>
    </div>}
  </section>;

  if (!source) return (
    <section aria-label={t`Music discovery`} className="tsugi-hub tsugi-discovery-workspace">
      {featureHero}
      <div className="oto-welcome-heading"><p className="oto-overline"><Trans>Make yourself at home</Trans></p><h3><Trans>Your music starts here</Trans></h3></div>
      <div className="oto-start-grid">
        <section className="oto-start-card"><FiMusic aria-hidden /><div><h3><Trans>Connect your sound</Trans></h3><p><Trans>Connect a music source to browse albums, playlists and tracks.</Trans></p></div><button type="button" className="tsugi-read-action" onClick={onConfigure}><BrushPlug aria-hidden /><Trans>Manage music sources</Trans><FiArrowRight aria-hidden /></button></section>
        <section className="oto-start-card"><FiFolder aria-hidden /><div><h3><Trans>Bring your own collection</Trans></h3><p><Trans>Open local audio, import playlists and keep your favourite music close.</Trans></p></div><button type="button" className="tsugi-read-action" onClick={onLibrary}><Trans id="Open local library">Open local library</Trans><FiArrowRight aria-hidden /></button></section>
      </div>
    </section>
  );

  return (
    <section aria-label={t`Music discovery`} className="tsugi-hub tsugi-discovery-workspace">
      <header className="tsugi-discovery-source oto-source-status">
        <span><Trans>Browsing</Trans> <strong>{source.manifest.name}</strong></span>
      </header>

      {loading && <p role="status" className="text-sm text-[--tsugi-muted]"><Trans>Loading music…</Trans></p>}
      {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}

      {featureHero}

      {recentFromSource.length > 0 && (
        <section aria-label={t`Recently played`}>
          <div className="mb-5 flex items-center justify-between gap-4">
            <h3 className="text-2xl font-semibold"><Trans>Back into your rhythm</Trans></h3>
            <button type="button" className="oto-text-action" onClick={onLibrary}><Trans>Open library</Trans><FiArrowRight aria-hidden /></button>
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
              : source.kind === 'soundcloud'
                ? <Trans>Search public SoundCloud tracks or explore independent charts below.</Trans>
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
        onClose={() => setSelected(null)} onPlay={onPlay} saving={saving} />
    </section>
  );
}
