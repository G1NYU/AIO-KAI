import { useState } from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';

const landscapeUrl = 'https://api.nekosapi.com/v4/images/random/file?rating=safe&tags=landscape';

export function LandscapeSpotlight({title,eyebrow,description,actionLabel,onAction,disabled=false}:{title:string;eyebrow:string;description:string;actionLabel:string;onAction:()=>void;disabled?:boolean}) {
  const [external,setExternal] = useState(false);
  const [failed,setFailed] = useState(false);
  return <section className="tsugi-spotlight tsugi-landscape-spotlight" data-ui="landscape-spotlight">
    <div className="tsugi-spotlight-backdrop" aria-hidden="true">
      <svg viewBox="0 0 1600 600" preserveAspectRatio="xMidYMid slice" className="tsugi-landscape-fallback">
        <rect width="1600" height="600" fill="#283749"/>
        <circle cx="1170" cy="150" r="92" fill="#e2b18f" opacity=".78"/>
        <path d="M0 410 260 230 410 340 660 120 920 365 1190 205 1600 420V600H0Z" fill="#526376"/>
        <path d="M0 470 340 320 520 405 810 265 1090 420 1320 300 1600 445V600H0Z" fill="#37495b"/>
        <path d="M0 560 340 460 650 520 965 395 1250 500 1600 420V600H0Z" fill="#192b3b"/>
        <path d="M0 600 740 532 1100 545 1600 482V600Z" fill="#14212c"/>
      </svg>
      {external&&!failed&&<img src={landscapeUrl} alt="" referrerPolicy="no-referrer" onError={()=>setFailed(true)} onLoad={e=>{if(e.currentTarget.naturalWidth/e.currentTarget.naturalHeight<1.2)setFailed(true);}}/>}
    </div>
    <div className="tsugi-spotlight-copy">
      <p className="tsugi-feature-kicker">{eyebrow}</p><h2>{title}</h2><p>{description}</p>
      <button type="button" className="tsugi-read-action tsugi-series-primary mt-6" onClick={onAction} disabled={disabled}>{actionLabel}</button>
    </div>
    <div className="tsugi-landscape-credit">
      {external&&!failed?<><span>Nekos API</span><button type="button" onClick={()=>setExternal(false)}><Trans>Use local artwork</Trans></button></>:<button type="button" title={t`External illustrations are filtered but may be incorrectly classified.`} onClick={()=>{setFailed(false);setExternal(true);}}><Trans>Enable external illustration</Trans></button>}
      {external&&failed&&<span role="status"><Trans>Illustration unavailable</Trans></span>}
    </div>
  </section>;
}
