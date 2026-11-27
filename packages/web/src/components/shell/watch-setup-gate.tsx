import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { TsugiBrand } from '@/components/tsugi-brand';
import { AddonError,connectTmdb,listAddonProfiles,loadWatchSetup,retryAddonImport,cancelAddonImport,type WatchSetupStatus,type ImportResult } from '@/lib/hosts/shell/stremio';
import { StremioAccountImport,importFailureText } from './stremio-account-import';
import './watch-setup-gate.css';

function errorText(reason:unknown){
  const code=reason instanceof AddonError?reason.code:'';
  if(code==='tmdb-auth')return t`Enter a valid TMDB v3 API key.`;
  if(code==='tmdb-rate')return t`TMDB is rate limiting requests. Try again shortly.`;
  if(code==='tmdb-network'||code==='network')return t`The service could not be reached. Check your connection and retry.`;
  if(code==='account-auth')return t`The account could not be authenticated. Check your credentials.`;
  return t`Setup could not be verified. Please retry.`;
}
type State={profileId:number;status:WatchSetupStatus};
const ignoreActivity=()=>{};

export function TmdbKeyForm({profileId,busy,run,onVerified,connected=false}:{
  profileId:number;busy:boolean;run(work:()=>Promise<void>):Promise<void>;onVerified(status:WatchSetupStatus):void;connected?:boolean;
}){
  const [key,setKey]=React.useState('');
  return <form className="tsugi-watch-key-form" onSubmit={event=>{
    event.preventDefault();const candidate=key.trim();setKey('');
    void run(async()=>onVerified(await connectTmdb(profileId,candidate)));
  }}>
    <h4>{connected?<Trans>Replace TMDB API key</Trans>:<Trans>Connect TMDB</Trans>}</h4>
    <p><Trans>TMDB supplies movie and series metadata and artwork. Your personal v3 key is saved in the protected Windows profile.</Trans></p>
    <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener noreferrer"><Trans>Get a TMDB API key</Trans></a>
    <label><Trans>TMDB v3 API key</Trans><input type="password" autoComplete="off" spellCheck={false} className="tsugi-read-input w-full" required maxLength={128} disabled={busy} value={key} onChange={event=>setKey(event.target.value)}/></label>
    <button type="submit" className="tsugi-read-action tsugi-series-primary" disabled={busy||!key.trim()}><Trans>Validate and save key</Trans></button>
  </form>;
}
export function TmdbSettings({profileId}:{profileId:number}){
  const [status,setStatus]=React.useState<WatchSetupStatus|null>(null);
  const [busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
  React.useEffect(()=>{let active=true;loadWatchSetup(profileId).then(next=>{if(active)setStatus(next);},reason=>{if(active)setError(errorText(reason));});return()=>{active=false;};},[profileId]);
  async function run(work:()=>Promise<void>){if(busy)return;setBusy(true);setError('');try{await work();}catch(reason){setError(errorText(reason));}finally{setBusy(false);}}
  return <section className="tsugi-watch-key-form" data-ui="watch-tmdb-settings">
    {status?.tmdbConnected&&<p role="status"><Trans>TMDB connected</Trans></p>}
    <TmdbKeyForm profileId={profileId} busy={busy} run={run} onVerified={setStatus} connected={status?.tmdbConnected}/>
    {error&&<p role="alert">{error}</p>}
  </section>;
}

/** Native, per-profile status is authoritative. Never use a localStorage flag
 * to decide whether the required account import and TMDB validation passed. */
export function WatchSetupGate({profileId,onReady,onBack}:{
  profileId?:number;onReady(profileId:number):void|Promise<void>;onBack?:()=>void;
}){
  const [state,setState]=React.useState<State|null>(null),[loading,setLoading]=React.useState(true);
  const [busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),[revision,setRevision]=React.useState(0);
  const [report,setReport]=React.useState<ImportResult|null>(null),[accepted,setAccepted]=React.useState(false);
  const mounted=React.useRef(false),flight=React.useRef(false),delivered=React.useRef(false);
  const heading=React.useId();
  React.useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  React.useEffect(()=>{
    let active=true;delivered.current=false;setState(null);setLoading(true);setError('');setReport(null);setAccepted(false);
    void(async()=>{try{
      const id=profileId??(await listAddonProfiles()).activeProfileId;
      const status=await loadWatchSetup(id);
      if(active)setState({profileId:id,status});
    }catch(reason){if(active)setError(errorText(reason));}finally{if(active)setLoading(false);}})();
    return()=>{active=false;};
  },[profileId,revision]);
  const run=React.useCallback(async(work:()=>Promise<void>)=>{
    if(flight.current)return;flight.current=true;setBusy(true);setError('');
    try{await work();}catch(reason){if(mounted.current)setError(errorText(reason));}
    finally{flight.current=false;if(mounted.current)setBusy(false);}
  },[]);
  async function imported(result:ImportResult){
    if(!state)return;
    const id=state.profileId,status=await loadWatchSetup(id);
    if(mounted.current){setState({profileId:id,status});setReport(result);setAccepted(false);}
  }
  const ready=!loading&&!!state&&(profileId===undefined||state.profileId===profileId)&&state.status.tmdbConnected&&state.status.accountProvider!==null&&(!report?.rejected.length||accepted);
  React.useEffect(()=>{
    if(!ready||busy||!state||delivered.current)return;
    delivered.current=true;
    void Promise.resolve().then(()=>onReady(state.profileId)).catch(reason=>{if(mounted.current)setError(errorText(reason));});
  },[ready,busy,state,onReady]);
  return <section className="tsugi-required-setup" data-ui="watch-required-setup" aria-labelledby={heading}>
    <div className="tsugi-required-art" aria-hidden="true"/>
    <div className="tsugi-required-panel">
      <TsugiBrand/><small><Trans>Your streaming library</Trans></small>
      <h2 id={heading}><Trans>Make your next world yours.</Trans></h2>
      <p><Trans>Connect TMDB and import a Stremio or Nuvio account before continuing.</Trans></p>
      {loading?<p role="status"><Trans>Checking your connections…</Trans></p>:state&&<>
        <div className="tsugi-required-steps" aria-label={t`Setup progress`}>
          <span data-complete={state.status.tmdbConnected||undefined}>01 · <Trans>TMDB</Trans></span>
          <span data-complete={state.status.accountProvider!==null||undefined}>02 · <Trans>Streaming account</Trans></span>
        </div>
        {!state.status.tmdbConnected?<TmdbKeyForm profileId={state.profileId} busy={busy} run={run} onVerified={status=>{if(mounted.current)setState({profileId:state.profileId,status});}}/>:!ready&&<div className="space-y-3" data-ui="watch-required-account">
          <StremioAccountImport profileId={state.profileId} busy={busy} run={run} onConnect={()=>{setReport(null);setAccepted(false);}} onSources={imported} onActive={ignoreActivity}/>
          {!!report?.rejected.length&&<div className="space-y-2" role="status">
            <p>{report.rejected.length} <Trans>addons could not be imported.</Trans></p>
            <ul>{report.rejected.map(row=><li key={row.candidateId}>{importFailureText(row)}</li>)}</ul>
            {report.retryImportId!==null&&<button className="tsugi-read-action" type="button" disabled={busy} onClick={()=>void run(async()=>{await imported(await retryAddonImport(state.profileId,report.retryImportId!));})}><Trans>Retry failed addons</Trans></button>}
            {state.status.accountProvider!==null&&<button className="tsugi-read-action tsugi-series-primary" type="button" disabled={busy} onClick={()=>void run(async()=>{if(report.retryImportId!==null)await cancelAddonImport(state.profileId,report.retryImportId);if(mounted.current)setAccepted(true);})}><Trans>Continue with imported addons</Trans></button>}
          </div>}
          {report&&!state.status.accountProvider&&!report.rejected.length&&<p role="alert"><Trans>No account addons were imported. Connect an account with configured addons.</Trans></p>}
        </div>}
        {ready&&<p role="status"><Trans>Streaming connections verified.</Trans></p>}
      </>}
      {error&&<p role="alert">{error}</p>}
      {error&&!busy&&<button className="tsugi-read-action" type="button" onClick={()=>setRevision(n=>n+1)}><Trans>Retry setup check</Trans></button>}
      {onBack&&<button type="button" className="tsugi-read-action" disabled={busy||loading} onClick={onBack}><Trans>Back</Trans></button>}
    </div>
  </section>;
}
