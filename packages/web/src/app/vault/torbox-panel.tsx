import { useEffect, useRef, useState } from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { torboxLink, TorBoxError } from './torbox';
import { nativeTorBox, supportsNativeTorBox } from './native-torbox';
import { BrushPlug, BrushCheck } from '@/components/tsugi-icons';

function errorMessage(error: unknown) {
  if (error instanceof TorBoxError) {
    if (error.kind === 'auth') return t`TorBox did not accept your API key or account access.`;
    if (error.kind === 'rate') return t`TorBox is rate limiting requests. Try again later.`;
    if (error.kind === 'network') return t`Could not reach TorBox from the desktop. Check your connection and try again.`;
  }
  return t`TorBox could not complete the request. Check your account and the download link.`;
}

export function TorBoxPanel({initialLink='',compact=false,manageOnly=false,onOpenCloud,onConnectionChange}:{initialLink?:string;compact?:boolean;manageOnly?:boolean;onOpenCloud?:()=>void;onConnectionChange?:(value:boolean)=>void} = {}) {
  const active = useRef<AbortController | null>(null);
  const [key, setKey] = useState('');
  const [connected, setConnected] = useState(false);
  const [link, setLink] = useState(initialLink);
  const [permitted, setPermitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [checking,setChecking]=useState(true);
  useEffect(()=>{if(!checking)onConnectionChange?.(connected);},[checking,connected,onConnectionChange]);
  useEffect(() => {
    let alive = true;
    if (supportsNativeTorBox()) void nativeTorBox('status').then(result => {
      if (!alive) return;
      setConnected(result.connected);setChecking(false);
    }).catch(e=>{if(alive){setError(errorMessage(e));setChecking(false);}});
    return () => { alive=false; active.current?.abort(); };
  }, [compact,manageOnly]);

  async function run(work: (signal: AbortSignal) => Promise<void>) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 85_000);
    setBusy(true); setError(''); setNotice('');
    try { await work(controller.signal); }
    catch (e) {
      if (controller.signal.aborted) setError(t`TorBox request timed out or was cancelled. Check your TorBox dashboard before retrying a submission.`);
      else { setError(errorMessage(e)); if(e instanceof TorBoxError && e.kind==='auth')setConnected(false); }
    } finally {
      window.clearTimeout(timeout);
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  }
  async function connect() {
    const candidate = key.trim();
    await run(async signal => {
      const result = await nativeTorBox('connect',candidate);
      signal.throwIfAborted();
      setConnected(result.connected); setKey('');
    });
  }
  async function refresh() {
    await run(async signal => {
      const result = await nativeTorBox('list');
      signal.throwIfAborted(); setConnected(result.connected);
    });
  }
  async function submit() {
    if (!permitted) return;
    try { torboxLink(link); }
    catch { setError(t`Enter a valid HTTPS download link without embedded credentials.`); return; }
    await run(async signal => {
      await nativeTorBox('submit',torboxLink(link));
      signal.throwIfAborted();
      setLink(''); setPermitted(false);
      setNotice(t`Sent to TorBox. Follow the transfer in your TorBox dashboard.`);
    });
  }
  async function disconnect() {
    await run(async signal=>{await nativeTorBox('disconnect');signal.throwIfAborted();setKey('');setConnected(false);setPermitted(false);});
  }
  if(!supportsNativeTorBox())return <p role="status"><Trans>TorBox requires the updated Windows desktop application.</Trans></p>;
  return <section data-ui="tsugi-torbox" className={compact?'tsugi-torbox-compact':'tsugi-torbox-destination'}>
    <div className="tsugi-torbox-header">
      <div className="tsugi-torbox-identity"><BrushPlug aria-hidden/><div><h2>{manageOnly?<Trans>TorBox account</Trans>:<Trans>TorBox</Trans>}</h2><span className="tsugi-vault-connection" data-connected={connected}>{checking?<Trans>Checking connection</Trans>:connected?<Trans>Connected</Trans>:<Trans>Not connected</Trans>}</span></div></div>
      {connected&&<details className="tsugi-torbox-account-menu"><summary><Trans>Account</Trans></summary><div className="tsugi-vault-actions"><button type="button" className="tsugi-read-action" onClick={()=>void refresh()} disabled={busy}><Trans>Verify connection</Trans></button><button type="button" className="tsugi-read-action" onClick={disconnect} disabled={busy}><Trans>Disconnect TorBox</Trans></button></div></details>}
    </div>
    {checking?<p role="status"><Trans>Checking TorBox…</Trans></p>:!connected?<form className="tsugi-vault-form tsugi-torbox-connect" onSubmit={e=>{e.preventDefault();void connect();}}>
      <label><Trans>TorBox API key</Trans><input type="password" autoComplete="off" spellCheck={false} value={key} onChange={e=>setKey(e.target.value)} required disabled={busy}/></label>
      <p className="tsugi-vault-hint"><Trans>Get your key from TorBox settings. Your connection lasts until Tsugi closes.</Trans></p>
      <button type="submit" className="tsugi-read-action tsugi-series-primary" disabled={busy||!key.trim()}><Trans>Connect TorBox</Trans></button>
    </form>:manageOnly?<div className="tsugi-vault-actions"><p><Trans>Connected for this session.</Trans></p>{onOpenCloud&&<button type="button" className="tsugi-read-action" onClick={onOpenCloud}><Trans>Open cloud downloads</Trans></button>}</div>:<form className="tsugi-vault-form tsugi-torbox-submit" onSubmit={e=>{e.preventDefault();void submit();}}>
      <label><Trans>Cloud download URL</Trans><input type="url" required value={link} placeholder="https://…" onChange={e=>{setLink(e.target.value);setPermitted(false);setNotice('');}} disabled={busy}/></label>
      <label><span><input type="checkbox" style={{width:'auto'}} checked={permitted} onChange={e=>setPermitted(e.target.checked)} disabled={busy}/> <Trans>I have permission to download this file and send its URL to TorBox.</Trans></span></label>
      <div className="tsugi-vault-actions"><button type="submit" className="tsugi-read-action tsugi-series-primary" disabled={busy||!link.trim()||!permitted}><Trans>Send to TorBox</Trans></button><span className="tsugi-vault-hint"><Trans>TorBox fetches the source link. Your dashboard manages the transfer.</Trans></span></div>
    </form>}
    {busy&&<p role="status"><Trans>Contacting TorBox…</Trans></p>}
    {notice&&<p role="status" className="tsugi-vault-receipt"><BrushCheck aria-hidden/>{notice}</p>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
