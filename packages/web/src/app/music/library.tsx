import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import {
  FiArrowUpRight, FiDisc, FiDownload, FiFilePlus, FiFolderPlus, FiList, FiPlus, FiTrash2,
} from 'react-icons/fi';
import type { MusicPlaylist, SavedMusicTrack } from '@/lib/music/library';
import {
  createMusicPlaylist, exportMusicPlaylist, importMusicPlaylist,
} from '@/lib/music/library';

export function MusicLibrary({
  playlists, onChange, onPlay, playing, localTracks, onImportLocal, onPlayLocal,
}: {
  playlists: MusicPlaylist[];
  onChange(next: MusicPlaylist[]): void;
  onPlay(track: SavedMusicTrack): void;
  playing: SavedMusicTrack | null;
  localTracks: SavedMusicTrack[];
  onImportLocal(files: File[]): void;
  onPlayLocal(track: SavedMusicTrack): void;
}) {
  const [selected, setSelected] = React.useState<string>('');
  const [newName, setNewName] = React.useState('');
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const localInputRef = React.useRef<HTMLInputElement>(null);
  const current = playlists.find((list) => list.id === selected) ?? playlists[0];

  function create(event: React.FormEvent) {
    event.preventDefault();
    try {
      const next = createMusicPlaylist(newName);
      onChange([...playlists,next]);
      setSelected(next.id);
      setNewName('');
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t`Could not create playlist.`);
    }
  }

  async function importFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 1024 * 1024) {
      setError(t`Playlist files must be smaller than 1 MB.`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const list = importMusicPlaylist(file.name, await file.text(), t`Unknown artist`);
      onChange([...playlists,list]);
      setSelected(list.id);
      setNotice(t`Playlist imported. Unmatched tracks will be searched in the active music source when played.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t`Could not import playlist.`);
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!current) return;
    const blob = new Blob([exportMusicPlaylist(current)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = (current.name.replace(/[^\w\d _-]/g,'').slice(0,60) || 'playlist') + '.json';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function removePlaylist() {
    if (!current) return;
    onChange(playlists.filter(list => list.id !== current.id));
    setSelected('');
  }

  function removeTrack(track: SavedMusicTrack) {
    if (!current) return;
    onChange(playlists.map(list => list.id === current.id
      ? { ...list, tracks:list.tracks.filter(item =>
        !(item.id === track.id && item.artist === track.artist && item.sourceId === track.sourceId)) }
      : list));
  }

  function addCurrent() {
    if (!current || !playing) return;
    const exists = current.tracks.some(track => track.id === playing.id && track.sourceId === playing.sourceId);
    if (!exists) onChange(playlists.map(list =>
      list.id === current.id ? { ...list, tracks:[...list.tracks, playing] } : list));
  }

  return (
    <section data-ui="tsugi-library" className="tsugi-library space-y-9 pb-16">
      <header className="flex flex-wrap items-end justify-between gap-7">
        <div>
          <p className="tsugi-eyebrow"><Trans>Your collection</Trans></p>
          <h1 className="mt-2 text-[clamp(2.4rem,4vw,4.2rem)] font-semibold tracking-tight"><Trans>Library</Trans></h1>
          <p className="mt-3 text-sm text-[--tsugi-muted]">
            <Trans>Your playlists live on this device independently of your music sources.</Trans>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-6 text-sm">
          <button type="button" className="tsugi-library-action" onClick={() => localInputRef.current?.click()}>
            <FiFolderPlus aria-hidden /> <Trans>Open local audio</Trans>
          </button>
          <input ref={localInputRef} type="file" multiple accept="audio/*,.mp3,.m4a,.flac,.wav,.ogg"
            aria-label={t`Open local audio`} className="sr-only"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = '';
              onImportLocal(files);
            }} />
          <button type="button" className="tsugi-library-action" onClick={() => inputRef.current?.click()} disabled={busy}>
            <FiFilePlus aria-hidden /> <Trans>Import playlist</Trans>
          </button>
          <input ref={inputRef} type="file" className="sr-only" accept=".json,.m3u,.m3u8,application/json,audio/x-mpegurl"
            aria-label={t`Import playlist`} onChange={(event) => void importFile(event)} />
          {current && <button type="button" className="tsugi-library-action" onClick={download}>
            <FiDownload aria-hidden /> <Trans>Export</Trans>
          </button>}
        </div>
      </header>
      {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
      {notice && <p role="status" className="text-sm text-[--tsugi-muted]">{notice}</p>}
      {localTracks.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-baseline justify-between gap-5">
            <h2 className="text-xl font-semibold"><Trans>Local audio — this session</Trans></h2>
            <p className="text-xs text-[--tsugi-muted]"><Trans>Reopen files after restarting Tsugi</Trans></p>
          </div>
          <div className="tsugi-music-shelf flex gap-4 overflow-x-auto pb-5">
            {localTracks.map(track => (
              <button type="button" key={track.id} onClick={() => onPlayLocal(track)}
                className="tsugi-local-track group w-48 shrink-0 border-b border-[--tsugi-line] pb-3 text-left">
                <FiDisc aria-hidden className="mb-3 size-8 text-[--tsugi-muted]" />
                <span className="block truncate text-sm font-medium">{track.title}</span>
                <span className="mt-1 block truncate text-xs text-[--tsugi-muted]">{track.artist}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      <div className="grid gap-12 lg:grid-cols-[minmax(230px,22%)_minmax(0,1fr)]">
        <aside>
          <h2 className="mb-5 text-xs font-semibold uppercase tracking-widest text-[--tsugi-muted]">
            <Trans>Playlists</Trans>
          </h2>
          <nav aria-label={t`Playlists`} className="space-y-1">
            {playlists.map(list => (
              <button key={list.id} type="button" onClick={() => setSelected(list.id)}
                aria-current={current?.id === list.id ? 'page' : undefined}
                className="tsugi-library-list-item flex w-full items-center gap-3 px-3 py-3 text-left">
                <FiList aria-hidden className="shrink-0 text-[--tsugi-muted]" />
                <span className="min-w-0 flex-1 truncate text-sm">{list.name}</span>
                <span className="text-xs tabular-nums text-[--tsugi-muted]">{list.tracks.length}</span>
              </button>
            ))}
          </nav>
          <form onSubmit={create} className="mt-6 flex items-end gap-3">
            <label className="min-w-0 flex-1">
              <span className="sr-only"><Trans>Playlist name</Trans></span>
              <input value={newName} maxLength={80} onChange={(e) => setNewName(e.target.value)}
                placeholder={t`New playlist`} className="tsugi-library-input w-full" />
            </label>
            <button type="submit" className="tsugi-icon-action" disabled={!newName.trim()}
              aria-label={t`Create playlist`}><FiPlus aria-hidden className="text-xl" /></button>
          </form>
        </aside>
        <div className="min-w-0">
          {!current ? (
            <div className="py-16">
              <FiDisc aria-hidden className="mb-5 text-4xl text-[--tsugi-muted]" />
              <h2 className="text-2xl font-semibold"><Trans>Build your own rotation</Trans></h2>
              <p className="mt-3 max-w-lg text-sm text-[--tsugi-muted]">
                <Trans>Create a playlist or import an M3U or Tsugi JSON collection to begin.</Trans>
              </p>
            </div>
          ) : (
            <>
              <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
                <div>
                  <h2 className="text-3xl font-semibold tracking-tight">{current.name}</h2>
                  <p className="mt-2 text-sm text-[--tsugi-muted]">
                    {current.tracks.length} <Trans>tracks</Trans>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  {playing && <button type="button" className="tsugi-library-action" onClick={addCurrent}>
                    <FiPlus aria-hidden /> <Trans>Add playing track</Trans>
                  </button>}
                  <button type="button" className="tsugi-library-action text-[--tsugi-muted]" onClick={removePlaylist}>
                    <FiTrash2 aria-hidden /> <Trans>Delete playlist</Trans>
                  </button>
                </div>
              </div>
              {current.tracks.length === 0 && <p className="py-10 text-sm text-[--tsugi-muted]">
                <Trans>No tracks yet. Save the playing track or import a playlist.</Trans>
              </p>}
              <ol className="tsugi-library-tracks">
                {current.tracks.map((track,index) => (
                  <li key={track.id + ':' + index} className="group flex items-center gap-3 border-b border-[--tsugi-line]">
                    <button type="button" onClick={() => onPlay(track)}
                      className="flex min-w-0 flex-1 items-center gap-4 py-3 text-left hover:text-[--tsugi-accent]">
                      <span className="w-6 shrink-0 text-right text-xs tabular-nums text-[--tsugi-muted]">{index + 1}</span>
                      {track.artworkURL ? <img src={track.artworkURL} alt="" loading="lazy"
                        referrerPolicy="no-referrer" className="size-11 object-cover" />
                        : <FiDisc aria-hidden className="size-10 p-2 text-[--tsugi-muted]" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{track.title}</span>
                        <span className="block truncate text-xs text-[--tsugi-muted]">{track.artist}</span>
                      </span>
                      <FiArrowUpRight aria-hidden className="text-[--tsugi-muted]" />
                    </button>
                    <button type="button" onClick={() => removeTrack(track)}
                      aria-label={t`Remove track from playlist`}
                      className="tsugi-icon-action opacity-60 group-hover:opacity-100">
                      <FiTrash2 aria-hidden />
                    </button>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
