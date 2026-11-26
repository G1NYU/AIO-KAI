import { sha256 } from '@noble/hashes/sha2.js';
import { capturePortableArchive,createPortableArchive,parsePortableArchive,type ArchiveKind,type PortableArchive } from './archive';
import { parsePreferencesBackup } from './preferences';
import { parseMusicBackup } from './music';
import { parseBookBackup } from './books';
import { parseMangaBackup } from './manga';
import { openManagedArchive,saveManagedArchive,supportsManagedBackups } from './managed-archive';
import { supportsReading } from '../hosts/shell/reading';

export const RESTORE_SESSION_KEY='tsugi-portable-restore-session-v1';
export const RESTORE_SESSION_EVENT='tsugi-restore-session-change';
const RECORD_LIMIT=8192;
const LOCK='tsugi-portable-restore';
const NAME=/^tsugi-backup-\d{13}-[a-f\d]{32}\.json$/;
const HASH=/^[a-f\d]{64}$/;
const UUID=/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/;
export const RESTORE_STEPS=['preferences','music','books','manga','categories'] as const;
export type RestoreStep=typeof RESTORE_STEPS[number];
type StepState='pending'|'running'|'done'|'failed'|'unavailable';
type SavedCopy={name:string;sha256:string};
export type RestoreSession={
  format:'tsugi-restore-session';version:1;id:string;revision:number;createdAt:string;
  source:SavedCopy;recovery:SavedCopy;
  steps:{kind:RestoreStep;state:StepState;attempts:number}[];
};
export type RestoreSessionState=
  |{kind:'empty';token:null}
  |{kind:'ready';token:string;session:RestoreSession}
  |{kind:'invalid';token:string}
  |{kind:'unavailable';token:null};
export type RestoreSectionReview={id:string;revision:number};
type ErrorCode='busy'|'unavailable'|'invalid'|'prepare'|'different'|'changed'|'reader'|'active-reader'|'copy'|'write'|'unconfirmed'|'interrupted';
export class RestoreSessionError extends Error {
  constructor(readonly code:ErrorCode){super('restore-'+code);this.name='RestoreSessionError';}
}
let active=false;
export function restoreSessionBusy(){return active;}
function announce(){if(typeof window!=='undefined')window.dispatchEvent(new Event(RESTORE_SESSION_EVENT));}
function digest(text:string){return Array.from(sha256(new TextEncoder().encode(text)),n=>n.toString(16).padStart(2,'0')).join('');}
function object(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('record');
  return value as Record<string,unknown>;
}
function exact(value:Record<string,unknown>,keys:string[]){
  if(Object.keys(value).length!==keys.length||keys.some(key=>!Object.prototype.hasOwnProperty.call(value,key)))throw Error('record');
}
function integer(value:unknown,max:number):value is number{return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=max;}
function copy(value:unknown):SavedCopy{
  const row=object(value);exact(row,['name','sha256']);
  if(typeof row.name!=='string'||!NAME.test(row.name)||typeof row.sha256!=='string'||!HASH.test(row.sha256))throw Error('copy');
  return {name:row.name,sha256:row.sha256};
}
export function parseRestoreSession(text:string):RestoreSession{
  if(new TextEncoder().encode(text).length>RECORD_LIMIT)throw Error('record-size');
  const row=object(JSON.parse(text));
  exact(row,['format','version','id','revision','createdAt','source','recovery','steps']);
  if(row.format!=='tsugi-restore-session'||row.version!==1||typeof row.id!=='string'||!UUID.test(row.id)||
    !integer(row.revision,1_000_000)||typeof row.createdAt!=='string'||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(row.createdAt)||!Number.isFinite(Date.parse(row.createdAt))||
    new Date(row.createdAt).toISOString()!==row.createdAt||!Array.isArray(row.steps)||!row.steps.length||row.steps.length>5)throw Error('record');
  const seen=new Set<RestoreStep>();
  const steps=row.steps.map(value=>{
    const item=object(value);exact(item,['kind','state','attempts']);
    const kind=item.kind as RestoreStep,state=item.state as StepState;
    if(!RESTORE_STEPS.includes(kind)||seen.has(kind)||!['pending','running','done','failed','unavailable'].includes(state)||
      !integer(item.attempts,10_000)||((state==='pending'||state==='unavailable')&&item.attempts!==0)||
      (['running','done','failed'].includes(state)&&item.attempts===0))throw Error('step');
    seen.add(kind);return {kind,state,attempts:item.attempts};
  });
  const source=copy(row.source),recovery=copy(row.recovery);
  if(source.name===recovery.name||steps.filter(step=>step.state==='running').length>1)throw Error('record');
  return {format:'tsugi-restore-session',version:1,id:row.id,revision:row.revision,createdAt:row.createdAt,source,recovery,steps};
}
export function readRestoreSessionState():RestoreSessionState{
  let raw:string|null;
  try{raw=localStorage.getItem(RESTORE_SESSION_KEY);}catch{return {kind:'unavailable',token:null};}
  if(raw===null)return {kind:'empty',token:null};
  const token=digest(raw);
  try{return {kind:'ready',token,session:parseRestoreSession(raw)};}
  catch{return {kind:'invalid',token};}
}
function currentState():Extract<RestoreSessionState,{kind:'ready'}>{
  const state=readRestoreSessionState();
  if(state.kind==='empty')throw new RestoreSessionError('prepare');
  if(state.kind!=='ready')throw new RestoreSessionError(state.kind);
  return state;
}
function requireEmpty(){
  const state=readRestoreSessionState();
  if(state.kind==='ready')throw new RestoreSessionError('different');
  if(state.kind!=='empty')throw new RestoreSessionError(state.kind);
}
function requireClosedReaders(){
  if(typeof document!=='undefined'&&document.querySelector('[data-ui="tsugi-book-reader"], .tsugi-chapter-reader'))
    throw new RestoreSessionError('active-reader');
}
function write(session:RestoreSession,expected:string|null){
  const text=JSON.stringify(parseRestoreSession(JSON.stringify(session)));
  try{
    const old=localStorage.getItem(RESTORE_SESSION_KEY);
    if((old===null?null:digest(old))!==expected)throw new RestoreSessionError('changed');
    localStorage.setItem(RESTORE_SESSION_KEY,text);
    if(localStorage.getItem(RESTORE_SESSION_KEY)!==text)throw new RestoreSessionError('write');
  }catch(reason){if(reason instanceof RestoreSessionError)throw reason;throw new RestoreSessionError('write');}
  announce();
}
async function locked<T>(work:()=>Promise<T>,required=true):Promise<T>{
  // Web Locks serialize this origin across windows, including asynchronous
  // native writes. A missing lock service must never silently weaken the gate.
  const execute=async()=>{
    if(active)throw new RestoreSessionError('busy');
    active=true;announce();
    try{return await work();}finally{active=false;announce();}
  };
  if(typeof navigator==='undefined'||!navigator.locks){
    if(required)throw new RestoreSessionError('unavailable');
    return execute();
  }
  return navigator.locks.request(LOCK,{ifAvailable:true},async lock=>{
    if(!lock)throw new RestoreSessionError('busy');
    return execute();
  });
}
function archiveDigest(archive:PortableArchive){return digest(JSON.stringify(parsePortableArchive(JSON.stringify(archive))));}
export function restoreSessionMatches(session:RestoreSession,archive:PortableArchive){return session.source.sha256===archiveDigest(archive);}
function archiveKind(kind:RestoreStep):ArchiveKind{return kind==='categories'?'manga':kind;}
async function verifyCopy(saved:SavedCopy){
  try{
    const archive=await openManagedArchive(saved.name);
    if(archiveDigest(archive)!==saved.sha256)throw Error('changed');
    return archive;
  }catch{throw new RestoreSessionError('copy');}
}
async function saveCopy(archive:PortableArchive):Promise<SavedCopy>{
  const saved=await saveManagedArchive(archive);
  const value={name:saved.name,sha256:archiveDigest(archive)};
  if(!NAME.test(value.name))throw new RestoreSessionError('copy');
  await verifyCopy(value);
  return value;
}
function initialSteps(source:PortableArchive,recovery:PortableArchive,selected?:readonly RestoreStep[]){
  const available=(kind:RestoreStep,archive:PortableArchive)=>archive.entries.some(entry=>entry.kind===archiveKind(kind));
  return RESTORE_STEPS.filter(kind=>available(kind,source)&&(!selected||selected.includes(kind)))
    .map(kind=>({kind,state:available(kind,recovery)?'pending' as const:'unavailable' as const,attempts:0}));
}
async function prepare(source:PortableArchive,recovery:PortableArchive,expected:string|null,selected?:readonly RestoreStep[]){
  if(!supportsManagedBackups())throw new RestoreSessionError('unavailable');
  // Both files are manual copies, excluded from scheduled retention. No domain
  // changes occur until the files AND the small intent record are verified.
  const before=await saveCopy(recovery);
  const incoming=await saveCopy(source);
  const session:RestoreSession={format:'tsugi-restore-session',version:1,id:crypto.randomUUID(),revision:0,
    createdAt:new Date().toISOString(),source:incoming,recovery:before,steps:initialSteps(source,recovery,selected)};
  write(session,expected);
  return session;
}
export async function prepareRestoreSession(archive:PortableArchive):Promise<RestoreSession>{
  return locked(async()=>{
    requireEmpty();requireClosedReaders();
    if(!supportsManagedBackups())throw new RestoreSessionError('unavailable');
    const source=parsePortableArchive(JSON.stringify(archive));
    const recovery=await capturePortableArchive(source.entries.some(entry=>entry.kind==='manga')&&supportsReading());
    requireClosedReaders();
    return prepare(source,recovery,null);
  });
}
/** External Mihon imports share the same guarded manga/category apply path. */
export async function prepareMangaRestore(payload:string):Promise<RestoreSession>{
  return locked(async()=>{
    requireEmpty();requireClosedReaders();
    if(!supportsManagedBackups())throw new RestoreSessionError('unavailable');
    if(!supportsReading())throw new RestoreSessionError('reader');
    const manga=parseMangaBackup(payload);
    const recovery=await capturePortableArchive(true);
    const entry=(kind:ArchiveKind)=>recovery.entries.find(value=>value.kind===kind)!.payload;
    const source=createPortableArchive({preferences:parsePreferencesBackup(entry('preferences')),music:parseMusicBackup(entry('music')),
      books:parseBookBackup(entry('books')),manga});
    requireClosedReaders();
    return prepare(source,recovery,null,['manga','categories']);
  });
}
export async function resumeRestoreSession(id:string):Promise<PortableArchive>{
  return locked(async()=>{
    const {session,token}=currentState();
    if(session.id!==id)throw new RestoreSessionError('changed');
    await verifyCopy(session.recovery);
    const source=await verifyCopy(session.source);
    // Reopening is an explicit acknowledgement that an interrupted attempt is
    // unconfirmed, not a request to replay it. New per-section review is needed.
    write({...session,revision:session.revision+1,steps:session.steps.map(step=>
      step.state==='running'?{...step,state:'failed'}:step)},token);
    return source;
  });
}
/** Prepare a new explicit review from pre-restore metadata. Existing additive
 * restore policies still apply; this is not a destructive global rollback. */
export async function reviewRestoreRecovery(id:string):Promise<PortableArchive>{
  return locked(async()=>{
    const state=readRestoreSessionState();
    if(state.kind!=='ready'||state.session.id!==id)throw new RestoreSessionError('changed');
    requireClosedReaders();
    const source=await verifyCopy(state.session.recovery);
    const recovery=await capturePortableArchive(source.entries.some(entry=>entry.kind==='manga')&&supportsReading());
    requireClosedReaders();
    await prepare(source,recovery,state.token,state.session.steps.map(step=>step.kind));
    return source;
  });
}
export async function finishRestoreSession(expectedToken:string):Promise<void>{
  return locked(async()=>{
    try{
      const raw=localStorage.getItem(RESTORE_SESSION_KEY);
      if(raw===null||digest(raw)!==expectedToken)throw new RestoreSessionError('changed');
      localStorage.removeItem(RESTORE_SESSION_KEY);
      if(localStorage.getItem(RESTORE_SESSION_KEY)!==null)throw new RestoreSessionError('write');
    }catch(reason){if(reason instanceof RestoreSessionError)throw reason;throw new RestoreSessionError('write');}
    announce();
  });
}
/** Freeze the restore intent at the beginning of a local conflict review. A
 * later checkpoint or action invalidates that review even when payloads match. */
export function reviewRestoreSection(kind:RestoreStep,payload:string|undefined):RestoreSectionReview|undefined{
  if(payload===undefined){requireEmpty();return undefined;}
  const {session}=currentState();
  const step=session.steps.find(value=>value.kind===kind);
  if(!step)throw new RestoreSessionError('different');
  if(step.state==='unavailable')throw new RestoreSessionError('reader');
  if(session.steps.some(value=>value.state==='running'))throw new RestoreSessionError('interrupted');
  return {id:session.id,revision:session.revision};
}
/** Guard only an explicitly reviewed archived section. Standalone imports
 * cannot silently modify data while an unfinished archive session is open. */
export async function runRestoreSection<T>(kind:RestoreStep,payload:string|undefined,
  review:RestoreSectionReview|undefined,work:()=>Promise<T>|T,complete:(result:T)=>boolean=()=>true):Promise<T>{
  if(payload===undefined){
    return locked(async()=>{requireEmpty();return work();},false);
  }
  return locked(async()=>{
    const {session,token}=currentState();
    if(!review||session.id!==review.id||session.revision!==review.revision)throw new RestoreSessionError('changed');
    if(session.steps.some(value=>value.state==='running'))throw new RestoreSessionError('interrupted');
    const selected=session.steps.find(step=>step.kind===kind);
    if(!selected)throw new RestoreSessionError('different');
    if(selected.state==='unavailable')throw new RestoreSessionError('reader');
    const source=await verifyCopy(session.source),recovery=await verifyCopy(session.recovery);
    const entry=source.entries.find(value=>value.kind===archiveKind(kind));
    // Mihon conversion is canonicalized before it is saved. JSON whitespace
    // must not break a valid reviewed manga import, but its parsed data must be
    // identical to the saved source. Other archive payloads are exact bytes.
    const matches=entry&&(archiveKind(kind)==='manga'
      ?JSON.stringify(parseMangaBackup(entry.payload))===JSON.stringify(parseMangaBackup(payload)):entry.payload===payload);
    if(!matches)throw new RestoreSessionError('different');
    if(!recovery.entries.some(value=>value.kind===archiveKind(kind)))throw new RestoreSessionError('reader');
    requireClosedReaders();
    const running:RestoreSession={...session,revision:session.revision+1,steps:session.steps.map(step=>step.kind===kind
      ?{...step,state:'running',attempts:step.attempts+1}:step)};
    write(running,token);
    const saveResult=(state:'done'|'failed')=>write({...running,revision:running.revision+1,
      steps:running.steps.map(step=>step.kind===kind?{...step,state}:step)},digest(JSON.stringify(running)));
    let result:T;
    try{result=await work();}
    catch(reason){try{saveResult('failed');}catch{throw new RestoreSessionError('unconfirmed');}throw reason;}
    try{saveResult(complete(result)?'done':'failed');}
    catch{throw new RestoreSessionError('unconfirmed');}
    return result;
  });
}
