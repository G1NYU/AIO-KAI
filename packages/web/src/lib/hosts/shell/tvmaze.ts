/* eslint-disable lingui/no-unlocalized-strings -- TVmaze protocol fields, fixed errors and URLs. */
import type { CatalogPage } from './stremio';

type Item=CatalogPage['items'][number];
export type SeriesFeed='streaming-today'|'streaming-tomorrow'|'broadcast-us'|'broadcast-gb';
const origin='https://api.tvmaze.com';
const limit=4*1024*1024;
const cache=new Map<string,{expires:number;items:Item[]}>();
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const clean=(v:unknown,max:number)=>typeof v==='string'&&v.trim()&&v.trim().length<=max&&!/[\x00-\x1f\x7f]/.test(v)?v.trim():undefined;
function poster(v:unknown):string|undefined{
  if(typeof v!=='string'||v.length>512||/[\s\\]/.test(v))return undefined;
  try{
    const u=new URL(v);
    return u.protocol==='https:'&&u.hostname==='static.tvmaze.com'&&!u.port&&!u.username&&!u.password&&!u.hash&&!u.search&&/^\/uploads\/images\/(?:medium|original)_portrait\/[0-9]{1,8}\/[0-9]{1,12}\.(?:jpg|jpeg|png|webp)$/.test(u.pathname)?u.href:undefined;
  }catch{return undefined;}
}
/** Preserve real external IDs. A TVmaze show or episode number is NOT an
 * addon playback identity. Only shows with an explicit IMDb mapping enter Watch. */
export function parseTvmaze(value:unknown):Item[]{
  if(!Array.isArray(value)||value.length>10000)throw new Error('tvmaze-response');
  const seen=new Set<string>(),items:Item[]=[];
  for(const entry of value){
    const row=object(entry),show=object(row.show??object(row._embedded).show),external=object(show.externals);
    const id=external.imdb,name=clean(show.name,512);
    if(typeof id!=='string'||!/^tt[0-9]{1,12}$/.test(id)||!name||seen.has(id))continue;
    if(show.type==='Animation'&&Array.isArray(show.genres)&&show.genres.includes('Anime'))continue;
    if(Array.isArray(show.genres)&&show.genres.some(g=>g==='Anime'||g==='Adult'))continue;
    if(show.type!=='Scripted'&&show.type!=='Animation'&&show.type!=='Documentary')continue;
    const images=object(show.image),art=poster(images.medium)??poster(images.original);
    const premiered=typeof show.premiered==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(show.premiered)?show.premiered:undefined;
    seen.add(id);
    items.push({id,imdbId:id,mediaType:'series',name,poster:art,releaseInfo:premiered});
    if(items.length===40)break;
  }
  return items;
}
function localDate(offset:number,now:Date){
  const date=new Date(now.getFullYear(),now.getMonth(),now.getDate()+offset);
  return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
}
export function tvmazeFeedPath(feed:SeriesFeed,now=new Date()){
  const date=localDate(feed==='streaming-tomorrow'?1:0,now);
  if(feed==='broadcast-us'||feed==='broadcast-gb')return '/schedule?'+new URLSearchParams({country:feed==='broadcast-us'?'US':'GB',date});
  return '/schedule/web?'+new URLSearchParams({date});
}
async function request(path:string,signal:AbortSignal):Promise<Item[]>{
  const response=await fetch(origin+path,{credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(10000)])});
  if(!response.ok||!response.body)throw new Error('tvmaze-request');
  const reader=response.body.getReader(),decoder=new TextDecoder();
  let raw='',bytes=0;
  try{
    for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>limit)throw new Error('tvmaze-response');raw+=decoder.decode(value,{stream:true});}
    raw+=decoder.decode();
    return parseTvmaze(JSON.parse(raw));
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function loadTvmazeFeed(feed:SeriesFeed,signal:AbortSignal):Promise<Item[]>{
  const path=tvmazeFeedPath(feed),hit=cache.get(path);
  if(hit&&hit.expires>Date.now())return hit.items;
  const items=await request(path,signal);
  if(!signal.aborted){if(cache.size>=16)cache.clear();cache.set(path,{items,expires:Date.now()+600000});}
  return items;
}
export function searchTvmaze(query:string,signal:AbortSignal):Promise<Item[]>{
  const q=query.trim().slice(0,300);
  return q?request('/search/shows?'+new URLSearchParams({q}),signal):Promise.resolve([]);
}
