import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { applyPreferencesBackup, capturePreferencesBackup, MAX_PREFERENCES_BACKUP_BYTES, parsePreferencesBackup, type PreferencesBackup } from '@/lib/backup/preferences';

export function PreferencesBackupSettings({onApplied}:{onApplied():void}) {
  const [preview,setPreview]=React.useState<PreferencesBackup|null>(null);
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
  async function load(file:File|undefined) {
    setPreview(null);setNotice('');setError('');
    if(!file)return;
    setBusy(true);
    try {
      if(file.size>MAX_PREFERENCES_BACKUP_BYTES)throw new Error('size');
      setPreview(parsePreferencesBackup(await file.text()));
    } catch {setError(t`Invalid or unsupported Tsugi preferences file. Nothing was changed.`);}
    finally {setBusy(false);}
  }
  function apply() {
    if(!preview)return;
    setError('');setNotice('');
    const outcome=applyPreferencesBackup(preview);
    if(outcome==='applied'){
      setPreview(null);onApplied();
      setNotice(t`Preferences restored. Reopen the reader or player, or restart Tsugi if necessary, to apply every setting.`);
    } else {
      setError(outcome==='rollback-failed'
        ?t`Storage blocked recovery. Some preferences may have changed. Export or review the current settings before retrying.`
        :t`Could not restore preferences. Previous values were retained.`);
    }
  }
  return <section className="tsugi-app-general" aria-label={t`Preferences backup`}>
    <h3><Trans>Data &amp; storage</Trans></h3>
    <p><Trans>Back up built-in appearance, startup, visualizer, sound profile and reader preferences. This is a preferences file only: libraries, downloads, credentials, source URLs and custom Studio layouts are not included.</Trans></p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className="tsugi-read-action" disabled={busy} onClick={download}><Trans>Export preferences</Trans></button>
      <label className="min-w-0"><span><Trans>Preview preferences restore</Trans></span>
        <input type="file" accept=".json,application/json" className="tsugi-read-input w-full" disabled={busy} onChange={event=>{
          const file=event.target.files?.[0];event.target.value='';void load(file);
        }}/>
      </label>
    </div>
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
      </dl>
      <details><summary><Trans>Reader preferences</Trans></summary><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(preview.settings.reader,null,2)}</pre></details>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="tsugi-read-action" onClick={apply}><Trans>Apply preferences</Trans></button>
        <button type="button" className="tsugi-read-action" onClick={()=>setPreview(null)}><Trans>Cancel restore</Trans></button>
      </div>
    </div>}
    {error&&<p role="alert">{error}</p>}
    {notice&&<p role="status">{notice}</p>}
  </section>;
}
