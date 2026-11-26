// Automatic metadata backups are opt-in and run only while the app is open.
export const BACKUP_SCHEDULE_KEY='tsugi-backup-schedule-v1';
export const BACKUP_SCHEDULE_EVENT='tsugi-backup-schedule-change';
export type Cadence='off'|'daily'|'weekly';
export type Retention=0|3|7|14|30;
export type ScheduleResult='never'|'running'|'saved'|'retention-warning'|'failed';
export type BackupSchedule={
  version:1;cadence:Cadence;includeManga:boolean;keep:Retention;
  dueMs:number;lastAttemptMs:number|null;lastVerifiedMs:number|null;result:ScheduleResult;
};
export type ScheduleOptions=Pick<BackupSchedule,'cadence'|'includeManga'|'keep'>;
const DAY=86_400_000;
const RETRY=3_600_000;
export function defaultSchedule():BackupSchedule{
  return {version:1,cadence:'off',includeManga:false,keep:0,dueMs:0,lastAttemptMs:null,lastVerifiedMs:null,result:'never'};
}
function timestamp(value:unknown):value is number{
  return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=8_640_000_000_000_000;
}
export function parseSchedule(text:string):BackupSchedule{
  try{
    const x=JSON.parse(text);
    if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).length!==8||
      x.version!==1||!['off','daily','weekly'].includes(x.cadence)||
      typeof x.includeManga!=='boolean'||![0,3,7,14,30].includes(x.keep)||
      !timestamp(x.dueMs)||(x.lastAttemptMs!==null&&!timestamp(x.lastAttemptMs))||
      (x.lastVerifiedMs!==null&&!timestamp(x.lastVerifiedMs))||
      !['never','running','saved','retention-warning','failed'].includes(x.result))return defaultSchedule();
    return {version:1,cadence:x.cadence,includeManga:x.includeManga,keep:x.keep,dueMs:x.dueMs,
      lastAttemptMs:x.lastAttemptMs,lastVerifiedMs:x.lastVerifiedMs,result:x.result};
  }catch{return defaultSchedule();}
}
function period(cadence:Cadence){return cadence==='weekly'?7*DAY:DAY;}
export function configureSchedule(current:BackupSchedule,options:ScheduleOptions,now:number):BackupSchedule{
  return {...current,...options,dueMs:options.cadence==='off'?0:current.cadence===options.cadence?current.dueMs:now+period(options.cadence)};
}
export function scheduleIsDue(state:BackupSchedule,now:number):boolean{
  return state.cadence!=='off'&&state.dueMs<=now;
}
export function beginAttempt(state:BackupSchedule,now:number):BackupSchedule{
  // Persist the attempt and a retry deadline before any asynchronous work.
  // An interrupted process does not leave a permanent running lock.
  return {...state,lastAttemptMs:now,dueMs:now+RETRY,result:'running'};
}
export function sameAttempt(current:BackupSchedule,started:BackupSchedule):boolean{
  return current.result==='running'&&current.lastAttemptMs===started.lastAttemptMs&&
    current.cadence===started.cadence&&current.includeManga===started.includeManga&&current.keep===started.keep&&
    current.dueMs===started.dueMs;
}
export function finishAttempt(state:BackupSchedule,now:number,result:'saved'|'retention-warning'|'failed'):BackupSchedule{
  return {...state,result,dueMs:now+(result==='failed'?RETRY:period(state.cadence)),
    lastVerifiedMs:result==='failed'?state.lastVerifiedMs:now};
}
export function readBackupSchedule():BackupSchedule{
  try{return parseSchedule(localStorage.getItem(BACKUP_SCHEDULE_KEY)??'');}catch{return defaultSchedule();}
}
export function writeBackupSchedule(state:BackupSchedule){
  localStorage.setItem(BACKUP_SCHEDULE_KEY,JSON.stringify(state));
  window.dispatchEvent(new Event(BACKUP_SCHEDULE_EVENT));
}
