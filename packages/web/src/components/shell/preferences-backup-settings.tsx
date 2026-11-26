import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { applyPreferencesBackup, capturePreferencesBackup, MAX_PREFERENCES_BACKUP_BYTES, parsePreferencesBackup, preferenceRestoreBaseline, type PreferencesBackup } from '@/lib/backup/preferences';
import { reviewRestoreSection,runRestoreSection,type RestoreSectionReview } from '@/lib/backup/restore-session';
import { restoreSessionFeedback } from './restore-session-feedback';

export function PreferencesBackupSettings({onApplied,archiveEntry}:{onApplied():void;archiveEntry?:string}) {
  const [review,setReview]=React.useState<{file:PreferencesBackup;baseline:ReadonlyMap<string,string|null>;entry?:string;session?:RestoreSectionReview}|null>(null);
  const preview=review?.file;
  const [notice,setNotice]=React.useState('');
  const [error,setError]=React.useState('');
  const [busy,setBusy]=React.useState(false);

  function download() {
    setError('');setNotice('');
    try {
      const file=capturePreferencesBackup();
      const url=URL.createObjectURL(new Blob([JSON.stringify(file,null,2)],{type:'application/json'}));
      const anchor=document.createElement('a');
      anchor.href=url;anchor.download='tsugi-preferences.json';
      document.body.appendChild(anchor);anchor.click();anchor.remove();
      window.setTimeout(()=>URL.revokeObjectURL(url),1000);
      setNotice(t`Preferences export requested. Check your downloads.`);
    } catch {setError(t`Could not export preferences. Check device storage.`);}
  }
  async function load(file:File|undefined,entry?:string) {
    setReview(null);setNotice('');setError('');
    if(!file)return;
    setBusy(true);
    try {
      const session=reviewRestoreSection('preferences',entry);
      if(file.size>MAX_PREFERENCES_BACKUP_BYTES)throw new Error('size');
      const parsed=parsePreferencesBackup(await file.text());
      setReview({file:parsed,baseline:preferenceRestoreBaseline(parsed),entry,session});
    } catch(reason) {setError(restoreSessionFeedback(reason)??t`Invalid or unsupported Tsugi preferences file. Nothing was changed.`);}
    finally {setBusy(false);}
  }
  async function apply() {
    if(!review)return;
    setError('');setNotice('');setBusy(true);
    try{
      const outcome=await runRestoreSection('preferences',review.entry,review.session,
        ()=>applyPreferencesBackup(review.file,review.baseline),value=>value==='applied');
      setReview(null);
      if(outcome==='applied'){
        onApplied();
        setNotice(t`Preferences restored. Reopen the reader or player, or restart Tsugi if necessary, to apply every setting.`);
      } else if(outcome==='stale'){
        setError(t({id:'Preferences changed after review. Preview the file again before restoring.',message:'Preferences changed after review. Preview the file again before restoring.'}));
      } else {
        setError(outcome==='rollback-failed'
          ?t`Storage blocked recovery. Some preferences may have changed. Export or review the current settings before retrying.`
          :t`Could not restore preferences. Previous values were retained.`);
      }
    }catch(reason){setReview(null);setError(restoreSessionFeedback(reason)??t`The preference restore could not be confirmed. Review the current settings before retrying.`);}
    finally{setBusy(false);}
  }
  return <section className="tsugi-app-general" aria-label={t`Preferences backup`}>
    <h3><Trans>Preferences backup</Trans></h3>
    <p><Trans id="Back up built-in appearance, startup, visualizer, sound profile, reader preferences and Feed source choices. Libraries, downloads, credentials, source URLs and custom Studio layouts are not included.">Back up built-in appearance, startup, visualizer, sound profile, reader preferences and Feed source choices. Libraries, downloads, credentials, source URLs and custom Studio layouts are not included.</Trans></p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className="tsugi-read-action" disabled={busy} onClick={download}><Trans>Export preferences</Trans></button>
      <label className="min-w-0"><span><Trans>Preview preferences restore</Trans></span>
        <input type="file" accept=".json,application/json" className="tsugi-read-input w-full min-w-0 max-w-full" disabled={busy} onChange={event=>{
          const file=event.target.files?.[0];event.target.value='';void load(file);
        }}/>
      </label>
    </div>
    {archiveEntry!==undefined&&<button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void load(new File([archiveEntry],'preferences.json',{type:'application/json'}),archiveEntry)}><Trans>Review archived preferences</Trans></button>}
    {preview&&<div className="min-w-0 space-y-3">
      <h4><Trans>Restore preview</Trans></h4>
      <p><Trans>Only the settings below will be restored. Your collections and credentials will not change. Export your current preferences first if you want to keep a copy.</Trans></p>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt><Trans>Palette</Trans></dt><dd>{preview.settings.theme}</dd>
        <dt><Trans>Accent</Trans></dt><dd>{preview.settings.accent}</dd>
        <dt><Trans>Startup</Trans></dt><dd>{preview.settings.startup}</dd>
        <dt><Trans>Visualizer</Trans></dt><dd>{preview.settings.matrix}</dd>
        <dt><Trans>Player layout</Trans></dt><dd>{preview.settings.layout??t`Keep current layout`}</dd>
        <dt><Trans>Sound profile</Trans></dt><dd>{preview.settings.audioProfile}</dd>
        <dt><Trans id="Feed source choices">Feed source choices</Trans></dt><dd>{preview.version===2?preview.settings.feed.sources.length:t({id:'Keep current Feed choices',message:'Keep current Feed choices'})}</dd>
      </dl>
      <p><Trans id="Restoring Feed choices does not install extensions or contact sources. Refresh Feed explicitly when you want new results.">Restoring Feed choices does not install extensions or contact sources. Refresh Feed explicitly when you want new results.</Trans></p>
      <details><summary><Trans>Reader preferences</Trans></summary><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(preview.settings.reader,null,2)}</pre></details>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void apply()}><Trans>Apply preferences</Trans></button>
        <button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>setReview(null)}><Trans>Cancel restore</Trans></button>
      </div>
    </div>}
    {error&&<p role="alert">{error}</p>}
    {notice&&<p role="status">{notice}</p>}
  </section>;
}
