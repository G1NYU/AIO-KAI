import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import {
  FiDisc, FiDownload, FiFilePlus, FiFolderPlus, FiList, FiPlus, FiRefreshCw, FiTrash2, FiClock, FiPlay, FiSearch,
} from 'react-icons/fi';
import type { RecentMusicPlay } from '@/lib/music/history';
import type { MusicPlaylist, SavedMusicTrack } from '@/lib/music/library';
import type { useRememberedMusicFolder } from './use-remembered-folder';
import {
  createMusicPlaylist, exportMusicPlaylist, importMusicPlaylist,
} from '@/lib/music/library';

export function MusicLibrary({
  playlists, onChange, onPlay, playing, localTracks, onImportLocal, onPlayLocal,
  folder, folderTracks, onChooseFolder, onRescanFolder, onForgetFolder, recent, onPlayRecent, activeTrackId,
}: {
  playlists: MusicPlaylist[];
  recent: RecentMusicPlay[];
  activeTrackId?: string;
  onPlayRecent(entry: RecentMusicPlay): void;
  onChange(next: MusicPlaylist[]): void;
  onPlay(track: SavedMusicTrack): void;
  playing: SavedMusicTrack | null;
  localTracks: SavedMusicTrack[];
  folderTracks: SavedMusicTrack[];
  folder: ReturnType<typeof useRememberedMusicFolder>;
  onChooseFolder(): void;
  onRescanFolder(): void;
  onForgetFolder(): void;
  onImportLocal(files: File[]): void;
  onPlayLocal(track: SavedMusicTrack): void;
}) {
  const [selected, setSelected] = React.useState<string>('local');
  const [filter, setFilter] = React.useState('');
  const [sort, setSort] = React.useState<'original' | 'title' | 'artist'>('original');
  const [newName, setNewName] = React.useState('');
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const localInputRef = React.useRef<HTMLInputElement>(null);
  const current = playlists.find((list) => list.id === selected);
  const localView = selected === 'local' || (!current && selected !== 'recent');
  const visibleRecent = selected === 'recent';
  const allLocal = [...folderTracks, ...localTracks];
  const matches = (track: SavedMusicTrack) => [track.title, track.artist, track.album].join(' ').toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase());
  const ordered = <T extends SavedMusicTrack,>(tracks: T[]) => {
    const result = tracks.filter(matches);
    return sort === 'original' ? result : result.sort((a, b) => a[sort].localeCompare(b[sort]));
  };
  const rows = ordered(localView ? allLocal : current?.tracks ?? []);
  const recentRows = recent.filter(entry => matches(entry.track));
  if (sort !== 'original') recentRows.sort((a, b) => a.track[sort].localeCompare(b.track[sort]));
  function choose(id: string) { setSelected(id); setFilter(''); }

  function create(event: React.FormEvent) {
    event.preventDefault();
    try {
      const next = createMusicPlaylist(newName);
      onChange([...playlists,next]);
      choose(next.id);
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
      choose(list.id);
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
    choose('local');
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

  function trackRow(track: SavedMusicTrack, key: string, play: () => void, removable = false, disabled = false) {
    return <li key={key} className="tsugi-collection-row" data-active={activeTrackId === track.id ? 'true' : 'false'}>
      <button type="button" className="tsugi-collection-play" onClick={play} disabled={disabled}>
        <span className="tsugi-collection-art">{track.artworkURL ? <img src={track.artworkURL} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <FiDisc aria-hidden />}</span>
        <span className="tsugi-collection-title"><strong>{track.title}</strong><small>{track.artist}</small></span>
        <span className="tsugi-collection-album">{track.album || '—'}</span>
        <span className="tsugi-track-duration">{typeof track.duration === 'number' ? Math.floor(track.duration / 60) + ':' + String(Math.floor(track.duration % 60)).padStart(2, '0') : '—'}</span>
        <FiPlay aria-hidden className="tsugi-collection-play-icon" />
      </button>
      {removable && <button type="button" className="tsugi-icon-action" onClick={() => removeTrack(track)} aria-label={t`Remove track from playlist`}><FiTrash2 aria-hidden /></button>}
    </li>;
  }
  return <section data-ui="tsugi-library" className="tsugi-library tsugi-collection">
    <header className="tsugi-collection-header">
      <h1><Trans>Library</Trans></h1>
      <div className="tsugi-collection-actions">
        <button type="button" className="tsugi-collection-primary" onClick={() => localInputRef.current?.click()}><FiFolderPlus aria-hidden /><Trans>Open local audio</Trans></button>
        <button type="button" className="tsugi-read-action" onClick={() => inputRef.current?.click()} disabled={busy}><FiFilePlus aria-hidden /><Trans>Import playlist</Trans></button>
      </div>
      <input ref={localInputRef} type="file" multiple accept="audio/*,.mp3,.m4a,.flac,.wav,.ogg" aria-label={t`Open local audio`} className="sr-only" onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; onImportLocal(files); }} />
      <input ref={inputRef} type="file" className="sr-only" accept=".json,.m3u,.m3u8,application/json,audio/x-mpegurl" aria-label={t`Import playlist`} onChange={event => void importFile(event)} />
    </header>
    {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
    {notice && <p role="status" className="text-sm text-[--tsugi-muted]">{notice}</p>}
    <div className="tsugi-collection-layout">
      <aside className="tsugi-collection-rail">
        <nav aria-label={t`Music collection`}>
          <button type="button" className="tsugi-library-list-item" aria-current={localView ? 'page' : undefined} onClick={() => choose('local')}><FiDisc aria-hidden /><span><Trans>Local music</Trans></span><small>{allLocal.length}</small></button>
          <button type="button" className="tsugi-library-list-item" aria-current={visibleRecent ? 'page' : undefined} onClick={() => choose('recent')}><FiClock aria-hidden /><span><Trans>Recently played</Trans></span><small>{recent.length}</small></button>
        </nav>
        <h2><Trans>Playlists</Trans></h2>
        <nav aria-label={t`Playlists`}>
          {playlists.map(list => <button key={list.id} type="button" className="tsugi-library-list-item" aria-current={current?.id === list.id ? 'page' : undefined} onClick={() => choose(list.id)}><FiList aria-hidden /><span>{list.name}</span><small>{list.tracks.length}</small></button>)}
        </nav>
        <form onSubmit={create} className="tsugi-collection-create">
          <input value={newName} maxLength={80} onChange={event => setNewName(event.target.value)} placeholder={t`New playlist`} aria-label={t`Playlist name`} className="tsugi-library-input" />
          <button type="submit" className="tsugi-icon-action" disabled={!newName.trim()} aria-label={t`Create playlist`}><FiPlus aria-hidden /></button>
        </form>
        <section className="tsugi-collection-folder">
          <h2><Trans>Music folder</Trans></h2>
          {folder.handle && <p className="truncate" title={folder.handle.name}>{folder.handle.name}</p>}
          {folder.supported && <button type="button" className="tsugi-library-action" disabled={folder.busy} onClick={onChooseFolder}><FiFolderPlus aria-hidden /><Trans>Remember music folder</Trans></button>}
          {folder.handle && <><button type="button" className="tsugi-library-action" disabled={folder.busy} onClick={onRescanFolder}><FiRefreshCw aria-hidden /><Trans>Rescan folder</Trans></button><button type="button" className="tsugi-library-action" disabled={folder.busy} onClick={onForgetFolder}><FiTrash2 aria-hidden /><Trans>Forget folder</Trans></button></>}
          {folder.busy && <p role="status"><Trans>Scanning music folder…</Trans></p>}
          {!folder.supported && <p><Trans>Remembered folders are unavailable in this desktop runtime.</Trans></p>}
          {!folder.busy && folder.status === 'permission' && <p role="status"><Trans>Folder access needs permission. Rescan to reconnect.</Trans></p>}
          {!folder.busy && folder.status === 'error' && <p role="alert"><Trans>Could not access the remembered music folder.</Trans></p>}
          {!folder.busy && folder.status === 'ready' && !folderTracks.length && <p><Trans>No supported audio files were found in this folder.</Trans></p>}
          {folder.truncated && <p><Trans>Folder scan limited to 1,000 tracks or 20,000 entries.</Trans></p>}
        </section>
      </aside>
      <div className="tsugi-collection-content">
        <div className="tsugi-collection-titlebar">
          <div><h2>{localView ? t`Local music` : visibleRecent ? t`Recently played` : current?.name}</h2><p>{localView ? allLocal.length : visibleRecent ? recent.length : current?.tracks.length ?? 0} <Trans>tracks</Trans>{localView && localTracks.length > 0 && <> · <Trans>Reopen session files after restarting Tsugi</Trans></>}</p></div>
          {current && <div className="tsugi-collection-actions">
            {playing && <button type="button" className="tsugi-read-action" onClick={addCurrent}><FiPlus aria-hidden /><Trans>Add playing track</Trans></button>}
            <button type="button" className="tsugi-read-action" onClick={download}><FiDownload aria-hidden /><Trans>Export</Trans></button>
            <button type="button" className="tsugi-read-action" onClick={removePlaylist}><FiTrash2 aria-hidden /><Trans>Delete playlist</Trans></button>
          </div>}
        </div>
        <div className="tsugi-collection-filter">
          <label><FiSearch aria-hidden /><input value={filter} onChange={event => setFilter(event.target.value)} placeholder={t`Find tracks`} aria-label={t`Find tracks`} /></label>
          <select aria-label={t`Sort tracks`} className="tsugi-read-input" value={sort} onChange={event => setSort(event.target.value as typeof sort)}><option value="original"><Trans>Original order</Trans></option><option value="title"><Trans>Title</Trans></option><option value="artist"><Trans>Artist</Trans></option></select>
        </div>
        {(visibleRecent ? recentRows.length : rows.length) > 0 ? <>
          <div className="tsugi-collection-columns"><span><Trans>Track</Trans></span><span><Trans>Album</Trans></span><span><Trans>Duration</Trans></span><span /></div>
          <ol className="tsugi-collection-tracks">
            {visibleRecent ? recentRows.map(entry => trackRow(entry.track, entry.sourceId + ':' + entry.track.id, () => onPlayRecent(entry))) : rows.map((track, index) => trackRow(track, track.id + ':' + index, () => localView ? onPlayLocal(track) : onPlay(track), !localView, localView && folder.busy && folderTracks.some(item => item.id === track.id)))}
          </ol>
        </> : <div className="tsugi-collection-empty">
          <FiDisc aria-hidden />
          <h3>{filter.trim() ? t`No matching tracks` : localView ? t`Add your music` : visibleRecent ? t`No recent tracks` : t`This playlist is empty`}</h3>
          <p>{filter.trim() ? t`Try a different title or artist.` : localView ? t`Open individual audio files or connect a music folder to browse your collection.` : visibleRecent ? t`Tracks you play from music sources will appear here.` : t`Save tracks from search or add the currently playing track.`}</p>
          {!filter.trim() && localView && <div className="tsugi-collection-actions"><button type="button" className="tsugi-collection-primary" onClick={() => localInputRef.current?.click()}><FiFolderPlus aria-hidden /><Trans>Open files</Trans></button>{folder.supported && <button type="button" className="tsugi-read-action" onClick={onChooseFolder} disabled={folder.busy}><Trans>Choose folder</Trans></button>}</div>}
          {!filter.trim() && current && playing && <button type="button" className="tsugi-read-action" onClick={addCurrent}><FiPlus aria-hidden /><Trans>Add playing track</Trans></button>}
        </div>}
      </div>
    </div>
  </section>;
}
