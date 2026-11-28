import React from 'react';

/** Exact imported MAL ID, never a fuzzy title search. Only safe-rated metadata
 * and the same MAL image CDN used by the Reader cover fallback are accepted. */
function record(value:unknown):Record<string,unknown>{
  return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
}
// Exact external API enum values, not translated interface text.
// eslint-disable-next-line lingui/no-unlocalized-strings
const SAFE_ANIME_RATINGS=new Set(['G - All Ages','PG - Children','PG-13 - Teens 13 or older']);
export function selectAnimeCover(payload:unknown,malId:number):string|undefined{
  const data=record(record(payload).data);
  if(data.mal_id!==malId||!SAFE_ANIME_RATINGS.has(String(data.rating)))return undefined;
  const images=record(data.images),jpg=record(images.jpg),webp=record(images.webp);
  for(const value of [webp.large_image_url,jpg.large_image_url,webp.image_url,jpg.image_url]){
    if(typeof value!=='string'||value.length>2048)continue;
    try{
      const url=new URL(value);
      if(url.protocol==='https:'&&url.hostname==='cdn.myanimelist.net'&&!url.port&&!url.username&&!url.password&&
        /^\/images\/anime\//.test(url.pathname)&&/\.(?:jpe?g|png|webp)$/i.test(url.pathname)&&!url.search&&!url.hash)return url.href;
    }catch{/* Unknown artwork is not rendered. */}
  }
  return undefined;
}

type Flight={controller:AbortController;promise:Promise<string|undefined>;users:number;settled:boolean};
const cached=new Map<number,{url?:string;expires:number}>();
const pending=new Map<number,Flight>();
let tail:Promise<unknown>=Promise.resolve(),lastRequest=0;
export function cover(malId:number,signal:AbortSignal):Promise<string|undefined>{
  if(signal.aborted||!Number.isSafeInteger(malId)||malId<1||malId>2147483647)return Promise.resolve(undefined);
  const hit=cached.get(malId);
  if(hit&&hit.expires>Date.now())return Promise.resolve(hit.url);
  let flight=pending.get(malId);
  if(!flight){
    if(pending.size>=32)return Promise.resolve(undefined);
    const controller=new AbortController();
    const request=tail.then(async()=>{
      if(controller.signal.aborted)return undefined;
      const wait=Math.max(0,lastRequest+1200-Date.now());
      if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
      if(controller.signal.aborted)return undefined;
      lastRequest=Date.now();
      let url:string|undefined;
      try{
        const response=await fetch('https://api.tenrai.org/v1/anime/'+malId,{
          credentials:'omit',referrerPolicy:'no-referrer',
          signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)]),
        });
        if(response.ok)url=selectAnimeCover(await response.json(),malId);
      }catch{/* Use the honest text-only title when metadata is unavailable. */}
      if(!controller.signal.aborted){
        cached.delete(malId);cached.set(malId,{url,expires:Date.now()+(url?3600000:300000)});
        while(cached.size>250)cached.delete(cached.keys().next().value!);
      }
      return controller.signal.aborted?undefined:url;
    });
    flight={controller,promise:request,users:0,settled:false};
    const current=flight;
    pending.set(malId,current);tail=request.catch(()=>undefined);
    void request.then(()=>{current.settled=true;},()=>{current.settled=true;}).finally(()=>{
      if(pending.get(malId)===current)pending.delete(malId);
    });
  }
  const current=flight;current.users++;
  return new Promise(resolve=>{
    let released=false;
    const release=()=>{
      if(released)return false;
      released=true;signal.removeEventListener('abort',abort);
      if(--current.users===0&&!current.settled){
        current.controller.abort();
        if(pending.get(malId)===current)pending.delete(malId);
      }
      return true;
    };
    const abort=()=>{if(release())resolve(undefined);};
    signal.addEventListener('abort',abort,{once:true});
    void current.promise.then(url=>{if(release())resolve(url);},()=>{if(release())resolve(undefined);});
  });
}
export function AnimeCover({malId,enabled}:{malId:number;enabled:boolean}){
  const ref=React.useRef<HTMLSpanElement>(null);
  const [url,setUrl]=React.useState<string>();
  const [failed,setFailed]=React.useState(false);
  React.useEffect(()=>{
    setUrl(undefined);setFailed(false);
    const node=ref.current;
    if(!enabled||!node)return;
    let controller:AbortController|undefined;
    const observer=new IntersectionObserver(entries=>{
      if(!entries.some(entry=>entry.isIntersecting)){controller?.abort();controller=undefined;return;}
      if(controller)return;
      const current=new AbortController();controller=current;
      void cover(malId,current.signal).then(result=>{if(!current.signal.aborted)setUrl(result);});
    });
    observer.observe(node);
    return ()=>{observer.disconnect();controller?.abort();};
  },[enabled,malId]);
  if(!enabled)return null;
  return <span ref={ref} className="tsugi-anime-cover" aria-hidden="true" data-ui="anime-cover">
    {url&&!failed&&<img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>}
  </span>;
}
