import React from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import type { WatchEntryPane } from '@/lib/desktop-area';
import { StremioAddonSettings } from '@/components/shell/stremio-addon-settings';
import { appBridge } from '@/lib/hosts/shell/bridge';
import { consumeAddonMedia, loadAddonOptions, prepareAddonMedia, saveWatchProgress, type AddonOptions, type WatchPlayback, type WatchProgress } from '@/lib/hosts/shell/stremio';
import { useMediaPresence } from '@/lib/rich-presence';
import { usePlayerPage } from '@/app/player/page';
import { leaveFullscreen, toggleDocumentFullscreen } from '@/lib/playback/fullscreen';
import './watch.css';

export function DirectWatchPage({openWelcome,openVideo,initialPane='hubs',settingsOpen=false}:{openWelcome:()=>void;openVideo:()=>void;initialPane?:WatchEntryPane;settingsOpen?:boolean}){
  const [playing,setPlaying]=React.useState<WatchPlayback|null>(null);
  const [historyError,setHistoryError]=React.useState(false);
  return <main data-page="direct-watch" className="tsugi-direct-watch">
    <div hidden={!!playing} inert={!!playing}>
      <header className="flex flex-wrap gap-3 justify-between"><button type="button" className="tsugi-read-action" onClick={openWelcome}><Trans id="All media">All media</Trans></button></header>
      {historyError&&<p role="alert"><Trans>Watch progress could not be confirmed saved. Check your history before resuming.</Trans></p>}
      <StremioAddonSettings workspace initialPane={initialPane} openServer={openVideo} onPlay={setPlaying} historyActive={!playing&&!settingsOpen}/>
    </div>
    {playing&&<DirectPlayer key={playing.grantId} playback={playing} close={()=>setPlaying(null)} onHistoryError={setHistoryError}/>}
  </main>;
}
function DirectPlayer({playback,close,onHistoryError}:{playback:WatchPlayback;close:()=>void;onHistoryError:(failed:boolean)=>void}){
  const [status,setStatus]=React.useState<'loading'|'ready'|'error'|'ended'>('loading');
  const [paused,setPaused]=React.useState(false);
  const [volume,setVolume]=React.useState<number|null>(null);
  const [muted,setMuted]=React.useState(false);
  const [position,setPosition]=React.useState(0);
  const [duration,setDuration]=React.useState(0);
  const [subtitleOptions,setSubtitleOptions]=React.useState<AddonOptions|null>(null);
  const [subtitleBusy,setSubtitleBusy]=React.useState(false);
  const [subtitleError,setSubtitleError]=React.useState(false);
  const [subtitleApplied,setSubtitleApplied]=React.useState(false);
  const mounted=React.useRef(false), subtitleFlight=React.useRef(false);
  const current=React.useRef({paused:false,position:0,duration:0});
  const loaded=React.useRef(false),accepted=React.useRef(false),completed=React.useRef(false),closing=React.useRef(false);
  const historyFlight=React.useRef<Promise<void>|null>(null),lastSaved=React.useRef('');
  const [viewingId]=React.useState(()=>{
    // getRandomValues also works in older native WebView origin contexts.
    const bytes=crypto.getRandomValues(new Uint8Array(16));
    bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
    const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
    return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
  });
  const [historyBusy,setHistoryBusy]=React.useState(false),[leaving,setLeaving]=React.useState(false);
  async function checkpoint(force=false){
    if(!loaded.current||!accepted.current||(!force&&(closing.current||subtitleFlight.current)))return;
    while(historyFlight.current){if(!force)return;await historyFlight.current;}
    const {position:samplePosition,duration:sampleDuration}=current.current;
    const durationMs=Math.floor(sampleDuration),positionMs=completed.current?durationMs:Math.min(durationMs,Math.floor(samplePosition));
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
  async function leave(){
    if(closing.current)return;
    closing.current=true;setLeaving(true);
    // Freeze the last observation before stopping the native transport.
    appBridge()?.send({type:'player-stop'});
    leaveFullscreen();
    await checkpoint(true);
    if(mounted.current)close();
  }
  const closeRef=React.useRef(leave);closeRef.current=leave;
  usePlayerPage();
  useMediaPresence(status==='ready'&&!leaving?{media:'video',title:playback.title,subtitle:playback.episodeTitle,
    imdb:/^tt[0-9]{1,10}$/.test(playback.itemId)?playback.itemId:null,position,duration:duration||null,paused,browsing:false}:null);
  React.useEffect(()=>{
    mounted.current=true;
    const host=appBridge();
    if(!host){setStatus('error');return ()=>{mounted.current=false;};}
    let active=true,started=false;
    const stop=host.subscribe(message=>{
      if(!active||!started||closing.current||('external' in message&&message.external))return;
      if(message.type==='player-state'&&loaded.current){
        if(typeof message.positionMs==='number'&&Number.isFinite(message.positionMs)){current.current.position=Math.max(0,message.positionMs);setPosition(current.current.position);}
        if(typeof message.durationMs==='number'&&Number.isFinite(message.durationMs)){current.current.duration=Math.max(0,message.durationMs);setDuration(current.current.duration);}
        if(typeof message.paused==='boolean'){current.current.paused=message.paused;setPaused(message.paused);}
        if(typeof message.volume==='number'&&Number.isFinite(message.volume))setVolume(Math.max(0,Math.min(100,message.volume)));
        if(typeof message.muted==='boolean')setMuted(message.muted);
      }else if(message.type==='player-event'&&message.name==='loaded'){
        loaded.current=true;if(accepted.current)setStatus('ready');
      }else if(message.type==='player-ended'&&loaded.current&&accepted.current){
        if(message.reason==='eof'){completed.current=true;setStatus('ended');void checkpoint(true);}
        else if(message.reason==='error'||message.error){setStatus('error');void checkpoint(true);}
      }else if(message.type==='media-key'){
        const key=message.key,p=current.current;
        if(key.action==='stop')void closeRef.current();
        else if(key.action==='play'||key.action==='pause'||key.action==='toggle')host.send({type:'player-set',paused:key.action==='toggle'?!p.paused:key.action==='pause'});
        else if(key.action==='seek'||key.action==='skip')host.send({type:'player-seek',positionMs:Math.max(0,Math.min(p.duration||604800000,key.action==='seek'?key.position:p.position+key.offset))});
      }
    });
    // StrictMode's first effect cleanup happens before this deferred start.
    const start=setTimeout(()=>{
      if(!active)return;
      started=true;
      host.send({type:'player-frame',frame:null});
      void consumeAddonMedia(playback.grantId,false).then(()=>{if(active&&!closing.current){accepted.current=true;if(loaded.current)setStatus('ready');}},()=>{if(active&&!closing.current)setStatus('error');});
    },0);
    const timeout=setTimeout(()=>{if(active)setStatus(old=>old==='loading'?'error':old);},45_000);
    const checkpointTimer=setInterval(()=>void checkpoint(),30_000);
    return ()=>{
      mounted.current=false;active=false;clearTimeout(start);clearTimeout(timeout);clearInterval(checkpointTimer);stop();
      if(started&&!closing.current){host.send({type:'player-stop'});void checkpoint(true);}
    };
  },[playback.grantId]);
  function seek(ms:number){appBridge()?.send({type:'player-seek',positionMs:ms});}
  async function fetchSubtitles(sourceId:number){
    if(subtitleFlight.current||historyFlight.current||closing.current)return;
    subtitleFlight.current=true;setSubtitleBusy(true);setSubtitleOptions(null);setSubtitleError(false);setSubtitleApplied(false);
    try{const result=await loadAddonOptions(playback.profileId,sourceId,playback.mediaType,playback.videoId,true);if(mounted.current&&!closing.current)setSubtitleOptions(result);}
    catch{if(mounted.current)setSubtitleError(true);}
    finally{subtitleFlight.current=false;if(mounted.current)setSubtitleBusy(false);}
  }
  async function applySubtitle(index:number){
    if(subtitleFlight.current||historyFlight.current||closing.current||!subtitleOptions?.rows[index]?.supported)return;
    subtitleFlight.current=true;setSubtitleBusy(true);setSubtitleError(false);setSubtitleApplied(false);
    try{
      const grant=await prepareAddonMedia(playback.profileId,subtitleOptions.reviewId,index,true);
      if(!mounted.current||closing.current)return;
      await consumeAddonMedia(grant,true);
      if(mounted.current){setSubtitleApplied(true);setSubtitleOptions(null);}
    }catch{if(mounted.current)setSubtitleError(true);}
    finally{subtitleFlight.current=false;if(mounted.current)setSubtitleBusy(false);}
  }
  const time=(ms:number)=>{const seconds=Math.floor(ms/1000);return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(n=>String(n).padStart(2,'0')).join(':');};
  return <section className="tsugi-direct-player" data-ui="direct-watch-player" aria-label={playback.title}>
    <header><div><h1>{playback.title}</h1>{playback.episodeTitle&&<p>{playback.episodeTitle}</p>}</div><button type="button" className="tsugi-read-action" disabled={leaving} onClick={()=>void leave()}><Trans>Back to Watch</Trans></button></header>
    {leaving&&<p role="status"><Trans>Saving Watch progress…</Trans></p>}
    {!leaving&&status!=='ready'&&<div className="tsugi-direct-player-status" role={status==='error'?'alert':'status'}>{status==='loading'?<Trans>Opening stream…</Trans>:status==='error'?<Trans>Playback failed or the selection expired. Go back and request a fresh stream.</Trans>:<Trans>Playback ended.</Trans>}</div>}
    <footer>
      {!leaving&&status==='ready'&&<>
        <div className="tsugi-direct-seek"><span>{time(position)}</span><input type="range" aria-label={t`Playback position`} min={0} max={Math.max(duration,1)} value={Math.min(position,duration)} disabled={!duration} onChange={e=>seek(Number(e.target.value))}/><span>{time(duration)}</span></div>
        <div className="tsugi-direct-controls">
          <button type="button" className="tsugi-read-action" aria-label={t`Back 10 seconds`} disabled={!duration} onClick={()=>seek(Math.max(0,position-10000))}><Trans>−10s</Trans></button>
          <button type="button" className="tsugi-read-action" onClick={()=>appBridge()?.send({type:'player-set',paused:!paused})}>{paused?<Trans>Play</Trans>:<Trans>Pause</Trans>}</button>
          <button type="button" className="tsugi-read-action" aria-label={t`Forward 10 seconds`} disabled={!duration} onClick={()=>seek(Math.min(duration,position+10000))}><Trans>+10s</Trans></button>
          {volume!==null&&<><button type="button" className="tsugi-read-action" onClick={()=>appBridge()?.send({type:'player-set',muted:!muted})}>{muted?<Trans>Unmute</Trans>:<Trans>Mute</Trans>}</button><input type="range" aria-label={t`Volume`} min={0} max={100} value={volume} onChange={e=>appBridge()?.send({type:'player-set',volume:Number(e.target.value),muted:false})}/></>}
          <button type="button" className="tsugi-read-action" onClick={toggleDocumentFullscreen}><Trans>Toggle fullscreen</Trans></button>
        </div>
        {historyBusy&&<p role="status"><Trans>Saving Watch progress…</Trans></p>}
        {playback.subtitleSources.length>0&&<details><summary><Trans>Addon subtitles</Trans></summary><div className="flex flex-wrap gap-2">{playback.subtitleSources.map(s=><button type="button" key={s.sourceId} className="tsugi-read-action" disabled={subtitleBusy||historyBusy} onClick={()=>void fetchSubtitles(s.sourceId)}>{s.name}</button>)}</div>
          {subtitleOptions&&<div className="max-h-40 overflow-auto">{subtitleOptions.rows.length===0?<p><Trans>No subtitles returned.</Trans></p>:subtitleOptions.rows.map((s,i)=><button className="tsugi-read-action" key={i} type="button" disabled={subtitleBusy||historyBusy||!s.supported} onClick={()=>void applySubtitle(i)}>{s.name} {s.language??''}</button>)}</div>}
          {subtitleBusy&&<p role="status"><Trans>Contacting addon…</Trans></p>}{subtitleApplied&&<p role="status"><Trans>Subtitle request accepted.</Trans></p>}{subtitleError&&<p role="alert"><Trans>Could not select this subtitle. Request a fresh list.</Trans></p>}</details>}
      </>}
    </footer>
  </section>;
}
