import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { connectAddonImport,chooseNuvioImportProfile,reviewAddonImport,applyAddonImport,cancelAddonImport,type AccountImport,type ImportReview,type ImportResult,type ImportProvider } from '@/lib/hosts/shell/stremio';

// Native error codes are fixed categories, never raw manifest or URL text.
export function manifestFailureText(code:string):string|null{
  switch(code){
    case 'invalid-manifest':return t`Invalid or unsupported manifest JSON`;
    case 'manifest-identity':return t`Invalid addon identity, name, version or description`;
    case 'manifest-types':return t`Invalid content types or ID prefixes`;
    case 'manifest-resources':return t`Invalid resource declarations or resource-specific types`;
    case 'manifest-catalogs':return t`Invalid or duplicate catalogue identifiers, types or names`;
    case 'manifest-catalog-limit':return t`Addon exceeds the 512-catalogue limit`;
    case 'manifest-extras':return t`Invalid catalogue extra fields or required filters`;
    case 'manifest-behavior':return t`Invalid addon behavior hints`;
    case 'manifest-limit':return t`Manifest exceeded the size limit`;
    default:return null;
  }
}
export function importFailureText(row:ImportReview['rejected'][number]){
  const manifestReason=manifestFailureText(row.reason);
  if(manifestReason)return row.name+' · '+manifestReason;
  const reason=(()=>{
    switch(row.reason){
      case 'configuration-required':return t`Needs configuration in the original addon`;
      case 'duplicate':return t`Already installed`;
      case 'network':return t`Manifest request failed; check the connection and retry`;
      case 'auth':return t`Manifest rejected the configured credentials`;
      case 'rate':return t`Provider rate limit; retry later`;
      case 'source-limit':return t`No available addon slots`;
      case 'response-limit':return t`Manifest exceeded the size limit`;
      default:return t`Manifest unavailable or unsupported`;
    }
  })();
  return row.name+' · '+reason;
}

export function StremioAccountImport({profileId,busy,run,onConnect,onSources,onActive,fixedProvider}:{
  profileId:number;busy:boolean;fixedProvider?:ImportProvider;run(work:()=>Promise<void>):Promise<void>;
  onConnect():void;onSources(result:ImportResult):void;onActive(active:boolean):void;
}){
  const [provider,setProvider]=React.useState<ImportProvider>(fixedProvider??'stremio');
  const [email,setEmail]=React.useState('');
  const [password,setPassword]=React.useState('');
  const [flow,setFlow]=React.useState<AccountImport|null>(null);
  const [remoteIndex,setRemoteIndex]=React.useState(0);
  const [selected,setSelected]=React.useState<Set<number>>(()=>new Set());
  const mounted=React.useRef(false);
  const pending=React.useRef<number|null>(null);
  React.useEffect(()=>{
    mounted.current=true;
    return ()=>{
      mounted.current=false;onActive(false);
      const id=pending.current;pending.current=null;
      if(id!==null)void cancelAddonImport(profileId,id).catch(()=>{});
    };
  },[profileId,onActive]);
  function reset(){
    const id=pending.current;pending.current=null;
    setFlow(null);setEmail('');setPassword('');setRemoteIndex(0);setSelected(new Set());onActive(false);
    return id;
  }
  function receive(next:AccountImport){
    if(!mounted.current){void cancelAddonImport(profileId,next.importId).catch(()=>{});return;}
    pending.current=next.importId;setFlow(next);onActive(true);
  }
  async function connect(){
    if(busy||!email.trim()||!password)return;
    const login=email.trim(),secret=password;
    reset();onConnect();
    await run(async()=>{receive(await connectAddonImport(profileId,provider,login,secret));});
  }
  async function choose(){
    if(busy||flow?.phase!=='profiles'||!flow.remoteProfiles.some(p=>p.profileIndex===remoteIndex&&!p.locked))return;
    const id=flow.importId,index=remoteIndex;reset();
    await run(async()=>{receive(await chooseNuvioImportProfile(profileId,id,index));});
  }
  async function importSelected(restoreOnly=false){
    if(busy||flow?.phase!=='candidates'||(!selected.size&&!restoreOnly))return;
    const id=flow.importId,sourceProvider=flow.provider;
    const ids=restoreOnly?[]:flow.candidates.filter(c=>selected.has(c.candidateId)&&!c.alreadyInstalled).map(c=>c.candidateId);
    if((!ids.length&&(!restoreOnly||!flow.candidates.some(c=>c.alreadyInstalled)))||ids.length>flow.availableSlots)return;
    reset();
    await run(async()=>{
      const reviewed=await reviewAddonImport(profileId,id,sourceProvider,ids);
      receive(reviewed);
      if(mounted.current)await apply(reviewed);
    });
  }
  async function apply(reviewed:ImportReview){
    const result=await applyAddonImport(profileId,reviewed.importId);
    if(!mounted.current)return;
    reset();
    onSources(result);
  }
  async function cancel(){
    if(busy)return;
    const id=reset();if(id!==null)await run(async()=>{await cancelAddonImport(profileId,id);});
  }
  return <div className="space-y-3" data-ui="stremio-account-import">
    <h4>{fixedProvider==='stremio'?<Trans>Connect Stremio</Trans>:fixedProvider==='nuvio'?<Trans>Connect Nuvio</Trans>:<Trans>Import from an account</Trans>}</h4>
    <p><Trans>Connect once to read your Stremio or Nuvio addon list. Tsugi does not save your account password or token, and never changes your external account. Select the addons to import into this local profile.</Trans></p>
    {!flow&&<form className="space-y-2" onSubmit={e=>{e.preventDefault();void connect();}}>
      {!fixedProvider&&<label><Trans>Import provider</Trans><select className="tsugi-menu-select w-full" value={provider} disabled={busy} onChange={e=>{setProvider(e.target.value as ImportProvider);setEmail('');setPassword('');}}>
        <option value="stremio"><Trans>Stremio</Trans></option><option value="nuvio"><Trans>Nuvio</Trans></option>
      </select></label>}
      <label><Trans>Account email</Trans><input className="tsugi-read-input w-full min-w-0" type="email" autoComplete="off" maxLength={320} required disabled={busy} value={email} onChange={e=>setEmail(e.target.value)}/></label>
      <label><Trans>Account password</Trans><input className="tsugi-read-input w-full min-w-0" type="password" autoComplete="off" maxLength={4096} required disabled={busy} value={password} onChange={e=>setPassword(e.target.value)}/></label>
      <button type="submit" className="tsugi-read-action" disabled={busy||!email.trim()||!password}><Trans>Connect and read addons</Trans></button>
      <p><Trans>Email and password sign-in only. Other account login methods are not supported here yet.</Trans></p>
    </form>}
    {flow?.phase==='profiles'&&<div className="space-y-2" data-import-phase="profiles">
      <label><Trans>Nuvio profile</Trans><select className="tsugi-menu-select w-full" disabled={busy} value={remoteIndex} onChange={e=>setRemoteIndex(Number(e.target.value))}>
        <option value={0}>{t`Select`}</option>
        {flow.remoteProfiles.map(p=><option key={p.profileIndex} value={p.profileIndex} disabled={p.locked}>{p.name}{p.locked?t` (protected)`:p.usesPrimaryAddons?t` (shared addons)`:''}</option>)}
      </select></label>
      <p><Trans>Protected profiles cannot be imported. Shared profiles use their primary profile's addon list.</Trans></p>
      <button type="button" className="tsugi-read-action" disabled={busy||!flow.remoteProfiles.some(p=>p.profileIndex===remoteIndex&&!p.locked)} onClick={()=>void choose()}><Trans>Read selected profile</Trans></button>
    </div>}
    {flow?.phase==='candidates'&&<div className="space-y-3" data-import-phase="candidates">
      <p>{flow.candidates.length} <Trans>compatible configured links found</Trans> · {flow.availableSlots} <Trans>available slots</Trans></p>
      {flow.skipped>0&&<p>{flow.skipped} <Trans>duplicate or unsupported links skipped</Trans></p>}
      {flow.remoteProfile!==undefined&&flow.remoteProfile!==flow.effectiveProfile&&<p><Trans>This profile shares its primary profile's addons.</Trans></p>}
      <button type="button" className="tsugi-read-action" disabled={busy||!flow.availableSlots||!flow.candidates.some(c=>!c.alreadyInstalled)} onClick={()=>{setSelected(new Set(flow.candidates.filter(c=>!c.alreadyInstalled).slice(0,flow.availableSlots).map(c=>c.candidateId)));}}><Trans>Select available addons</Trans></button>
      <div className="max-h-64 overflow-auto">
        {flow.candidates.map(c=><label className="!flex !flex-row items-center gap-3 tsugi-read-row" key={c.candidateId}>
          <input type="checkbox" checked={selected.has(c.candidateId)} disabled={busy||c.alreadyInstalled||(!selected.has(c.candidateId)&&selected.size>=flow.availableSlots)} onChange={e=>{
            const checked=e.target.checked;setSelected(old=>{const next=new Set(old);if(checked)next.add(c.candidateId);else next.delete(c.candidateId);return next;});
          }}/>
          <span className="min-w-0 flex-1 break-words">{c.name}<small className="block">{c.host} · {c.enabled?t`Enabled`:t`Disabled`}{c.alreadyInstalled?<> · <Trans>Already installed</Trans></>:null}</small></span>
        </label>)}
      </div>
      <p><Trans>Importing fetches the selected manifests and adds compatible sources to this profile.</Trans></p>
      <p><Trans>Matching addons follow account order. Local-only addons follow them in their current order.</Trans></p>
      <button type="button" className="tsugi-read-action" disabled={busy||!selected.size} onClick={()=>void importSelected()}><Trans>Import selected addons</Trans></button>
      {flow.candidates.some(c=>c.alreadyInstalled)&&<button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void importSelected(true)}><Trans>Restore account order</Trans></button>}
    </div>}
    {flow?.phase==='review'&&<div className="space-y-3" data-import-phase="review">
      <h4><Trans>Reviewed addon import</Trans></h4>
      <p>{flow.ready.length} <Trans>ready to import</Trans> · {flow.rejected.length} <Trans>not imported</Trans></p>
      {flow.ready.map(c=><div className="tsugi-read-row flex-wrap" key={c.candidateId}>
        <div className="min-w-0 flex-1 break-words">{c.manifest.name}<small className="block">{c.host} · {c.enabled?t`Enabled`:t`Disabled`} · {c.manifest.resources.join(', ')}</small>
          {c.manifest.p2p&&<small className="block"><Trans>Declares peer-to-peer capability</Trans></small>}{c.manifest.adult&&<small className="block"><Trans>Declares adult content</Trans></small>}</div>
      </div>)}
      {flow.rejected.map(c=><p className="break-words" key={c.candidateId}>{importFailureText(c)}</p>)}
      <p><Trans>Matching addons follow account order. Local-only addons follow them in their current order.</Trans></p>
      <button type="button" className="tsugi-read-action tsugi-series-primary" disabled={busy} onClick={()=>void run(()=>apply(flow))}><Trans>Import reviewed addons</Trans></button>
    </div>}
    {flow&&<button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void cancel()}><Trans>Cancel account import</Trans></button>}
  </div>;
}
