import { describe,expect,it } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import { createPortableArchive,parsePortableArchive,archiveEntryCounts,PORTABLE_ARCHIVE_LIMIT,type ArchiveEntry } from '../src/lib/backup/archive';
import type { PreferencesBackup } from '../src/lib/backup/preferences';
import type { MusicBackup } from '../src/lib/backup/music';
import type { BookBackup } from '../src/lib/backup/books';
import type { MangaBackup } from '../src/lib/backup/manga';

const preferences:PreferencesBackup={format:'tsugi-preferences',version:1,settings:{theme:'mocha',accent:'blue',startup:'auto',matrix:'wave',layout:'default',audioProfile:'flat',reader:{mode:'scroll',width:55,gap:false,rtl:false,fit:'width',background:'black',focus:false,autoNext:false,wheelZoom:true,resume:true}}};
const music:MusicBackup={format:'tsugi-music-library',version:1,playlists:[]};
const books:BookBackup={format:'tsugi-book-progress',version:1,books:[{id:'a'.repeat(32),name:'日本語.pdf',title:'Édition 日本語',format:'pdf',size:10,sha256:'b'.repeat(64),progress:null}]};
const manga:MangaBackup={format:'tsugi-manga-progress',version:1,manga:[]};
const date='2026-01-01T00:00:00.000Z';
const make=()=>createPortableArchive({preferences,music,books,manga},date);
function rehash(entry:ArchiveEntry,payload:string):ArchiveEntry{
  const bytes=new TextEncoder().encode(payload);
  return {...entry,payload,bytes:bytes.length,sha256:Array.from(sha256(bytes),x=>x.toString(16).padStart(2,'0')).join('')};
}
describe('portable archive',()=>{
  it('round-trips validated domains and non-ASCII metadata with byte counts',()=>{
    const archive=make();
    expect(parsePortableArchive(JSON.stringify(archive))).toEqual(archive);
    expect(archive.entries.map(entry=>entry.kind)).toEqual(['preferences','music','books','manga']);
    const book=archive.entries.find(entry=>entry.kind==='books')!;
    expect(book.bytes).toBeGreaterThan(book.payload.length);
    expect(archiveEntryCounts(book)).toEqual({items:1});
  });
  it('derives reconnect counts from the archive without querying sources',()=>{
    const list='tsugi-saved-tracks';
    const track={id:'portable:00000000-0000-0000-0000-000000000000:0',title:'Fixture',artist:'Fixture'};
    const title={identity:'1'.repeat(64),sourceId:'3',title:'Fixture',categories:[],chapters:[]};
    const archive=createPortableArchive({preferences,books,music:{...music,playlists:[{id:list,name:'Saved',tracks:[track]}]},
      manga:{format:'tsugi-manga-progress',version:1,manga:[title,{...title,identity:'2'.repeat(64)}]}},date);
    expect(archiveEntryCounts(archive.entries[1])).toEqual({items:1,secondary:1,metadataOnly:1});
    expect(archiveEntryCounts(archive.entries[3])).toEqual({items:2,secondary:0,sourceCount:1});
  });
  it('supports an explicitly omitted Reader section',()=>{
    const archive=createPortableArchive({preferences,music,books},date);
    expect(archive.entries.map(entry=>entry.kind)).toEqual(['preferences','music','books']);
    expect(parsePortableArchive(JSON.stringify(archive))).toEqual(archive);
  });
  it('keeps the portable manifest version while accepting both old and Feed-aware preference sections',()=>{
    const legacy=make();
    const current=createPortableArchive({preferences:{format:'tsugi-preferences',version:2,settings:{...preferences.settings,
      feed:{version:1,sources:[{sourceId:'9007199254740993',mode:'latest'}]}}},music,books,manga},date);
    expect(legacy.version).toBe(1);expect(current.version).toBe(1);
    expect(parsePortableArchive(JSON.stringify(legacy))).toEqual(legacy);
    expect(parsePortableArchive(JSON.stringify(current))).toEqual(current);
    expect(JSON.parse(current.entries[0].payload).settings.feed.sources[0].sourceId).toBe('9007199254740993');
    expect(archiveEntryCounts(current.entries[0])).toEqual({items:8});
    const invalid=JSON.parse(current.entries[0].payload);invalid.settings.feed.sources[0].token='fixture-secret';
    expect(()=>parsePortableArchive(JSON.stringify({...current,entries:[rehash(current.entries[0],JSON.stringify(invalid)),...current.entries.slice(1)]}))).toThrow();
  });
  it('rejects tampering, malformed manifest, unknown sections and missing required sections',()=>{
    const archive=make(),first=archive.entries[0];
    for(const invalid of [{...archive,version:2},{...archive,token:'secret'},{...archive,createdAt:'2026-02-31T00:00:00.000Z'},
      {...archive,entries:[...archive.entries.slice(1)]},{...archive,entries:[first,first,...archive.entries.slice(2)]},
      {...archive,entries:[{...first,kind:'../preferences'},...archive.entries.slice(1)]},
      {...archive,entries:[{...first,payload:first.payload.replace('mocha','carbon')},...archive.entries.slice(1)]},
      {...archive,entries:[{...first,bytes:first.bytes+1},...archive.entries.slice(1)]}])
      expect(()=>parsePortableArchive(JSON.stringify(invalid))).toThrow();
    expect(()=>parsePortableArchive(' '.repeat(PORTABLE_ARCHIVE_LIMIT+1))).toThrow();
  });
  it('rejects unsafe nested content even if the digest is recomputed',()=>{
    const archive=make(),first=archive.entries[0];
    const forged=rehash(first,JSON.stringify({...preferences,token:'fixture-secret'}));
    expect(()=>parsePortableArchive(JSON.stringify({...archive,entries:[forged,...archive.entries.slice(1)]}))).toThrow();
  });
});
