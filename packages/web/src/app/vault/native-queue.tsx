import { useEffect, useRef, useState } from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { appBridge } from '@/lib/hosts/shell/bridge';
import { shellDownloads } from '@/lib/hosts/shell/downloads';
import type { HostEvent } from '@/lib/downloads/types';
import { vaultJob, youtubeVaultJob, detectVaultSource } from './native-job';
import { importBook } from '@/app/read/book-library';
import { useDesktopArea } from '@/lib/desktop-area';
import { readCompletedVaultFile } from './completed-file';

type Row = Extract<HostEvent, {type:'state'}>['jobs'][number];
function status(row: Row) {
  switch(row.state) {
    case 'queued': return t`Queued`;
    case 'downloading': return t`Downloading`;
    case 'paused': return t`Paused`;
    case 'failed': return t`Failed`;
    case 'done': return t`Complete`;
  }
}

export function NativeVaultQueue({track=null}:{track?:{id:string;title:string}|null}) {
  const actions=useDesktopArea();
  const activeImport=useRef<AbortController|null>(null);
  const [importing,setImporting]=useState('');
  useEffect(()=>()=>activeImport.current?.abort(),[]);
  const supported = appBridge()?.platform === 'windows';
  const [ready,setReady] = useState(false);
  const [input,setInput] = useState(()=>{
    if(!track)return '';
    const url=new URL('https://www.youtube.com/watch');url.searchParams.set('v',track.id);return url.href;
  });
  const [trackTitle,setTrackTitle] = useState(track?.title || '');
  const [mode,setMode] = useState<'file'|'youtube'>(track?'youtube':'file');
  const [permission,setPermission] = useState(false);
  const [rows,setRows] = useState<Row[]>([]);
  const [folder,setFolder] = useState('');
  const [error,setError] = useState('');
  const [pending,setPending] = useState('');
  useEffect(()=>{
    if(!supported)return;
    const stop = shellDownloads.subscribe(event=>{
      if(event.type==='state') {
        setRows(event.jobs.filter(job=>job.id.startsWith('vault-') && typeof job.vault_title==='string'));
        setFolder(event.folder);setReady(true);
      } else if(event.id.startsWith('vault-')) setRows(old=>old.map(row=>row.id===event.id?{...row,bytes:event.bytes,total:event.total}:row));
    });
    shellDownloads.list();
    return stop;
  },[supported]);
  useEffect(()=>{
    if(!pending)return;
    const row = rows.find(row=>row.id===pending);
    if(row) { setPending('');setInput('');setTrackTitle('');setPermission(false); }
  },[rows,pending]);
  useEffect(()=>{
    if(!pending)return;
    const timer=window.setTimeout(()=>{setPending('');setError(t`The desktop did not acknowledge this job. Refresh the list before retrying.`);},8000);
    return ()=>window.clearTimeout(timer);
  },[pending]);
  function enqueue() {
    if(!ready||!permission||pending)return;
    setError('');
    try {
      const id = 'vault-' + Array.from(crypto.getRandomValues(new Uint8Array(16)), n=>n.toString(16).padStart(2,'0')).join('');
      const job=mode==='youtube'?youtubeVaultJob(input,id,trackTitle):vaultJob(input,id);
      setPending(id);shellDownloads.add([job]);
    } catch { setPending('');setError(mode==='youtube'?t`Paste a YouTube video or music track link containing a video ID. Playlist-only links are not supported.`:t`Enter a supported direct HTTPS file URL without query parameters or fragments.`); }
  }
  async function openCompleted(row:Row) {
    if(activeImport.current||row.state!=='done'||!row.vault_title)return;
    const controller=new AbortController();activeImport.current=controller;setImporting(row.id);setError('');
    try {
      const file=await readCompletedVaultFile(row.id,row.vault_title,controller.signal);
      controller.signal.throwIfAborted();
      if(/\.(pdf|epub)$/i.test(file.name)){
        await importBook(file,row.id);controller.signal.throwIfAborted();actions?.openBooks?.();
      }else actions?.openLocalAudio?.(file);
    }catch{if(!controller.signal.aborted)setError(t`Could not import the completed file. It may have been moved, removed or exceeded 128 MiB.`);}
    finally{activeImport.current=null;setImporting('');}
  }
  return <section data-ui="tsugi-native-vault-queue">
    <h2><Trans>Local downloads</Trans></h2>
    <p><Trans>Paste a book, audio file or YouTube track link. Downloads are saved to your selected folder and remain in your queue.</Trans></p>
    {!supported?<p><Trans>Native Vault downloads require the Windows desktop application.</Trans></p>:<>
      <form className="tsugi-vault-form" onSubmit={event=>{event.preventDefault();enqueue();}}>
        <label><Trans>Download source</Trans><select className="tsugi-read-input" value={mode} disabled={!!pending} onChange={event=>{setMode(event.target.value==='youtube'?'youtube':'file');setInput('');setTrackTitle('');setPermission(false);setError('');}}><option value="file"><Trans>Direct book or audio link</Trans></option><option value="youtube"><Trans>YouTube Music</Trans></option></select></label>
        <label>{mode==='youtube'?<Trans>YouTube Music track link</Trans>:<Trans>Public file URL</Trans>}<input type="url" required value={input} disabled={!!pending} onChange={event=>{setInput(event.target.value);setMode(detectVaultSource(event.target.value));setTrackTitle('');setPermission(false);setError('');}}/></label>
        {mode==='youtube'&&trackTitle&&<p>{trackTitle}</p>}
        {mode==='youtube'&&<p><Trans>For tracks you own or are permitted to export. Saves the original available M4A audio without conversion, up to 64 MiB. Availability depends on the source.</Trans></p>}
        <label><span><input type="checkbox" style={{width:'auto'}} checked={permission} disabled={!!pending} onChange={event=>setPermission(event.target.checked)}/> <Trans>I have permission to download this file or track. Its public URL will be stored in the local download queue.</Trans></span></label>
        <div className="tsugi-vault-actions">
          <button type="submit" className="tsugi-read-action tsugi-series-primary" disabled={!ready||!permission||!input.trim()||!!pending}><Trans>Queue local download</Trans></button>
          <button type="button" className="tsugi-read-action" onClick={()=>shellDownloads.list()}><Trans>Refresh local downloads</Trans></button>
          {shellDownloads.folder&&<button type="button" className="tsugi-read-action" onClick={()=>shellDownloads.folder?.choose()}><Trans>Choose download folder</Trans></button>}
        </div>
      </form>
      {folder&&<p><Trans>Download folder:</Trans> {folder}</p>}
      {!ready&&<p role="status"><Trans>Waiting for the desktop download manager.</Trans></p>}
      {pending&&<p role="status"><Trans>Adding download…</Trans></p>}
      {importing&&<p role="status"><Trans>Importing completed file…</Trans></p>}
      {error&&<p role="alert">{error}</p>}
      {ready&&rows.length===0&&<p><Trans>No persistent Vault downloads yet.</Trans></p>}
      {rows.map(row=><div className="tsugi-vault-file-row" key={row.id}>
        <div><strong>{row.vault_title}</strong><p>{status(row)} · {(row.bytes/1048576).toFixed(1)} MiB</p>
          {row.total!==null&&row.total>0&&<progress max={row.total} value={Math.min(row.bytes,row.total)}/>}
          {row.error&&<p role="alert">{row.error}</p>}
          {row.vault_path&&<p className="tsugi-vault-saved-path">{row.vault_path}</p>}
        </div>
        <div className="tsugi-vault-actions">
          {(row.state==='queued'||row.state==='downloading')&&<button className="tsugi-read-action" onClick={()=>shellDownloads.control(row.id,'pause')}><Trans>Pause</Trans></button>}
          {row.state==='paused'&&<button className="tsugi-read-action" onClick={()=>shellDownloads.control(row.id,'resume')}><Trans>Resume</Trans></button>}
          {row.state==='failed'&&<button className="tsugi-read-action" onClick={()=>shellDownloads.control(row.id,'retry')}><Trans>Retry</Trans></button>}
          {row.state!=='done'&&<button className="tsugi-read-action" onClick={()=>shellDownloads.remove(row.id,true)}><Trans>Cancel</Trans></button>}
          {row.state==='done'&&<button className="tsugi-read-action" onClick={()=>shellDownloads.remove(row.id,false)}><Trans>Remove from list</Trans></button>}
          {row.state==='done'&&row.vault_title&&<button className="tsugi-read-action" disabled={!!importing||(/\.(epub|pdf)$/i.test(row.vault_title)?!actions?.openBooks:!actions?.openLocalAudio)} onClick={()=>void openCompleted(row)}>{/\.(epub|pdf)$/i.test(row.vault_title)?<Trans>Import into Books</Trans>:<Trans>Open in Music</Trans>}</button>}
          {row.state==='done'&&shellDownloads.folder?.open&&<button className="tsugi-read-action" onClick={()=>shellDownloads.folder?.open?.(row.id)}><Trans>Show in folder</Trans></button>}
        </div>
      </div>)}
    </>}
  </section>;
}
