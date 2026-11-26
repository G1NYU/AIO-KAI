import { beforeEach,describe,expect,it,vi } from 'vitest';
import { readRequest } from '../src/lib/hosts/shell/reading';
import { parseMangaBackup,snapshotManga,type LocalManga } from '../src/lib/backup/manga';
import { applyCategoryRestore,parseLocalCategories,planCategoryRestore,type LocalCategory } from '../src/lib/backup/manga-categories';

vi.mock('../src/lib/hosts/shell/reading',()=>({readRequest:vi.fn()}));
const request=vi.mocked(readRequest);
const hash=(n:number)=>n.toString(16).padStart(64,'0');
const original:LocalManga={id:1,identity:hash(1),sourceId:'12345',title:'Original manga',categories:['Reading'],chapters:[]};
const fresh:LocalManga={...original,id:9,categories:[]};
const backup=snapshotManga([original],['Reading','空の棚']);
let categories:LocalCategory[],manga:LocalManga;
beforeEach(()=>{
  categories=[];manga={...fresh,categories:[]};request.mockReset();
  request.mockImplementation(async action=>{
    switch(action.kind){
      case 'categories':return {nodes:categories,totalCount:categories.length};
      case 'backup-manga':return manga;
      case 'save-category':{
        const row={id:categories.length+1,name:action.name};
        categories.push(row);return {category:row};
      }
      case 'assign-category':{
        const category=categories.find(row=>row.id===action.categoryId)!;
        manga={...manga,categories:[...manga.categories,category.name]};
        return {manga:{id:manga.id,categories:{nodes:[{id:category.id}]}}};
      }
      default:throw Error('unexpected fixture operation');
    }
  });
});
describe('manga category recovery',()=>{
  it('exports v2 empty shelves and reads v1 backups without inventing empty shelves',()=>{
    expect(backup).toMatchObject({version:2,categories:['Reading','空の棚']});
    expect(parseMangaBackup(JSON.stringify(backup))).toEqual(backup);
    expect(planCategoryRestore(snapshotManga([original]),[fresh],[]).create).toEqual(['Reading']);
    expect(()=>parseMangaBackup(JSON.stringify({...backup,categories:[]}))).toThrow();
    expect(()=>parseMangaBackup(JSON.stringify({...backup,categories:['Reading','Reading']}))).toThrow();
  });
  it('reuses exact names and preserves local shelves and prior assignments',()=>{
    const plan=planCategoryRestore(backup,[{...fresh,categories:['Reading','Local']}],[{id:3,name:'Reading'},{id:4,name:'Local'}]);
    expect(plan.create).toEqual(['空の棚']);
    expect(plan.reuse).toEqual([{id:3,name:'Reading'}]);
    expect(plan.assignments).toEqual([]);
    expect(plan.alreadyAssigned).toBe(1);
    expect(plan.conflicts).toEqual([]);
  });
  it('never guesses between case collisions, duplicate names or unmatched titles',()=>{
    expect(planCategoryRestore(backup,[fresh],[{id:3,name:'reading'}])).toMatchObject({conflicts:['Reading'],unmatchedAssignments:1});
    expect(planCategoryRestore(backup,[fresh],[{id:3,name:'Reading'},{id:4,name:'Reading'}]).conflicts).toEqual(['Reading']);
    expect(planCategoryRestore(backup,[{...fresh,identity:hash(8)}],[]).unmatchedAssignments).toBe(1);
    expect(planCategoryRestore(backup,[fresh],Array.from({length:99},(_,i)=>({id:i+1,name:'Local '+i}))).blocked).toBe(true);
    expect(()=>parseLocalCategories({nodes:[],totalCount:1})).toThrow();
  });
  it('creates shelves and assigns only matched manga, then reimport is idempotent',async()=>{
    const plan=planCategoryRestore(backup,[fresh],categories);
    expect(request).not.toHaveBeenCalled();
    expect(await applyCategoryRestore(plan)).toEqual({created:2,assigned:1,alreadyAssigned:0,complete:true});
    expect(categories.map(row=>row.name)).toEqual(['Reading','空の棚']);
    expect(manga.categories).toEqual(['Reading']);
    const repeated=planCategoryRestore(backup,[manga],categories);
    expect(repeated.create).toEqual([]);expect(repeated.assignments).toEqual([]);
    expect(repeated.alreadyAssigned).toBe(1);
  });
  it('rejects stale category inventories and changed title identities before creating shelves',async()=>{
    const plan=planCategoryRestore(backup,[fresh],categories);
    categories.push({id:1,name:'Another'});
    expect(await applyCategoryRestore(plan)).toMatchObject({created:0,assigned:0,complete:false});
    expect(request.mock.calls.some(([action])=>action.kind==='save-category')).toBe(false);
    categories=[];manga={...fresh,identity:hash(99)};
    expect(await applyCategoryRestore(plan)).toMatchObject({created:0,assigned:0,complete:false});
    expect(categories).toEqual([]);
  });
});
