import React from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { BETTER_POSTERS_PATTERN, POSTERS_PLUS_PATTERN, validatePosterPattern } from '@/lib/watch-poster-pattern';

export function WatchPosterSettings({pattern,onSave}:{pattern?:string;onSave(pattern?:string):void}){
  const [draft,setDraft]=React.useState(pattern??'');
  const [error,setError]=React.useState(false);
  function save(value:string){
    if(!value.trim()){onSave(undefined);setDraft('');setError(false);return;}
    const valid=validatePosterPattern(value);
    if(!valid){setError(true);return;}
    onSave(valid);setDraft(valid);setError(false);
  }
  return <section className="tsugi-watch-section" data-ui="watch-poster-settings">
    <h4><Trans>Poster artwork</Trans></h4>
    <p className="tsugi-watch-muted"><Trans>Addon-provided posters are used automatically, including supported customized artwork. Optionally choose a public poster provider to override them for this Watch profile.</Trans></p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className="tsugi-read-action" aria-pressed={!pattern} onClick={()=>save('')}><Trans>Original artwork</Trans></button>
      <button type="button" className="tsugi-read-action" onClick={()=>{setDraft(POSTERS_PLUS_PATTERN);setError(false);}}><Trans>PostersPlus</Trans></button>
      <button type="button" className="tsugi-read-action" onClick={()=>{setDraft(BETTER_POSTERS_PATTERN);setError(false);}}><Trans>BetterPosters</Trans></button>
    </div>
    <form className="grid gap-3" onSubmit={event=>{event.preventDefault();save(draft);}}>
      <label className="grid gap-2"><span><Trans>Custom poster URL pattern</Trans></span><input type="text" autoComplete="off" spellCheck={false} className="w-full min-w-0" aria-label={t`Custom poster URL pattern`} value={draft} maxLength={8192} onChange={event=>{setDraft(event.target.value);setError(false);}}/></label>
      <p className="tsugi-watch-muted"><Trans>Use a key-free public PostersPlus or BetterPosters pattern. Do not paste API keys, account tokens or private URLs. Only portrait posters are replaced.</Trans></p>
      {error&&<p role="alert"><Trans>Unsupported public poster URL pattern. Check the provider, placeholders and public options.</Trans></p>}
      <div><button type="submit" className="tsugi-read-action"><Trans>Save poster preference</Trans></button></div>
    </form>
    <p role="status" className="tsugi-watch-muted">{pattern?<Trans>Custom posters enabled for this profile.</Trans>:<Trans>Using original catalogue artwork.</Trans>}</p>
  </section>;
}
