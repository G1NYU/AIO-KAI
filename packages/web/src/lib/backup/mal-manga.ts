import { validateMalEntries, mergeMalEntries, type MalEntry } from '../mal-collection';
import { isReaderIdentity } from '../../app/read/reader-preferences';

export type Link = { malId:number; mangaId:number; sourceId:string; identity:string };
type Collection = { raw:string|null; entries:MalEntry[]; links:Link[] };

const KEY='tsugi-mal-manga-v1';
export function sourceId(value:unknown):value is string{
  if(typeof value!=='string'||!(/^-?[1-9][0-9]{0,18}$/).test(value))return false;
  const n=BigInt(value);
  return n>=-9223372036854775808n&&n<=9223372036854775807n;
}
export function positive(value:unknown):value is number{
  return typeof value==='number'&&Number.isSafeInteger(value)&&value>0&&value<=2147483647;
}
export function decode(raw:string|null):Collection{
  if(raw===null)return {raw,entries:[],links:[]};
  if(raw.length>3*1024*1024||new TextEncoder().encode(raw).length>3*1024*1024)throw Error('mal-store');
  const data=JSON.parse(raw);
  if(!data||Object.keys(data).length!==3||data.version!==1||!Array.isArray(data.links))throw Error('mal-store');
  const entries=validateMalEntries(data.entries,'manga'), ids=new Set(entries.map(entry=>entry.malId));
  const linked=new Set<number>(), identities=new Set<string>();
  if(data.links.length>entries.length)throw Error('mal-store');
  const links:Link[]=data.links.map((row:unknown)=>{
    if(!row||typeof row!=='object'||Array.isArray(row))throw Error('mal-store');
    const r=row as Record<string,unknown>;
    if(Object.keys(r).length!==4||!positive(r.malId)||!ids.has(r.malId)||linked.has(r.malId)||
        !positive(r.mangaId)||!sourceId(r.sourceId)||!isReaderIdentity(r.identity)||identities.has(r.identity))throw Error('mal-store');
    linked.add(r.malId);identities.add(r.identity);
    return {malId:r.malId,mangaId:r.mangaId,sourceId:r.sourceId,identity:r.identity};
  });
  return {raw,entries,links};
}
export function load():Collection{return decode(localStorage.getItem(KEY));}
export function safeLoad():Collection|null{try{return load();}catch{return null;}}
export function persist(current:Collection,entries:MalEntry[],links:Link[]):Collection{
  if(localStorage.getItem(KEY)!==current.raw)throw Error('mal-stale');
  const next=decode(JSON.stringify({version:1,entries,links}));
  if(next.raw===null)throw Error('mal-store');
  localStorage.setItem(KEY,next.raw);
  if(localStorage.getItem(KEY)!==next.raw)throw Error('mal-store');
  return next;
}

export function captureMalManga() {
  const {entries, links} = load();
  return {version:1, entries, links};
}

export function reviewMalManga(payload:string) {
  const incoming = decode(payload);
  const current = load();
  const entries = mergeMalEntries(current.entries, incoming.entries, 'manga');
  const links = [...current.links];
  const assigned = new Set(links.map(link => link.malId));
  const identities = new Set(links.map(link => link.identity));
  for (const link of incoming.links) {
    if (assigned.has(link.malId) || identities.has(link.identity)) continue;
    links.push(link);
    assigned.add(link.malId);
    identities.add(link.identity);
  }
  decode(JSON.stringify({version:1,entries,links}));
  return {current, entries, links, added:entries.length-current.entries.length,
    assigned:links.length-current.links.length};
}
