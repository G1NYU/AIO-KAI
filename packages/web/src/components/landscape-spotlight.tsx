import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';

import { landscapeCandidates, type LandscapeArtwork } from './landscape-artwork';

const preferenceKey = 'tsugi.landscape.local-only';
const preferenceEvent = 'tsugi-landscape-preference';
let localOnly = false;
function externalEnabled() {
  try { return localStorage.getItem(preferenceKey) !== 'true'; }
  catch { return !localOnly; }
}
function subscribe(callback: () => void) {
  window.addEventListener(preferenceEvent, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(preferenceEvent, callback);
    window.removeEventListener('storage', callback);
  };
}
function setExternal(enabled: boolean) {
  localOnly = !enabled;
  try { localStorage.setItem(preferenceKey, String(localOnly)); } catch { /* In-memory preference. */ }
  window.dispatchEvent(new Event(preferenceEvent));
}
function ArtworkImage({artwork,onFailure,onReady}:{artwork:LandscapeArtwork;onFailure:()=>void;onReady:()=>void}) {
  const [loaded,setLoaded] = useState(false);
  useEffect(()=>{
    if (loaded) return;
    const timer = window.setTimeout(onFailure, 6000);
    return ()=>window.clearTimeout(timer);
  },[loaded,onFailure]);
  return <img src={artwork.url} alt="" referrerPolicy="no-referrer" style={{opacity:loaded?1:0}}
    onError={onFailure} onLoad={e=>{
      const {naturalWidth,naturalHeight}=e.currentTarget;
      if (naturalHeight===0||naturalWidth/naturalHeight<1.2) { onFailure(); return; }
      setLoaded(true);onReady();
    }}/>;
}
type SpotlightProps = {
  title:string;eyebrow:string;description:string;actionLabel:string;onAction:()=>void;disabled?:boolean;
  featuredKey?:string;featuredArtwork?:ReactNode;onNextFeatured?:()=>void;
};
export function LandscapeSpotlight(props:SpotlightProps) {
  const external = useSyncExternalStore(subscribe,externalEnabled,()=>true);
  return <SpotlightContent key={props.featuredKey ? 'featured:'+props.featuredKey : external?'remote':'local'} {...props} external={external}/>;
}
function SpotlightContent({title,eyebrow,description,actionLabel,onAction,disabled=false,external,featuredKey,featuredArtwork,onNextFeatured}:SpotlightProps&{external:boolean}) {
  const generic = !featuredKey;
  const [candidates,setCandidates] = useState<LandscapeArtwork[]>([]);
  const [failed,setFailed] = useState<Set<string>>(()=>new Set());
  const [index,setIndex] = useState(0);
  const [loadedUrl,setLoadedUrl] = useState('');
  useEffect(()=>{
    if (!generic || !external) return;
    const controller = new AbortController();
    let active = true;
    const timer=window.setTimeout(()=>controller.abort(),4000);
    void landscapeCandidates(controller.signal).then(result=>{
      if(active)setCandidates(result);
    }).finally(()=>window.clearTimeout(timer));
    return ()=>{active=false;controller.abort();window.clearTimeout(timer);};
  },[generic,external]);
  const available=candidates.filter(item=>!failed.has(item.url));
  const artwork=available.length?available[index%available.length]:undefined;
  const ready=!!artwork&&loadedUrl===artwork.url;
  const provider=ready?artwork?.provider:null;
  const advance=useCallback(()=>{
    setLoadedUrl('');
    setIndex(value=>value+1);
  },[]);
  const onFailure=useCallback(()=>{
    if(!artwork)return;
    setLoadedUrl('');
    setFailed(current=>new Set([...current,artwork.url]));
  },[artwork]);
  const onReady=useCallback(()=>{if(artwork)setLoadedUrl(artwork.url);},[artwork]);
  useEffect(()=>{
    if(!generic||!external||!ready||available.length<2)return;
    const timer=window.setInterval(()=>{
      if(!document.hidden&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches)advance();
    },20000);
    return ()=>window.clearInterval(timer);
  },[generic,external,ready,available.length,artwork,advance]);
  return <section className="tsugi-spotlight tsugi-landscape-spotlight" data-ui="landscape-spotlight" data-artwork-mode={generic?'illustration':'featured'}>
    <div className="tsugi-spotlight-backdrop" aria-hidden="true">
      <svg viewBox="0 0 1600 600" preserveAspectRatio="xMidYMid slice" className="tsugi-landscape-fallback">
        <rect width="1600" height="600" fill="#283749"/>
        <circle cx="1170" cy="150" r="92" fill="#e2b18f" opacity=".78"/>
        <path d="M0 410 260 230 410 340 660 120 920 365 1190 205 1600 420V600H0Z" fill="#526376"/>
        <path d="M0 470 340 320 520 405 810 265 1090 420 1320 300 1600 445V600H0Z" fill="#37495b"/>
        <path d="M0 560 340 460 650 520 965 395 1250 500 1600 420V600H0Z" fill="#192b3b"/>
        <path d="M0 600 740 532 1100 545 1600 482V600Z" fill="#14212c"/>
      </svg>
      {!generic && <div className="tsugi-spotlight-source-cover">{featuredArtwork}</div>}
      {generic&&external&&artwork&&<ArtworkImage key={artwork.url} artwork={artwork} onFailure={onFailure} onReady={onReady}/>}
    </div>
    <div className="tsugi-spotlight-copy">
      <p className="tsugi-feature-kicker">{eyebrow}</p><h2>{title}</h2><p>{description}</p>
      <button type="button" className="tsugi-read-action tsugi-series-primary mt-6" onClick={onAction} disabled={disabled}>{actionLabel}</button>
    </div>
    {(generic||onNextFeatured)&&<div className="tsugi-landscape-credit">
      {generic&&external&&provider==='kitsu'&&<span><Trans>Kitsu</Trans></span>}
      {generic&&external&&provider==='nekos'&&<span><Trans>Nekos API</Trans></span>}
      {generic&&external&&ready&&available.length>1&&<button type="button" onClick={advance}><Trans>Next illustration</Trans></button>}
      {generic&&(external?<button type="button" title={t`External illustrations are filtered but may be incorrectly classified.`} onClick={()=>setExternal(false)}><Trans>Use local artwork</Trans></button>:<button type="button" onClick={()=>setExternal(true)}><Trans>Enable external illustration</Trans></button>)}
      {!generic&&onNextFeatured&&<button type="button" onClick={onNextFeatured} disabled={disabled}><Trans>Next featured title</Trans></button>}
    </div>}
  </section>;
}
