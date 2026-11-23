import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { BiArrowBack, BiDisc, BiFilm, BiMusic, BiSearch } from 'react-icons/bi';
import {
  loadAddon, loadStore, manifestUrlFor, resolveTrack, searchAddon,
  type EclipseManifest, type EclipseStoreEntry, type EclipseTrack,
} from '@/lib/music/eclipse';
import {
  readMusicSources, remembersMusicSources, saveMusicSources,
  type MusicConnection,
} from '@/lib/music/connections';
import { MusicPlayer, type RepeatMode } from './player';

/** Music lives outside the AIOStreams/Jellyfin session. */
export function MusicPage({
  openVideo,
  openWelcome,
  visible,
}: {
  openVideo(): void;
  openWelcome(): void;
  visible: boolean;
}) {
  const [store, setStore] = React.useState<EclipseStoreEntry[]>([]);
  const [storeError, setStoreError] = React.useState('');
  const [manifestInput, setManifestInput] = React.useState('');
  const [connections, setConnections] = React.useState<MusicConnection[]>(readMusicSources);
  const [rememberSources, setRememberSources] = React.useState(remembersMusicSources);
  const [selectedId, setSelectedId] = React.useState(() => readMusicSources()[0]?.id ?? '');
  const activeSource = connections.find((source) => source.id === selectedId);
  const activeUrl = activeSource?.url ?? '';
  const activeAddon = activeSource?.manifest ?? null;
  const connectedName = activeAddon?.name ?? '';
  const [playingSourceId, setPlayingSourceId] = React.useState('');
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
  const [queue, setQueue] = React.useState<EclipseTrack[]>([]);
  const [queueIndex, setQueueIndex] = React.useState(-1);
  const [paused, setPaused] = React.useState(true);
  const [position, setPosition] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [quality, setQuality] = React.useState('');
  const [volume, setVolume] = React.useState(0.85);
  const [expanded, setExpanded] = React.useState(false);
  const [shuffle, setShuffle] = React.useState(false);
  const [repeat, setRepeat] = React.useState<RepeatMode>('off');
  const audioRef = React.useRef<HTMLAudioElement>(null);
  const playbackRequest = React.useRef(0);
  const generation = React.useRef(0);

  React.useEffect(() => {
    saveMusicSources(rememberSources, connections);
  }, [rememberSources, connections]);

  React.useEffect(() => {
    if (!visible) {
      // Do not play music over a movie; keep the track and provider in memory.
      audioRef.current?.pause();
      setPaused(true);
      setExpanded(false);
    }
  }, [visible]);

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
    setTracks([]);
    setPlayError('');
    try {
      const url = manifestUrlFor(manifestInput);
      const addon = await loadAddon(url);
      if (request !== generation.current) return;
      const existing = connections.find((source) => source.url === url);
      const id = existing?.id ?? crypto.randomUUID();
      setConnections((previous) => existing
        ? previous.map((source) => source.id === id ? { id, url, manifest: addon } : source)
        : [...previous, { id, url, manifest: addon }]);
      setSelectedId(id);
      setManifestInput('');
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

  async function play(track: EclipseTrack, at: number, source: MusicConnection, fromQueue = false) {
    const request = ++playbackRequest.current;
    audioRef.current?.pause();
    if (!fromQueue) setQueue(tracks);
    setQueueIndex(at);
    setPlaying(track);
    setPlayingSourceId(source.id);
    setSearching(false);
    setStreamUrl('');
    setPlayError('');
    setPosition(0);
    setDuration(track.duration ?? 0);
    setPaused(true);
    setQuality('');
    setResolving(true);
    try {
      const stream = await resolveTrack(source.url, track);
      if (request !== playbackRequest.current) return;
      setQuality(stream.quality ?? stream.format ?? '');
      setStreamUrl(stream.url);
    } catch (error) {
      if (request === playbackRequest.current)
        setPlayError(error instanceof Error ? error.message : t`The browser audio engine could not play this stream.`);
    } finally {
      if (request === playbackRequest.current) setResolving(false);
    }
  }

  function seek(seconds: number) {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(seconds)) return;
    const maximum = Number.isFinite(audio.duration) ? audio.duration : duration;
    audio.currentTime = Math.max(0, Math.min(seconds, maximum));
    setPosition(audio.currentTime);
  }

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      setPlayError('');
      void audio.play().catch(() => setPlayError(t`The browser audio engine could not play this stream.`));
    } else audio.pause();
  }

  function next(auto = false) {
    const source = connections.find((item) => item.id === playingSourceId);
    if (!source || !queue.length) return;
    if (auto && repeat === 'one') {
      seek(0);
      void audioRef.current?.play();
      return;
    }
    let at = queueIndex + 1;
    if (shuffle && queue.length > 1) {
      const candidate = Math.floor(Math.random() * (queue.length - 1));
      at = candidate >= queueIndex ? candidate + 1 : candidate;
    } else if (at >= queue.length) {
      if (repeat !== 'all') {
        if (auto) setPaused(true);
        return;
      }
      at = 0;
    }
    void play(queue[at], at, source, true);
  }

  function previous() {
    if (position > 3) return seek(0);
    const source = connections.find((item) => item.id === playingSourceId);
    if (!source || !queue.length) return;
    const at = queueIndex > 0 ? queueIndex - 1 : repeat === 'all' ? queue.length - 1 : 0;
    void play(queue[at], at, source, true);
  }

  function changeVolume(value: number) {
    const safe = Math.min(1, Math.max(0, value));
    setVolume(safe);
    if (audioRef.current) audioRef.current.volume = safe;
  }

  function switchSource(id: string) {
    ++generation.current;
    setSelectedId(id);
    setTracks([]);
    setQuery('');
    setSearchError('');
    setSearching(false);
    setConnecting(false);
    setConnectError('');
  }

  function removeSource(id: string) {
    ++generation.current;
    setConnections((previous) => previous.filter((source) => source.id !== id));
    if (selectedId === id) {
      setSelectedId(connections.find((source) => source.id !== id)?.id ?? '');
      setTracks([]);
      setQuery('');
    }
    if (playingSourceId === id) {
      ++playbackRequest.current;
      audioRef.current?.pause();
      setPlaying(null);
      setPlayingSourceId('');
      setStreamUrl('');
      setQueue([]);
      setQueueIndex(-1);
      setResolving(false);
      setPlayError('');
      setExpanded(false);
    }
  }

  return (
    <main data-page="music" style={{ display: visible ? 'block' : 'none' }}
      className="min-h-screen px-6 py-7 pb-44 sm:px-10">
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
            <Trans>Connect multiple Eclipse music sources. Their private URLs are kept only in memory unless you choose to remember them on this device.</Trans>
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
          <label className="flex items-start gap-3 text-xs text-[--muted]">
            <input type="checkbox" checked={rememberSources}
              onChange={(event) => setRememberSources(event.target.checked)}
              className="mt-0.5 accent-violet-300" />
            <span><Trans>Remember my music sources on this device (stored locally without encryption).</Trans></span>
          </label>
          {connections.length > 0 && (
            <div className="flex flex-wrap gap-2" aria-label={t`Connected music sources`}>
              {connections.map((source) => (
                <div key={source.id} className="flex items-center rounded-full border border-white/15 bg-white/[0.04] text-sm">
                  <button type="button" onClick={() => switchSource(source.id)}
                    aria-pressed={selectedId === source.id}
                    className={selectedId === source.id
                      ? 'rounded-full bg-violet-200 px-4 py-2 font-semibold text-slate-950'
                      : 'rounded-full px-4 py-2 text-white hover:bg-white/10'}>
                    {source.manifest.name}
                  </button>
                  <button type="button" onClick={() => removeSource(source.id)}
                    aria-label={t`Remove music source`}
                    className="rounded-full px-3 py-2 text-[--muted] hover:text-red-300">×</button>
                </div>
              ))}
            </div>
          )}
          {activeAddon && <p role="status" className="text-sm text-green-200">
            <Trans>Connected to {connectedName}</Trans>
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
              {tracks.map((track, at) => (
                <li key={track.id}>
                  <button type="button" onClick={() => activeSource && void play(track, at, activeSource)}
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

      {playing && streamUrl && (
        <audio ref={audioRef} key={streamUrl} autoPlay preload="metadata" src={streamUrl}
          onLoadedMetadata={(event) => {
            const audio = event.currentTarget;
            audio.volume = volume;
            if (Number.isFinite(audio.duration)) setDuration(audio.duration);
          }}
          onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
          onEnded={() => next(true)}
          onError={() => setPlayError(t`The browser audio engine could not play this stream.`)} />
      )}
      <MusicPlayer p={{
        track: playing,
        sourceName: connections.find((item) => item.id === playingSourceId)?.manifest.name ?? '',
        queue, index: queueIndex, paused, loading: resolving, error: playError,
        position, duration, volume, quality, expanded, shuffle, repeat,
        onExpanded: setExpanded, onToggle: toggle, onNext: next,
        onPrevious: previous, onSeek: seek, onVolume: changeVolume,
        onShuffle: setShuffle, onRepeat: setRepeat,
        onQueue: (at) => {
          const source = connections.find((item) => item.id === playingSourceId);
          if (source && queue[at]) void play(queue[at], at, source, true);
        },
      }} />
    </main>
  );
}
