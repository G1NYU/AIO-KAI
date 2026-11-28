/* eslint-disable lingui/no-unlocalized-strings -- TVmaze protocol fields, fixed errors and URLs. */
import type { CatalogPage } from './stremio';

type Item=CatalogPage['items'][number];
export type SeriesFeed='streaming-today'|'streaming-tomorrow'|'broadcast-us'|'broadcast-gb'|'broadcast-ca'|'broadcast-au';
export const seriesCategories=['korean-dramas','drama','crime','thriller','comedy','science-fiction','fantasy','romance','action','mystery','documentaries'] as const;
export type SeriesCategory=typeof seriesCategories[number];
type ShowRow={item:Item;genres:string[];country:string;language:string;kind:string;rating:number};
type CategoryRows=Record<SeriesCategory,Item[]>;
const origin='https://api.tvmaze.com';
const limit=4*1024*1024;
const cache=new Map<string,{expires:number;rows:ShowRow[]}>();
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
function parseRows(value:unknown):ShowRow[]{
  if(!Array.isArray(value)||value.length>10000)throw new Error('tvmaze-response');
  const seen=new Set<string>(),items:ShowRow[]=[];
  for(const entry of value){
    const row=object(entry),show=object(row.show??object(row._embedded).show??row),external=object(show.externals);
    const id=external.imdb,name=clean(show.name,512);
    if(typeof id!=='string'||!/^tt[0-9]{1,12}$/.test(id)||!name||seen.has(id))continue;
    if(show.type==='Animation'&&Array.isArray(show.genres)&&show.genres.includes('Anime'))continue;
    if(Array.isArray(show.genres)&&show.genres.some(g=>g==='Anime'||g==='Adult'))continue;
    if(show.type!=='Scripted'&&show.type!=='Animation'&&show.type!=='Documentary')continue;
    const images=object(show.image),art=poster(images.medium)??poster(images.original);
    const premiered=typeof show.premiered==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(show.premiered)?show.premiered:undefined;
    seen.add(id);
    const network=object(show.network),channel=object(show.webChannel);
    const country=clean(object(network.country).code??object(channel.country).code,2)??'';
    const language=clean(show.language,64)??'';
    const genres=Array.isArray(show.genres)?show.genres.filter((g):g is string=>typeof g==='string'&&g.length<=64):[];
    const score=object(show.rating).average;
    const rating=typeof score==='number'&&Number.isFinite(score)&&score>=0&&score<=10?score:0;
    items.push({item:{id,imdbId:id,mediaType:'series',name,poster:art,releaseInfo:premiered},genres,country,language,kind:show.type,rating});
  }
  return items;
}
export function parseTvmaze(value:unknown):Item[]{return parseRows(value).slice(0,40).map(row=>row.item);}

function buildCategories(rows:ShowRow[]):CategoryRows{
  const byId=new Map<string,ShowRow>();
  for(const row of rows){
    const previous=byId.get(row.item.id);
    if(!previous||(!previous.item.poster&&row.item.poster))byId.set(row.item.id,row);
  }
  const ranked=[...byId.values()].sort((a,b)=>Number(!!b.item.poster)-Number(!!a.item.poster)||b.rating-a.rating||String(b.item.releaseInfo??'').localeCompare(String(a.item.releaseInfo??''))||a.item.name.localeCompare(b.item.name));
  const genre=(name:string)=>ranked.filter(row=>row.genres.includes(name)).slice(0,40).map(row=>row.item);
  return {
    'korean-dramas':ranked.filter(row=>row.kind==='Scripted'&&(row.country==='KR'||row.language.toLowerCase()==='korean')).slice(0,40).map(row=>row.item),
    drama:genre('Drama'),crime:genre('Crime'),thriller:genre('Thriller'),comedy:genre('Comedy'),
    'science-fiction':genre('Science-Fiction'),fantasy:genre('Fantasy'),romance:genre('Romance'),action:genre('Action'),mystery:genre('Mystery'),
    documentaries:ranked.filter(row=>row.kind==='Documentary'||row.genres.includes('Documentary')).slice(0,40).map(row=>row.item)
  };
}
export function groupTvmazeShows(value:unknown):CategoryRows{return buildCategories(parseRows(value));}

function localDate(offset:number,now:Date){
  const date=new Date(now.getFullYear(),now.getMonth(),now.getDate()+offset);
  return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
}
export function tvmazeFeedPath(feed:SeriesFeed,now=new Date()){
  const date=localDate(feed==='streaming-tomorrow'?1:0,now);
  const countries:Partial<Record<SeriesFeed,string>>={'broadcast-us':'US','broadcast-gb':'GB','broadcast-ca':'CA','broadcast-au':'AU'};
  const country=countries[feed];
  if(country)return '/schedule?'+new URLSearchParams({country,date});
  return '/schedule/web?'+new URLSearchParams({date});
}
async function request(path:string,signal:AbortSignal):Promise<ShowRow[]>{
  const response=await fetch(origin+path,{credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(10000)])});
  if(response.status===404&&path.startsWith('/shows?page='))return [];
  if(!response.ok||!response.body)throw new Error('tvmaze-request');
  const reader=response.body.getReader(),decoder=new TextDecoder();
  let raw='',bytes=0;
  try{
    for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>limit)throw new Error('tvmaze-response');raw+=decoder.decode(value,{stream:true});}
    raw+=decoder.decode();
    return parseRows(JSON.parse(raw));
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
async function cachedRows(path:string,signal:AbortSignal):Promise<ShowRow[]>{
  const hit=cache.get(path);
  if(hit&&hit.expires>Date.now())return hit.rows;
  const rows=await request(path,signal);
  if(!signal.aborted){
    if(cache.size>=64)cache.delete(cache.keys().next().value!);
    cache.set(path,{rows,expires:Date.now()+(path.startsWith('/shows?page=')?86400000:600000)});
  }
  return rows;
}
export async function loadTvmazeFeed(feed:SeriesFeed,signal:AbortSignal):Promise<Item[]>{
  return (await cachedRows(tvmazeFeedPath(feed),signal)).slice(0,40).map(row=>row.item);
}
// Share one bounded sample of the TVmaze show index across every genre shelf.
// The public API pages by show ID, not popularity. Spaced pages include older
// and newer titles without downloading the complete database on app startup.
export async function loadTvmazeCategories(signal:AbortSignal,now=new Date()):Promise<{rows:CategoryRows;partial:boolean}>{
  const paths=[...Array.from({length:3},(_,i)=>'/schedule?'+new URLSearchParams({country:'KR',date:localDate(i,now)})),
    ...[0,1,2,10,30,60,100,160].map(page=>'/shows?page='+page)];
  const rows:ShowRow[]=[];let successes=0,partial=false;
  for(const path of paths){
    if(signal.aborted)throw new Error('tvmaze-aborted');
    try{rows.push(...await cachedRows(path,signal));successes++;}
    catch{if(signal.aborted)throw new Error('tvmaze-aborted');partial=true;}
  }
  if(!successes)throw new Error('tvmaze-request');
  return {rows:buildCategories(rows),partial};
}
export async function searchTvmaze(query:string,signal:AbortSignal):Promise<Item[]>{
  const q=query.trim().slice(0,300);
  return q?(await request('/search/shows?'+new URLSearchParams({q}),signal)).slice(0,40).map(row=>row.item):[];
}
