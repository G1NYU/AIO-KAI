import React from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { MalCollectionPanel } from './mal-collection-panel';
import { type MalEntry } from '@/lib/mal-collection';
import { listMalAnime, importMalAnime, removeMalAnime, loadAddonCatalog, type AddonSource, type CatalogPage } from '@/lib/hosts/shell/stremio';

type Item=CatalogPage['items'][number];
type Props={
  profileId:number; sources:AddonSource[]; busy:boolean;
  run(work:()=>Promise<void>):Promise<void>;
  openTitle(item:Item):void; clearTitle():void; openAddons():void;
};
export function MalAnimeLibrary({profileId,sources,busy,run,openTitle,clearTitle,openAddons}:Props){
  const [entries,setEntries]=React.useState<MalEntry[]|null>(null);
  const [selected,setSelected]=React.useState<number|null>(null);
  const [catalogue,setCatalogue]=React.useState('');
  const [query,setQuery]=React.useState('');
  const [page,setPage]=React.useState<CatalogPage|null>(null);
  const [review,setReview]=React.useState<Item|null>(null);
  const attempted=React.useRef(false);
  const selectionRef=React.useRef<HTMLElement>(null);
  const seen=React.useRef(new Set<string>());
  const entry=entries?.find(row=>row.malId===selected);
  const movie=entry?.format.toLowerCase()==='movie';
  const catalogs=sources.filter(source=>source.enabled).flatMap(source=>source.manifest.catalogs.map((catalog,index)=>({source,catalog,key:source.sourceId+':'+index})))
    .filter(({catalog})=>[movie?'movie':'series','anime'].includes(catalog.mediaType)&&
      catalog.extras.some(extra=>extra.name==='search'&&!extra.options.length)&&
      catalog.extras.every(extra=>!extra.required||extra.name==='search'||extra.name==='skip'));
  const chosen=catalogs.find(row=>row.key===catalogue);
  async function reload(){await run(async()=>setEntries(await listMalAnime(profileId)));}
  React.useEffect(()=>{if(!busy&&!attempted.current){attempted.current=true;void reload();}},[busy]);
  React.useEffect(()=>{if(selected!==null)selectionRef.current?.scrollIntoView({block:'nearest'});},[selected]);
  function reset(){setPage(null);setReview(null);seen.current.clear();clearTitle();}
  function choose(row:MalEntry){
    setSelected(row.malId);setQuery(row.title);setCatalogue('');reset();
  }
  async function search(skip=0){
    if(!chosen||!entry||!query.trim())return;
    setReview(null);clearTitle();
    if(skip===0){setPage(null);seen.current.clear();}
    const extras:Record<string,string>={search:query.trim()};
    if(chosen.catalog.extras.some(extra=>extra.name==='skip'&&(skip>0||extra.required)))extras.skip=String(skip);
    const next=await loadAddonCatalog(profileId,{kind:'catalog',sourceId:chosen.source.sourceId,mediaType:chosen.catalog.mediaType,catalogId:chosen.catalog.id,extras});
    const fingerprint=JSON.stringify(next.items.map(row=>row.id).sort());
    if(seen.current.has(fingerprint))setPage({...next,nextSkip:null});
    else{seen.current.add(fingerprint);setPage(next);}
  }
  if(!entries)return <section className="space-y-3" data-ui="mal-anime-library"><h2><Trans>Anime collection</Trans></h2><button className="tsugi-read-action" disabled={busy} onClick={()=>void reload()}><Trans>Load anime collection</Trans></button></section>;
  return <section className="space-y-5" data-ui="mal-anime-library">
    <MalCollectionPanel kind="anime" entries={entries} busy={busy} selectedId={selected} run={run} onSelect={choose}
      onImport={async rows=>setEntries(await importMalAnime(profileId,rows))}
      onRemove={async id=>{setEntries(await removeMalAnime(profileId,id));if(selected===id){setSelected(null);reset();}}}/>
    {entry&&<section ref={selectionRef} className="space-y-3" data-ui="mal-anime-source">
      <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="break-words">{entry.title}</h4><button className="tsugi-read-action" disabled={busy} onClick={()=>{setSelected(null);reset();}}><Trans>Close</Trans></button></div>
      <p><Trans>Select a searchable catalogue from your installed addons. Confirm the exact title before choosing a video or episode. Imported episode counts do not set local watch history or send Refract events.</Trans></p>
      {!catalogs.length?<div className="space-y-2"><p><Trans>No compatible searchable catalogue is enabled. Add or enable an appropriate anime, movie or series addon.</Trans></p><button className="tsugi-read-action" disabled={busy} onClick={openAddons}><Trans>Manage addons</Trans></button></div>:
      <form className="space-y-2" onSubmit={event=>{event.preventDefault();void run(()=>search());}}>
        <label><Trans>Search catalogue</Trans><select className="tsugi-menu-select w-full" aria-label={t`Anime source catalogue`} value={catalogue} disabled={busy} onChange={event=>{setCatalogue(event.target.value);reset();}}>
          <option value=""><Trans>Select a catalogue</Trans></option>{catalogs.map(row=><option key={row.key} value={row.key}>{row.source.manifest.name} · {row.catalog.name} · {row.catalog.mediaType}</option>)}
        </select></label>
        <input className="tsugi-read-input w-full min-w-0" aria-label={t`Search imported anime`} value={query} maxLength={512} disabled={busy} onChange={event=>{setQuery(event.target.value);reset();}}/>
        <button type="submit" className="tsugi-read-action" disabled={busy||!chosen||!query.trim()}><Trans>Search anime</Trans></button>
      </form>}
      {page?.items.map(row=><button key={row.id} type="button" className="tsugi-read-row w-full text-left" aria-pressed={review?.id===row.id} disabled={busy} onClick={()=>{clearTitle();setReview(row);}}><span className="min-w-0 break-words">{row.name}</span><span><Trans>Review</Trans></span></button>)}
      {page?.items.length===0&&<p><Trans>No matching titles on this catalogue. Try a different source or title.</Trans></p>}
      {page?.nextSkip!=null&&<button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void run(()=>search(page.nextSkip!))}><Trans>Next page</Trans></button>}
      {review&&<section className="space-y-2" data-ui="mal-anime-match"><h4><Trans>Review source match</Trans></h4><p>{entry.title} → {review.name}</p><p>{review.mediaType}</p><button className="tsugi-read-action" disabled={busy} onClick={()=>openTitle(review)}><Trans>Open matched anime</Trans></button></section>}
    </section>}
  </section>;
}
