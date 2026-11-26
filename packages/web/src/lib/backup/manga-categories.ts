import { loadLocalManga, parseMangaBackup, type LocalManga, type MangaBackup } from './manga';

export type LocalCategory={id:number;name:string};
type CategoryTarget={name:string;id:number|null};
export type CategoryAssignment={mangaId:number;identity:string;sourceId:string;name:string};
export type CategoryRestorePlan={
  baseline:string; create:string[]; reuse:CategoryTarget[]; assignments:CategoryAssignment[];
  conflicts:string[]; alreadyAssigned:number; unmatchedAssignments:number; blocked:boolean;
};
const MAX_CATEGORIES=99,MAX_ASSIGNMENTS=2000;
function key(name:string){return name.normalize('NFKC').trim().toLowerCase();}
function restorable(name:string){return name.trim()===name&&name.trim().length>0&&key(name)!=='default'&&[...name].length<=80&&!/[\x00-\x1f\x7f-\x9f]|:\/\//.test(name);}
function signature(categories:LocalCategory[]){return JSON.stringify(categories.map(({id,name})=>({id,name})).sort((a,b)=>a.id-b.id));}
export function parseLocalCategories(value:unknown):LocalCategory[]{
  if(!value||typeof value!=='object')throw Error('categories');
  const raw=value as {nodes?:unknown;totalCount?:unknown};
  if(!Array.isArray(raw.nodes)||raw.nodes.length>100||raw.totalCount!==raw.nodes.length)throw Error('incomplete-categories');
  const ids=new Set<number>(),out:LocalCategory[]=[];
  for(const item of raw.nodes){
    if(!item||typeof item!=='object')throw Error('category');
    const row=item as {id?:unknown;name?:unknown};
    if(typeof row.id!=='number'||!Number.isInteger(row.id)||row.id<0||row.id>2147483647||ids.has(row.id))throw Error('category-id');
    ids.add(row.id);
    if(row.id===0)continue;
    if(typeof row.name!=='string'||!row.name.trim()||[...row.name].length>80||/[\x00-\x1f\x7f-\x9f]|:\/\//.test(row.name))throw Error('category-name');
    out.push({id:row.id,name:row.name});
  }
  return out;
}
export async function collectLocalCategories():Promise<LocalCategory[]>{
  const {readRequest}=await import('../hosts/shell/reading');
  return parseLocalCategories(await readRequest<unknown>({kind:'categories'}));
}
export function planCategoryRestore(backup:MangaBackup,local:LocalManga[],existing:LocalCategory[]):CategoryRestorePlan{
  const verified=parseMangaBackup(JSON.stringify(backup));
  const names=verified.version===2?verified.categories:[...new Set(verified.manga.flatMap(row=>row.categories))];
  const oldGroups=new Map<string,string[]>(),newGroups=new Map<string,LocalCategory[]>();
  for(const name of names){const group=oldGroups.get(key(name));if(group)group.push(name);else oldGroups.set(key(name),[name]);}
  for(const item of existing){const group=newGroups.get(key(item.name));if(group)group.push(item);else newGroups.set(key(item.name),[item]);}
  const targets=new Map<string,CategoryTarget>();
  const plan:CategoryRestorePlan={baseline:signature(existing),create:[],reuse:[],assignments:[],conflicts:[],alreadyAssigned:0,unmatchedAssignments:0,blocked:false};
  for(const name of names){
    const candidates=newGroups.get(key(name))??[];
    if(!restorable(name)||oldGroups.get(key(name))!.length!==1||candidates.length>1||(candidates.length===1&&candidates[0].name!==name)){
      plan.conflicts.push(name);continue;
    }
    const target={name,id:candidates[0]?.id??null};
    targets.set(name,target);
    if(target.id===null)plan.create.push(name);else plan.reuse.push(target);
  }
  const byIdentity=new Map<string,LocalManga[]>();
  for(const row of local){const group=byIdentity.get(row.identity);if(group)group.push(row);else byIdentity.set(row.identity,[row]);}
  for(const row of verified.manga){
    const matches=byIdentity.get(row.identity)??[];
    const target=matches.length===1&&matches[0].sourceId===row.sourceId?matches[0]:undefined;
    for(const name of row.categories){
      if(!targets.has(name)||!target){plan.unmatchedAssignments++;continue;}
      if(target.categories.includes(name)){plan.alreadyAssigned++;continue;}
      plan.assignments.push({mangaId:target.id,identity:target.identity,sourceId:target.sourceId,name});
    }
  }
  plan.blocked=(plan.create.length>0&&existing.length+plan.create.length>MAX_CATEGORIES)||plan.assignments.length>MAX_ASSIGNMENTS||names.length>100;
  return plan;
}
export type CategoryRestoreResult={created:number;assigned:number;alreadyAssigned:number;complete:boolean};
/** Existing operations are additive. Revalidate the category inventory and
 * exact title identities before mutation, then verify every upstream result.
 * There is no cross-operation transaction; a failed step requires re-preview. */
export async function applyCategoryRestore(plan:CategoryRestorePlan):Promise<CategoryRestoreResult>{
  const {readRequest}=await import('../hosts/shell/reading');
  const result={created:0,assigned:0,alreadyAssigned:plan.alreadyAssigned,complete:false};
  try{
    if(plan.blocked||plan.create.length>MAX_CATEGORIES||plan.assignments.length>MAX_ASSIGNMENTS)throw Error('limit');
    const current=await collectLocalCategories();
    if(signature(current)!==plan.baseline)throw Error('stale-categories');
    const byId=new Map<number,LocalManga>();
    for(const assignment of plan.assignments){
      let row=byId.get(assignment.mangaId);
      if(!row){row=await loadLocalManga(assignment.mangaId);byId.set(assignment.mangaId,row);}
      if(row.identity!==assignment.identity||row.sourceId!==assignment.sourceId)throw Error('stale-manga');
    }
    const categories=new Map(plan.reuse.map(row=>[row.name,row.id]));
    for(const name of plan.create){
      const before=await collectLocalCategories();
      if(!restorable(name)||before.length>=MAX_CATEGORIES||before.some(row=>key(row.name)===key(name)))throw Error('category-changed');
      const response=await readRequest<{category:LocalCategory}>({kind:'save-category',name});
      const verified=await collectLocalCategories();
      const matches=verified.filter(row=>key(row.name)===key(name));
      if(matches.length!==1||matches[0].name!==name||matches[0].id!==response.category?.id)throw Error('category-create');
      categories.set(name,matches[0].id);result.created++;
    }
    for(const assignment of plan.assignments){
      const categoryId=categories.get(assignment.name);
      if(!categoryId)throw Error('category-missing');
      const currentCategories=await collectLocalCategories();
      const matching=currentCategories.filter(row=>key(row.name)===key(assignment.name));
      if(matching.length!==1||matching[0].id!==categoryId||matching[0].name!==assignment.name)throw Error('category-changed');
      const row=await loadLocalManga(assignment.mangaId);
      if(row.identity!==assignment.identity||row.sourceId!==assignment.sourceId)throw Error('stale-manga');
      if(row.categories.includes(assignment.name)){result.alreadyAssigned++;continue;}
      const response=await readRequest<{manga:{id:number;categories:{nodes:{id:number}[]}}}>({kind:'assign-category',mangaId:assignment.mangaId,categoryId,assigned:true});
      if(Number(response.manga?.id)!==assignment.mangaId||!response.manga.categories?.nodes.some(item=>item.id===categoryId))throw Error('category-assign');
      result.assigned++;
    }
    result.complete=true;
  }catch{/* report confirmed counts; a failed response may follow a committed write */}
  return result;
}
