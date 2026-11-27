import React from 'react';
import { Trans } from '@lingui/react/macro';
import { GlobalAppearanceSettings } from '@/components/shell/global-settings';
import { MalMangaLibrary } from '@/app/read/mal-manga-library';
import { t } from '@lingui/core/macro';
import { StremioAddonSettings } from '@/components/shell/stremio-addon-settings';
import { appBridge } from '@/lib/hosts/shell/bridge';
import { TsugiBrand } from '@/components/tsugi-brand';
import { storage } from '@/lib/storage';

const key = 'tsugi-onboarding-complete-v1';
let completedInSession = false;

export const hasCompletedIntroduction = () => completedInSession || storage.get<boolean>(key) === true;
export function completeIntroduction() {
  completedInSession = true;
  storage.set(key, true);
}

export function FirstBootAppearance({onProfileSelected,revisit=0,watchRevisit=0,onWatchContinue,manual=false,onFinished,appearanceExtra,stillArtwork=false}:{
  onProfileSelected:(id:number|undefined)=>void;revisit?:number;watchRevisit?:number;onWatchContinue?:()=>void;
  manual?:boolean;onFinished?:()=>void;appearanceExtra?:React.ReactNode;stillArtwork?:boolean;
}) {
  const supportsAddons=appBridge()?.stremioAddons===true;
  const [open, setOpen] = React.useState(() => !manual && !supportsAddons && !hasCompletedIntroduction());
  const dialog = React.useRef<HTMLDialogElement>(null);
  const supportsReader=appBridge()?.reading===true||appBridge()?.readingSetup===true;
  const [mangaOpen,setMangaOpen]=React.useState(false);
  const [mangaBusy,setMangaBusy]=React.useState(false);
  const [mangaError,setMangaError]=React.useState('');
  const mangaFlight=React.useRef(false);
  async function runManga(work:()=>Promise<void>){
    if(mangaFlight.current)return;
    mangaFlight.current=true;setMangaBusy(true);setMangaError('');
    try{await work();}catch(reason){setMangaError(reason instanceof Error?reason.message:t({id:'MAL import failed',message:'The manga import could not be confirmed.'}));}
    finally{mangaFlight.current=false;setMangaBusy(false);}
  }
  const [step,setStep]=React.useState<'appearance'|'addons'>(()=>supportsAddons?'addons':'appearance');
  const [watchEntry,setWatchEntry]=React.useState(false);
  const [animeEntry,setAnimeEntry]=React.useState(false);
  const lastWatch=React.useRef(watchRevisit);
  const lastRevisit = React.useRef(revisit);
  React.useEffect(()=>{
    if(watchRevisit!==lastWatch.current){lastWatch.current=watchRevisit;setWatchEntry(true);setAnimeEntry(false);setStep('addons');setOpen(true);}
  },[watchRevisit]);
  React.useEffect(() => {
    if(revisit!==lastRevisit.current){lastRevisit.current=revisit;setWatchEntry(false);setAnimeEntry(false);setStep('appearance');setOpen(true);}
  },[revisit]);
  React.useEffect(() => {
    const node = dialog.current;
    if (open && node && !node.open) node.showModal();
    else if (!open && node?.open) node.close();
    return () => { if (node?.open) node.close(); };
  }, [open]);
  function finish(continueWatch=false) {
    if(mangaFlight.current)return;
    completeIntroduction();
    setOpen(false);setStep('appearance');setWatchEntry(false);setAnimeEntry(false);setMangaOpen(false);setMangaError('');
    onFinished?.();
    if(continueWatch&&watchEntry)onWatchContinue?.();
  }
  function back() {
    if(mangaFlight.current)return;
    setOpen(false);setStep('appearance');setWatchEntry(false);setAnimeEntry(false);setMangaOpen(false);setMangaError('');
  }
  return <dialog ref={dialog} data-motion={stillArtwork?'still':undefined} className={'tsugi-global-settings tsugi-onboarding'+(step==='addons'?' tsugi-watch-setup':'')+(manual?' tsugi-world-setup':'')} data-ui="tsugi-onboarding" aria-labelledby="tsugi-onboarding-title" onCancel={event => { event.preventDefault(); finish(); }}>
    {step==='appearance'&&<div className="tsugi-intro-art" aria-hidden="true">
      <img src={manual?"/design/launch/personalization-room.webp":"/design/shared/hero-train.webp"} alt="" decoding="async"/>
      <div className="tsugi-intro-art-shade"/>
      {manual&&<div className="tsugi-world-setup-copy"><span lang="ja">あなたの世界。</span><h2><Trans>A little more you.</Trans></h2><p><Trans>The stories you return to. The sounds you carry with you.</Trans></p></div>}
      <div className="tsugi-intro-art-signature"><TsugiBrand /></div>
    </div>}
    <div className="tsugi-intro-content">
    <header>
      <div className="tsugi-onboarding-title">
        <TsugiBrand markOnly />
        <div><h2 id="tsugi-onboarding-title">{step==='addons'?<Trans>Set up your addon profile</Trans>:<Trans>Make Tsugi yours</Trans>}</h2><p>{step==='addons'?<Trans>Choose a profile and arrange your sources. You can also set this up later.</Trans>:<Trans>Movies, anime, music, stories and downloads — one space for what you love.</Trans>}</p></div>
      </div>
    </header>
    {step==='addons'&&open?<StremioAddonSettings workspace setupConnections onProfileSelected={onProfileSelected} initialPane={animeEntry?'anime':'addons'} />:step==='appearance'&&open?<>
      {appearanceExtra}
      <GlobalAppearanceSettings />
      <section className="tsugi-app-general" data-ui="first-launch-connections">
        <h3><Trans>Collections and connections</Trans></h3>
        {supportsAddons&&<><p><Trans>Anime Hub is part of Movies &amp; TV. In addon setup, choose a Watch profile to import your MyAnimeList anime list, connect Refract with a personal key, or configure Stremio, Nuvio and MDBList. No account is required to finish setup.</Trans></p>
        <button type="button" className="tsugi-read-action" disabled={mangaBusy} onClick={()=>{setAnimeEntry(true);setStep('addons');}}><Trans>Set up Anime and Watch connections</Trans></button></>}
        {supportsReader&&<><p><Trans>Bring your MyAnimeList manga collection into Reader now, and choose Mihon or Tachiyomi sources and tracker accounts later.</Trans></p>
        <button type="button" className="tsugi-read-action" aria-expanded={mangaOpen} disabled={mangaBusy} onClick={()=>{setMangaOpen(value=>!value);setMangaError('');}}><Trans>Import manga list</Trans></button>
        {mangaOpen&&<><MalMangaLibrary importOnly busy={mangaBusy} run={runManga}/>{mangaError&&<p role="alert">{mangaError}</p>}</>}
        </>}
      </section>
    </>:null}
    <footer className="tsugi-onboarding-footer">
      <p><Trans>Your choices apply immediately. You can always change them in App settings.</Trans></p>
      <div className="tsugi-onboarding-actions">
        {manual&&step==='appearance'&&<button type="button" className="tsugi-read-action" disabled={mangaBusy} onClick={back}><Trans>Back</Trans></button>}
        {step==='addons'&&<button type="button" className="tsugi-read-action" onClick={()=>setStep('appearance')}><Trans>Appearance</Trans></button>}
        <button type="button" className="tsugi-read-action" disabled={mangaBusy} onClick={()=>finish()}><Trans>Skip for now</Trans></button>
        {supportsAddons&&step==='appearance'&&manual&&<button type="button" className="tsugi-read-action" disabled={mangaBusy} onClick={()=>{setAnimeEntry(false);setStep('addons');}}><Trans>Set up addons</Trans></button>}
        {supportsAddons&&step==='appearance'&&!manual?<button type="button" className="tsugi-read-action tsugi-series-primary" disabled={mangaBusy} onClick={()=>{setAnimeEntry(false);setStep('addons');}}><Trans>Set up addons</Trans></button>:
        <button type="button" className="tsugi-read-action tsugi-series-primary" disabled={mangaBusy} onClick={()=>finish(true)}>{watchEntry?<Trans>Continue to Movies &amp; TV</Trans>:<Trans>Enter Tsugi</Trans>}</button>}
      </div>
    </footer>
    </div>
  </dialog>;
}
