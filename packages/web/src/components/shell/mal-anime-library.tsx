import React from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { MalCollectionPanel } from './mal-collection-panel';
import { AnimeDiscovery } from './anime-discovery';
import { WatchCatalogueBoard } from './watch-catalogue-board';
import { PublicAnimeDiscovery } from './anime-public-discovery';
import { Artwork, WideCard } from '@/components/media/cards';
import { MediaRow } from '@/components/media/media-row';
import { Button } from '@aiostreams/ui/button';
import { LandscapeDecoration } from '@/components/landscape-decoration';
import { AnimeCover } from './anime-cover';
import { RefractSettings } from './refract-settings';
import { storage } from '@/lib/storage';
import { type MalEntry } from '@/lib/mal-collection';
import { listMalAnime, importMalAnime, removeMalAnime, matchMalAnime, unmatchMalAnime, listWatchHistory, loadAddonCatalog, type AddonSource, type CatalogPage, type MalAnimeCollection, type WatchHistoryEntry, type WatchProgress } from '@/lib/hosts/shell/stremio';
import './anime-hub.css';
import { useResumeArtwork } from '@/lib/hosts/shell/watch-artwork';

type Item=CatalogPage['items'][number];
type View='home'|'discover'|'movies'|'seasonal'|'list'|'history'|'connections';
type Props={
  profileId:number; sources:AddonSource[]; busy:boolean;historyActive:boolean;setupOnly?:boolean;detailOpen?:boolean;
  run(work:()=>Promise<void>):Promise<void>;
  openTitle(item:Item,sourceId?:number):void; openHistory(progress:WatchProgress):void;clearTitle():void; openAddons():void;
};
const artwork=['/design/anime/hero-kagezora.webp','/design/anime/art-neon.webp','/design/anime/art-torii.webp','/design/anime/art-train.webp'];
const identity=(mediaType:string,id:string)=>JSON.stringify([mediaType,id]);

function Shelf({title,rows,busy,onSelect,covers}:{title:string;rows:MalEntry[];busy:boolean;onSelect(row:MalEntry):void;covers:boolean}){
  if(!rows.length)return null;
  return <section className="tsugi-anime-shelf"><h3>{title}</h3><div className="tsugi-anime-track">
    {rows.slice(0,12).map(row=><button type="button" className="tsugi-anime-title" key={row.malId} disabled={busy} onClick={()=>onSelect(row)}>
      <AnimeCover malId={row.malId} enabled={covers}/><strong>{row.title}</strong><small>{row.format} · {row.progress}{row.total?' / '+row.total:''} <Trans id="episodes">episodes</Trans>{row.score>0&&<> · {row.score}/10</>}</small>
    </button>)}
  </div></section>;
}
function HistoryShelf({profileId,rows,busy,open,full=false}:{profileId:number;rows:WatchHistoryEntry[]|null;busy:boolean;open(progress:WatchProgress):void;full?:boolean}){
  const shown=full?rows:rows?.filter(row=>!row.progress.completed).slice(0,12);
  const resumeArt=useResumeArtwork(profileId,shown?.map(row=>row.progress)??[]);
  return <section className="tsugi-anime-shelf" data-ui={full?'anime-history':'anime-continue'}>
    <h3>{full?<Trans id="Anime watch history">Anime watch history</Trans>:<Trans id="Continue watching">Continue watching</Trans>}</h3>
    {shown===null||shown===undefined?<p className="text-sm"><Trans id="Anime history unavailable">Watch history is not available yet. Reload to check your saved progress.</Trans></p>:
      !shown.length?<p className="text-sm"><Trans id="No matched anime history">Watch a matched anime to see its actual playback progress here.</Trans></p>:
      <MediaRow shape="wide">{shown.map(({progress:p})=><WideCard key={JSON.stringify([p.mediaType,p.itemId,p.videoId])} image={resumeArt(p)} title={p.title} subtitle={p.episodeTitle??undefined} watched={p.completed} progress={100*p.positionMs/p.durationMs} onClick={()=>{if(!busy)open(p);}}/>)}</MediaRow>}
  </section>;
}

export function MalAnimeLibrary({profileId,sources,busy,historyActive,setupOnly=false,detailOpen=false,run,openTitle,openHistory,clearTitle,openAddons}:Props){
  const [collection,setCollection]=React.useState<MalAnimeCollection|null>(null);
  const [history,setHistory]=React.useState<WatchHistoryEntry[]|null>(null);
  const [view,setView]=React.useState<View>(setupOnly?'list':'home');
  const [covers,setCovers]=React.useState(()=>storage.get<boolean>('tsugi-anime-cover-lookup-v1')===true);
  const coverEnabled=covers&&historyActive&&!setupOnly;
  const [hero,setHero]=React.useState(0);
  const [featured,setFeatured]=React.useState<Item[]>([]);
  const feature=featured.length?featured[hero%featured.length]:undefined;
  const [selected,setSelected]=React.useState<number|null>(null);
  const [catalogue,setCatalogue]=React.useState('');
  const [query,setQuery]=React.useState('');
  const [page,setPage]=React.useState<CatalogPage|null>(null);
  const [review,setReview]=React.useState<Item|null>(null);
  const [confirmUnmatch,setConfirmUnmatch]=React.useState(false);
  const attempted=React.useRef(false),historyAttempted=React.useRef(false);
  const selectionRef=React.useRef<HTMLElement>(null);
  const seen=React.useRef(new Set<string>());
  const entry=collection?.entries.find(row=>row.malId===selected);
  const link=collection?.matches.find(row=>row.malId===selected);
  const movie=entry?.format.toLowerCase()==='movie';
  const catalogs=sources.filter(source=>source.enabled).flatMap(source=>source.manifest.catalogs.map((catalog,index)=>({source,catalog,key:source.sourceId+':'+index})))
    .filter(({catalog})=>[movie?'movie':'series','anime'].includes(catalog.mediaType)&&
      catalog.extras.some(extra=>extra.name==='search'&&!extra.options.length)&&
      catalog.extras.every(extra=>!extra.required||extra.name==='search'||extra.name==='skip'));
  const chosen=catalogs.find(row=>row.key===catalogue);
  const matchedIds=new Set(collection?.matches.map(row=>identity(row.mediaType,row.itemId))??[]);
  const animeHistory=history?.filter(({progress:p})=>p.mediaType==='anime'||matchedIds.has(identity(p.mediaType,p.itemId)))??null;
  async function reload(){await run(async()=>setCollection(await listMalAnime(profileId)));}
  async function reloadHistory(){await run(async()=>{setHistory(null);setHistory(await listWatchHistory(profileId));});}
  React.useEffect(()=>{
    if(!historyActive)historyAttempted.current=false;
    if(busy||(!historyActive&&!setupOnly))return;
    if(!attempted.current){attempted.current=true;void reload();return;}
    if(historyActive&&collection&&!historyAttempted.current){historyAttempted.current=true;void reloadHistory();}
  },[busy,historyActive,setupOnly,collection!==null]);
  React.useEffect(()=>{if(selected!==null){selectionRef.current?.focus({preventScroll:true});selectionRef.current?.scrollIntoView({block:'nearest'});}},[selected]);
  function reset(){setPage(null);setReview(null);setConfirmUnmatch(false);seen.current.clear();clearTitle();}
  function navigate(next:View){setView(next);setSelected(null);reset();}
  function choose(row:MalEntry){
    if(setupOnly)return;
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
  async function saveMatch(){
    if(!entry||!chosen||!review)return;
    const item=review,sourceId=chosen.source.sourceId;
    let saved=false;
    await run(async()=>{const next=await matchMalAnime(profileId,entry.malId,sourceId,item);setCollection(next);setReview(null);setPage(null);saved=true;});
    if(saved)openTitle(item,sourceId);
  }
  if(!collection&&setupOnly)return <section className="space-y-3" data-ui="mal-anime-library"><h2><Trans id="Anime collection">Anime collection</Trans></h2><button className="tsugi-read-action" disabled={busy} onClick={()=>void reload()}><Trans id="Load anime collection">Load anime collection</Trans></button></section>;
  const rows=collection?.entries??[];
  return <section className="tsugi-anime-hub space-y-5" data-ui="mal-anime-library" hidden={detailOpen} inert={detailOpen}>
    <nav className="tsugi-anime-nav" aria-label={t({id:'Anime Hub sections',message:'Anime Hub sections'})}>
      {([
        ['home',t({id:'Anime Hub',message:'Anime Hub'})],['discover',t({id:'Discover',message:'Discover'})],
        ['movies',t({id:'Anime films',message:'Anime films'})],['seasonal',t`Seasonal`],['list',t({id:'My List',message:'My List'})],
        ['history',t({id:'History',message:'History'})],['connections',t({id:'Connections',message:'Connections'})]
      ] as const).filter(([id])=>!setupOnly||id==='list'||id==='connections').map(([id,label])=><button key={id} type="button" aria-current={view===id?'page':undefined} disabled={busy} onClick={()=>navigate(id)}>{label}</button>)}
    </nav>
    {view==='connections'&&<section className="space-y-4" data-ui="anime-connections">
      <h2><Trans id="Anime connections">Anime connections</Trans></h2>
      <p><Trans id="Anime connections description">Import your MyAnimeList export without signing in, or connect a Refract personal key to track compatible completed movies and individual episodes in this Watch profile.</Trans></p>
      <button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>navigate('list')}><Trans id="Import MyAnimeList anime">Import MyAnimeList anime</Trans></button>
      <RefractSettings key={profileId} profileId={profileId} busy={busy} run={run}/>
      <p><Trans id="Anime cover lookup description">Optional anime covers use the public Tenrai metadata API and the MyAnimeList image CDN. Only visible imported MAL IDs are requested; no progress, scores, profile names or keys are sent.</Trans></p>
      <label className="flex items-start gap-2"><input type="checkbox" checked={covers} onChange={event=>{const next=event.target.checked;storage.set('tsugi-anime-cover-lookup-v1',next);setCovers(next);}}/><span><Trans id="Fetch anime covers">Fetch anime covers</Trans></span></label>
    </section>}
    {view==='home'&&<>
      <section className="tsugi-anime-hero">
        {feature?.background||feature?.poster?<Artwork src={feature.background??feature.poster??null} alt="" className={'tsugi-anime-backdrop tsugi-anime-title-art'+(!feature.background?' tsugi-anime-poster-backdrop':'')}/>:<LandscapeDecoration key={hero} fallback={artwork[hero]} className="tsugi-anime-backdrop" active={historyActive}/>}
        <div className="tsugi-anime-hero-copy"><span className="tsugi-anime-eyebrow"><Trans id="Your next world">Your next world</Trans></span>
          <h2 className="tsugi-anime-heading">{feature?feature.name:<Trans id="Anime Hub">Anime Hub</Trans>}</h2>
          {feature?.description?<p className="line-clamp-3">{feature.description}</p>:<p><Trans id="Anime Hub description">One home for anime series, films and the stories you want to return to. Discover through your addons, or bring your MyAnimeList collection.</Trans></p>}
          <div className="flex flex-wrap gap-2">{feature&&<Button intent="white" className="rounded-full" disabled={busy} onClick={()=>openTitle(feature)}><Trans>Watch</Trans></Button>}<button className="tsugi-anime-primary" disabled={busy} onClick={()=>navigate('discover')}><Trans id="Discover anime">Discover anime</Trans></button><button className="tsugi-read-action" disabled={busy} onClick={()=>navigate('list')}><Trans id="My List">My List</Trans></button></div>
        </div>
        {feature?.poster&&<div className="tsugi-anime-feature-poster"><Artwork src={feature.poster} alt=""/></div>}
        <div className="tsugi-anime-hero-controls"><button type="button" aria-label={t({id:'Previous bundled illustration',message:'Previous bundled illustration'})} onClick={()=>setHero(i=>(i+(featured.length||artwork.length)-1)%(featured.length||artwork.length))}>‹</button><span>{hero%Math.max(1,featured.length||artwork.length)+1} / {featured.length||artwork.length}</span><button type="button" aria-label={t({id:'Next bundled illustration',message:'Next bundled illustration'})} onClick={()=>setHero(i=>(i+1)%(featured.length||artwork.length))}>›</button></div>
      </section>
      <HistoryShelf profileId={profileId} rows={animeHistory} busy={busy} open={openHistory}/>
      {!setupOnly&&!detailOpen&&<PublicAnimeDiscovery active={historyActive} busy={busy} openTitle={openTitle} onFeatured={setFeatured}/>}
      {!setupOnly&&<WatchCatalogueBoard key="anime-home" profileId={profileId} sources={sources} busy={busy} active={historyActive} paused={detailOpen||!!entry} scope="anime" run={run} openTitle={openTitle} openAddons={openAddons}/>}
      <Shelf title={t({id:'Watching in My List',message:'Watching in My List'})} rows={rows.filter(row=>row.status==='active')} busy={busy} onSelect={choose} covers={coverEnabled}/>
      <Shelf title={t({id:'Anime films in My List',message:'Anime films in My List'})} rows={rows.filter(row=>row.format.toLowerCase()==='movie')} busy={busy} onSelect={choose} covers={coverEnabled}/>
      <Shelf title={t({id:'Plan to watch',message:'Plan to watch'})} rows={rows.filter(row=>row.status==='planned')} busy={busy} onSelect={choose} covers={coverEnabled}/>
    </>}
    {view==='movies'&&!setupOnly&&!detailOpen&&<PublicAnimeDiscovery filmsOnly active={historyActive} busy={busy} openTitle={openTitle}/>}
    {view==='movies'&&!setupOnly&&<WatchCatalogueBoard key="anime-films" profileId={profileId} sources={sources} busy={busy} active={historyActive} paused={detailOpen||!!entry} scope="anime-films" run={run} openTitle={openTitle} openAddons={openAddons}/>}
    {view==='seasonal'&&!setupOnly&&!detailOpen&&<PublicAnimeDiscovery key="seasonal" seasonal active={historyActive} busy={busy} openTitle={openTitle}/>}
    {view==='discover'&&!setupOnly&&!detailOpen&&<PublicAnimeDiscovery key="discover" active={historyActive} busy={busy} openTitle={openTitle}/>}
    {view==='discover'&&<AnimeDiscovery profileId={profileId} sources={sources} busy={busy} run={run} openTitle={openTitle} clearTitle={clearTitle} openAddons={openAddons}/>}
    {view==='history'&&<><HistoryShelf profileId={profileId} rows={animeHistory} full busy={busy} open={openHistory}/><button className="tsugi-read-action" disabled={busy} onClick={()=>void reloadHistory()}><Trans id="Reload history">Reload history</Trans></button></>}
    {!collection&&view==='list'&&<button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void reload()}><Trans id="Load anime collection">Load anime collection</Trans></button>}
    {collection&&(view==='home'||view==='list'||view==='movies')&&<MalCollectionPanel key={view} kind="anime" entries={rows} busy={busy} selectedId={selected} run={run} onSelect={setupOnly?undefined:choose} renderArtwork={coverEnabled?row=><AnimeCover malId={row.malId} enabled/>:undefined}
      formatScope={view==='movies'?'movie':undefined} isAssigned={row=>collection.matches.some(match=>match.malId===row.malId)}
      onImport={async entries=>setCollection(await importMalAnime(profileId,entries))}
      onRemove={async id=>{setCollection(await removeMalAnime(profileId,id));if(selected===id){setSelected(null);reset();}}}/>}
    <section className="tsugi-anime-connections" data-ui="anime-connection-shortcuts">
      <button type="button" disabled={busy} onClick={()=>navigate('list')}><strong><Trans id="MyAnimeList">MyAnimeList</Trans></strong><small><Trans id="Anime MAL import shortcut">Import anime list</Trans></small></button>
      <button type="button" disabled={busy} onClick={()=>navigate('connections')}><strong><Trans id="Refract">Refract</Trans></strong><small><Trans id="Anime Refract shortcut">Connect personal key</Trans></small></button>
    </section>
    {setupOnly&&view==='list'&&<p><Trans id="Anime onboarding import note">Imported titles are available in Anime Hub after setup. Choose playback sources there whenever you are ready.</Trans></p>}
    {!setupOnly&&entry&&<section ref={selectionRef} tabIndex={-1} aria-labelledby="mal-source-title" className="tsugi-anime-source space-y-3" data-ui="mal-anime-source">
      <div className="flex flex-wrap items-center justify-between gap-2"><h4 id="mal-source-title" className="break-words">{entry.title}</h4><button className="tsugi-read-action" disabled={busy} onClick={()=>{setSelected(null);reset();}}><Trans id="Close">Close</Trans></button></div>
      <p><Trans id="Anime source matching description">Select a searchable catalogue from your installed addons. Confirm the exact title before choosing a video or episode. Imported episode counts do not set local watch history or send Refract events.</Trans></p>
      {link&&<div className="space-y-2" data-ui="mal-anime-saved-match"><p><Trans id="Saved source">Saved source</Trans> · {link.name} · {sources.find(source=>source.sourceId===link.sourceId)?.manifest.name??t({id:'Unavailable source',message:'Unavailable source'})}</p>
        <div className="flex flex-wrap gap-2"><button className="tsugi-read-action" disabled={busy||!sources.some(source=>source.sourceId===link.sourceId&&source.enabled)} onClick={()=>openTitle({id:link.itemId,name:link.name,mediaType:link.mediaType},link.sourceId)}><Trans id="Open saved anime source">Open saved anime source</Trans></button>
        {!confirmUnmatch?<button className="tsugi-read-action" disabled={busy} onClick={()=>setConfirmUnmatch(true)}><Trans id="Forget anime source">Forget anime source</Trans></button>:<><button className="tsugi-read-action" disabled={busy} onClick={()=>void run(async()=>{setCollection(await unmatchMalAnime(profileId,entry.malId));reset();})}><Trans id="Confirm forget source">Confirm forget source</Trans></button><button className="tsugi-read-action" disabled={busy} onClick={()=>setConfirmUnmatch(false)}><Trans id="Cancel">Cancel</Trans></button></>}
        </div></div>}
      {!catalogs.length?<div className="space-y-2"><p><Trans id="No searchable anime catalogue">No compatible searchable catalogue is enabled. Add or enable an appropriate anime, movie or series addon.</Trans></p><button className="tsugi-read-action" disabled={busy} onClick={openAddons}><Trans id="Manage addons">Manage addons</Trans></button></div>:
      <form className="space-y-2" onSubmit={event=>{event.preventDefault();void run(()=>search());}}>
        <label><Trans id="Search catalogue">Search catalogue</Trans><select className="tsugi-menu-select w-full" aria-label={t({id:'Anime source catalogue',message:'Anime source catalogue'})} value={catalogue} disabled={busy} onChange={event=>{setCatalogue(event.target.value);reset();}}>
          <option value=""><Trans id="Select a catalogue">Select a catalogue</Trans></option>{catalogs.map(row=><option key={row.key} value={row.key}>{row.source.manifest.name} · {row.catalog.name} · {row.catalog.mediaType}</option>)}
        </select></label>
        <input className="tsugi-read-input w-full min-w-0" aria-label={t({id:'Search imported anime',message:'Search imported anime'})} value={query} maxLength={512} disabled={busy} onChange={event=>{setQuery(event.target.value);reset();}}/>
        <button type="submit" className="tsugi-read-action" disabled={busy||!chosen||!query.trim()}><Trans id="Search anime">Search anime</Trans></button>
      </form>}
      {page?.items.map(row=><button key={row.id} type="button" className="tsugi-read-row w-full text-left" aria-pressed={review?.id===row.id} disabled={busy} onClick={()=>{clearTitle();setReview(row);}}><span className="min-w-0 break-words">{row.name}</span><span><Trans id="Review">Review</Trans></span></button>)}
      {page?.items.length===0&&<p><Trans id="No matching anime titles">No matching titles on this catalogue. Try a different source or title.</Trans></p>}
      {page?.nextSkip!=null&&<button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void run(()=>search(page.nextSkip!))}><Trans id="Next page">Next page</Trans></button>}
      {review&&<section className="space-y-2" data-ui="mal-anime-match"><h4><Trans id="Review source match">Review source match</Trans></h4><p>{entry.title} → {review.name}</p><p>{chosen?.source.manifest.name} · {review.mediaType}</p><p><Trans id="Anime match persisted">Confirming saves this source assignment in your Watch profile.</Trans></p><button className="tsugi-read-action" disabled={busy} onClick={()=>void saveMatch()}><Trans id="Save and open matched anime">Save and open matched anime</Trans></button></section>}
    </section>}
  </section>;
}
