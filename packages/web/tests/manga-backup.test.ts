import { describe,expect,it } from 'vitest';
import { parseMangaBackup,snapshotManga,planMangaRestore,type LocalManga } from '../src/lib/backup/manga';
const hash=(n:number)=>n.toString(16).padStart(64,'0');
const chapter={id:11,identity:hash(11),name:'Chapter one',isRead:false,isBookmarked:true,lastPageRead:3,pageCount:20,lastReadAt:'100'};
const original:LocalManga={id:1,identity:hash(1),sourceId:'-9223372036854775808',title:'Original manga',categories:['Reading'],chapters:[chapter,{...chapter,id:12,identity:hash(12),isRead:true,lastReadAt:'200'}]};
const backup=snapshotManga([original]);
describe('manga progress backup',()=>{
  it('exports identities, bookmarks, categories and progress, without local IDs',()=>{
    expect(backup.manga[0]).not.toHaveProperty('id');
    expect(backup.manga[0].chapters[0]).not.toHaveProperty('id');
    expect(backup.manga[0].sourceId).toBe(original.sourceId);
    expect(parseMangaBackup(JSON.stringify(backup))).toEqual(backup);
  });
  it('matches exact identities after re-add and restores additive progress',()=>{
    const local={...original,id:9,chapters:original.chapters.map((c,i)=>({...c,id:20+i,isRead:false,isBookmarked:false,lastPageRead:0,lastReadAt:'0'}))};
    const plan=planMangaRestore(backup,[local]);
    expect(plan.changes[0]).toMatchObject({id:9,identity:original.identity,changes:[{identity:chapter.identity,page:3,bookmark:true,markRead:false},{identity:hash(12),markRead:true,bookmark:true}]});
    expect(plan.changes[0].changes[1]).not.toHaveProperty('page');
  });
  it('keeps newer positions and never guesses identities or page counts',()=>{
    const local={...original,chapters:[{...chapter,lastPageRead:1,lastReadAt:'101',isBookmarked:false},{...original.chapters[1],identity:hash(99)}]};
    const plan=planMangaRestore(backup,[local]);
    expect(plan.changes[0].changes[0]).toMatchObject({bookmark:true,markRead:false});
    expect(plan.changes[0].changes[0]).not.toHaveProperty('page');
    expect(plan.rows[0]).toMatchObject({kept:1,unmatched:1});
    expect(planMangaRestore(backup,[{...local,identity:hash(3)}]).rows[0].state).toBe('missing');
    const changed={...original,chapters:[{...chapter,lastPageRead:1,pageCount:21}]};
    expect(planMangaRestore(backup,[changed]).changes).toEqual([]);
  });
  it('rejects duplicate or malformed records, URLs and extra credential fields',()=>{
    for(const invalid of [{...backup,token:'secret'},{...backup,manga:[...backup.manga,...backup.manga]},
      {...backup,manga:[{...backup.manga[0],sourceId:'9223372036854775808'}]},
      {...backup,manga:[{...backup.manga[0],title:'https://private.test/token'}]},
      {...backup,manga:[{...backup.manga[0],chapters:[{...backup.manga[0].chapters[0],url:'https://private.test'}]}]}])
      expect(()=>parseMangaBackup(JSON.stringify(invalid))).toThrow();
  });
});
