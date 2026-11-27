import React from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { MovieGlyph } from '@/components/movie-icons';
import { Artwork, PosterCard, WideCard } from '@/components/media/cards';
import { BackdropFrame } from '@/components/media/hero';
import { Button } from '@aiostreams/ui/button';
import { MediaRow } from '@/components/media/media-row';
import { publicCinemeta, loadAddonCatalog, listWatchHistory, type AddonSource, type CatalogPage, type WatchHistoryEntry, type WatchProgress } from '@/lib/hosts/shell/stremio';
import './watch-catalogue-board.css';

type Item=CatalogPage['items'][number];
type Scope='all'|'anime'|'anime-films';
type Kind='all'|'movie'|'series'|'anime';
type Target={key:string;source:AddonSource;catalog:AddonSource['manifest']['catalogs'][number];extras:Record<string,string>};
type Row={page?:CatalogPage;error?:boolean;loading?:boolean;skip:number;repeated?:boolean};
type Props={
  profileId:number;sources:AddonSource[];busy:boolean;active:boolean;paused:boolean;
  scope?:Scope;includeHistory?:boolean;initialQuery?:string;run(work:()=>Promise<void>):Promise<void>;
  openTitle(item:Item,sourceId?:number):void;openHistory?(progress:WatchProgress):void;openAddons():void;
};
const BATCH=6;
const animeWord=/(^|[^a-z])(anime|mal|anilist|kitsu|crunchyroll|funimation)([^a-z]|$)/i;

// The Board requests declared catalogues that can be queried without
// guessing required filters. Search only calls catalogues declaring search.
// Anime rows require an anime declaration, label or exact genre option.
export function catalogueTargets(sources:AddonSource[],scope:Scope,kind:Kind,query:string):Target[]{
  const rows:Target[]=[];
  const available=scope==='all'&&kind!=='anime'&&!sources.some(s=>s.enabled&&s.manifest.id===publicCinemeta.manifest.id)?[...sources,publicCinemeta]:sources;
  for(const source of available){
    if(!source.enabled||source.manifest.adult||source.manifest.configurationRequired)continue;
    for(const catalog of source.manifest.catalogs){
      if(!['movie','series','anime'].includes(catalog.mediaType)||kind!=='all'&&kind!==catalog.mediaType)continue;
      const extras:Record<string,string>={};
      const animeGenre=catalog.extras.find(e=>e.name==='genre')?.options.find(o=>o.toLowerCase()==='anime');
      const explicitAnime=catalog.mediaType==='anime'||animeWord.test(catalog.name)||animeWord.test(catalog.id)||animeWord.test(source.manifest.name);
      if(scope!=='all'){
        if(!explicitAnime&&!animeGenre)continue;
        if(scope==='anime-films'&&catalog.mediaType!=='movie'&&!(catalog.mediaType==='anime'&&/(^|[^a-z])(film|films|movie|movies)([^a-z]|$)/i.test(catalog.name)))continue;
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

function CatalogueRows({profileId,targets,busy,active,paused,run,openTitle,openAddons,includeHistory,openHistory}:Omit<Props,'sources'|'scope'> & {targets:Target[]}){
  const [limit,setLimit]=React.useState(BATCH);
  const [rows,setRows]=React.useState<Record<string,Row>>({});
  const [stopped,setStopped]=React.useState(false);
  const [history,setHistory]=React.useState<WatchHistoryEntry[]|null>(null);
  const [historyFailed,setHistoryFailed]=React.useState(false);
  const mounted=React.useRef(false);
  const visible=targets.slice(0,limit);
  React.useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;};},[]);
  React.useEffect(()=>{if(!active){setHistory(null);setHistoryFailed(false);}},[active]);

  async function load(target:Target,skip:number){
    await run(async()=>{
      if(!mounted.current)return;
      setRows(old=>({...old,[target.key]:{...old[target.key],skip,loading:true,error:false}}));
      try{
        const extras={...target.extras};
        if(target.catalog.extras.some(e=>e.name==='skip')&&(skip>0||'skip' in extras))extras.skip=String(skip);
        const page=await loadAddonCatalog(profileId,{kind:'catalog',sourceId:target.source.sourceId,mediaType:target.catalog.mediaType,catalogId:target.catalog.id,extras});
        if(!mounted.current)return;
        setRows(old=>{
          const previous=old[target.key]?.page;
          const repeated=skip>0&&!!previous&&page.items.length>0&&JSON.stringify(previous.items.map(i=>i.id))===JSON.stringify(page.items.map(i=>i.id));
          return {...old,[target.key]:{page:repeated?{...page,nextSkip:null}:page,skip,repeated}};
        });
      }catch{if(mounted.current)setRows(old=>({...old,[target.key]:{...old[target.key],skip,loading:false,error:true}}));}
    });
  }
  React.useEffect(()=>{
    if(!active||paused||busy||stopped)return;
    const next=visible.find(target=>!rows[target.key]);
    if(includeHistory&&history===null&&!historyFailed){
      const timer=window.setTimeout(()=>void run(async()=>{
        try{const result=await listWatchHistory(profileId);if(mounted.current)setHistory(result);}
        catch{if(mounted.current)setHistoryFailed(true);}
      }),100);
      return ()=>window.clearTimeout(timer);
    }
    if(!next)return;
    const timer=window.setTimeout(()=>void load(next,0),180);
    return ()=>window.clearTimeout(timer);
  },[active,paused,busy,stopped,rows,limit,targets,includeHistory,history,historyFailed,profileId,run]);

  const featured=visible.flatMap(target=>rows[target.key]?.page?.items.slice(0,1).map(item=>({target,item}))??[]).find(row=>row.item.poster);
  const pending=visible.some(target=>!rows[target.key]||rows[target.key].loading);
  const continuing=history?.filter(row=>!row.progress.completed&&row.progress.positionMs>0).slice(0,12)??[];
  return <>
    {includeHistory&&featured&&<section data-ui="hero" className="tsugi-watch-featured">
      <BackdropFrame className="pointer-events-none tsugi-watch-featured-art">
        <Artwork src={featured.item.poster??null} alt="" className="tsugi-watch-featured-poster"/>
      </BackdropFrame>
      <div className="tsugi-watch-featured-copy">
        <small><Trans>Featured</Trans> · {featured.target.catalog.name}</small>
        <h2>{featured.item.name}</h2>
        <Button intent="white" className="rounded-full" disabled={busy} onClick={()=>openTitle(featured.item,featured.target.source.sourceId)}><Trans>View title</Trans></Button>
      </div>
    </section>}
    {includeHistory&&continuing.length>0&&<section className="tsugi-watch-shelf" data-ui="watch-continue-shelf">
      <MediaRow id={profileId+':watch-resume'} title={t({id:'Continue watching',message:'Continue watching'})} shape="wide">
        {continuing.map(({progress:p})=><WideCard key={JSON.stringify([p.mediaType,p.itemId,p.videoId])} onClick={()=>{if(!busy)openHistory?.(p);}} image={null} title={p.title} subtitle={p.episodeTitle??undefined} progress={100*p.positionMs/p.durationMs}/>)}
      </MediaRow>
    </section>}
    {includeHistory&&historyFailed&&<p className="tsugi-watch-muted"><Trans>Watch history could not be loaded.</Trans> <button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>setHistoryFailed(false)}><Trans>Retry</Trans></button></p>}
    {!targets.length?<section className="tsugi-watch-empty">
      <MovieGlyph name="addons"/><h3><Trans>No matching catalogues</Trans></h3>
      <p><Trans>Enable an addon with compatible catalogues. Stream-only addons provide playback sources but cannot populate browsing rows.</Trans></p>
      <button className="tsugi-read-action" type="button" disabled={busy} onClick={openAddons}><Trans id="Manage addons">Manage addons</Trans></button>
    </section>:<>
      <div className="tsugi-watch-board-status">
        <span>{targets.length} <Trans>catalogues</Trans></span>
        {(pending||stopped)&&<button type="button" className="tsugi-read-action" onClick={()=>setStopped(v=>!v)}>{stopped?<Trans>Continue loading</Trans>:<Trans>Pause catalogue loading</Trans>}</button>}
      </div>
      {visible.map(target=>{
        const row=rows[target.key];
        return <section className="tsugi-watch-shelf" key={target.key} data-ui="watch-catalogue-shelf">
          <MediaRow id={profileId+':'+target.key} shape="poster" title={target.source.sourceId===0?(target.catalog.id==='top'?(target.catalog.mediaType==='movie'?t`Popular movies`:t`Popular series`):(target.catalog.mediaType==='movie'?t`Featured movies`:t`Featured series`)):target.catalog.name} loading={row?.loading&&!row.page} action={row?.page&&<div className="flex flex-wrap gap-2">
              {row.skip>0&&<button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void load(target,0)}><Trans>First page</Trans></button>}
              {row.page.nextSkip!==null&&<button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void load(target,row.page!.nextSkip!)}><Trans>Next page</Trans></button>}
          </div>}>
            {row?.page?.items.map(item=><PosterCard key={item.id} title={item.name} image={item.poster??null} itemType={item.mediaType==='movie'?'Movie':'Series'} disabled={busy} onClick={()=>openTitle(item,target.source.sourceId)}/>)}
          </MediaRow>
          {row?.page&&row.page.items.length>0&&<small>{target.source.manifest.name} · {target.catalog.mediaType==='movie'?t`Movies`:target.catalog.mediaType==='series'?t`Series`:t`Anime`}</small>}
          {!row?.page&&!row?.loading&&<h3>{target.catalog.name}</h3>}
          {row?.page?.items.length===0&&<p className="tsugi-watch-muted"><Trans id="No titles returned by this catalogue.">No titles returned by this catalogue.</Trans></p>}
          {row?.repeated&&<p className="tsugi-watch-muted"><Trans id="This source repeated a page. Pagination stopped.">This source repeated a page. Pagination stopped.</Trans></p>}
          {row?.error?<div className="tsugi-watch-board-status"><p role="status"><Trans>This catalogue is unavailable.</Trans></p><button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void load(target,row.skip)}><Trans>Retry</Trans></button></div>:
            row?.loading?<p role="status"><Trans>Loading catalogue…</Trans></p>:!row&&<p className="tsugi-watch-muted">{stopped?<Trans>Loading paused.</Trans>:<Trans>Waiting to load catalogue…</Trans>}</p>}
        </section>;
      })}
      {limit<targets.length&&<button className="tsugi-read-action" type="button" disabled={busy} onClick={()=>{setLimit(n=>n+BATCH);setStopped(false);}}><Trans>Show more catalogues</Trans> ({targets.length-limit})</button>}
    </>}
  </>;
}

export function WatchCatalogueBoard({scope='all',includeHistory=false,initialQuery='',...props}:Props){
  const [query,setQuery]=React.useState(initialQuery);
  const [submitted,setSubmitted]=React.useState(initialQuery);
  const [kind,setKind]=React.useState<Kind>('all');
  const [revision,setRevision]=React.useState(0);
  const targets=React.useMemo(()=>catalogueTargets(props.sources,scope,kind,submitted),[props.sources,scope,kind,submitted]);
  return <section className="tsugi-watch-board" data-ui="watch-catalogue-board" hidden={props.paused} inert={props.paused}>
    {scope==='all'&&!props.sources.some(s=>s.enabled&&s.manifest.resources.includes('stream'))&&<p className="tsugi-watch-muted"><Trans>Browse titles now. Connect streaming addons in Settings to watch them.</Trans> <button type="button" className="tsugi-read-action" disabled={props.busy} onClick={props.openAddons}><Trans>Manage addons</Trans></button></p>}
    <form className="tsugi-watch-board-toolbar" onSubmit={e=>{e.preventDefault();setSubmitted(query.trim());setRevision(r=>r+1);}}>
      <label className="tsugi-watch-search"><MovieGlyph name="search"/><input type="search" className="tsugi-read-input" aria-label={t`Search across addons`} value={query} maxLength={512} disabled={props.busy} placeholder={t`Search across addons`} onChange={e=>setQuery(e.target.value)}/></label>
      {scope==='all'&&<select aria-label={t`Media type`} className="tsugi-menu-select" disabled={props.busy} value={kind} onChange={e=>setKind(e.target.value as Kind)}>
        <option value="all"><Trans>All titles</Trans></option><option value="movie"><Trans>Movies</Trans></option><option value="series"><Trans>Series</Trans></option><option value="anime"><Trans>Anime</Trans></option>
      </select>}
      <button type="submit" className="tsugi-read-action" disabled={props.busy}><Trans>Search</Trans></button>
      {submitted&&<button type="button" className="tsugi-read-action" disabled={props.busy} onClick={()=>{setSubmitted('');setQuery('');}}><Trans>Clear search</Trans></button>}
      <button type="button" className="tsugi-read-action" disabled={props.busy} onClick={()=>setRevision(r=>r+1)}><Trans>Refresh catalogues</Trans></button>
    </form>
    <CatalogueRows key={JSON.stringify([props.profileId,scope,kind,submitted,revision,targets.map(row=>row.key)])} {...props} targets={targets} includeHistory={includeHistory&&!submitted}/>
  </section>;
}
