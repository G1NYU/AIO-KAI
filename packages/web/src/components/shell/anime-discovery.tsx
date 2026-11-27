import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { loadAddonCatalog, type AddonSource, type CatalogPage } from '@/lib/hosts/shell/stremio';

type Props={
  profileId:number;sources:AddonSource[];busy:boolean;
  run(work:()=>Promise<void>):Promise<void>;
  openTitle(item:CatalogPage['items'][number],sourceId?:number):void;clearTitle():void;openAddons():void;
};

/** Catalogue names, required filters, order and pagination come from the
 * selected manifest. Never manufacture weekly rankings or anime IDs. */
export function AnimeDiscovery({profileId,sources,busy,run,openTitle,clearTitle,openAddons}:Props){
  const [choice,setChoice]=React.useState('');
  const [filters,setFilters]=React.useState<Record<string,string>>({});
  const [page,setPage]=React.useState<CatalogPage|null>(null);
  const [repeated,setRepeated]=React.useState(false);
  const seen=React.useRef(new Set<string>());
  const catalogs=sources.filter(source=>source.enabled).flatMap(source=>source.manifest.catalogs.map((catalog,index)=>({source,catalog,key:source.sourceId+':'+index})))
    .filter(({catalog})=>['anime','movie','series'].includes(catalog.mediaType));
  const chosen=catalogs.find(row=>row.key===choice);
  function reset(){setPage(null);setRepeated(false);seen.current.clear();clearTitle();}
  const valid=chosen?.catalog.extras.every(extra=>extra.name==='skip'||!extra.required||!!filters[extra.name]?.trim());
  async function load(skip:number){
    if(!chosen||!valid)return;
    clearTitle();
    if(!skip){setPage(null);setRepeated(false);seen.current.clear();}
    const extras=Object.fromEntries(chosen.catalog.extras.filter(e=>e.name!=='skip'&&filters[e.name]?.trim()).map(e=>[e.name,filters[e.name].trim()]));
    if(chosen.catalog.extras.some(e=>e.name==='skip'&&(skip>0||e.required)))extras.skip=String(skip);
    const result=await loadAddonCatalog(profileId,{kind:'catalog',sourceId:chosen.source.sourceId,mediaType:chosen.catalog.mediaType,catalogId:chosen.catalog.id,extras});
    const fingerprint=JSON.stringify(result.items.map(i=>i.id).sort());
    if(seen.current.has(fingerprint)){setPage({...result,nextSkip:null});setRepeated(true);}
    else{seen.current.add(fingerprint);setPage(result);setRepeated(false);}
  }
  return <section className="tsugi-anime-discovery space-y-4" data-ui="anime-discover">
    <h2><Trans id="Discover anime">Discover anime</Trans></h2>
    <p><Trans id="Browse real addon catalogues">Browse a catalogue from your enabled addons. Rankings, genres and seasonal selections depend on the catalogue; movie and series catalogues may contain non-anime titles.</Trans></p>
    {!catalogs.length?<div className="space-y-2"><p><Trans id="No enabled anime catalogues">No compatible catalogues are enabled.</Trans></p><button className="tsugi-read-action" disabled={busy} onClick={openAddons}><Trans id="Manage addons">Manage addons</Trans></button></div>:
      <form className="space-y-3" onSubmit={event=>{event.preventDefault();void run(()=>load(0));}}>
        <label><Trans id="Catalogue">Catalogue</Trans><select className="tsugi-menu-select w-full" aria-label={t({id:'Anime discovery catalogue',message:'Anime discovery catalogue'})} value={choice} disabled={busy} onChange={event=>{setChoice(event.target.value);setFilters({});reset();}}>
          <option value=""><Trans id="Select a catalogue">Select a catalogue</Trans></option>{catalogs.map(row=><option key={row.key} value={row.key}>{row.source.manifest.name} · {row.catalog.name} · {row.catalog.mediaType}</option>)}
        </select></label>
        {chosen?.catalog.extras.filter(extra=>extra.name!=='skip').map(extra=>{
          const label=extra.name==='search'?t({id:'Search',message:'Search'}):extra.name==='genre'?t({id:'Genre',message:'Genre'}):extra.name;
          const update=(value:string)=>{setFilters(old=>({...old,[extra.name]:value}));reset();};
          return <label key={extra.name}>{label}{extra.options.length?
            <select className="tsugi-menu-select w-full" required={extra.required} disabled={busy} value={filters[extra.name]??''} onChange={event=>update(event.target.value)}><option value=""><Trans id="Select">Select</Trans></option>{extra.options.map((option,index)=><option key={index} value={option}>{option}</option>)}</select>:
            <input className="tsugi-read-input w-full min-w-0" maxLength={512} required={extra.required} disabled={busy} value={filters[extra.name]??''} onChange={event=>update(event.target.value)}/>}</label>;
        })}
        <button className="tsugi-read-action" disabled={busy||!chosen||!valid}><Trans id="Load catalogue">Load catalogue</Trans></button>
      </form>}
    {page&&<><h3>{chosen?.catalog.name}</h3><p>{page.items.length} <Trans id="titles on this page">titles on this page</Trans></p>
      <div className="tsugi-anime-grid">{page.items.map(item=><button type="button" className="tsugi-anime-title" key={item.id} disabled={busy} onClick={()=>openTitle(item,page.sourceId)}><strong>{item.name}</strong><small>{item.mediaType}</small></button>)}</div>
      {!page.items.length&&<p><Trans id="No titles returned by this catalogue.">No titles returned by this catalogue.</Trans></p>}
      {repeated&&<p role="status"><Trans id="This source repeated a page. Pagination stopped.">This source repeated a page. Pagination stopped.</Trans></p>}
      {page.nextSkip!==null&&<button className="tsugi-read-action" disabled={busy} onClick={()=>void run(()=>load(page.nextSkip!))}><Trans id="Next page">Next page</Trans></button>}
    </>}
  </section>;
}
