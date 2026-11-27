import React from 'react';
import { Trans } from '@lingui/react/macro';
import { GlobalAppearanceSettings } from '@/components/shell/global-settings';
import { StremioAddonSettings } from '@/components/shell/stremio-addon-settings';
import { appBridge } from '@/lib/hosts/shell/bridge';
import { TsugiBrand } from '@/components/tsugi-brand';
import { storage } from '@/lib/storage';

const key = 'tsugi-onboarding-complete-v1';
let completedInSession = false;

export function FirstBootAppearance({revisit=0,watchRevisit=0,onWatchContinue}:{revisit?:number;watchRevisit?:number;onWatchContinue?:()=>void}) {
  const [open, setOpen] = React.useState(() => !completedInSession && storage.get<boolean>(key) !== true);
  const dialog = React.useRef<HTMLDialogElement>(null);
  const supportsAddons=appBridge()?.stremioAddons===true;
  const [step,setStep]=React.useState<'appearance'|'addons'>(()=>supportsAddons?'addons':'appearance');
  const [watchEntry,setWatchEntry]=React.useState(false);
  const lastWatch=React.useRef(watchRevisit);
  const lastRevisit = React.useRef(revisit);
  React.useEffect(()=>{
    if(watchRevisit!==lastWatch.current){lastWatch.current=watchRevisit;setWatchEntry(true);setStep('addons');setOpen(true);}
  },[watchRevisit]);
  React.useEffect(() => {
    if(revisit!==lastRevisit.current){lastRevisit.current=revisit;setWatchEntry(false);setStep('appearance');setOpen(true);}
  },[revisit]);
  React.useEffect(() => {
    const node = dialog.current;
    if (open && node && !node.open) node.showModal();
    else if (!open && node?.open) node.close();
    return () => { if (node?.open) node.close(); };
  }, [open]);
  function finish(continueWatch=false) {
    completedInSession = true;
    storage.set(key, true);
    setOpen(false);setStep('appearance');setWatchEntry(false);
    if(continueWatch&&watchEntry)onWatchContinue?.();
  }
  return <dialog ref={dialog} className={'tsugi-global-settings tsugi-onboarding'+(step==='addons'?' tsugi-watch-setup':'')} data-ui="tsugi-onboarding" aria-labelledby="tsugi-onboarding-title" onCancel={event => { event.preventDefault(); finish(); }}>
    {step==='appearance'&&<div className="tsugi-intro-art" aria-hidden="true">
      <img src="/design/shared/hero-train.webp" alt="" decoding="async"/>
      <div className="tsugi-intro-art-shade"/>
      <div className="tsugi-intro-art-signature"><TsugiBrand /></div>
    </div>}
    <div className="tsugi-intro-content">
    <header>
      <div className="tsugi-onboarding-title">
        <TsugiBrand markOnly />
        <div><h2 id="tsugi-onboarding-title">{step==='addons'?<Trans>Set up your addon profile</Trans>:<Trans>Make Tsugi yours</Trans>}</h2><p>{step==='addons'?<Trans>Choose a profile and arrange your sources. You can also set this up later.</Trans>:<Trans>Movies, music, stories and downloads — one space for what you love.</Trans>}</p></div>
      </div>
    </header>
    {step==='addons'&&open?<StremioAddonSettings workspace />:<GlobalAppearanceSettings />}
    <footer className="tsugi-onboarding-footer">
      <p><Trans>Your choices apply immediately. You can always change them in App settings.</Trans></p>
      <div className="tsugi-onboarding-actions">
        {step==='addons'&&<button type="button" className="tsugi-read-action" onClick={()=>setStep('appearance')}><Trans>Appearance</Trans></button>}
        <button type="button" className="tsugi-read-action" onClick={()=>finish()}><Trans>Skip for now</Trans></button>
        {supportsAddons&&step==='appearance'?<button type="button" className="tsugi-read-action tsugi-series-primary" onClick={()=>setStep('addons')}><Trans>Set up addons</Trans></button>:
        <button type="button" className="tsugi-read-action tsugi-series-primary" onClick={()=>finish(true)}>{watchEntry?<Trans>Continue to Movies &amp; TV</Trans>:<Trans>Enter Tsugi</Trans>}</button>}
      </div>
    </footer>
    </div>
  </dialog>;
}
