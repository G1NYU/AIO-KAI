import type { AddonMetadata, AddonVideo, CatalogPage, VideoRoute } from './stremio';

type Title=CatalogPage['items'][number];
const publicId=/^(?:tt[0-9]{1,12}|tmdb:(?:(?:movie|tv):)?[1-9][0-9]{0,9}|(?:kitsu|mal|anilist):[1-9][0-9]{0,9})$/;
export function watchKind(kind:string){
  return kind==='anime.movie'?'movie':kind==='anime.series'?'series':kind;
}
export function isWatchMovie(kind:string){return watchKind(kind)==='movie';}
function routeKey(route:VideoRoute){return JSON.stringify([route.mediaType,route.videoId]);}
function uniqueRoutes(routes:VideoRoute[],primary:VideoRoute){
  const seen=new Set([routeKey(primary)]);
  return routes.filter(route=>{const key=routeKey(route);if(seen.has(key))return false;seen.add(key);return true;}).slice(0,8);
}
function identityNamespace(id:string){return id.startsWith('tt')?'imdb':id.split(':')[0];}
/** Explicit aliases only; no title/year heuristics and no fabricated episodes. */
export function titleIdentityRoutes(item:Title,metadata?:AddonMetadata|null):VideoRoute[]{
  const kind=watchKind(item.mediaType),routes:VideoRoute[]=[];
  if(kind!==item.mediaType)routes.push({mediaType:kind,videoId:item.id});
  const ids=[item.id,item.imdbId,...(item.identities??[]),...(metadata?.identities??[])].filter((id):id is string=>typeof id==='string'&&publicId.test(id));
  const accepted=new Map<string,string>();
  for(const id of ids){
    const namespace=identityNamespace(id);
    const previous=accepted.get(namespace);
    // The exact provider identity wins over a conflicting alias. Typed and
    // untyped TMDB forms with the same number may both be valid candidates.
    if(previous&&previous!==id&&!(namespace==='tmdb'&&previous.split(':').at(-1)===id.split(':').at(-1)))continue;
    accepted.set(namespace,previous??id);
    let mediaType=kind;
    if(kind==='anime'&&id.startsWith('tmdb:movie:'))mediaType='movie';
    if(kind==='anime'&&id.startsWith('tmdb:tv:'))mediaType='series';
    if(mediaType==='movie'&&id.startsWith('tmdb:tv:')||mediaType==='series'&&id.startsWith('tmdb:movie:'))continue;
    routes.push({mediaType,videoId:id});
  }
  return uniqueRoutes(routes,{mediaType:item.mediaType,videoId:item.id});
}

function episodeKey(video:AddonVideo){
  return video.season!==null&&video.episode!==null?JSON.stringify([video.season,video.episode]):null;
}
/** Caller has established an explicit title alias and both responses have
 * passed native metadata identity validation. Only unambiguous numbered
 * episodes are matched; alternate IDs must actually occur in the response. */
export function mergeAliasMetadata(base:AddonMetadata,other:AddonMetadata):AddonMetadata{
  const bothMovies=isWatchMovie(base.mediaType)&&isWatchMovie(other.mediaType);
  const videos=base.videos.map(video=>{
    const key=episodeKey(video);
    let match=other.videos.find(row=>row.id===video.id);
    if(!match&&bothMovies&&base.videos.length===1&&other.videos.length===1)match=other.videos[0];
    if(!match&&!bothMovies&&key!==null&&base.videos.filter(row=>episodeKey(row)===key).length===1){
      const candidates=other.videos.filter(row=>episodeKey(row)===key);
      if(candidates.length===1)match=candidates[0];
    }
    if(!match)return video;
    return {...video,thumbnail:video.thumbnail??match.thumbnail,description:video.description??match.description,
      routes:uniqueRoutes([...(video.routes??[]),{mediaType:other.mediaType,videoId:match.id},...(match.routes??[])],{mediaType:base.mediaType,videoId:video.id})};
  });
  return {...base,videos,description:base.description??other.description,poster:base.poster??other.poster,background:base.background??other.background,
    releaseInfo:base.releaseInfo??other.releaseInfo,runtime:base.runtime??other.runtime,imdbRating:base.imdbRating??other.imdbRating,
    genres:base.genres??other.genres,cast:base.cast??other.cast,directors:base.directors??other.directors,
    identities:[...new Set([...(base.identities??[]),...(other.identities??[])])].slice(0,8)};
}
export function watchVideoRoutes(item:Title,videoId:string,metadata:AddonMetadata|null):VideoRoute[]{
  const video=metadata?.videos.find(row=>row.id===videoId);
  const routes=[...(video?.routes??[])];
  // A verified movie title ID is a legal movie video ID. Never extend this
  // fallback to series or to distinct movie versions/trailers.
  if(isWatchMovie(item.mediaType)&&videoId===item.id&&(metadata?.videos.length??0)<=1)routes.push(...titleIdentityRoutes(item,metadata));
  return uniqueRoutes(routes,{mediaType:item.mediaType,videoId});
}

/** Follow actual numbered episodes, not arbitrary provider response order.
 * Specials stay separate; ambiguous or unnumbered slots require a selection. */
export function adjacentWatchVideo(videos:AddonVideo[],videoId:string,direction:1|-1):AddonVideo|undefined{
  const current=videos.find(video=>video.id===videoId);
  if(!current||current.season===null||current.episode===null)return undefined;
  const regular=current.season>0;
  const numbered=videos.filter(video=>video.season!==null&&video.episode!==null&&(regular?video.season>0:video.season===0));
  const compare=(a:AddonVideo,b:AddonVideo)=>(a.season??0)-(b.season??0)||(a.episode??0)-(b.episode??0);
  const ordered=numbered.filter(video=>direction*compare(video,current)>0).sort((a,b)=>direction*compare(a,b));
  const next=ordered[0];
  return next&&ordered.filter(video=>compare(video,next)===0).length===1?next:undefined;
}
