import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { AddonError, listAddons, reviewAddon, mutateAddon, cancelAddonReview, loadAddonCatalog, listAddonProfiles, mutateAddonProfile, type ProfileState, type ProfileMutation, type AddonSource, type AddonReview, type CatalogPage, type Mutation } from '@/lib/hosts/shell/stremio';

function feedback(reason: unknown) {
  switch(reason instanceof AddonError ? reason.code : 'request'){
    case 'invalid-endpoint': return t`Paste a configured HTTPS or stremio:// manifest link ending in /manifest.json.`;
    case 'configuration-required': return t`Configure this addon with its provider first, then paste its configured link.`;
    case 'duplicate': return t`This configured addon is already installed.`;
    case 'expired-review': return t`This review expired. Review the manifest again.`;
    case 'auth': return t`The addon rejected the request. Check its configuration.`;
    case 'rate': return t`The addon is limiting requests. Try again later.`;
    case 'source-limit': return t`Each profile supports up to 16 addons.`;
    case 'profile-limit': return t`You can create up to six profiles.`;
    case 'duplicate-profile': return t`A profile already uses that name.`;
    case 'invalid-profile-name': return t`Enter a valid profile name.`;
    case 'profile-changed': return t`The active profile changed. Refresh before continuing.`;
    case 'profile-store': case 'profile-store-limit': return t`The protected profile store could not be read or saved. Existing saved data has not been reset.`;
    case 'profile-confirmation': return t`Type the exact profile name before deleting it.`;
    case 'active-profile': return t`Switch to another profile before deleting this one.`;
    default: return t`The request could not be confirmed. Refresh the installed list before retrying an installation or change.`;
  }
}
export function StremioAddonSettings(){
  const [profileState,setProfileState]=React.useState<ProfileState|null>(null);
  const [profileReady,setProfileReady]=React.useState(false);
  const [profileName,setProfileName]=React.useState('');
  const [deleteId,setDeleteId]=React.useState(0);
  const [deleteName,setDeleteName]=React.useState('');
  const profileId=profileState?.activeProfileId;
  const activeProfile=profileState?.profiles.find(p=>p.profileId===profileId);
  const deleteTarget=profileState?.profiles.find(p=>p.profileId===deleteId&&p.profileId!==profileId);
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
  const pending=React.useRef<{profileId:number;reviewId:number}|null>(null);
  const seen=React.useRef(new Set<string>());
  const blocked=busy||!profileReady||profileId===undefined;
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
    void run(async()=>{await reloadProfiles();});
    return ()=>{mounted.current=false;const current=pending.current;pending.current=null;if(current)void cancelAddonReview(current.profileId,current.reviewId).catch(()=>{});};
  },[]);
  function clearPage(){setPage(null);seen.current.clear();}
  function choose(next:typeof selection){setSelection(next);setFilters(new Map());clearPage();}
  function clearReview(){const previous=pending.current;pending.current=null;setReview(null);setUrl('');setConsent(false);return previous;}
  async function reloadProfiles(next?:ProfileState){
    setProfileReady(false);setSources([]);choose(null);
    const result=next??await listAddonProfiles();
    if(!mounted.current)return;
    setProfileState(result);
    const rows=await listAddons(result.activeProfileId);
    if(mounted.current){setSources(rows);setProfileReady(true);}
  }
  async function refreshProfiles(){
    await run(async()=>{
      const previous=clearReview();
      if(previous)await cancelAddonReview(previous.profileId,previous.reviewId).catch(()=>{});
      await reloadProfiles();
    });
  }
  async function changeProfile(action:ProfileMutation){
    if(flight.current||!profileState)return;
    await run(async()=>{
      const previous=clearReview();
      if(previous)await cancelAddonReview(previous.profileId,previous.reviewId).catch(()=>{});
      setProfileReady(false);setSources([]);choose(null);
      const result=await mutateAddonProfile(action);
      if(!mounted.current)return;
      setProfileName('');setDeleteId(0);setDeleteName('');
      await reloadProfiles(result);
    });
  }
  async function inspect(){
    const candidate=url.trim();
    if(!candidate||!consent||flight.current||profileId===undefined||!profileReady)return;
    setUrl('');setConsent(false);setReview(null);pending.current=null;
    await run(async()=>{
      const next=await reviewAddon(profileId,candidate);
      if(!mounted.current){void cancelAddonReview(profileId,next.reviewId).catch(()=>{});return;}
      pending.current={profileId,reviewId:next.reviewId};setReview(next);
    });
  }
  async function change(action:Mutation){
    if(flight.current||profileId===undefined||!profileReady)return;
    if(action.kind==='install'){setReview(null);pending.current=null;}
    await run(async()=>{const next=await mutateAddon(profileId,action);if(mounted.current){setSources(next);setProfileState(old=>old?{...old,profiles:old.profiles.map(p=>p.profileId===profileId?{...p,sourceCount:next.length}:p)}:null);choose(null);}});
  }
  async function cancel(){
    const current=pending.current;if(!current||flight.current)return;
    setReview(null);pending.current=null;
    await run(async()=>{await cancelAddonReview(current.profileId,current.reviewId);});
  }
  const validFilters=!!catalog&&catalog.extras.every(e=>e.name==='skip'||!e.required||!!filters.get(e.name)?.trim());
  async function load(skip:number){
    if(!source||!catalog||!validFilters||flight.current||profileId===undefined||!profileReady)return;
    const extras=Object.fromEntries(catalog.extras.filter(e=>e.name!=='skip'&&filters.get(e.name)?.trim()).map(e=>[e.name,filters.get(e.name)!]));
    if(catalog.extras.some(e=>e.name==='skip'&&(skip>0||e.required)))extras.skip=String(skip);
    await run(async()=>{
      if(skip===0)clearPage();
      const next=await loadAddonCatalog(profileId,{kind:'catalog',sourceId:source.sourceId,mediaType:catalog.mediaType,catalogId:catalog.id,extras});
      if(!mounted.current)return;
      const fingerprint=JSON.stringify(next.items.map(i=>i.id).sort());
      if(seen.current.has(fingerprint)){setPage({...next,nextSkip:null});setNotice(t`This source repeated a page. Pagination stopped.`);}
      else{seen.current.add(fingerprint);setPage(next);}
    });
  }
  return <section className="tsugi-app-general" data-ui="stremio-addon-settings" aria-labelledby="tsugi-stremio-heading">
    <h3 id="tsugi-stremio-heading"><Trans>Stremio addons</Trans></h3>
    <p><Trans>Each local profile has its own addons, without an AIOStreams connection. Catalogue browsing is available here; direct playback is not available yet.</Trans></p>
    <p><Trans>Configured links are protected by your Windows account and excluded from portable backups. Local profiles are not password-protected from other people using this Windows account. Only contact addon hosts you trust.</Trans></p>
    <div className="space-y-3" data-ui="stremio-profile-management">
      <h4><Trans>Addon profiles</Trans></h4>
      {profileState&&activeProfile&&<>
        <label><Trans>Active addon profile</Trans><select className="tsugi-menu-select w-full" value={profileId} disabled={busy} onChange={e=>void changeProfile({kind:'profile-switch',profileId:Number(e.target.value)})}>
          {profileState.profiles.map(p=><option key={p.profileId} value={p.profileId}>{p.name}</option>)}
        </select></label>
        <label><Trans>Profile name</Trans><input className="tsugi-read-input w-full min-w-0" autoComplete="off" maxLength={64} value={profileName} disabled={busy} onChange={e=>setProfileName(e.target.value)}/></label>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="tsugi-read-action" disabled={busy||!profileName.trim()||profileState.profiles.length>=6} onClick={()=>void changeProfile({kind:'profile-create',name:profileName})}><Trans>Create profile</Trans></button>
          <button type="button" className="tsugi-read-action" disabled={busy||!profileName.trim()} onClick={()=>void changeProfile({kind:'profile-rename',profileId:activeProfile.profileId,name:profileName})}><Trans>Rename active profile</Trans></button>
        </div>
        {profileState.profiles.length>1&&<details>
          <summary><Trans>Delete an inactive profile</Trans></summary>
          <div className="space-y-2">
            <p><Trans>Deleting a profile removes its saved addon configurations. Switch away from it first. This cannot be undone.</Trans></p>
            <label><Trans>Profile to delete</Trans><select className="tsugi-menu-select w-full" disabled={busy} value={deleteId} onChange={e=>{setDeleteId(Number(e.target.value));setDeleteName('');}}>
              <option value={0}>{t`Select`}</option>{profileState.profiles.filter(p=>p.profileId!==profileId).map(p=><option key={p.profileId} value={p.profileId}>{p.name}</option>)}
            </select></label>
            {deleteTarget&&<><label><Trans>Confirm profile name</Trans><input className="tsugi-read-input w-full min-w-0" disabled={busy} autoComplete="off" value={deleteName} onChange={e=>setDeleteName(e.target.value)}/></label>
              <button type="button" className="tsugi-read-action" disabled={busy||deleteName!==deleteTarget.name} onClick={()=>void changeProfile({kind:'profile-remove',profileId:deleteTarget.profileId,confirmedName:deleteName})}><Trans>Delete profile</Trans></button></>}
          </div>
        </details>}
      </>}
      <button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void refreshProfiles()}><Trans>Refresh profiles</Trans></button>
    </div>
    <form className="space-y-2" onSubmit={e=>{e.preventDefault();void inspect();}}>
      <label><Trans>Configured manifest URL</Trans><input className="tsugi-read-input w-full min-w-0" type="password" autoComplete="off" spellCheck={false} maxLength={16384} value={url} required disabled={blocked} onChange={e=>{setUrl(e.target.value);setConsent(false);}}/></label>
      <label className="flex items-start gap-2"><input type="checkbox" checked={consent} disabled={blocked} onChange={e=>setConsent(e.target.checked)}/><Trans>I trust this addon host and want Tsugi to contact it.</Trans></label>
      <button type="submit" className="tsugi-read-action" disabled={blocked||!url.trim()||!consent}><Trans>Review addon</Trans></button>
    </form>
    {review&&<div className="space-y-2" data-ui="stremio-review">
      <h4 className="break-words">{review.manifest.name}</h4>
      <p>{review.manifest.version} · {review.manifest.resources.join(', ')}</p>
      <p>{review.manifest.catalogs.length} <Trans>catalogues</Trans></p>
      {review.manifest.configurationRequired&&<p role="alert"><Trans>This addon needs configuration before installation.</Trans></p>}
      {review.manifest.p2p&&<p><Trans>This addon declares peer-to-peer support. Tsugi does not enable peer-to-peer playback here.</Trans></p>}
      {review.manifest.adult&&<p><Trans>This addon declares adult content.</Trans></p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="tsugi-read-action" disabled={blocked||review.manifest.configurationRequired} onClick={()=>void change({kind:'install',reviewId:review.reviewId})}><Trans>Install into profile</Trans></button>
        <button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void cancel()}><Trans>Cancel review</Trans></button>
      </div>
    </div>}
    <h4><Trans>Installed addons</Trans></h4>
    <button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void refreshProfiles()}><Trans>Refresh installed addons</Trans></button>
    {profileReady&&!sources.length&&<p><Trans>No addons installed for this profile.</Trans></p>}
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
