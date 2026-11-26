import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { appBridge } from '@/lib/hosts/shell/bridge';
import { TsugiRail } from '@/components/shell/tsugi-rail';
import { shellDownloads } from '@/lib/hosts/shell/downloads';
import type { HostEvent } from '@/lib/downloads/types';
import { vaultJob, youtubeVaultJob, detectVaultSource, vaultBatch } from './native-job';
import { settings, useSetting } from '@/lib/settings';
import { BrushBook, BrushDisc, BrushFolder, BrushPause, BrushPlay, BrushDownload, BrushRefresh, BrushTrash, BrushSliders, BrushList, BrushCheck, BrushPlug, BrushPlus, BrushRight, BrushHistory } from '@/components/tsugi-icons';
import { TorBoxPanel } from './torbox-panel';
import { nativeTorBox, supportsNativeTorBox } from './native-torbox';
import { vaultTransferRate, vaultEta, reconcileVaultRows } from './queue-model';
import { importBook, listBooks, type BookEntry } from '@/app/read/book-library';
import { useDesktopArea } from '@/lib/desktop-area';
import { readCompletedVaultFile } from './completed-file';
import { VaultBookImportReview, type BookImportReview } from './book-import-review';

type Row = Extract<HostEvent, {type:'state'}>['jobs'][number] & {speed?:number};
type Filter = 'all'|'active'|'queued'|'done';
type BookImportResult = 'imported'|'existing'|'failed';
const bookFile = (name: string) => /\.(pdf|epub)$/i.test(name);
const matchingBooks = (books: BookEntry[], name: string) => books.filter(book => book.name.toLowerCase() === name.toLowerCase());
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

export function NativeVaultQueue({track=null,captureRef,transfersRef,navigationDisabled=false}:{track?:{id:string;title:string}|null;captureRef?:RefObject<HTMLElement|null>;transfersRef?:RefObject<HTMLElement|null>;navigationDisabled?:boolean}) {
  const localCapture=useRef<HTMLElement|null>(null);
  const capturePanel=captureRef||localCapture;
  function focusCapture(){
    capturePanel.current?.scrollIntoView({block:'start'});
    const field=capturePanel.current?.querySelector<HTMLInputElement|HTMLTextAreaElement>('input:not([type="checkbox"]),textarea');
    (field||capturePanel.current)?.focus({preventScroll:true});
  }
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
  const [bookEntries,setBookEntries] = useState<BookEntry[]>([]);
  const importedBookIds=useMemo(()=>new Set(bookEntries.flatMap(book=>book.vaultJobId?[book.vaultJobId]:[])),[bookEntries]);
  const bookLookup=useRef(0);
  const [bookImports,setBookImports] = useState<Record<string,BookImportResult>>({});
  const [bookReview,setBookReview] = useState<BookImportReview|null>(null);
  const bookWriting=useRef(false);
  const [savingBook,setSavingBook]=useState(false);
  const [anotherBookCopy,setAnotherBookCopy] = useState(false);
  const completedBookIds = rows.filter(row=>row.state==='done'&&bookFile(row.vault_title||'')).map(row=>row.id).sort().join(',');
  useEffect(()=>{
    if(!completedBookIds)return;
    let alive=true;const lookup=++bookLookup.current;
    void listBooks().then(books=>{if(alive&&lookup===bookLookup.current)setBookEntries(books);}).catch(()=>{/* Explicit review retries a failed library lookup before any write. */});
    return()=>{alive=false;};
  },[completedBookIds]);
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
      if(bookFile(row.vault_title)){
        const books=await listBooks();controller.signal.throwIfAborted();bookLookup.current++;setBookEntries(books);
        if(books.some(book=>book.vaultJobId===row.id))setBookImports(old=>({...old,[row.id]:'existing'}));
        else{setAnotherBookCopy(false);setBookReview({id:row.id,name:row.vault_title,bytes:row.bytes,duplicates:matchingBooks(books,row.vault_title)});}
        return;
      }
      const file=await readCompletedVaultFile(row.id,row.vault_title,controller.signal);
      controller.signal.throwIfAborted();
      actions?.openLocalAudio?.(file);
    }catch{if(!controller.signal.aborted){
      if(bookFile(row.vault_title))setBookImports(old=>({...old,[row.id]:'failed'}));
      else setError(t`Could not import the completed file. It may have been moved, removed or exceeded 128 MiB.`);
    }}
    finally{activeImport.current=null;setImporting('');}
  }
  async function confirmBookImport() {
    if(activeImport.current||!bookReview||bookReview.duplicates.length>0&&!anotherBookCopy)return;
    const review=bookReview,row=rows.find(row=>row.id===review.id);
    if(!row||row.state!=='done'||row.vault_title!==review.name||row.bytes!==review.bytes){
      setBookImports(old=>({...old,[review.id]:'failed'}));setBookReview(null);return;
    }
    const controller=new AbortController();activeImport.current=controller;setImporting(row.id);
    try{
      const books=await listBooks();controller.signal.throwIfAborted();bookLookup.current++;setBookEntries(books);
      if(books.some(book=>book.vaultJobId===row.id)){
        setBookImports(old=>({...old,[row.id]:'existing'}));setBookReview(null);return;
      }
      const duplicates=matchingBooks(books,review.name);
      if(duplicates.map(book=>book.id).sort().join(',')!==review.duplicates.map(book=>book.id).sort().join(',')){
        setBookReview({...review,duplicates});setAnotherBookCopy(false);return;
      }
      const file=await readCompletedVaultFile(row.id,review.name,controller.signal);
      controller.signal.throwIfAborted();
      bookWriting.current=true;setSavingBook(true);
      const entry=await importBook(file,row.id);controller.signal.throwIfAborted();
      bookLookup.current++;
      setBookEntries(old=>[...old.filter(book=>book.id!==entry.id),entry]);
      setBookImports(old=>({...old,[row.id]:'imported'}));setBookReview(null);
    }catch{if(!controller.signal.aborted){setBookImports(old=>({...old,[row.id]:'failed'}));setBookReview(null);}}
    finally{bookWriting.current=false;setSavingBook(false);activeImport.current=null;setImporting('');}
  }
  function cancelBookImport(){
    if(bookWriting.current)return;
    activeImport.current?.abort();setBookReview(null);
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
    <TsugiRail area="vault" disabled={navigationDisabled} className="kura-rail">
      <div className="kura-rail-content">
        <button type="button" className="tsugi-read-action tsugi-series-primary kura-rail-add" disabled={!supported||navigationDisabled} aria-label={t`Add links`} title={t`Add links`} onClick={focusCapture}><BrushPlus aria-hidden/><span><Trans>Add links</Trans></span></button>
        <nav className="tsugi-rail-local kura-vault-navigation" aria-label={t`Download views`} data-ui="kura-download-navigation">
          <p className="tsugi-reading-rail-label"><Trans>Downloads</Trans></p>
          {tabs.map(tab=><button type="button" key={tab.id} className="tsugi-dashboard-nav" disabled={!supported||navigationDisabled} aria-label={tab.label} title={tab.label} aria-pressed={filter===tab.id} onClick={()=>setFilter(tab.id)}>
            {tab.id==='done'?<BrushCheck aria-hidden/>:tab.id==='active'?<BrushDownload aria-hidden/>:tab.id==='queued'?<BrushHistory aria-hidden/>:<BrushList aria-hidden/>}<span>{tab.label}</span><small>{tab.count}</small>
          </button>)}
          <p className="tsugi-reading-rail-label"><Trans>Media</Trans></p>
          <button type="button" className="tsugi-dashboard-nav" disabled={!supported||navigationDisabled} aria-label={t`Music downloads`} title={t`Music downloads`} aria-pressed={kind==='audio'} onClick={()=>{setDestination('local');setKind('audio');}}><BrushDisc aria-hidden/><span><Trans>Music</Trans></span></button>
          <button type="button" className="tsugi-dashboard-nav" disabled={!supported||navigationDisabled} aria-label={t`Books in downloads`} title={t`Books in downloads`} aria-pressed={kind==='books'} onClick={()=>{setDestination('local');setKind('books');}}><BrushBook aria-hidden/><span><Trans>Books</Trans></span></button>
          {supportsNativeTorBox()&&<><p className="tsugi-reading-rail-label"><Trans>Connections</Trans></p><button type="button" className="tsugi-dashboard-nav" disabled={navigationDisabled} aria-label={t`TorBox downloads`} title={t`TorBox downloads`} aria-pressed={destination==='torbox'} onClick={()=>setDestination('torbox')}><BrushPlug aria-hidden/><span>TorBox</span><span className="kura-connection-dot" data-connected={torboxConnected===true} aria-hidden="true"/></button></>}
        </nav>
        {supported&&<div className="kura-local-note"><BrushFolder aria-hidden/><p><Trans>Completed files stay in your download folder.</Trans></p>{shellDownloads.folder?.open&&<button type="button" className="tsugi-vault-quiet" disabled={!ready||!folder||navigationDisabled} onClick={()=>shellDownloads.folder?.open?.()}><Trans>Open folder</Trans><BrushRight aria-hidden/></button>}</div>}
      </div>
    </TsugiRail>
    {!supported ? <div className="kura-unavailable"><BrushFolder aria-hidden/><h2><Trans>Your downloads, together.</Trans></h2><p><Trans>Native Vault downloads require the Windows desktop application.</Trans></p></div> : <>
      <div className="tsugi-dashboard-center">
        <div className="tsugi-dashboard-metrics">
          <div className="kura-speed-metric"><small><Trans>Total speed</Trans></small><strong>{ready?vaultTransferRate(speed):'—'}</strong><span><Trans>Local transfers</Trans></span></div>
          <div><small><Trans>Active</Trans></small><strong>{ready?active.length:'—'}</strong><span>{queued.length} <Trans>queued</Trans></span></div>
          <div><small><Trans>Downloaded</Trans></small><strong>{ready?(completedBytes/1048576).toFixed(1)+' MiB':'—'}</strong><span>{done.length} <Trans>completed files</Trans></span></div>
          <div><small>TorBox</small><strong className="tsugi-dashboard-status-value">{!supportsNativeTorBox()?<Trans>Unavailable</Trans>:torboxConnected===true?<Trans>Connected</Trans>:torboxConnected===false?<Trans>Not connected</Trans>:<Trans>Unknown</Trans>}</strong><span><Trans>Cloud destination</Trans></span></div>
        </div>

        {showHelp&&<section className="tsugi-vault-onboarding" aria-label={t`Getting started with Vault`}>
          <div><p className="tsugi-vault-overline"><Trans>GET STARTED</Trans></p><h2><Trans>From a link to your library.</Trans></h2><p><Trans>Paste an authorized media or file link, choose where it goes, and start the download. You can also use Download on the music player.</Trans></p></div>
          <div className="tsugi-vault-onboarding-steps"><span><strong>01</strong><Trans>Paste a link</Trans></span><span><strong>02</strong><Trans>Choose a destination</Trans></span><span><strong>03</strong><Trans>Download</Trans></span></div>
          <button type="button" className="tsugi-read-action" onClick={dismissHelp}><Trans>Got it</Trans><BrushCheck aria-hidden/></button>
        </section>}

        <section ref={capturePanel} tabIndex={-1} className="tsugi-vault-composer" aria-labelledby="kura-capture-heading" id="kura-link-capture">
          <header className="tsugi-vault-commandbar"><div><p className="kura-eyebrow"><Trans>LINK CAPTURE</Trans></p><h2 id="kura-capture-heading"><Trans>New download</Trans></h2></div><button type="button" className="tsugi-vault-quiet" aria-expanded={showHelp} onClick={()=>setShowHelp(v=>!v)}><Trans>How it works</Trans></button></header>
          {destination==='torbox'?<TorBoxPanel initialLink={batch?'':input} onConnectionChange={setTorboxConnected}/>:<form className="tsugi-vault-form tsugi-vault-intake" onSubmit={event=>{event.preventDefault();enqueue();}}>
            <div className="tsugi-vault-input-header"><span className="kura-intake-destination"><BrushFolder aria-hidden/><Trans>Save to this PC</Trans></span><button type="button" className="tsugi-vault-quiet" aria-pressed={batch} disabled={!!pendingCount} onClick={()=>{setBatch(v=>!v);setPermission(false);setTrackTitle('');setInput('');}}>{batch?<Trans>Single link</Trans>:<Trans>Batch links</Trans>}</button></div>
            {batch?<label><Trans>Download links (one per line)</Trans><textarea rows={4} maxLength={40000} value={input} disabled={!!pendingCount} onChange={event=>{setInput(event.target.value);setPermission(false);setError('');}} placeholder={t`Up to 20 links`}/></label>:<>
              <label><span>{mode==='youtube'?<Trans>YouTube Music track link</Trans>:<Trans>Public file URL</Trans>}</span><input type="url" required value={input} disabled={!!pendingCount} placeholder={t`Paste a YouTube or direct file link`} onChange={event=>{setInput(event.target.value);setMode(detectVaultSource(event.target.value));setTrackTitle('');setPermission(false);setError('');}}/></label>
              <div className="tsugi-vault-source-info">{mode==='youtube'?<BrushDisc aria-hidden/>:<BrushFolder aria-hidden/>}<span>{trackTitle||(mode==='youtube'?t`YouTube · M4A audio`:t`Direct file · PDF, EPUB or audio`)}</span></div>
            </>}
            <div className="tsugi-vault-submit-row"><label className="kura-permission"><span><input type="checkbox" checked={permission} disabled={!!pendingCount} onChange={event=>setPermission(event.target.checked)}/><Trans>I have permission to download this content.</Trans></span></label>
              <button type="submit" className="tsugi-read-action tsugi-series-primary" disabled={!ready||!permission||!input.trim()||!!pendingCount}><BrushDownload aria-hidden/>{batch?<Trans>Add batch to queue</Trans>:<Trans>Queue local download</Trans>}</button>
            </div>
            <p className="tsugi-vault-hint"><Trans>Public links are saved in your local queue. YouTube audio is limited to 64 MiB.</Trans></p>
          </form>}
        </section>

        <section ref={transfersRef} tabIndex={-1} className="tsugi-vault-queue-heading" aria-labelledby="kura-transfers-heading" id="kura-transfers">
          <header className="tsugi-vault-commandbar"><div><p className="kura-eyebrow"><Trans>FINDING THEIR WAY HOME</Trans></p><h2 id="kura-transfers-heading"><Trans>Downloads</Trans></h2><p className="tsugi-vault-hint">{active.length} <Trans>active</Trans> · {queued.length} <Trans>waiting</Trans> · {vaultTransferRate(speed)}</p></div>
            <div className="tsugi-vault-actions">
              <button type="button" className="tsugi-read-action tsugi-vault-icon-action" aria-label={t`Refresh local downloads`} title={t`Refresh local downloads`} onClick={()=>shellDownloads.list()}><BrushRefresh aria-hidden/></button>
              <button type="button" className="tsugi-read-action tsugi-vault-icon-action" aria-label={t`Pause all`} title={t`Pause all`} disabled={!active.length&&!queued.length} onClick={()=>rows.filter(row=>row.state==='queued'||row.state==='downloading').forEach(row=>shellDownloads.control(row.id,'pause'))}><BrushPause aria-hidden/></button>
              <button type="button" className="tsugi-read-action tsugi-vault-icon-action" aria-label={t`Resume all`} title={t`Resume all`} disabled={!rows.some(row=>row.state==='paused')} onClick={()=>rows.filter(row=>row.state==='paused').forEach(row=>shellDownloads.control(row.id,'resume'))}><BrushPlay aria-hidden/></button>
            </div>
          </header>
          <div className="tsugi-dashboard-filters" role="group" aria-label={t`Download type`}>{([{id:'all',label:t`All`},{id:'audio',label:t`Music`},{id:'books',label:t`Books`}] as const).map(item=><button type="button" key={item.id} aria-pressed={kind===item.id} onClick={()=>setKind(item.id)}>{item.label}</button>)}</div>
        </section>

        {!ready&&<p role="status" className="kura-notice"><Trans>Waiting for the desktop download manager.</Trans></p>}
        {!!pendingCount&&<p role="status" className="kura-notice"><Trans>Adding download…</Trans></p>}
        {importing&&<p role="status" className="kura-notice"><Trans>Importing completed file…</Trans></p>}
        {error&&<p role="alert" className="kura-notice">{error}</p>}
        {ready&&visible.length===0&&<div className="tsugi-vault-empty"><div className="kura-empty-icon"><BrushFolder aria-hidden/></div><h3>{rows.length===0?<Trans>Make room for a little wonder.</Trans>:<Trans>A quiet corner of your vault.</Trans>}</h3><p><Trans>No downloads in this view.</Trans></p>{rows.length===0?<><p className="tsugi-vault-hint"><Trans>Add a file or track link above. Your transfers and completed files will appear here.</Trans></p><button type="button" className="tsugi-read-action" onClick={focusCapture}><BrushPlus aria-hidden/><Trans>Add your first link</Trans></button></>:<button type="button" className="tsugi-read-action" onClick={()=>{setFilter('all');setKind('all');}}><Trans>Show all downloads</Trans></button>}</div>}

        {([{title:t`Active downloads`,items:visible.filter(row=>row.state!=='done')},{title:t`Completed`,items:visible.filter(row=>row.state==='done')}]).filter(section=>section.items.length>0).map(section=><section key={section.title} className="tsugi-dashboard-list">
          <header><h3>{section.title}</h3><span>{section.items.length}</span></header>
          {section.items.map(row=><div className="tsugi-vault-file-row tsugi-vault-task tsugi-dashboard-transfer" data-vault-job-id={row.id} data-state={row.state} key={row.id}>
            <div className="tsugi-vault-task-main"><div className="kura-file-icon" data-kind={bookFile(row.vault_title||'')?'book':'audio'}>{bookFile(row.vault_title||'')?<BrushBook aria-hidden/>:<BrushDisc aria-hidden/>}</div><div className="tsugi-vault-task-text"><strong title={row.vault_title}>{row.vault_title}</strong><p className="kura-task-meta"><span className="tsugi-vault-task-state" data-state={row.state}>{status(row)}</span><span>{(row.bytes/1048576).toFixed(1)} MiB {row.total!==null&&row.total>0&&<span>/ {(row.total/1048576).toFixed(1)} MiB</span>}</span></p>
              {row.error&&<p role="alert">{row.error}</p>}
              {row.state==='done'&&bookFile(row.vault_title||'')&&(importedBookIds.has(row.id)?<p role="status" data-vault-import-state={bookImports[row.id]==='imported'?'imported':'existing'}>{bookImports[row.id]==='imported'?<Trans>Imported</Trans>:<Trans>Already in Books</Trans>}</p>:bookImports[row.id]==='failed'&&<p role="alert" data-vault-import-state="failed"><Trans>Import failed. Check that the file is a valid EPUB or PDF of at most 128 MiB and that Books storage is available. Retry import does not restart the download.</Trans></p>)}
            </div></div>
            <div className="tsugi-dashboard-progress">
              <div className="kura-progress-meta"><span className="tsugi-dashboard-destination" title={row.vault_path||folder}><BrushFolder aria-hidden/><Trans>Local</Trans></span>{row.total!==null&&row.total>0&&<span>{Math.min(100,Math.max(0,Math.round(row.bytes/row.total*100)))}%</span>}</div>
              {(row.state==='downloading'||row.total!==null&&row.total>0)&&<progress aria-label={t`Download progress`} max={row.total||undefined} value={row.total?Math.min(row.bytes,row.total):undefined}/>}
              {row.state==='downloading'&&<p className="tsugi-vault-task-rate">{row.speed?<>{vaultTransferRate(row.speed)}{vaultEta(row.bytes,row.total,row.speed)!==null&&<> · {vaultEta(row.bytes,row.total,row.speed)} <Trans>sec remaining</Trans></>}</>:<Trans>Preparing or waiting for data…</Trans>}</p>}
            </div>
            <div className="tsugi-vault-actions">
              {(row.state==='queued'||row.state==='downloading')&&<button className="tsugi-read-action tsugi-vault-icon-action" aria-label={t`Pause`} title={t`Pause`} onClick={()=>shellDownloads.control(row.id,'pause')}><BrushPause aria-hidden/></button>}
              {row.state==='paused'&&<button className="tsugi-read-action tsugi-vault-icon-action" aria-label={t`Resume`} title={t`Resume`} onClick={()=>shellDownloads.control(row.id,'resume')}><BrushPlay aria-hidden/></button>}
              {row.state==='failed'&&<button className="tsugi-read-action tsugi-vault-icon-action" aria-label={t`Retry`} title={t`Retry`} onClick={()=>shellDownloads.control(row.id,'retry')}><BrushRefresh aria-hidden/></button>}
              {row.state!=='done'&&<button className="tsugi-read-action tsugi-vault-icon-action" aria-label={t`Cancel`} title={t`Cancel`} onClick={()=>shellDownloads.remove(row.id,true)}><BrushTrash aria-hidden/></button>}
              {row.state==='done'&&<button className="tsugi-read-action tsugi-vault-icon-action" aria-label={t`Remove from list`} title={t`Remove from list`} onClick={()=>shellDownloads.remove(row.id,false)}><BrushTrash aria-hidden/></button>}
              {row.state==='done'&&row.vault_title&&(bookFile(row.vault_title)&&importedBookIds.has(row.id)?<button className="tsugi-read-action kura-handoff-action" disabled={!!importing||!actions?.openBooks} onClick={()=>actions?.openBooks?.()}><Trans>Open Books</Trans></button>:<button className="tsugi-read-action kura-handoff-action" disabled={!!importing||(bookFile(row.vault_title)?!actions?.openBooks:!actions?.openLocalAudio)} onClick={()=>void openCompleted(row)}>{bookFile(row.vault_title)?bookImports[row.id]==='failed'?<Trans>Retry import</Trans>:<Trans>Import into Books</Trans>:<Trans>Open in Music</Trans>}</button>)}
              {row.state==='done'&&shellDownloads.folder?.open&&<button className="tsugi-read-action tsugi-vault-icon-action" aria-label={t`Show in folder`} title={t`Show in folder`} onClick={()=>shellDownloads.folder?.open?.(row.id)}><BrushFolder aria-hidden/></button>}
            </div>
          </div>)}
        </section>)}
      </div>

      <aside className="tsugi-dashboard-right" aria-label={t`Download inspector`}>
        <section className="tsugi-dashboard-panel kura-destination-panel"><p className="kura-eyebrow"><Trans>A PLACE FOR YOUR FILES</Trans></p><h3><Trans>Save to</Trans></h3>
          <div className="tsugi-vault-destinations" role="group" aria-label={t`Download destination`}>
            <button type="button" aria-pressed={destination==='local'} disabled={!!pendingCount} onClick={()=>setDestination('local')}><BrushFolder aria-hidden/><span><strong><Trans>This PC</Trans></strong><small><Trans>Save in your download folder</Trans></small></span>{destination==='local'&&<BrushCheck aria-hidden/>}</button>
            {supportsNativeTorBox()&&<button type="button" aria-pressed={destination==='torbox'} disabled={!!pendingCount} onClick={()=>setDestination('torbox')}><BrushPlug aria-hidden/><span><strong><Trans>TorBox</Trans></strong><small><Trans>Send a link to your cloud</Trans></small></span>{destination==='torbox'&&<BrushCheck aria-hidden/>}</button>}
          </div>
          {folder&&<p className="tsugi-vault-saved-path" title={folder}><BrushFolder aria-hidden/>{folder}</p>}
          <p className="tsugi-vault-hint">{destination==='local'?<Trans>Finished books and audio can open in your local libraries.</Trans>:<Trans>Cloud submissions stay in TorBox. Follow their progress in your TorBox dashboard.</Trans>}</p>
        </section>

        <section className="tsugi-dashboard-panel kura-bandwidth-panel"><header><h3><Trans>Bandwidth</Trans></h3><small><span className="kura-connection-dot" data-connected={ready} aria-hidden="true"/><Trans>Local</Trans></small></header>
          <strong className="tsugi-dashboard-rate">{ready?vaultTransferRate(speed):'—'}</strong>
          {samples.length>1?<svg viewBox="0 0 280 76" role="img" aria-label={t`Recent local transfer speed`} className="tsugi-dashboard-sparkline"><path d={samples.map((n,i)=>(i?'L':'M')+(i/(samples.length-1)*280).toFixed(1)+' '+(72-n/maximum*68).toFixed(1)).join(' ')} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke"/></svg>:<p className="tsugi-vault-hint"><Trans>Waiting for transfer samples</Trans></p>}
          <div className="kura-bandwidth-caption"><span><Trans>Recent transfer speed</Trans></span><span><Trans>Now</Trans></span></div>
          <details className="tsugi-vault-transfer-settings"><summary><BrushSliders aria-hidden/><Trans>Transfer settings</Trans></summary><div className="tsugi-vault-queue-tools">
            <label><Trans>Simultaneous local downloads</Trans><select className="tsugi-read-input" value={Math.min(4,Math.max(1,concurrent))} onChange={event=>{const value=Number(event.target.value);setConcurrent(value);shellDownloads.configure({concurrent:value,wifiOnly});}}>{[1,2,3,4].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
            {rate!==undefined&&<label title={t`Applies to direct files and Aria2-managed music when starting or resuming. Cloud, video and compatibility transfers are unaffected.`}><Trans>Local transfer speed limit (MiB/s)</Trans><select className="tsugi-read-input" value={rate} onChange={event=>appBridge()?.send({type:'vault-rate',mib:Number(event.target.value)})}><option value={0}><Trans>Unlimited</Trans></option>{[1,2,4,8,16].map(n=><option value={n} key={n}>{n}</option>)}</select></label>}
            {shellDownloads.folder&&<button type="button" className="tsugi-read-action" onClick={()=>shellDownloads.folder?.choose()}><BrushFolder aria-hidden/><span><Trans>Choose download folder</Trans></span></button>}
          </div>{folder&&<p className="tsugi-vault-saved-path" title={folder}>{folder}</p>}{engineAvailable!==undefined&&<p className="tsugi-vault-hint">{engineAvailable?<Trans>Managed engine ready</Trans>:<Trans>Built-in fallback active</Trans>}</p>}</details>
        </section>

        <section className="tsugi-dashboard-panel kura-services-panel"><h3><Trans>Connected services</Trans></h3>
          <div className="tsugi-dashboard-service" data-ready={ready}><span><Trans>Direct files</Trans></span><small>{ready?<Trans>Ready</Trans>:<Trans>Waiting</Trans>}</small></div>
          <div className="tsugi-dashboard-service" data-ready={!!appBridge()?.youtubeMusic}><span><Trans>YouTube engine</Trans></span><small>{appBridge()?.youtubeMusic?<Trans>Available</Trans>:<Trans>Unavailable</Trans>}</small></div>
          <div className="tsugi-dashboard-service" data-ready={engineAvailable===true}><span><Trans>Aria2 Next</Trans></span><small>{engineAvailable===undefined?<Trans>Waiting</Trans>:engineAvailable?<Trans>Ready</Trans>:<Trans>Fallback</Trans>}</small></div>
          {supportsNativeTorBox()&&<button type="button" className="tsugi-dashboard-service" data-ready={torboxConnected===true} onClick={()=>{setDestination('torbox');capturePanel.current?.scrollIntoView({block:'start'});capturePanel.current?.focus({preventScroll:true});}}><span>TorBox</span><small>{torboxConnected===true?<Trans>Connected</Trans>:torboxConnected===false?<Trans>Connect</Trans>:<Trans>Unknown</Trans>}</small></button>}
        </section>
      </aside>
      {bookReview&&<VaultBookImportReview review={bookReview} busy={!!importing} saving={savingBook} anotherCopy={anotherBookCopy} onAnotherCopy={setAnotherBookCopy} onApply={()=>void confirmBookImport()} onClose={cancelBookImport}/>}
    </>}
  </section>;
}
