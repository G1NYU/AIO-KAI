import React from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { Drawer } from '@aiostreams/ui/drawer';
import { Button } from '@aiostreams/ui/button';
import type { WatchEntryPane } from '@/lib/desktop-area';
import { StremioAddonSettings } from '@/components/shell/stremio-addon-settings';
import { appBridge } from '@/lib/hosts/shell/bridge';
import { appEngine } from '@/lib/hosts/shell/player';
import { consumeAddonMedia, beginAddonStreams, pollAddonStreams, cancelAddonStreams, retryAddonStreams, loadAddonOptions, prepareAddonMedia, saveWatchProgress, type AddonOptions, type AddonStreamGroup, type AddonVideo, type WatchPlayback, type WatchProgress } from '@/lib/hosts/shell/stremio';
import { useMediaPresence } from '@/lib/rich-presence';
import { usePlayerPage, PageSubtitle, PlayerStats } from '@/app/player/page';
import { chapterSegments } from '@/lib/playback/chapters';
import { useSegmentSkip } from '@/features/player/segments';
import { asksFirst, countPlayedOn, NextEpisodeCard, promptAt, StillWatching } from '@/features/player/next-episode';
import { useShowPicks, useShowTrackPicks, withShowPick } from '@/lib/playback/show-tracks';
import { usePlayingAnimeFlag } from '@/lib/playback/upscaling';
import { PlayerControls } from '@/features/player/controls';
import { AddonVersionList } from '@/features/versions/addon-versions';
import { leaveFullscreen } from '@/lib/playback/fullscreen';
import { usePlayer } from '@/lib/playback/use-player';
import { usePlayhead } from '@/lib/playback/playhead';
import { settings, useSetting } from '@/lib/settings';
import { usePlaybackPrefs } from '@/lib/jellyfin/user-config';
import type { BaseItemDto, SourceInfo } from '@/lib/jellyfin/types';
import type { PlayerController } from '@/lib/playback/controller';
import { useLatest } from '@/hooks/use-latest';
import { adjacentWatchVideo, isWatchMovie } from '@/lib/hosts/shell/watch-identities';
import './watch.css';

function newViewingId(){
  const bytes=crypto.getRandomValues(new Uint8Array(16));
  bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
}
type Viewing={playback:WatchPlayback;viewingId:string};
export function DirectWatchPage({openWelcome,openVideo,initialProfileId,initialPane='hubs',settingsOpen=false,onProfileSelected,onHubSelected}:{openWelcome:()=>void;openVideo:()=>void;initialProfileId?:number;initialPane?:WatchEntryPane;settingsOpen?:boolean;onProfileSelected?:(id:number|undefined)=>void;onHubSelected?:(pane:'home'|'anime')=>void}){
  const [viewing,setViewing]=React.useState<Viewing|null>(null);
  const [historyError,setHistoryError]=React.useState(false);
  const [returnedPlayback,setReturnedPlayback]=React.useState<WatchPlayback|null>(null);
  const playing=viewing?.playback;
  return <main data-page="direct-watch" className="tsugi-direct-watch">
    <div hidden={!!playing} inert={!!playing}>
      <header className="flex flex-wrap gap-3 justify-between"><button type="button" className="tsugi-read-action" onClick={openWelcome}><Trans id="All media">All media</Trans></button></header>
      {historyError&&<p role="alert"><Trans>Watch progress could not be confirmed saved. Check your history before resuming.</Trans></p>}
      <StremioAddonSettings workspace initialProfileId={initialProfileId} initialPane={initialPane} onProfileSelected={onProfileSelected} onHubSelected={onHubSelected} openServer={openVideo} onPlay={playback=>setViewing({playback,viewingId:newViewingId()})} returnedPlayback={returnedPlayback} historyActive={!playing&&!settingsOpen}/>
    </div>
    {playing&&viewing&&<DirectPlayer key={playing.grantId??'review:'+playing.selection?.reviewId} playback={playing} viewingId={viewing.viewingId}
      close={()=>{setReturnedPlayback(playing);setViewing(null);}} switchPlayback={playback=>setViewing({playback,viewingId:playback.videoId===playing.videoId?viewing.viewingId:newViewingId()})}
      onHistoryError={setHistoryError}/>}
  </main>;
}

type Dialog='versions'|'subtitles'|'episodes';
/** Provider adapter only. The native engine, state controller, track menus,
 * controls, styling, keyboard shortcuts and seek bar are the AIO player. */
function DirectPlayer({playback,viewingId,close,switchPlayback,onHistoryError}:{playback:WatchPlayback;viewingId:string;close:()=>void;switchPlayback:(next:WatchPlayback)=>void;onHistoryError:(failed:boolean)=>void}){
  const mounted=React.useRef(false),closing=React.useRef(false),completed=React.useRef(false);
  const current=React.useRef<PlayerController|null>(null);
  const flight=React.useRef(false);
  const historyFlight=React.useRef<Promise<void>|null>(null),lastSaved=React.useRef('');
  const [historyBusy,setHistoryBusy]=React.useState(false),[leaving,setLeaving]=React.useState(false);
  const [ended,setEnded]=React.useState(false),[loadTimedOut,setLoadTimedOut]=React.useState(false);
  const [dialog,setDialog]=React.useState<Dialog|null>(null);
  const dialogRef=React.useRef<Dialog|null>(null);
  const [busy,setBusy]=React.useState(false),[notice,setNotice]=React.useState<string|null>(null),[error,setError]=React.useState(false);
  const [groups,setGroups]=React.useState<AddonStreamGroup[]|null>(null);
  const [streamPending,setStreamPending]=React.useState<number|null>(null);
  const streamRequest=React.useRef<{queryId?:number;cancelled:boolean}|null>(null);
  const [target,setTarget]=React.useState<AddonVideo|null>(null);
  const [subtitleOptions,setSubtitleOptions]=React.useState<AddonOptions|null>(null);
  const [subtitleApplied,setSubtitleApplied]=React.useState(false);
  const [subtitleStyle]=useSetting(settings.subtitle.style);
  const {prefs}=usePlaybackPrefs();
  const picks=useShowPicks();
  const [nextPrompt]=useSetting(settings.next.prompt);
  const [lead]=useSetting(settings.next.lead);
  const [countdown]=useSetting(settings.next.countdown);
  const [fallbackFirst]=useSetting(settings.next.fallbackFirst);
  const [stillWatching]=useSetting(settings.next.stillWatching);
  const [chapterSkips]=useSetting(settings.playback.chapterSkips);
  const autoplay=prefs.EnableNextEpisodeAutoPlay!==false;
  const [dismissed,setDismissed]=React.useState(false),[asking,setAsking]=React.useState(false);
  const [leftMs,setLeftMs]=React.useState(countdown*1000);
  const autoTried=React.useRef(false);
  const item=React.useMemo<BaseItemDto>(()=>({
    Id:playback.videoId,Type:isWatchMovie(playback.mediaType)?'Movie':'Episode',
    ...(!isWatchMovie(playback.mediaType)&&{SeriesId:'tsugi-watch:'+playback.profileId+':'+playback.itemId}),
    Name:playback.episodeTitle??playback.title,
    ...(playback.episodeTitle&&{SeriesName:playback.title}),
    ...(playback.videos.find(v=>v.id===playback.videoId)?.season!=null&&{ParentIndexNumber:playback.videos.find(v=>v.id===playback.videoId)!.season!}),
    ...(playback.videos.find(v=>v.id===playback.videoId)?.episode!=null&&{IndexNumber:playback.videos.find(v=>v.id===playback.videoId)!.episode!})
  }),[playback]);
  usePlayingAnimeFlag(!!playback.anime||playback.mediaType==='anime',playback.videoId);
  const source=React.useMemo<SourceInfo>(()=>({Id:'addon:'+playback.profileId+':'+playback.videoId}),[playback.profileId,playback.videoId]);
  async function openNative(active:()=>boolean){
    // Source switching prepares after the previous engine's stop invalidates
    // its grant. No URL or arbitrary headers cross into the renderer.
    if(!active())return;
    const grant=playback.selection
      ? await prepareAddonMedia(playback.profileId,playback.selection.reviewId,playback.selection.optionIndex,false,playback.startMs)
      : playback.grantId;
    if(active())await consumeAddonMedia(grant,false);
  }
  async function checkpoint(force=false){
    const p=current.current;
    if(!p?.state.loaded||!p.state.started||(!force&&(closing.current||flight.current||dialogRef.current)))return;
    while(historyFlight.current){if(!force)return;await historyFlight.current;}
    const durationMs=Math.floor(p.state.durationMs),positionMs=completed.current?durationMs:Math.min(durationMs,Math.max(0,Math.floor(p.playhead.positionMs)));
    if(durationMs<1||durationMs>604800000||positionMs<0||(!completed.current&&positionMs<1000))return;
    const progress:WatchProgress={mediaType:playback.mediaType,itemId:playback.itemId,videoId:playback.videoId,
      title:playback.title,episodeTitle:playback.episodeTitle,positionMs,durationMs,completed:completed.current};
    const fingerprint=JSON.stringify(progress);
    if(fingerprint===lastSaved.current)return;
    if(mounted.current)setHistoryBusy(true);
    historyFlight.current=saveWatchProgress(playback.profileId,progress,viewingId).then(()=>{
      lastSaved.current=fingerprint;onHistoryError(false);
    },()=>onHistoryError(true)).finally(()=>{
      historyFlight.current=null;if(mounted.current)setHistoryBusy(false);
    });
    await historyFlight.current;
  }
  function finish(){
    if(closing.current)return;
    completed.current=true;setEnded(true);void checkpoint(true);
  }
  const rawPlayer=usePlayer([appEngine],{
    item,source,url:'tsugi-addon-grant:'+String(playback.grantId??playback.selection?.reviewId),
    startMs:playback.startMs,openNative,thumbnails:false,prefs:withShowPick(prefs,picks.data,item),subtitleStyle,onEnded:finish
  });
  const player=useShowTrackPicks(rawPlayer,item,source);
  current.current=player;
  const position=usePlayhead(player.playhead,h=>h.positionMs);
  const {state}=player;
  usePlayerPage();
  useMediaPresence(state.started&&state.loaded&&!state.error&&!leaving&&!ended?{media:'video',title:playback.title,subtitle:playback.episodeTitle,
    imdb:/^tt[0-9]{1,10}$/.test(playback.itemId)?playback.itemId:null,position,duration:state.durationMs||null,paused:state.paused,browsing:false}:null);

  async function leave(){
    if(closing.current||flight.current)return;
    closing.current=true;setLeaving(true);
    if(current.current?.state.started)current.current.setPaused(true);
    await checkpoint(true);leaveFullscreen();
    if(mounted.current)close();
  }
  const latestLeave=useLatest(leave);
  const latestCheckpoint=useLatest(checkpoint);
  React.useEffect(()=>{
    mounted.current=true;
    const timer=setInterval(()=>void latestCheckpoint.current(),30_000);
    const stop=appBridge()?.subscribe(m=>{
      if(m.type!=='media-key'||closing.current||!current.current)return;
      const p=current.current,key=m.key;
      if(key.action==='stop')void latestLeave.current();
      else if(key.action==='play'||key.action==='pause'||key.action==='toggle')p.setPaused(key.action==='toggle'?!p.state.paused:key.action==='pause');
      else if(key.action==='seek'||key.action==='skip')p.seek(Math.max(0,Math.min(p.state.durationMs||604800000,key.action==='seek'?key.position:p.playhead.positionMs+key.offset)));
    });
    return ()=>{
      mounted.current=false;clearInterval(timer);stop?.();stopVersions(!closing.current);
      if(!closing.current)void latestCheckpoint.current(true);
    };
  },[latestLeave,latestCheckpoint]);
  React.useEffect(()=>{
    if(state.started||state.error)return;
    const timer=setTimeout(()=>setLoadTimedOut(true),45_000);
    return()=>clearTimeout(timer);
  },[state.started,state.error]);

  function stopVersions(cancelNative=true){
    const request=streamRequest.current;streamRequest.current=null;
    if(request){request.cancelled=true;if(cancelNative&&request.queryId!==undefined)void cancelAddonStreams(playback.profileId,request.queryId).catch(()=>{});}
    if(mounted.current)setStreamPending(null);
  }
  function showDialog(next:Dialog|null){
    if(next!=='versions')stopVersions();
    dialogRef.current=next;setDialog(next);setError(false);setNotice(null);
  }
  async function run(work:()=>Promise<void>){
    if(flight.current||closing.current)return;
    flight.current=true;setBusy(true);setError(false);
    try{if(historyFlight.current)await historyFlight.current;if(mounted.current&&!closing.current)await work();}
    catch{if(mounted.current)setError(true);}
    finally{flight.current=false;if(mounted.current)setBusy(false);}
  }
  function openVersions(video:AddonVideo|null=null,auto=false){
    if(flight.current||closing.current)return;
    stopVersions();showDialog('versions');setTarget(video);setGroups(null);setStreamPending(-1);
    const request:{queryId?:number;cancelled:boolean}={cancelled:false};streamRequest.current=request;
    void (async()=>{
      try{
        if(historyFlight.current)await historyFlight.current;
        if(request.cancelled||closing.current)return;
        let snapshot=await beginAddonStreams(playback.profileId,playback.mediaType,video?.id??playback.videoId,video&&video.id!==playback.videoId?video.routes:playback.routes);
        request.queryId=snapshot.queryId;
        if(request.cancelled){void cancelAddonStreams(playback.profileId,snapshot.queryId).catch(()=>{});return;}
        while(mounted.current&&!request.cancelled&&streamRequest.current===request){
          const sorted=playback.streamSources.flatMap(source=>snapshot.groups.filter(group=>group.sourceId===source.sourceId));
          setGroups(sorted);setStreamPending(snapshot.done?null:snapshot.pendingSourceIds.length);
          if(snapshot.done){
            const choices=sorted.flatMap(group=>group.options?group.options.rows.flatMap((row,index)=>row.supported?[{result:group.options!,index}]:[]):[]);
            if(auto&&video&&!flight.current&&choices.length&&(choices.length===1||fallbackFirst)){stopVersions(false);await run(()=>switchTo(choices[0].result,choices[0].index,video,true));}
            break;
          }
          await new Promise(resolve=>setTimeout(resolve,250));
          if(request.cancelled||!mounted.current)return;
          snapshot=await pollAddonStreams(playback.profileId,snapshot.queryId,playback.mediaType,video?.id??playback.videoId);
        }
      }catch{if(mounted.current&&!request.cancelled&&streamRequest.current===request){setError(true);setStreamPending(null);}}
    })();
  }
  function retryVersion(sourceId:number){
    if(flight.current||closing.current||streamPending!==null||!groups?.some(group=>group.sourceId===sourceId))return;
    void run(async()=>{
      const group=await retryAddonStreams(playback.profileId,sourceId,playback.mediaType,target?.id??playback.videoId);
      if(mounted.current)setGroups(previous=>previous?.map(row=>row.sourceId===sourceId?group:row)??null);
    });
  }
  async function pickStream(result:AddonOptions,index:number){
    if(!result.rows[index]?.supported)return;
    stopVersions(false);await run(()=>switchTo(result,index,target));
  }
  async function switchTo(result:AddonOptions,index:number,video:AddonVideo|null,auto=false){
      const same=!video||video.id===playback.videoId;
      const p=current.current;
      if(p?.state.started&&!ended)p.setPaused(true);
      if(!same&&auto)completed.current=true;
      const startMs=same&&!completed.current?Math.floor(Math.min(p?.state.durationMs||604800000,p?.playhead.positionMs??0)):0;
      await checkpoint(true);
      if(!mounted.current)return;
      closing.current=true;
      if(!same&&auto)countPlayedOn();
      // The reviewed option is renewed to a one-shot native grant only
      // after React has cleaned up the previous shared engine.
      switchPlayback({
        profileId:playback.profileId,mediaType:playback.mediaType,itemId:playback.itemId,
        videoId:video?.id??playback.videoId,title:playback.title,
        episodeTitle:video?.name??playback.episodeTitle,startMs,anime:playback.anime,
        videos:playback.videos,routes:same?playback.routes:video?.routes,streamSources:playback.streamSources,subtitleSources:playback.subtitleSources,
        selection:{reviewId:result.reviewId,optionIndex:index}
      });
  }
  function openSubtitles(){
    if(flight.current||closing.current)return;
    setSubtitleOptions(null);setSubtitleApplied(false);showDialog('subtitles');
  }
  function fetchSubtitles(sourceId:number){
    setSubtitleOptions(null);setSubtitleApplied(false);
    void run(async()=>{
      const result=await loadAddonOptions(playback.profileId,sourceId,playback.mediaType,playback.videoId,true);
      if(mounted.current)setSubtitleOptions(result);
    });
  }
  function applySubtitle(index:number){
    if(!subtitleOptions?.rows[index]?.supported)return;
    void run(async()=>{
      const grant=await prepareAddonMedia(playback.profileId,subtitleOptions.reviewId,index,true);
      if(!mounted.current||closing.current)return;
      await consumeAddonMedia(grant,true);
      if(mounted.current){setSubtitleApplied(true);setSubtitleOptions(null);}
    });
  }
  const next=isWatchMovie(playback.mediaType)?undefined:adjacentWatchVideo(playback.videos,playback.videoId,1);
  const previous=isWatchMovie(playback.mediaType)?undefined:adjacentWatchVideo(playback.videos,playback.videoId,-1);
  const failure=state.error||(!state.started&&loadTimedOut);
  const segments=React.useMemo(()=>chapterSkips?chapterSegments(player.chapters??[],state.durationMs):[],[chapterSkips,player.chapters,state.durationMs]);
  const at=promptAt(state.durationMs,segments.find(s=>String(s.Type)==='Outro'),nextPrompt,lead);
  const due=!!next&&state.started&&at!==null&&position>=at&&!ended;
  const shown=due&&!dismissed&&!asking&&!dialog&&!failure&&!leaving;
  const counting=shown&&autoplay&&!state.paused;
  const skipping=useSegmentSkip({items:segments,player,offeringNext:shown||asking});
  const advance=useLatest(()=>{
    if(!next||autoTried.current||flight.current||closing.current)return;
    autoTried.current=true;
    if(asksFirst(stillWatching)){player.setPaused(true);setAsking(true);return;}
    openVersions(next,true);
  });
  React.useEffect(()=>{if(!due){setDismissed(false);setLeftMs(countdown*1000);}},[due,countdown]);
  React.useEffect(()=>{if(!counting)return;const timer=setInterval(()=>setLeftMs(v=>Math.max(0,v-250)),250);return()=>clearInterval(timer);},[counting]);
  React.useEffect(()=>{if((counting&&leftMs===0)||(ended&&autoplay&&!dismissed&&!dialog&&!busy&&!failure))advance.current();},[counting,leftMs,ended,autoplay,dismissed,dialog,busy,failure,advance]);
  const nextItem:BaseItemDto|null=next?{Id:next.id,Name:next.name,Type:'Episode',SeriesName:playback.title,ParentIndexNumber:next.season??undefined,IndexNumber:next.episode??undefined}:null;
  return <section className="fixed inset-0 text-white" data-page="player" data-ui="direct-watch-player" aria-label={playback.title}>
    <PageSubtitle text={player.subtitleText} lift={player.subtitleLift} style={subtitleStyle}/>
    {player.stats&&<PlayerStats rows={player.stats.rows}/>}
    {asking&&nextItem?<StillWatching next={nextItem} title={nextItem.Name??''} loading={busy} onContinue={()=>{setAsking(false);openVersions(next!,true);}} onBack={()=>void leave()}/>:leaving||ended||failure?<div className="fixed inset-0 z-20 grid place-items-center bg-black/70 p-6">
      <div className="max-w-md space-y-4 text-center">
        <p role={failure?'alert':'status'}>{leaving?<Trans>Saving Watch progress…</Trans>:ended?<Trans>Playback ended.</Trans>:state.error??<Trans>Playback did not start. Choose another version.</Trans>}</p>
        {!leaving&&<div className="flex flex-wrap justify-center gap-2">
          <Button intent="white" disabled={busy} onClick={()=>openVersions()}><Trans>Versions</Trans></Button>
          {next&&<Button intent="gray-outline" disabled={busy} onClick={()=>openVersions(next)}><Trans>Next episode</Trans></Button>}
          <Button intent="gray-outline" disabled={busy} onClick={()=>void leave()}><Trans>Back</Trans></Button>
        </div>}
      </div>
    </div>:<PlayerControls item={item} player={player} caption={playback.episodeTitle??undefined} onBack={()=>void leave()}
      showAtOpen skipping={skipping} offeringNext={shown} dialogOpen={!!dialog} onVersions={()=>openVersions()}
      onAddonSubtitles={playback.subtitleSources.length?openSubtitles:undefined}
      onOpenEpisodes={playback.videos.length>1?()=>showDialog('episodes'):undefined}
      onPrevious={previous?()=>openVersions(previous):undefined} onNext={next?()=>openVersions(next):undefined}/>}
    {shown&&nextItem&&<NextEpisodeCard next={nextItem} listed={false} image={null} heading={t`Next episode`} counting={counting} leftMs={leftMs} seconds={Math.max(1,Math.ceil(leftMs/1000))} countdown={countdown} autoplay={autoplay} onPlay={()=>{setDismissed(true);openVersions(next!,true);}} onHide={()=>setDismissed(true)}/>}
    {historyBusy&&<span className="sr-only" role="status"><Trans>Saving Watch progress…</Trans></span>}
    <Drawer data-ui="dialog" data-name={dialog??'versions'} title={dialog==='subtitles'?t`Addon subtitles`:dialog==='episodes'?t`Episodes`:t`Versions`}
      open={dialog!==null} onOpenChange={open=>{if(!open&&!flight.current)showDialog(null);}}
      side="right" size="md" contentClass="flex flex-col gap-3 overflow-y-auto p-4">
      {dialog==='versions'&&<div className="space-y-3" data-ui="watch-player-versions">
        <h3>{target?.name??playback.episodeTitle??playback.title}</h3>
        <Button intent="gray-outline" disabled={busy} onClick={()=>openVersions(target)}><Trans>Refresh streams</Trans></Button>
        {streamPending!==null&&<p role="status">{streamPending<0?<Trans>Finding streams…</Trans>:<Trans>{streamPending} providers still loading…</Trans>}</p>}
        {groups&&(groups.length>0||streamPending===null)&&<AddonVersionList groups={groups} sources={playback.streamSources} busy={busy} switching={!target||target.id===playback.videoId} onRetry={streamPending===null?retryVersion:undefined} onPick={(_group,result,index)=>void pickStream(result,index)}/>}

      </div>}
      {dialog==='episodes'&&<div className="space-y-2" data-ui="watch-player-episodes">
        {playback.videos.map(v=><button key={v.id} type="button" className="tsugi-read-action block w-full text-start" aria-current={v.id===playback.videoId?'true':undefined} disabled={busy} onClick={()=>openVersions(v)}>{v.name}</button>)}
      </div>}
      {dialog==='subtitles'&&<div className="space-y-3" data-ui="watch-player-subtitles">
        <div className="flex flex-wrap gap-2">{playback.subtitleSources.map(s=><Button intent="gray-outline" key={s.sourceId} disabled={busy} onClick={()=>fetchSubtitles(s.sourceId)}>{s.name}</Button>)}</div>
        {subtitleOptions&&(subtitleOptions.rows.length===0?<p><Trans>No subtitles returned.</Trans></p>:subtitleOptions.rows.map((s,i)=><Button intent="gray-outline" key={i} disabled={busy||!s.supported} onClick={()=>applySubtitle(i)}>{s.name} {s.language??''}</Button>))}
        {subtitleApplied&&<p role="status"><Trans>Subtitle request accepted.</Trans></p>}
      </div>}
      {busy&&<p role="status"><Trans>Loading sources…</Trans></p>}
      {notice&&<p role="status">{notice}</p>}
      {error&&<p role="alert"><Trans>The addon request failed. Refresh the choices and try again.</Trans></p>}
    </Drawer>
  </section>;
}
