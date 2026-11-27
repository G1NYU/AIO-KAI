import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { readMalFile, type MalEntry, type MalKind, type MalStatus } from '@/lib/mal-collection';

type Props = {
  kind: MalKind; entries: MalEntry[]; busy: boolean; selectedId: number | null;
  run(work:()=>Promise<void>):Promise<void>;
  onImport(entries:MalEntry[]):Promise<void>; onSelect?(entry:MalEntry):void; renderArtwork?:(entry:MalEntry)=>React.ReactNode;
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

export function MalCollectionPanel({kind,entries,busy,selectedId,run,onImport,onSelect,onRemove,isAssigned,formatScope,renderArtwork}:Props){
  const [preview,setPreview]=React.useState<MalEntry[]|null>(null);
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
  const added=preview?.filter(row=>!existing.has(row.malId)).length??0;
  async function chooseFile(file?:File){
    if(!file||locked)return;
    const id=++request.current;
    setReading(true);setPreview(null);setNotice('');setFileError('');
    try{
      const next=await readMalFile(file,kind);
      if(id===request.current)setPreview(next);
    }catch{
      if(id===request.current)setFileError(kind==='manga'?t({ id: "Choose a valid MyAnimeList manga export (.xml or .xml.gz, up to 8 MiB and 3,000 titles).", message: "Choose a valid MyAnimeList manga export (.xml or .xml.gz, up to 8 MiB and 3,000 titles)." }):
        t({ id: "Choose a valid MyAnimeList anime export (.xml or .xml.gz, up to 8 MiB and 3,000 titles).", message: "Choose a valid MyAnimeList anime export (.xml or .xml.gz, up to 8 MiB and 3,000 titles)." }));
    }finally{
      if(id===request.current)setReading(false);
    }
  }
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
    <p className="text-sm text-[--tsugi-muted]"><Trans id="Imported status, progress and scores are a snapshot, not live tracking. Existing entries are kept on reimport. Source matches are never inferred from a title or MAL ID alone.">Imported status, progress and scores are a snapshot, not live tracking. Existing entries are kept on reimport. Source matches are never inferred from a title or MAL ID alone.</Trans></p>
    {reading&&<p role="status"><Trans id="Reading list…">Reading list…</Trans></p>}
    {fileError&&<p role="alert">{fileError}</p>}
    {preview&&<section className="space-y-2" data-ui="mal-import-preview">
      <h3 className="font-semibold"><Trans id="Review MAL import">Review MAL import</Trans></h3>
      <p><Trans id="New titles:">New titles:</Trans> {added} · <Trans id="Already imported:">Already imported:</Trans> {preview.length-added}</p>
      <ul className="max-h-48 overflow-auto">{preview.slice(0,12).map(row=><li key={row.malId} className="tsugi-read-row"><span className="min-w-0 break-words">{row.title}</span><small>{statusLabel(kind,row.status)}</small></li>)}</ul>
      {preview.length>12&&<p><Trans id="Showing the first 12 titles in this preview.">Showing the first 12 titles in this preview.</Trans></p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="tsugi-read-action" disabled={locked||added===0} onClick={()=>void run(async()=>{
          await onImport(preview);setPreview(null);setPage(0);setNotice(t({ id: "MAL collection saved. Existing titles were kept.", message: "MAL collection saved. Existing titles were kept." }));
        })}><Trans id="Import reviewed list">Import reviewed list</Trans></button>
        <button type="button" className="tsugi-read-action" disabled={locked} onClick={()=>setPreview(null)}><Trans id="Cancel">Cancel</Trans></button>
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
