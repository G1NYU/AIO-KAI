import { sha256 } from '@noble/hashes/sha2.js';
import { bookMetadataSnapshot, getBookFile, listBooks, type BookMetadataChange, type BookMetadataSnapshot } from '../../app/read/book-library';
import { MAX_BOOK_BYTES, validBookProgress, type BookEntry, type BookFormat, type BookPosition } from '../../app/read/book-guards';

export const BOOK_BACKUP_LIMIT=2*1024*1024;
const MAX_BOOKS=1000;
const ID=/^[a-f\d]{32}$/;
const HASH=/^[a-f\d]{64}$/;
export type BookProgress={position:BookPosition;fraction:number;lastReadAt:number};
export type BookBackupRow={id:string;name:string;title:string;format:BookFormat;size:number;sha256:string;progress:BookProgress|null};
export type BookBackup={format:'tsugi-book-progress';version:1;books:BookBackupRow[]};
export type LocalBookFingerprint={metadata:BookMetadataSnapshot;sha256:string};
type RestoreState='ready'|'missing'|'ambiguous'|'newer'|'conflict'|'unchanged';
export type BookRestoreRow={id:string;title:string;state:RestoreState;titleConflict:boolean;progressKept:boolean};
export type BookRestorePlan={rows:BookRestoreRow[];changes:BookMetadataChange[]};
function object(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('object');
  return value as Record<string,unknown>;
}
function exact(value:Record<string,unknown>,fields:string[]){
  if(Object.keys(value).length!==fields.length||fields.some(key=>!Object.prototype.hasOwnProperty.call(value,key)))throw new Error('fields');
}
function label(value:unknown,max:number):string{
  if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x1f\x7f]|:\/\//.test(value))throw new Error('label');
  return value;
}
function timestamp(value:unknown):number{
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new Error('timestamp');
  return value;
}
function parseProgress(format:BookFormat,value:unknown):BookProgress|null{
  if(value===null)return null;
  const raw=object(value);exact(raw,['position','fraction','lastReadAt']);
  const progress=validBookProgress(format,raw.position,raw.fraction);
  if(!progress)throw new Error('progress');
  return {...progress,lastReadAt:timestamp(raw.lastReadAt)};
}
export function parseBookBackup(text:string):BookBackup{
  if(new TextEncoder().encode(text).length>BOOK_BACKUP_LIMIT)throw new Error('size');
  const root=object(JSON.parse(text));exact(root,['format','version','books']);
  if(root.format!=='tsugi-book-progress'||root.version!==1||!Array.isArray(root.books)||root.books.length>MAX_BOOKS)throw new Error('format');
  const ids=new Set<string>();
  const books:BookBackupRow[]=root.books.map(value=>{
    const row=object(value);exact(row,['id','name','title','format','size','sha256','progress']);
    const id=label(row.id,32),name=label(row.name,1024),title=label(row.title,1000),hash=label(row.sha256,64);
    if(!ID.test(id)||ids.has(id)||!HASH.test(hash)||/[\\/]/.test(name)||
      (row.format!=='pdf'&&row.format!=='epub')||!name.toLowerCase().endsWith('.'+row.format)||
      typeof row.size!=='number'||!Number.isSafeInteger(row.size)||row.size<1||row.size>MAX_BOOK_BYTES)throw new Error('book');
    ids.add(id);
    return {id,name,title,format:row.format,size:row.size,sha256:hash,progress:parseProgress(row.format,row.progress)};
  });
  return {format:'tsugi-book-progress',version:1,books};
}

/** Hash bounded immutable local book contents in chunks; do not copy media
 * bytes into the backup or hold the entire book in JS memory. */
export async function fingerprintBook(blob:Blob):Promise<string>{
  if(blob.size<=0||blob.size>MAX_BOOK_BYTES)throw new Error('size');
  const hash=sha256.create(), reader=blob.stream().getReader();
  try{
    while(true){
      const part=await reader.read();
      if(part.done)break;
      hash.update(part.value);
    }
    return Array.from(hash.digest(),n=>n.toString(16).padStart(2,'0')).join('');
  }finally{reader.releaseLock();}
}
async function localFingerprints(books:BookEntry[],onProgress?:(done:number,total:number)=>void):Promise<LocalBookFingerprint[]>{
  if(books.length>MAX_BOOKS)throw new Error('book-count');
  const out:LocalBookFingerprint[]=[];
  for(const book of books){
    const file=await getBookFile(book);
    if(file.size!==book.size)throw new Error('file-size');
    out.push({metadata:bookMetadataSnapshot(book),sha256:await fingerprintBook(file)});
    onProgress?.(out.length,books.length);
  }
  return out;
}
function localProgress(book:BookMetadataSnapshot):BookProgress|null{
  if(book.position===undefined&&book.fraction===undefined&&book.lastReadAt===undefined)return null;
  return parseProgress(book.format,{position:book.position,fraction:book.fraction,lastReadAt:book.lastReadAt??0});
}
export async function captureBookBackup(onProgress?:(done:number,total:number)=>void):Promise<BookBackup>{
  const local=await localFingerprints(await listBooks(),onProgress);
  const books=local.map(({metadata:book,sha256})=>({
    id:book.id,name:book.name,title:book.title,format:book.format,size:book.size,sha256,progress:localProgress(book),
  }));
  return parseBookBackup(JSON.stringify({format:'tsugi-book-progress',version:1,books}));
}
function fingerprintKey(book:{format:BookFormat;size:number;sha256:string}){
  return book.format+':'+book.size+':'+book.sha256;
}
export function planBookRestore(backup:BookBackup,local:LocalBookFingerprint[]):BookRestorePlan{
  const verified=parseBookBackup(JSON.stringify(backup));
  const targets=new Map<string,LocalBookFingerprint[]>();
  for(const entry of local){
    const key=fingerprintKey({...entry.metadata,sha256:entry.sha256});
    const rows=targets.get(key);if(rows)rows.push(entry);else targets.set(key,[entry]);
  }
  const matches=verified.books.map(row=>{
    const candidates=targets.get(fingerprintKey(row))??[];
    const exactId=candidates.find(entry=>entry.metadata.id===row.id);
    const target=exactId??(candidates.length===1?candidates[0]:undefined);
    return {row,target,ambiguous:!target&&candidates.length>1};
  });
  const used=new Map<string,number>();
  for(const match of matches)if(match.target){
    const id=match.target.metadata.id;used.set(id,(used.get(id)??0)+1);
  }
  const rows:BookRestoreRow[]=[],changes:BookMetadataChange[]=[];
  for(const {row,target,ambiguous} of matches){
    const report:BookRestoreRow={id:row.id,title:row.title,state:'unchanged',titleConflict:false,progressKept:false};
    rows.push(report);
    if(!target){report.state=ambiguous?'ambiguous':'missing';continue;}
    const current=target.metadata;
    if((used.get(current.id)??0)>1){report.state='ambiguous';continue;}
    const change:BookMetadataChange={expected:current};
    if(current.title!==row.title){
      if(current.title===current.name.replace(/\.(epub|pdf)$/i,''))change.title=row.title;
      else report.titleConflict=true;
    }
    const progress=localProgress(current);
    if(row.progress){
      if(!progress||row.progress.lastReadAt>progress.lastReadAt)change.progress=row.progress;
      else if(progress.lastReadAt>row.progress.lastReadAt){report.state='newer';report.progressKept=true;}
      else if(progress.position!==row.progress.position||progress.fraction!==row.progress.fraction){report.state='conflict';report.progressKept=true;}
    }
    if(change.title!==undefined||change.progress){changes.push(change);report.state='ready';}
    else if(report.titleConflict&&report.state==='unchanged')report.state='conflict';
  }
  return {rows,changes};
}
export async function previewBookRestore(backup:BookBackup,onProgress?:(done:number,total:number)=>void):Promise<BookRestorePlan>{
  return planBookRestore(backup,await localFingerprints(await listBooks(),onProgress));
}
