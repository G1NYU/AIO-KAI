import React from 'react';
import { storage } from '@/lib/storage';
import { loadTmdbTitle,loadTmdbSeason,publicAddonPoster,type WatchProgress } from './stremio';
import { cover as loadExactMalCover } from '@/components/shell/anime-cover';
import { watchEpisodeNumbers } from './watch-presentation';
type Identity=Pick<WatchProgress,'mediaType'|'itemId'|'videoId'>;
const key=(p:Identity)=>JSON.stringify([p.mediaType,p.itemId,p.videoId]);
const cacheKey=(profileId:number)=>'tsugi-watch-artwork-v2:'+profileId;
const maxEntries=150,maxImages=12;
function artworkCandidates(images:unknown[]):string[]{
  return [...new Set(images.map(publicAddonPoster).filter((url):url is string=>!!url))].slice(0,maxImages);
}
function cache(profileId:number):Record<string,string[]>{
  // Read the old single-URL cache on upgrade without overwriting it.
  const data=storage.get<unknown>(cacheKey(profileId))??storage.get<unknown>('tsugi-watch-artwork-v1:'+profileId);
  if(!data||typeof data!=='object'||Array.isArray(data))return {};
  return Object.fromEntries(Object.entries(data).flatMap(([k,v])=>{
    const urls=artworkCandidates(Array.isArray(v)?v.slice(0,maxImages):[v]);
    return urls.length?[[k,urls] as const]:[];
  }).slice(-maxEntries));
}
export function rememberWatchArtwork(profileId:number,p:Identity,...images:(string|undefined|null)[]){
  const urls=artworkCandidates(images);
  if(!urls.length)return;
  const rows=cache(profileId),id=key(p);
  const retained=artworkCandidates([...urls,...(rows[id]??[])]);
  delete rows[id];
  storage.set(cacheKey(profileId),Object.fromEntries(Object.entries({...rows,[id]:retained}).slice(-maxEntries)));
}
function fallback(p:Identity){
  return /^tt[0-9]{1,12}$/.test(p.itemId)?'https://images.metahub.space/background/medium/'+p.itemId+'/img':undefined;
}
// Existing public anime metadata origins; send only an explicit public title
// ID, never account data, history position, a title search or a stream URL.
async function exactAnimeCover(itemId:string,signal:AbortSignal):Promise<string|undefined>{
  const mal=/^mal:([1-9][0-9]{0,9})$/.exec(itemId);
  if(mal)return publicAddonPoster(await loadExactMalCover(Number(mal[1]),signal));
  const kitsu=/^kitsu:([1-9][0-9]{0,9})$/.exec(itemId);
  if(!kitsu)return undefined;
  try{
    const response=await fetch('https://relations.yuna.moe/api/ids?source=kitsu&id='+kitsu[1],{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.any([signal,AbortSignal.timeout(6000)])});
    if(!response.ok||signal.aborted)return undefined;
    const raw=await response.text();
    if(raw.length>16384)return undefined;
    const mapped=JSON.parse(raw),malId=Number(mapped?.myanimelist);
    if(Number(mapped?.kitsu)!==Number(kitsu[1])||!Number.isSafeInteger(malId)||malId<1||malId>2147483647)return undefined;
    return publicAddonPoster(await loadExactMalCover(malId,signal));
  }catch{return undefined;}
}
export function useResumeArtwork(profileId:number,rows:Identity[]){
  const signature=JSON.stringify(rows.map(p=>({mediaType:p.mediaType,itemId:p.itemId,videoId:p.videoId})).slice(0,12));
  const [revision,setRevision]=React.useState(0);
  React.useEffect(()=>{
    let current=true;
    const controller=new AbortController();
    const pending=(JSON.parse(signature) as Identity[]).filter(p=>!cache(profileId)[key(p)]);
    async function worker(){
      while(current&&pending.length){
        const p=pending.shift()!;
        let images:(string|undefined)[]=[];
        try{
          const title=await loadTmdbTitle(profileId,p.mediaType,p.itemId);
          if(!current)return;
          let still:string|undefined;
          const episode=watchEpisodeNumbers(p);
          if(episode){
            try{const items=await loadTmdbSeason(profileId,title.tmdbId,episode.season);still=items.find(item=>item.episode===episode.episode)?.thumbnail;}catch{/* Title artwork remains valid. */}
          }
          images=[still,title.background,title.poster];
        }catch{/* Exact public title fallback below. */}
        if(!current)return;
        if(!artworkCandidates(images).length)images=[await exactAnimeCover(p.itemId,controller.signal)];
        if(current&&artworkCandidates(images).length){rememberWatchArtwork(profileId,p,...images);setRevision(n=>n+1);}
      }
    }
    void Promise.all(Array.from({length:Math.min(pending.length,3)},()=>worker()));
    return ()=>{current=false;controller.abort();};
  },[profileId,signature]);
  return React.useMemo(()=>{
    const saved=cache(profileId);
    return (p:Identity)=>{
      const urls=artworkCandidates([...(saved[key(p)]??[]),fallback(p)]);
      return urls.length?urls:null;
    };
  },[profileId,revision,signature]);
}
