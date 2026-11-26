import React from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { MANGA_BACKUP_LIMIT,collectLocalManga,snapshotManga,parseMangaBackup,planMangaRestore,missingTitleSources,type MangaRestorePlan } from '@/lib/backup/manga';
import { readRequest,supportsReading } from '@/lib/hosts/shell/reading';
import { applyCategoryRestore,collectLocalCategories,planCategoryRestore,type CategoryRestorePlan } from '@/lib/backup/manga-categories';
import { reviewRestoreSection,runRestoreSection,type RestoreSectionReview } from '@/lib/backup/restore-session';
import { restoreSessionFeedback } from './restore-session-feedback';

export function MangaBackupSettings({archiveEntry,importOnly=false,importLabel}:{archiveEntry?:string;importOnly?:boolean;importLabel?:string}={}){
  const [preview,setPreview]=React.useState<MangaRestorePlan|null>(null);
  const [reconnect,setReconnect]=React.useState<ReturnType<typeof missingTitleSources>>([]);
  const [categoryPlan,setCategoryPlan]=React.useState<CategoryRestorePlan|null>(null);
  const [busy,setBusy]=React.useState(false);
  const [progress,setProgress]=React.useState('');
  const [notice,setNotice]=React.useState('');
  const [error,setError]=React.useState('');
  const [review,setReview]=React.useState<{entry?:string;session?:RestoreSectionReview}>({});
  const onProgress=(done:number,total:number)=>setProgress(t`Checking local manga: ${done} / ${total}`);
  const begin=()=>{setReconnect([]);setPreview(null);setCategoryPlan(null);setNotice('');setError('');setProgress('');setBusy(true);};
  function activeChapter(){return !!document.querySelector('.tsugi-chapter-reader');}
  async function download(){
    if(activeChapter()){setError(t`Close the current chapter before backing up manga progress.`);return;}
    begin();
    try{
      const local=await collectLocalManga(onProgress);
      const categories=await collectLocalCategories();
      const data=snapshotManga(local,categories.map(row=>row.name));
      const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));
      const anchor=document.createElement('a');anchor.href=url;anchor.download='tsugi-manga-progress.json';
      document.body.appendChild(anchor);anchor.click();anchor.remove();
      window.setTimeout(()=>URL.revokeObjectURL(url),1000);
      setNotice(t`Manga progress export requested. Keep a separate record of your trusted sources.`);
    }catch{setError(t`Could not back up all local manga. Check the Reader runtime and backup limits.`);}
    finally{setBusy(false);setProgress('');}
  }
  async function load(file:File|undefined,entry?:string){
    if(!file)return;
    if(activeChapter()){setError(t`Close the current chapter before reviewing a manga backup.`);return;}
    begin();
    try{
      const session=reviewRestoreSection('manga',entry);
      if(file.size>MANGA_BACKUP_LIMIT)throw Error('size');
      const data=parseMangaBackup(await file.text());
      const local=await collectLocalManga(onProgress);
      const categories=await collectLocalCategories();
      const chapters=planMangaRestore(data,local);
      const shelves=planCategoryRestore(data,local,categories);
      if(chapters.rows.some(row=>row.state==='missing')){
        const inventory=await readRequest<unknown>({kind:'sources'}).catch(()=>null);
        setReconnect(missingTitleSources(chapters,inventory));
      }
      setPreview(chapters);setCategoryPlan(shelves);setReview({entry,session});
    }catch(reason){setError(restoreSessionFeedback(reason)??t`Could not review this manga backup. No reading progress was changed.`);}
    finally{setBusy(false);setProgress('');}
  }
  async function apply(){
    if(!preview?.changes.length)return;
    if(activeChapter()){setError(t`Close the current chapter before restoring manga progress.`);return;}
    const changes=preview.changes;setPreview(null);setBusy(true);setError('');setNotice('');
    if(review.entry!==undefined)setCategoryPlan(null);
    let confirmed=0;
    const total=changes.reduce((sum,row)=>sum+row.changes.length,0);
    try{
      await runRestoreSection('manga',review.entry,review.session,async()=>{
        for(const row of changes){
          const result=await readRequest<{confirmed:number;total:number;complete:boolean}>({kind:'restore-manga-progress',...row});
          if(!Number.isInteger(result.confirmed)||result.confirmed<0||result.confirmed>row.changes.length||result.total!==row.changes.length)throw Error('result');
          confirmed+=result.confirmed;onProgress(confirmed,total);
          if(!result.complete||result.confirmed!==row.changes.length)throw Error('partial');
        }
      });
      setNotice(t`Restored progress or bookmarks for ${confirmed} chapters. Refresh your manga library to see the changes.`);
    }catch(reason){
      setError(restoreSessionFeedback(reason)??t`Restore stopped after ${confirmed} of ${total} chapter changes were confirmed. Some additional changes may have been committed. Refresh the library and preview the backup again before retrying.`);
    }finally{setBusy(false);setProgress('');}
  }
  async function applyCategories(){
    if(!categoryPlan||categoryPlan.blocked||(!categoryPlan.create.length&&!categoryPlan.assignments.length))return;
    if(activeChapter()){setError(t`Close the current chapter before restoring categories.`);return;}
    const plan=categoryPlan;setCategoryPlan(null);setBusy(true);setError('');setNotice('');
    if(review.entry!==undefined)setPreview(null);
    try{
      const result=await runRestoreSection('categories',review.entry,review.session,()=>applyCategoryRestore(plan),value=>value.complete);
      const {created,assigned,alreadyAssigned}=result;
      if(result.complete)setNotice(t`Created ${created} categories, added ${assigned} assignments, and kept ${alreadyAssigned} already assigned. Refresh your manga library.`);
      else setError(t`Category restore stopped after ${created} category creations and ${assigned} assignments were confirmed. Other changes may have committed; refresh and preview again.`);
    }catch(reason){setError(restoreSessionFeedback(reason)??t`Category restore could not be confirmed. Refresh the library and preview again.`);}
    finally{setBusy(false);}
  }
  if(!supportsReading())return null;
  const count=(state:MangaRestorePlan['rows'][number]['state'])=>preview?.rows.filter(row=>row.state===state).length??0;
  const total=preview?.changes.reduce((sum,row)=>sum+row.changes.length,0)??0;
  return <section className="tsugi-app-general" aria-label={importLabel??t`Manga progress backup`}>
    <h3>{importLabel??t`Manga progress backup`}</h3>
    <p><Trans>Save cached reading progress, bookmarks and category names without source URLs, credentials or chapter images. Add the same manga from its original trusted source before restoring. Restore only adds matched progress, categories and assignments. Existing shelves are kept, original shelf order and history timestamps are not restored.</Trans></p>
    {!importOnly&&<><button className="tsugi-read-action" type="button" disabled={busy} onClick={()=>void download()}><Trans>Export manga progress</Trans></button>
    <label className="min-w-0"><span><Trans>Preview manga progress restore</Trans></span><input type="file" accept=".json,application/json" className="tsugi-read-input w-full min-w-0 max-w-full" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.target.value='';void load(file);}}/></label></>}
    {busy&&<p role="status">{progress||t`Working with manga progress…`}</p>}
    {archiveEntry!==undefined&&<button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void load(new File([archiveEntry],'manga.json',{type:'application/json'}),archiveEntry)}>{importLabel??t`Review archived manga`}</button>}
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
      {reconnect.length>0&&<details>
        <summary><Trans id="Sources for missing titles">Sources for missing titles</Trans></summary>
        <ul>{reconnect.map(({id,titles,status})=><li key={id} className="tsugi-read-row flex-wrap">
          <span><Trans id="Source {id} · Titles: {titles}">Source {id} · Titles: {titles}</Trans></span>
          <small>{status==='installed'?t({id:'Source available. Re-add the original title.',message:'Source available. Re-add the original title.'}):
            status==='missing'?t({id:'Reconnect the original trusted source.',message:'Reconnect the original trusted source.'}):
            t({id:'Source availability could not be confirmed.',message:'Source availability could not be confirmed.'})}</small>
        </li>)}</ul>
      </details>}
      <div className="max-h-48 overflow-auto">{preview.rows.map(row=><div key={row.identity} className="tsugi-read-row"><span className="min-w-0 break-words">{row.title}{row.categoryNames.length>0&&<small className="block">{row.categoryNames.join(', ')}</small>}</span><small>{row.state==='ready'?t`Ready`:row.state==='missing'?t`Re-add original title`:row.state==='limit'?t`Over limit`:t`Unchanged`}</small></div>)}</div>
      <div className="flex flex-wrap gap-2"><button type="button" className="tsugi-read-action" disabled={busy||!total} onClick={()=>void apply()}><Trans>Restore matched manga progress</Trans></button><button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>{setPreview(null);setCategoryPlan(null);}}><Trans>Cancel manga restore</Trans></button></div>
    </div>}
    {categoryPlan&&<div className="space-y-3">
      <h4><Trans>Category restore preview</Trans></h4>
      <p><Trans>Exact category names are reused. Missing shelves can be created, including empty shelves. Assignments require an exact manga identity. Conflicting names are skipped.</Trans></p>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt><Trans>New shelves</Trans></dt><dd>{categoryPlan.create.length}</dd>
        <dt><Trans>Existing shelves reused</Trans></dt><dd>{categoryPlan.reuse.length}</dd>
        <dt><Trans>New assignments</Trans></dt><dd>{categoryPlan.assignments.length}</dd>
        <dt><Trans>Already assigned</Trans></dt><dd>{categoryPlan.alreadyAssigned}</dd>
        <dt><Trans>Unmatched assignments</Trans></dt><dd>{categoryPlan.unmatchedAssignments}</dd>
        <dt><Trans>Conflicting names</Trans></dt><dd>{categoryPlan.conflicts.length}</dd>
      </dl>
      {!!categoryPlan.create.length&&<p className="break-words"><Trans>New shelves</Trans>: {categoryPlan.create.join(', ')}</p>}
      {!!categoryPlan.conflicts.length&&<p className="break-words"><Trans>Skipped names</Trans>: {categoryPlan.conflicts.join(', ')}</p>}
      {categoryPlan.blocked&&<p role="alert"><Trans>The reviewed category merge exceeds its limits. Nothing will be restored by this action.</Trans></p>}
      <div className="flex flex-wrap gap-2"><button className="tsugi-read-action" type="button" disabled={busy||categoryPlan.blocked||(!categoryPlan.create.length&&!categoryPlan.assignments.length)} onClick={()=>void applyCategories()}><Trans>Restore matched categories</Trans></button><button className="tsugi-read-action" type="button" disabled={busy} onClick={()=>setCategoryPlan(null)}><Trans>Cancel category restore</Trans></button></div>
    </div>}
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  </section>;
}
