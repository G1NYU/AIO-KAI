import type { CatalogPage } from './stremio';

type Item=CatalogPage['items'][number];
type Candidate<T>={item:Item;sourceId:number;target:T};

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
function identity(item:Item,sourceId:number){
  const kind=item.mediaType==='anime.movie'?'movie':item.mediaType==='anime.series'?'series':item.mediaType;
  const imdb=imdbIdentity(item);
  if(imdb&&['movie','series'].includes(kind))return JSON.stringify([kind,imdb]);
  if(/^(?:tmdb|kitsu|mal|anilist):[0-9]+$/.test(item.id))return JSON.stringify([item.mediaType,item.id]);
  // An unknown provider-local identifier is not a global media identity.
  return JSON.stringify([item.mediaType,sourceId,item.id]);
}

/** Merge only exact supported identities. The chosen item retains its actual
 * provider id and source route; artwork is borrowed only within that identity. */
export function rankCatalogueSearch<T>(candidates:Candidate<T>[],query:string){
  type Hit=Candidate<T>&{key:string;score:number;order:number};
  const needle=normalized(query),hits=new Map<string,Hit>();
  candidates.forEach((candidate,order)=>{
    const {item,sourceId}=candidate,key=identity(item,sourceId),score=rank(item.name,needle);
    const current=hits.get(key);
    if(!current){hits.set(key,{...candidate,key,score,order});return;}
    const canonical=imdbIdentity(item)===item.id,previousCanonical=imdbIdentity(current.item)===current.item.id;
    const prefer=score>current.score||score===current.score&&(canonical&&!previousCanonical||canonical===previousCanonical&&!current.item.poster&&!!item.poster);
    const chosen=prefer?candidate:current,other=prefer?current.item:item;
    hits.set(key,{...chosen,key,score:Math.max(score,current.score),order:current.order,item:{...chosen.item,
      poster:chosen.item.poster??other.poster,background:chosen.item.background??other.background,description:chosen.item.description??other.description}});
  });
  return [...hits.values()].sort((a,b)=>b.score-a.score||a.order-b.order);
}
