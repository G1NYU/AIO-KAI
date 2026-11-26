import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { archiveEntryCounts,capturePortableArchive,parsePortableArchive,PORTABLE_ARCHIVE_LIMIT,type ArchiveKind,type PortableArchive } from '@/lib/backup/archive';
import { supportsReading } from '@/lib/hosts/shell/reading';
import { supportsManagedBackups,listManagedBackups,saveManagedArchive,openManagedArchive,type ManagedBackupList,type ManagedBackup } from '@/lib/backup/managed-archive';
import { BACKUP_SCHEDULE_EVENT,configureSchedule,readBackupSchedule,writeBackupSchedule,type ScheduleOptions,type Cadence,type Retention } from '@/lib/backup/schedule';

export function PortableArchiveSettings({archive,onArchive}:{archive:PortableArchive|null;onArchive(value:PortableArchive|null):void}){
  const [busy,setBusy]=React.useState(false);
  const [managed,setManaged]=React.useState<ManagedBackupList|null>(null);
  const nativeAvailable=supportsManagedBackups();
  const [schedule,setSchedule]=React.useState(readBackupSchedule);
  React.useEffect(()=>{
    const refresh=()=>setSchedule(readBackupSchedule());
    window.addEventListener(BACKUP_SCHEDULE_EVENT,refresh);
    return ()=>window.removeEventListener(BACKUP_SCHEDULE_EVENT,refresh);
  },[]);
  const [progress,setProgress]=React.useState('');
  const [notice,setNotice]=React.useState('');
  const [error,setError]=React.useState('');
  const readerAvailable=supportsReading();
  const [omitManga,setOmitManga]=React.useState(false);
  const includeManga=readerAvailable&&!omitManga;
  const counts=React.useMemo(()=>archive?.entries.map(entry=>({entry,...archiveEntryCounts(entry)}))??[],[archive]);
  function activeReader(){return !!document.querySelector('[data-ui="tsugi-book-reader"], .tsugi-chapter-reader');}
  function label(kind:ArchiveKind){return kind==='preferences'?t`Preferences`:kind==='music'?t`Music collections`:kind==='books'?t`Book progress`:t`Manga progress`;}
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
    {readerAvailable?<label className="flex items-center gap-2"><input type="checkbox" checked={includeManga} disabled={busy} onChange={event=>setOmitManga(!event.target.checked)}/><Trans>Include manga progress</Trans></label>:<p><Trans>Manga progress is unavailable until the Reader runtime is set up. The archive will explicitly omit it.</Trans></p>}
    <div className="flex flex-wrap gap-2"><button className="tsugi-read-action" type="button" disabled={busy} onClick={()=>void download()}><Trans>Export portable backup</Trans></button>
      {nativeAvailable&&<button className="tsugi-read-action" type="button" disabled={busy} onClick={()=>void saveManaged()}><Trans>Save managed backup</Trans></button>}
    </div>
    <label className="min-w-0"><span><Trans>Open portable backup</Trans></span><input type="file" accept=".json,application/json" className="tsugi-read-input w-full min-w-0 max-w-full" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.target.value='';void load(file);}}/></label>
    {nativeAvailable&&<div className="space-y-3">
      <h4><Trans>Automatic backups</Trans></h4>
      <p><Trans>Opt in to metadata backups while Tsugi is open. They wait until the app is visible and no reader or settings dialog is open. Missed backups run at the next eligible check; no background service is installed.</Trans></p>
      <label><Trans>Backup frequency</Trans>
        <select className="tsugi-menu-select w-full" value={schedule.cadence} disabled={busy} onChange={event=>changeSchedule({cadence:event.target.value as Cadence})}>
          <option value="off">{t`Off`}</option><option value="daily">{t`Daily`}</option><option value="weekly">{t`Weekly`}</option>
        </select>
      </label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={schedule.includeManga} disabled={busy||(!readerAvailable&&!schedule.includeManga)} onChange={event=>changeSchedule({includeManga:event.target.checked})}/><Trans>Include manga in automatic backups</Trans></label>
      {schedule.includeManga&&!readerAvailable&&<p><Trans>Reader must be ready before an automatic backup can include manga.</Trans></p>}
      <label><Trans>Scheduled copy retention</Trans>
        <select className="tsugi-menu-select w-full" value={schedule.keep} disabled={busy} onChange={event=>changeSchedule({keep:Number(event.target.value) as Retention})}>
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
      <button className="tsugi-read-action" type="button" disabled={busy} onClick={()=>void refreshManaged()}><Trans>Refresh managed backups</Trans></button>
      {managed&&<><p className="break-all text-xs"><Trans>Folder</Trans>: {managed.folder}</p>
        <p><Trans>Saved copies</Trans>: {managed.backups.length} · {(managed.backups.reduce((sum,row)=>sum+row.bytes,0)/1048576).toFixed(2)} MiB</p>
        {!managed.backups.length&&<p><Trans>No managed backups saved yet.</Trans></p>}
        <div className="max-h-56 overflow-auto">{managed.backups.map(row=><div key={row.name} className="tsugi-read-row flex-wrap"><div className="min-w-0 flex-1"><span>{new Date(row.createdMs).toLocaleString()}</span><small className="block break-all">{row.name} · {row.name.startsWith('tsugi-auto-backup-')?t`Automatic`:t`Manual`} · {(row.bytes/1024).toFixed(1)} KiB</small></div><button className="tsugi-read-action" type="button" disabled={busy||!row.readable} onClick={()=>void openManaged(row)}><Trans>Open and verify</Trans></button></div>)}</div>
      </>}
    </div>}
    {busy&&<p role="status">{progress||t`Checking backup sections…`}</p>}
    {archive&&<div className="space-y-3">
      <h4><Trans>Portable backup preview</Trans></h4>
      <p><Trans>Created</Trans> · {new Date(archive.createdAt).toLocaleString()}</p>
      <p><Trans>All section schemas and digests verified. Nothing has been restored. Use the individual review buttons below to check local conflicts and explicitly apply each section. Export your current backup first; sections restore independently.</Trans></p>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        {counts.map(({entry,items,secondary})=><React.Fragment key={entry.kind}><dt>{label(entry.kind)}</dt><dd>{items}{secondary!==undefined?(entry.kind==='music'?t` collections / ${secondary} tracks`:t` titles / ${secondary} chapters`):''} · {Math.ceil(entry.bytes/1024)} KiB</dd></React.Fragment>)}
      </dl>
      {!archive.entries.some(entry=>entry.kind==='manga')&&<p><Trans>This archive does not contain manga progress.</Trans></p>}
      {archive.entries.some(entry=>entry.kind==='manga')&&!readerAvailable&&<p><Trans>Set up Reader before reviewing the manga section. The original source and title must be available.</Trans></p>}
      <button className="tsugi-read-action" type="button" onClick={()=>onArchive(null)}><Trans>Close portable backup</Trans></button>
    </div>}
    {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
  </section>;
}
