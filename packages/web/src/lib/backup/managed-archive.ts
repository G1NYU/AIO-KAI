import { appBridge,ask } from '../hosts/shell/bridge';
import { parsePortableArchive,PORTABLE_ARCHIVE_LIMIT,type PortableArchive } from './archive';
export type ManagedBackup={name:string;createdMs:number;bytes:number;readable:boolean};
export type ManagedBackupList={folder:string;backups:ManagedBackup[]};
type Action={kind:'storage'}|{kind:'list'}|{kind:'save';archive:string}|{kind:'save-scheduled';archive:string;keep:number}|{kind:'open';name:string};
const NAME=/^tsugi-(?:auto-)?backup-(\d{13})-[a-f\d]{32}\.json$/;
function object(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('backup-response');
  return value as Record<string,unknown>;
}
function exact(row:Record<string,unknown>,fields:string[]){
  if(Object.keys(row).length!==fields.length||fields.some(key=>!Object.prototype.hasOwnProperty.call(row,key)))throw Error('backup-response');
}
export function parseManagedBackup(value:unknown):ManagedBackup{
  const row=object(value);exact(row,['name','createdMs','bytes','readable']);
  const match=typeof row.name==='string'?NAME.exec(row.name):null;
  if(!match||typeof row.createdMs!=='number'||row.createdMs!==Number(match[1])||
    typeof row.bytes!=='number'||!Number.isSafeInteger(row.bytes)||row.bytes<0||
    typeof row.readable!=='boolean'||row.readable!==(row.bytes>0&&row.bytes<=PORTABLE_ARCHIVE_LIMIT))throw Error('backup-response');
  return {name:row.name as string,createdMs:row.createdMs,bytes:row.bytes,readable:row.readable};
}
export function parseManagedBackupList(value:unknown):ManagedBackupList{
  const row=object(value);exact(row,['folder','backups']);
  if(typeof row.folder!=='string'||!row.folder||row.folder.length>32768||/[\x00-\x1f\x7f]/.test(row.folder)||
    !Array.isArray(row.backups)||row.backups.length>500)throw Error('backup-response');
  const backups=row.backups.map(parseManagedBackup);
  if(new Set(backups.map(item=>item.name)).size!==backups.length)throw Error('backup-response');
  return {folder:row.folder,backups:backups.sort((a,b)=>b.createdMs-a.createdMs||b.name.localeCompare(a.name))};
}
export function supportsManagedBackups(){return appBridge()?.backupStore===true&&appBridge()?.platform==='windows';}
let sequence=0;
async function request(action:Action):Promise<unknown>{
  if(!supportsManagedBackups())throw Error('unsupported');
  const id='backup-'+Date.now()+'-'+(++sequence);
  const response=await ask({type:'backup-request',request:id,action},'backup-result',{timeoutMs:180000,matches:message=>message.request===id});
  if(response.error||response.data==null)throw Error(response.error||'backup-response');
  return response.data;
}
export async function listManagedBackups():Promise<ManagedBackupList>{
  return parseManagedBackupList(await request({kind:'list'}));
}
export async function saveManagedArchive(archive:PortableArchive):Promise<ManagedBackup>{
  const text=JSON.stringify(archive);
  parsePortableArchive(text);
  const result=parseManagedBackup(await request({kind:'save',archive:text}));
  if(!result.readable||result.bytes!==new TextEncoder().encode(text).length)throw Error('backup-write-unconfirmed');
  return result;
}
export async function openManagedArchive(name:string):Promise<PortableArchive>{
  if(!NAME.test(name))throw Error('backup-name');
  const row=object(await request({kind:'open',name}));exact(row,['archive']);
  if(typeof row.archive!=='string')throw Error('backup-response');
  return parsePortableArchive(row.archive);
}

export async function saveScheduledArchive(archive:PortableArchive,keep:0|3|7|14|30):Promise<{backup:ManagedBackup;removed:number;retentionIncomplete:boolean}>{
  const text=JSON.stringify(archive);
  parsePortableArchive(text);
  const row=object(await request({kind:'save-scheduled',archive:text,keep}));
  exact(row,['backup','removed','retentionIncomplete']);
  const backup=parseManagedBackup(row.backup);
  if(!backup.name.startsWith('tsugi-auto-backup-')||!backup.readable||
    backup.bytes!==new TextEncoder().encode(text).length||typeof row.removed!=='number'||
    !Number.isInteger(row.removed)||row.removed<0||row.removed>499||
    typeof row.retentionIncomplete!=='boolean')throw Error('backup-write-unconfirmed');
  return {backup,removed:row.removed,retentionIncomplete:row.retentionIncomplete};
}

export const STORAGE_KINDS=['backups','reader','webview','logs','downloads','other'] as const;
export type StorageKind=typeof STORAGE_KINDS[number];
export type StorageRow={kind:StorageKind;bytes:number;files:number;skipped:number;complete:boolean};
export function parseStorageUsage(value:unknown):StorageRow[]{
  const root=object(value);exact(root,['rows']);
  if(!Array.isArray(root.rows)||root.rows.length!==STORAGE_KINDS.length)throw Error('storage-response');
  const seen=new Set<StorageKind>();
  const integer=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
  const rows=root.rows.map(value=>{
    const row=object(value);exact(row,['kind','bytes','files','skipped','complete']);
    if(!STORAGE_KINDS.includes(row.kind as StorageKind)||seen.has(row.kind as StorageKind)||
      !integer(row.bytes)||!integer(row.files)||!integer(row.skipped)||typeof row.complete!=='boolean'||
      (row.complete&&row.skipped!==0))throw Error('storage-response');
    const kind=row.kind as StorageKind;seen.add(kind);
    return {kind,bytes:row.bytes,files:row.files,skipped:row.skipped,complete:row.complete};
  });
  return STORAGE_KINDS.map(kind=>rows.find(row=>row.kind===kind)!);
}
export async function inspectManagedStorage():Promise<StorageRow[]>{
  return parseStorageUsage(await request({kind:'storage'}));
}
