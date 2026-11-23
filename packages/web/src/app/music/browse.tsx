import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { BiArrowBack, BiDisc, BiPlay } from 'react-icons/bi';
import {
  catalogTrack, loadAddon, loadCatalog, loadDetail,
  type EclipseCatalogDefinition, type EclipseCatalogItem, type EclipseDetail, type EclipseTrack,
} from '@/lib/music/eclipse';
import type { MusicConnection } from '@/lib/music/connections';

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
    loadDetail(source.url, current, controller.signal).then((result) => {
      if (!controller.signal.aborted) setDetail(result);
    }).catch(() => {
      if (!controller.signal.aborted) setError(t`This collection is unavailable from the addon.`);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [current, source.url]);

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
      className="fixed inset-0 z-40 overflow-y-auto bg-[#100e17] text-white">
      <div className="mx-auto min-h-screen max-w-6xl px-6 py-7 sm:px-10">
        <button type="button" onClick={nested ? () => setNested(null) : onClose}
          className="mb-9 inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm text-white/65 hover:bg-white/10">
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
              <button type="button" onClick={() => onPlay(source, detail.tracks, 0)}
                className="inline-flex items-center gap-2 rounded-full bg-violet-200 px-5 py-2.5 font-semibold text-[#171420]">
                <BiPlay aria-hidden /> <Trans>Play all</Trans>
              </button>
            </div>
            {detail.tracks.map((track, at) => (
              <button key={track.id + ':' + at} type="button"
                onClick={() => onPlay(source, detail.tracks, at)}
                className="flex w-full items-center gap-4 rounded-xl border border-white/[0.05] bg-white/[0.035] px-4 py-3 text-left hover:bg-white/[0.09]">
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
                  className="min-w-0 rounded-xl bg-white/[0.04] p-3 text-left hover:bg-white/10">
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
  source, onPlay,
}: {
  source: MusicConnection | undefined;
  onPlay: PlayCollection;
}) {
  const [shelves, setShelves] = React.useState<Shelf[]>([]);
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
        // Refresh manifest: old saved connections may predate catalog support.
        const manifest = await loadAddon(source.url, controller.signal);
        const catalogs = manifest.resources.includes('catalog') ? (manifest.catalogs ?? []) : [];
        if (controller.signal.aborted) return;
        setHasCatalog(catalogs.length > 0);
        const rows = await Promise.all(catalogs.map(async (catalog): Promise<Shelf> => {
          try {
            return { catalog, items: await loadCatalog(source.url, catalog, 0, controller.signal), unavailable: false };
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
  }, [source?.id, source?.url]);

  if (!source) return (
    <p className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-white/50">
      <Trans>Connect a music source to explore its catalogs.</Trans>
    </p>
  );
  return (
    <section aria-label={t`Music discovery`} className="space-y-10">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-violet-200/70">
          <Trans>Explore</Trans>
        </p>
        <h2 className="text-3xl font-semibold tracking-tight">{source.manifest.name}</h2>
        <p className="text-sm text-white/45">
          <Trans>Albums, playlists and songs from your connected music source.</Trans>
        </p>
      </header>
      {loading && <p role="status" className="text-white/55"><Trans>Loading music…</Trans></p>}
      {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
      {!loading && !error && !hasCatalog && (
        <p className="rounded-xl border border-white/10 bg-white/[0.03] p-7 text-sm text-white/50">
          <Trans>This addon has no published catalog shelves. Use Search to browse its tracks.</Trans>
        </p>
      )}
      {shelves.map((row) => (
        <section key={row.catalog.id} className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-semibold">{row.catalog.name}</h3>
            <span className="text-xs uppercase tracking-wider text-white/35">{row.catalog.type}</span>
          </div>
          {row.unavailable && <p className="text-sm text-white/50"><Trans>This shelf is temporarily unavailable.</Trans></p>}
          {row.items.length > 0 && (
            <div className="flex snap-x gap-4 overflow-x-auto pb-5">
              {row.items.map((item, index) => (
                <button key={item.id + ':' + index} type="button"
                  onClick={() => {
                    if (item.type === 'track') {
                      const songs = row.items.filter((entry) => entry.type === 'track').map(catalogTrack);
                      onPlay(source, songs, index);
                    } else setSelected(item);
                  }}
                  className="group w-40 shrink-0 snap-start text-left sm:w-44">
                  <Cover src={item.artworkURL} />
                  <span className="mt-3 block truncate text-sm font-semibold">{item.title}</span>
                  <span className="mt-1 block truncate text-xs text-white/45">{item.artist ?? item.album ?? ''}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      ))}
      <MusicCollection source={source} selected={selected}
        onClose={() => setSelected(null)} onPlay={onPlay} />
    </section>
  );
}
