import React from 'react';
import { StremioAccountImport } from './stremio-account-import';
import { MdblistSettings } from './mdblist-settings';
import { MalAnimeLibrary } from './mal-anime-library';
import { WatchCatalogueBoard } from './watch-catalogue-board';
import { RefractSettings, RefractWatchlist } from './refract-settings';
import { TsugiBrand } from '@/components/tsugi-brand';
import { TsugiIcon } from '@/components/tsugi-icons';
import { MovieGlyph } from '@/components/movie-icons';
import { Artwork, WideCard } from '@/components/media/cards';
import { useDesktopArea, type WatchEntryPane } from '@/lib/desktop-area';
import { settings, useSetting } from '@/lib/settings';
import { FirstVersionSwitch } from '@/app/settings/_components/first-version-switch';
import { AddonVersionList } from '@/features/versions/addon-versions';
import './stremio-workspace.css';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { publicCinemeta, AddonError, listAddons, reviewAddon, mutateAddon, cancelAddonReview, loadAddonCatalog, listAddonProfiles, mutateAddonProfile, type ProfileState, type ProfileMutation, type AddonSource, type AddonReview, type CatalogPage, type Mutation, loadAddonMetadata, loadAddonOptions, loadAllAddonStreams, type AddonStreamGroup, type AddonMetadata, type AddonOptions, prepareAddonMedia, listWatchHistory, completeWatch, removeWatchHistory, type WatchPlayback, type WatchProgress, type WatchHistoryEntry } from '@/lib/hosts/shell/stremio';

function feedback(reason: unknown) {
  switch(reason instanceof AddonError ? reason.code : 'request'){
    case 'invalid-endpoint': return t`Paste a configured HTTPS or stremio:// manifest link ending in /manifest.json.`;
    case 'configuration-required': return t`Configure this addon with its provider first, then paste its configured link.`;
    case 'duplicate': return t`This configured addon is already installed.`;
    case 'expired-review': return t`This review expired. Review the manifest again.`;
    case 'auth': return t`The addon rejected the request. Check its configuration.`;
    case 'rate': return t`The addon is limiting requests. Try again later.`;
    case 'source-limit': return t`Each profile supports up to 16 addons.`;
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
type WatchPane = 'hubs'|'home'|'discover'|'playback'|'addons'|'stremio'|'nuvio'|'manual'|'order'|'profile'|'mdblist'|'history'|'refract'|'anime';
const profileArt=['/design/oto/hero-yuna.webp','/design/yomi/hero-torii.webp','/design/shared/hero-neon.webp','/design/shared/hero-train.webp'];
export function StremioAddonSettings({workspace=false,onPlay,historyActive=false,setupConnections=false,initialPane='addons',openServer}:{workspace?:boolean;openServer?:()=>void;onPlay?:(playback:WatchPlayback)=>void;historyActive?:boolean;setupConnections?:boolean;initialPane?:WatchEntryPane}={}){
  const desktopArea=useDesktopArea();
  const [autoPlayFirst]=useSetting(settings.playback.autoPlayFirst);
  const [boardSearch,setBoardSearch]=React.useState('');
  const [entered,setEntered]=React.useState(false);
  const [pane,setPane]=React.useState<WatchPane>(initialPane);
  const [creating,setCreating]=React.useState(false);
  const titleId=React.useId();
  const [profileState,setProfileState]=React.useState<ProfileState|null>(null);
  const [profileReady,setProfileReady]=React.useState(false);
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
  const [notice,setNotice]=React.useState('');
  const [selection,setSelection]=React.useState<{sourceId:number;catalogIndex:number}|null>(null);
  const [filters,setFilters]=React.useState<Map<string,string>>(()=>new Map());
  const [page,setPage]=React.useState<CatalogPage|null>(null);
  const [title,setTitle]=React.useState<CatalogPage['items'][number]|null>(null);
  const [details,setDetails]=React.useState<AddonMetadata|null>(null);
  const [videoId,setVideoId]=React.useState('');
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
    void run(async()=>{await reloadProfiles();});
    return ()=>{mounted.current=false;const current=pending.current;pending.current=null;if(current)void cancelAddonReview(current.profileId,current.reviewId).catch(()=>{});};
  },[]);
  function clearTitle(){setTitle(null);setDetails(null);setVideoId('');setOptions(null);setResumeEntry(null);setStreamGroups(null);setAutomatic(false);}
  function clearPage(){setPage(null);seen.current.clear();clearTitle();}
  function choose(next:typeof selection){setSelection(next);setFilters(new Map());clearPage();}
  function clearReview(){const previous=pending.current;pending.current=null;setReview(null);setUrl('');setConsent(false);return previous;}
  async function reloadProfiles(next?:ProfileState){
    setProfileReady(false);setSources([]);choose(null);
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
      setProfileReady(false);setSources([]);choose(null);
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
      if(mounted.current&&enter){setCreating(false);setPane(initialPane);setEntered(true);}

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
  function contentPane(){return !!onPlay&&['home','discover','anime'].includes(pane);}
  async function launchStream(item:Title,video:string,metadata:AddonMetadata|null,picked:AddonOptions,index:number,startMs=0,episodeTitle:string|null=null){
    if(profileId===undefined||!onPlay||!picked.rows[index]?.supported)return;
    const grantId=await prepareAddonMedia(profileId,picked.reviewId,index,false,startMs);
    if(!mounted.current)return;
    clearTitle();
    onPlay({profileId,grantId,mediaType:item.mediaType,itemId:item.id,videoId:video,title:metadata?.name??item.name,
      episodeTitle:item.mediaType==='movie'?null:metadata?.videos.find(v=>v.id===video)?.name??episodeTitle,
      startMs,videos:metadata?.videos??[],streamSources:sources.filter(s=>s.enabled&&s.manifest.resources.includes('stream')).map(s=>({sourceId:s.sourceId,name:s.manifest.name})),
      subtitleSources:sources.filter(s=>s.enabled&&s.manifest.resources.includes('subtitles')).map(s=>({sourceId:s.sourceId,name:s.manifest.name}))});
  }
  async function fetchStreams(item:Title,video:string,autoStart=false,metadata:AddonMetadata|null=null,entry:WatchProgress|null=null){
    if(profileId===undefined||!video)return;
    const response=await loadAllAddonStreams(profileId,item.mediaType,video);
    if(!mounted.current)return;
    // The installed source order is the standalone equivalent of the server's
    // preferred-version order. Never race untrusted media URLs or bypass grants.
    const groups=sources.filter(s=>s.enabled).flatMap(s=>response.filter(g=>g.sourceId===s.sourceId));
    setStreamGroups(groups);
    if(!autoStart||!autoPlayFirst||!onPlay)return;
    const first=groups.find(group=>group.options?.rows.some(row=>row.supported))?.options;
    if(!first)return;
    const index=first.rows.findIndex(row=>row.supported);
    const startMs=entry&&!entry.completed&&entry.positionMs<entry.durationMs?entry.positionMs:0;
    try{await launchStream(item,video,metadata,first,index,startMs,entry?.episodeTitle??null);}
    catch{if(mounted.current)setNotice(t`Automatic playback could not start. Choose a stream below.`);}
  }
  async function openTitle(item:Title,preferredSourceId?:number){
    if(flight.current||profileId===undefined)return;
    const auto=contentPane();
    clearTitle();setTitle(item);setAutomatic(auto);
    if(item.mediaType==='movie')setVideoId(item.id);
    const candidates=sources.filter(source=>source.enabled&&source.manifest.resources.includes('meta'));
    if(/^tt[0-9]{1,12}$/.test(item.id)&&['movie','series'].includes(item.mediaType)&&!candidates.some(source=>source.manifest.id===publicCinemeta.manifest.id))candidates.push(publicCinemeta);
    candidates.sort((a,b)=>Number(b.sourceId===preferredSourceId)-Number(a.sourceId===preferredSourceId));
    await run(async()=>{
      let metadata:AddonMetadata|null=null;
      for(const candidate of candidates){
        try{
          const next=await loadAddonMetadata(profileId,candidate.sourceId,item.mediaType,item.id);
          if(!metadata||next.videos.length)metadata=next;
          if(item.mediaType==='movie'||next.videos.length)break;
        }catch{/* A catalog provider need not supply metadata; try other declared providers. */}
        if(!mounted.current)return;
      }
      if(!mounted.current)return;
      setDetails(metadata);
      const chosen=metadata?.videos.length===1?metadata.videos[0].id:(!metadata?.videos.length&&item.mediaType==='movie'?item.id:'');
      setVideoId(chosen);
      if(auto&&chosen)await fetchStreams(item,chosen,true,metadata);
    });
  }
  function openHistory(entry:WatchProgress){
    if(flight.current||!profileReady)return;
    const item={id:entry.itemId,name:entry.title,mediaType:entry.mediaType};
    const auto=contentPane();
    clearTitle();setTitle(item);setAutomatic(auto);setVideoId(entry.videoId);setResumeEntry(entry);
    if(auto)void run(()=>fetchStreams(item,entry.videoId,true,null,entry));
  }
  async function readMetadata(item:Title,sourceId:number){
    if(flight.current||profileId===undefined)return;
    setDetails(null);setVideoId(item.mediaType==='movie'?item.id:'');setOptions(null);setStreamGroups(null);
    await run(async()=>{
      const next=await loadAddonMetadata(profileId,sourceId,item.mediaType,item.id);
      if(!mounted.current)return;
      const chosen=resumeEntry&&resumeEntry.itemId===item.id&&resumeEntry.mediaType===item.mediaType&&next.videos.some(v=>v.id===resumeEntry.videoId)?resumeEntry.videoId:next.videos.length===1?next.videos[0].id:item.mediaType==='movie'&&next.videos.length===0?item.id:'';
      setDetails(next);setVideoId(chosen);
      if(automatic&&chosen)await fetchStreams(item,chosen,false,next);
    });
  }
  function selectVideo(video:string){
    if(flight.current)return;
    setVideoId(video);setOptions(null);setStreamGroups(null);
    if(automatic&&title&&video)void run(()=>fetchStreams(title,video,true,details));
  }
  function refreshStreams(){
    if(flight.current||!title||!videoId)return;
    setOptions(null);setStreamGroups(null);void run(()=>fetchStreams(title,videoId));
  }
  async function readOptions(sourceId:number,subtitles:boolean){
    if(flight.current||profileId===undefined||!title||!videoId)return;
    setOptions(null);setStreamGroups(null);
    await run(async()=>{
      const result=await loadAddonOptions(profileId,sourceId,title.mediaType,videoId,subtitles);
      if(mounted.current)setOptions({sourceId,subtitles,...result});
    });
  }
  const resumeMatch=resumeEntry&&title?.mediaType===resumeEntry.mediaType&&title.id===resumeEntry.itemId&&videoId===resumeEntry.videoId?resumeEntry:null;
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
    setImportActive(false);choose(null);setEntered(false);setCreating(false);
    if(previous)await run(async()=>{await cancelAddonReview(previous.profileId,previous.reviewId);});
  }
  if(workspace&&!entered)return <section className="tsugi-watch-picker" data-ui="watch-profile-picker" aria-labelledby={titleId}>
    <div className="tsugi-watch-picker-art" aria-hidden="true" style={{'--tsugi-watch-art':"url('/design/shared/hero-neon.webp')"} as React.CSSProperties}/>
    <div className="tsugi-watch-picker-content">
      <TsugiBrand />
      <h3 id={titleId}><Trans>Who’s watching?</Trans></h3>
      <p><Trans>Choose your Watch profile. Your addons and source order are yours.</Trans></p>
      {setupConnections&&<p><Trans>Anime, MyAnimeList imports and Refract tracking are also configured per profile. All connections are optional.</Trans></p>}
      {profileState&&<div className="tsugi-watch-profiles">
        {profileState.profiles.map(p=><button key={p.profileId} type="button" className="tsugi-watch-profile" data-profile-id={p.profileId} disabled={blocked} onClick={()=>void changeProfile({kind:'profile-switch',profileId:p.profileId},true)}>
          <span className="tsugi-watch-avatar"><img src={profileArt[(p.profileId-1)%profileArt.length]} alt="" decoding="async"/></span>
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
  const show=(...panes:WatchPane[])=>!workspace||panes.includes(pane);
  const hubPanes:WatchPane[]=['hubs','home','discover','anime','history'];
  const inSettings=!hubPanes.includes(pane);
  const hubChooser=workspace&&!!onPlay&&pane==='hubs';
  const settingsTabs=([
    ['addons',t`Your addons`,'addons'],
    ['stremio',t`Stremio import`,'stremio'],
    ['nuvio',t`Nuvio import`,'nuvio'],
    ['manual',t`Add addon`,'add'],
    ['order',t`Source order`,'order'],
    ['mdblist',t`MDBList`,'mdblist'],
    ['refract',t`Refract`,'refract'],
    ['playback',t`Playback`,'tv'],
    ['profile',t`Profile settings`,'settings']
  ] as const).filter(([id])=>(id!=='refract'||!!onPlay||setupConnections)&&(id!=='playback'||!!onPlay));
  function searchTitleInAddons(){
    if(!title||flight.current)return;
    const name=title.name;
    choose(null);setBoardSearch(name);setPane('discover');
  }
  return <section className={workspace?onPlay?'tsugi-watch-workspace tsugi-watch-hub':'tsugi-app-general tsugi-watch-workspace tsugi-watch-configuration':'tsugi-app-general'} data-ui="stremio-addon-settings" data-watch-pane={pane} aria-labelledby={titleId}>
    {workspace&&!hubChooser&&<header className={onPlay&&!inSettings?'tsugi-watch-hub-header':'tsugi-watch-workspace-banner'} style={{'--tsugi-watch-art':"url('/design/shared/hero-train.webp')"} as React.CSSProperties}>
      <div><TsugiBrand/><p><Trans>Watch profile</Trans> / {activeProfile?.name}</p><h3 id={titleId}>{pane==='anime'?<Trans>Anime</Trans>:pane==='home'||pane==='discover'||pane==='history'?<Trans>Movies &amp; TV</Trans>:<Trans>Your addon stack.</Trans>}</h3>{(pane==='home'||pane==='discover')?<p><Trans>Watch from your connected catalogues and streaming addons.</Trans></p>:pane!=='anime'&&<p><Trans>Bring your sources home.</Trans></p>}</div>
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
    {workspace&&onPlay&&!hubChooser&&<nav className="tsugi-watch-nav" aria-label={t`Watch navigation`} data-ui="watch-hub-navigation">
      {([
        ['home',t`Home`,'home'],
        ['discover',t`Discover`,'discover'],
        ['anime',t`Anime Hub`,'anime'],
        ['history',t`Watch history`,'history'],
        ['addons',t`Settings`,'settings']
      ] as const).map(([id,label,icon])=><button key={id} type="button" className="tsugi-watch-nav-item" aria-pressed={id==='addons'?inSettings:pane===id} disabled={busy} onClick={()=>void selectPane(id)}><MovieGlyph name={icon}/><span>{label}</span></button>)}
    </nav>}
    <div className={workspace?'tsugi-watch-content':'contents'} data-watch-settings={workspace&&inSettings||undefined} hidden={hubChooser}>
    {workspace&&(!onPlay||inSettings)&&<nav className="tsugi-watch-settings-nav" aria-label={t`Watch settings`} data-ui="watch-settings-navigation">
      {(!onPlay&&setupConnections?[...settingsTabs,['anime',t`Anime`,'anime'] as const]:settingsTabs).map(([id,label,icon])=><button key={id} type="button" className="tsugi-watch-nav-item" aria-pressed={pane===id} disabled={busy} onClick={()=>void selectPane(id)}><MovieGlyph name={icon}/><span>{label}</span></button>)}
      {onPlay&&<button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void selectPane('home')}><Trans>Back to streaming hub</Trans></button>}
    </nav>}
    {!workspace&&<h3 id={titleId}><Trans>Stremio addons</Trans></h3>}
    {workspace&&onPlay&&profileReady&&profileId!==undefined&&(pane==='home'||pane==='discover')&&<WatchCatalogueBoard key={JSON.stringify([profileId,pane,boardSearch])} initialQuery={boardSearch} profileId={profileId} sources={sources} busy={busy} run={run} active={historyActive} paused={!!title} includeHistory={pane==='home'} openTitle={(item,sourceId)=>void openTitle(item,sourceId)} openHistory={openHistory} openAddons={()=>void selectPane('addons')}/>}
    {workspace&&onPlay&&pane==='playback'&&<section className="space-y-3" data-ui="watch-playback-settings"><h4><Trans>Playback</Trans></h4><FirstVersionSwitch disabled={busy}/></section>}
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
    {show('stremio','nuvio')&&profileReady&&profileId!==undefined&&<StremioAccountImport key={workspace?profileId+':'+pane:profileId} fixedProvider={workspace?(pane==='nuvio'?'nuvio':'stremio'):undefined} profileId={profileId} busy={busy} run={run} onActive={setImportActive} onConnect={()=>{clearReview();}} onSources={rows=>{updateSources(rows,profileId);if(workspace&&onPlay)setPane('home');}}/>}
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
    {workspace&&pane==='history'&&historyActive&&profileReady&&profileId!==undefined&&<WatchHistory key={profileId} profileId={profileId} busy={busy} run={run} open={openHistory} removed={clearTitle}/>}
    {workspace&&pane==='anime'&&profileReady&&profileId!==undefined&&<MalAnimeLibrary key={profileId} profileId={profileId} sources={sources} busy={busy} historyActive={historyActive} setupOnly={!onPlay} detailOpen={!!title} run={run} openTitle={(item,sourceId)=>void openTitle(item,sourceId)} openHistory={openHistory} clearTitle={clearTitle} openAddons={()=>void selectPane('addons')}/>}
    {workspace&&pane==='mdblist'&&profileReady&&profileId!==undefined&&<MdblistSettings key={profileId} profileId={profileId} openTitle={item=>void openTitle(item)}/>}
    {workspace&&pane==='refract'&&(historyActive||setupConnections)&&profileReady&&profileId!==undefined&&<RefractSettings key={profileId} profileId={profileId} busy={busy} run={run}/>}
    {workspace&&title&&<section ref={detailRef} tabIndex={-1} className={automatic?'space-y-3 tsugi-watch-detail':'space-y-3'} data-ui="watch-item-details">
      <div className="tsugi-watch-title-hero">
        <div className="tsugi-watch-title-art"><Artwork src={title.poster??null} alt={title.name}/></div>
        <div className="tsugi-watch-title-copy">
          <div className="flex items-center justify-between gap-3 flex-wrap"><h4>{details?.name??title.name}</h4><button type="button" className="tsugi-read-action" disabled={busy} onClick={clearTitle}><Trans>Close title</Trans></button></div>
          <p className="tsugi-watch-muted">{title.mediaType==='movie'?t`Movie`:title.mediaType==='anime'?t`Anime`:t`Series`}</p>
          {(details?.description||title.description)&&<p className="break-words">{details?.description??title.description}</p>}
        </div>
      </div>
      {resumeMatch?.episodeTitle&&<p>{resumeMatch.episodeTitle}</p>}
      {resumeMs>0&&<p><Trans>Saved playback position:</Trans> {watchTime(resumeMs)}</p>}
      {automatic&&<div className="flex flex-wrap gap-2"><button type="button" className="tsugi-read-action" disabled={busy} onClick={searchTitleInAddons}><Trans>Search this title across addons</Trans></button>{desktopArea?.openServerSearch&&<button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>desktopArea.openServerSearch?.(title.name)}><Trans>Find on AIOStreams / media server</Trans></button>}</div>}
      {onPlay&&profileReady&&profileId!==undefined&&['movie','series'].includes(title.mediaType)&&<RefractWatchlist key={JSON.stringify([profileId,title.mediaType,title.id])} profileId={profileId} mediaType={title.mediaType} itemId={title.id} busy={busy} run={run}/>}
      <div className="flex flex-wrap gap-2">{sources.filter(s=>s.enabled&&s.manifest.resources.includes('meta')).map(s=><button key={s.sourceId} type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void readMetadata(title,s.sourceId)}><Trans>Details</Trans> · {s.manifest.name}</button>)}</div>
      {details&&details.videos.length>0&&<label className="block"><Trans>Video</Trans><select aria-label={t`Video`} className="tsugi-read-input w-full" value={videoId} disabled={busy} onChange={e=>selectVideo(e.target.value)}><option value=""><Trans>Select an episode or video</Trans></option>{details.videos.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label>}
      {automatic&&details&&details.videos.length>1&&<section className="space-y-2" data-ui="watch-episode-grid">
        <h4><Trans>Episodes</Trans></h4><div className="tsugi-watch-episode-grid">{details.videos.map(video=><WideCard key={video.id} image={null} title={video.name} highlighted={videoId===video.id} unavailable={busy} onClick={()=>selectVideo(video.id)}/>)}</div>
      </section>}
      {!videoId&&<p><Trans>Select a video from a compatible metadata addon before requesting streams.</Trans></p>}
      {videoId&&automatic&&<section className="space-y-3" data-ui="watch-stream-groups">
        <div className="flex items-center justify-between gap-2 flex-wrap"><h4><Trans>Available sources</Trans></h4><button type="button" className="tsugi-read-action" disabled={busy} onClick={refreshStreams}><Trans>Refresh streams</Trans></button></div>
        {busy&&streamGroups===null&&<p role="status"><Trans>Finding streams from your addons…</Trans></p>}
        {streamGroups?.length===0&&<button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void selectPane('addons')}><Trans>Manage addons</Trans></button>}
        {streamGroups&&<AddonVersionList groups={streamGroups} sources={sources.map(s=>({sourceId:s.sourceId,name:s.manifest.name}))} busy={busy} resumeMs={resumeMs} onPick={(group,result,index,resume)=>void playOption(index,resume,{sourceId:group.sourceId,subtitles:false,...result})}/>}

      </section>}
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
