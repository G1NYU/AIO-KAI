import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { MediaRow } from '@/components/media/media-row';
import { PosterCard } from '@/components/media/cards';
import { publicAddonPoster, type CatalogPage } from '@/lib/hosts/shell/stremio';

type Item=CatalogPage['items'][number];
type Feed='airing'|'popular'|'films'|'romance'|'upcoming';
type FeedResult={items:Item[];expires:number};
const cache=new Map<Feed,FeedResult>();
// eslint-disable-next-line lingui/no-unlocalized-strings -- External API rating enum.
const safeRatings=new Set(['G - All Ages','PG - Children','PG-13 - Teens 13 or older','R - 17+ (violence & profanity)']);
// eslint-disable-next-line lingui/no-unlocalized-strings -- External API format enum.
const formats=new Set(['TV','TV Special','OVA','ONA','Special','Movie']);
function object(value:unknown):Record<string,unknown>{
  return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
}
function text(value:unknown,limit:number):string|undefined{
  if(typeof value!=='string')return undefined;
  const result=value.trim();
  return result&&result.length<=limit&&!Array.from(result).some(char=>{const code=char.charCodeAt(0);return code<32&&code!==9&&code!==10&&code!==13||code===127;})?result:undefined;
}
/** These are discovery identities, never guessed episode IDs or media URLs. */
export function parsePublicAnime(value:unknown,films=false):Item[]{
  const data=object(value).data;
  if(!Array.isArray(data)||data.length>25)throw new Error('anime-response');
  const seen=new Set<number>();
  return data.flatMap(raw=>{
    const item=object(raw),id=item.mal_id,type=String(item.type),rating=String(item.rating);
    if(typeof id!=='number'||!Number.isSafeInteger(id)||id<1||id>2147483647||seen.has(id)||!safeRatings.has(rating)||!formats.has(type)||films&&type!=='Movie')return [];
    const name=text(item.title_english,512)??text(item.title,512);
    if(!name)return [];
    const images=object(item.images),jpg=object(images.jpg),webp=object(images.webp);
    // Keep the API's reviewed same-title variants. A valid CDN URL can still 404.
    const [poster,...posterAlternatives]=[...new Set([webp.large_image_url,jpg.large_image_url,webp.image_url,jpg.image_url].map(publicAddonPoster).filter((url):url is string=>!!url))];
    const description=text(item.synopsis,4096);
    seen.add(id);
    return [{id:'mal:'+id,mediaType:type==='Movie'?'movie':'series',name,...(poster?{poster}:{}),...(posterAlternatives.length?{posterAlternatives}:{}),...(description?{description}:{})}];
  });
}
async function load(feed:Feed,signal:AbortSignal):Promise<Item[]>{
  const hit=cache.get(feed);
  if(hit&&hit.expires>Date.now())return hit.items;
  const endpoint=feed==='airing'?'seasons/now?sfw=true&limit=25':feed==='popular'?'top/anime?filter=bypopularity&sfw=true&limit=25':feed==='films'?'top/anime?type=movie&sfw=true&limit=25':feed==='romance'?'anime?genres=22&order_by=score&sort=desc&sfw=true&limit=25':'seasons/upcoming?sfw=true&limit=25';
  const items=await requestPublicAnime(endpoint,feed==='films',signal);
  if(!signal.aborted)cache.set(feed,{items,expires:Date.now()+600000});
  return items;
}
async function requestPublicAnime(endpoint:string,films:boolean,signal:AbortSignal):Promise<Item[]>{
  const response=await fetch('https://api.tenrai.org/v1/'+endpoint,{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.any([signal,AbortSignal.timeout(12000)])});
  if(!response.ok)throw new Error('anime-request');
  const raw=await response.text();
  if(raw.length>2000000)throw new Error('anime-response');
  return parsePublicAnime(JSON.parse(raw),films);
}
/** Public title-only search: no account, profile, history or addon credentials.
 * The documented Tenrai query limit is 300 characters. Playback still resolves
 * the selected MAL identity through the existing reviewed metadata path. */
export function searchPublicAnime(query:string,films:boolean,signal:AbortSignal){
  const q=query.trim().slice(0,300);
  if(!q)return Promise.resolve([]);
  const params=new URLSearchParams({q,sfw:'true',limit:'25'});
  if(films)params.set('type','movie');
  return requestPublicAnime('anime?'+params.toString(),films,signal);
}
export function PublicAnimeDiscovery({filmsOnly=false,seasonal=false,active,busy,openTitle,onFeatured}:{filmsOnly?:boolean;seasonal?:boolean;active:boolean;busy:boolean;openTitle(item:Item):void;onFeatured?(items:Item[]):void}){
  const feeds:Feed[]=filmsOnly?['films']:seasonal?['airing','upcoming']:['airing','popular','films','romance','upcoming'];
  const [rows,setRows]=React.useState<Partial<Record<Feed,Item[]>>>({});
  const [errors,setErrors]=React.useState<Feed[]>([]);
  const [retry,setRetry]=React.useState(0);
  React.useEffect(()=>{
    if(!active)return;
    const controller=new AbortController();
    const requested:Feed[]=filmsOnly?['films']:seasonal?['airing','upcoming']:['airing','popular','films','romance','upcoming'];
    void (async()=>{
      for(const feed of requested){
        if(controller.signal.aborted)return;
        try{
          const items=await load(feed,controller.signal);
          if(!controller.signal.aborted){setRows(old=>({...old,[feed]:items}));setErrors(old=>old.filter(key=>key!==feed));}
        }catch{if(!controller.signal.aborted)setErrors(old=>old.includes(feed)?old:[...old,feed]);}
        if(!controller.signal.aborted)await new Promise(resolve=>setTimeout(resolve,1250));
      }
    })();
    return()=>controller.abort();
  },[active,filmsOnly,seasonal,retry]);
  React.useEffect(()=>{if(active&&onFeatured&&rows.airing?.length)onFeatured(rows.airing.slice(0,4));},[active,onFeatured,rows.airing]);
  return <section className="space-y-6" data-ui="anime-public-discovery">
    {feeds.filter(feed=>rows[feed]?.length!==0).map(feed=><div key={feed}>
      <MediaRow shape="poster" title={feed==='airing'?t`Airing now`:feed==='popular'?t`Popular anime`:feed==='films'?t`Anime films`:feed==='romance'?t`Romance anime`:t`Upcoming season`} loading={!rows[feed]&&!errors.includes(feed)}>
        {rows[feed]?.map(item=><PosterCard key={item.id} title={item.name} image={item.poster?[item.poster,...(item.posterAlternatives??[])]:null} itemType={item.mediaType==='movie'?t`Movie`:t`Series`} disabled={busy} onClick={()=>openTitle(item)}/>)}
      </MediaRow>
      {errors.includes(feed)&&<p className="text-sm text-[--muted]"><Trans>Public anime catalogue unavailable.</Trans> <button type="button" className="tsugi-read-action" onClick={()=>{setErrors([]);setRetry(n=>n+1);}}><Trans>Retry</Trans></button></p>}
    </div>)}
    <p className="text-sm text-[--muted]"><Trans>Anime discovery by Tenrai / MyAnimeList. No account or addon is required to browse. Playback uses your connected sources.</Trans></p>
  </section>;
}
