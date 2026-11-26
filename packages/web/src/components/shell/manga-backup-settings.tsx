import React from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { MANGA_BACKUP_LIMIT,collectLocalManga,snapshotManga,parseMangaBackup,planMangaRestore,type MangaRestorePlan } from '@/lib/backup/manga';
import { readRequest,supportsReading } from '@/lib/hosts/shell/reading';

export function MangaBackupSettings({archiveEntry}:{archiveEntry?:string}={}){
  const [preview,setPreview]=React.useState<MangaRestorePlan|null>(null);
  const [busy,setBusy]=React.useState(false);
  const [progress,setProgress]=React.useState('');
  const [notice,setNotice]=React.useState('');
  const [error,setError]=React.useState('');
  const onProgress=(done:number,total:number)=>setProgress(t`Checking local manga: ${done} / ${total}`);
  const begin=()=>{setPreview(null);setNotice('');setError('');setProgress('');setBusy(true);};
  function activeChapter(){return !!document.querySelector('.tsugi-chapter-reader');}
  async function download(){
    if(activeChapter()){setError(t`Close the current chapter before backing up manga progress.`);return;}
    begin();
    try{
      const data=snapshotManga(await collectLocalManga(onProgress));
      const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));
      const anchor=document.createElement('a');anchor.href=url;anchor.download='tsugi-manga-progress.json';
      document.body.appendChild(anchor);anchor.click();anchor.remove();
      window.setTimeout(()=>URL.revokeObjectURL(url),1000);
      setNotice(t`Manga progress export requested. Keep a separate record of your trusted sources.`);
    }catch{setError(t`Could not back up all local manga. Check the Reader runtime and backup limits.`);}
    finally{setBusy(false);setProgress('');}
  }
  async function load(file:File|undefined){
    if(!file)return;
    if(activeChapter()){setError(t`Close the current chapter before reviewing a manga backup.`);return;}
    begin();
    try{
      if(file.size>MANGA_BACKUP_LIMIT)throw Error('size');
      const data=parseMangaBackup(await file.text());
      setPreview(planMangaRestore(data,await collectLocalManga(onProgress)));
    }catch{setError(t`Could not review this manga backup. No reading progress was changed.`);}
    finally{setBusy(false);setProgress('');}
  }
  async function apply(){
    if(!preview?.changes.length)return;
    if(activeChapter()){setError(t`Close the current chapter before restoring manga progress.`);return;}
    const changes=preview.changes;setPreview(null);setBusy(true);setError('');setNotice('');
    let confirmed=0;
    const total=changes.reduce((sum,row)=>sum+row.changes.length,0);
    try{
      for(const row of changes){
        const result=await readRequest<{confirmed:number;total:number;complete:boolean}>({kind:'restore-manga-progress',...row});
        if(!Number.isInteger(result.confirmed)||result.confirmed<0||result.confirmed>row.changes.length||result.total!==row.changes.length)throw Error('result');
        confirmed+=result.confirmed;onProgress(confirmed,total);
        if(!result.complete||result.confirmed!==row.changes.length)throw Error('partial');
      }
      setNotice(t`Restored progress or bookmarks for ${confirmed} chapters. Refresh your manga library to see the changes.`);
    }catch{
      setError(t`Restore stopped after ${confirmed} of ${total} chapter changes were confirmed. Some additional changes may have been committed. Refresh the library and preview the backup again before retrying.`);
    }finally{setBusy(false);setProgress('');}
  }
  if(!supportsReading())return null;
  const count=(state:MangaRestorePlan['rows'][number]['state'])=>preview?.rows.filter(row=>row.state===state).length??0;
  const total=preview?.changes.reduce((sum,row)=>sum+row.changes.length,0)??0;
  return <section className="tsugi-app-general" aria-label={t`Manga progress backup`}>
    <h3><Trans>Manga progress backup</Trans></h3>
    <p><Trans>Save cached reading progress, bookmarks and category names without source URLs, credentials or chapter images. Add the same manga from its original trusted source before restoring. This merge only adds matched progress; category names are a reference, and original history timestamps are not restored.</Trans></p>
    <button className="tsugi-read-action" type="button" disabled={busy} onClick={()=>void download()}><Trans>Export manga progress</Trans></button>
    <label className="min-w-0"><span><Trans>Preview manga progress restore</Trans></span><input type="file" accept=".json,application/json" className="tsugi-read-input w-full min-w-0 max-w-full" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.target.value='';void load(file);}}/></label>
    {busy&&<p role="status">{progress||t`Working with manga progress…`}</p>}
    {archiveEntry!==undefined&&<button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void load(new File([archiveEntry],'manga.json',{type:'application/json'}))}><Trans>Review archived manga</Trans></button>}
    {preview&&<div className="space-y-3">
      <h4><Trans>Manga restore preview</Trans></h4>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt><Trans>Titles ready</Trans></dt><dd>{count('ready')}</dd>
        <dt><Trans>Missing titles</Trans></dt><dd>{count('missing')}</dd>
        <dt><Trans>Unchanged titles</Trans></dt><dd>{count('unchanged')}</dd>
        <dt><Trans>Titles over restore limit</Trans></dt><dd>{count('limit')}</dd>
        <dt><Trans>Chapter changes</Trans></dt><dd>{total}</dd>
        <dt><Trans>Unmatched chapters</Trans></dt><dd>{preview.rows.reduce((sum,row)=>sum+row.unmatched,0)}</dd>
        <dt><Trans>Newer or incompatible positions kept</Trans></dt><dd>{preview.rows.reduce((sum,row)=>sum+row.kept,0)}</dd>
      </dl>
      <div className="max-h-48 overflow-auto">{preview.rows.map(row=><div key={row.identity} className="tsugi-read-row"><span className="min-w-0 break-words">{row.title}{row.categoryNames.length>0&&<small className="block">{row.categoryNames.join(', ')}</small>}</span><small>{row.state==='ready'?t`Ready`:row.state==='missing'?t`Re-add original title`:row.state==='limit'?t`Over limit`:t`Unchanged`}</small></div>)}</div>
      <div className="flex flex-wrap gap-2"><button type="button" className="tsugi-read-action" disabled={busy||!total} onClick={()=>void apply()}><Trans>Restore matched manga progress</Trans></button><button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>setPreview(null)}><Trans>Cancel manga restore</Trans></button></div>
    </div>}
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  </section>;
}
