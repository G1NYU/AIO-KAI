import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { BiArrowBack, BiDisc, BiFilm, BiMusic, BiSearch } from 'react-icons/bi';
import {
  loadAddon, loadStore, manifestUrlFor, resolveTrack, searchAddon,
  type EclipseManifest, type EclipseStoreEntry, type EclipseTrack,
} from '@/lib/music/eclipse';

/** Music lives outside the AIOStreams/Jellyfin session. */
export function MusicPage({
  openVideo,
  openWelcome,
}: {
  openVideo(): void;
  openWelcome(): void;
}) {
  const [store, setStore] = React.useState<EclipseStoreEntry[]>([]);
  const [storeError, setStoreError] = React.useState('');
  const [manifestInput, setManifestInput] = React.useState('');
  const [activeUrl, setActiveUrl] = React.useState('');
  const [activeAddon, setActiveAddon] = React.useState<EclipseManifest | null>(null);
  const [connectError, setConnectError] = React.useState('');
  const [connecting, setConnecting] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [searching, setSearching] = React.useState(false);
  const [searchError, setSearchError] = React.useState('');
  const [tracks, setTracks] = React.useState<EclipseTrack[]>([]);
  const [playing, setPlaying] = React.useState<EclipseTrack | null>(null);
  const [streamUrl, setStreamUrl] = React.useState('');
  const [playError, setPlayError] = React.useState('');
  const [resolving, setResolving] = React.useState(false);
  const generation = React.useRef(0);

  React.useEffect(() => {
    const controller = new AbortController();
    loadStore(controller.signal).then(setStore).catch((error: unknown) => {
      if (!controller.signal.aborted) setStoreError((error as Error).message);
    });
    return () => { controller.abort(); generation.current++; };
  }, []);

  async function connect(event: React.FormEvent) {
    event.preventDefault();
    const request = ++generation.current;
    setConnecting(true);
    setSearching(false);
    setResolving(false);
    setConnectError('');
    setActiveAddon(null);
    setActiveUrl('');
    setPlaying(null);
    setStreamUrl('');
    setTracks([]);
    setPlayError('');
    try {
      const url = manifestUrlFor(manifestInput);
      const addon = await loadAddon(url);
      if (request !== generation.current) return;
      setActiveUrl(url);
      setActiveAddon(addon);
      setSearchError('');
      setQuery('');
    } catch (error) {
      if (request === generation.current) setConnectError((error as Error).message);
    } finally {
      if (request === generation.current) setConnecting(false);
    }
  }

  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (!activeUrl || !query.trim()) return;
    const request = ++generation.current;
    setSearching(true);
    setConnecting(false);
    setResolving(false);
    setSearchError('');
    setTracks([]);
    try {
      const result = await searchAddon(activeUrl, query.trim());
      if (request === generation.current) setTracks(result);
    } catch (error) {
      if (request === generation.current) setSearchError((error as Error).message);
    } finally {
      if (request === generation.current) setSearching(false);
    }
  }

  async function play(track: EclipseTrack) {
    if (!activeUrl) return;
    const request = ++generation.current;
    setPlaying(track);
    setSearching(false);
    setConnecting(false);
    setStreamUrl('');
    setPlayError('');
    setResolving(true);
    try {
      const stream = await resolveTrack(activeUrl, track);
      if (request === generation.current) setStreamUrl(stream.url);
    } catch (error) {
      if (request === generation.current) setPlayError((error as Error).message);
    } finally {
      if (request === generation.current) setResolving(false);
    }
  }

  return (
    <main data-page="music" className="min-h-screen px-6 py-7 pb-44 sm:px-10">
      <div className="mx-auto max-w-6xl">
        <nav aria-label={t`Media sections`} className="mb-12 flex items-center justify-between gap-4">
          <button type="button" onClick={openWelcome} className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm text-[--muted] hover:bg-white/[0.08] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
            <BiArrowBack aria-hidden /> <Trans>All media</Trans>
          </button>
          <button type="button" onClick={openVideo} className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm hover:bg-white/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
            <BiFilm aria-hidden /> <Trans>Movies & TV</Trans>
          </button>
        </nav>

        <header className="mb-10 flex items-center gap-4">
          <span className="rounded-2xl border border-white/10 bg-white/[0.05] p-4">
            <BiMusic aria-hidden className="text-4xl text-violet-200" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[--muted]">
              <Trans>Independent listening</Trans>
            </p>
            <h1 className="text-4xl font-semibold tracking-tight"><Trans>Music</Trans></h1>
          </div>
        </header>

        <section aria-labelledby="music-source-heading" className="mb-10 space-y-4 rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:p-8">
          <h2 id="music-source-heading" className="text-2xl font-semibold">
            <Trans>Connect a music source</Trans>
          </h2>
          <p className="max-w-3xl text-sm leading-6 text-[--muted]">
            <Trans>Use a compatible Eclipse addon manifest. Private links stay in this session and are not saved to your account or AIOStreams configuration.</Trans>
          </p>
          <form onSubmit={connect} className="flex flex-col gap-3 sm:flex-row">
            <input
              aria-label={t`Eclipse addon manifest URL`}
              type="url" required autoComplete="off" spellCheck={false}
              value={manifestInput} onChange={(e) => setManifestInput(e.target.value)}
              placeholder="https://example.com/manifest.json"
              className="min-w-0 flex-1 rounded-xl border border-white/15 bg-black/20 px-4 py-3 text-sm text-white placeholder:text-[--muted] focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300"
            />
            <button type="submit" disabled={connecting} className="rounded-xl bg-violet-200 px-6 py-3 text-sm font-semibold text-slate-950 disabled:opacity-50">
              {connecting ? <Trans>Connecting…</Trans> : <Trans>Connect</Trans>}
            </button>
          </form>
          {connectError && <p role="alert" className="text-sm text-red-300">{connectError}</p>}
          {activeAddon && <p role="status" className="text-sm text-green-200">
            <Trans>Connected to {activeAddon.name}</Trans>
          </p>}
        </section>

        {activeAddon && (
          <section aria-labelledby="music-search-heading" className="mb-10 space-y-4">
            <h2 id="music-search-heading" className="text-2xl font-semibold"><Trans>Search music</Trans></h2>
            <form onSubmit={search} className="flex flex-col gap-3 sm:flex-row">
              <input aria-label={t`Search music`} value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder={t`Artist, album or track`}
                className="min-w-0 flex-1 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-[--muted] focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300" />
              <button type="submit" disabled={searching || !query.trim()}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 px-6 py-3 text-sm disabled:opacity-50">
                <BiSearch aria-hidden />{searching ? <Trans>Searching…</Trans> : <Trans>Search</Trans>}
              </button>
            </form>
            {searchError && <p role="alert" className="text-sm text-red-300">{searchError}</p>}
            <ul className="space-y-2">
              {tracks.map((track) => (
                <li key={track.id}>
                  <button type="button" onClick={() => void play(track)}
                    className="flex w-full items-center gap-4 rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3 text-start hover:bg-white/[0.07] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
                    {track.artworkURL
                      ? <img src={track.artworkURL} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-12 rounded-lg object-cover" />
                      : <BiDisc aria-hidden className="text-2xl text-violet-200" />}
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{track.title}</span>
                      <span className="block truncate text-xs text-[--muted]">
                        {track.artist}{track.album ? ' · ' + track.album : ''}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {!searching && tracks.length === 0 && !searchError &&
              <p className="text-sm text-[--muted]"><Trans>Search your connected addon to find tracks.</Trans></p>}
          </section>
        )}

        <section aria-labelledby="music-store-heading" className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <h2 id="music-store-heading" className="text-2xl font-semibold">
              <Trans>Eclipse community addon store</Trans>
            </h2>
            <a href="https://eclipsemusic.app/web/addon-store" target="_blank" rel="noopener noreferrer"
              className="text-sm text-violet-200 underline underline-offset-4">
              <Trans>Open official store</Trans>
            </a>
          </div>
          {storeError && <p role="alert" className="text-sm text-amber-200">
            <Trans>Could not load the addon registry: {storeError}</Trans>
          </p>}
          {store.length === 0 && !storeError &&
            <p className="text-sm text-[--muted]"><Trans>Loading community addons…</Trans></p>}
          <div className="grid gap-3 sm:grid-cols-2">
            {store.map((addon) => (
              <article key={addon.id} className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <div className="flex items-center gap-3">
                  {addon.icon
                    ? <img src={addon.icon} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-12 rounded-xl object-contain" />
                    : <BiDisc aria-hidden className="text-3xl text-violet-200" />}
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold">{addon.name}</h3>
                    <p className="text-xs text-[--muted]">{addon.author ?? t`Community`}</p>
                  </div>
                </div>
                <p className="flex-1 text-sm leading-6 text-[--muted]">{addon.description}</p>
                {addon.manifestUrl ? (
                  <button type="button" onClick={() => setManifestInput(addon.manifestUrl!)}
                    className="self-start rounded-lg border border-white/15 px-4 py-2 text-sm hover:bg-white/[0.08]">
                    <Trans>Use manifest</Trans>
                  </button>
                ) : addon.setupUrl ? (
                  <a href={addon.setupUrl} target="_blank" rel="noopener noreferrer"
                    className="self-start rounded-lg border border-white/15 px-4 py-2 text-sm hover:bg-white/[0.08]">
                    <Trans>Set up addon</Trans>
                  </a>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      </div>

      {(playing || resolving) && (
        <section aria-label={t`Music player`} className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#15131d] px-6 py-3 shadow-2xl">
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 sm:flex-row">
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{playing?.title}</p>
              <p className="truncate text-xs text-[--muted]">{playing?.artist}</p>
            </div>
            {resolving && <span className="text-sm text-[--muted]"><Trans>Resolving audio…</Trans></span>}
            {playError && <span role="alert" className="text-sm text-red-300">{playError}</span>}
            {streamUrl && <audio key={streamUrl} controls autoPlay preload="metadata" src={streamUrl}
              onError={() => setPlayError(t`The browser audio engine could not play this stream.`)}
              className="w-full max-w-xl" />}
          </div>
        </section>
      )}
    </main>
  );
}
