import React from 'react';
import { createPortal } from 'react-dom';
import { searchPublicAnime } from './anime-public-discovery';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { MovieGlyph } from '@/components/movie-icons';
import { Artwork, PosterCard, WideCard } from '@/components/media/cards';
import { BackdropFrame } from '@/components/media/hero';
import { Button } from '@aiostreams/ui/button';
import { MediaRow } from '@/components/media/media-row';
import { publicCinemeta, loadAddonCatalog, listWatchHistory, searchTmdb, loadTmdbTitle, type TmdbTitle, type AddonSource, type CatalogPage, type WatchHistoryEntry, type WatchProgress } from '@/lib/hosts/shell/stremio';
import { rankCatalogueSearch, searchAliasTargets } from '@/lib/hosts/shell/watch-search';
import './watch-catalogue-board.css';
import { useResumeArtwork } from '@/lib/hosts/shell/watch-artwork';

type Item=CatalogPage['items'][number];
type Scope='all'|'anime'|'anime-films';
type Kind='all'|'movie'|'series'|'anime';
type Target={key:string;source:AddonSource;catalog:AddonSource['manifest']['catalogs'][number];extras:Record<string,string>};
type Row={page?:CatalogPage;error?:boolean;loading?:boolean;skip:number;pageSkip?:number;repeated?:boolean};
type Props={
  profileId:number;sources:AddonSource[];busy:boolean;active:boolean;paused:boolean;
  scope?:Scope;includeHistory?:boolean;initialQuery?:string;searchMount?:HTMLElement|null;searchOnly?:boolean;run(work:()=>Promise<void>):Promise<void>;
  openTitle(item:Item,sourceId?:number):void;openHistory?(progress:WatchProgress):void;openAddons():void;
};
const BATCH=6;
const SEARCH_BATCH=24;
const PARALLEL=4;
const RESULT_BATCH=48;
const animeWord=/(^|[^a-z])(anime|mal|anilist|kitsu|crunchyroll|funimation)([^a-z]|$)/i;

// The Board requests declared catalogues that can be queried without
// guessing required filters. Search only calls catalogues declaring search.
// Anime rows require an anime declaration, label or exact genre option.
export function catalogueTargets(sources:AddonSource[],scope:Scope,kind:Kind,query:string):Target[]{
  const rows:Target[]=[];
  const available=scope==='all'&&kind!=='anime'&&!sources.some(s=>s.enabled&&s.manifest.id===publicCinemeta.manifest.id)?[...sources,publicCinemeta]:sources;
  for(const source of available){
    if(!source.enabled||source.manifest.adult||source.manifest.configurationRequired||query&&!source.manifest.resources.includes('meta'))continue;
    for(const catalog of source.manifest.catalogs){
      const normalized=catalog.mediaType==='anime.movie'?'movie':catalog.mediaType==='anime.series'?'series':catalog.mediaType;
      if(!['movie','series','anime'].includes(normalized)||kind!=='all'&&kind!==normalized&&!(kind==='anime'&&catalog.mediaType.startsWith('anime.')))continue;
      const extras:Record<string,string>={};
      const animeGenre=catalog.extras.find(e=>e.name==='genre')?.options.find(o=>o.toLowerCase()==='anime');
      const explicitAnime=(catalog.mediaType==='anime'||catalog.mediaType.startsWith('anime.'))||animeWord.test(catalog.name)||animeWord.test(catalog.id)||animeWord.test(source.manifest.name);
      if(scope!=='all'){
        if(!explicitAnime&&!animeGenre)continue;
        if(scope==='anime-films'&&normalized!=='movie'&&!(catalog.mediaType==='anime'&&/(^|[^a-z])(film|films|movie|movies)([^a-z]|$)/i.test(catalog.name)))continue;
        if(!explicitAnime&&animeGenre)extras.genre=animeGenre;
      }
      if(query){
        const search=catalog.extras.find(e=>e.name==='search');
        if(!search||search.options.length&&!search.options.includes(query))continue;
        extras.search=query;
      }
      if(catalog.extras.some(e=>e.name==='skip'&&e.required))extras.skip='0';
      if(catalog.extras.some(e=>e.required&&!(e.name in extras)))continue;
      if(catalog.extras.some(e=>e.options.length&&e.name in extras&&!e.options.includes(extras[e.name])))continue;
      if(source.sourceId===0&&!query&&rows.some(row=>row.source.sourceId!==0&&row.catalog.mediaType===catalog.mediaType))continue;
      rows.push({key:JSON.stringify([source.sourceId,catalog.mediaType,catalog.id,extras]),source,catalog,extras});
    }
  }
  return rows;
}

function CatalogueRows({profileId,targets,busy,active,paused,run,openTitle,openAddons,includeHistory,openHistory,search,scope='all',kind='all'}:Omit<Props,'sources'> & {targets:Target[];search:string;kind?:Kind}){
  const [limit,setLimit]=React.useState(search?SEARCH_BATCH:BATCH);
  const [resultLimit,setResultLimit]=React.useState(RESULT_BATCH);
  const [tmdb,setTmdb]=React.useState<Item[]>([]);
  const [tmdbPending,setTmdbPending]=React.useState(!!search);
  const checkedAliases=React.useRef(new Set<string>());
  const [featuredMetadata,setFeaturedMetadata]=React.useState<TmdbTitle|null>(null);
  const inFlight=React.useRef(new Set<string>());
  const [rows,setRows]=React.useState<Record<string,Row>>({});
  const [stopped,setStopped]=React.useState(false);
  const [history,setHistory]=React.useState<WatchHistoryEntry[]|null>(null);
  const [historyFailed,setHistoryFailed]=React.useState(false);
  const mounted=React.useRef(false);
  const visible=targets.slice(0,limit);
  React.useEffect(()=>{
    if(!search||!active||paused||scope==='all'&&kind==='anime'){setTmdbPending(false);return;}
    let current=true;const controller=new AbortController();setTmdbPending(true);
    const request=scope==='all'?searchTmdb(profileId,search):searchPublicAnime(search,scope==='anime-films',controller.signal);
    void request.then(items=>{if(current)setTmdb(items.filter(item=>kind==='all'||item.mediaType===kind));}).catch(()=>{}).finally(()=>{if(current)setTmdbPending(false);});
    return ()=>{current=false;controller.abort();};
  },[profileId,search,active,paused,scope,kind]);
  React.useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;};},[]);
  React.useEffect(()=>{if(!active){setHistory(null);setHistoryFailed(false);}},[active]);

  async function load(target:Target,skip:number){
    if(!mounted.current||inFlight.current.has(target.key)||inFlight.current.size>=PARALLEL)return;
    inFlight.current.add(target.key);
    setRows(old=>({...old,[target.key]:{...old[target.key],skip,loading:true,error:false}}));
    try{
      const extras={...target.extras};
      if(target.catalog.extras.some(e=>e.name==='skip')&&(skip>0||'skip' in extras))extras.skip=String(skip);
      const page=await loadAddonCatalog(profileId,{kind:'browse-catalog',sourceId:target.source.sourceId,mediaType:target.catalog.mediaType,catalogId:target.catalog.id,extras});
      if(!mounted.current)return;
      setRows(old=>{
        const previous=old[target.key]?.page;
        if(!search&&skip>0&&previous&&page.items.length===0){
          // An empty next page must not remove a populated shelf or its back path.
          return {...old,[target.key]:{page:{...previous,nextSkip:null},skip:old[target.key]?.pageSkip??0,pageSkip:old[target.key]?.pageSkip??0}};
        }
        const ids=new Set(previous?.items.map(i=>i.id));
        const fresh=page.items.filter(item=>!ids.has(item.id));
        const repeated=skip>0&&!!previous&&page.items.length>0&&(search?fresh.length===0:JSON.stringify(previous.items.map(i=>i.id))===JSON.stringify(page.items.map(i=>i.id)));
        const items=search&&skip>0&&previous?[...previous.items,...fresh]:page.items;
        return {...old,[target.key]:{page:{...page,items,nextSkip:repeated?null:page.nextSkip},skip,pageSkip:skip,repeated}};
      });
    }catch{if(mounted.current)setRows(old=>({...old,[target.key]:{...old[target.key],skip,loading:false,error:true}}));}
    finally{inFlight.current.delete(target.key);}
  }
  React.useEffect(()=>{
    if(!active||paused||busy||stopped)return;
    const next=visible.filter(target=>!rows[target.key]&&!inFlight.current.has(target.key)).slice(0,Math.max(0,PARALLEL-inFlight.current.size));
    if(includeHistory&&history===null&&!historyFailed){
      const timer=window.setTimeout(()=>void run(async()=>{
        try{const result=await listWatchHistory(profileId);if(mounted.current)setHistory(result);}
        catch{if(mounted.current)setHistoryFailed(true);}
      }),100);
      return ()=>window.clearTimeout(timer);
    }
    if(!next.length)return;
    const timer=window.setTimeout(()=>{for(const target of next)void load(target,0);},40);
    return ()=>window.clearTimeout(timer);
  },[active,paused,busy,stopped,rows,limit,targets,includeHistory,history,historyFailed,profileId,run,search]);

  const [heroIndex,setHeroIndex]=React.useState(0);
  const featuredItems=visible.flatMap(target=>rows[target.key]?.page?.items.slice(0,2).map(item=>({target,item}))??[]).filter(row=>row.item.background||row.item.poster).slice(0,8);
  const featured=featuredItems[heroIndex%Math.max(1,featuredItems.length)];
  const featuredId=featured?.item.id,featuredType=featured?.item.mediaType;
  React.useEffect(()=>{setFeaturedMetadata(null);if(!active||paused||!featuredId||!featuredType)return;let current=true;void loadTmdbTitle(profileId,featuredType,featuredId).then(item=>{if(current)setFeaturedMetadata(item);}).catch(()=>{});return ()=>{current=false;};},[profileId,active,paused,featuredId,featuredType]);
  React.useEffect(()=>{
    if(!search||!active||paused||scope!=='all')return;
    const addonItems=Object.values(rows).flatMap(row=>row.page?.items??[]);
    for(const item of searchAliasTargets(tmdb,addonItems)){
      if(checkedAliases.current.has(item.id)||checkedAliases.current.size>=4)continue;
      checkedAliases.current.add(item.id);
      void loadTmdbTitle(profileId,item.mediaType,item.id).then(metadata=>{
        if(!mounted.current||metadata.id!==item.id||!metadata.imdbId)return;
        setTmdb(old=>old.map(row=>row.id===item.id?{...row,imdbId:metadata.imdbId,identities:metadata.identities,poster:row.poster??metadata.poster,background:row.background??metadata.background,logo:metadata.logo}:row));
      }).catch(()=>{});
    }
  },[profileId,search,active,paused,scope,tmdb,rows]);
  const pending=visible.some(target=>!rows[target.key]||rows[target.key].loading);
  const hits=search?rankCatalogueSearch<{sourceId?:number}>([
    ...visible.flatMap(target=>(rows[target.key]?.page?.items??[]).map(item=>({item,target:{sourceId:target.source.sourceId},sourceId:target.source.sourceId}))),
    ...tmdb.map(item=>({item,target:{},sourceId:0,providerMatch:scope!=='all'}))
  ],search):[];
  const searchGroups=[{key:'series',label:t`Series`,items:hits.filter(h=>h.item.mediaType==='series'||h.item.mediaType==='anime.series')},{key:'movie',label:t`Movies`,items:hits.filter(h=>h.item.mediaType==='movie'||h.item.mediaType==='anime.movie')},{key:'anime',label:t`Anime`,items:hits.filter(h=>h.item.mediaType==='anime')}];
  const canRequest=visible.filter(target=>rows[target.key]?.loading).length<PARALLEL;
  const populated=visible.filter(target=>(rows[target.key]?.page?.items.length??0)>0);
  const continuing=history?.filter(row=>!row.progress.completed&&row.progress.positionMs>0).slice(0,12)??[];
  const resumeArt=useResumeArtwork(profileId,includeHistory?continuing.map(row=>row.progress):[]);
  return <>
    {includeHistory&&featured&&<section data-ui="hero" className="tsugi-watch-featured">
      <BackdropFrame className="pointer-events-none tsugi-watch-featured-art">
        <Artwork eager src={[featuredMetadata?.background,featured.item.background,featured.item.poster].filter((value):value is string=>!!value)} alt="" className={featuredMetadata?.background||featured.item.background?'tsugi-watch-featured-backdrop':'tsugi-watch-featured-poster'}/>
      </BackdropFrame>
      <div className="tsugi-watch-featured-copy">
        <small><Trans>Featured</Trans> · {featured.target.catalog.name}</small>
        <h2>{featuredMetadata?.name??featured.item.name}</h2>
        {(featuredMetadata?.description||featured.item.description)&&<p className="line-clamp-3">{featuredMetadata?.description??featured.item.description}</p>}
        <div className="flex flex-wrap items-center gap-2"><Button intent="white" className="rounded-full" disabled={busy} onClick={()=>openTitle(featured.item,featured.target.source.sourceId)}><Trans>View title</Trans></Button>{featuredItems.length>1&&<><button type="button" className="tsugi-read-action" aria-label={t`Previous featured title`} disabled={busy} onClick={()=>setHeroIndex(i=>(i+featuredItems.length-1)%featuredItems.length)}>‹</button><span>{heroIndex%featuredItems.length+1} / {featuredItems.length}</span><button type="button" className="tsugi-read-action" aria-label={t`Next featured title`} disabled={busy} onClick={()=>setHeroIndex(i=>(i+1)%featuredItems.length)}>›</button></>}</div>
      </div>
    </section>}
    {includeHistory&&continuing.length>0&&<section className="tsugi-watch-shelf" data-ui="watch-continue-shelf">
      <MediaRow id={profileId+':watch-resume'} title={t({id:'Continue watching',message:'Continue watching'})} shape="wide">
        {continuing.map(({progress:p})=><WideCard key={JSON.stringify([p.mediaType,p.itemId,p.videoId])} onClick={()=>{if(!busy)openHistory?.(p);}} image={resumeArt(p)} title={p.title} subtitle={p.episodeTitle??undefined} progress={100*p.positionMs/p.durationMs}/>)}
      </MediaRow>
    </section>}
    {includeHistory&&historyFailed&&<p className="tsugi-watch-muted"><Trans>Watch history could not be loaded.</Trans> <button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>setHistoryFailed(false)}><Trans>Retry</Trans></button></p>}
    {search?<section className="tsugi-watch-search-results" data-ui="watch-search-results">
      <div className="tsugi-watch-search-heading"><h3><Trans>Search results</Trans></h3><span>{hits.length} <Trans>titles</Trans></span></div>
      {(pending||tmdbPending)&&<p className="tsugi-watch-muted" role="status"><Trans>Searching metadata…</Trans></p>}
      {hits.length===0&&!pending&&!tmdbPending&&<p role="status"><Trans>No matching titles found.</Trans></p>}
      {hits[0]&&<div className="tsugi-search-best-match" data-ui="watch-top-match">
        <Artwork key={hits[0].key} eager src={[hits[0].item.background,hits[0].item.poster,...(hits[0].item.posterAlternatives??[])].filter((url):url is string=>!!url)} alt="" className="tsugi-search-best-art"/>
        <div className="tsugi-search-best-copy"><small><Trans>Top match</Trans> · {hits[0].item.mediaType.includes('movie')?t`Movie`:t`Series`}{hits[0].item.releaseInfo?' · '+hits[0].item.releaseInfo.slice(0,4):''}</small>
          <h4>{hits[0].item.name}</h4>
          {hits[0].item.description&&<p className="line-clamp-2">{hits[0].item.description}</p>}
          <Button intent="white" className="rounded-full" disabled={busy} onClick={()=>openTitle(hits[0].item,hits[0].target.sourceId)}><Trans>View top match</Trans></Button>
        </div></div>}
      {searchGroups.filter(group=>group.items.length>0).map(group=><section key={group.key} className="tsugi-watch-search-section" data-search-kind={group.key}>
        <div className="tsugi-watch-search-heading"><h4>{group.label}</h4><span>{group.items.length}</span></div>
        <div className="tsugi-watch-search-row">{group.items.slice(0,resultLimit).map(({key,item,target})=><button key={key} type="button" data-ui="watch-search-result" className="tsugi-watch-search-result" aria-label={item.name} disabled={busy} onClick={()=>openTitle(item,target.sourceId)}>
          <span className="tsugi-watch-search-result-art" aria-hidden="true"><Artwork src={[item.poster,...(item.posterAlternatives??[])].filter((url):url is string=>!!url)} alt={item.name}/></span>
          <span className="tsugi-watch-search-result-copy">
            <strong data-ui="watch-search-result-title">{item.name}</strong>
            {(item.releaseInfo||item.tmdbRating!=null)&&<small>{item.releaseInfo}{item.releaseInfo&&item.tmdbRating!=null?' · ':''}{item.tmdbRating!=null&&<>{'★ '}{item.tmdbRating.toFixed(1)}</>}</small>}
            {item.description&&<span className="tsugi-watch-search-result-description">{item.description}</span>}
          </span>
        </button>)}</div>
      </section>)}
      {searchGroups.some(group=>group.items.length>resultLimit)&&<button type="button" className="tsugi-read-action" onClick={()=>setResultLimit(n=>n+RESULT_BATCH)}><Trans>Show more results</Trans></button>}
    </section>:!targets.length?<section className="tsugi-watch-empty">
      <MovieGlyph name="addons"/><h3><Trans>No matching catalogues</Trans></h3>
      <p><Trans>Enable an addon with compatible catalogues. Stream-only addons provide playback sources but cannot populate browsing rows.</Trans></p>
      <button className="tsugi-read-action" type="button" disabled={busy} onClick={openAddons}><Trans id="Manage addons">Manage addons</Trans></button>
    </section>:<>
      {!populated.length&&<p className="tsugi-watch-muted" role="status">{stopped?<Trans>Loading paused.</Trans>:pending?<Trans>Loading titles…</Trans>:<Trans>No titles available yet.</Trans>}</p>}
      {populated.map(target=>{
        const row=rows[target.key];
        return <section className="tsugi-watch-shelf" key={target.key} data-ui="watch-catalogue-shelf">
          <MediaRow id={profileId+':'+target.key} shape="poster" title={target.source.sourceId===0?(target.catalog.id==='top'?(target.catalog.mediaType==='movie'?t`Popular movies`:t`Popular series`):(target.catalog.mediaType==='movie'?t`Featured movies`:t`Featured series`)):target.catalog.name} loading={!!row?.loading&&!row.page||!row&&!stopped} action={row?.page&&<div className="flex flex-wrap gap-2">
              {row.skip>0&&<button type="button" className="tsugi-read-action" disabled={busy||!canRequest||row.loading} onClick={()=>void load(target,0)}><Trans>First page</Trans></button>}
              {row.page.nextSkip!==null&&<button type="button" className="tsugi-read-action" disabled={busy||!canRequest||row.loading} onClick={()=>void load(target,row.page!.nextSkip!)}><Trans>Next page</Trans></button>}
              {row.error&&<button type="button" className="tsugi-read-action" disabled={busy||!canRequest||row.loading} onClick={()=>void load(target,row.skip)}><Trans>Retry</Trans></button>}
          </div>}>
            {row?.page?.items.map(item=><PosterCard key={item.id} title={item.name} image={item.poster?[item.poster,...(item.posterAlternatives??[])]:null} itemType={item.mediaType==='movie'?t`Movie`:t`Series`} disabled={busy} onClick={()=>openTitle(item,target.source.sourceId)}/>)}
          </MediaRow>
          {row?.page&&row.page.items.length>0&&<small>{target.source.manifest.name} · {target.catalog.mediaType==='movie'?t`Movies`:target.catalog.mediaType==='series'?t`Series`:t`Anime`}</small>}
        </section>;
      })}
      {(pending||stopped||limit<targets.length)&&<div className="flex flex-wrap gap-3">
        {limit<targets.length&&<button className="tsugi-read-action" type="button" disabled={busy} onClick={()=>{setLimit(n=>n+BATCH);setStopped(false);}}><Trans>Show more titles</Trans></button>}
        {(pending||stopped)&&<button type="button" className="tsugi-read-action" onClick={()=>setStopped(v=>!v)}>{stopped?<Trans>Continue loading</Trans>:<Trans>Pause catalogue loading</Trans>}</button>}
      </div>}
    </>}
  </>;
}

export function WatchCatalogueBoard({scope='all',includeHistory=false,initialQuery='',searchMount,searchOnly=false,...props}:Props){
  const [query,setQuery]=React.useState(initialQuery);
  const [submitted,setSubmitted]=React.useState(initialQuery);
  const [searchOpen,setSearchOpen]=React.useState(!!initialQuery);
  const [kind,setKind]=React.useState<Kind>('all');
  const [revision,setRevision]=React.useState(0);
  const dialog=React.useRef<HTMLDialogElement>(null);
  const searchInput=React.useRef<HTMLInputElement>(null);
  const dialogId=React.useId();
  React.useEffect(()=>{const timer=window.setTimeout(()=>setSubmitted(query.trim()),scope==='all'?200:450);return ()=>window.clearTimeout(timer);},[query,scope]);
  React.useEffect(()=>{
    const node=dialog.current;
    if(!node)return;
    if(searchOpen&&!props.paused){if(!node.open)node.showModal();searchInput.current?.focus();}
    else if(node.open)node.close();
  },[searchOpen,props.paused]);
  const homeTargets=React.useMemo(()=>catalogueTargets(props.sources,scope,'all',''),[props.sources,scope]);
  const targets=React.useMemo(()=>catalogueTargets(props.sources,scope,kind,submitted),[props.sources,scope,kind,submitted]);
  const searchLabel=scope==='all'?t`Search movies & series`:t`Search anime`;
  const toolbar=<div className="tsugi-watch-board-toolbar">
    <button type="button" className="tsugi-watch-search-trigger" aria-label={searchLabel} aria-haspopup="dialog" aria-expanded={searchOpen} aria-controls={dialogId} disabled={props.busy} onClick={()=>setSearchOpen(true)}><MovieGlyph name="search"/><span>{searchLabel}</span></button>
    {!searchOnly&&<button type="button" className="tsugi-read-action" disabled={props.busy} onClick={()=>setRevision(r=>r+1)}><Trans>Refresh catalogues</Trans></button>}
  </div>;
  return <section className="tsugi-watch-board" data-ui="watch-catalogue-board" data-search-only={searchOnly||undefined} hidden={props.paused} inert={props.paused}>
    {!props.paused&&(searchMount?createPortal(toolbar,searchMount):searchMount===undefined?toolbar:null)}
    {!searchOnly&&scope==='all'&&!props.sources.some(s=>s.enabled&&s.manifest.resources.includes('stream'))&&<p className="tsugi-watch-muted"><Trans>Browse titles now. Connect streaming addons in Settings to watch them.</Trans> <button type="button" className="tsugi-read-action" disabled={props.busy} onClick={props.openAddons}><Trans>Manage addons</Trans></button></p>}
    {!searchOnly&&<CatalogueRows key={JSON.stringify([props.profileId,scope,revision,homeTargets.map(row=>row.key)])} {...props} paused={props.paused||searchOpen} targets={homeTargets} search="" scope={scope} includeHistory={includeHistory}/>} 
    <dialog ref={dialog} id={dialogId} className="tsugi-watch-search-dialog" aria-label={t`Search titles`} onCancel={e=>{e.preventDefault();setSearchOpen(false);}} onClick={e=>{if(e.target===e.currentTarget)setSearchOpen(false);}}>
      {searchOpen&&<div className="tsugi-watch-search-panel">
        <form className="tsugi-watch-search-bar" onSubmit={e=>{e.preventDefault();setSubmitted(query.trim());}}>
          <MovieGlyph name="search"/>
          <input ref={searchInput} type="search" aria-label={t`Search across addons`} value={query} maxLength={scope==='all'?512:300} placeholder={scope==='all'?t`Search movies, series and anime…`:t`Search anime…`} onChange={e=>setQuery(e.target.value)}/>
          {query&&<button type="button" className="tsugi-read-action" onClick={()=>{setQuery('');setSubmitted('');searchInput.current?.focus();}}><Trans>Clear search</Trans></button>}
          <button type="button" className="tsugi-read-action" onClick={()=>setSearchOpen(false)}><Trans>Close search</Trans></button>
        </form>
        {scope==='all'&&<div className="tsugi-search-kind" aria-label={t`Media type`}>
          {([{value:'all',label:t`All titles`},{value:'series',label:t`Series`},{value:'movie',label:t`Movies`},{value:'anime',label:t`Anime`}] as const).map(({value,label})=><button type="button" key={value} aria-pressed={kind===value} onClick={()=>setKind(value)}>{label}</button>)}
        </div>}
        {submitted?<CatalogueRows key={JSON.stringify([props.profileId,scope,kind,submitted,targets.map(row=>row.key)])} {...props} openTitle={(item,sourceId)=>{setSearchOpen(false);props.openTitle(item,sourceId);}} targets={targets} search={submitted} scope={scope} kind={kind} includeHistory={false}/>:<p className="tsugi-watch-search-hint"><Trans>Find your next favorite. Results appear as you type.</Trans></p>}
      </div>}
    </dialog>
  </section>;
}
