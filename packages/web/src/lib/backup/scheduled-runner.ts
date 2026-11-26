import { capturePortableArchive } from './archive';
import { saveScheduledArchive,supportsManagedBackups } from './managed-archive';
import { supportsReading } from '../hosts/shell/reading';
import { RESTORE_SESSION_KEY,RESTORE_SESSION_LOCK } from './restore-session';
import { beginAttempt,finishAttempt,readBackupSchedule,sameAttempt,scheduleIsDue,writeBackupSchedule } from './schedule';

let running=false;
function blocked(){
  if(document.visibilityState==='hidden'||document.querySelector('dialog[open], [data-ui="tsugi-book-reader"], .tsugi-chapter-reader'))return true;
  // An unfinished or unreadable restore record is not a consistent backup
  // baseline. Never rotate older copies while recovery remains unresolved.
  try{return localStorage.getItem(RESTORE_SESSION_KEY)!==null;}catch{return true;}
}
async function attemptScheduledBackup(){
  if(blocked())return;
  const state=readBackupSchedule();
  if(!scheduleIsDue(state,Date.now()))return;
  const started=beginAttempt(state,Date.now());
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
  }
}
export async function runScheduledBackup(){
  if(running||!supportsManagedBackups()||blocked()||!navigator.locks)return;
  if(!scheduleIsDue(readBackupSchedule(),Date.now()))return;
  running=true;
  try{
    // Use the same origin-wide lock as restore preparation and application.
    // A busy lock defers a due attempt without advancing its schedule.
    await navigator.locks.request(RESTORE_SESSION_LOCK,{ifAvailable:true},async lock=>{
      if(lock)await attemptScheduledBackup();
    });
  }catch{/* An unavailable lock service must not permit an unguarded backup. */}
  finally{running=false;}
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
