import React from 'react';
import { reviewArtworkCleanup } from '@/lib/cache/store';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { inspectManagedStorage,supportsManagedBackups,type StorageKind,type StorageRow } from '@/lib/backup/managed-archive';

function size(bytes:number){
  if(bytes<1024)return bytes+' B';
  if(bytes<1048576)return (bytes/1024).toFixed(1)+' KiB';
  if(bytes<1073741824)return (bytes/1048576).toFixed(1)+' MiB';
  return (bytes/1073741824).toFixed(2)+' GiB';
}
function label(kind:StorageKind,detailed:boolean){
  switch(kind){
    case 'backups':return t`Backups`;
    case 'reader':return detailed?t({id:'Other Reader data',message:'Other Reader data'}):t`Manga runtime data and downloads`;
    case 'webview':return detailed?t({id:'WebView profile and local books',message:'WebView profile and local books'}):t`WebView data, books and cache`;
    case 'readerChapters':return t({id:'Downloaded manga chapters',message:'Downloaded manga chapters'});
    case 'readerCache':return t({id:'Reader cache',message:'Reader cache'});
    case 'webCache':return t({id:'WebView disk cache',message:'WebView disk cache'});
    case 'logs':return t`Logs`;
    case 'downloads':return t`Downloads inside app data`;
    case 'other':return t`Other app data`;
  }
}
function ArtworkCleanup({onRemoved}:{onRemoved():void}){
  const [review,setReview]=React.useState<Awaited<ReturnType<typeof reviewArtworkCleanup>>|null>(null);
  const [busy,setBusy]=React.useState(false);
  const [notice,setNotice]=React.useState('');
  const [error,setError]=React.useState('');
  async function run(apply:boolean){
    setBusy(true);setNotice('');setError('');
    try{
      if(apply && review){
        await review.apply();
        onRemoved();
        setNotice(t({id:'Reviewed artwork removed from the device cache.',message:'Reviewed artwork removed from the device cache.'}));
        setReview(null);
      }else{
        setReview(await reviewArtworkCleanup());
      }
    }catch{
      setReview(null);
      setError(t({id:'Artwork cleanup could not be completed. Review the current cache again.',message:'Artwork cleanup could not be completed. Review the current cache again.'}));
    }finally{setBusy(false);}
  }
  const count=review?.count??0;
  const bytes=size(review?.bytes??0);
  return <div className="space-y-2">
    <h4><Trans id="Movies & TV artwork cache">Movies &amp; TV artwork cache</Trans></h4>
    <button className="tsugi-read-action" type="button" disabled={busy} onClick={()=>void run(false)}><Trans id="Review cached artwork">Review cached artwork</Trans></button>
    {review&&<div className="space-y-2">
      <p role="status"><Trans id="Cached images selected: {count} ({bytes}).">Cached images selected: {count} ({bytes}).</Trans></p>
      {review.more&&<p><Trans id="More cached images can be reviewed in another batch.">More cached images can be reviewed in another batch.</Trans></p>}
      {count>0&&<p><Trans id="These images can load again while online. Your media files, library and progress are kept.">These images can load again while online. Your media files, library and progress are kept.</Trans></p>}
      <div className="flex flex-wrap gap-2">
        {count>0&&<button className="tsugi-read-action" type="button" disabled={busy} onClick={()=>void run(true)}><Trans id="Remove reviewed artwork">Remove reviewed artwork</Trans></button>}
        <button className="tsugi-read-action" type="button" disabled={busy} onClick={()=>setReview(null)}><Trans id="Close artwork review">Close artwork review</Trans></button>
      </div>
    </div>}
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  </div>;
}
export function StorageUsageSettings(){
  const [rows,setRows]=React.useState<StorageRow[]|null>(null);
  const [busy,setBusy]=React.useState(false);
  const [failed,setFailed]=React.useState(false);
  if(!supportsManagedBackups())return null;
  async function scan(){
    setBusy(true);setFailed(false);setRows(null);
    try{setRows(await inspectManagedStorage());}
    catch{setFailed(true);}
    finally{setBusy(false);}
  }
  const total=rows?.reduce((sum,row)=>sum+row.bytes,0)??0;
  const detailed=rows?.some(row=>row.kind==='readerChapters')??false;
  const partial=rows?.some(row=>!row.complete)??false;
  return <section className="tsugi-app-general" aria-label={t`Storage management`}>
    <h3><Trans>Storage management</Trans></h3>
    <p><Trans id="Scan files stored in the app-data folder. Sizes exclude installed programs and media or downloads stored elsewhere.">Scan files stored in the app-data folder. Sizes exclude installed programs and media or downloads stored elsewhere.</Trans></p>
    <button className="tsugi-read-action" type="button" disabled={busy} onClick={()=>void scan()}><Trans>Scan app storage</Trans></button>
    {busy&&<p role="status"><Trans>Scanning app data…</Trans></p>}
    {failed&&<p role="alert"><Trans>Storage scan could not be completed. No files were changed.</Trans></p>}
    {rows&&<div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3"><strong><Trans>App data measured</Trans></strong><span>{partial?'≥ ':''}{size(total)}</span></div>
      {rows.map(row=><div key={row.kind} className="tsugi-read-row flex-wrap"><div className="min-w-0 flex-1"><span>{label(row.kind,detailed)}</span><small className="block text-[--tsugi-muted]">{row.files} <Trans>files</Trans>{!row.complete&&<> · <Trans>Partial scan</Trans></>}</small><progress className="w-full h-1" value={row.bytes} max={Math.max(1,total)} aria-label={label(row.kind,detailed)}/></div><strong>{!row.complete?'≥ ':''}{size(row.bytes)}</strong></div>)}
      {partial&&<p role="status"><Trans>Some entries were inaccessible, redirected or beyond scan limits. Reported sizes are lower bounds.</Trans></p>}
      <p><Trans>No files were removed. Manage media downloads through their respective libraries.</Trans></p>
    </div>}
    <ArtworkCleanup onRemoved={()=>setRows(null)} />
  </section>;
}
