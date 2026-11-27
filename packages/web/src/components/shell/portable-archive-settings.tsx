import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { archiveEntryCounts,capturePortableArchive,parsePortableArchive,PORTABLE_ARCHIVE_LIMIT,type ArchiveKind,type PortableArchive } from '@/lib/backup/archive';
import { supportsReading } from '@/lib/hosts/shell/reading';
import { supportsManagedBackups,listManagedBackups,saveManagedArchive,openManagedArchive,type ManagedBackupList,type ManagedBackup } from '@/lib/backup/managed-archive';
import { BACKUP_SCHEDULE_EVENT,configureSchedule,readBackupSchedule,writeBackupSchedule,type ScheduleOptions,type Cadence,type Retention } from '@/lib/backup/schedule';
import { reviewRestoreSection,runRestoreSection,RESTORE_SESSION_EVENT,RESTORE_SESSION_KEY,finishRestoreSession,prepareRestoreSession,readRestoreSessionState,resumeRestoreSession,reviewRestoreRecovery,restoreSessionBusy,restoreSessionMatches,type RestoreStep } from '@/lib/backup/restore-session';
import { reviewMalManga, persist as persistMalManga } from '@/lib/backup/mal-manga';
import { restoreSessionFeedback } from './restore-session-feedback';

export function PortableArchiveSettings({archive,onArchive}:{archive:PortableArchive|null;onArchive(value:PortableArchive|null):void}){
  const [busy,setBusy]=React.useState(false);
  const [restoreState,setRestoreState]=React.useState(readRestoreSessionState);
  const [restoreBusy,setRestoreBusy]=React.useState(restoreSessionBusy);
  const [finishAcknowledged,setFinishAcknowledged]=React.useState(false);
  const operationBusy=busy||restoreBusy;
  const [managed,setManaged]=React.useState<ManagedBackupList|null>(null);
  const nativeAvailable=supportsManagedBackups();
  const [schedule,setSchedule]=React.useState(readBackupSchedule);
  React.useEffect(()=>{
    const refresh=()=>setSchedule(readBackupSchedule());
    window.addEventListener(BACKUP_SCHEDULE_EVENT,refresh);
    return ()=>window.removeEventListener(BACKUP_SCHEDULE_EVENT,refresh);
  },[]);
  React.useEffect(()=>{
    const refresh=()=>{setRestoreState(readRestoreSessionState());setRestoreBusy(restoreSessionBusy());setFinishAcknowledged(false);};
    const storage=(event:StorageEvent)=>{if(event.key===null||event.key===RESTORE_SESSION_KEY)refresh();};
    window.addEventListener(RESTORE_SESSION_EVENT,refresh);
    window.addEventListener('storage',storage);
    return ()=>{window.removeEventListener(RESTORE_SESSION_EVENT,refresh);window.removeEventListener('storage',storage);};
  },[]);
  const [progress,setProgress]=React.useState('');
  const [notice,setNotice]=React.useState('');
  const [error,setError]=React.useState('');
  const readerAvailable=supportsReading();
  const [omitManga,setOmitManga]=React.useState(false);
  const includeManga=readerAvailable&&!omitManga;
  const counts=React.useMemo(()=>archive?.entries.map(entry=>({entry,...archiveEntryCounts(entry)}))??[],[archive]);
  const bookFiles=counts.find(row=>row.entry.kind==='books')?.items??0;
  const readerSources=counts.find(row=>row.entry.kind==='manga')?.sourceCount??0;
  const musicMatches=counts.find(row=>row.entry.kind==='music')?.metadataOnly??0;
  const session=restoreState.kind==='ready'?restoreState.session:null;
  const matchingSession=React.useMemo(()=>!!session&&!!archive&&restoreSessionMatches(session,archive),[session,archive]);
  const malPayload=archive?.entries.find(entry=>entry.kind==='mal')?.payload;
  const [malReview,setMalReview]=React.useState<{
    merge:ReturnType<typeof reviewMalManga>; checkpoint:ReturnType<typeof reviewRestoreSection>; payload:string
  }|null>(null);
  const {added,assigned}=malReview?.merge??{added:0,assigned:0};
  async function restoreMal(){
    if(!malPayload||!matchingSession||operationBusy)return;
    setError('');setNotice('');setBusy(true);
    try{
      if(malReview?.payload!==malPayload){
        setMalReview({merge:reviewMalManga(malPayload),checkpoint:reviewRestoreSection('mal',malPayload),payload:malPayload});
      }else{
        const {merge,checkpoint}=malReview;
        await runRestoreSection('mal',malPayload,checkpoint,()=>persistMalManga(merge.current,merge.entries,merge.links));
        setNotice(t`MyAnimeList manga collection restored.`);setMalReview(null);
      }
    }catch(reason){setMalReview(null);setError(restoreSessionFeedback(reason)??t`Could not confirm the manga collection restore. Review the current collection before retrying.`);}
    finally{setBusy(false);}
  }
  function activeReader(){return !!document.querySelector('[data-ui="tsugi-book-reader"], .tsugi-chapter-reader');}
  function label(kind:ArchiveKind){return kind==='mal'?t`MyAnimeList manga collection`:kind==='preferences'?t`Preferences`:kind==='music'?t`Music collections`:kind==='books'?t`Book progress`:t`Manga progress`;}
  function stepLabel(kind:RestoreStep){return kind==='categories'?t`Manga categories`:label(kind);}
  async function prepareRestore(){
    if(!archive||operationBusy)return;
    setBusy(true);setError('');setNotice('');setProgress(t`Saving and verifying source and recovery copies…`);
    try{
      await prepareRestoreSession(archive);
      setNotice(t`Restore checkpoint prepared. Review each section immediately before applying its changes. Both managed copies will be kept.`);
    }catch(reason){setError(restoreSessionFeedback(reason)??t`Could not prepare a complete restore checkpoint. No restore action was started. Check managed storage and the selected sections.`);}
    finally{setBusy(false);setProgress('');}
  }
  async function reopenRestore(recovery:boolean){
    if(!session||operationBusy)return;
    onArchive(null);setBusy(true);setError('');setNotice('');setProgress(t`Verifying saved restore copies…`);
    try{
      const source=recovery?await reviewRestoreRecovery(session.id):await resumeRestoreSession(session.id);
      onArchive(source);
      setNotice(recovery?t`Earlier metadata is ready for review in a new checkpoint. Apply sections explicitly; existing merge and newer-progress protections still apply.`
        :t`Saved restore reopened. Review the current state of each section before retrying. No changes were applied automatically.`);
    }catch(reason){setError(restoreSessionFeedback(reason)??t`Could not reopen the saved restore. Existing copies and the restore record were kept.`);}
    finally{setBusy(false);setProgress('');}
  }
  async function finishRestore(){
    if(!finishAcknowledged||!restoreState.token||operationBusy)return;
    setBusy(true);setError('');setNotice('');
    try{
      await finishRestoreSession(restoreState.token);
      onArchive(null);setFinishAcknowledged(false);
      setNotice(t`Restore record finished. Library data and both managed copies were kept.`);
    }catch(reason){setError(restoreSessionFeedback(reason)??t`The restore record could not be cleared. Reopen Data & storage to check its current state.`);}
    finally{setBusy(false);}
  }
  async function capture(){
    return capturePortableArchive(includeManga,(kind,done,total)=>{
      const section=label(kind);
      setProgress(total?t`${section}: ${done} / ${total}`:section);
    });
  }
  async function download(){
    setNotice('');setError('');
    if(activeReader()){setError(t`Close the current book or chapter before exporting a portable backup.`);return;}
    setBusy(true);setProgress('');
    try{
      const data=await capture();
      const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));
      const anchor=document.createElement('a');
      anchor.href=url;anchor.download='tsugi-portable-'+data.createdAt.replace(/[:.]/g,'-')+'.json';
      document.body.appendChild(anchor);anchor.click();anchor.remove();
      window.setTimeout(()=>URL.revokeObjectURL(url),1000);
      setNotice(t`Portable backup export requested. Confirm that the file was saved before relying on it.`);
    }catch{setError(t`Could not export every selected section. No partial archive was produced. Check local storage, Reader availability and backup limits.`);}
    finally{setBusy(false);setProgress('');}
  }
  function changeSchedule(options:Partial<ScheduleOptions>){
    setError('');setNotice('');
    try{
      const current=readBackupSchedule();
      const next=configureSchedule(current,{cadence:current.cadence,includeManga:current.includeManga,keep:current.keep,...options},Date.now());
      writeBackupSchedule(next);
    }catch{setError(t`Could not save automatic backup preferences.`);}
  }
  async function refreshManaged(){
    setBusy(true);setError('');setNotice('');
    try{setManaged(await listManagedBackups());}
    catch{setManaged(null);setError(t`Could not list managed backups. Existing files were not changed.`);}
    finally{setBusy(false);}
  }
  async function saveManaged(){
    setError('');setNotice('');
    if(activeReader()){setError(t`Close the current book or chapter before saving a managed backup.`);return;}
    setBusy(true);setProgress('');
    try{
      const data=await capture();
      setProgress(t`Writing and verifying backup…`);
      const saved=await saveManagedArchive(data);
      const name=saved.name;
      setNotice(t`Managed backup written and verified: ${name}`);
      try{setManaged(await listManagedBackups());}
      catch{setManaged(null);setError(t`The backup was verified, but the history could not be refreshed.`);}
    }catch{setError(t`The managed backup could not be confirmed. Refresh the backup history before retrying.`);}
    finally{setBusy(false);setProgress('');}
  }
  async function openManaged(row:ManagedBackup){
    if(!row.readable)return;
    onArchive(null);setBusy(true);setError('');setNotice('');
    try{onArchive(await openManagedArchive(row.name));}
    catch{setError(t`Could not verify this managed backup. Nothing was restored.`);}
    finally{setBusy(false);}
  }
  async function load(file:File|undefined){
    if(!file)return;
    onArchive(null);setError('');setNotice('');setBusy(true);
    try{
      if(file.size>PORTABLE_ARCHIVE_LIMIT)throw Error('size');
      onArchive(parsePortableArchive(await file.text()));
    }catch{setError(t`Invalid, damaged or unsupported portable backup. Nothing was restored.`);}
    finally{setBusy(false);}
  }
  return <section className="tsugi-app-general" aria-label={t`Portable backup`}>
    <h3><Trans>Data &amp; storage</Trans></h3>
    <p><Trans>Export a single versioned backup of built-in preferences, saved music, and local book and manga progress. Every section has an integrity digest. Backups are private library metadata, not encrypted files. Credentials, source URLs, media files, imported Studio layouts and server-owned viewing history are not included.</Trans></p>
    {session&&<div className="space-y-3" aria-label={t`Restore checkpoint`}>
      <h4><Trans>Open restore checkpoint</Trans></h4>
      <p><Trans>Prepared</Trans> · {new Date(session.createdAt).toLocaleString()}</p>
      <p><Trans>Sections apply separately. A stopped action may have changed some records. Nothing resumes automatically. Reopen the saved restore and review each section before retrying.</Trans></p>
      <dl className="space-y-1 text-sm">{session.steps.map(step=><div key={step.kind} className="tsugi-read-row flex-wrap"><dt>{stepLabel(step.kind)}</dt><dd>{step.state==='done'?t`Reviewed changes confirmed`:step.state==='running'?(restoreBusy?t`In progress; outcome not yet confirmed`:t`Interrupted or unconfirmed`):step.state==='failed'?t`Stopped; review current state`:step.state==='unavailable'?t`Recovery copy unavailable`:t`Not applied`}</dd></div>)}</dl>
      <details><summary><Trans>Saved restore files</Trans></summary><dl className="space-y-2 text-xs"><dt><Trans>Incoming metadata</Trans></dt><dd className="break-all">{session.source.name}</dd><dt><Trans>Metadata before this restore</Trans></dt><dd className="break-all">{session.recovery.name}</dd></dl></details>
      <div className="flex flex-wrap gap-2"><button className="tsugi-read-action" type="button" disabled={operationBusy} onClick={()=>void reopenRestore(false)}><Trans>Resume saved restore</Trans></button><button className="tsugi-read-action" type="button" disabled={operationBusy} onClick={()=>void reopenRestore(true)}><Trans>Review recovery copy</Trans></button></div>
      <p><Trans>The recovery copy contains earlier portable metadata. Reviewing it prepares a new checkpoint for explicit per-section restore. Music and category merges remain additive, and newer reading progress is kept. This does not undo added collections, shelves or progress.</Trans></p>
    </div>}
    {restoreState.kind==='invalid'&&<p role="alert"><Trans>The saved restore record is damaged or unsupported. Review the managed backup history and your current library before clearing it. No restore will run from this record.</Trans></p>}
    {restoreState.kind==='unavailable'&&<p role="alert"><Trans>The restore record cannot be read. Allow local storage before importing or preparing a restore checkpoint.</Trans></p>}
    {(restoreState.kind==='ready'||restoreState.kind==='invalid')&&<div className="space-y-2">
      <label className="flex items-start gap-2"><input type="checkbox" checked={finishAcknowledged} disabled={operationBusy} onChange={event=>setFinishAcknowledged(event.target.checked)}/><Trans>I have reviewed the current state and want to finish this restore record.</Trans></label>
      <button className="tsugi-read-action" type="button" disabled={operationBusy||!finishAcknowledged} onClick={()=>void finishRestore()}>{restoreState.kind==='invalid'?t`Clear invalid restore record`:t`Finish restore record`}</button>
      <p><Trans>Finishing clears only this record. It keeps your current data and every managed copy, including any partial changes.</Trans></p>
    </div>}
    {readerAvailable?<label className="flex items-center gap-2"><input type="checkbox" checked={includeManga} disabled={operationBusy} onChange={event=>setOmitManga(!event.target.checked)}/><Trans>Include manga progress</Trans></label>:<p><Trans>Manga progress is unavailable until the Reader runtime is set up. The archive will explicitly omit it.</Trans></p>}
    <div className="flex flex-wrap gap-2"><button className="tsugi-read-action" type="button" disabled={operationBusy} onClick={()=>void download()}><Trans>Export portable backup</Trans></button>
      {nativeAvailable&&<button className="tsugi-read-action" type="button" disabled={operationBusy} onClick={()=>void saveManaged()}><Trans>Save managed backup</Trans></button>}
    </div>
    <label className="min-w-0"><span><Trans>Open portable backup</Trans></span><input type="file" accept=".json,application/json" className="tsugi-read-input w-full min-w-0 max-w-full" disabled={operationBusy} onChange={event=>{const file=event.target.files?.[0];event.target.value='';void load(file);}}/></label>
    {nativeAvailable&&<div className="space-y-3">
      <h4><Trans>Automatic backups</Trans></h4>
      <p><Trans>Opt in to metadata backups while Tsugi is open. They wait until the app is visible and no reader or settings dialog is open. Missed backups run at the next eligible check; no background service is installed.</Trans></p>
      <label><Trans>Backup frequency</Trans>
        <select className="tsugi-menu-select w-full" value={schedule.cadence} disabled={operationBusy} onChange={event=>changeSchedule({cadence:event.target.value as Cadence})}>
          <option value="off">{t`Off`}</option><option value="daily">{t`Daily`}</option><option value="weekly">{t`Weekly`}</option>
        </select>
      </label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={schedule.includeManga} disabled={operationBusy||(!readerAvailable&&!schedule.includeManga)} onChange={event=>changeSchedule({includeManga:event.target.checked})}/><Trans>Include manga in automatic backups</Trans></label>
      {schedule.includeManga&&!readerAvailable&&<p><Trans>Reader must be ready before an automatic backup can include manga.</Trans></p>}
      <label><Trans>Scheduled copy retention</Trans>
        <select className="tsugi-menu-select w-full" value={schedule.keep} disabled={operationBusy} onChange={event=>changeSchedule({keep:Number(event.target.value) as Retention})}>
          <option value={0}>{t`Keep all copies (no deletion)`}</option>
          {[3,7,14,30].map(count=><option key={count} value={count}>{count}</option>)}
        </select>
      </label>
      <p><Trans>A numeric limit deletes older verified automatic copies only after a new copy is verified. Manual copies and damaged files are never automatically removed. The managed folder has a 500-file safety limit.</Trans></p>
      {schedule.cadence!=='off'&&<p><Trans>Next due</Trans>: {new Date(schedule.dueMs).toLocaleString()}</p>}
      {schedule.lastVerifiedMs!==null&&<p><Trans>Last verified automatic backup</Trans>: {new Date(schedule.lastVerifiedMs).toLocaleString()}</p>}
      {schedule.lastAttemptMs!==null&&<p><Trans>Last attempt</Trans>: {new Date(schedule.lastAttemptMs).toLocaleString()} · {schedule.result==='saved'?t`Verified`:schedule.result==='retention-warning'?t`Verified; retention incomplete`:schedule.result==='failed'?t`Failed; retry scheduled`:schedule.result==='running'?t`In progress or interrupted`:t`Not yet verified`}</p>}
      <h4><Trans>Managed backup history</Trans></h4>
      <p><Trans>Managed copies are written into the app's backup folder and reopened for verification before success is reported. Export a separate copy to another drive for protection against disk loss.</Trans></p>
      <button className="tsugi-read-action" type="button" disabled={operationBusy} onClick={()=>void refreshManaged()}><Trans>Refresh managed backups</Trans></button>
      {managed&&<><p className="break-all text-xs"><Trans>Folder</Trans>: {managed.folder}</p>
        <p><Trans>Saved copies</Trans>: {managed.backups.length} · {(managed.backups.reduce((sum,row)=>sum+row.bytes,0)/1048576).toFixed(2)} MiB</p>
        {!managed.backups.length&&<p><Trans>No managed backups saved yet.</Trans></p>}
        <div className="max-h-56 overflow-auto">{managed.backups.map(row=><div key={row.name} className="tsugi-read-row flex-wrap"><div className="min-w-0 flex-1"><span>{new Date(row.createdMs).toLocaleString()}</span><small className="block break-all">{row.name} · {row.name.startsWith('tsugi-auto-backup-')?t`Automatic`:t`Manual`} · {(row.bytes/1024).toFixed(1)} KiB</small></div><button className="tsugi-read-action" type="button" disabled={operationBusy||!row.readable} onClick={()=>void openManaged(row)}><Trans>Open and verify</Trans></button></div>)}</div>
      </>}
    </div>}
    {busy&&<p role="status">{progress||t`Checking backup sections…`}</p>}
    {archive&&<div className="space-y-3">
      <h4><Trans>Portable backup preview</Trans></h4>
      <p><Trans>Created</Trans> · {new Date(archive.createdAt).toLocaleString()}</p>
      <p><Trans>All section schemas and digests verified. Opening an archive does not restore it. Prepare a checkpoint, then use the individual review buttons below to check local conflicts and explicitly apply each section. A new restore action invalidates earlier reviews.</Trans></p>
      {restoreState.kind==='empty'&&<><p><Trans>Preparing saves and verifies the incoming archive and a portable snapshot of your current metadata before any restore is allowed. Both copies remain in managed backup history.</Trans></p><button className="tsugi-read-action" type="button" disabled={operationBusy||!nativeAvailable} onClick={()=>void prepareRestore()}><Trans>Prepare restore checkpoint</Trans></button>{!nativeAvailable&&<p><Trans>Archived section restore requires the Windows managed backup store. Standalone section files remain available in other hosts.</Trans></p>}</>}
      {session&&!matchingSession&&<p><Trans>This open archive does not match the restore checkpoint. Resume the saved restore, or finish its record before preparing another archive.</Trans></p>}
      {matchingSession&&<p><Trans>This archive matches the saved checkpoint. Review a section immediately before applying it.</Trans></p>}
      <dl className="grid grid-cols-2 gap-2 text-sm">
        {counts.map(({entry,items,secondary})=><React.Fragment key={entry.kind}><dt>{label(entry.kind)}</dt><dd>{items}{secondary!==undefined?(entry.kind==='music'?t` collections / ${secondary} tracks`:t` titles / ${secondary} chapters`):''} · {Math.ceil(entry.bytes/1024)} KiB</dd></React.Fragment>)}
      </dl>
      {(bookFiles>0||readerSources>0||musicMatches>0)&&<div className="space-y-2">
        <h4><Trans id="Restoring on another device">Restoring on another device</Trans></h4>
        {bookFiles>0&&<p><Trans id="Original book files to reimport: {bookFiles}. Progress is matched by file contents.">Original book files to reimport: {bookFiles}. Progress is matched by file contents.</Trans></p>}
        {readerSources>0&&<p><Trans id="Reader sources represented: {readerSources}. Reconnect the original trusted sources and add the matching titles before reviewing manga progress.">Reader sources represented: {readerSources}. Reconnect the original trusted sources and add the matching titles before reviewing manga progress.</Trans></p>}
        {musicMatches>0&&<p><Trans id="Music entries saved as metadata only: {musicMatches}. Connect a music source to find playable matches.">Music entries saved as metadata only: {musicMatches}. Connect a music source to find playable matches.</Trans></p>}
      </div>}
      {matchingSession&&malPayload&&<div className="space-y-2">
        {malReview?.payload===malPayload&&<p>{t`Add ${added} manga entries and ${assigned} source assignments. Existing entries and assignments are kept.`}</p>}
        <button className="tsugi-read-action" type="button" disabled={operationBusy} onClick={()=>void restoreMal()}>{malReview?.payload===malPayload?t`Apply reviewed manga collection`:t`Review MyAnimeList manga collection`}</button>
      </div>}
      {!archive.entries.some(entry=>entry.kind==='manga')&&<p><Trans>This archive does not contain manga progress.</Trans></p>}
      {archive.entries.some(entry=>entry.kind==='manga')&&!readerAvailable&&<p><Trans>Set up Reader before reviewing the manga section. The original source and title must be available.</Trans></p>}
      <button className="tsugi-read-action" type="button" disabled={operationBusy} onClick={()=>onArchive(null)}><Trans>Close portable backup</Trans></button>
    </div>}
    {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
  </section>;
}
