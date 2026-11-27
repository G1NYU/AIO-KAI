import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { AddonError, listAddons, reviewAddon, mutateAddon, cancelAddonReview, loadAddonCatalog, type AddonSource, type AddonReview, type CatalogPage, type Mutation } from '@/lib/hosts/shell/stremio';

function feedback(reason: unknown) {
  switch(reason instanceof AddonError ? reason.code : 'request'){
    case 'invalid-endpoint': return t`Paste a configured HTTPS or stremio:// manifest link ending in /manifest.json.`;
    case 'configuration-required': return t`Configure this addon with its provider first, then paste its configured link.`;
    case 'duplicate': return t`This configured addon is already installed.`;
    case 'expired-review': return t`This review expired. Review the manifest again.`;
    case 'auth': return t`The addon rejected the request. Check its configuration.`;
    case 'rate': return t`The addon is limiting requests. Try again later.`;
    case 'source-limit': return t`The session supports up to 16 addons.`;
    default: return t`The request could not be confirmed. Refresh the installed list before retrying an installation or change.`;
  }
}
export function StremioAddonSettings(){
  const [url,setUrl]=React.useState('');
  const [consent,setConsent]=React.useState(false);
  const [review,setReview]=React.useState<AddonReview|null>(null);
  const [sources,setSources]=React.useState<AddonSource[]>([]);
  const [busy,setBusy]=React.useState(false);
  const [error,setError]=React.useState('');
  const [notice,setNotice]=React.useState('');
  const [selection,setSelection]=React.useState<{sourceId:number;catalogIndex:number}|null>(null);
  const [filters,setFilters]=React.useState<Map<string,string>>(()=>new Map());
  const [page,setPage]=React.useState<CatalogPage|null>(null);
  const mounted=React.useRef(false);
  const flight=React.useRef(false);
  const pending=React.useRef<number|null>(null);
  const seen=React.useRef(new Set<string>());
  const source=sources.find(s=>s.sourceId===selection?.sourceId&&s.enabled);
  const catalog=source?.manifest.catalogs[selection?.catalogIndex??0];

  async function run(work:()=>Promise<void>){
    if(flight.current)return;
    flight.current=true;setBusy(true);setError('');setNotice('');
    try{await work();}catch(reason){if(mounted.current)setError(feedback(reason));}
    finally{flight.current=false;if(mounted.current)setBusy(false);}
  }
  React.useEffect(()=>{
    mounted.current=true;
    void run(async()=>{const rows=await listAddons();if(mounted.current)setSources(rows);});
    return ()=>{mounted.current=false;const id=pending.current;pending.current=null;if(id!==null)void cancelAddonReview(id).catch(()=>{});};
  },[]);
  function clearPage(){setPage(null);seen.current.clear();}
  function choose(next:typeof selection){setSelection(next);setFilters(new Map());clearPage();}
  async function inspect(){
    const candidate=url.trim();
    if(!candidate||!consent||flight.current)return;
    setUrl('');setConsent(false);setReview(null);pending.current=null;
    await run(async()=>{
      const next=await reviewAddon(candidate);
      if(!mounted.current){void cancelAddonReview(next.reviewId).catch(()=>{});return;}
      pending.current=next.reviewId;setReview(next);
    });
  }
  async function change(action:Mutation){
    if(flight.current)return;
    if(action.kind==='install'){setReview(null);pending.current=null;}
    await run(async()=>{const next=await mutateAddon(action);if(mounted.current){setSources(next);choose(null);}});
  }
  async function cancel(){
    const id=pending.current;if(id===null||flight.current)return;
    setReview(null);pending.current=null;
    await run(async()=>{await cancelAddonReview(id);});
  }
  const validFilters=!!catalog&&catalog.extras.every(e=>e.name==='skip'||!e.required||!!filters.get(e.name)?.trim());
  async function load(skip:number){
    if(!source||!catalog||!validFilters||flight.current)return;
    const extras=Object.fromEntries(catalog.extras.filter(e=>e.name!=='skip'&&filters.get(e.name)?.trim()).map(e=>[e.name,filters.get(e.name)!]));
    if(catalog.extras.some(e=>e.name==='skip'&&(skip>0||e.required)))extras.skip=String(skip);
    await run(async()=>{
      if(skip===0)clearPage();
      const next=await loadAddonCatalog({kind:'catalog',sourceId:source.sourceId,mediaType:catalog.mediaType,catalogId:catalog.id,extras});
      if(!mounted.current)return;
      const fingerprint=JSON.stringify(next.items.map(i=>i.id).sort());
      if(seen.current.has(fingerprint)){setPage({...next,nextSkip:null});setNotice(t`This source repeated a page. Pagination stopped.`);}
      else{seen.current.add(fingerprint);setPage(next);}
    });
  }
  return <section className="tsugi-app-general" data-ui="stremio-addon-settings" aria-labelledby="tsugi-stremio-heading">
    <h3 id="tsugi-stremio-heading"><Trans>Stremio addons</Trans></h3>
    <p><Trans>Review and install independent addons for this session, without an AIOStreams connection. Catalogue browsing is available here; direct playback is not available yet.</Trans></p>
    <p><Trans>Configured links stay in native session memory. They are not included in backups and must be reinstalled after restarting Tsugi. Only contact addon hosts you trust.</Trans></p>
    <form className="space-y-2" onSubmit={e=>{e.preventDefault();void inspect();}}>
      <label><Trans>Configured manifest URL</Trans><input className="tsugi-read-input w-full min-w-0" type="password" autoComplete="off" spellCheck={false} maxLength={16384} value={url} required disabled={busy} onChange={e=>{setUrl(e.target.value);setConsent(false);}}/></label>
      <label className="flex items-start gap-2"><input type="checkbox" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)}/><Trans>I trust this addon host and want Tsugi to contact it.</Trans></label>
      <button type="submit" className="tsugi-read-action" disabled={busy||!url.trim()||!consent}><Trans>Review addon</Trans></button>
    </form>
    {review&&<div className="space-y-2" data-ui="stremio-review">
      <h4 className="break-words">{review.manifest.name}</h4>
      <p>{review.manifest.version} · {review.manifest.resources.join(', ')}</p>
      <p>{review.manifest.catalogs.length} <Trans>catalogues</Trans></p>
      {review.manifest.configurationRequired&&<p role="alert"><Trans>This addon needs configuration before installation.</Trans></p>}
      {review.manifest.p2p&&<p><Trans>This addon declares peer-to-peer support. Tsugi does not enable peer-to-peer playback here.</Trans></p>}
      {review.manifest.adult&&<p><Trans>This addon declares adult content.</Trans></p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="tsugi-read-action" disabled={busy||review.manifest.configurationRequired} onClick={()=>void change({kind:'install',reviewId:review.reviewId})}><Trans>Install for this session</Trans></button>
        <button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void cancel()}><Trans>Cancel review</Trans></button>
      </div>
    </div>}
    <h4><Trans>Installed addons</Trans></h4>
    <button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void run(async()=>{const next=await listAddons();if(mounted.current){setSources(next);choose(null);}})}><Trans>Refresh installed addons</Trans></button>
    {!sources.length&&<p><Trans>No addons installed for this session.</Trans></p>}
    {sources.map((s,index)=><div key={s.sourceId} data-stremio-source-id={s.sourceId} className="tsugi-read-row flex-wrap">
      <div className="min-w-0 flex-1"><span className="break-words">{s.manifest.name}</span><small className="block">{s.manifest.version} · {s.enabled?t`Enabled`:t`Disabled`}</small></div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="tsugi-read-action" disabled={busy||!s.enabled||!s.manifest.catalogs.length} onClick={()=>choose({sourceId:s.sourceId,catalogIndex:0})}><Trans>Browse catalogues</Trans></button>
        <button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void change({kind:'set-enabled',sourceId:s.sourceId,enabled:!s.enabled})}>{s.enabled?t`Disable`:t`Enable`}</button>
        <button type="button" className="tsugi-read-action" disabled={busy||index===0} onClick={()=>void change({kind:'move',sourceId:s.sourceId,position:index-1})}><Trans>Move up</Trans></button>
        <button type="button" className="tsugi-read-action" disabled={busy||index===sources.length-1} onClick={()=>void change({kind:'move',sourceId:s.sourceId,position:index+1})}><Trans>Move down</Trans></button>
        <button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void change({kind:'remove',sourceId:s.sourceId})}><Trans>Remove</Trans></button>
      </div>
    </div>)}
    {source&&catalog&&selection&&<form className="space-y-3" data-ui="stremio-catalog" onSubmit={e=>{e.preventDefault();void load(0);}}>
      <h4 className="break-words">{source.manifest.name}</h4>
      <label><Trans>Catalogue</Trans><select className="tsugi-menu-select w-full" disabled={busy} value={selection.catalogIndex} onChange={e=>choose({sourceId:source.sourceId,catalogIndex:Number(e.target.value)})}>
        {source.manifest.catalogs.map((c,index)=><option key={index} value={index}>{c.name} · {c.mediaType}</option>)}
      </select></label>
      {catalog.extras.filter(e=>e.name!=='skip').map(extra=>{
        const label=extra.name==='search'?t`Search`:extra.name==='genre'?t`Genre`:extra.name;
        const update=(value:string)=>{setFilters(old=>new Map(old).set(extra.name,value));clearPage();};
        return <label key={extra.name}>{label}{extra.options.length?
          <select className="tsugi-menu-select w-full" required={extra.required} disabled={busy} value={filters.get(extra.name)??''} onChange={e=>update(e.target.value)}><option value="">{t`Select`}</option>{extra.options.map((o,index)=><option key={index} value={o}>{o}</option>)}</select>:
          <input className="tsugi-read-input w-full min-w-0" maxLength={512} required={extra.required} disabled={busy} value={filters.get(extra.name)??''} onChange={e=>update(e.target.value)}/>}</label>;
      })}
      <button type="submit" className="tsugi-read-action" disabled={busy||!validFilters}><Trans>Load catalogue</Trans></button>
      {page&&<><p>{page.items.length} <Trans>titles on this page</Trans></p><ul className="max-h-64 overflow-auto">{page.items.map(item=><li className="tsugi-read-row break-words" key={item.id}>{item.name}</li>)}</ul>
        {page.nextSkip!==null&&<button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void load(page.nextSkip!)}><Trans>Next page</Trans></button>}</>}
    </form>}
    {busy&&<p role="status"><Trans>Contacting addon registry…</Trans></p>}
    {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
  </section>;
}
