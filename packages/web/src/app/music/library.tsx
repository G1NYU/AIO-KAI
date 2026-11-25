import { BrushDisc as FiDisc, BrushDownload as FiDownload, BrushFile as FiFilePlus, BrushList as FiList, BrushPlus as FiPlus, BrushRefresh as FiRefreshCw, BrushTrash as FiTrash2, BrushHistory as FiClock, BrushPlay as FiPlay, BrushSearch as FiSearch } from '@/components/tsugi-icons';
import React from 'react';
import { BrushMusicLibrary, BrushFolder, BrushHeart } from '@/components/tsugi-icons';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { FiFolderPlus } from 'react-icons/fi';
import type { RecentMusicPlay } from '@/lib/music/history';
import type { MusicPlaylist, SavedMusicTrack } from '@/lib/music/library';
import type { useRememberedMusicFolder } from './use-remembered-folder';
import {
  createMusicPlaylist, exportMusicPlaylist, importMusicPlaylist,
} from '@/lib/music/library';

export function MusicLibrary({
  playlists, onChange, onPlay, playing, localTracks, onImportLocal, onPlayLocal,
  folder, folderTracks, onChooseFolder, onRescanFolder, onForgetFolder, recent, onPlayRecent, activeTrackId, navigation, onPlayLocalCollection, localRequest=0,
}: {
  navigation?: React.ReactNode;
  localRequest?: number;
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
  onPlayLocalCollection(tracks: SavedMusicTrack[]): void;
}) {
  const [selected, setSelected] = React.useState<string>('overview');
  const [filter, setFilter] = React.useState('');
  const [sort, setSort] = React.useState<'original' | 'title' | 'artist'>('original');
  const [newName, setNewName] = React.useState('');
  const [confirmDelete,setConfirmDelete]=React.useState(false);
  const [group,setGroup]=React.useState<string|null>(null);
  React.useEffect(()=>{if(localRequest){setSelected('local');setFilter('');setGroup(null);}},[localRequest]);
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const localInputRef = React.useRef<HTMLInputElement>(null);
  const current = playlists.find((list) => list.id === selected);
  const localView = selected === 'local';
  const overview=selected==='overview';
  const grouping=selected==='albums'||selected==='artists';
  const visibleRecent = selected === 'recent';
  const allLocal = [...folderTracks, ...localTracks];
  const matches = (track: SavedMusicTrack) => [track.title, track.artist, track.album].join(' ').toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase());
  const ordered = <T extends SavedMusicTrack,>(tracks: T[]) => {
    const result = tracks.filter(matches);
    return sort === 'original' ? result : result.sort((a, b) => a[sort].localeCompare(b[sort]));
  };
  const saved=[...new Map(playlists.flatMap(list=>list.tracks).map(track=>[(track.sourceId||'')+':'+track.id,track])).values()];
  const groups=new Map<string,SavedMusicTrack[]>();
  if(grouping)for(const track of saved){const name=selected==='albums'?track.album:track.artist;if(name)groups.set(name,[...(groups.get(name)||[]),track]);}
  const rows = ordered(localView ? allLocal : grouping?groups.get(group||'')||[]:current?.tracks ?? []);
  const recentRows = recent.filter(entry => matches(entry.track));
  if (sort !== 'original') recentRows.sort((a, b) => a.track[sort].localeCompare(b.track[sort]));
  function choose(id: string) { setSelected(id); setFilter('');setGroup(null);setConfirmDelete(false); }

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
    choose('overview');
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
  function cover(tracks:SavedMusicTrack[],fallback:React.ReactNode=<FiDisc aria-hidden/>){
    const artwork=[...new Set(tracks.flatMap(track=>track.artworkURL?[track.artworkURL]:[]))].slice(0,4);
    return <span className="tsugi-library-cover" data-mosaic={artwork.length===4}>{artwork.length?(artwork.length===4?artwork:artwork.slice(0,1)).map(url=><img key={url} src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={e=>{e.currentTarget.hidden=true;}}/>):fallback}</span>;
  }
  const navItems=[{id:'overview',label:t`Overview`,icon:BrushMusicLibrary,count:undefined},{id:'local',label:t`Local music`,icon:FiDisc,count:allLocal.length},{id:'albums',label:t`Albums`,icon:FiDisc,count:undefined},{id:'artists',label:t`Artists`,icon:FiList,count:undefined},{id:'recent',label:t`Recently played`,icon:FiClock,count:recent.length}];
  return <section data-ui="tsugi-library" className="tsugi-library tsugi-collection tsugi-library-v2">
    <header className="tsugi-collection-header">
      <div><p className="tsugi-vault-overline"><Trans>YOUR COLLECTION</Trans></p><h1><Trans>Library</Trans></h1></div>
      {navigation}
      <div className="tsugi-collection-actions">
        <button type="button" className="tsugi-collection-primary" onClick={()=>localInputRef.current?.click()}><FiFolderPlus aria-hidden/><Trans>Open local audio</Trans></button>
        <button type="button" className="tsugi-read-action" onClick={()=>inputRef.current?.click()} disabled={busy}><FiFilePlus aria-hidden/><Trans>Import playlist</Trans></button>
      </div>
      <input ref={localInputRef} type="file" multiple accept="audio/*,.mp3,.m4a,.flac,.wav,.ogg" aria-label={t`Open local audio`} className="sr-only" onChange={event=>{const files=Array.from(event.target.files??[]);event.target.value='';onImportLocal(files);}}/>
      <input ref={inputRef} type="file" className="sr-only" accept=".json,.m3u,.m3u8,application/json,audio/x-mpegurl" aria-label={t`Import playlist`} onChange={event=>void importFile(event)}/>
    </header>
    {error&&<p role="alert" className="text-sm text-amber-200">{error}</p>}{notice&&<p role="status" className="text-sm text-[--tsugi-muted]">{notice}</p>}
    <div className="tsugi-library-shell">
      <aside className="tsugi-library-sidebar">
        <nav aria-label={t`Music collection`}>{navItems.map(item=><button type="button" key={item.id} className="tsugi-library-nav" aria-current={selected===item.id?'page':undefined} onClick={()=>choose(item.id)}><item.icon aria-hidden/><span>{item.label}</span>{item.count!==undefined&&<small>{item.count}</small>}</button>)}</nav>
        <div className="tsugi-library-sidebar-head"><h2><Trans>Playlists</Trans></h2><button type="button" className="tsugi-icon-action" title={t`New playlist`} aria-label={t`New playlist`} onClick={()=>document.getElementById('tsugi-new-playlist')?.focus()}><FiPlus aria-hidden/></button></div>
        <nav aria-label={t`Playlists`}>{playlists.map(list=><button key={list.id} type="button" className="tsugi-library-nav tsugi-library-playlist-nav" aria-current={current?.id===list.id?'page':undefined} onClick={()=>choose(list.id)}>{cover(list.tracks,<BrushHeart aria-hidden/>)}<span>{list.name}</span><small>{list.tracks.length}</small></button>)}</nav>
        <form onSubmit={create} className="tsugi-collection-create"><input id="tsugi-new-playlist" value={newName} maxLength={80} onChange={event=>setNewName(event.target.value)} placeholder={t`New playlist`} aria-label={t`Playlist name`} className="tsugi-library-input"/><button type="submit" className="tsugi-icon-action" disabled={!newName.trim()} aria-label={t`Create playlist`}><FiPlus aria-hidden/></button></form>
        <section className="tsugi-library-folder"><BrushFolder aria-hidden/><div><strong><Trans>Music folder</Trans></strong><p title={folder.handle?.name}>{folder.handle?.name||t`No folder selected`}</p></div>
          {folder.supported&&<button type="button" className="tsugi-read-action" disabled={folder.busy} onClick={onChooseFolder}><FiFolderPlus aria-hidden/>{folder.handle?<Trans>Change folder</Trans>:<Trans>Remember music folder</Trans>}</button>}
          {folder.handle&&<div className="tsugi-collection-actions"><button type="button" className="tsugi-icon-action" aria-label={t`Rescan folder`} title={t`Rescan folder`} disabled={folder.busy} onClick={onRescanFolder}><FiRefreshCw aria-hidden/></button><button type="button" className="tsugi-icon-action" aria-label={t`Forget folder`} title={t`Forget folder`} disabled={folder.busy} onClick={onForgetFolder}><FiTrash2 aria-hidden/></button></div>}
          {folder.busy&&<p role="status"><Trans>Scanning music folder…</Trans></p>}{!folder.busy&&folder.status==='permission'&&<p role="status"><Trans>Rescan to reconnect folder access.</Trans></p>}{!folder.busy&&folder.status==='error'&&<p role="alert"><Trans>Could not access the remembered music folder.</Trans></p>}{folder.truncated&&<p><Trans>Folder scan limited to 1,000 tracks or 20,000 entries.</Trans></p>}
        </section>
      </aside>
      <div className="tsugi-library-main">
        {overview?<div className="tsugi-library-overview">
          <div className="tsugi-library-intro"><div><p className="tsugi-vault-overline"><Trans>LIBRARY OVERVIEW</Trans></p><h2><Trans>Your music, organized.</Trans></h2><p><Trans>Browse your files, saved collections and listening history.</Trans></p><div className="tsugi-collection-actions"><button type="button" className="tsugi-collection-primary" onClick={()=>choose('local')}><FiDisc aria-hidden/><Trans>Browse local music</Trans></button>{folder.supported&&<button type="button" className="tsugi-read-action" disabled={folder.busy} onClick={onChooseFolder}><FiFolderPlus aria-hidden/><Trans>Choose folder</Trans></button>}</div></div><div className="tsugi-library-metrics"><span><strong>{allLocal.length}</strong><Trans>Local tracks</Trans></span><span><strong>{playlists.length}</strong><Trans>Playlists</Trans></span><span><strong>{recent.length}</strong><Trans>Recent tracks</Trans></span></div></div>
          <section><div className="tsugi-library-section-head"><h3><Trans>Playlists</Trans></h3><button type="button" className="tsugi-vault-quiet" onClick={()=>document.getElementById('tsugi-new-playlist')?.focus()}><Trans>Create playlist</Trans></button></div>
          <div className="tsugi-library-card-grid">{playlists.map(list=><button key={list.id} type="button" className="tsugi-library-card" onClick={()=>choose(list.id)}>{cover(list.tracks,<BrushHeart aria-hidden/>)}<strong>{list.name}</strong><small>{list.tracks.length} <Trans>tracks</Trans></small></button>)}{!playlists.length&&<button type="button" className="tsugi-library-card" onClick={()=>document.getElementById('tsugi-new-playlist')?.focus()}>{cover([],<FiPlus aria-hidden/>)}<strong><Trans>New playlist</Trans></strong><small><Trans>Start a collection</Trans></small></button>}</div></section>
          <section><div className="tsugi-library-section-head"><h3><Trans>Recently played</Trans></h3><button type="button" className="tsugi-vault-quiet" onClick={()=>choose('recent')}><Trans>View history</Trans></button></div>{recent.length?<div className="tsugi-library-card-grid">{recent.slice(0,8).map((entry,i)=><button type="button" className="tsugi-library-card" key={entry.sourceId+':'+entry.track.id+':'+i} onClick={()=>onPlayRecent(entry)}>{cover([entry.track])}<strong>{entry.track.title}</strong><small>{entry.track.artist}</small></button>)}</div>:<p className="tsugi-library-muted"><Trans>Play something to build your listening history.</Trans></p>}</section>
        </div>:grouping&&!group?<><div className="tsugi-library-section-head"><h2>{selected==='albums'?t`Albums`:t`Artists`}</h2><span className="tsugi-library-muted">{groups.size} <Trans>from saved tracks</Trans></span></div>
          {groups.size?<div className="tsugi-library-card-grid">{[...groups].sort(([a],[b])=>a.localeCompare(b)).map(([name,tracks])=><button key={name} type="button" className="tsugi-library-card" onClick={()=>{setGroup(name);setFilter('');}}>{cover(tracks)}<strong>{name}</strong><small>{tracks.length} <Trans>tracks</Trans></small></button>)}</div>:<div className="tsugi-library-empty"><FiDisc aria-hidden/><h3><Trans>No saved collections yet</Trans></h3><p><Trans>Save tracks with album or artist information to browse them here.</Trans></p><button type="button" className="tsugi-read-action" onClick={()=>choose('overview')}><Trans>Back to overview</Trans></button></div>}</>:<>
          {grouping&&<button type="button" className="tsugi-vault-quiet" onClick={()=>setGroup(null)}><Trans>Back to collections</Trans></button>}
          <div className="tsugi-library-detail-head">{cover(localView?allLocal:visibleRecent?recent.map(e=>e.track):grouping?groups.get(group||'')||[]:current?.tracks||[],localView?<BrushFolder aria-hidden/>:<FiDisc aria-hidden/>)}<div><p className="tsugi-vault-overline">{current?t`PLAYLIST`:localView?t`LOCAL LIBRARY`:visibleRecent?t`HISTORY`:t`COLLECTION`}</p><h2>{localView?t`Local music`:visibleRecent?t`Recently played`:grouping?group:current?.name}</h2><p>{localView?allLocal.length:visibleRecent?recent.length:grouping?groups.get(group||'')?.length||0:current?.tracks.length||0} <Trans>tracks</Trans></p>
          <div className="tsugi-collection-actions">{localView&&rows.length>0&&<button type="button" className="tsugi-collection-primary" onClick={()=>onPlayLocalCollection(rows)}><FiPlay aria-hidden/><Trans>Play all</Trans></button>}{localView&&folder.supported&&<button type="button" className="tsugi-read-action" onClick={onChooseFolder} disabled={folder.busy}><FiFolderPlus aria-hidden/><Trans>Choose folder</Trans></button>}{current&&playing&&<button type="button" className="tsugi-read-action" onClick={addCurrent}><FiPlus aria-hidden/><Trans>Add playing track</Trans></button>}{current&&<><button type="button" className="tsugi-read-action" onClick={download}><FiDownload aria-hidden/><Trans>Export</Trans></button><button type="button" className="tsugi-read-action" onClick={()=>setConfirmDelete(v=>!v)}><FiTrash2 aria-hidden/><Trans>Delete playlist</Trans></button></>}</div>{confirmDelete&&current&&<div className="tsugi-collection-actions"><span><Trans>Remove this playlist?</Trans></span><button type="button" className="tsugi-read-action" onClick={removePlaylist}><Trans>Confirm deletion</Trans></button><button type="button" className="tsugi-read-action" onClick={()=>setConfirmDelete(false)}><Trans>Cancel</Trans></button></div>}</div></div>
          <div className="tsugi-collection-filter"><label><FiSearch aria-hidden/><input value={filter} onChange={event=>setFilter(event.target.value)} placeholder={t`Find tracks`} aria-label={t`Find tracks`}/></label><select aria-label={t`Sort tracks`} className="tsugi-read-input" value={sort} onChange={event=>setSort(event.target.value as typeof sort)}><option value="original"><Trans>Original order</Trans></option><option value="title"><Trans>Title</Trans></option><option value="artist"><Trans>Artist</Trans></option></select></div>
          {(visibleRecent?recentRows.length:rows.length)>0?<><div className="tsugi-collection-columns"><span><Trans>Track</Trans></span><span><Trans>Album</Trans></span><span><Trans>Duration</Trans></span><span/></div><ol className="tsugi-collection-tracks">{visibleRecent?recentRows.map(entry=>trackRow(entry.track,entry.sourceId+':'+entry.track.id,()=>onPlayRecent(entry))):rows.map((track,index)=>trackRow(track,track.id+':'+index,()=>localView?onPlayLocal(track):onPlay(track),!!current,localView&&folder.busy&&folderTracks.some(item=>item.id===track.id)))}</ol></>:<div className="tsugi-library-empty"><FiDisc aria-hidden/><h3>{filter.trim()?t`No matching tracks`:localView?t`Add your music`:visibleRecent?t`No recent tracks`:t`This playlist is empty`}</h3><p>{filter.trim()?t`Try another search.`:localView?t`Open files or choose a music folder. Your files stay on your device.`:t`Save tracks from search to build your collection.`}</p>{localView&&!filter.trim()&&<button type="button" className="tsugi-collection-primary" onClick={()=>localInputRef.current?.click()}><FiFolderPlus aria-hidden/><Trans>Open files</Trans></button>}</div>}
        </>}
      </div>
    </div>
  </section>;
}
