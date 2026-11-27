import React from 'react';
import { storage } from '@/lib/storage';
import { loadTmdbTitle,loadTmdbSeason,publicAddonPoster,type WatchProgress } from './stremio';
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
export function useResumeArtwork(profileId:number,rows:Identity[]){
  const signature=JSON.stringify(rows.map(p=>({mediaType:p.mediaType,itemId:p.itemId,videoId:p.videoId})).slice(0,12));
  const [revision,setRevision]=React.useState(0);
  React.useEffect(()=>{
    let current=true;
    const pending=(JSON.parse(signature) as Identity[]).filter(p=>!cache(profileId)[key(p)]);
    async function worker(){
      while(current&&pending.length){
        const p=pending.shift()!;
        try{
          const title=await loadTmdbTitle(profileId,p.mediaType,p.itemId);
          if(!current)return;
          let still:string|undefined;
          const suffix=p.videoId.startsWith(p.itemId+':')?p.videoId.slice(p.itemId.length+1):'';
          const episode=/^([0-9]{1,3}):([0-9]{1,5})$/.exec(suffix);
          if(episode&&p.mediaType!=='movie'&&p.mediaType!=='anime.movie'){
            try{const items=await loadTmdbSeason(profileId,title.tmdbId,Number(episode[1]));still=items.find(item=>item.episode===Number(episode[2]))?.thumbnail;}catch{/* Title artwork remains valid. */}
          }
          if(current){rememberWatchArtwork(profileId,p,still,title.background,title.poster);setRevision(n=>n+1);}
        }catch{/* Unavailable provider: retain cached or exact IMDb fallback. */}
      }
    }
    void Promise.all(Array.from({length:Math.min(pending.length,3)},()=>worker()));
    return ()=>{current=false;};
  },[profileId,signature]);
  return React.useMemo(()=>{
    const saved=cache(profileId);
    return (p:Identity)=>{
      const urls=artworkCandidates([...(saved[key(p)]??[]),fallback(p)]);
      return urls.length?urls:null;
    };
  },[profileId,revision,signature]);
}
