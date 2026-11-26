import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { applyMusicMerge, captureMusicBackup, parseMusicBackup, previewMusicMerge, MUSIC_BACKUP_LIMIT, type MusicBackup } from '@/lib/backup/music';

export function MusicBackupSettings(){
  const [backup,setBackup]=React.useState<MusicBackup|null>(null);
  const [preview,setPreview]=React.useState<ReturnType<typeof previewMusicMerge>|null>(null);
  const [notice,setNotice]=React.useState('');
  const [error,setError]=React.useState('');
  const [busy,setBusy]=React.useState(false);
  function download(){
    setNotice('');setError('');
    try{
      const data=captureMusicBackup();
      const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));
      const anchor=document.createElement('a');
      anchor.href=url;anchor.download='tsugi-music-library.json';
      document.body.appendChild(anchor);anchor.click();anchor.remove();
      window.setTimeout(()=>URL.revokeObjectURL(url),1000);
      setNotice(t`Music backup export requested. Check your downloads.`);
    }catch{setError(t`Could not export the entire music library. Storage or metadata may be invalid, or the backup exceeds the size limit.`);}
  }
  async function load(file:File|undefined){
    setBackup(null);setPreview(null);setError('');setNotice('');
    if(!file)return;
    setBusy(true);
    try{
      if(file.size>MUSIC_BACKUP_LIMIT)throw new Error('size');
      const data=parseMusicBackup(await file.text());
      const plan=previewMusicMerge(data);
      setBackup(data);setPreview(plan);
    }catch{setError(t`Invalid music backup or local library. Nothing was changed.`);}
    finally{setBusy(false);}
  }
  function apply(){
    if(!backup||!preview)return;
    setError('');setNotice('');
    const outcome=applyMusicMerge(backup,preview.baseline);
    if(outcome==='applied'){
      setBackup(null);setPreview(null);
      window.dispatchEvent(new Event('tsugi-music-library-restored'));
      setNotice(t`Music library merged. Existing collections and tracks were retained.`);
    }else if(outcome==='stale'){
      setBackup(null);setPreview(null);
      setError(t`The library changed since preview. Open the backup again to review the new merge.`);
    }else setError(t`The merge could not be saved. No library data was removed. Check conflicts, capacity and available storage.`);
  }
  return <section className="tsugi-app-general" aria-label={t`Music library backup`}>
    <h3><Trans>Music library backup</Trans></h3>
    <p><Trans>Export saved tracks and collections in order, then merge into an existing or fresh library. Audio files, artwork URLs, credentials and private addon identifiers are excluded. Non-native tracks may need to be matched by title and artist after reconnecting a source.</Trans></p>
    <button type="button" className="tsugi-read-action" disabled={busy} onClick={download}><Trans>Export music library</Trans></button>
    <label className="min-w-0"><span><Trans>Preview music library restore</Trans></span>
      <input type="file" accept=".json,application/json" className="tsugi-read-input w-full min-w-0 max-w-full" disabled={busy} onChange={event=>{
        const file=event.target.files?.[0];event.target.value='';void load(file);
      }}/>
    </label>
    {preview&&<div className="space-y-3">
      <h4><Trans>Music restore preview</Trans></h4>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt><Trans>New collections</Trans></dt><dd>{preview.addedLists}</dd>
        <dt><Trans>New tracks</Trans></dt><dd>{preview.addedTracks}</dd>
        <dt><Trans>Already present</Trans></dt><dd>{preview.duplicates}</dd>
        <dt><Trans>Conflicting collections</Trans></dt><dd>{preview.conflicts}</dd>
        <dt><Trans>Metadata-only tracks in backup</Trans></dt><dd>{preview.metadataOnly}</dd>
      </dl>
      {preview.blocked&&<p role="alert"><Trans>The combined library exceeds its storage limits.</Trans></p>}
      {!!preview.conflicts&&<p role="alert"><Trans>Collection identity conflicts must be resolved before merging.</Trans></p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="tsugi-read-action" disabled={preview.blocked||!!preview.conflicts} onClick={apply}><Trans>Merge music library</Trans></button>
        <button type="button" className="tsugi-read-action" onClick={()=>{setBackup(null);setPreview(null);}}><Trans>Cancel music restore</Trans></button>
      </div>
    </div>}
    {error&&<p role="alert">{error}</p>}
    {notice&&<p role="status">{notice}</p>}
  </section>;
}
