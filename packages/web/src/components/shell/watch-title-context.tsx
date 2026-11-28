import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { MediaRow } from '@/components/media/media-row';
import { PosterCard } from '@/components/media/cards';
import { storage } from '@/lib/storage';
import { watchPosterSources } from '@/lib/watch-poster-pattern';
import { validWatchCountry, watchCountryFromLocales } from '@/lib/hosts/shell/watch-presentation';
import { loadTmdbCollection, loadTmdbWatchProviders, type CatalogPage, type TmdbTitle, type TmdbCollection, type TmdbRegionAvailability, type TmdbAvailabilityMode } from '@/lib/hosts/shell/stremio';

function regionName(country:string){
  try{return new Intl.DisplayNames(navigator.languages,{type:'region'}).of(country)??country;}
  catch{return country;}
}

/** Optional metadata only. No stream request, playback grant, or new key.
 * The parent keys this component by profile and exact title identity. */
export function WatchTitleContext({profileId,cinema,posterPattern,busy,openTitle}:{profileId:number;cinema:TmdbTitle;posterPattern?:string;busy:boolean;openTitle(item:CatalogPage['items'][number]):void}){
  const [availability,setAvailability]=React.useState<TmdbRegionAvailability[]>([]);
  const [collection,setCollection]=React.useState<TmdbCollection|null>(null);
  const preferenceKey='tsugi-watch-availability-region-v1:'+profileId;
  const [country,setCountry]=React.useState(()=>{
    const saved=storage.get<unknown>(preferenceKey);
    return validWatchCountry(saved)?saved:watchCountryFromLocales(typeof navigator==='undefined'?[]:navigator.languages);
  });
  const tmdbId=cinema.tmdbId,mediaType=cinema.mediaType,collectionId=cinema.collectionId;
  React.useEffect(()=>{
    let current=true;
    setAvailability([]);
    void loadTmdbWatchProviders(profileId,mediaType,tmdbId).then(rows=>{if(current)setAvailability(rows);}).catch(()=>{});
    return ()=>{current=false;};
  },[profileId,mediaType,tmdbId]);
  React.useEffect(()=>{
    let current=true;
    setCollection(null);
    if(mediaType==='movie'&&collectionId!==undefined)void loadTmdbCollection(profileId,collectionId,tmdbId).then(row=>{if(current)setCollection(row);}).catch(()=>{});
    return ()=>{current=false;};
  },[profileId,mediaType,tmdbId,collectionId]);
  const regions=availability.map(row=>({row,label:regionName(row.country)})).sort((a,b)=>a.label.localeCompare(b.label));
  const selected=availability.find(row=>row.country===country);
  const modes:{value:TmdbAvailabilityMode;label:string}[]=[{value:'flatrate',label:t`Subscription`},{value:'free',label:t`Free`},{value:'ads',label:t`With ads`},{value:'rent',label:t`Rent`},{value:'buy',label:t`Buy`}];
  return <>
    {availability.length>0&&<section className="tsugi-watch-availability" data-ui="watch-availability">
      <div className="tsugi-watch-availability-heading"><h4><Trans>Where to watch</Trans></h4><select className="tsugi-menu-select" aria-label={t`Availability region`} value={selected?country:''} onChange={event=>{const value=event.target.value;setCountry(value);if(validWatchCountry(value))storage.set(preferenceKey,value);else storage.remove(preferenceKey);}}>
        <option value=""><Trans>Select region</Trans></option>{regions.map(({row,label})=><option key={row.country} value={row.country}>{label}</option>)}
      </select></div>
      {selected?<div className="tsugi-watch-availability-groups">{modes.map(({value,label})=>selected.providers[value].length>0&&<div key={value} data-provider-mode={value}>
        <h5>{label}</h5><ul>{selected.providers[value].map(provider=><li key={provider.id} data-ui="watch-availability-provider">
          {provider.logo&&<img src={provider.logo} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer"/>}<span>{provider.name}</span>
        </li>)}</ul>
      </div>)}</div>:<p className="tsugi-watch-muted"><Trans>Select a listed region to see reported availability.</Trans></p>}
      <p className="tsugi-watch-muted"><Trans>Availability data: JustWatch via TMDB. These listings are separate from your installed addon streams.</Trans></p>
    </section>}
    {!!collection?.items.length&&<section data-ui="watch-franchise" className="min-w-0 pt-4">
      <MediaRow contained shape="poster" title={collection.name}>
        {collection.items.map(item=><PosterCard key={item.id} title={item.name} image={watchPosterSources(item,posterPattern)} subtitle={item.releaseInfo?.slice(0,4)} badge={item.tmdbRating!==undefined&&item.tmdbRating>0?<><Trans>TMDB</Trans> {item.tmdbRating.toFixed(1)}</>:undefined} disabled={busy} onClick={()=>openTitle(item)}/>)}
      </MediaRow>
    </section>}
  </>;
}
