import React from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { MediaRow } from '@/components/media/media-row';
import { PosterCard } from '@/components/media/cards';
import { watchPosterSources } from '@/lib/watch-poster-pattern';
import { loadTvmazeFeed,type SeriesFeed } from '@/lib/hosts/shell/tvmaze';
import type { CatalogPage } from '@/lib/hosts/shell/stremio';

type Item=CatalogPage['items'][number];
const feeds:SeriesFeed[]=['streaming-today','streaming-tomorrow','broadcast-us','broadcast-gb'];
export function SeriesDiscovery({active,busy,posterPattern,openTitle}:{active:boolean;busy:boolean;posterPattern?:string;openTitle(item:Item):void}){
  const [rows,setRows]=React.useState<Partial<Record<SeriesFeed,Item[]>>>({});
  const [errors,setErrors]=React.useState<SeriesFeed[]>([]);
  const [retry,setRetry]=React.useState(0);
  React.useEffect(()=>{
    if(!active)return;
    const controller=new AbortController();
    void (async()=>{
      for(const feed of feeds){
        if(controller.signal.aborted)return;
        try{
          const items=await loadTvmazeFeed(feed,controller.signal);
          if(!controller.signal.aborted){setRows(old=>({...old,[feed]:items}));setErrors(old=>old.filter(key=>key!==feed));}
        }catch{if(!controller.signal.aborted)setErrors(old=>old.includes(feed)?old:[...old,feed]);}
      }
    })();
    return()=>controller.abort();
  },[active,retry]);
  const labels:Record<SeriesFeed,string>={
    'streaming-today':t`Streaming today`,'streaming-tomorrow':t`Streaming tomorrow`,'broadcast-us':t`US television today`,'broadcast-gb':t`UK television today`
  };
  return <section className="space-y-6" data-ui="series-discovery">
    {feeds.map(feed=><section key={feed} className="tsugi-watch-shelf" data-ui="series-discovery-feed" data-feed={feed}>
      <MediaRow contained shape="poster" title={labels[feed]} loading={!rows[feed]&&!errors.includes(feed)}>
        {rows[feed]?.map(item=><PosterCard key={item.id} title={item.name} image={watchPosterSources(item,posterPattern)} itemType={t`Series`} disabled={busy} onClick={()=>openTitle(item)}/>)}
      </MediaRow>
      {errors.includes(feed)?<p className="tsugi-watch-muted"><Trans>TVmaze schedule unavailable.</Trans> <button className="tsugi-read-action" type="button" disabled={busy} onClick={()=>{setErrors([]);setRetry(n=>n+1);}}><Trans>Retry</Trans></button></p>:rows[feed]?.length===0?<p className="tsugi-watch-muted"><Trans>No mapped series in this schedule.</Trans></p>:null}
    </section>)}
    <p className="tsugi-watch-muted"><Trans>Series schedules and search by <a href="https://www.tvmaze.com/" target="_blank" rel="noreferrer">TVmaze</a>. Only titles with a known IMDb identity are shown. Schedule listings do not guarantee a playable stream; playback uses your connected addons.</Trans></p>
  </section>;
}
