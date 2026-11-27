import React from 'react';
import { Trans } from '@lingui/react/macro';
import { toast } from 'sonner';
import { checkTsugiRelease, supportsTsugiReleaseCheck, tsugiReleasePage } from '@/lib/hosts/shell/tsugi-release';
import { MovieGlyph } from '@/components/movie-icons';

// Once per renderer launch; native metadata checking is shared with Settings.
// An older, different or divergent release is not proof of an upgrade.
let checked=false;
export function TsugiReleasePrompt(){
  React.useEffect(()=>{
    if(checked||!supportsTsugiReleaseCheck())return;
    let active=true;
    const timer=window.setTimeout(()=>{
      if(checked)return;
      checked=true;
      void checkTsugiRelease().then(release=>{
        if(!active||release.status!=='newer-release')return;
        toast.custom(id=><div data-ui="tsugi-update-notice" className="w-full space-y-3">
          <p className="flex items-center gap-2 font-semibold"><MovieGlyph name="download" className="text-xl"/><Trans>New Tsugi release available</Trans></p>
          <p className="text-sm">{release.latestTag} · <Trans>Review the release notes and Windows download on GitHub. Your current installation is unchanged.</Trans></p>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="tsugi-read-action" onClick={()=>toast.dismiss(id)}><Trans>Later</Trans></button>
            <a className="tsugi-read-action" href={tsugiReleasePage(release)} target="_blank" rel="noopener noreferrer" onClick={()=>toast.dismiss(id)}><Trans>Open official release</Trans></a>
          </div>
        </div>,{duration:Infinity});
      }).catch(()=>{/* Settings retains a manual check; startup failure is non-blocking. */});
    },3000);
    return ()=>{active=false;window.clearTimeout(timer);};
  },[]);
  return null;
}
