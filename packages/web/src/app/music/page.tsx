import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { BiDisc, BiSearch } from 'react-icons/bi';
import { FiMenu, FiSearch, FiX, FiArrowUpRight, FiPlus } from 'react-icons/fi';
import {
  loadAddon, loadStore, manifestUrlFor, resolveTrack, searchAddonAll,
  type EclipseCatalogItem, type EclipseStoreEntry, type EclipseTrack,
} from '@/lib/music/eclipse';
import {
  readMusicSources, remembersMusicSources, saveMusicSources,
  type MusicConnection,
} from '@/lib/music/connections';
import { MusicPlayer, type RepeatMode } from './player';
import { MusicLibrary } from './library';
import {
  addToMusicPlaylist, createMusicPlaylist, readMusicLibrary, saveMusicLibrary,
  savedTrack, type SavedMusicTrack,
} from '@/lib/music/library';
import { TsugiBrand } from '@/components/tsugi-brand';
import { applyEclipseAppearance } from '@/lib/music/eclipse-appearance';
import { MusicCollection, MusicDiscover, type PlayCollection } from './browse';
import type { TrendingRecording } from '@/lib/music/discovery';
import { makeRecentPlay, mergeRecentPlays, readRecentPlays, storeRecentPlays, type RecentMusicPlay } from '@/lib/music/history';

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
  const [collections, setCollections] = React.useState<EclipseCatalogItem[]>([]);
  const [selectedCollection, setSelectedCollection] = React.useState<EclipseCatalogItem | null>(null);
  const [tab, setTab] = React.useState<'discover' | 'search' | 'library'>('discover');
  const [playlists, setPlaylists] = React.useState(readMusicLibrary);
  const [libraryError, setLibraryError] = React.useState('');
  const [localTracks, setLocalTracks] = React.useState<EclipseTrack[]>([]);
  const localURLs = React.useRef(new Map<string,string>());
  const LOCAL_SOURCE = 'tsugi-local';
  const [settingsOpen, setSettingsOpen] = React.useState(() => readMusicSources().length === 0);

  React.useEffect(() => {
    const update = () => applyEclipseAppearance();
    update();
    window.addEventListener('tsugi-eclipse-appearance-change', update);
    return () => window.removeEventListener('tsugi-eclipse-appearance-change', update);
  }, []);
  const [recent, setRecent] = React.useState<RecentMusicPlay[]>(readRecentPlays);
  const settingsCloseRef = React.useRef<HTMLButtonElement>(null);
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
    storeRecentPlays(recent, rememberSources);
  }, [recent, rememberSources]);

  React.useEffect(() => {
    saveMusicLibrary(playlists);
  }, [playlists]);

  React.useEffect(() => {
    const urls = localURLs.current;
    return () => { for (const url of urls.values()) URL.revokeObjectURL(url); };
  }, []);

  React.useEffect(() => {
    if (!settingsOpen) return;
    settingsCloseRef.current?.focus();
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSettingsOpen(false);
    };
    document.addEventListener('keydown', dismiss);
    return () => document.removeEventListener('keydown', dismiss);
  }, [settingsOpen]);

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
      setCollections([]);
      setTab(addon.catalogs?.length ? 'discover' : 'search');
      setSettingsOpen(false);
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
    setCollections([]);
    try {
      const result = await searchAddonAll(activeUrl, query.trim());
      if (request === generation.current) {
        setTracks(result.tracks);
        setCollections([...result.albums, ...result.artists, ...result.playlists]);
      }
    } catch (error) {
      if (request === generation.current) setSearchError((error as Error).message);
    } finally {
      if (request === generation.current) setSearching(false);
    }
  }

  async function findChartTrack(song: TrendingRecording) {
    // ListenBrainz supplies only metadata. Always let the user select the track.
    const source = activeSource;
    const term = song.artist + ' ' + song.title;
    setTab('search');
    setQuery(term);
    setTracks([]);
    setCollections([]);
    setSearchError('');
    if (!source) return;
    const request = ++generation.current;
    setSearching(true);
    try {
      const result = await searchAddonAll(source.url, term);
      if (request === generation.current) {
        setTracks(result.tracks);
        setCollections([...result.albums, ...result.artists, ...result.playlists]);
      }
    } catch (reason) {
      if (request === generation.current)
        setSearchError(reason instanceof Error ? reason.message : t`Search failed.`);
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
      setRecent((current) => mergeRecentPlays(current, makeRecentPlay(source.id, track)));
    } catch (error) {
      if (request === playbackRequest.current)
        setPlayError(error instanceof Error ? error.message : t`The browser audio engine could not play this stream.`);
    } finally {
      if (request === playbackRequest.current) setResolving(false);
    }
  }

  const playCollection: PlayCollection = (source, songs, at) => {
    if (!songs[at]) return;
    setQueue(songs);
    void play(songs[at], at, source, true);
  };

  function importLocalFiles(files: File[]) {
    const supported = files.filter(file =>
      /^audio\//.test(file.type) || /\.(mp3|m4a|flac|wav|ogg)$/i.test(file.name)).slice(0, 250);
    const tracks = supported.map(file => {
      const id = 'local:' + crypto.randomUUID();
      localURLs.current.set(id, URL.createObjectURL(file));
      return {
        id,
        title: file.name.replace(/\.[^.]+$/, ''),
        artist: 'Local file',
        album: 'This session',
      } satisfies EclipseTrack;
    });
    if (tracks.length) {
      setLocalTracks(current => [...current,...tracks].slice(-250));
      setLibraryError('');
    } else {
      setLibraryError(t`No supported audio files were selected.`);
    }
  }

  function playLocalTrack(track: EclipseTrack, at: number, fromQueue = false) {
    const url = localURLs.current.get(track.id);
    if (!url) {
      setLibraryError(t`This local file is no longer available. Reopen it from your device.`);
      return;
    }
    ++playbackRequest.current;
    audioRef.current?.pause();
    if (!fromQueue) setQueue(localTracks);
    setQueueIndex(at);
    setPlaying(track);
    setPlayingSourceId(LOCAL_SOURCE);
    setStreamUrl(url);
    setPlayError('');
    setPosition(0);
    setDuration(0);
    setPaused(true);
    setResolving(false);
    setQuality('Local');
  }

  function saveTrackInLibrary(track: EclipseTrack) {
    const sourceId = activeSource?.id ?? playingSourceId;
    const entry = savedTrack(track, sourceId);
    setPlaylists((current) => {
      const existing = current.find((list) => list.name === 'Saved tracks');
      if (existing) return current.map((list) =>
        list.id === existing.id ? addToMusicPlaylist(list, entry) : list);
      return [...current, addToMusicPlaylist(createMusicPlaylist('Saved tracks'), entry)];
    });
  }

  async function playSavedTrack(entry: SavedMusicTrack) {
    setLibraryError('');
    if (localURLs.current.has(entry.id)) {
      const at = localTracks.findIndex(track => track.id === entry.id);
      playLocalTrack(entry, Math.max(0,at), false);
      return;
    }
    const exactSource = connections.find((source) => source.id === entry.sourceId);
    const source = exactSource ?? activeSource;
    if (!source) {
      setLibraryError(t`Connect a music source to play saved tracks.`);
      return;
    }
    const normalized = (text: string) => text.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
    const selected = exactSource ? entry : null;
    if (selected) {
      setQueue([selected]);
      void play(selected, 0, source, true);
      return;
    }
    try {
      const result = await searchAddonAll(source.url, entry.artist + ' ' + entry.title);
      const match = result.tracks.find(track =>
        entry.isrc && track.isrc === entry.isrc) ??
        result.tracks.find(track => normalized(track.title) === normalized(entry.title) &&
          normalized(track.artist) === normalized(entry.artist));
      if (!match) {
        setLibraryError(t`No matching playable track was found in the active music source.`);
        return;
      }
      setQueue([match]);
      void play(match, 0, source, true);
    } catch {
      setLibraryError(t`Could not search the active music source for this saved track.`);
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
    const local = playingSourceId === LOCAL_SOURCE;
    const source = connections.find((item) => item.id === playingSourceId);
    if ((!source && !local) || !queue.length) return;
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
    if (local) playLocalTrack(queue[at], at, true);
    else if (source) void play(queue[at], at, source, true);
  }

  function previous() {
    if (position > 3) return seek(0);
    const local = playingSourceId === LOCAL_SOURCE;
    const source = connections.find((item) => item.id === playingSourceId);
    if ((!source && !local) || !queue.length) return;
    const at = queueIndex > 0 ? queueIndex - 1 : repeat === 'all' ? queue.length - 1 : 0;
    if (local) playLocalTrack(queue[at], at, true);
    else if (source) void play(queue[at], at, source, true);
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
    setCollections([]);
    setSelectedCollection(null);
    setQuery('');
    setSearchError('');
    setSearching(false);
    setConnecting(false);
    setConnectError('');
  }

  function removeSource(id: string) {
    ++generation.current;
    setConnections((previous) => previous.filter((source) => source.id !== id));
    setRecent((previous) => previous.filter((entry) => entry.sourceId !== id));
    if (selectedId === id) {
      setSelectedId(connections.find((source) => source.id !== id)?.id ?? '');
      setTracks([]);
      setCollections([]);
      setSelectedCollection(null);
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
      className="tsugi-music-root min-h-screen px-6 pb-36 pt-14 sm:px-[3vw]">
      <div className="w-full">
        <header className="tsugi-music-top mb-10 flex items-center justify-between gap-6">
          <button type="button" onClick={openWelcome} className="tsugi-brand-action" aria-label={t`All media`}>
            <TsugiBrand />
          </button>
          <div className="flex items-center gap-2">
            <button type="button" className="tsugi-icon-action" onClick={() => setTab('search')}
              aria-label={t`Search music`}>
              <FiSearch aria-hidden className="text-xl" />
            </button>
            <button type="button" className="tsugi-icon-action" onClick={() => setSettingsOpen(true)}
              aria-label={t`Music settings`}>
              <FiMenu aria-hidden className="text-xl" />
            </button>
          </div>
        </header>

        <nav className="tsugi-music-navigation mb-8 flex items-center gap-8"
          aria-label={t`Music sections`}>
          <button type="button" aria-current={tab === 'discover' ? 'page' : undefined}
            onClick={() => setTab('discover')}><Trans>Discover</Trans></button>
          <button type="button" aria-current={tab === 'search' ? 'page' : undefined}
            onClick={() => setTab('search')}><Trans>Search</Trans></button>
          <button type="button" aria-current={tab === 'library' ? 'page' : undefined}
            onClick={() => setTab('library')}><Trans>Library</Trans></button>
        </nav>

        {tab === 'discover' && <MusicDiscover source={activeSource} onPlay={playCollection}
          onFind={(song) => { void findChartTrack(song); }}
          recent={recent}
          onPlayRecent={(entry) => {
            const source = connections.find((item) => item.id === entry.sourceId);
            if (!source) return;
            setQueue([entry.track]);
            void play(entry.track, 0, source, true);
          }}
          onConfigure={() => setSettingsOpen(true)} />}

        {tab === 'library' && (
          <>
            {libraryError && <p role="alert" className="mb-6 text-sm text-amber-200">{libraryError}</p>}
            <MusicLibrary playlists={playlists} onChange={setPlaylists}
              onPlay={(entry) => { void playSavedTrack(entry); }}
              playing={playing ? savedTrack(playing, playingSourceId) : null}
              localTracks={localTracks}
              onImportLocal={importLocalFiles}
              onPlayLocal={(track) => playLocalTrack(track,
                Math.max(0,localTracks.findIndex(item => item.id === track.id)))} />
          </>
        )}

        {tab === 'search' && activeAddon && (
          <section aria-labelledby="music-search-heading" className="mb-10 space-y-4">
            <h2 id="music-search-heading" className="text-2xl font-semibold"><Trans>Search music</Trans></h2>
            <form onSubmit={search} className="flex flex-col gap-3 sm:flex-row">
              <input aria-label={t`Search music`} value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder={t`Artist, album or track`}
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm placeholder:text-[--muted] focus-visible:outline focus-visible:outline-2" />
              <button type="submit" disabled={searching || !query.trim()}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-6 py-3 text-sm disabled:opacity-50">
                <BiSearch aria-hidden />{searching ? <Trans>Searching…</Trans> : <Trans>Search</Trans>}
              </button>
            </form>
            {searchError && <p role="alert" className="text-sm text-red-300">{searchError}</p>}
            {collections.length > 0 && (
              <section className="space-y-3">
                <h3 className="text-lg font-semibold"><Trans>Albums, artists and playlists</Trans></h3>
                <div className="flex gap-4 overflow-x-auto pb-3">
                  {collections.map((item) => (
                    <button key={item.type + ':' + item.id} type="button"
                      onClick={() => setSelectedCollection(item)}
                      className="w-36 shrink-0 text-left transition-transform hover:-translate-y-0.5">
                      {item.artworkURL
                        ? <img src={item.artworkURL} alt="" loading="lazy" referrerPolicy="no-referrer"
                            className="aspect-square w-full rounded-xl object-cover" />
                        : <span className="flex aspect-square items-center justify-center rounded-xl bg-[#292335]">
                            <BiDisc aria-hidden className="text-4xl text-violet-200/70" />
                          </span>}
                      <span className="mt-2 block truncate text-sm font-medium">{item.title}</span>
                      <span className="block truncate text-xs text-white/45">{item.artist ?? item.type}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
            <ul className="space-y-1">
              {tracks.map((track, at) => (
                <li key={track.id} className="flex items-center gap-2">
                  <button type="button" onClick={() => activeSource && void play(track, at, activeSource)}
                    data-ui="music-track-row" className="flex min-w-0 flex-1 items-center gap-4 px-4 py-3 text-start focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
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
                  <button type="button" className="tsugi-icon-action shrink-0" onClick={() => saveTrackInLibrary(track)}
                    aria-label={t`Save track to library`}>
                    <FiPlus aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
            {!searching && tracks.length === 0 && collections.length === 0 && !searchError &&
              <p className="text-sm text-[--muted]"><Trans>Search your connected addon to find tracks.</Trans></p>}
          </section>
        )}

      </div>

      {settingsOpen && (
        <div className="tsugi-settings-backdrop fixed inset-0 z-40 flex justify-end"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSettingsOpen(false);
          }}>
          <aside role="dialog" aria-modal="true" aria-label={t`Music settings`}
            className="tsugi-settings-sheet h-full w-full max-w-[520px] overflow-y-auto px-6 pb-14 pt-14 sm:px-9">
            <div className="mb-10 flex items-center justify-between gap-4">
              <h2 className="text-2xl font-semibold"><Trans>Music settings</Trans></h2>
              <button ref={settingsCloseRef} type="button" className="tsugi-icon-action"
                onClick={() => setSettingsOpen(false)} aria-label={t`Close`}>
                <FiX aria-hidden className="text-xl" />
              </button>
            </div>
            <nav className="mb-10 flex flex-wrap gap-5 text-sm">
              <button type="button" onClick={() => { setSettingsOpen(false); openWelcome(); }}
                className="inline-flex items-center gap-2 text-[--tsugi-muted] hover:text-white">
                <Trans>All media</Trans><FiArrowUpRight aria-hidden />
              </button>
              <button type="button" onClick={() => { setSettingsOpen(false); openVideo(); }}
                className="inline-flex items-center gap-2 text-[--tsugi-muted] hover:text-white">
                <Trans>Movies & TV</Trans><FiArrowUpRight aria-hidden />
              </button>
            </nav>
            {connections.length > 0 && (
              <label className="mb-7 block text-xs text-[--tsugi-muted]">
                <Trans>Active music source</Trans>
                <select aria-label={t`Active music source`} value={selectedId}
                  onChange={(event) => switchSource(event.target.value)}
                  className="tsugi-menu-select mt-3 block w-full">
                  {connections.map((connection) => (
                    <option key={connection.id} value={connection.id}>{connection.manifest.name}</option>
                  ))}
                </select>
              </label>
            )}
        <section aria-labelledby="music-source-heading" 
          className="mb-12 space-y-4">
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
              className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm placeholder:text-[--muted] focus-visible:outline focus-visible:outline-2"
            />
            <button type="submit" disabled={connecting} className="rounded-xl px-6 py-3 text-sm font-semibold disabled:opacity-50" style={{background:'var(--tsugi-accent)',color:'var(--tsugi-canvas)'}}>
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
                <div key={source.id} className="flex items-center gap-2 text-sm">
                  <button type="button" onClick={() => switchSource(source.id)}
                    aria-pressed={selectedId === source.id}
                    className={selectedId === source.id
                      ? 'border-b border-[--tsugi-accent] px-2 py-2 font-semibold text-[--tsugi-ink]'
                      : 'px-2 py-2 text-[--tsugi-muted] hover:text-white'}>
                    {source.manifest.name}
                  </button>
                  <button type="button" onClick={() => removeSource(source.id)}
                    aria-label={t`Remove music source`}
                    className="px-2 py-2 text-[--muted] hover:text-red-300">×</button>
                </div>
              ))}
            </div>
          )}
          {activeAddon && <p role="status" className="text-sm text-green-200">
            <Trans>Connected to {connectedName}</Trans>
          </p>}
        </section>


        <section aria-labelledby="music-store-heading" 
          className="space-y-4">
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
          <div className="border-t border-white/10 py-5 text-sm">
            <h3 className="font-semibold"><Trans>DebridVault library</Trans></h3>
            <p className="mt-2 max-w-2xl text-white/55">
              <Trans>Manage your personal Real-Debrid or TorBox music library in DebridVault. This website is not itself an Eclipse addon manifest.</Trans>
            </p>
            <a href="https://debridvault.elfhosted.com/settings" target="_blank" rel="noopener noreferrer"
              className="mt-3 inline-block text-violet-200 underline underline-offset-4">
              <Trans>Configure DebridVault</Trans>
            </a>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {store.map((addon) => (
              <article key={addon.id} className="flex flex-col gap-3 border-b border-white/10 py-5">
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

          </aside>
        </div>
      )}

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
      {activeSource && (
        <MusicCollection source={activeSource} selected={selectedCollection}
          onClose={() => setSelectedCollection(null)} onPlay={playCollection} />
      )}
      <MusicPlayer p={{
        track: playing,
        sourceName: playingSourceId === LOCAL_SOURCE ? 'Local audio' :
          connections.find((item) => item.id === playingSourceId)?.manifest.name ?? '',
        queue, index: queueIndex, paused, loading: resolving, error: playError,
        position, duration, volume, quality, expanded, shuffle, repeat,
        onExpanded: setExpanded, onToggle: toggle, onNext: next,
        onPrevious: previous, onSeek: seek, onVolume: changeVolume,
        onShuffle: setShuffle, onRepeat: setRepeat,
        onQueue: (at) => {
          const source = connections.find((item) => item.id === playingSourceId);
          if (playingSourceId === LOCAL_SOURCE && queue[at]) playLocalTrack(queue[at],at,true);
          else if (source && queue[at]) void play(queue[at], at, source, true);
        },
      }} />
    </main>
  );
}
