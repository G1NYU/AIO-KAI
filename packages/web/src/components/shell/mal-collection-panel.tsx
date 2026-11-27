import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { readMalFile, reviewMalReimport, sameMalSnapshot, type MalReimportReview, type MalEntry, type MalKind, type MalStatus } from '@/lib/mal-collection';

type Props = {
  kind: MalKind; entries: MalEntry[]; busy: boolean; selectedId: number | null;
  run(work:()=>Promise<void>):Promise<void>;
  onImport(entries:MalEntry[]):Promise<void>;
  onReviewedImport?(review:MalReimportReview,replacementIds:number[]):Promise<void>;
  onSelect?(entry:MalEntry):void; renderArtwork?:(entry:MalEntry)=>React.ReactNode;
  onRemove(id:number):Promise<void>; isAssigned?:(entry:MalEntry)=>boolean; formatScope?:'movie';
};

function statusLabel(kind:MalKind,status:MalStatus){
  switch(status){
    case 'active': return kind==='manga'?t({ id: "Reading", message: "Reading" }):t({ id: "Watching", message: "Watching" });
    case 'completed': return t({ id: "Completed", message: "Completed" });
    case 'on-hold': return t({ id: "On hold", message: "On hold" });
    case 'dropped': return t({ id: "Dropped", message: "Dropped" });
    case 'planned': return kind==='manga'?t({ id: "Plan to read", message: "Plan to read" }):t({ id: "Plan to watch", message: "Plan to watch" });
  }
}

export function MalCollectionPanel({kind,entries,busy,selectedId,run,onImport,onReviewedImport,onSelect,onRemove,isAssigned,formatScope,renderArtwork}:Props){
  const [preview,setPreview]=React.useState<MalEntry[]|null>(null);
  const [review,setReview]=React.useState<MalReimportReview|null>(null);
  const [replacements,setReplacements]=React.useState<Set<number>>(()=>new Set());
  const [conflictPage,setConflictPage]=React.useState(0);
  const [reading,setReading]=React.useState(false);
  const [fileError,setFileError]=React.useState('');
  const [notice,setNotice]=React.useState('');
  const [filter,setFilter]=React.useState('');
  const [status,setStatus]=React.useState<MalStatus|''>('');
  const [format,setFormat]=React.useState('');
  const [page,setPage]=React.useState(0);
  const [removeId,setRemoveId]=React.useState<number|null>(null);
  const request=React.useRef(0);
  const fileInput=React.useRef<HTMLInputElement>(null);
  React.useEffect(()=>()=>{request.current++;},[]);
  const locked=busy||reading;
  const effectiveFormat=formatScope??format;
  const filtered=entries.filter(row=>(!status||row.status===status)&&(!effectiveFormat||
    (effectiveFormat==='movie'?row.format.toLowerCase()==='movie':row.format.toLowerCase()!=='movie'))&&
    row.title.toLowerCase().includes(filter.trim().toLowerCase())).sort((a,b)=>a.title.localeCompare(b.title)||a.malId-b.malId);
  const pages=Math.max(1,Math.ceil(filtered.length/60)), current=Math.min(page,pages-1);
  const existing=new Set(entries.map(row=>row.malId));
  const added=review?.added??(preview?.filter(row=>!existing.has(row.malId)).length??0);
  const stale=review!==null&&!sameMalSnapshot(entries,review.baseline);
  const conflicts=review?.conflicts??[];
  const conflictPages=Math.max(1,Math.ceil(conflicts.length/20));
  function clearPreview(){setPreview(null);setReview(null);setReplacements(new Set());setConflictPage(0);}
  function chooseReplacement(id:number,checked:boolean){setReplacements(previous=>{const next=new Set(previous);if(checked)next.add(id);else next.delete(id);return next;});}
  async function chooseFile(file?:File){
    if(!file||locked)return;
    const id=++request.current;
    setReading(true);clearPreview();setNotice('');setFileError('');
    try{
      const next=await readMalFile(file,kind);
      if(id===request.current){
        const reviewed=onReviewedImport?reviewMalReimport(entries,next,kind):null;
        setReview(reviewed);setPreview(next);
      }
    }catch{
      if(id===request.current)setFileError(kind==='manga'?t({ id: "Choose a valid MyAnimeList manga export (.xml or .xml.gz, up to 8 MiB and 3,000 titles).", message: "Choose a valid MyAnimeList manga export (.xml or .xml.gz, up to 8 MiB and 3,000 titles)." }):
        t({ id: "Choose a valid MyAnimeList anime export (.xml or .xml.gz, up to 8 MiB and 3,000 titles).", message: "Choose a valid MyAnimeList anime export (.xml or .xml.gz, up to 8 MiB and 3,000 titles)." }));
    }finally{
      if(id===request.current)setReading(false);
    }
  }
  function snapshot(row:MalEntry){return <div className="min-w-0 space-y-1 break-words">
    <strong className="block">{row.title}</strong>
    <p>{statusLabel(kind,row.status)} · {row.progress} / {row.total||'—'} <Trans id="chapters">chapters</Trans></p>
    <p>{row.volumesRead} / {row.volumesTotal||'—'} <Trans id="volumes">volumes</Trans> · <Trans id="MAL snapshot score">Score</Trans>: {row.score}/10</p>
    <p><Trans id="MAL snapshot format">Format</Trans>: {row.format||'—'}</p>
  </div>;}
  function titleContent(row:MalEntry){return <>{renderArtwork?.(row)}<strong className="block break-words">{row.title}</strong>
      <small className="block text-[--tsugi-muted]">{statusLabel(kind,row.status)} · {row.progress}{row.total>0?' / '+row.total:''} {kind==='manga'?<Trans id="chapters">chapters</Trans>:<Trans id="episodes">episodes</Trans>}
      {row.format&&<> · {row.format}</>}{row.score>0&&<> · {row.score}/10</>}{isAssigned?.(row)&&<> · <Trans id="Source selected">Source selected</Trans></>}</small>
      {kind==='manga'&&(row.volumesRead>0||row.volumesTotal>0)&&<small className="block text-[--tsugi-muted]">{row.volumesRead}{row.volumesTotal>0?' / '+row.volumesTotal:''} <Trans id="volumes">volumes</Trans></small>}</>;}
  return <section className="space-y-4 min-w-0" data-ui="mal-collection" data-mal-kind={kind}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0"><h2 className="text-xl font-semibold">{kind==='manga'?<Trans id="MyAnimeList manga">MyAnimeList manga</Trans>:<Trans id="Anime collection">Anime collection</Trans>}</h2>
        <p className="text-sm text-[--tsugi-muted]"><Trans id="Import a local MyAnimeList export. No account login or remote list changes are needed.">Import a local MyAnimeList export. No account login or remote list changes are needed.</Trans></p></div>
      <div className="flex flex-wrap gap-2">
        <input ref={fileInput} type="file" className="sr-only" tabIndex={-1} accept=".xml,.xml.gz,application/xml,application/gzip" aria-label={t({ id: "Choose MyAnimeList export", message: "Choose MyAnimeList export" })} disabled={locked} onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';void chooseFile(file);}}/>
        <button type="button" className="tsugi-read-action" disabled={locked} onClick={()=>fileInput.current?.click()}><Trans id="Import MAL list">Import MAL list</Trans></button>
      </div>
    </div>
    <p className="text-sm text-[--tsugi-muted]">{onReviewedImport?<Trans id="MAL snapshot reviewed reimport">Imported status, progress and scores are snapshots, not live tracking. Existing titles are kept unless you explicitly select a replacement after reviewing the changes. Source matches are never inferred from a title or MAL ID alone.</Trans>:<Trans id="Imported status, progress and scores are a snapshot, not live tracking. Existing entries are kept on reimport. Source matches are never inferred from a title or MAL ID alone.">Imported status, progress and scores are a snapshot, not live tracking. Existing entries are kept on reimport. Source matches are never inferred from a title or MAL ID alone.</Trans>}</p>
    {reading&&<p role="status"><Trans id="Reading list…">Reading list…</Trans></p>}
    {fileError&&<p role="alert">{fileError}</p>}
    {preview&&<section className="space-y-2" data-ui="mal-import-preview">
      <h3 className="font-semibold"><Trans id="Review MAL import">Review MAL import</Trans></h3>
      <p><Trans id="New titles:">New titles:</Trans> {added} · <Trans id="Already imported:">Already imported:</Trans> {preview.length-added}</p>
      <ul className="max-h-48 overflow-auto">{preview.slice(0,12).map(row=><li key={row.malId} className="tsugi-read-row"><span className="min-w-0 break-words">{row.title}</span><small>{statusLabel(kind,row.status)}</small></li>)}</ul>
      {preview.length>12&&<p><Trans id="Showing the first 12 titles in this preview.">Showing the first 12 titles in this preview.</Trans></p>}
      {stale&&<p role="alert"><Trans id="MAL import review stale">The collection changed during review. Choose the export again before applying any changes.</Trans></p>}
      {review&&<p><Trans id="MAL unchanged snapshots">Unchanged:</Trans> {review.unchanged} · <Trans id="MAL changed snapshots">Changed:</Trans> {conflicts.length} · <Trans id="MAL selected replacements">Selected replacements:</Trans> {replacements.size}</p>}
      {!!conflicts.length&&<section className="space-y-3" data-ui="mal-reimport-conflicts" aria-label={t({id:'MAL changed snapshot review',message:'Review changed manga snapshots'})}>
        <p><Trans id="MAL snapshot replacement scope">Nothing is selected by default. Replacing a snapshot may lower or reset its imported progress, but never changes local chapters, source assignments or your MAL account.</Trans></p>
        {conflicts.slice(conflictPage*20,conflictPage*20+20).map(({current,incoming})=><div className="space-y-2 border-b border-[--tsugi-line] pb-3" key={current.malId} data-mal-conflict={current.malId}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><p className="text-sm text-[--tsugi-muted]"><Trans id="MAL current snapshot">Current snapshot</Trans></p>{snapshot(current)}</div>
            <div><p className="text-sm text-[--tsugi-muted]"><Trans id="MAL incoming snapshot">Imported snapshot</Trans></p>{snapshot(incoming)}</div>
          </div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={replacements.has(current.malId)} disabled={locked||stale} onChange={event=>chooseReplacement(current.malId,event.target.checked)}/><span><Trans id="MAL replace snapshot">Use imported snapshot</Trans> · {incoming.title}</span></label>
        </div>)}
        {conflictPages>1&&<div className="flex items-center flex-wrap gap-2">
          <button type="button" className="tsugi-read-action" disabled={locked||conflictPage===0} onClick={()=>setConflictPage(n=>n-1)}><Trans id="Previous">Previous</Trans></button>
          <span>{conflictPage+1} / {conflictPages}</span>
          <button type="button" className="tsugi-read-action" disabled={locked||conflictPage+1>=conflictPages} onClick={()=>setConflictPage(n=>n+1)}><Trans id="Next">Next</Trans></button>
        </div>}
      </section>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="tsugi-read-action" disabled={locked||stale||(added===0&&replacements.size===0)} onClick={()=>void run(async()=>{
          const replaced=replacements.size;
          if(review&&onReviewedImport)await onReviewedImport(review,[...replacements]);
          else await onImport(preview);
          clearPreview();setPage(0);setNotice(replaced?t({id:'MAL reviewed snapshots saved',message:'MAL collection saved with the selected snapshot replacements.'}):t({ id: "MAL collection saved. Existing titles were kept.", message: "MAL collection saved. Existing titles were kept." }));
        })}><Trans id="Import reviewed list">Import reviewed list</Trans></button>
        <button type="button" className="tsugi-read-action" disabled={locked} onClick={clearPreview}><Trans id="Cancel">Cancel</Trans></button>
      </div>
    </section>}
    {notice&&<p role="status">{notice}</p>}
    {!!entries.length&&<>
      <div className="flex flex-wrap gap-2 items-center">
        <input className="tsugi-read-input min-w-0 grow" maxLength={200} value={filter} aria-label={t({ id: "Filter imported titles", message: "Filter imported titles" })} placeholder={t({ id: "Filter imported titles", message: "Filter imported titles" })} onChange={event=>{setFilter(event.target.value);setPage(0);}}/>
        <select className="tsugi-read-input min-w-0" value={status} aria-label={t({ id: "Imported status", message: "Imported status" })} onChange={event=>{setStatus(event.target.value as MalStatus|'');setPage(0);}}>
          <option value=""><Trans id="All statuses">All statuses</Trans></option>{(['active','completed','on-hold','dropped','planned'] as const).map(value=><option key={value} value={value}>{statusLabel(kind,value)}</option>)}
        </select>
        {kind==='anime'&&!formatScope&&<select className="tsugi-read-input min-w-0" value={format} aria-label={t({ id: "Anime format", message: "Anime format" })} onChange={event=>{setFormat(event.target.value);setPage(0);}}>
          <option value=""><Trans id="All anime">All anime</Trans></option><option value="series"><Trans id="Series and specials">Series and specials</Trans></option><option value="movie"><Trans id="Movies">Movies</Trans></option>
        </select>}
      </div>
      <p className="text-sm text-[--tsugi-muted]">{filtered.length} / {entries.length} <Trans id="imported titles">imported titles</Trans></p>
      <div className={kind==='anime'?'tsugi-anime-grid':'contents'}>
      {filtered.slice(current*60,current*60+60).map(row=><div className="tsugi-read-row flex-wrap gap-2" key={row.malId}>
        {onSelect?<button type="button" className="flex-1 min-w-0 text-left" data-mal-id={row.malId} aria-pressed={selectedId===row.malId} disabled={locked} onClick={()=>{setRemoveId(null);onSelect(row);}}>{titleContent(row)}</button>:
          <div className="flex-1 min-w-0 text-left" data-mal-id={row.malId}>{titleContent(row)}</div>}
        {removeId===row.malId?<div className="flex flex-wrap items-center gap-2"><small><Trans id="Remove this imported entry only?">Remove this imported entry only?</Trans></small><button type="button" className="tsugi-read-action" disabled={locked} onClick={()=>void run(async()=>{await onRemove(row.malId);setRemoveId(null);})}><Trans id="Confirm removal">Confirm removal</Trans></button><button type="button" className="tsugi-read-action" disabled={locked} onClick={()=>setRemoveId(null)}><Trans id="Cancel">Cancel</Trans></button></div>:
          <button type="button" className="tsugi-read-action" disabled={locked} onClick={()=>setRemoveId(row.malId)}><Trans id="Remove">Remove</Trans></button>}
      </div>)}
      </div>
      {!filtered.length&&<p><Trans id="No imported titles match these filters.">No imported titles match these filters.</Trans></p>}
      {pages>1&&<div className="flex flex-wrap items-center gap-2">
        <button type="button" className="tsugi-read-action" disabled={locked||current===0} onClick={()=>setPage(current-1)}><Trans id="Previous">Previous</Trans></button>
        <span>{current+1} / {pages}</span><button type="button" className="tsugi-read-action" disabled={locked||current+1>=pages} onClick={()=>setPage(current+1)}><Trans id="Next">Next</Trans></button>
      </div>}
    </>}
    {!entries.length&&!preview&&!reading&&<p className="text-sm text-[--tsugi-muted]"><Trans id="No imported titles yet.">No imported titles yet.</Trans></p>}
  </section>;
}
