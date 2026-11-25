import { useEffect, useRef, useState } from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { appBridge } from '@/lib/hosts/shell/bridge';
import { shellDownloads } from '@/lib/hosts/shell/downloads';
import type { HostEvent } from '@/lib/downloads/types';
import { vaultJob, youtubeVaultJob, detectVaultSource, vaultBatch } from './native-job';
import { settings, useSetting } from '@/lib/settings';
import { BrushBook, BrushDisc, BrushFolder, BrushPause, BrushPlay, BrushDownload, BrushRefresh, BrushTrash, BrushSettings, BrushList, BrushCheck, BrushPlug } from '@/components/tsugi-icons';
import { TorBoxPanel } from './torbox-panel';
import { nativeTorBox, supportsNativeTorBox } from './native-torbox';
import { vaultTransferRate, vaultEta, reconcileVaultRows } from './queue-model';
import { importBook } from '@/app/read/book-library';
import { useDesktopArea } from '@/lib/desktop-area';
import { readCompletedVaultFile } from './completed-file';

type Row = Extract<HostEvent, {type:'state'}>['jobs'][number] & {speed?:number};
type Filter = 'all'|'active'|'queued'|'done';
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
  const [destination,setDestination]=useState<'local'|'torbox'>('local');
  const [torboxConnected,setTorboxConnected]=useState<boolean|null>(null);
  const [samples,setSamples]=useState<number[]>([]);
  const [kind,setKind]=useState<'all'|'audio'|'books'>('all');
  useEffect(()=>{let alive=true;if(supportsNativeTorBox())void nativeTorBox('status').then(result=>{if(alive)setTorboxConnected(result.connected);}).catch(()=>{});return()=>{alive=false;};},[]);
  const [showHelp,setShowHelp]=useState(()=>{try{return localStorage.getItem('tsugi.vault.intro')!=='seen';}catch{return true;}});
  function dismissHelp(){setShowHelp(false);try{localStorage.setItem('tsugi.vault.intro','seen');}catch{/* session only */}}
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
  const currentSpeed=useRef(speed);currentSpeed.current=speed;
  useEffect(()=>{const timer=window.setInterval(()=>setSamples(old=>[...old.slice(-29),currentSpeed.current]),2000);return()=>window.clearInterval(timer);},[]);
  const visible=rows.filter(row=>(filter==='all'||(filter==='active'&&row.state==='downloading')||(filter==='queued'&&['queued','paused','failed'].includes(row.state))||(filter==='done'&&row.state==='done'))&&(kind==='all'||(/\.(pdf|epub)$/i.test(row.vault_title||'')?kind==='books':kind==='audio')));
  const completedBytes=done.reduce((sum,row)=>sum+row.bytes,0);
  const maximum=Math.max(1,...samples);
  const tabs:{id:Filter;label:string;count?:number}[]=[
    {id:'all',label:t`All downloads`,count:rows.length},{id:'active',label:t`Active`,count:active.length},
    {id:'queued',label:t`Waiting`,count:rows.length-active.length-done.length},{id:'done',label:t`Completed`,count:done.length}
  ];
  return <section data-ui="tsugi-native-vault-queue" className="tsugi-vault-manager tsugi-vault-workspace">
    {!supported?<p><Trans>Native Vault downloads require the Windows desktop application.</Trans></p>:<>
      <aside className="tsugi-dashboard-left"><h2><Trans>Downloads</Trans></h2><nav aria-label={t`Download views`}>{tabs.map(tab=><button type="button" key={tab.id} className="tsugi-dashboard-nav" aria-pressed={filter===tab.id} onClick={()=>setFilter(tab.id)}>{tab.id==='done'?<BrushCheck aria-hidden/>:tab.id==='active'?<BrushDownload aria-hidden/>:<BrushList aria-hidden/>}<span>{tab.label}</span><small>{tab.count}</small></button>)}</nav><h3><Trans>Sources</Trans></h3><button type="button" className="tsugi-dashboard-nav" onClick={()=>{setDestination('local');setKind('audio');}}><BrushDisc aria-hidden/><span><Trans>Music</Trans></span></button><button type="button" className="tsugi-dashboard-nav" onClick={()=>{setDestination('local');setKind('books');}}><BrushBook aria-hidden/><span><Trans>Books</Trans></span></button>{supportsNativeTorBox()&&<button type="button" className="tsugi-dashboard-nav" onClick={()=>setDestination('torbox')}><BrushPlug aria-hidden/><span>TorBox</span></button>}</aside>
      <div className="tsugi-dashboard-center">
      {showHelp&&<section className="tsugi-vault-onboarding" aria-label={t`Getting started with Vault`}>
        <div><p className="tsugi-vault-overline"><Trans>GET STARTED</Trans></p><h2><Trans>From a link to your library.</Trans></h2><p><Trans>Paste an authorized media or file link, choose where it goes, and start the download. You can also use Download on the music player.</Trans></p></div>
        <div className="tsugi-vault-onboarding-steps"><span><strong>01</strong><Trans>Paste a link</Trans></span><span><strong>02</strong><Trans>Choose a destination</Trans></span><span><strong>03</strong><Trans>Download</Trans></span></div>
        <button type="button" className="tsugi-read-action" onClick={dismissHelp}><Trans>Got it</Trans></button>
      </section>}
      <section className="tsugi-vault-composer">
        <header className="tsugi-vault-commandbar"><h2><Trans>New download</Trans></h2><button type="button" className="tsugi-vault-quiet" onClick={()=>setShowHelp(v=>!v)}><Trans>How it works</Trans></button></header>
        {destination==='torbox'?<TorBoxPanel initialLink={batch?'':input} onConnectionChange={setTorboxConnected}/>:<form className="tsugi-vault-form tsugi-vault-intake" onSubmit={event=>{event.preventDefault();enqueue();}}>
          <div className="tsugi-vault-input-header"><strong><Trans>Source link</Trans></strong><button type="button" className="tsugi-vault-quiet" aria-pressed={batch} disabled={!!pendingCount} onClick={()=>{setBatch(v=>!v);setPermission(false);setTrackTitle('');setInput('');}}>{batch?<Trans>Single link</Trans>:<Trans>Batch links</Trans>}</button></div>
          {batch?<label><Trans>Download links (one per line)</Trans><textarea rows={4} maxLength={40000} value={input} disabled={!!pendingCount} onChange={event=>{setInput(event.target.value);setPermission(false);setError('');}} placeholder={t`Up to 20 links`}/></label>:<>
            <label><span>{mode==='youtube'?<Trans>YouTube Music track link</Trans>:<Trans>Public file URL</Trans>}</span><input type="url" required value={input} disabled={!!pendingCount} placeholder={t`Paste a YouTube or direct file link`} onChange={event=>{setInput(event.target.value);setMode(detectVaultSource(event.target.value));setTrackTitle('');setPermission(false);setError('');}}/></label>
            <div className="tsugi-vault-source-info"><BrushDisc aria-hidden/><span>{trackTitle|| (mode==='youtube'?t`YouTube · M4A audio`:t`Direct file · PDF, EPUB or audio`)}</span></div>
          </>}
          <div className="tsugi-vault-submit-row"><label><span><input type="checkbox" style={{width:'auto'}} checked={permission} disabled={!!pendingCount} onChange={event=>setPermission(event.target.checked)}/> <Trans>I have permission to download this content.</Trans></span></label>
          <button type="submit" className="tsugi-read-action tsugi-series-primary" disabled={!ready||!permission||!input.trim()||!!pendingCount}><BrushDownload aria-hidden/>{batch?<Trans>Add batch to queue</Trans>:<Trans>Queue local download</Trans>}</button></div>
          <p className="tsugi-vault-hint"><Trans>Public links are saved in your local queue. YouTube audio is limited to 64 MiB.</Trans></p>
        </form>}
      </section>
      <div className="tsugi-dashboard-metrics">
        <div><small><Trans>Total speed</Trans></small><strong>{vaultTransferRate(speed)}</strong><span><Trans>Local transfers</Trans></span></div>
        <div><small><Trans>Active</Trans></small><strong>{active.length}</strong><span>{queued.length} <Trans>queued</Trans></span></div>
        <div><small><Trans>Downloaded</Trans></small><strong>{(completedBytes/1048576).toFixed(1)} MiB</strong><span>{done.length} <Trans>completed files</Trans></span></div>
        <div><small>TorBox</small><strong className="tsugi-dashboard-status-value">{torboxConnected===true?<Trans>Connected</Trans>:torboxConnected===false?<Trans>Not connected</Trans>:<Trans>Unknown</Trans>}</strong><span><Trans>Cloud destination</Trans></span></div>
      </div>
      <section className="tsugi-vault-queue-heading">
        <header className="tsugi-vault-commandbar"><div><h2><Trans>Downloads</Trans></h2><p className="tsugi-vault-hint">{active.length} <Trans>active</Trans> · {queued.length} <Trans>waiting</Trans> · {vaultTransferRate(speed)}</p></div>
        <div className="tsugi-vault-actions">
          <button type="button" className="tsugi-read-action tsugi-vault-icon-action" aria-label={t`Refresh local downloads`} title={t`Refresh local downloads`} onClick={()=>shellDownloads.list()}><BrushRefresh aria-hidden/></button>
          <button type="button" className="tsugi-read-action tsugi-vault-icon-action" aria-label={t`Pause all`} title={t`Pause all`} disabled={!active.length&&!queued.length} onClick={()=>rows.filter(row=>row.state==='queued'||row.state==='downloading').forEach(row=>shellDownloads.control(row.id,'pause'))}><BrushPause aria-hidden/></button>
          <button type="button" className="tsugi-read-action tsugi-vault-icon-action" aria-label={t`Resume all`} title={t`Resume all`} disabled={!rows.some(row=>row.state==='paused')} onClick={()=>rows.filter(row=>row.state==='paused').forEach(row=>shellDownloads.control(row.id,'resume'))}><BrushPlay aria-hidden/></button>
        </div></header>
        <div className="tsugi-dashboard-filters" role="group" aria-label={t`Download type`}>{([{id:'all',label:t`All`},{id:'audio',label:t`Music`},{id:'books',label:t`Books`}] as const).map(item=><button type="button" key={item.id} aria-pressed={kind===item.id} onClick={()=>setKind(item.id)}>{item.label}</button>)}</div>
      </section>
      {!ready&&<p role="status"><Trans>Waiting for the desktop download manager.</Trans></p>}
      {!!pendingCount&&<p role="status"><Trans>Adding download…</Trans></p>}
      {importing&&<p role="status"><Trans>Importing completed file…</Trans></p>}
      {error&&<p role="alert">{error}</p>}
      {ready&&visible.length===0&&<div className="tsugi-vault-empty"><BrushFolder aria-hidden/><p><Trans>No downloads in this view.</Trans></p></div>}
      {([{title:t`Active downloads`,items:visible.filter(row=>row.state!=='done')},{title:t`Completed`,items:visible.filter(row=>row.state==='done')}]).filter(section=>section.items.length>0).map(section=><section key={section.title} className="tsugi-dashboard-list"><header><h3>{section.title}</h3><span>{section.items.length}</span></header>{section.items.map(row=><div className="tsugi-vault-file-row tsugi-vault-task tsugi-dashboard-transfer" key={row.id}>
        <div className="tsugi-vault-task-main">{/\.(epub|pdf)$/i.test(row.vault_title||'')?<BrushBook aria-hidden/>:<BrushDisc aria-hidden/>}<div className="tsugi-vault-task-text"><strong>{row.vault_title}</strong><p><span className="tsugi-vault-task-state" data-state={row.state}>{status(row)}</span> · {(row.bytes/1048576).toFixed(1)} MiB {row.total!==null&&row.total>0&&<span>/ {(row.total/1048576).toFixed(1)} MiB</span>}</p>
          {row.error&&<p role="alert">{row.error}</p>}
        </div></div>
        <div className="tsugi-dashboard-progress">
          {(row.state==='downloading'||row.total!==null&&row.total>0)&&<progress aria-label={t`Download progress`} max={row.total||undefined} value={row.total?Math.min(row.bytes,row.total):undefined}/>}
          {row.state==='downloading'&&<p className="tsugi-vault-task-rate">{row.speed? <>{vaultTransferRate(row.speed)}{vaultEta(row.bytes,row.total,row.speed)!==null&&<> · {vaultEta(row.bytes,row.total,row.speed)} <Trans>sec remaining</Trans></>}</>:<Trans>Preparing or waiting for data…</Trans>}</p>}
        </div>
        <span className="tsugi-dashboard-destination" title={row.vault_path||folder}><BrushFolder aria-hidden/><Trans>Local</Trans></span>
        <div className="tsugi-vault-actions">
          {(row.state==='queued'||row.state==='downloading')&&<button className="tsugi-read-action tsugi-vault-icon-action" aria-label={t`Pause`} title={t`Pause`} onClick={()=>shellDownloads.control(row.id,'pause')}><BrushPause aria-hidden/></button>}
          {row.state==='paused'&&<button className="tsugi-read-action tsugi-vault-icon-action" aria-label={t`Resume`} title={t`Resume`} onClick={()=>shellDownloads.control(row.id,'resume')}><BrushPlay aria-hidden/></button>}
          {row.state==='failed'&&<button className="tsugi-read-action tsugi-vault-icon-action" aria-label={t`Retry`} title={t`Retry`} onClick={()=>shellDownloads.control(row.id,'retry')}><BrushRefresh aria-hidden/></button>}
          {row.state!=='done'&&<button className="tsugi-read-action tsugi-vault-icon-action" aria-label={t`Cancel`} title={t`Cancel`} onClick={()=>shellDownloads.remove(row.id,true)}><BrushTrash aria-hidden/></button>}
          {row.state==='done'&&<button className="tsugi-read-action tsugi-vault-icon-action" aria-label={t`Remove from list`} title={t`Remove from list`} onClick={()=>shellDownloads.remove(row.id,false)}><BrushTrash aria-hidden/></button>}
          {row.state==='done'&&row.vault_title&&<button className="tsugi-read-action" disabled={!!importing||(/\.(epub|pdf)$/i.test(row.vault_title)?!actions?.openBooks:!actions?.openLocalAudio)} onClick={()=>void openCompleted(row)}>{/\.(epub|pdf)$/i.test(row.vault_title)?<Trans>Import into Books</Trans>:<Trans>Open in Music</Trans>}</button>}
          {row.state==='done'&&shellDownloads.folder?.open&&<button className="tsugi-read-action tsugi-vault-icon-action" aria-label={t`Show in folder`} title={t`Show in folder`} onClick={()=>shellDownloads.folder?.open?.(row.id)}><BrushFolder aria-hidden/></button>}
        </div>
      </div>)}</section>)}
      </div>
      <aside className="tsugi-dashboard-right">
        <section className="tsugi-dashboard-panel"><h3><Trans>Save to</Trans></h3>        <div className="tsugi-vault-destinations" role="group" aria-label={t`Download destination`}>
          <button type="button" aria-pressed={destination==='local'} disabled={!!pendingCount} onClick={()=>setDestination('local')}><BrushFolder aria-hidden/><span><strong><Trans>This PC</Trans></strong><small><Trans>Save locally · Aria2 / yt-dlp</Trans></small></span></button>
          {supportsNativeTorBox()&&<button type="button" aria-pressed={destination==='torbox'} disabled={!!pendingCount} onClick={()=>setDestination('torbox')}><BrushDownload aria-hidden/><span><strong><Trans>TorBox</Trans></strong><small><Trans>Send a link to your cloud</Trans></small></span></button>}
        </div>

          {folder&&<p className="tsugi-vault-saved-path" title={folder}><BrushFolder aria-hidden/>{folder}</p>}
        </section>
        <section className="tsugi-dashboard-panel"><header><h3><Trans>Bandwidth</Trans></h3><small><Trans>Local</Trans></small></header>
          <strong className="tsugi-dashboard-rate">{vaultTransferRate(speed)}</strong>
          {samples.length>1?<svg viewBox="0 0 280 76" role="img" aria-label={t`Recent local transfer speed`} className="tsugi-dashboard-sparkline"><path d={samples.map((n,i)=>(i?'L':'M')+(i/(samples.length-1)*280).toFixed(1)+' '+(72-n/maximum*68).toFixed(1)).join(' ')} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke"/></svg>:<p className="tsugi-vault-hint"><Trans>Waiting for transfer samples</Trans></p>}
                  <details className="tsugi-vault-transfer-settings"><summary><BrushSettings aria-hidden/><Trans>Transfer settings</Trans></summary><div className="tsugi-vault-queue-tools">
          <label><Trans>Simultaneous local downloads</Trans><select className="tsugi-read-input" value={Math.min(4,Math.max(1,concurrent))} onChange={event=>{const value=Number(event.target.value);setConcurrent(value);shellDownloads.configure({concurrent:value,wifiOnly});}}>{[1,2,3,4].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
          {rate!==undefined&&<label title={t`Applies to direct files and Aria2-managed music when starting or resuming. Cloud, video and compatibility transfers are unaffected.`}><Trans>Local transfer speed limit (MiB/s)</Trans><select className="tsugi-read-input" value={rate} onChange={event=>appBridge()?.send({type:'vault-rate',mib:Number(event.target.value)})}><option value={0}><Trans>Unlimited</Trans></option>{[1,2,4,8,16].map(n=><option value={n} key={n}>{n}</option>)}</select></label>}
          {shellDownloads.folder&&<button type="button" className="tsugi-read-action" onClick={()=>shellDownloads.folder?.choose()}><BrushFolder aria-hidden/><Trans>Choose download folder</Trans></button>}
        </div>{folder&&<p className="tsugi-vault-saved-path" title={folder}>{folder}</p>}{engineAvailable!==undefined&&<p className="tsugi-vault-hint">{engineAvailable?<Trans>Managed engine ready</Trans>:<Trans>Built-in fallback active</Trans>}</p>}</details>

        </section>
        <section className="tsugi-dashboard-panel"><h3><Trans>Connected services</Trans></h3>
          <div className="tsugi-dashboard-service"><span><Trans>Direct files</Trans></span><small>{ready?<Trans>Ready</Trans>:<Trans>Waiting</Trans>}</small></div>
          <div className="tsugi-dashboard-service"><span><Trans>YouTube engine</Trans></span><small>{appBridge()?.youtubeMusic?<Trans>Available</Trans>:<Trans>Unavailable</Trans>}</small></div>
          <div className="tsugi-dashboard-service"><span><Trans>Aria2 Next</Trans></span><small>{engineAvailable?<Trans>Ready</Trans>:<Trans>Fallback</Trans>}</small></div>
          {supportsNativeTorBox()&&<button type="button" className="tsugi-dashboard-service" onClick={()=>setDestination('torbox')}><span>TorBox</span><small>{torboxConnected?<Trans>Connected</Trans>:<Trans>Connect</Trans>}</small></button>}
        </section>
      </aside>
    </>}
  </section>;
}
