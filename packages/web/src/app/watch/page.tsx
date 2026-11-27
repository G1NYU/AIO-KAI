import React from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { StremioAddonSettings } from '@/components/shell/stremio-addon-settings';
import { appBridge } from '@/lib/hosts/shell/bridge';
import { consumeAddonMedia, loadAddonOptions, prepareAddonMedia, type AddonOptions, type WatchPlayback } from '@/lib/hosts/shell/stremio';
import { useMediaPresence } from '@/lib/rich-presence';
import { usePlayerPage } from '@/app/player/page';
import './watch.css';

export function DirectWatchPage({openWelcome,openVideo}:{openWelcome:()=>void;openVideo:()=>void}){
  const [playing,setPlaying]=React.useState<WatchPlayback|null>(null);
  return <main data-page="direct-watch" className="tsugi-direct-watch">
    <div hidden={!!playing} inert={!!playing}>
      <header className="flex flex-wrap gap-3 justify-between"><button type="button" className="tsugi-read-action" onClick={openWelcome}><Trans>Home</Trans></button><button type="button" className="tsugi-read-action" onClick={openVideo}><Trans>Connect to a media server</Trans></button></header>
      <StremioAddonSettings workspace onPlay={setPlaying}/>
    </div>
    {playing&&<DirectPlayer key={playing.grantId} playback={playing} close={()=>setPlaying(null)}/>}
  </main>;
}
function DirectPlayer({playback,close}:{playback:WatchPlayback;close:()=>void}){
  const [status,setStatus]=React.useState<'loading'|'ready'|'error'|'ended'>('loading');
  const [paused,setPaused]=React.useState(false);
  const [position,setPosition]=React.useState(0);
  const [duration,setDuration]=React.useState(0);
  const [subtitleOptions,setSubtitleOptions]=React.useState<AddonOptions|null>(null);
  const [subtitleBusy,setSubtitleBusy]=React.useState(false);
  const [subtitleError,setSubtitleError]=React.useState(false);
  const [subtitleApplied,setSubtitleApplied]=React.useState(false);
  const mounted=React.useRef(false), subtitleFlight=React.useRef(false);
  const current=React.useRef({paused,position,duration});
  current.current={paused,position,duration};
  const closeRef=React.useRef(close);closeRef.current=close;
  usePlayerPage();
  useMediaPresence(status==='ready'?{media:'video',title:playback.title,subtitle:playback.episodeTitle,
    imdb:/^tt[0-9]{1,10}$/.test(playback.itemId)?playback.itemId:null,position,duration:duration||null,paused,browsing:false}:null);
  React.useEffect(()=>{
    const host=appBridge();
    if(!host){setStatus('error');return;}
    mounted.current=true;
    let active=true,started=false;
    const stop=host.subscribe(message=>{
      if(!active||!started||('external' in message&&message.external))return;
      if(message.type==='player-state'){
        if(typeof message.positionMs==='number'&&Number.isFinite(message.positionMs))setPosition(Math.max(0,message.positionMs));
        if(typeof message.durationMs==='number'&&Number.isFinite(message.durationMs))setDuration(Math.max(0,message.durationMs));
        if(typeof message.paused==='boolean')setPaused(message.paused);
      }else if(message.type==='player-event'&&message.name==='loaded')setStatus('ready');
      else if(message.type==='player-ended'){
        if(message.reason==='eof')setStatus('ended');
        else if(message.reason==='error'||message.error)setStatus('error');
      }else if(message.type==='media-key'){
        const key=message.key,p=current.current;
        if(key.action==='stop')closeRef.current();
        else if(key.action==='play'||key.action==='pause'||key.action==='toggle')host.send({type:'player-set',paused:key.action==='toggle'?!p.paused:key.action==='pause'});
        else if(key.action==='seek'||key.action==='skip')host.send({type:'player-seek',positionMs:Math.max(0,Math.min(p.duration||604800000,key.action==='seek'?key.position:p.position+key.offset))});
      }
    });
    // StrictMode's first effect cleanup happens before this deferred start.
    const start=setTimeout(()=>{
      if(!active)return;
      started=true;
      host.send({type:'player-frame',frame:null});
      void consumeAddonMedia(playback.grantId,false).catch(()=>{if(active)setStatus('error');});
    },0);
    const timeout=setTimeout(()=>{if(active)setStatus(old=>old==='loading'?'error':old);},45_000);
    return ()=>{
      mounted.current=false;active=false;clearTimeout(start);clearTimeout(timeout);stop();
      if(started)host.send({type:'player-stop'});
    };
  },[playback.grantId]);
  function seek(ms:number){appBridge()?.send({type:'player-seek',positionMs:ms});}
  async function fetchSubtitles(sourceId:number){
    if(subtitleFlight.current)return;
    subtitleFlight.current=true;setSubtitleBusy(true);setSubtitleOptions(null);setSubtitleError(false);setSubtitleApplied(false);
    try{const result=await loadAddonOptions(playback.profileId,sourceId,playback.mediaType,playback.videoId,true);if(mounted.current)setSubtitleOptions(result);}
    catch{if(mounted.current)setSubtitleError(true);}
    finally{subtitleFlight.current=false;if(mounted.current)setSubtitleBusy(false);}
  }
  async function applySubtitle(index:number){
    if(subtitleFlight.current||!subtitleOptions?.rows[index]?.supported)return;
    subtitleFlight.current=true;setSubtitleBusy(true);setSubtitleError(false);setSubtitleApplied(false);
    try{
      const grant=await prepareAddonMedia(playback.profileId,subtitleOptions.reviewId,index,true);
      if(!mounted.current)return;
      await consumeAddonMedia(grant,true);
      if(mounted.current){setSubtitleApplied(true);setSubtitleOptions(null);}
    }catch{if(mounted.current)setSubtitleError(true);}
    finally{subtitleFlight.current=false;if(mounted.current)setSubtitleBusy(false);}
  }
  const time=(ms:number)=>{const seconds=Math.floor(ms/1000);return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(n=>String(n).padStart(2,'0')).join(':');};
  return <section className="tsugi-direct-player" data-ui="direct-watch-player" aria-label={playback.title}>
    <header><div><h1>{playback.title}</h1>{playback.episodeTitle&&<p>{playback.episodeTitle}</p>}</div><button type="button" className="tsugi-read-action" onClick={close}><Trans>Back to Watch</Trans></button></header>
    {status!=='ready'&&<div className="tsugi-direct-player-status" role={status==='error'?'alert':'status'}>{status==='loading'?<Trans>Opening stream…</Trans>:status==='error'?<Trans>Playback failed or the selection expired. Go back and request a fresh stream.</Trans>:<Trans>Playback ended.</Trans>}</div>}
    <footer>
      {status==='ready'&&<>
        <div className="flex flex-wrap items-center gap-3"><button type="button" className="tsugi-read-action" onClick={()=>appBridge()?.send({type:'player-set',paused:!paused})}>{paused?<Trans>Play</Trans>:<Trans>Pause</Trans>}</button><span>{time(position)} / {time(duration)}</span><input type="range" aria-label={t`Playback position`} min={0} max={Math.max(duration,1)} value={Math.min(position,duration)} disabled={!duration} onChange={e=>seek(Number(e.target.value))}/></div>
        {playback.subtitleSources.length>0&&<details><summary><Trans>Addon subtitles</Trans></summary><div className="flex flex-wrap gap-2">{playback.subtitleSources.map(s=><button type="button" key={s.sourceId} className="tsugi-read-action" disabled={subtitleBusy} onClick={()=>void fetchSubtitles(s.sourceId)}>{s.name}</button>)}</div>
          {subtitleOptions&&<div className="max-h-40 overflow-auto">{subtitleOptions.rows.length===0?<p><Trans>No subtitles returned.</Trans></p>:subtitleOptions.rows.map((s,i)=><button className="tsugi-read-action" key={i} type="button" disabled={subtitleBusy||!s.supported} onClick={()=>void applySubtitle(i)}>{s.name} {s.language??''}</button>)}</div>}
          {subtitleBusy&&<p role="status"><Trans>Contacting addon…</Trans></p>}{subtitleApplied&&<p role="status"><Trans>Subtitle request accepted.</Trans></p>}{subtitleError&&<p role="alert"><Trans>Could not select this subtitle. Request a fresh list.</Trans></p>}</details>}
      </>}
    </footer>
  </section>;
}
