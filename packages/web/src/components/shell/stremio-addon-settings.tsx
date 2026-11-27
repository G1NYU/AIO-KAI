import React from 'react';
import { StremioAccountImport, importFailureText, manifestFailureText } from './stremio-account-import';
import { MdblistSettings } from './mdblist-settings';
import { WatchSetupGate,TmdbSettings } from './watch-setup-gate';
import { MalAnimeLibrary } from './mal-anime-library';
import { WatchCatalogueBoard } from './watch-catalogue-board';
import { RefractSettings, RefractWatchlist } from './refract-settings';
import { TsugiBrand } from '@/components/tsugi-brand';
import { TsugiIcon } from '@/components/tsugi-icons';
import { MovieGlyph } from '@/components/movie-icons';
import { Artwork, PosterCard } from '@/components/media/cards';
import { TsugiRail } from './tsugi-rail';
import { rememberWatchArtwork } from '@/lib/hosts/shell/watch-artwork';
import { listWatchCollections,setWatchCollection,type WatchCollections,type WatchCollection,type WatchCollectionItem } from '@/lib/hosts/shell/stremio';
import { createPortal } from 'react-dom';
import { useDesktopArea, type WatchEntryPane } from '@/lib/desktop-area';
import { settings, useSetting } from '@/lib/settings';
import { WatchPlaybackSettings } from '@/app/settings/page';
import { AddonVersionList } from '@/features/versions/addon-versions';
import { isWatchMovie, titleIdentityRoutes, mergeAliasMetadata, watchVideoRoutes } from '@/lib/hosts/shell/watch-identities';
import './stremio-workspace.css';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { AddonError, retryAddonImport, cancelAddonImport, type ImportResult, listAddons, reviewAddon, mutateAddon, cancelAddonReview, loadAddonCatalog, listAddonProfiles, mutateAddonProfile, type ProfileState, type ProfileMutation, type AddonSource, type AddonReview, type CatalogPage, type Mutation, loadAddonMetadata, loadAddonOptions, beginAddonStreams, pollAddonStreams, cancelAddonStreams, retryAddonStreams, type AddonStreamGroup, type AddonMetadata, type AddonVideo, type AddonOptions, prepareAddonMedia, listWatchHistory, completeWatch, removeWatchHistory, type WatchPlayback, type WatchProgress, type WatchHistoryEntry, loadTmdbTitle, loadTmdbSeason, type TmdbTitle, type TmdbEpisode } from '@/lib/hosts/shell/stremio';

function feedback(reason: unknown) {
  const code=reason instanceof AddonError?reason.code:'request';
  const manifestReason=manifestFailureText(code);
  if(manifestReason)return manifestReason;
  switch(code){
    case 'invalid-endpoint': return t`Paste a configured HTTPS or stremio:// manifest link ending in /manifest.json.`;
    case 'configuration-required': return t`Configure this addon with its provider first, then paste its configured link.`;
    case 'duplicate': return t`This configured addon is already installed.`;
    case 'expired-review': return t`This review expired. Review the manifest again.`;
    case 'auth': return t`The addon rejected the request. Check its configuration.`;
    case 'rate': return t`The addon is limiting requests. Try again later.`;
    case 'source-limit': return t`Each profile supports up to 128 addons.`;
    case 'profile-limit': return t`You can create up to six profiles.`;
    case 'duplicate-profile': return t`A profile already uses that name.`;
    case 'invalid-profile-name': return t`Enter a valid profile name.`;
    case 'profile-changed': return t`The active profile changed. Refresh before continuing.`;
    case 'profile-store': case 'profile-store-limit': return t`The protected profile store could not be read or saved. Existing saved data has not been reset.`;
    case 'profile-confirmation': return t`Type the exact profile name before deleting it.`;
    case 'active-profile': return t`Switch to another profile before deleting this one.`;
    case 'mal-invalid': return t`The anime collection contains invalid data. No import was applied.`;
    case 'mal-limit': return t`The anime collection exceeds the local storage limit.`;
    case 'account-auth': return t`The account service refused sign-in or access. Check your credentials and try again.`;
    case 'account-request': case 'account-response': return t`The account service returned an unsupported response. No addons were imported.`;
    case 'unsupported-resource': return t`This addon does not declare support for that title or video identity.`;
    case 'invalid-item': case 'item-limit': return t`The addon returned an invalid or oversized item response.`;
    case 'locked-remote-profile': return t`This Nuvio profile is protected. Choose an unlocked profile instead.`;
    case 'import-limit': return t`The account addon list exceeds the import limit.`;
    case 'import-selection': return t`Select compatible addons within the available profile slots.`;
    default: return t`The request could not be confirmed. Refresh the installed list before retrying an installation or change.`;
  }
}
type WatchPane = 'hubs'|'home'|'discover'|'playback'|'addons'|'stremio'|'nuvio'|'manual'|'order'|'profile'|'mdblist'|'tmdb'|'history'|'favorites'|'queue'|'refract'|'anime'|'anime-import';

export function StremioAddonSettings({workspace=false,initialProfileId,onProfileSelected,onPlay,returnedPlayback,historyActive=false,setupConnections=false,initialPane='addons',openServer}:{initialProfileId?:number;onProfileSelected?:(id:number|undefined)=>void;workspace?:boolean;openServer?:()=>void;onPlay?:(playback:WatchPlayback)=>void;returnedPlayback?:WatchPlayback|null;historyActive?:boolean;setupConnections?:boolean;initialPane?:WatchEntryPane}={}){
  const desktopArea=useDesktopArea();
  const [autoPlayFirst]=useSetting(settings.playback.autoPlayFirst);
  const [boardSearch,setBoardSearch]=React.useState('');
  const [entered,setEntered]=React.useState(false);
  const [pane,setPane]=React.useState<WatchPane>(initialPane);
  const [creating,setCreating]=React.useState(false);
  const titleId=React.useId();
  const [profileState,setProfileState]=React.useState<ProfileState|null>(null);
  const [profileReady,setProfileReady]=React.useState(false);
  const [setupVerified,setSetupVerified]=React.useState<number>();
  const [profileName,setProfileName]=React.useState('');
  const [deleteId,setDeleteId]=React.useState(0);
  const [deleteName,setDeleteName]=React.useState('');
  const profileId=profileState?.activeProfileId;
  const activeProfile=profileState?.profiles.find(p=>p.profileId===profileId);
  const deleteTarget=profileState?.profiles.find(p=>p.profileId===deleteId&&p.profileId!==profileId);
  const [importActive,setImportActive]=React.useState(false);
  const [url,setUrl]=React.useState('');
  const [consent,setConsent]=React.useState(false);
  const [review,setReview]=React.useState<AddonReview|null>(null);
  const [sources,setSources]=React.useState<AddonSource[]>([]);
  const [busy,setBusy]=React.useState(false);
  const [error,setError]=React.useState('');
  const [importReport,setImportReport]=React.useState<{profileId:number;result:ImportResult}|null>(null);
  const [notice,setNotice]=React.useState('');
  const [selection,setSelection]=React.useState<{sourceId:number;catalogIndex:number}|null>(null);
  const [filters,setFilters]=React.useState<Map<string,string>>(()=>new Map());
  const [page,setPage]=React.useState<CatalogPage|null>(null);
  const [collectionState,setCollectionState]=React.useState<{profileId:number;data:WatchCollections}|null>(null);
  const collections=collectionState?.profileId===profileId?collectionState?.data:undefined;
  React.useEffect(()=>{if(!entered||!onPlay||profileId===undefined||setupVerified!==profileId)return;let live=true;void listWatchCollections(profileId).then(data=>{if(live)setCollectionState({profileId,data});}).catch(()=>{});return ()=>{live=false;};},[entered,profileId,setupVerified,onPlay]);
  const [title,setTitle]=React.useState<CatalogPage['items'][number]|null>(null);
  const [details,setDetails]=React.useState<AddonMetadata|null>(null);
  const [cinema,setCinema]=React.useState<TmdbTitle|null>(null);
  const [seasonArt,setSeasonArt]=React.useState<TmdbEpisode[]>([]);
  const [episodeHistory,setEpisodeHistory]=React.useState<{profileId:number;entries:WatchHistoryEntry[]}|null>(null);
  const [videoId,setVideoId]=React.useState('');
  const [seasonChoice,setSeasonChoice]=React.useState<string|null>(null);
  const [sourceOpen,setSourceOpen]=React.useState(false);
  const sourceTrigger=React.useRef<HTMLElement|null>(null);
  const suppressSourceFocus=React.useRef(false);
  const streamRequest=React.useRef<{profileId:number;queryId?:number;cancelled:boolean}|null>(null);
  const [streamPending,setStreamPending]=React.useState<number|null>(null);
  const streamBack=React.useRef<HTMLButtonElement>(null);
  const browseTrigger=React.useRef<HTMLElement|null>(null);
  const browseScroll=React.useRef<{element:Element;top:number;left:number}[]>([]);
  const handledReturn=React.useRef<WatchPlayback|null>(null);
  const [resumeEntry,setResumeEntry]=React.useState<WatchProgress|null>(null);
  const [options,setOptions]=React.useState<({sourceId:number;subtitles:boolean}&AddonOptions)|null>(null);
  const [streamGroups,setStreamGroups]=React.useState<AddonStreamGroup[]|null>(null);
  const [automatic,setAutomatic]=React.useState(false);
  const detailRef=React.useRef<HTMLElement>(null);
  React.useEffect(()=>{
    if(automatic&&title){detailRef.current?.focus({preventScroll:true});detailRef.current?.scrollIntoView({block:'start'});}
  },[automatic,title]);
  const mounted=React.useRef(false);
  const flight=React.useRef(false);
  const pending=React.useRef<{profileId:number;reviewId:number}|null>(null);
  const seen=React.useRef(new Set<string>());
  const blocked=busy||!profileReady||profileId===undefined;
  const manualBlocked=blocked||importActive;
  const source=sources.find(s=>s.sourceId===selection?.sourceId&&s.enabled);
  const catalog=source?.manifest.catalogs[selection?.catalogIndex??0];

  async function run(work:()=>Promise<void>){
    if(flight.current)return;
    flight.current=true;setBusy(true);setError('');setNotice('');
    try{await work();}catch(reason){if(mounted.current)setError(feedback(reason));}
    finally{flight.current=false;if(mounted.current)setBusy(false);}
  }
  React.useEffect(()=>{
    mounted.current=true;
    void run(async()=>{
      const state=await listAddonProfiles();
      if(!mounted.current)return;
      await reloadProfiles(state);
      if(mounted.current&&initialProfileId===state.activeProfileId)setEntered(true);
    });
    return ()=>{mounted.current=false;stopStreams(true,false);const current=pending.current;pending.current=null;if(current)void cancelAddonReview(current.profileId,current.reviewId).catch(()=>{});};
  },[]);
  function stopStreams(cancelNative=true,update=true){
    const request=streamRequest.current;streamRequest.current=null;
    if(request){request.cancelled=true;if(cancelNative&&request.queryId!==undefined)void cancelAddonStreams(request.profileId,request.queryId).catch(()=>{});}
    if(update)setStreamPending(null);
  }
  function closeStreams(){if(flight.current)return;stopStreams();setSourceOpen(false);if(!suppressSourceFocus.current)requestAnimationFrame(()=>sourceTrigger.current?.focus({preventScroll:true}));}
  React.useEffect(()=>{if(sourceOpen)streamBack.current?.focus({preventScroll:true});},[sourceOpen]);
  function clearTitle(){stopStreams();setCinema(null);setSeasonArt([]);setTitle(null);setDetails(null);setVideoId('');setSeasonChoice(null);setSourceOpen(false);setOptions(null);setResumeEntry(null);setStreamGroups(null);setAutomatic(false);}
  function rememberBrowse(){
    browseTrigger.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const ancestors:Element[]=[];
    for(let element=browseTrigger.current?.parentElement;element;element=element.parentElement)ancestors.push(element);
    if(document.scrollingElement&&!ancestors.includes(document.scrollingElement))ancestors.push(document.scrollingElement);
    browseScroll.current=ancestors.map(element=>({element,top:element.scrollTop,left:element.scrollLeft}));
  }
  function closeTitle(){
    clearTitle();
    requestAnimationFrame(()=>{
      for(const {element,top,left} of browseScroll.current)if(element.isConnected){element.scrollTop=top;element.scrollLeft=left;}
      if(browseTrigger.current?.isConnected)browseTrigger.current.focus({preventScroll:true});
    });
  }
  function seasonOf(video:AddonVideo){return video.season===null?'other':String(video.season);}
  function showSources(){
    sourceTrigger.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    suppressSourceFocus.current=false;setSourceOpen(true);
  }
  function clearPage(){setPage(null);seen.current.clear();clearTitle();}
  function choose(next:typeof selection){setSelection(next);setFilters(new Map());clearPage();}
  function clearReview(){const previous=pending.current;pending.current=null;setReview(null);setUrl('');setConsent(false);return previous;}
  async function reloadProfiles(next?:ProfileState){
    setSetupVerified(undefined);setProfileReady(false);setSources([]);choose(null);
    const result=next??await listAddonProfiles();
    if(!mounted.current)return;
    setProfileState(result);
    const rows=await listAddons(result.activeProfileId);
    if(mounted.current){setSources(rows);setProfileReady(true);}
  }
  async function refreshProfiles(){
    await run(async()=>{
      const previous=clearReview();
      if(previous)await cancelAddonReview(previous.profileId,previous.reviewId).catch(()=>{});
      await reloadProfiles();
    });
  }
  async function changeProfile(action:ProfileMutation,enter=false){
    if(flight.current||!profileState)return;
    await run(async()=>{
      const previous=clearReview();
      if(previous)await cancelAddonReview(previous.profileId,previous.reviewId).catch(()=>{});
      setSetupVerified(undefined);setProfileReady(false);setSources([]);choose(null);
      let result=await mutateAddonProfile(action);
      if(!mounted.current)return;
      if(enter&&action.kind==='profile-create'){
        const created=result.profiles.find(p=>!profileState.profiles.some(old=>old.profileId===p.profileId));
        if(!created)throw new AddonError('invalid-response');
        setProfileState(result);
        result=await mutateAddonProfile({kind:'profile-switch',profileId:created.profileId});
        if(!mounted.current)return;
      }
      setProfileName('');setDeleteId(0);setDeleteName('');
      await reloadProfiles(result);
      if(mounted.current&&enter){setCreating(false);setPane(initialPane);setEntered(true);onProfileSelected?.(result.activeProfileId);}

    });
  }
  function updateSources(next:AddonSource[],id:number){setSources(next);setProfileState(old=>old?{...old,profiles:old.profiles.map(p=>p.profileId===id?{...p,sourceCount:next.length}:p)}:null);choose(null);}
  async function inspect(){
    const candidate=url.trim();
    if(!candidate||!consent||flight.current||profileId===undefined||!profileReady||importActive)return;
    setUrl('');setConsent(false);setReview(null);pending.current=null;
    await run(async()=>{
      const next=await reviewAddon(profileId,candidate);
      if(!mounted.current){void cancelAddonReview(profileId,next.reviewId).catch(()=>{});return;}
      pending.current={profileId,reviewId:next.reviewId};setReview(next);
    });
  }
  async function change(action:Mutation){
    if(flight.current||profileId===undefined||!profileReady)return;
    if(action.kind==='install'){setReview(null);pending.current=null;}
    await run(async()=>{const next=await mutateAddon(profileId,action);if(mounted.current){updateSources(next,profileId);if(action.kind==='install'&&workspace&&onPlay)setPane('home');}});
  }
  async function cancel(){
    const current=pending.current;if(!current||flight.current)return;
    setReview(null);pending.current=null;
    await run(async()=>{await cancelAddonReview(current.profileId,current.reviewId);});
  }
  const validFilters=!!catalog&&catalog.extras.every(e=>e.name==='skip'||!e.required||!!filters.get(e.name)?.trim());
  async function load(skip:number){
    if(!source||!catalog||!validFilters||flight.current||profileId===undefined||!profileReady)return;
    const extras=Object.fromEntries(catalog.extras.filter(e=>e.name!=='skip'&&filters.get(e.name)?.trim()).map(e=>[e.name,filters.get(e.name)!]));
    if(catalog.extras.some(e=>e.name==='skip'&&(skip>0||e.required)))extras.skip=String(skip);
    await run(async()=>{
      if(skip===0)clearPage();
      const next=await loadAddonCatalog(profileId,{kind:'catalog',sourceId:source.sourceId,mediaType:catalog.mediaType,catalogId:catalog.id,extras});
      if(!mounted.current)return;
      const fingerprint=JSON.stringify(next.items.map(i=>i.id).sort());
      if(seen.current.has(fingerprint)){setPage({...next,nextSkip:null});setNotice(t`This source repeated a page. Pagination stopped.`);}
      else{seen.current.add(fingerprint);setPage(next);}
    });
  }
  type Title=CatalogPage['items'][number];
  function savedIn(collection:WatchCollection,item:WatchCollectionItem){return !!collections?.[collection].some(row=>row.id===item.id&&row.mediaType===item.mediaType);}
  async function toggleCollection(collection:WatchCollection,item:WatchCollectionItem){
    if(profileId===undefined||!collections)return;
    const enabled=!savedIn(collection,item);
    await run(async()=>{
      const data=await setWatchCollection(profileId,collection,item,enabled);
      if(mounted.current)setCollectionState({profileId,data});
    });
  }
  function contentPane(){return !!onPlay&&['home','discover','anime','favorites','queue'].includes(pane);}
  async function launchStream(item:Title,video:string,metadata:AddonMetadata|null,picked:AddonOptions,index:number,startMs=0,episodeTitle:string|null=null){
    if(profileId===undefined||!onPlay||!picked.rows[index]?.supported)return;
    stopStreams(false);
    const played=metadata?.videos.find(v=>v.id===video);
    const still=played&&String(played.season)===selectedSeason?seasonArt.find(e=>e.episode===played.episode)?.thumbnail:undefined;
    rememberWatchArtwork(profileId,{mediaType:item.mediaType,itemId:item.id,videoId:video},still,played?.thumbnail,cinema?.background,metadata?.background,item.background,metadata?.poster,item.poster);
    const grantId=await prepareAddonMedia(profileId,picked.reviewId,index,false,startMs);
    if(!mounted.current)return;
    suppressSourceFocus.current=true;setSourceOpen(false);setOptions(null);setStreamGroups(null);
    onPlay({profileId,grantId,mediaType:item.mediaType,itemId:item.id,videoId:video,title:metadata?.name??item.name,
      episodeTitle:isWatchMovie(item.mediaType)?null:metadata?.videos.find(v=>v.id===video)?.name??episodeTitle,
      startMs,anime:pane==='anime'||item.mediaType.startsWith('anime')||item.id.startsWith('kitsu:'),videos:metadata?.videos??[],routes:watchVideoRoutes(item,video,metadata),streamSources:sources.filter(s=>s.enabled&&s.manifest.resources.includes('stream')).map(s=>({sourceId:s.sourceId,name:s.manifest.name})),
      subtitleSources:sources.filter(s=>s.enabled&&s.manifest.resources.includes('subtitles')).map(s=>({sourceId:s.sourceId,name:s.manifest.name}))});
  }
  async function fetchStreams(item:Title,video:string,autoStart=false,metadata:AddonMetadata|null=null,entry:WatchProgress|null=null){
    if(profileId===undefined||!video)return;
    const resolvedMetadata=metadata??(details?.id===item.id&&details.mediaType===item.mediaType?details:null);
    stopStreams();setStreamGroups(null);setStreamPending(-1);setError('');setNotice('');
    const request:{profileId:number;queryId?:number;cancelled:boolean}={profileId,cancelled:false};
    streamRequest.current=request;
    try{
      let snapshot=await beginAddonStreams(profileId,item.mediaType,video,watchVideoRoutes(item,video,resolvedMetadata));
      request.queryId=snapshot.queryId;
      if(request.cancelled){void cancelAddonStreams(profileId,snapshot.queryId).catch(()=>{});return;}
      while(mounted.current&&streamRequest.current===request){
        const groups=sources.filter(s=>s.enabled).flatMap(s=>snapshot.groups.filter(g=>g.sourceId===s.sourceId));
        setStreamGroups(groups);setStreamPending(snapshot.done?null:snapshot.pendingSourceIds.length);
        if(snapshot.done){
          if(autoStart&&autoPlayFirst&&onPlay&&!flight.current){
            const first=groups.find(group=>group.options?.rows.some(row=>row.supported))?.options;
            if(first){
              const index=first.rows.findIndex(row=>row.supported);
              const startMs=entry&&!entry.completed&&entry.positionMs<entry.durationMs?entry.positionMs:0;
              await run(()=>launchStream(item,video,resolvedMetadata,first,index,startMs,entry?.episodeTitle??null));
            }
          }
          return;
        }
        await new Promise(resolve=>setTimeout(resolve,250));
        if(request.cancelled||!mounted.current||streamRequest.current!==request)return;
        snapshot=await pollAddonStreams(profileId,snapshot.queryId,item.mediaType,video);
      }
    }catch(reason){if(mounted.current&&streamRequest.current===request){setStreamPending(null);setError(feedback(reason));}}
  }
  async function resolveMetadata(item:Title,preferredSourceId?:number,allowMapping=true):Promise<{item:Title;metadata:AddonMetadata|null}>{
    if(profileId===undefined)return {item,metadata:null};
    // Obtain an explicit TMDB/IMDb alias before looking for exact addon metadata.
    if(!item.imdbId&&/^tmdb:/.test(item.id)){
      try{const tmdb=await loadTmdbTitle(profileId,item.mediaType,item.id);item={...item,imdbId:tmdb.imdbId,identities:tmdb.identities,poster:item.poster??tmdb.poster,background:item.background??tmdb.background};}catch{/* Addon metadata remains usable. */}
    }
    const candidates=sources.filter(source=>source.enabled&&source.manifest.resources.includes('meta'));
    candidates.sort((a,b)=>Number(b.sourceId===preferredSourceId)-Number(a.sourceId===preferredSourceId));
    async function lookup(target:Title,publicSource:boolean,alternate=false){
      let metadata:AddonMetadata|null=null;
      const ids=(alternate?candidates.slice(0,4):candidates).map(source=>source.sourceId);
      const ordered=alternate&&publicSource?[0,...ids]:[...ids,...(publicSource?[0]:[])];
      for(const sourceId of ordered){
        try{
          const next=await loadAddonMetadata(profileId!,sourceId,target.mediaType,target.id);
          if(!metadata||next.videos.length)metadata=next;
          if(isWatchMovie(target.mediaType)||next.videos.length)break;
        }catch{/* A provider may not support this exact identity. */}
        if(!mounted.current)return null;
      }
      return metadata;
    }
    const publicSource=(id:string)=>/^tt[0-9]{1,12}$/.test(id)||/^kitsu:[1-9][0-9]{0,9}$/.test(id);
    const exact=await lookup(item,publicSource(item.id));
    let target=item,combined=exact;
    // Resolve at most three explicit alternate title identities. The
    // metadata lookup must succeed before an episode alias can be attached.
    if(sources.some(source=>source.enabled&&source.manifest.resources.includes('stream'))){
      for(const route of titleIdentityRoutes(item,exact).slice(0,3)){
        if(!mounted.current)break;
        const alias={...item,id:route.videoId,mediaType:route.mediaType};
        const next=await lookup(alias,publicSource(alias.id),true);
        if(!next)continue;
        if(combined&&(combined.videos.length||isWatchMovie(target.mediaType))){
          combined=mergeAliasMetadata(combined,next);
        }else if(allowMapping&&(next.videos.length||isWatchMovie(alias.mediaType))){
          target=alias;combined=combined?mergeAliasMetadata(next,combined):next;
        }
      }
    }
    if(combined?.videos.length||combined&&isWatchMovie(target.mediaType))return {item:target,metadata:combined};
    const mal=/^mal:([1-9][0-9]{0,9})$/.exec(item.id);
    if(!allowMapping||!mal||!sources.some(source=>source.enabled&&source.manifest.resources.includes('stream')))return {item,metadata:exact};
    // Resolve a public identity, never construct a video/episode ID ourselves.
    try{
      const response=await fetch('https://relations.yuna.moe/api/ids?source=myanimelist&id='+mal[1],{signal:AbortSignal.timeout(6000),credentials:'omit',referrerPolicy:'no-referrer'});
      if(!response.ok)return {item,metadata:exact};
      const raw=await response.text();
      if(raw.length>16384)return {item,metadata:exact};
      const mapped=JSON.parse(raw);
      const kitsu=Number(mapped?.kitsu);
      if(!Number.isSafeInteger(kitsu)||kitsu<=0||kitsu>9999999999||!mounted.current)return {item,metadata:exact};
      for(const mediaType of [item.mediaType,'anime']){
        const target={...item,id:'kitsu:'+kitsu,mediaType};
        const metadata=await lookup(target,true);
        if(metadata?.videos.length||metadata&&isWatchMovie(mediaType))return {item:target,metadata};
        if(!mounted.current)break;
      }
    }catch{/* Offline or unmapped: keep the original public detail and search fallback. */}
    return {item,metadata:exact};
  }
  async function openTitle(item:Title,preferredSourceId?:number){
    if(flight.current||profileId===undefined)return;
    const auto=contentPane();
    rememberBrowse();clearTitle();setTitle(item);setAutomatic(auto);
    if(isWatchMovie(item.mediaType))setVideoId(item.id);
    await run(async()=>{
      const resolved=await resolveMetadata(item,preferredSourceId);
      if(!mounted.current)return;
      const target=resolved.item,metadata=resolved.metadata;
      setTitle(target);setDetails(metadata);
      const chosen=isWatchMovie(target.mediaType)?metadata?.videos[0]?.id??target.id:metadata?.videos.length===1?metadata.videos[0].id:'';
      setVideoId(chosen);
    });
  }
  function openHistory(entry:WatchProgress){
    if(flight.current||!profileReady)return;
    const item={id:entry.itemId,name:entry.title,mediaType:entry.mediaType};
    const auto=contentPane();
    rememberBrowse();clearTitle();setTitle(item);setAutomatic(auto);setVideoId(entry.videoId);setResumeEntry(entry);
    if(auto){showSources();void run(async()=>{
      const {metadata}=await resolveMetadata(item,undefined,false);
      if(!mounted.current)return;
      setDetails(metadata);
      void fetchStreams(item,entry.videoId,true,metadata,entry);
    });}
  }
  async function readMetadata(item:Title,sourceId:number){
    if(flight.current||profileId===undefined)return;
    // A metadata request invalidates native stream reviews even on failure.
    setOptions(null);setStreamGroups(null);
    await run(async()=>{
      const next=await loadAddonMetadata(profileId,sourceId,item.mediaType,item.id);
      if(!mounted.current)return;
      const videos=new Map(details?.videos.map(video=>[video.id,video]));
      for(const video of next.videos){
        const previous=videos.get(video.id);
        videos.set(video.id,{...video,season:video.season??previous?.season??null,episode:video.episode??previous?.episode??null,
          thumbnail:video.thumbnail??previous?.thumbnail,description:video.description??previous?.description,routes:previous?.routes});
      }
      const merged:AddonMetadata={...next,description:next.description??details?.description??null,videos:[...videos.values()],
        poster:next.poster??details?.poster,background:next.background??details?.background,releaseInfo:next.releaseInfo??details?.releaseInfo,
        runtime:next.runtime??details?.runtime,imdbRating:next.imdbRating??details?.imdbRating,
        genres:next.genres??details?.genres,cast:next.cast??details?.cast,directors:next.directors??details?.directors,
        identities:[...new Set([...(details?.identities??[]),...(next.identities??[])])].slice(0,8)};
      const preferred=videoId||resumeEntry?.videoId;
      const chosen=preferred&&videos.has(preferred)?preferred:isWatchMovie(item.mediaType)?merged.videos[0]?.id??item.id:merged.videos.length===1?merged.videos[0].id:'';
      setDetails(merged);setVideoId(chosen);
      setSourceOpen(false);
    });
  }
  function progressFor(item:Title,video:string):WatchProgress|null{
    const matches=(p:WatchProgress)=>p.itemId===item.id&&p.mediaType===item.mediaType&&p.videoId===video;
    if(resumeEntry&&matches(resumeEntry))return resumeEntry;
    return episodeHistory?.profileId===profileId?episodeHistory?.entries.find(({progress})=>matches(progress))?.progress??null:null;
  }
  function selectVideo(video:string){
    if(flight.current)return;
    const entry=title&&video?progressFor(title,video):null;
    setVideoId(video);setResumeEntry(entry);setOptions(null);setStreamGroups(null);
    if(automatic&&title&&video){showSources();void fetchStreams(title,video,true,details,entry);}
  }
  React.useEffect(()=>{
    if(!returnedPlayback||handledReturn.current===returnedPlayback||!title||returnedPlayback.profileId!==profileId||returnedPlayback.mediaType!==title.mediaType||returnedPlayback.itemId!==title.id)return;
    handledReturn.current=returnedPlayback;
    const video=returnedPlayback.videos.find(v=>v.id===returnedPlayback.videoId);
    setVideoId(returnedPlayback.videoId);setSeasonChoice(video?seasonOf(video):null);setResumeEntry(null);
    detailRef.current?.focus({preventScroll:true});
    let current=true;
    void listWatchHistory(returnedPlayback.profileId).then(rows=>{
      if(current&&mounted.current)setResumeEntry(rows.find(({progress:p})=>p.mediaType===returnedPlayback.mediaType&&p.itemId===returnedPlayback.itemId&&p.videoId===returnedPlayback.videoId)?.progress??null);
    }).catch(()=>{});
    return ()=>{current=false;};
  },[returnedPlayback,profileId,title]);
  function retryStream(sourceId:number){
    if(flight.current||streamPending!==null||profileId===undefined||!title||!videoId||!streamGroups?.some(group=>group.sourceId===sourceId))return;
    void run(async()=>{
      const group=await retryAddonStreams(profileId,sourceId,title.mediaType,videoId);
      if(mounted.current)setStreamGroups(previous=>previous?.map(row=>row.sourceId===sourceId?group:row)??null);
    });
  }
  function refreshStreams(){
    if(flight.current||!title||!videoId)return;
    setOptions(null);setStreamGroups(null);if(!sourceOpen)showSources();void fetchStreams(title,videoId);
  }
  async function readOptions(sourceId:number,subtitles:boolean){
    if(flight.current||profileId===undefined||!title||!videoId)return;
    setOptions(null);setStreamGroups(null);
    await run(async()=>{
      const result=await loadAddonOptions(profileId,sourceId,title.mediaType,videoId,subtitles);
      if(mounted.current)setOptions({sourceId,subtitles,...result});
    });
  }
  const resumeMatch=title&&videoId?progressFor(title,videoId):null;
  const resumeMs=resumeMatch&&!resumeMatch.completed&&resumeMatch.positionMs<resumeMatch.durationMs?resumeMatch.positionMs:0;
  async function playOption(index:number,resume=false,picked=options){
    if(flight.current||profileId===undefined||!title||!videoId||!picked||picked.subtitles||!onPlay||!picked.rows[index]?.supported)return;
    await run(()=>launchStream(title,videoId,details,picked,index,resume?resumeMs:0,resumeMatch?.episodeTitle??null));
  }
  async function selectPane(next:WatchPane){
    if(flight.current||pane===next)return;
    const previous=clearReview();
    setImportActive(false);choose(null);setBoardSearch('');setPane(next);
    if(previous)await run(async()=>{await cancelAddonReview(previous.profileId,previous.reviewId);});
  }
  async function backToProfiles(){
    if(flight.current)return;
    const previous=clearReview();
    onProfileSelected?.(undefined);setImportActive(false);choose(null);setEntered(false);setCreating(false);
    if(previous)await run(async()=>{await cancelAddonReview(previous.profileId,previous.reviewId);});
  }
  const videos=details?.videos??[];
  const seasons=[...new Set(videos.map(seasonOf))].sort((a,b)=>a==='other'?1:b==='other'?-1:Number(a)-Number(b));
  const selectedVideo=videos.find(v=>v.id===videoId);
  const titleKey=title?.id,titleKind=title?.mediaType,titleImdb=title?.imdbId;
  React.useEffect(()=>{setCinema(null);if(profileId===undefined||!titleKey||!titleKind)return;let current=true;void loadTmdbTitle(profileId,titleKind,titleImdb??titleKey).then(item=>{if(current)setCinema(item);}).catch(()=>{});return ()=>{current=false;};},[profileId,titleKey,titleKind,titleImdb]);
  const selectedSeason=seasonChoice!==null&&seasons.includes(seasonChoice)?seasonChoice:selectedVideo?seasonOf(selectedVideo):seasons.find(s=>s!=='0'&&s!=='other')??seasons[0]??'other';
  const cinemaId=cinema?.tmdbId,cinemaRuntime=cinema?.runtime;
  React.useEffect(()=>{setSeasonArt([]);if(profileId===undefined||!cinemaId||cinema?.mediaType!=='series'||!/^\d+$/.test(selectedSeason))return;let current=true;void loadTmdbSeason(profileId,cinemaId,Number(selectedSeason)).then(items=>{if(current)setSeasonArt(items);}).catch(()=>{});return ()=>{current=false;};},[profileId,cinemaId,cinema?.mediaType,selectedSeason]);
  const seasonVideos=videos.filter(v=>seasonOf(v)===selectedSeason).sort((a,b)=>(a.episode??Number.MAX_SAFE_INTEGER)-(b.episode??Number.MAX_SAFE_INTEGER));
  React.useEffect(()=>{
    if(profileId===undefined||!titleKey||!historyActive||sourceOpen)return;
    let current=true;
    void listWatchHistory(profileId).then(entries=>{if(current)setEpisodeHistory({profileId,entries});}).catch(()=>{});
    return ()=>{current=false;};
  },[profileId,titleKey,historyActive,sourceOpen,returnedPlayback]);
  function episodeProgress(video:AddonVideo){
    return title?progressFor(title,video.id):null;
  }
  if(workspace&&!entered)return <section className="tsugi-watch-picker" data-ui="watch-profile-picker" aria-labelledby={titleId}>
    <div className="tsugi-watch-picker-art" aria-hidden="true" style={{'--tsugi-watch-art':"url('/design/shared/hero-neon.webp')"} as React.CSSProperties}/>
    <div className="tsugi-watch-picker-content">
      <TsugiBrand />
      <h3 id={titleId}><Trans>Who’s watching?</Trans></h3>
      <p><Trans>Choose your Watch profile. Your addons and source order are yours.</Trans></p>
      {setupConnections&&<p><Trans>TMDB and a streaming account import are required. MyAnimeList, Refract and MDBList are optional.</Trans></p>}
      {profileState&&<div className="tsugi-watch-profiles">
        {profileState.profiles.map(p=><button key={p.profileId} type="button" className="tsugi-watch-profile" data-profile-id={p.profileId} disabled={blocked} onClick={()=>void changeProfile({kind:'profile-switch',profileId:p.profileId},true)}>
          <span className="tsugi-watch-avatar tsugi-watch-avatar-minimal" data-color={p.profileId%6} aria-hidden="true">{Array.from(p.name.trim())[0]?.toUpperCase()??'?'}</span>
          <strong>{p.name}</strong><small>{p.sourceCount} <Trans>addons</Trans></small>
        </button>)}
        {profileState.profiles.length<6&&<button type="button" className="tsugi-watch-profile" disabled={blocked} onClick={()=>{setCreating(true);setProfileName('');}}>
          <span className="tsugi-watch-avatar tsugi-watch-create"><TsugiIcon name="plus"/></span>
          <strong><Trans>Create profile</Trans></strong>
        </button>}
      </div>}
      {creating&&<form className="tsugi-watch-create-form" onSubmit={e=>{e.preventDefault();void changeProfile({kind:'profile-create',name:profileName},true);}}>
        <label><Trans>Profile name</Trans><input className="tsugi-read-input w-full" autoComplete="off" required maxLength={64} value={profileName} disabled={blocked} onChange={e=>setProfileName(e.target.value)}/></label>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="tsugi-read-action tsugi-series-primary" disabled={blocked||!profileName.trim()}><Trans>Create and continue</Trans></button>
          <button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>setCreating(false)}><Trans>Cancel</Trans></button>
        </div>
      </form>}
      {busy&&<p role="status"><Trans>Loading profiles…</Trans></p>}
      {error&&<p role="alert">{error}</p>}
      {!profileReady&&!busy&&<button type="button" className="tsugi-read-action" onClick={()=>void refreshProfiles()}><Trans>Refresh profiles</Trans></button>}
    </div>
  </section>;
  if(workspace&&(onPlay||setupConnections)&&(!profileReady||profileId===undefined||setupVerified!==profileId)){
    if(!profileReady||profileId===undefined)return <section className="tsugi-watch-picker">
      {error?<p role="alert">{error}</p>:<p role="status"><Trans>Loading profile…</Trans></p>}
      {!busy&&<button type="button" className="tsugi-read-action" onClick={()=>void refreshProfiles()}><Trans>Refresh profiles</Trans></button>}
    </section>;
    return <WatchSetupGate key={profileId} profileId={profileId} onBack={()=>void backToProfiles()} onReady={async id=>{
      const next=await listAddons(id);
      if(mounted.current){updateSources(next,id);setSetupVerified(id);}
    }}/>;
  }
  const show=(...panes:WatchPane[])=>!workspace||panes.includes(pane);
  const hubPanes:WatchPane[]=['hubs','home','discover','anime','history','favorites','queue'];
  const inSettings=!hubPanes.includes(pane);
  const hubChooser=workspace&&!!onPlay&&pane==='hubs';
  const settingsTabs=([
    ['addons',t`Your addons`,'addons'],
    ['stremio',t`Stremio import`,'stremio'],
    ['nuvio',t`Nuvio import`,'nuvio'],
    ['manual',t`Add addon`,'add'],
    ['order',t`Source order`,'order'],
    ['tmdb',t`TMDB`,'mdblist'],
    ['mdblist',t`MDBList`,'mdblist'],
    ['anime-import',t`MyAnimeList XML`,'anime'],
    ['refract',t`Refract`,'refract'],
    ['playback',t`Playback`,'tv'],
    ['profile',t`Profile settings`,'settings']
  ] as const).filter(([id])=>(id!=='refract'||!!onPlay||setupConnections)&&(id!=='playback'||!!onPlay)&&(id!=='anime-import'||!!onPlay));
  function searchTitleInAddons(){
    if(!title||flight.current)return;
    const name=title.name;
    choose(null);setBoardSearch(name);setPane('discover');
  }
  return <section className={workspace?onPlay?'tsugi-watch-workspace tsugi-watch-hub':'tsugi-app-general tsugi-watch-workspace tsugi-watch-configuration':'tsugi-app-general'} data-ui="stremio-addon-settings" data-watch-pane={pane} aria-labelledby={titleId}>
    {workspace&&!hubChooser&&<header className={onPlay&&!inSettings?'tsugi-watch-hub-header':'tsugi-watch-workspace-banner'} style={{'--tsugi-watch-art':"url('/design/shared/hero-train.webp')"} as React.CSSProperties}>
      <div><TsugiBrand className="tsugi-watch-header-brand"/><p><Trans>Watch profile</Trans> / {activeProfile?.name}</p><h3 id={titleId}>{pane==='anime'?<Trans>Anime</Trans>:pane==='home'||pane==='discover'||pane==='history'?<Trans>Movies &amp; TV</Trans>:<Trans>Your addon stack.</Trans>}</h3>{(pane==='home'||pane==='discover')?<p><Trans>Watch from your connected catalogues and streaming addons.</Trans></p>:pane!=='anime'&&<p><Trans>Bring your sources home.</Trans></p>}</div>
      <div className="flex flex-wrap gap-2">
        {onPlay&&<button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void selectPane('hubs')}><MovieGlyph name="grid"/> <Trans>Streaming hubs</Trans></button>}
        <button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void backToProfiles()}><MovieGlyph name="people"/> <Trans>Switch profile</Trans></button>
      </div>
    </header>}
    {hubChooser&&<section className="tsugi-watch-destinations" data-ui="watch-hub-picker" aria-labelledby={titleId}>
      <header className="tsugi-watch-workspace-banner" style={{'--tsugi-watch-art':"url('/design/shared/hero-neon.webp')"} as React.CSSProperties}>
        <div><TsugiBrand/><p><Trans>Watch profile</Trans> / {activeProfile?.name}</p><h3 id={titleId}><Trans>Choose your streaming hub</Trans></h3><p><Trans>Browse movies, series and anime using the sources you choose.</Trans></p></div>
        <button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void backToProfiles()}><Trans>Switch profile</Trans></button>
      </header>
      <div className="tsugi-watch-destination-grid">
        <button type="button" className="tsugi-watch-destination" data-watch-destination="aio" disabled={busy||!openServer} onClick={openServer}>
          <span className="tsugi-watch-destination-art"><img src="/design/shared/hero-train.webp" alt="" decoding="async"/><MovieGlyph name="tv"/></span>
          <strong><Trans>AIOStreams</Trans></strong><small><Trans>Requires a configured AIOStreams or media server connection.</Trans></small>
        </button>
        <button type="button" className="tsugi-watch-destination" data-watch-destination="standalone" disabled={busy} onClick={()=>void selectPane('home')}>
          <span className="tsugi-watch-destination-art"><img src="/design/shared/hero-neon.webp" alt="" decoding="async"/><MovieGlyph name="home"/></span>
          <strong><Trans>Movies &amp; TV</Trans></strong><small><Trans>Browse without addons. Watch with Stremio, Nuvio or individual addons.</Trans></small>
        </button>
        <button type="button" className="tsugi-watch-destination" data-watch-destination="anime" disabled={busy} onClick={()=>void selectPane('anime')}>
          <span className="tsugi-watch-destination-art"><img src="/design/anime/hero-kagezora.webp" alt="" decoding="async"/><MovieGlyph name="anime"/></span>
          <strong><Trans>Anime Hub</Trans></strong><small><Trans>Explore anime and films. No account or addon needed to browse.</Trans></small>
        </button>
      </div>
      <div className="flex flex-wrap gap-2 justify-center"><button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void selectPane('addons')}><MovieGlyph name="settings"/> <Trans>Watch settings</Trans></button></div>
    </section>}
    {workspace&&onPlay&&!hubChooser&&<TsugiRail area="video" disabled={busy} className="tsugi-watch-shared-rail"><nav className="tsugi-watch-nav tsugi-rail-local" aria-label={t`Watch navigation`} data-ui="watch-hub-navigation">
      {([
        ['home',t`Home`,'home'],
        ['discover',t`Discover`,'discover'],
        ['anime',t`Anime Hub`,'anime'],
        ['favorites',t`Favorites`,'heart'],
        ['queue',t`Queue`,'list'],
        ['history',t`Watch history`,'history'],
        ['addons',t`Settings`,'settings']
      ] as const).map(([id,label,icon])=><button key={id} type="button" className="tsugi-watch-nav-item" title={label} aria-label={label} aria-current={(id==='addons'?inSettings:pane===id)?'page':undefined} aria-pressed={id==='addons'?inSettings:pane===id} disabled={busy} onClick={()=>void selectPane(id)}><MovieGlyph name={icon}/><span>{label}</span></button>)}
    </nav></TsugiRail>}
    <div className={workspace?'tsugi-watch-content':'contents'} data-watch-settings={workspace&&inSettings||undefined} hidden={hubChooser}>
    {workspace&&(!onPlay||inSettings)&&<nav className="tsugi-watch-settings-nav" aria-label={t`Watch settings`} data-ui="watch-settings-navigation">
      {(!onPlay&&setupConnections?[...settingsTabs,['anime',t`Anime`,'anime'] as const]:settingsTabs).map(([id,label,icon])=><button key={id} type="button" className="tsugi-watch-nav-item" aria-pressed={pane===id} disabled={busy} onClick={()=>void selectPane(id)}><MovieGlyph name={icon}/><span>{label}</span></button>)}
      {onPlay&&<button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void selectPane('home')}><Trans>Back to streaming hub</Trans></button>}
    </nav>}
    {!workspace&&<h3 id={titleId}><Trans>Stremio addons</Trans></h3>}
    {workspace&&onPlay&&profileReady&&profileId!==undefined&&(pane==='home'||pane==='discover')&&<WatchCatalogueBoard key={JSON.stringify([profileId,pane,boardSearch])} initialQuery={boardSearch} profileId={profileId} sources={sources} busy={busy} run={run} active={historyActive} paused={!!title} includeHistory={pane==='home'} openTitle={(item,sourceId)=>void openTitle(item,sourceId)} openHistory={openHistory} openAddons={()=>void selectPane('addons')}/>}
    {workspace&&onPlay&&pane==='playback'&&<section className="min-w-0" data-ui="watch-playback-settings"><WatchPlaybackSettings/></section>}
    {show('profile')&&<>
    <p><Trans>Each local profile has its own addons, without an AIOStreams connection. Browse catalogues and select supported direct HTTPS streams in Watch.</Trans></p>
    <p><Trans>Configured links are protected by your Windows account and excluded from portable backups. Local profiles are not password-protected from other people using this Windows account. Only contact addon hosts you trust.</Trans></p>
    <div className="space-y-3" data-ui="stremio-profile-management">
      <h4><Trans>Addon profiles</Trans></h4>
      {profileState&&activeProfile&&<>
        <label><Trans>Active addon profile</Trans><select className="tsugi-menu-select w-full" value={profileId} disabled={busy} onChange={e=>void changeProfile({kind:'profile-switch',profileId:Number(e.target.value)})}>
          {profileState.profiles.map(p=><option key={p.profileId} value={p.profileId}>{p.name}</option>)}
        </select></label>
        <label><Trans>Profile name</Trans><input className="tsugi-read-input w-full min-w-0" autoComplete="off" maxLength={64} value={profileName} disabled={busy} onChange={e=>setProfileName(e.target.value)}/></label>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="tsugi-read-action" disabled={busy||!profileName.trim()||profileState.profiles.length>=6} onClick={()=>void changeProfile({kind:'profile-create',name:profileName})}><Trans>Create profile</Trans></button>
          <button type="button" className="tsugi-read-action" disabled={busy||!profileName.trim()} onClick={()=>void changeProfile({kind:'profile-rename',profileId:activeProfile.profileId,name:profileName})}><Trans>Rename active profile</Trans></button>
        </div>
        {profileState.profiles.length>1&&<details>
          <summary><Trans>Delete an inactive profile</Trans></summary>
          <div className="space-y-2">
            <p><Trans>Deleting a profile removes its saved addon configurations, connected account credentials, imported anime collection and source assignments, and local Watch history. Switch away from it first. This cannot be undone.</Trans></p>
            <label><Trans>Profile to delete</Trans><select className="tsugi-menu-select w-full" disabled={busy} value={deleteId} onChange={e=>{setDeleteId(Number(e.target.value));setDeleteName('');}}>
              <option value={0}>{t`Select`}</option>{profileState.profiles.filter(p=>p.profileId!==profileId).map(p=><option key={p.profileId} value={p.profileId}>{p.name}</option>)}
            </select></label>
            {deleteTarget&&<><label><Trans>Confirm profile name</Trans><input className="tsugi-read-input w-full min-w-0" disabled={busy} autoComplete="off" value={deleteName} onChange={e=>setDeleteName(e.target.value)}/></label>
              <button type="button" className="tsugi-read-action" disabled={busy||deleteName!==deleteTarget.name} onClick={()=>void changeProfile({kind:'profile-remove',profileId:deleteTarget.profileId,confirmedName:deleteName})}><Trans>Delete profile</Trans></button></>}
          </div>
        </details>}
      </>}
      <button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void refreshProfiles()}><Trans>Refresh profiles</Trans></button>
    </div>
    </>}
    {show('stremio','nuvio')&&profileReady&&profileId!==undefined&&<StremioAccountImport key={workspace?profileId+':'+pane:profileId} fixedProvider={workspace?(pane==='nuvio'?'nuvio':'stremio'):undefined} profileId={profileId} busy={busy} run={run} onActive={setImportActive} onConnect={()=>{clearReview();setImportReport(null);}} onSources={result=>{updateSources(result.sources,profileId);setImportReport({profileId,result});if(workspace&&onPlay)setPane('home');}}/>}
    {show('manual')&&<><h4><Trans>Add a manifest</Trans></h4>
    <form className="space-y-2" onSubmit={e=>{e.preventDefault();void inspect();}}>
      <label><Trans>Configured manifest URL</Trans><input className="tsugi-read-input w-full min-w-0" type="password" autoComplete="off" spellCheck={false} maxLength={16384} value={url} required disabled={manualBlocked} onChange={e=>{setUrl(e.target.value);setConsent(false);}}/></label>
      <label className="flex items-start gap-2"><input type="checkbox" checked={consent} disabled={manualBlocked} onChange={e=>setConsent(e.target.checked)}/><Trans>I trust this addon host and want Tsugi to contact it.</Trans></label>
      <button type="submit" className="tsugi-read-action" disabled={manualBlocked||!url.trim()||!consent}><Trans>Review addon</Trans></button>
    </form>
    {review&&<div className="space-y-2" data-ui="stremio-review">
      <h4 className="break-words">{review.manifest.name}</h4>
      <p>{review.manifest.version} · {review.manifest.resources.join(', ')}</p>
      <p>{review.manifest.catalogs.length} <Trans>catalogues</Trans></p>
      {review.manifest.configurationRequired&&<p role="alert"><Trans>This addon needs configuration before installation.</Trans></p>}
      {review.manifest.p2p&&<p><Trans>This addon declares peer-to-peer support. Tsugi does not enable peer-to-peer playback here.</Trans></p>}
      {review.manifest.adult&&<p><Trans>This addon declares adult content.</Trans></p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="tsugi-read-action" disabled={manualBlocked||review.manifest.configurationRequired} onClick={()=>void change({kind:'install',reviewId:review.reviewId})}><Trans>Install into profile</Trans></button>
        <button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void cancel()}><Trans>Cancel review</Trans></button>
      </div>
    </div>}
    </>}
    {show('addons','order')&&<>
    <h4>{workspace&&pane==='order'?<Trans>Source order</Trans>:<Trans>Installed addons</Trans>}</h4>
    {workspace&&pane==='addons'&&<div className="flex flex-wrap gap-2">
      <button type="button" className="tsugi-read-action tsugi-series-primary" disabled={busy} onClick={()=>void selectPane('manual')}><Trans>Add addon</Trans></button>
      <button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void selectPane('stremio')}><Trans>Import from Stremio</Trans></button>
      <button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void selectPane('nuvio')}><Trans>Import from Nuvio</Trans></button>
    </div>}
    {workspace&&pane==='order'&&<p><Trans>Sources are tried in this order. Use the arrows to change their priority.</Trans></p>}
    <button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void refreshProfiles()}><Trans>Refresh installed addons</Trans></button>
    {profileReady&&!sources.length&&<p><Trans>No addons installed for this profile.</Trans></p>}
    {sources.map((s,index)=><div key={s.sourceId} data-stremio-source-id={s.sourceId} className="tsugi-read-row flex-wrap">
      <div className="min-w-0 flex-1"><span className="break-words">{s.manifest.name}</span><small className="block">{s.manifest.version} · {s.enabled?t`Enabled`:t`Disabled`}</small></div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="tsugi-read-action" disabled={busy||!s.enabled||!s.manifest.catalogs.length} onClick={()=>choose({sourceId:s.sourceId,catalogIndex:0})}><Trans>Browse catalogues</Trans></button>
        <button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void change({kind:'set-enabled',sourceId:s.sourceId,enabled:!s.enabled})}>{s.enabled?t`Disable`:t`Enable`}</button>
        <button type="button" className="tsugi-read-action" disabled={busy||index===0} onClick={()=>void change({kind:'move',sourceId:s.sourceId,position:index-1})}><Trans>Move up</Trans></button>
        <button type="button" className="tsugi-read-action" disabled={busy||index===sources.length-1} onClick={()=>void change({kind:'move',sourceId:s.sourceId,position:index+1})}><Trans>Move down</Trans></button>
        <button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void change({kind:'remove',sourceId:s.sourceId})}><Trans>Remove</Trans></button>
      </div>
    </div>)}
    {source&&catalog&&selection&&<form className="space-y-3" data-ui="stremio-catalog" onSubmit={e=>{e.preventDefault();void load(0);}}>
      <h4 className="break-words">{source.manifest.name}</h4>
      <label><Trans>Catalogue</Trans><select className="tsugi-menu-select w-full" disabled={busy} value={selection.catalogIndex} onChange={e=>choose({sourceId:source.sourceId,catalogIndex:Number(e.target.value)})}>
        {source.manifest.catalogs.map((c,index)=><option key={index} value={index}>{c.name} · {c.mediaType}</option>)}
      </select></label>
      {catalog.extras.filter(e=>e.name!=='skip').map(extra=>{
        const label=extra.name==='search'?t`Search`:extra.name==='genre'?t`Genre`:extra.name;
        const update=(value:string)=>{setFilters(old=>new Map(old).set(extra.name,value));clearPage();};
        return <label key={extra.name}>{label}{extra.options.length?
          <select className="tsugi-menu-select w-full" required={extra.required} disabled={busy} value={filters.get(extra.name)??''} onChange={e=>update(e.target.value)}><option value="">{t`Select`}</option>{extra.options.map((o,index)=><option key={index} value={o}>{o}</option>)}</select>:
          <input className="tsugi-read-input w-full min-w-0" maxLength={512} required={extra.required} disabled={busy} value={filters.get(extra.name)??''} onChange={e=>update(e.target.value)}/>}</label>;
      })}
      <button type="submit" className="tsugi-read-action" disabled={busy||!validFilters}><Trans>Load catalogue</Trans></button>
      {page&&<><p>{page.items.length} <Trans>titles on this page</Trans></p><ul className="max-h-64 overflow-auto">{page.items.map(item=><li className="tsugi-read-row break-words" key={item.id}>{workspace?<button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void openTitle(item)}>{item.name}</button>:item.name}</li>)}</ul>
        {page.nextSkip!==null&&<button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void load(page.nextSkip!)}><Trans>Next page</Trans></button>}</>}
    </form>}
    </>}
    {workspace&&(pane==='favorites'||pane==='queue')&&!title&&<section className="tsugi-watch-collection" data-ui="watch-collection">
      <h3>{pane==='favorites'?t`Favorites`:t`Your queue`}</h3>
      {!collections?<p role="status"><Trans>Loading your library…</Trans></p>:collections[pane].length===0?<p className="tsugi-watch-muted">{pane==='favorites'?t`Save the titles you love from their details page.`:t`Add movies and series to watch next from their details page.`}</p>:<div className="tsugi-watch-collection-grid">{collections[pane].map(item=><div key={JSON.stringify([item.mediaType,item.id])}>
        <PosterCard title={item.name} image={item.poster??null} disabled={busy} onClick={()=>void openTitle(item)}/>
        <button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void toggleCollection(pane,item)}><Trans>Remove</Trans></button>
      </div>)}</div>}
    </section>}
    {workspace&&pane==='history'&&historyActive&&profileReady&&profileId!==undefined&&<WatchHistory key={profileId} profileId={profileId} busy={busy} run={run} open={openHistory} removed={clearTitle}/>}
    {workspace&&(pane==='anime'||pane==='anime-import')&&profileReady&&profileId!==undefined&&<MalAnimeLibrary key={profileId+':'+pane} profileId={profileId} sources={sources} busy={busy} historyActive={pane==='anime'&&historyActive} setupOnly={!onPlay||pane==='anime-import'} detailOpen={!!title} run={run} openTitle={(item,sourceId)=>void openTitle(item,sourceId)} openHistory={openHistory} clearTitle={clearTitle} openAddons={()=>void selectPane('addons')}/>}
    {workspace&&pane==='tmdb'&&profileReady&&profileId!==undefined&&<TmdbSettings key={profileId} profileId={profileId}/>}
    {workspace&&pane==='mdblist'&&profileReady&&profileId!==undefined&&<MdblistSettings key={profileId} profileId={profileId} openTitle={item=>void openTitle(item)}/>}
    {workspace&&pane==='refract'&&(historyActive||setupConnections)&&profileReady&&profileId!==undefined&&<RefractSettings key={profileId} profileId={profileId} busy={busy} run={run}/>}
    {workspace&&title&&<section ref={detailRef} tabIndex={-1} className={automatic?'space-y-3 tsugi-watch-detail':'space-y-3'} data-ui="watch-item-details">
      <div className="tsugi-watch-title-hero" data-has-backdrop={!!(cinema?.background||details?.background||title.background||details?.poster||title.poster)||undefined}>
        {(cinema?.background||details?.background||title.background||details?.poster||title.poster)&&<div className="tsugi-watch-title-backdrop" aria-hidden="true"><Artwork eager src={[cinema?.background,details?.background,title.background,details?.poster,title.poster].filter((value):value is string=>!!value)} alt=""/></div>}
        <div className="tsugi-watch-title-art"><Artwork src={[details?.poster,title.poster].filter((value):value is string=>!!value)} alt={title.name}/></div>
        <div className="tsugi-watch-title-copy">
          <div className="flex items-center justify-between gap-3 flex-wrap"><h4 className="tsugi-watch-title-name">{cinema?.logo?<span className="tsugi-watch-title-logo-frame"><Artwork eager src={cinema.logo} alt={details?.name??title.name} className="tsugi-watch-title-logo"/></span>:details?.name??title.name}</h4><button type="button" className="tsugi-read-action" disabled={busy} onClick={closeTitle}><Trans>Close title</Trans></button></div>
          <div className="tsugi-watch-title-meta">
            <span>{isWatchMovie(title.mediaType)?t`Movie`:title.mediaType==='anime'?t`Anime`:t`Series`}</span>
            {(details?.releaseInfo||cinema?.releaseInfo)&&<span>{details?.releaseInfo??cinema?.releaseInfo?.slice(0,4)}</span>}
            {details?.imdbRating!==undefined&&<span><Trans>IMDb</Trans> {details.imdbRating.toFixed(1)}/10</span>}
            {cinema?.tmdbRating!==undefined&&<span><Trans>TMDB</Trans> {cinema.tmdbRating.toFixed(1)}/10</span>}
            {details?.runtime?<span>{details.runtime}</span>:cinema?.runtime?<span><Trans>{cinemaRuntime} min</Trans></span>:null}
          </div>
          {details?.genres?.length? <p className="tsugi-watch-muted">{details.genres.join(' · ')}</p>:null}
          {(cinema?.description||details?.description||title.description)&&<p className="break-words">{cinema?.description??details?.description??title.description}</p>}
          {automatic&&<div className="tsugi-watch-title-actions">
            {(videoId||seasonVideos[0])&&<button type="button" data-ui="watch-play-title" className="tsugi-read-action tsugi-series-primary" disabled={busy} onClick={()=>selectVideo(videoId||seasonVideos[0].id)}>{resumeMs>0?<Trans>Resume</Trans>:<Trans>Play</Trans>}</button>}
            {(['favorites','queue'] as const).map(collection=>{
              const saved=savedIn(collection,title);
              const item:WatchCollectionItem={id:title.id,mediaType:title.mediaType,name:details?.name??title.name,poster:cinema?.poster??details?.poster??title.poster,background:cinema?.background??details?.background??title.background};
              return <button key={collection} type="button" className="tsugi-read-action tsugi-watch-title-secondary" aria-pressed={saved} disabled={busy||!collections} onClick={()=>void toggleCollection(collection,item)}><MovieGlyph name={collection==='favorites'?'heart':'list'}/>{collection==='favorites'?(saved?t`Favorited`:t`Add to favorites`):(saved?t`In queue`:t`Add to queue`)}</button>;
            })}
          </div>}
        </div>
      </div>
      {(details?.cast?.length||details?.directors?.length)?<section className="tsugi-watch-credits" data-ui="watch-title-credits">
        {details.directors?.length?<div><h5><Trans>Directed by</Trans></h5><p>{details.directors.join(', ')}</p></div>:null}
        {details.cast?.length?<div><h5><Trans>Cast</Trans></h5><p>{details.cast.join(', ')}</p></div>:null}
      </section>:null}
      {resumeMatch?.episodeTitle&&<p>{resumeMatch.episodeTitle}</p>}
      {resumeMs>0&&<p><Trans>Saved playback position:</Trans> {watchTime(resumeMs)}</p>}
      {automatic&&<div className="flex flex-wrap gap-2"><button type="button" className="tsugi-read-action" disabled={busy} onClick={searchTitleInAddons}><Trans>Search this title across addons</Trans></button>{desktopArea?.openServerSearch&&<button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>desktopArea.openServerSearch?.(title.name)}><Trans>Find on AIOStreams / media server</Trans></button>}</div>}
      {onPlay&&profileReady&&profileId!==undefined&&['movie','series'].includes(title.mediaType)&&<RefractWatchlist key={JSON.stringify([profileId,title.mediaType,title.id])} profileId={profileId} mediaType={title.mediaType} itemId={title.id} busy={busy} run={run}/>}
      <details className="tsugi-watch-provider-details"><summary><Trans>Metadata sources</Trans></summary><div className="flex flex-wrap gap-2">{sources.filter(s=>s.enabled&&s.manifest.resources.includes('meta')).map(s=><button key={s.sourceId} type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void readMetadata(title,s.sourceId)}><Trans>Details</Trans> · {s.manifest.name}</button>)}</div></details>
      {!automatic&&videos.length>0&&<label className="block"><Trans>Video</Trans><select aria-label={t`Video`} className="tsugi-read-input w-full" value={videoId} disabled={busy} onChange={e=>selectVideo(e.target.value)}><option value=""><Trans>Select an episode or video</Trans></option>{videos.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label>}
      {automatic&&(!isWatchMovie(title.mediaType)||videos.length>1)&&videos.length>0&&<section className="space-y-3" data-ui="watch-episode-grid">
        <div className="flex flex-wrap items-center justify-between gap-3"><h4>{isWatchMovie(title.mediaType)?<Trans>Videos</Trans>:<Trans>Episodes</Trans>} ({seasonVideos.length})</h4>
          <select aria-label={t`Select season`} className="tsugi-menu-select" value={selectedSeason} disabled={busy} onChange={e=>setSeasonChoice(e.target.value)}>
            {seasons.map(s=><option key={s} value={s}>{s==='other'?t`Other episodes`:s==='0'?t`Specials (season 0)`:t`Season ${s}`}</option>)}
          </select>
        </div>
        <div className="tsugi-watch-episode-list">{seasonVideos.map(video=>{const match=seasonArt.filter(episode=>episode.episode===video.episode);const art=match.length===1?match[0]:undefined;const episodeRuntime=art?.runtime,progress=episodeProgress(video),seasonNumber=video.season,episodeNumber=video.episode;return <button key={video.id} type="button" className="tsugi-read-action tsugi-watch-episode" data-video-id={video.id} aria-current={videoId===video.id?'true':undefined} disabled={busy} onClick={()=>selectVideo(video.id)}>
          <span className="tsugi-watch-episode-art" aria-hidden="true"><Artwork src={[art?.thumbnail,video.thumbnail,cinema?.background,details?.background].filter((value):value is string=>!!value)} alt=""/>{episodeNumber!==null&&<span className="tsugi-watch-episode-number">{episodeNumber}</span>}{art?.tmdbRating!==undefined&&<span className="tsugi-watch-episode-rating">★ {art.tmdbRating.toFixed(1)}</span>}{progress&&progress.durationMs>0&&<span className="tsugi-watch-episode-progress" style={{width:Math.min(100,100*progress.positionMs/progress.durationMs)+'%'}}/>}</span>
          <span className="tsugi-watch-episode-copy min-w-0 flex-1 break-words"><strong>{art?.name??video.name}</strong><span className="tsugi-watch-episode-meta">{seasonNumber!==null&&episodeNumber!==null&&<span><Trans>S{seasonNumber} E{episodeNumber}</Trans></span>}{art?.runtime&&<span><Trans>{episodeRuntime} min</Trans></span>}</span>{(video.description||art?.description)&&<span className="tsugi-watch-episode-synopsis line-clamp-2">{video.description??art?.description}</span>}</span>
          <span className="ms-auto tsugi-watch-episode-action">{progress?.completed?<Trans>Watched</Trans>:progress&&progress.positionMs>0?<Trans>Continue</Trans>:<Trans>Watch</Trans>}</span>
        </button>})}</div>
      </section>}
      {!videoId&&!videos.length&&<p><Trans>Select a video from a compatible metadata addon before requesting streams.</Trans></p>}
      {automatic&&sourceOpen&&createPortal(<section className="tsugi-watch-stream-page" role="dialog" aria-modal="true" aria-label={t`Choose your stream`} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();closeStreams();}}}>
        <div className="tsugi-watch-stream-background" aria-hidden="true"><Artwork eager src={[seasonArt.find(e=>e.episode===selectedVideo?.episode&&String(selectedVideo?.season)===selectedSeason)?.thumbnail,selectedVideo?.thumbnail,cinema?.background,details?.background,title.background,details?.poster,title.poster].filter((value):value is string=>!!value)} alt=""/></div>
        <div className="tsugi-watch-stream-inner" data-ui="watch-stream-groups">
          <header className="tsugi-watch-stream-header"><button ref={streamBack} type="button" className="tsugi-read-action" disabled={busy} onClick={closeStreams}>← <Trans>Back</Trans></button><button type="button" className="tsugi-read-action" disabled={busy} onClick={refreshStreams}><Trans>Refresh streams</Trans></button></header>
          <div className="tsugi-watch-stream-intro"><p className="tsugi-watch-muted">{details?.name??title.name}</p><h2>{selectedVideo&&!isWatchMovie(title.mediaType)?selectedVideo.name:details?.name??title.name}</h2>{selectedVideo?.description&&<p>{selectedVideo.description}</p>}</div>
          <h3><Trans>Available sources</Trans></h3>
          {streamPending!==null&&<p role="status" className="tsugi-watch-muted">{streamPending<0?<Trans>Finding streams from your addons…</Trans>:<Trans>{streamPending} providers still loading…</Trans>}</p>}
          {streamGroups&&streamPending===null&&streamGroups.every(group=>group.error==='unsupported-resource')&&<button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>{closeStreams();void selectPane('addons');}}><Trans>Manage addons</Trans></button>}
          {streamGroups&&(streamGroups.length>0||streamPending===null)&&<AddonVersionList groups={streamGroups} sources={sources.map(s=>({sourceId:s.sourceId,name:s.manifest.name}))} busy={busy} resumeMs={resumeMs} onRetry={streamPending===null?retryStream:undefined} onPick={(group,result,index,resume)=>void playOption(index,resume,{sourceId:group.sourceId,subtitles:false,...result})}/>}
          {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
        </div>
      </section>,document.body)}
      {videoId&&!automatic&&<><h4><Trans>Available sources</Trans></h4><div className="flex flex-wrap gap-2">
        {sources.filter(s=>s.enabled&&s.manifest.resources.includes('stream')).map(s=><button key={s.sourceId} type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void readOptions(s.sourceId,false)}><Trans>Streams</Trans> · {s.manifest.name}</button>)}
        {sources.filter(s=>s.enabled&&s.manifest.resources.includes('subtitles')).map(s=><button key={s.sourceId} type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void readOptions(s.sourceId,true)}><Trans>Subtitles</Trans> · {s.manifest.name}</button>)}
      </div></>}
      {options&&<div className="space-y-2" data-ui="watch-item-options"><h4>{options.subtitles?<Trans>Subtitle options</Trans>:<Trans>Stream options</Trans>}</h4>
        {options.rows.length===0?<p><Trans>No options returned by this addon.</Trans></p>:<ul className="max-h-64 overflow-auto">{options.rows.map((row,index)=><li className="tsugi-read-row break-words" key={index}><span>{row.name}</span><span className="text-sm">{row.supported?<Trans>Direct HTTPS</Trans>:row.reason==='proxy-headers'?<Trans>Proxy headers required</Trans>:<Trans>Unsupported transport</Trans>}</span>{onPlay&&!options.subtitles&&row.supported&&<div className="flex flex-wrap gap-2">{resumeMs>0&&<button type="button" className="tsugi-read-action tsugi-series-primary" disabled={busy} onClick={()=>void playOption(index,true)}><Trans>Resume</Trans></button>}<button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void playOption(index)}>{resumeMs>0?<Trans>Play from beginning</Trans>:<Trans>Play</Trans>}</button></div>}</li>)}</ul>}
        {!onPlay&&<p><Trans>Compatibility preview. Open Watch from the home screen to play direct HTTPS streams.</Trans></p>}
      </div>}
    </section>}
    {busy&&<p role="status"><Trans>Loading sources…</Trans></p>}
    {importReport&&importReport.profileId===profileId&&importReport.result.rejected.length>0&&<div className="space-y-2" data-ui="addon-import-report">
      <div role="status">{importReport.result.rejected.map(row=><p key={row.candidateId}>{importFailureText(row)}</p>)}</div>
      {importReport.result.retryImportId!==null&&<button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void run(async()=>{
        const result=await retryAddonImport(importReport.profileId,importReport.result.retryImportId!);
        if(!mounted.current)return;
        updateSources(result.sources,importReport.profileId);setImportReport({profileId:importReport.profileId,result});
        if(!result.rejected.length)setNotice(t`Failed addons recovered.`);
      })}><Trans>Retry failed addons</Trans></button>}
      <button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void run(async()=>{
        if(importReport.result.retryImportId!==null)await cancelAddonImport(importReport.profileId,importReport.result.retryImportId);
        if(mounted.current)setImportReport(null);
      })}><Trans>Dismiss</Trans></button>
    </div>}
    {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
    </div>
  </section>;
}

function watchTime(ms:number){
  const seconds=Math.floor(ms/1000);
  return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(n=>String(n).padStart(2,'0')).join(':');
}
function WatchHistory({profileId,busy,run,open,removed}:{profileId:number;busy:boolean;run(work:()=>Promise<void>):Promise<void>;open:(entry:WatchProgress)=>void;removed:()=>void}){
  const [rows,setRows]=React.useState<WatchHistoryEntry[]|null>(null);
  const [confirm,setConfirm]=React.useState<string|null>(null);
  const mounted=React.useRef(false);
  // Loading is explicit: a history request must never invalidate a pending
  // native stream grant or silently contact a provider.
  React.useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  async function refresh(){
    await run(async()=>{const next=await listWatchHistory(profileId);if(mounted.current){setRows(next);setConfirm(null);}});
  }
  async function remove(entry:WatchProgress){
    await run(async()=>{const next=await removeWatchHistory(profileId,entry);if(mounted.current){setRows(next);setConfirm(null);removed();}});
  }
  return <section className="space-y-3" data-ui="watch-history">
    <h4><Trans>Watch history</Trans></h4>
    <p><Trans>Local playback progress for this profile. Open a saved title to choose a fresh stream. History is not sent to your addons.</Trans></p>
    <button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void refresh()}>{rows===null?<Trans>Load history</Trans>:<Trans>Refresh history</Trans>}</button>
    {rows?.length===0&&<p><Trans>No Watch history for this profile.</Trans></p>}
    {rows&&<ul className="max-h-96 overflow-auto">{rows.map(({progress:p,updatedAt})=>{
      const key=JSON.stringify([p.mediaType,p.itemId,p.videoId]);
      return <li key={key} className="tsugi-read-row flex-wrap">
        <div className="min-w-0 flex-1"><strong className="break-words">{p.title}</strong>{p.episodeTitle&&<p className="break-words">{p.episodeTitle}</p>}
          <small>{p.completed?<Trans>Completed</Trans>:<>{watchTime(p.positionMs)} / {watchTime(p.durationMs)}</>}</small></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>open(p)}><Trans>Open saved title</Trans></button>
          {!p.completed&&<button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void run(async()=>{const next=await completeWatch(profileId,{progress:p,updatedAt});if(mounted.current){setRows(next);removed();}})}><Trans>Mark watched</Trans></button>}
          {confirm===key?<><button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void remove(p)}><Trans>Confirm removal</Trans></button><button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>setConfirm(null)}><Trans>Cancel</Trans></button></>:<button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>setConfirm(key)}><Trans>Remove from history</Trans></button>}
        </div>
      </li>;
    })}</ul>}
  </section>;
}
