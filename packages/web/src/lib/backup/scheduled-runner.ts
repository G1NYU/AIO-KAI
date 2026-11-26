import { capturePortableArchive } from './archive';
import { saveScheduledArchive,supportsManagedBackups } from './managed-archive';
import { supportsReading } from '../hosts/shell/reading';
import { beginAttempt,finishAttempt,readBackupSchedule,sameAttempt,scheduleIsDue,writeBackupSchedule } from './schedule';

let running=false;
function blocked(){
  return document.visibilityState==='hidden'||!!document.querySelector('dialog[open], [data-ui="tsugi-book-reader"], .tsugi-chapter-reader');
}
export async function runScheduledBackup(){
  if(running||!supportsManagedBackups()||blocked())return;
  const state=readBackupSchedule();
  if(!scheduleIsDue(state,Date.now()))return;
  const started=beginAttempt(state,Date.now());
  running=true;
  try{
    writeBackupSchedule(started);
    if(started.includeManga&&!supportsReading())throw Error('reader-unavailable');
    const archive=await capturePortableArchive(started.includeManga);
    // Opening Settings or changing the policy during capture prevents the
    // pending write/retention. The next eligible check can retry.
    if(!sameAttempt(readBackupSchedule(),started))return;
    if(blocked())throw Error('backup-deferred');
    const result=await saveScheduledArchive(archive,started.keep);
    if(sameAttempt(readBackupSchedule(),started))
      writeBackupSchedule(finishAttempt(started,Date.now(),result.retentionIncomplete?'retention-warning':'saved'));
  }catch{
    try{
      if(sameAttempt(readBackupSchedule(),started))
        writeBackupSchedule(finishAttempt(started,Date.now(),'failed'));
    }catch{/* Blocked storage cannot safely retain or start another policy. */}
  }finally{running=false;}
}
export function startScheduledBackups(){
  if(!supportsManagedBackups())return;
  const check=()=>{void runScheduledBackup();};
  const timer=window.setInterval(check,30_000);
  window.addEventListener('focus',check);
  document.addEventListener('visibilitychange',check);
  check();
  return ()=>{
    window.clearInterval(timer);
    window.removeEventListener('focus',check);
    document.removeEventListener('visibilitychange',check);
  };
}
