import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { archiveEntryCounts,capturePortableArchive,parsePortableArchive,PORTABLE_ARCHIVE_LIMIT,type ArchiveKind,type PortableArchive } from '@/lib/backup/archive';
import { supportsReading } from '@/lib/hosts/shell/reading';

export function PortableArchiveSettings({archive,onArchive}:{archive:PortableArchive|null;onArchive(value:PortableArchive|null):void}){
  const [busy,setBusy]=React.useState(false);
  const [progress,setProgress]=React.useState('');
  const [notice,setNotice]=React.useState('');
  const [error,setError]=React.useState('');
  const readerAvailable=supportsReading();
  const [omitManga,setOmitManga]=React.useState(false);
  const includeManga=readerAvailable&&!omitManga;
  const counts=React.useMemo(()=>archive?.entries.map(entry=>({entry,...archiveEntryCounts(entry)}))??[],[archive]);
  function activeReader(){return !!document.querySelector('[data-ui="tsugi-book-reader"], .tsugi-chapter-reader');}
  function label(kind:ArchiveKind){return kind==='preferences'?t`Preferences`:kind==='music'?t`Music collections`:kind==='books'?t`Book progress`:t`Manga progress`;}
  async function download(){
    setNotice('');setError('');
    if(activeReader()){setError(t`Close the current book or chapter before exporting a portable backup.`);return;}
    setBusy(true);setProgress('');
    try{
      const data=await capturePortableArchive(includeManga,(kind,done,total)=>setProgress(total?t`${label(kind)}: ${done} / ${total}`:label(kind)));
      const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));
      const anchor=document.createElement('a');
      anchor.href=url;anchor.download='tsugi-portable-'+data.createdAt.replace(/[:.]/g,'-')+'.json';
      document.body.appendChild(anchor);anchor.click();anchor.remove();
      window.setTimeout(()=>URL.revokeObjectURL(url),1000);
      setNotice(t`Portable backup export requested. Confirm that the file was saved before relying on it.`);
    }catch{setError(t`Could not export every selected section. No partial archive was produced. Check local storage, Reader availability and backup limits.`);}
    finally{setBusy(false);setProgress('');}
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
    <button className="tsugi-read-action" type="button" disabled={busy} onClick={()=>void download()}><Trans>Export portable backup</Trans></button>
    <label className="min-w-0"><span><Trans>Open portable backup</Trans></span><input type="file" accept=".json,application/json" className="tsugi-read-input w-full min-w-0 max-w-full" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.target.value='';void load(file);}}/></label>
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
