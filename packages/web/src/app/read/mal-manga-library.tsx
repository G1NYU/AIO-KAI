import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { readRequest } from '@/lib/hosts/shell/reading';
import { MalCollectionPanel } from '@/components/shell/mal-collection-panel';
import { validateMalEntries, mergeMalEntries, type MalEntry } from '@/lib/mal-collection';
import { isReaderIdentity } from './reader-preferences';

type Source = { id:string; name:string; displayName?:string; lang:string };
type Manga = { id:number|string; sourceId?:string; readerIdentity?:string; title:string; author?:string|null; inLibrary:boolean };
type Details = { manga:Manga; chapters:{id:number}[] };
type Link = { malId:number; mangaId:number; sourceId:string; identity:string };
type Collection = { raw:string|null; entries:MalEntry[]; links:Link[] };
type Props = { busy:boolean; run(work:()=>Promise<void>):Promise<void> } & ({importOnly:true;onOpen?:never;openExtensions?:never}|{importOnly?:false;onOpen(manga:Manga):Promise<void>;openExtensions():void});

const KEY='tsugi-mal-manga-v1';
function sourceId(value:unknown):value is string{
  if(typeof value!=='string'||!(/^-?[1-9][0-9]{0,18}$/).test(value))return false;
  const n=BigInt(value);
  return n>=-9223372036854775808n&&n<=9223372036854775807n;
}
function positive(value:unknown):value is number{
  return typeof value==='number'&&Number.isSafeInteger(value)&&value>0&&value<=2147483647;
}
function decode(raw:string|null):Collection{
  if(raw===null)return {raw,entries:[],links:[]};
  if(raw.length>3*1024*1024||new TextEncoder().encode(raw).length>3*1024*1024)throw Error('mal-store');
  const data=JSON.parse(raw);
  if(!data||Object.keys(data).length!==3||data.version!==1||!Array.isArray(data.links))throw Error('mal-store');
  const entries=validateMalEntries(data.entries,'manga'), ids=new Set(entries.map(entry=>entry.malId));
  const linked=new Set<number>(), identities=new Set<string>();
  if(data.links.length>entries.length)throw Error('mal-store');
  const links:Link[]=data.links.map((row:unknown)=>{
    if(!row||typeof row!=='object'||Array.isArray(row))throw Error('mal-store');
    const r=row as Record<string,unknown>;
    if(Object.keys(r).length!==4||!positive(r.malId)||!ids.has(r.malId)||linked.has(r.malId)||
        !positive(r.mangaId)||!sourceId(r.sourceId)||!isReaderIdentity(r.identity)||identities.has(r.identity))throw Error('mal-store');
    linked.add(r.malId);identities.add(r.identity);
    return {malId:r.malId,mangaId:r.mangaId,sourceId:r.sourceId,identity:r.identity};
  });
  return {raw,entries,links};
}
function load():Collection{return decode(localStorage.getItem(KEY));}
function safeLoad():Collection|null{try{return load();}catch{return null;}}
function persist(current:Collection,entries:MalEntry[],links:Link[]):Collection{
  if(localStorage.getItem(KEY)!==current.raw)throw Error('mal-stale');
  const next=decode(JSON.stringify({version:1,entries,links}));
  if(next.raw===null)throw Error('mal-store');
  localStorage.setItem(KEY,next.raw);
  if(localStorage.getItem(KEY)!==next.raw)throw Error('mal-store');
  return next;
}
function identify(manga:Manga,malId:number,selectedSource:string):Link{
  const mangaId=Number(manga.id);
  if(!positive(mangaId)||manga.sourceId!==selectedSource||!sourceId(selectedSource)||!isReaderIdentity(manga.readerIdentity))
    throw Error('mal-source-identity');
  return {malId,mangaId,sourceId:selectedSource,identity:manga.readerIdentity};
}
function same(a:Link,b:Link){return a.malId===b.malId&&a.mangaId===b.mangaId&&a.sourceId===b.sourceId&&a.identity===b.identity;}

export function MalMangaLibrary({busy,run,onOpen,openExtensions,importOnly=false}:Props){
  const [collection,setCollection]=React.useState(safeLoad);
  const [selected,setSelected]=React.useState<number|null>(null);
  const [sources,setSources]=React.useState<Source[]|null>(null);
  const [source,setSource]=React.useState('');
  const [query,setQuery]=React.useState('');
  const [results,setResults]=React.useState<{mangas:Manga[];hasNextPage:boolean;page:number}|null>(null);
  const [review,setReview]=React.useState<Details|null>(null);
  const selectionRef=React.useRef<HTMLElement>(null);
  const entry=collection?.entries.find(row=>row.malId===selected);
  const link=collection?.links.find(row=>row.malId===selected);
  React.useEffect(()=>{if(selected!==null)selectionRef.current?.scrollIntoView({block:'nearest'});},[selected]);
  function update(entries:MalEntry[],links:Link[]){
    if(!collection)throw Error(t({ id:'MAL collection unavailable',message: 'Reload the imported collection before changing it.'}));
    try{setCollection(persist(collection,entries,links));}
    catch{throw Error(t({ id:'MAL collection save failed',message: 'The imported collection could not be confirmed saved. Reload before retrying.'}));}
  }
  async function inventory(){
    setSources(null);setSource('');setResults(null);setReview(null);
    const data=await readRequest<{nodes:Source[];complete:boolean}>({kind:'source-inventory'});
    if(data.complete!==true||!Array.isArray(data.nodes))throw Error(t({ id:'MAL source inventory incomplete',message: 'The installed source inventory is incomplete. Reload it before choosing a source.'}));
    setSources(data.nodes.filter(row=>sourceId(row.id)));
  }
  function choose(row:MalEntry){
    setSelected(row.malId);setQuery(row.title.slice(0,200));void run(inventory);
  }
  async function search(page=1){
    if(!sources?.some(row=>row.id===source)||!query.trim())return;
    setReview(null);setResults(null);
    const response=await readRequest<{mangas:Manga[];hasNextPage:boolean}>({kind:'catalogue',source,mode:'search',page,query:query.trim()});
    if(!Array.isArray(response.mangas)||typeof response.hasNextPage!=='boolean')throw Error(t({ id:'MAL invalid search',message: 'The source returned an invalid result.'}));
    setResults({...response,page});
  }
  async function inspect(manga:Manga){
    if(!entry)return;
    setReview(null);
    const id=Number(manga.id);
    if(!positive(id))throw Error(t({ id:'Invalid manga identifier.',message: 'Invalid manga identifier.'}));
    const data=await readRequest<Details>({kind:'manga',id});
    const identity=identify(data.manga,entry.malId,source);
    if(identity.mangaId!==id||!Array.isArray(data.chapters)||!data.chapters.length)
      throw Error(t({ id:'MAL no confirmed chapters',message: 'This match has no confirmed chapters. Choose a different result.'}));
    setReview(data);
  }
  async function openSaved(){
    if(!link||!entry)return;
    const data=await readRequest<Details>({kind:'cached-manga',id:link.mangaId});
    if(!data.manga.inLibrary||!same(identify(data.manga,entry.malId,link.sourceId),link))
      throw Error(t({ id:'MAL source match unavailable',message: 'The saved source is no longer available. Choose a source again.'}));
    await onOpen?.(data.manga);
  }
  async function apply(){
    if(!entry||!review||!collection)return;
    const match=identify(review.manga,entry.malId,source);
    if(collection.links.some(row=>row.malId!==match.malId&&row.identity===match.identity))
      throw Error(t({ id:'MAL duplicate source match',message: 'This source title is already assigned to a different imported manga.'}));
    const fresh=await readRequest<Details>({kind:'cached-manga',id:match.mangaId});
    if(!same(identify(fresh.manga,entry.malId,source),match)||fresh.manga.title!==review.manga.title||
        !Array.isArray(fresh.chapters)||!fresh.chapters.length)throw Error(t({ id:'MAL stale source match',message: 'The source match changed. Review it again.'}));
    if(load().raw!==collection.raw)throw Error(t({ id:'MAL collection changed',message: 'The imported collection changed. Reload it before retrying.'}));
    if(!fresh.manga.inLibrary){
      const saved=await readRequest<{manga:Manga}>({kind:'set-library',id:match.mangaId,inLibrary:true});
      if(!saved.manga.inLibrary)throw Error(t({ id:'Library addition not confirmed.',message: 'Library addition not confirmed.'}));
    }
    const verified=await readRequest<Details>({kind:'cached-manga',id:match.mangaId});
    if(!verified.manga.inLibrary||!same(identify(verified.manga,entry.malId,source),match))
      throw Error(t({ id:'MAL source verification failed',message: 'The Reader could not verify the saved source. Review it again.'}));
    try{update(collection.entries,[...collection.links.filter(row=>row.malId!==entry.malId),match]);}
    catch{throw Error(t({ id:'MAL source saved assignment unconfirmed',message: 'The title was saved in Reader, but the MAL assignment could not be confirmed. Reload the collection and review it again.'}));}
    await onOpen?.(verified.manga);
  }
  if(!collection)return <section className="space-y-3"><p role="alert"><Trans id="MAL collection read failed">The imported manga collection could not be read. It has not been reset.</Trans></p><button className="tsugi-read-action" disabled={busy} onClick={()=>setCollection(safeLoad())}><Trans id="Reload imported collection">Reload imported collection</Trans></button></section>;
  return <div className="space-y-5" data-ui="mal-manga-library">
    <MalCollectionPanel kind="manga" entries={collection.entries} busy={busy} selectedId={selected} run={run}
      onSelect={importOnly?undefined:choose} isAssigned={row=>collection.links.some(link=>link.malId===row.malId)}
      onImport={async entries=>{update(mergeMalEntries(collection.entries,entries,'manga'),collection.links);}}
      onRemove={async id=>{update(collection.entries.filter(row=>row.malId!==id),collection.links.filter(row=>row.malId!==id));if(selected===id){setSelected(null);setReview(null);setResults(null);}}}/>
    {importOnly&&<p><Trans id="MAL manga onboarding note">Choose reading sources in Reader after setup. Imported titles do not require a running reading engine.</Trans></p>}
    {!importOnly&&entry&&<section ref={selectionRef} className="space-y-3" data-ui="mal-manga-source">
      <div className="flex flex-wrap gap-2 items-center justify-between"><h3 className="font-semibold break-words"><Trans id="Choose a reading source">Choose a reading source</Trans> · {entry.title}</h3><button className="tsugi-read-action" disabled={busy} onClick={()=>setSelected(null)}><Trans id="Close">Close</Trans></button></div>
      <p><Trans id="MAL chapter counts are kept separately. Choosing a source does not mark chapters read or change your MAL account.">MAL chapter counts are kept separately. Choosing a source does not mark chapters read or change your MAL account.</Trans></p>
      {link&&<button className="tsugi-read-action" disabled={busy} onClick={()=>void run(openSaved)}><Trans id="Open saved source">Open saved source</Trans></button>}
      <div className="flex flex-wrap gap-2">
        <button className="tsugi-read-action" disabled={busy} onClick={()=>void run(inventory)}><Trans id="Reload installed sources">Reload installed sources</Trans></button>
        <button className="tsugi-read-action" disabled={busy} onClick={openExtensions}><Trans id="Browse extensions">Browse extensions</Trans></button>
      </div>
      {sources?.length===0&&<p><Trans id="Install an extension from a trusted repository first.">Install an extension from a trusted repository first.</Trans></p>}
      {!!sources?.length&&<form className="flex flex-wrap gap-2" onSubmit={event=>{event.preventDefault();void run(()=>search());}}>
        <select className="tsugi-read-input min-w-0" aria-label={t({ id:'MAL reading source',message: 'Reading source'})} value={source} disabled={busy} onChange={event=>{setSource(event.target.value);setReview(null);setResults(null);}}>
          <option value=""><Trans id="Select a source">Select a source</Trans></option>{sources.map(row=><option key={row.id} value={row.id}>{row.displayName||row.name} · {row.lang}</option>)}
        </select>
        <input className="tsugi-read-input min-w-0 grow" maxLength={200} aria-label={t({ id:'MAL source title search',message: 'Search imported manga'})} value={query} disabled={busy} onChange={event=>{setQuery(event.target.value);setReview(null);setResults(null);}}/>
        <button className="tsugi-read-action" disabled={busy||!source||!query.trim()}><Trans id="Search source">Search source</Trans></button>
      </form>}
      {results?.mangas.map(row=><button key={row.id} type="button" className="tsugi-read-row w-full text-left" disabled={busy} onClick={()=>void run(()=>inspect(row))}><span className="min-w-0 break-words">{row.title}{row.author&&<small className="block">{row.author}</small>}</span><span><Trans id="Review">Review</Trans></span></button>)}
      {results?.mangas.length===0&&<p><Trans id="No matches on this source. Try another title or extension.">No matches on this source. Try another title or extension.</Trans></p>}
      {results?.hasNextPage&&results.page<100&&<button className="tsugi-read-action" disabled={busy} onClick={()=>void run(()=>search(results.page+1))}><Trans id="Next page">Next page</Trans></button>}
      {review&&<section className="space-y-2" data-ui="mal-manga-match"><h4><Trans id="Review source match">Review source match</Trans></h4><p>{entry.title} → {review.manga.title}</p><p>{review.chapters.length} <Trans id="chapters found">chapters found</Trans></p><button className="tsugi-read-action" disabled={busy} onClick={()=>void run(apply)}><Trans id="Save source and open manga">Save source and open manga</Trans></button></section>}
    </section>}
  </div>;
}
