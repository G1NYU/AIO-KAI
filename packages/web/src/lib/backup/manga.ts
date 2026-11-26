import type { MangaProgressPatch } from '../hosts/shell/reading';

export const MANGA_BACKUP_LIMIT = 8 * 1024 * 1024;
const MAX_TITLES=1000, MAX_CHAPTERS=100000, MAX_TITLE_CHAPTERS=10000, MAX_PATCHES=2000;
const HASH=/^[a-f\d]{64}$/;
export type BackupChapter={identity:string;name:string;isRead:boolean;isBookmarked:boolean;lastPageRead:number;pageCount:number;lastReadAt:string};
export type BackupManga={identity:string;sourceId:string;title:string;categories:string[];chapters:BackupChapter[]};
export type MangaBackup={format:'tsugi-manga-progress';version:1;manga:BackupManga[]}|{format:'tsugi-manga-progress';version:2;manga:BackupManga[];categories:string[]};
export type LocalManga=Omit<BackupManga,'chapters'>&{id:number;chapters:(BackupChapter&{id:number})[]};
export type MangaRestorePlan={rows:{identity:string;sourceId:string;title:string;state:'ready'|'missing'|'unchanged'|'limit';matched:number;unmatched:number;kept:number;categoryNames:string[]}[];changes:{id:number;identity:string;changes:MangaProgressPatch[]}[]};

function object(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('object');
  return value as Record<string,unknown>;
}
function exact(row:Record<string,unknown>,fields:string[]){
  if(Object.keys(row).length!==fields.length||fields.some(key=>!Object.prototype.hasOwnProperty.call(row,key)))throw Error('fields');
}
function label(value:unknown,max:number):string{
  if(typeof value!=='string'||!value.trim()||[...value].length>max||/[\x00-\x1f\x7f-\x9f]|:\/\//.test(value))throw Error('label');
  return value;
}
function identity(value:unknown):string{
  if(typeof value!=='string'||!HASH.test(value))throw Error('identity');return value;
}
function integer(value:unknown,min=0):number{
  if(typeof value!=='number'||!Number.isInteger(value)||value<min||value>2147483647)throw Error('integer');return value;
}
function bool(value:unknown):boolean{
  if(typeof value!=='boolean')throw Error('boolean');return value;
}
function long(value:unknown,nonnegative=false):string{
  if(typeof value!=='string'||!(/^(0|-?[1-9]\d{0,18})$/).test(value))throw Error('long');
  const n=BigInt(value);
  if(n<(nonnegative?0n:-9223372036854775808n)||n>9223372036854775807n)throw Error('long');
  return value;
}
function distinct<T>(rows:T[],key:(row:T)=>string|number):T[]{
  if(new Set(rows.map(key)).size!==rows.length)throw Error('duplicate');return rows;
}
function parseChapter(raw:unknown,native:false):BackupChapter;
function parseChapter(raw:unknown,native:true):BackupChapter&{id:number};
function parseChapter(raw:unknown,native:boolean):BackupChapter|BackupChapter&{id:number}{
  const row=object(raw);exact(row,['identity','name','isRead','isBookmarked','lastPageRead','pageCount','lastReadAt',...(native?['id']:[])]);
  const chapter={identity:identity(row.identity),name:label(row.name,500),isRead:bool(row.isRead),isBookmarked:bool(row.isBookmarked),
    lastPageRead:integer(row.lastPageRead),pageCount:integer(row.pageCount),lastReadAt:long(row.lastReadAt,true)};
  return native?{...chapter,id:integer(row.id,1)}:chapter;
}
function parseManga(raw:unknown,native:false):BackupManga;
function parseManga(raw:unknown,native:true):LocalManga;
function parseManga(raw:unknown,native:boolean):BackupManga|LocalManga{
  const row=object(raw);exact(row,['identity','sourceId','title','categories','chapters',...(native?['id']:[])]);
  if(!Array.isArray(row.categories)||row.categories.length>100||!Array.isArray(row.chapters)||row.chapters.length>MAX_TITLE_CHAPTERS)throw Error('count');
  const base={identity:identity(row.identity),sourceId:long(row.sourceId),title:label(row.title,500),categories:distinct(row.categories.map(x=>label(x,80)),x=>x)};
  if(native)return {...base,id:integer(row.id,1),chapters:distinct(distinct(row.chapters.map(x=>parseChapter(x,true)),x=>x.identity),x=>x.id)};
  return {...base,chapters:distinct(row.chapters.map(x=>parseChapter(x,false)),x=>x.identity)};
}
export function parseMangaBackup(text:string):MangaBackup{
  if(new TextEncoder().encode(text).length>MANGA_BACKUP_LIMIT)throw Error('size');
  const root=object(JSON.parse(text));
  if(root.format!=='tsugi-manga-progress'||(root.version!==1&&root.version!==2)||!Array.isArray(root.manga)||root.manga.length>MAX_TITLES)throw Error('format');
  exact(root,['format','version','manga',...(root.version===2?['categories']:[])]);
  const manga=distinct(root.manga.map(x=>parseManga(x,false)),x=>x.identity);
  if(manga.reduce((sum,row)=>sum+row.chapters.length,0)>MAX_CHAPTERS)throw Error('chapter-count');
  if(root.version===2){
    if(!Array.isArray(root.categories)||root.categories.length>100)throw Error('categories');
    const categories=distinct(root.categories.map(x=>label(x,80)),x=>x);
    const names=new Set(categories);
    if(manga.some(row=>row.categories.some(name=>!names.has(name))))throw Error('category-snapshot-changed');
    return {format:'tsugi-manga-progress',version:2,manga,categories};
  }
  return {format:'tsugi-manga-progress',version:1,manga};
}
export function snapshotManga(local:LocalManga[],categories?:string[]):MangaBackup{
  const manga=local.map(({id:_id,chapters,...row})=>({...row,chapters:chapters.filter(c=>c.isRead||c.isBookmarked||c.lastPageRead>0||c.lastReadAt!=='0').map(({id:_chapterId,...chapter})=>chapter)}));
  return parseMangaBackup(JSON.stringify(categories===undefined?{format:'tsugi-manga-progress',version:1,manga}:{format:'tsugi-manga-progress',version:2,manga,categories}));
}
export async function loadLocalManga(id:number):Promise<LocalManga>{
  const {readRequest}=await import('../hosts/shell/reading');
  const row=parseManga(await readRequest<unknown>({kind:'backup-manga',id}),true);
  if(row.id!==id)throw Error('manga-changed');
  return row;
}
export async function collectLocalManga(onProgress?:(done:number,total:number)=>void):Promise<LocalManga[]>{
  const {readRequest}=await import('../hosts/shell/reading');
  const ids:number[]=[];
  let total:number|undefined;
  do{
    const result=await readRequest<{nodes:{id:number|string}[];totalCount:number}>(ids.length?{kind:'library-page',offset:ids.length}:{kind:'library'});
    const count=integer(result.totalCount);
    if(count>MAX_TITLES||(total!==undefined&&count!==total)||!Array.isArray(result.nodes)||result.nodes.length+ids.length>count||(!result.nodes.length&&ids.length<count))throw Error('library-changed');
    total=count;
    for(const node of result.nodes){
      const id=typeof node.id==='string'&&/^[1-9]\d{0,9}$/.test(node.id)?Number(node.id):node.id;
      ids.push(integer(id,1));
    }
  }while(ids.length<total);
  distinct(ids,x=>x);
  const local:LocalManga[]=[];let chapterCount=0;
  for(const id of ids){
    const row=await loadLocalManga(id);
    if((chapterCount+=row.chapters.length)>MAX_CHAPTERS)throw Error('snapshot-limit');
    local.push(row);onProgress?.(local.length,ids.length);
  }
  return distinct(local,x=>x.identity);
}
export function planMangaRestore(backup:MangaBackup,local:LocalManga[]):MangaRestorePlan{
  const verified=parseMangaBackup(JSON.stringify(backup));
  const targets=new Map(distinct(local,x=>x.identity).map(x=>[x.identity,x]));
  const plan:MangaRestorePlan={rows:[],changes:[]};
  for(const row of verified.manga){
    const target=targets.get(row.identity);
    const report:MangaRestorePlan['rows'][number]={identity:row.identity,sourceId:row.sourceId,title:row.title,state:'missing',matched:0,unmatched:0,kept:0,categoryNames:row.categories};
    plan.rows.push(report);
    if(!target||target.sourceId!==row.sourceId){report.unmatched=row.chapters.length;continue;}
    const current=new Map(target.chapters.map(c=>[c.identity,c]));
    const changes:MangaProgressPatch[]=[];
    for(const old of row.chapters){
      const now=current.get(old.identity);
      if(!now){report.unmatched++;continue;}
      report.matched++;
      const recent=BigInt(old.lastReadAt)>=BigInt(now.lastReadAt);
      // Completion and partial positions are additive only. An older backup
      // cannot mark a more recently visited chapter read; bookmarks are unioned.
      const markRead=recent&&old.isRead&&!now.isRead;
      const bookmark=old.isBookmarked&&!now.isBookmarked;
      const page=recent&&!now.isRead&&!old.isRead&&old.pageCount===now.pageCount&&old.lastPageRead>now.lastPageRead&&old.lastPageRead<now.pageCount?old.lastPageRead:undefined;
      if((old.isRead&&!now.isRead&&!markRead)||(old.lastPageRead>now.lastPageRead&&!markRead&&page===undefined))report.kept++;
      if(markRead||bookmark||page!==undefined)changes.push({identity:now.identity,expectedRead:now.isRead,expectedBookmarked:now.isBookmarked,expectedLastPage:now.lastPageRead,expectedPageCount:now.pageCount,expectedLastReadAt:now.lastReadAt,markRead,bookmark,...(page!==undefined?{page}:{})});
    }
    if(changes.length>MAX_PATCHES){report.state='limit';continue;}
    report.state=changes.length?'ready':'unchanged';
    if(changes.length)plan.changes.push({id:target.id,identity:target.identity,changes});
  }
  return plan;
}

/** Source IDs are signed 64-bit decimal strings, including the local-source ID 0.
 * The runtime currently returns at most 100 sources, so absence is conclusive
 * only for a complete, valid inventory.
 */
export function missingTitleSources(plan:MangaRestorePlan, inventory:unknown) {
  const counts=new Map<string,number>();
  for(const row of plan.rows){
    if(row.state==='missing')counts.set(row.sourceId,(counts.get(row.sourceId)??0)+1);
  }
  const installed=new Set<string>();
  let complete=false;
  try {
    const raw=object(inventory);
    if(Array.isArray(raw.nodes) && raw.nodes.length<=100){
      for(const item of raw.nodes)installed.add(long(object(item).id));
      complete=integer(raw.totalCount)===raw.nodes.length && installed.size===raw.nodes.length;
    }
  } catch { complete=false; }
  return Array.from(counts,([id,titles])=>({
    id,titles,status:installed.has(id)?'installed' as const:complete?'missing' as const:'unknown' as const,
  }));
}
