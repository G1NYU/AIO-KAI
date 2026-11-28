import type { CatalogPage, WatchProgress } from './stremio';
import { rankCatalogueSearch } from './watch-search';

type FeaturedCandidate<T>={item:CatalogPage['items'][number];sourceId:number;target:T};

/** Keep the existing route and merge only explicit aliases. Reserve a slot for
 * TV and movies if both are present, rather than letting one catalogue dominate. */
export function chooseWatchFeatured<T>(candidates:FeaturedCandidate<T>[]){
  const ranked=rankCatalogueSearch(candidates,'').filter(row=>!!(row.item.background||row.item.poster));
  const chosen=ranked.slice(0,8);
  for(const kind of ['series','movie']){
    if(chosen.some(row=>row.kind===kind))continue;
    const available=ranked.find(row=>row.kind===kind);
    if(!available)continue;
    for(let i=chosen.length-1;i>=0;i--){
      const current=chosen[i].kind;
      if(!['series','movie'].includes(current)||chosen.filter(row=>row.kind===current).length>1){chosen[i]=available;break;}
    }
  }
  return chosen;
}

/** Exact numbered episode suffixes only. An opaque provider ID is not a season. */
export function watchEpisodeNumbers(progress:Pick<WatchProgress,'mediaType'|'itemId'|'videoId'>){
  if(['movie','anime.movie'].includes(progress.mediaType)||!progress.videoId.startsWith(progress.itemId+':'))return undefined;
  const match=/^([0-9]{1,3}):([0-9]{1,5})$/.exec(progress.videoId.slice(progress.itemId.length+1));
  return match?{season:Number(match[1]),episode:Number(match[2])}:undefined;
}

export function watchResumePresentation(progress:WatchProgress){
  const duration=progress.durationMs,position=progress.positionMs;
  const valid=Number.isFinite(duration)&&duration>0&&Number.isFinite(position)&&position>=0;
  return {
    numbers:watchEpisodeNumbers(progress),
    percent:valid?Math.max(0,Math.min(100,100*position/duration)):undefined,
    remainingMinutes:valid&&position<duration?Math.ceil((duration-position)/60000):undefined,
  };
}

export function validWatchCountry(value:unknown):value is string{
  return typeof value==='string'&&/^[A-Z]{2}$/.test(value);
}

/** A language without a region does not imply any particular country. */
export function watchCountryFromLocales(locales:readonly string[]){
  for(const locale of locales){
    const country=/^[a-z]{2,3}(?:-[a-z]{4})?-([a-z]{2})(?:-|$)/i.exec(locale)?.[1].toUpperCase();
    if(validWatchCountry(country))return country;
  }
  return '';
}
