import React from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import {
  AddonError, refractStatus, refractConnect, refractEnable, refractDisconnect,
  refractSync, refractWatchlist, type RefractStatus,
} from '@/lib/hosts/shell/stremio';

function feedback(code:string){
  switch(code){
    case 'refract-auth': return t`Refract rejected this key. Check the key, its expiry and your API access.`;
    case 'refract-scope': return t`The key is missing the required permissions. Create a replacement key for the same account.`;
    case 'refract-account-changed': return t`This key belongs to another account. Disconnect the current account before connecting a different one.`;
    case 'refract-rate': return t`Refract is rate limiting requests. Try again after the retry time.`;
    case 'refract-rejected': return t`Refract rejected this request. Permanently rejected queued watches are skipped so later watches can still be sent.`;
    case 'refract-unmatched': return t`Refract could not uniquely match the external title or episode identity.`;
    case 'refract-queue-full': return t`The local Refract queue is full. Sync pending watches before recording more.`;
    case 'refract-disconnected': return t`Connect your Refract key for this Watch profile first.`;
    case 'refract-paused': return t`Enable completed-watch tracking before syncing queued watches.`;
    case 'refract-pending': return t`Confirm that you want to discard unsent Refract watches before disconnecting.`;
    case 'refract-conflict': return t`Refract reported a conflict. The pending watch has been kept for retry.`;
    case 'refract-network': return t`Refract could not be reached. Local Watch history is preserved.`;
    case 'profile-changed': return t`The active profile changed. Reopen Refract for that profile.`;
    case 'profile-store': case 'profile-store-limit': return t`The protected profile store could not confirm this change. Refresh before retrying.`;
    default: return t`Refract could not complete the request. Local Watch history is preserved.`;
  }
}
type CommonProps={profileId:number;busy:boolean;run(work:()=>Promise<void>):Promise<void>};

export function RefractSettings({profileId,busy,run}:CommonProps){
  const [status,setStatus]=React.useState<RefractStatus|null>(null);
  const [key,setKey]=React.useState('');
  const [error,setError]=React.useState('');
  const [confirm,setConfirm]=React.useState(false);
  const mounted=React.useRef(false);
  async function perform(work:()=>Promise<RefractStatus>){
    await run(async()=>{
      setError('');
      try{const result=await work();if(mounted.current){setStatus(result);setConfirm(false);}}
      catch(reason){if(mounted.current)setError(feedback(reason instanceof AddonError?reason.code:'request'));}
    });
  }
  React.useEffect(()=>{
    mounted.current=true;
    const timer=setTimeout(()=>void perform(()=>refractStatus(profileId)),0);
    return ()=>{mounted.current=false;clearTimeout(timer);};
  },[profileId]);
  function connect(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();
    const candidate=key.trim();setKey('');
    if(candidate)void perform(()=>refractConnect(profileId,candidate));
  }
  return <section className="space-y-3" data-ui="watch-refract">
    <h4><Trans>Refract</Trans></h4>
    <p><Trans>Connect your own personal Refract API key. The key is protected by your Windows account and used only for this local Watch profile.</Trans></p>
    <p><Trans>In Refract, open Integrations, then Access and connected apps. Create a personal key with profile:read, library:write and history:write permissions. API access depends on your Refract membership.</Trans></p>
    <a href="https://getrefract.app/developers/authentication.html" target="_blank" rel="noreferrer"><Trans>Refract key guide</Trans></a>
    {status&&<form className="space-y-2" onSubmit={connect}>
      <label><Trans>Refract API key</Trans><input className="tsugi-read-input w-full" type="password" autoComplete="off" maxLength={512} value={key} onChange={e=>setKey(e.target.value)} disabled={busy}/></label>
      <button type="submit" className="tsugi-read-action" disabled={busy||!key.trim()}>{status.connected?<Trans>Verify replacement key</Trans>:<Trans>Verify and connect</Trans>}</button>
    </form>}
    {status?.connected&&<>
      <p><Trans>Connected to Refract:</Trans> <strong className="break-words">{status.username}</strong></p>
      <label className="flex items-start gap-2"><input type="checkbox" checked={status.enabled} disabled={busy} onChange={e=>void perform(()=>refractEnable(profileId,e.target.checked))}/><span><Trans>Track completed movies and episodes</Trans></span></label>
      <p><Trans>Completed movies and individual episodes are queued with their original time. Completing one episode does not mark the entire series as watched. Sync queued watches to send them to Refract. Older local history is not uploaded automatically; episode rewatches are not appended. Avoid enabling another tracker that sends the same watches.</Trans></p>
      <div className="flex flex-wrap gap-4" aria-live="polite">
        <span><Trans>Pending:</Trans> {status.pending}</span><span><Trans>Sent:</Trans> {status.sent}</span><span><Trans>Skipped:</Trans> {status.skipped}</span>
      </div>
      {status.lastError&&<p role="alert">{feedback(status.lastError)}</p>}
      {status.retryAt>0&&<p><Trans>Retry time:</Trans> {new Date(status.retryAt).toLocaleString()}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="tsugi-read-action" disabled={busy||!status.enabled||!status.pending} onClick={()=>void perform(()=>refractSync(profileId))}><Trans>Sync next watch</Trans></button>
        {!confirm&&<button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>setConfirm(true)}><Trans>Disconnect</Trans></button>}
      </div>
      {confirm&&<div className="space-y-2">
        <p><Trans>Disconnect locally and discard any unsent Refract watches? Existing local history and your Refract account are not deleted.</Trans></p>
        <div className="flex flex-wrap gap-2"><button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void perform(()=>refractDisconnect(profileId,true))}><Trans>Confirm disconnect</Trans></button><button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>setConfirm(false)}><Trans>Cancel</Trans></button></div>
      </div>}
      <p><Trans>Revoke an old key in Refract if you no longer need it. Replacing a key for the same account keeps queued watches.</Trans></p>
    </>}
    <button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void perform(()=>refractStatus(profileId))}><Trans>Refresh Refract status</Trans></button>
    {error&&<p role="alert">{error}</p>}
  </section>;
}

export function RefractWatchlist({profileId,mediaType,itemId,busy,run}:CommonProps&{mediaType:string;itemId:string}){
  const [notice,setNotice]=React.useState('');
  const [error,setError]=React.useState('');
  const mounted=React.useRef(false);
  React.useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  async function change(add:boolean){
    await run(async()=>{
      setError('');setNotice('');
      try{
        const result=await refractWatchlist(profileId,mediaType,itemId,add);
        if(mounted.current)setNotice(result==='protected'?t`Refract kept existing tracked library data unchanged.`:t`Refract watchlist updated.`);
      }catch(reason){if(mounted.current)setError(feedback(reason instanceof AddonError?reason.code:'request'));}
    });
  }
  return <details data-ui="watch-refract-watchlist" className="space-y-2">
    <summary><Trans>Refract watchlist</Trans></summary>
    <p><Trans>Only watchlist membership changes. Existing tracked history, ratings and other library status are protected.</Trans></p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void change(true)}><Trans>Add to Refract watchlist</Trans></button>
      <button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void change(false)}><Trans>Remove from Refract watchlist</Trans></button>
    </div>
    {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
  </details>;
}
