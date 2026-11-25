import { useEffect, useRef, useState } from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { appBridge } from '@/lib/hosts/shell/bridge';
import { shellDownloads } from '@/lib/hosts/shell/downloads';
import type { HostEvent } from '@/lib/downloads/types';
import { vaultJob, youtubeVaultJob, detectVaultSource, vaultBatch } from './native-job';
import { settings, useSetting } from '@/lib/settings';
import { BrushBook, BrushDisc, BrushFolder, BrushPause, BrushPlay } from '@/components/tsugi-icons';
import { TorBoxPanel } from './torbox-panel';
import { VaultProviders } from './providers';
import { vaultTransferRate, vaultEta, reconcileVaultRows } from './queue-model';
import { importBook } from '@/app/read/book-library';
import { useDesktopArea } from '@/lib/desktop-area';
import { readCompletedVaultFile } from './completed-file';

type Row = Extract<HostEvent, {type:'state'}>['jobs'][number] & {speed?:number};
type Filter = 'all'|'active'|'queued'|'done'|'cloud'|'providers';
const newId = () => ['vault',Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('')].join('-');
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
  const [pending,setPending] = useState<string[]>([]);
  const [batch,setBatch] = useState(false);
  const [filter,setFilter] = useState<Filter>('all');
  const [concurrent,setConcurrent] = useSetting(settings.downloads.concurrent);
  const [rate,setRate] = useState<number|undefined>();
  const [engineAvailable,setEngineAvailable] = useState<boolean|undefined>();
  const [wifiOnly] = useSetting(settings.downloads.wifiOnly);
  const pendingCount=pending.length;
  useEffect(()=>{
    if(!supported)return;
    const stop = shellDownloads.subscribe(event=>{
      if(event.type==='state') {
        setRows(old=>reconcileVaultRows(old,event.jobs.filter(job=>job.id.startsWith('vault-') && typeof job.vault_title==='string')));
        setFolder(event.folder);setRate(event.vault_rate_mib);setEngineAvailable(event.aria2_available);setReady(true);
      } else if(event.id.startsWith('vault-')) setRows(old=>old.map(row=>row.id===event.id?{...row,bytes:event.bytes,total:event.total,speed:row.state==='downloading'?event.speed:0}:row));
    });
    shellDownloads.list();
    return stop;
  },[supported]);
  useEffect(()=>{
    if(!pending.length)return;
    if(pending.every(id=>rows.some(row=>row.id===id))) { setPending([]);setInput('');setTrackTitle('');setPermission(false); }
  },[rows,pending]);
  useEffect(()=>{
    if(!pending.length)return;
    const timer=window.setTimeout(()=>{setPending([]);setPermission(false);setError(t`Not all downloads were acknowledged. Check the queue before retrying any missing links.`);shellDownloads.list();},8000);
    return ()=>window.clearTimeout(timer);
  },[pending]);
  function enqueue() {
    if(!ready||!permission||pendingCount)return;
    setError('');
    try {
      const jobs=batch?vaultBatch(input,newId):[mode==='youtube'?youtubeVaultJob(input,newId(),trackTitle):vaultJob(input,newId())];
      setPending(jobs.map(job=>job.id));setFilter('all');shellDownloads.add(jobs);
    } catch { setPending([]);setError(batch?t`Use one supported HTTPS file or single YouTube track per line (up to 20). No downloads were added.`:mode==='youtube'?t`Paste a YouTube video or music track link containing a video ID. Playlist-only links are not supported.`:t`Enter a supported direct HTTPS file URL without query parameters or fragments.`); }
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
  const active=rows.filter(row=>row.state==='downloading');
  const queued=rows.filter(row=>row.state==='queued');
  const done=rows.filter(row=>row.state==='done');
  const speed=active.reduce((sum,row)=>sum+(row.speed||0),0);
  const visible=rows.filter(row=>filter==='all'||(filter==='active'&&row.state==='downloading')||(filter==='queued'&&['queued','paused','failed'].includes(row.state))||(filter==='done'&&row.state==='done'));
  const tabs:{id:Filter;label:string;count?:number}[]=[
    {id:'all',label:t`All downloads`,count:rows.length},{id:'active',label:t`Active`,count:active.length},
    {id:'queued',label:t`Waiting`,count:rows.length-active.length-done.length},{id:'done',label:t`Completed`,count:done.length},{id:'cloud',label:t`Cloud · TorBox`},{id:'providers',label:t`Providers`}
  ];
  return <section data-ui="tsugi-native-vault-queue" className="tsugi-vault-manager">
    <h2><Trans>Local downloads</Trans></h2>
    <p><Trans>One queue for your books, audio files and authorized music exports.</Trans></p>
    {!supported?<p><Trans>Native Vault downloads require the Windows desktop application.</Trans></p>:<>
      <div className="tsugi-vault-overview">
        <div><span><Trans>Downloading</Trans></span><strong>{active.length}</strong></div>
        <div><span><Trans>Queued</Trans></span><strong>{queued.length}</strong></div>
        <div><span><Trans>Completed</Trans></span><strong>{done.length}</strong></div>
        <div><span><Trans>Local transfer speed</Trans></span><strong>{vaultTransferRate(speed)}</strong></div>
      </div>
      <form className="tsugi-vault-form tsugi-vault-intake" onSubmit={event=>{event.preventDefault();enqueue();}}>
        <div className="tsugi-vault-actions"><button type="button" className="tsugi-read-action" aria-pressed={!batch} disabled={!!pendingCount} onClick={()=>{setBatch(false);setInput('');setPermission(false);setTrackTitle('');}}><Trans>Single link</Trans></button><button type="button" className="tsugi-read-action" aria-pressed={batch} disabled={!!pendingCount} onClick={()=>{setBatch(true);setInput('');setPermission(false);setTrackTitle('');}}><Trans>Batch links</Trans></button></div>
        {batch?<label><Trans>Download links (one per line)</Trans><textarea rows={4} maxLength={40000} value={input} disabled={!!pendingCount} onChange={event=>{setInput(event.target.value);setPermission(false);setError('');}}/></label>:<>
        <label><Trans>Download source</Trans><select className="tsugi-read-input" value={mode} disabled={!!pendingCount} onChange={event=>{setMode(event.target.value==='youtube'?'youtube':'file');setInput('');setTrackTitle('');setPermission(false);setError('');}}><option value="file"><Trans>Direct book or audio link</Trans></option><option value="youtube"><Trans>YouTube Music</Trans></option></select></label>
        <label>{mode==='youtube'?<Trans>YouTube Music track link</Trans>:<Trans>Public file URL</Trans>}<input type="url" required value={input} disabled={!!pendingCount} onChange={event=>{setInput(event.target.value);setMode(detectVaultSource(event.target.value));setTrackTitle('');setPermission(false);setError('');}}/></label>
        {mode==='youtube'&&trackTitle&&<p>{trackTitle}</p>}
        {mode==='youtube'&&<p><Trans>Save available M4A audio for tracks you are permitted to export (up to 64 MiB).</Trans></p>}</>}
        <label><span><input type="checkbox" style={{width:'auto'}} checked={permission} disabled={!!pendingCount} onChange={event=>setPermission(event.target.checked)}/> <Trans>I have permission to download this file or track. Its public URL will be stored in the local download queue.</Trans></span></label>
        <div className="tsugi-vault-actions">
          <button type="submit" className="tsugi-read-action tsugi-series-primary" disabled={!ready||!permission||!input.trim()||!!pendingCount}>{batch?<Trans>Add batch to queue</Trans>:<Trans>Queue local download</Trans>}</button>
          <button type="button" className="tsugi-read-action" onClick={()=>shellDownloads.list()}><Trans>Refresh local downloads</Trans></button>
          {shellDownloads.folder&&<button type="button" className="tsugi-read-action" onClick={()=>shellDownloads.folder?.choose()}><Trans>Choose download folder</Trans></button>}
        </div>
      </form>
      <div className="tsugi-vault-queue-tools"><label><Trans>Simultaneous local downloads</Trans><select className="tsugi-read-input" value={Math.min(4,Math.max(1,concurrent))} onChange={event=>{const value=Number(event.target.value);setConcurrent(value);shellDownloads.configure({concurrent:value,wifiOnly});}}>{[1,2,3,4].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
      <button type="button" className="tsugi-read-action" disabled={!active.length&&!queued.length} onClick={()=>rows.filter(row=>row.state==='queued'||row.state==='downloading').forEach(row=>shellDownloads.control(row.id,'pause'))}><BrushPause aria-hidden/><Trans>Pause all</Trans></button>
      <button type="button" className="tsugi-read-action" disabled={!rows.some(row=>row.state==='paused')} onClick={()=>rows.filter(row=>row.state==='paused').forEach(row=>shellDownloads.control(row.id,'resume'))}><BrushPlay aria-hidden/><Trans>Resume all</Trans></button></div>
      {rate!==undefined&&<div className="tsugi-vault-queue-tools"><label><Trans>Local transfer speed limit (MiB/s)</Trans><select className="tsugi-read-input" value={rate} onChange={event=>appBridge()?.send({type:'vault-rate',mib:Number(event.target.value)})}><option value={0}><Trans>Unlimited</Trans></option>{[1,2,4,8,16].map(n=><option value={n} key={n}>{n}</option>)}</select></label><p><Trans>Per direct-file or Aria2-managed music transfer, applied when a job starts or resumes. Compatibility music exports, cloud and video downloads are unaffected.</Trans></p></div>}
      {folder&&<p className="tsugi-vault-saved-path"><Trans>Download folder:</Trans> {folder}</p>}
      <nav className="tsugi-vault-tabs" aria-label={t`Download views`}>{tabs.map(tab=><button type="button" key={tab.id} className="tsugi-read-action" aria-pressed={filter===tab.id} onClick={()=>setFilter(tab.id)}>{tab.label}{tab.count!==undefined&&<span>{tab.count}</span>}</button>)}</nav>
      <div className="tsugi-pixel-rule" aria-hidden="true"/>
      {!ready&&<p role="status"><Trans>Waiting for the desktop download manager.</Trans></p>}
      {!!pendingCount&&<p role="status"><Trans>Adding download…</Trans></p>}
      {importing&&<p role="status"><Trans>Importing completed file…</Trans></p>}
      {error&&<p role="alert">{error}</p>}
      {filter==='providers'?<VaultProviders engineAvailable={engineAvailable}/>:filter==='cloud'?<TorBoxPanel/>:<>
      {ready&&visible.length===0&&<div className="tsugi-vault-empty"><BrushFolder aria-hidden/><p><Trans>No downloads in this view.</Trans></p></div>}
      {visible.map(row=><div className="tsugi-vault-file-row tsugi-vault-task" key={row.id}>
        <div className="tsugi-vault-task-main">{/\.(epub|pdf)$/i.test(row.vault_title||'')?<BrushBook aria-hidden/>:<BrushDisc aria-hidden/>}<div className="tsugi-vault-task-text"><strong>{row.vault_title}</strong><p><span className="tsugi-vault-task-state" data-state={row.state}>{status(row)}</span> · {(row.bytes/1048576).toFixed(1)} MiB {row.total!==null&&row.total>0&&<span>/ {(row.total/1048576).toFixed(1)} MiB</span>}</p>
          {(row.state==='downloading'||row.total!==null&&row.total>0)&&<progress aria-label={t`Download progress`} max={row.total||undefined} value={row.total?Math.min(row.bytes,row.total):undefined}/>}
          {row.state==='downloading'&&<p className="tsugi-vault-task-rate">{row.speed? <>{vaultTransferRate(row.speed)}{vaultEta(row.bytes,row.total,row.speed)!==null&&<> · {vaultEta(row.bytes,row.total,row.speed)} <Trans>sec remaining</Trans></>}</>:<Trans>Preparing or waiting for data…</Trans>}</p>}
          {row.error&&<p role="alert">{row.error}</p>}
          {row.vault_path&&<p className="tsugi-vault-saved-path">{row.vault_path}</p>}
        </div></div>
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
    </>}
  </section>;
}
