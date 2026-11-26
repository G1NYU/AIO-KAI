import { appBridge,ask } from '../hosts/shell/bridge';
import { parsePortableArchive,PORTABLE_ARCHIVE_LIMIT,type PortableArchive } from './archive';
export type ManagedBackup={name:string;createdMs:number;bytes:number;readable:boolean};
export type ManagedBackupList={folder:string;backups:ManagedBackup[]};
type Action={kind:'list'}|{kind:'save';archive:string}|{kind:'open';name:string};
const NAME=/^tsugi-backup-(\d{13})-[a-f\d]{32}\.json$/;
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
