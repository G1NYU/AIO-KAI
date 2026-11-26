import type { MusicPlaylist, SavedMusicTrack, SavedCollectionIdentity } from '../music/library';
import { YOUTUBE_MUSIC_ID } from '../music/connections';

export const MUSIC_BACKUP_LIMIT = 4 * 1024 * 1024;
const KEY = 'tsugi-independent-playlists-v1';
const MAX_LISTS = 100;
const MAX_TRACKS = 1000;
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const VIDEO = /^[\w-]{11}$/;
const BROWSE = /^(?:MPRE|UC|VL|MPLA|OLAK5uy_)[\w-]{1,175}$/;
const PORTABLE = /^portable:[a-f\d-]{36}:\d{1,5}$/i;
const FAV = 'tsugi-saved-tracks';
export type MusicBackup = { format:'tsugi-music-library'; version:1; playlists:MusicPlaylist[] };
export type MusicMerge = { next:MusicPlaylist[]; addedLists:number; addedTracks:number; duplicates:number; conflicts:number; metadataOnly:number; blocked:boolean };

function obj(value:unknown):Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid-object');
  return value as Record<string,unknown>;
}
function allowed(value:Record<string,unknown>,keys:string[]) {
  if(Object.keys(value).some(key=>!keys.includes(key)))throw new Error('unknown-field');
}
function text(value:unknown,max:number,empty=false):string {
  // Free-text library metadata is user content. Reject obvious URLs/control
  // characters rather than treating an arbitrary provider response as safe.
  if(typeof value!=='string'||value.length>max||(!empty&&!value.trim())||
      /[\x00-\x1f\x7f]|:\/\/|(?:^|\s)(?:blob:|data:|bearer\s)/i.test(value))throw new Error('invalid-text');
  return value;
}
function listId(value:unknown):string {
  const id=text(value,120);
  if(id!==FAV&&!UUID.test(id))throw new Error('invalid-list-id');
  return id;
}
function publicCollection(value:unknown):SavedCollectionIdentity|undefined {
  if(value===undefined||value===null)return;
  const raw=obj(value);
  if(raw.sourceId!==YOUTUBE_MUSIC_ID||typeof raw.id!=='string'||!BROWSE.test(raw.id)||
    (raw.type!=='album'&&raw.type!=='playlist'&&raw.type!=='artist'))return;
  return {sourceId:YOUTUBE_MUSIC_ID,id:raw.id,type:raw.type};
}
function trackFields(raw:Record<string,unknown>) {
  const title=text(raw.title,220);
  const artist=text(raw.artist,220,true);
  const album=raw.album===undefined?undefined:text(raw.album,220,true);
  const duration=raw.duration;
  if(duration!==undefined&&(typeof duration!=='number'||!Number.isFinite(duration)||duration<0))throw new Error('duration');
  const isrc=typeof raw.isrc==='string'&&/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i.test(raw.isrc)?raw.isrc:undefined;
  return {title,artist,...(album?{album}:{}),...(typeof duration==='number'?{duration}:{}),...(isrc?{isrc}:{})};
}
function publicTrack(raw:Record<string,unknown>):boolean {
  return raw.sourceId===YOUTUBE_MUSIC_ID&&typeof raw.id==='string'&&VIDEO.test(raw.id);
}
function portableId(id:string,index:number) {
  // Saved tracks has a fixed non-UUID list id; use a fixed UUID namespace.
  return 'portable:'+(id===FAV?'00000000-0000-0000-0000-000000000000':id)+':'+index;
}
function project(raw:unknown,id:string,index:number):SavedMusicTrack {
  const t=obj(raw), fields=trackFields(t);
  if(publicTrack(t))return {...fields,id:t.id as string,sourceId:YOUTUBE_MUSIC_ID};
  // Non-native provider IDs, artwork and source URLs may be bearer-like.
  // A metadata-only entry uses title/artist/ISRC matching at playback time.
  return {...fields,artist:fields.artist||'—',id:portableId(id,index)};
}
function readRaw():MusicPlaylist[] {
  const raw=localStorage.getItem(KEY);
  if(raw===null)return [];
  const lists:unknown=JSON.parse(raw);
  if(!Array.isArray(lists)||lists.length>MAX_LISTS)throw new Error('invalid-library');
  const ids=new Set<string>();
  for(const item of lists){
    const row=obj(item), id=listId(row.id);
    text(row.name,80);
    if(ids.has(id)||!Array.isArray(row.tracks)||row.tracks.length>MAX_TRACKS)throw new Error('invalid-library');
    ids.add(id);
    for(const t of row.tracks){
      const track=obj(t);
      // Validate existing metadata without rewriting existing records.
      trackFields(track); text(track.id,350);
    }
  }
  return lists as MusicPlaylist[];
}
export function captureMusicBackup():MusicBackup {
  const playlists=readRaw().map(list=>{
    const collection=publicCollection(list.collection);
    return {id:list.id,name:list.name,tracks:list.tracks.map((t,i)=>project(t,list.id,i)),...(collection?{collection}:{})};
  });
  return parseMusicBackup(JSON.stringify({format:'tsugi-music-library',version:1,playlists}));
}
export function parseMusicBackup(data:string):MusicBackup {
  if(new TextEncoder().encode(data).length>MUSIC_BACKUP_LIMIT)throw new Error('size');
  const root=obj(JSON.parse(data));
  allowed(root,['format','version','playlists']);
  if(root.format!=='tsugi-music-library'||root.version!==1||!Array.isArray(root.playlists)||root.playlists.length>MAX_LISTS)throw new Error('format');
  const ids=new Set<string>();
  const playlists:MusicPlaylist[]=root.playlists.map(value=>{
    const row=obj(value);
    allowed(row,['id','name','tracks','collection']);
    const id=listId(row.id), name=text(row.name,80);
    if(ids.has(id)||!Array.isArray(row.tracks)||row.tracks.length>MAX_TRACKS)throw new Error('list');
    ids.add(id);
    const collection=publicCollection(row.collection);
    if(row.collection!==undefined){
      if(!collection)throw new Error('collection');
      allowed(obj(row.collection),['id','type','sourceId']);
    }
    const tracks:SavedMusicTrack[]=row.tracks.map(value=>{
      const raw=obj(value);allowed(raw,['id','title','artist','album','duration','isrc','sourceId']);
      const fields=trackFields(raw);
      if(raw.isrc!==undefined&&!fields.isrc)throw new Error('isrc');
      if(publicTrack(raw))return {...fields,id:raw.id as string,sourceId:YOUTUBE_MUSIC_ID};
      if(raw.sourceId!==undefined||typeof raw.id!=='string'||!PORTABLE.test(raw.id)||!fields.artist.trim())throw new Error('track-id');
      return {...fields,id:raw.id};
    });
    return {id,name,tracks,...(collection?{collection}:{})};
  });
  return {format:'tsugi-music-library',version:1,playlists};
}
function sameCollection(a:SavedCollectionIdentity|undefined,b:SavedCollectionIdentity|undefined) {
  return !!a&&!!b&&a.id===b.id&&a.sourceId===b.sourceId&&a.type===b.type;
}
function metadata(t:SavedMusicTrack) {return JSON.stringify([t.title,t.artist,t.album??'',t.isrc??'']);}
function identity(t:SavedMusicTrack) {return t.sourceId===YOUTUBE_MUSIC_ID&&VIDEO.test(t.id)?'yt:'+t.id:'meta:'+metadata(t);}

/** Merge only: no current collections or tracks are deleted or overwritten.
 * Counts reflect multiplicity, so intentional repeated tracks stay ordered. */
export function planMusicMerge(backup:MusicBackup,current=readRaw()):MusicMerge {
  const input=parseMusicBackup(JSON.stringify(backup));
  const next=current.map(list=>({...list,tracks:[...list.tracks]}));
  let addedLists=0,addedTracks=0,duplicates=0,conflicts=0,metadataOnly=0,blocked=false;
  for(const incoming of input.playlists){
    metadataOnly+=incoming.tracks.filter(t=>!t.sourceId).length;
    const byId=next.find(list=>list.id===incoming.id);
    const byCollection=incoming.collection&&next.find(list=>sameCollection(list.collection,incoming.collection));
    if((byId&&byCollection&&byId!==byCollection)||
      (byId?.collection&&incoming.collection&&!sameCollection(byId.collection,incoming.collection))){
      conflicts++;continue;
    }
    const target=byId??byCollection;
    if(!target){next.push({...incoming,tracks:[...incoming.tracks]});addedLists++;addedTracks+=incoming.tracks.length;continue;}
    const counts=new Map<string,number>(), metaCounts=new Map<string,number>();
    for(const t of target.tracks){
      const k=identity(t),m=metadata(t);
      counts.set(k,(counts.get(k)??0)+1);metaCounts.set(m,(metaCounts.get(m)??0)+1);
    }
    const used=new Set(target.tracks.map(t=>t.id));
    let serial=0;
    for(const t of incoming.tracks){
      const countsForTrack=t.sourceId?counts:metaCounts;
      const key=t.sourceId?identity(t):metadata(t);
      const n=countsForTrack.get(key)??0;
      if(n>0){countsForTrack.set(key,n-1);duplicates++;continue;}
      let id=t.id;
      if(!t.sourceId){
        while(used.has(id))id=portableId(target.id,serial++);
      }
      used.add(id);target.tracks.push({...t,id});addedTracks++;
    }
  }
  if(next.length>MAX_LISTS||next.some(list=>list.tracks.length>MAX_TRACKS))blocked=true;
  return {next,addedLists,addedTracks,duplicates,conflicts,metadataOnly,blocked};
}
export function previewMusicMerge(backup:MusicBackup) {
  const baseline=localStorage.getItem(KEY);
  return {...planMusicMerge(backup),baseline};
}
export function applyMusicMerge(backup:MusicBackup,baseline:string|null):'applied'|'stale'|'blocked' {
  try {
    if(localStorage.getItem(KEY)!==baseline)return 'stale';
    const result=planMusicMerge(backup);
    if(result.blocked||result.conflicts)return 'blocked';
    // Single localStorage write is atomic with respect to quota failure.
    localStorage.setItem(KEY,JSON.stringify(result.next));
    return 'applied';
  }catch{return 'blocked';}
}
