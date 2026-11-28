import type { CatalogPage } from './stremio';

type Item=CatalogPage['items'][number];
type Candidate<T>={item:Item;sourceId:number;target:T;providerMatch?:boolean};

function normalized(value:string){
  return value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
}
function rank(name:string,query:string){
  const title=normalized(name);
  if(!query)return 0;
  if(title===query)return 4;
  if(title.startsWith(query+' '))return 3;
  if(title.includes(query))return 2;
  return query.split(' ').every(word=>title.includes(word))?1:0;
}
function imdbIdentity(item:Item){
  if(/^tt[0-9]{1,12}$/.test(item.id))return item.id;
  return item.imdbId&&/^tt[0-9]{1,12}$/.test(item.imdbId)?item.imdbId:undefined;
}
function identities(item:Item,sourceId:number){
  const kind=item.mediaType==='anime.movie'?'movie':item.mediaType==='anime.series'?'series':item.mediaType;
  const values=new Map<string,string>(),imdb=imdbIdentity(item);
  if(imdb&&['movie','series'].includes(kind))values.set('imdb',imdb);
  for(const id of [item.id,...(item.identities??[])]){
    if(/^tt[0-9]{1,12}$/.test(id)&&['movie','series'].includes(kind)&&!values.has('imdb'))values.set('imdb',id);
    if(/^tmdb:(?:(?:movie|tv):)?[1-9][0-9]{0,9}$/.test(id)&&['movie','series'].includes(kind)&&!(kind==='movie'&&id.startsWith('tmdb:tv:')||kind==='series'&&id.startsWith('tmdb:movie:'))&&!values.has('tmdb'))values.set('tmdb','tmdb:'+id.split(':').at(-1));
    if(/^(?:kitsu|mal|anilist):[1-9][0-9]{0,9}$/.test(id)&&!values.has(id.split(':')[0]))values.set(id.split(':')[0],id);
  }
  if(!values.size)values.set('local',JSON.stringify([sourceId,item.id]));
  return {kind,values};
}
/** Query only overlapping TMDB titles for explicit cross-provider identity.
 * Similar spellings alone are never enough to merge two distinct works. */
export function searchAliasTargets(tmdb:Item[],addons:Item[]){
  return tmdb.filter(item=>!imdbIdentity(item)&&addons.some(addon=>{
    const a=identities(addon,1),b=identities(item,0);
    return a.kind===b.kind&&a.values.has('imdb')&&!a.values.has('tmdb')&&normalized(addon.name)===normalized(item.name);
  })).slice(0,4);
}
/** Reconcile exact aliases only. Preserve selected route and provider order;
 * never merge conflicts or simply titles with the same spelling. */
export function rankCatalogueSearch<T>(candidates:Candidate<T>[],query:string){
  type Hit=Candidate<T>&{key:string;score:number;order:number;kind:string;ids:Map<string,string>};
  const needle=normalized(query),hits:Hit[]=[];
  const compatible=(a:Map<string,string>,b:Map<string,string>)=>[...a].some(([k,v])=>b.get(k)===v)&&[...a].every(([k,v])=>!b.has(k)||b.get(k)===v);
  function combine(a:Hit,b:Hit):Hit{
    const canonical=(x:Hit)=>imdbIdentity(x.item)===x.item.id;
    const prefer=b.score>a.score||b.score===a.score&&(canonical(b)&&!canonical(a)||canonical(b)===canonical(a)&&!a.item.poster&&!!b.item.poster);
    const chosen=prefer?b:a,other=prefer?a:b;
    const ids=new Map([...a.ids,...b.ids]);
    return {...chosen,key:a.key,score:Math.max(a.score,b.score),order:Math.min(a.order,b.order),ids,item:{...chosen.item,
      poster:chosen.item.poster??other.item.poster,background:chosen.item.background??other.item.background,logo:chosen.item.logo??other.item.logo,
      description:chosen.item.description??other.item.description,releaseInfo:chosen.item.releaseInfo??other.item.releaseInfo,tmdbRating:chosen.item.tmdbRating??other.item.tmdbRating,
      imdbId:chosen.item.imdbId??other.item.imdbId??ids.get('imdb'),identities:[...new Set([...(chosen.item.identities??[]),...(other.item.identities??[]),...([...ids].filter(([k])=>k!=='local').map(([,v])=>v))])].slice(0,8)}};
  }
  candidates.forEach((candidate,order)=>{
    const {kind,values}=identities(candidate.item,candidate.sourceId);
    let next:Hit={...candidate,key:JSON.stringify([kind,candidate.sourceId,candidate.item.id]),score:rank(candidate.item.name,needle),order,kind,ids:values};
    if(needle&&next.score===0&&!candidate.providerMatch)return;
    for(let i=0;i<hits.length;){
      if(hits[i].kind===kind&&compatible(hits[i].ids,next.ids)){next=combine(hits[i],next);hits.splice(i,1);i=0;}else i++;
    }
    hits.push(next);
  });
  return hits.sort((a,b)=>b.score-a.score||a.order-b.order);
}
