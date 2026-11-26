import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { BOOK_BACKUP_LIMIT,captureBookBackup,parseBookBackup,previewBookRestore,type BookRestorePlan } from '@/lib/backup/books';
import { restoreBookMetadata } from '@/app/read/book-library';

export function BookBackupSettings({archiveEntry}:{archiveEntry?:string}={}){
  const [preview,setPreview]=React.useState<BookRestorePlan|null>(null);
  const [busy,setBusy]=React.useState(false);
  const [progress,setProgress]=React.useState('');
  const [notice,setNotice]=React.useState('');
  const [error,setError]=React.useState('');
  const onProgress=(done:number,total:number)=>setProgress(t`Checking local books: ${done} / ${total}`);
  const begin=()=>{setPreview(null);setProgress('');setNotice('');setError('');setBusy(true);};
  function activeBook(){return !!document.querySelector('[data-ui="tsugi-book-reader"]');}
  async function download(){
    if(activeBook()){setError(t`Close the current book before backing up reading progress.`);return;}
    begin();
    try{
      const data=await captureBookBackup(onProgress);
      const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));
      const anchor=document.createElement('a');
      anchor.href=url;anchor.download='tsugi-book-progress.json';
      document.body.appendChild(anchor);anchor.click();anchor.remove();
      window.setTimeout(()=>URL.revokeObjectURL(url),1000);
      setNotice(t`Book progress export requested. Keep the original EPUB and PDF files separately.`);
    }catch{setError(t`Could not back up all book metadata. Check local files, storage and backup limits.`);}
    finally{setBusy(false);setProgress('');}
  }
  async function load(file:File|undefined){
    if(!file)return;
    begin();
    try{
      if(file.size>BOOK_BACKUP_LIMIT)throw new Error('size');
      const backup=parseBookBackup(await file.text());
      setPreview(await previewBookRestore(backup,onProgress));
    }catch{setError(t`Could not review this book backup. No reading progress was changed.`);}
    finally{setBusy(false);setProgress('');}
  }
  async function apply(){
    if(!preview||!preview.changes.length)return;
    if(activeBook()){setError(t`Close the current book before restoring progress.`);return;}
    setBusy(true);setError('');setNotice('');
    try{
      await restoreBookMetadata(preview.changes);
      setPreview(null);window.dispatchEvent(new Event('tsugi-book-metadata-restored'));
      setNotice(t`Matched book metadata and progress restored. Existing files were not replaced.`);
    }catch{setPreview(null);setError(t`The book library changed or storage rejected the restore. Nothing was committed. Preview the backup again.`);}
    finally{setBusy(false);}
  }
  const count=(state:BookRestorePlan['rows'][number]['state'])=>preview?.rows.filter(row=>row.state===state).length??0;
  return <section className="tsugi-app-general" aria-label={t`Book progress backup`}>
    <h3><Trans>Book progress backup</Trans></h3>
    <p><Trans>Save EPUB and PDF titles and reading positions, without copying book files. Reimport your original books before restoring. Tsugi verifies file contents, not filenames, and never replaces a newer reading position.</Trans></p>
    <button className="tsugi-read-action" type="button" disabled={busy} onClick={()=>void download()}><Trans>Export book progress</Trans></button>
    <label className="min-w-0"><span><Trans>Preview book progress restore</Trans></span>
      <input type="file" accept=".json,application/json" className="tsugi-read-input w-full min-w-0 max-w-full" disabled={busy} onChange={event=>{
        const file=event.target.files?.[0];event.target.value='';void load(file);
      }}/>
    </label>
    {busy&&<p role="status">{progress||t`Working with book metadata…`}</p>}
    {archiveEntry!==undefined&&<button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void load(new File([archiveEntry],'books.json',{type:'application/json'}))}><Trans>Review archived books</Trans></button>}
    {preview&&<div className="space-y-3">
      <h4><Trans>Book restore preview</Trans></h4>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt><Trans>Ready to restore</Trans></dt><dd>{count('ready')}</dd>
        <dt><Trans>Missing original files</Trans></dt><dd>{count('missing')}</dd>
        <dt><Trans>Ambiguous matches</Trans></dt><dd>{count('ambiguous')}</dd>
        <dt><Trans>Newer local progress kept</Trans></dt><dd>{count('newer')}</dd>
        <dt><Trans>Conflicts kept locally</Trans></dt><dd>{count('conflict')}</dd>
        <dt><Trans>Already up to date</Trans></dt><dd>{count('unchanged')}</dd>
      </dl>
      <div className="max-h-48 overflow-auto">
        {preview.rows.map(row=><div key={row.id} className="tsugi-read-row"><span className="min-w-0 break-words">{row.title}</span><small>{row.state==='ready'?t`Ready`:row.state==='missing'?t`Reimport original file`:row.state==='ambiguous'?t`Ambiguous`:row.state==='newer'?t`Newer local progress`:row.state==='conflict'?t`Conflict`:t`Unchanged`}{row.titleConflict?t` · Local title kept`:''}{row.progressKept&&row.state==='ready'?t` · Local progress kept`:''}</small></div>)}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="tsugi-read-action" disabled={busy||!preview.changes.length} onClick={()=>void apply()}><Trans>Restore matched book progress</Trans></button>
        <button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>setPreview(null)}><Trans>Cancel book restore</Trans></button>
      </div>
    </div>}
    {error&&<p role="alert">{error}</p>}
    {notice&&<p role="status">{notice}</p>}
  </section>;
}
