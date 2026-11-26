import { sha256 } from '@noble/hashes/sha2.js';
import { capturePreferencesBackup, parsePreferencesBackup, MAX_PREFERENCES_BACKUP_BYTES, type PreferencesBackup } from './preferences';
import { captureMusicBackup, parseMusicBackup, MUSIC_BACKUP_LIMIT, type MusicBackup } from './music';
import { captureBookBackup, parseBookBackup, BOOK_BACKUP_LIMIT, type BookBackup } from './books';
import { collectLocalManga, snapshotManga, parseMangaBackup, MANGA_BACKUP_LIMIT, type MangaBackup } from './manga';

export const PORTABLE_ARCHIVE_LIMIT = 24 * 1024 * 1024;
const limits={preferences:MAX_PREFERENCES_BACKUP_BYTES,music:MUSIC_BACKUP_LIMIT,books:BOOK_BACKUP_LIMIT,manga:MANGA_BACKUP_LIMIT} as const;
export type ArchiveKind=keyof typeof limits;
export type ArchiveEntry={kind:ArchiveKind;bytes:number;sha256:string;payload:string};
export type PortableArchive={format:'tsugi-portable';version:1;createdAt:string;entries:ArchiveEntry[]};
type Sections={preferences:PreferencesBackup;music:MusicBackup;books:BookBackup;manga?:MangaBackup};

function object(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('object');
  return value as Record<string,unknown>;
}
function exact(row:Record<string,unknown>,fields:string[]){
  if(Object.keys(row).length!==fields.length||fields.some(key=>!Object.prototype.hasOwnProperty.call(row,key)))throw Error('fields');
}
function isKind(value:unknown):value is ArchiveKind{
  return typeof value==='string'&&Object.prototype.hasOwnProperty.call(limits,value);
}
function digest(bytes:Uint8Array){
  return Array.from(sha256(bytes),value=>value.toString(16).padStart(2,'0')).join('');
}
function validatePayload(kind:ArchiveKind,text:string){
  switch(kind){
    case 'preferences':return parsePreferencesBackup(text);
    case 'music':return parseMusicBackup(text);
    case 'books':return parseBookBackup(text);
    case 'manga':return parseMangaBackup(text);
  }
}
function makeEntry(kind:ArchiveKind,value:unknown):ArchiveEntry{
  const payload=JSON.stringify(value);
  validatePayload(kind,payload);
  const bytes=new TextEncoder().encode(payload);
  return {kind,bytes:bytes.length,sha256:digest(bytes),payload};
}
export function parsePortableArchive(text:string):PortableArchive{
  if(new TextEncoder().encode(text).length>PORTABLE_ARCHIVE_LIMIT)throw Error('archive-size');
  const raw=object(JSON.parse(text));
  exact(raw,['format','version','createdAt','entries']);
  if(raw.format!=='tsugi-portable'||raw.version!==1||typeof raw.createdAt!=='string'||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(raw.createdAt)||
    !Number.isFinite(Date.parse(raw.createdAt))||new Date(raw.createdAt).toISOString()!==raw.createdAt||
    !Array.isArray(raw.entries)||raw.entries.length<3||raw.entries.length>4)throw Error('format');
  const seen=new Set<ArchiveKind>();
  const entries:ArchiveEntry[]=raw.entries.map(value=>{
    const row=object(value);exact(row,['kind','bytes','sha256','payload']);
    if(!isKind(row.kind)||seen.has(row.kind)||typeof row.payload!=='string'||
      typeof row.bytes!=='number'||!Number.isSafeInteger(row.bytes)||row.bytes<1||row.bytes>limits[row.kind]||
      typeof row.sha256!=='string'||!/^[a-f\d]{64}$/.test(row.sha256))throw Error('entry');
    const bytes=new TextEncoder().encode(row.payload);
    if(bytes.length!==row.bytes||digest(bytes)!==row.sha256)throw Error('integrity');
    // A valid digest never makes untrusted content safe. Every nested format
    // must independently pass its closed schema before a section is offered.
    validatePayload(row.kind,row.payload);
    seen.add(row.kind);
    return {kind:row.kind,bytes:row.bytes,sha256:row.sha256,payload:row.payload};
  });
  if(!seen.has('preferences')||!seen.has('music')||!seen.has('books'))throw Error('missing-section');
  return {format:'tsugi-portable',version:1,createdAt:raw.createdAt,entries};
}
export function createPortableArchive(sections:Sections,createdAt=new Date().toISOString()):PortableArchive{
  const entries=[makeEntry('preferences',sections.preferences),makeEntry('music',sections.music),makeEntry('books',sections.books)];
  if(sections.manga!==undefined)entries.push(makeEntry('manga',sections.manga));
  return parsePortableArchive(JSON.stringify({format:'tsugi-portable',version:1,createdAt,entries}));
}
export async function capturePortableArchive(includeManga:boolean,onProgress?:(kind:ArchiveKind,done:number,total:number)=>void):Promise<PortableArchive>{
  // Sequential, read-only snapshots. Never present this as a transaction
  // across all stores or silently omit a selected domain after failure.
  const preferences=capturePreferencesBackup(),music=captureMusicBackup();
  onProgress?.('books',0,0);
  const books=await captureBookBackup((done,total)=>onProgress?.('books',done,total));
  let manga:MangaBackup|undefined;
  if(includeManga){
    onProgress?.('manga',0,0);
    manga=snapshotManga(await collectLocalManga((done,total)=>onProgress?.('manga',done,total)));
  }
  return createPortableArchive({preferences,music,books,manga});
}
export function archiveEntryCounts(entry:ArchiveEntry):{items:number;secondary?:number}{
  switch(entry.kind){
    case 'preferences':return {items:Object.keys(parsePreferencesBackup(entry.payload).settings).length};
    case 'music':{const p=parseMusicBackup(entry.payload).playlists;return {items:p.length,secondary:p.reduce((n,list)=>n+list.tracks.length,0)};}
    case 'books':return {items:parseBookBackup(entry.payload).books.length};
    case 'manga':{const m=parseMangaBackup(entry.payload).manga;return {items:m.length,secondary:m.reduce((n,title)=>n+title.chapters.length,0)};}
  }
}
