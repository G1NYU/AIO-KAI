import { useEffect, useRef, useState } from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { torboxLink, TorBoxError, type TorBoxItem } from './torbox';
import { nativeTorBox, supportsNativeTorBox } from './native-torbox';

function errorMessage(error: unknown) {
  if (error instanceof TorBoxError) {
    if (error.kind === 'auth') return t`TorBox did not accept your API key or account access.`;
    if (error.kind === 'rate') return t`TorBox is rate limiting requests. Try again later.`;
    if (error.kind === 'network') return t`Could not reach TorBox from the desktop. Check your connection and try again.`;
  }
  return t`TorBox could not complete the request. Check your account and the download link.`;
}

export function TorBoxPanel({initialLink='',compact=false}:{initialLink?:string;compact?:boolean} = {}) {
  const active = useRef<AbortController | null>(null);
  const [key, setKey] = useState('');
  const [connected, setConnected] = useState(false);
  const [link, setLink] = useState(initialLink);
  const [permitted, setPermitted] = useState(false);
  const [items, setItems] = useState<TorBoxItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let alive = true;
    if (supportsNativeTorBox()) void nativeTorBox('status').then(result => {
      if (!alive) return;
      setConnected(result.connected);
      if (result.connected && !compact) void nativeTorBox('list').then(list=>{if(alive)setItems(list.items||[]);}).catch(e=>{if(alive){setError(errorMessage(e));if(e instanceof TorBoxError && e.kind==='auth')setConnected(false);}});
    }).catch(e=>{if(alive)setError(errorMessage(e));});
    return () => { alive=false; active.current?.abort(); };
  }, [compact]);

  async function run(work: (signal: AbortSignal) => Promise<void>) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 85_000);
    setBusy(true); setError(''); setNotice('');
    try { await work(controller.signal); }
    catch (e) {
      if (controller.signal.aborted) setError(t`TorBox request timed out or was cancelled. Refresh the cloud list before retrying a submission.`);
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
      setItems(result.items||[]); setConnected(result.connected); setKey('');
    });
  }
  async function refresh() {
    await run(async signal => {
      const result = await nativeTorBox('list');
      signal.throwIfAborted(); setItems(result.items||[]); setConnected(result.connected);
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
      setNotice(t`Submitted to TorBox. Check your dashboard or refresh the list for its status.`);
    });
  }
  async function disconnect() {
    await run(async signal=>{await nativeTorBox('disconnect');signal.throwIfAborted();setKey('');setConnected(false);setItems([]);setPermitted(false);});
  }
  if(!supportsNativeTorBox())return <p role="status"><Trans>TorBox requires the updated Windows desktop application.</Trans></p>;
  return <section data-ui="tsugi-torbox">
    <h2><Trans>TorBox cloud downloads</Trans></h2>
    <p><Trans>Send authorized web downloads to your own TorBox account. Transfers run on TorBox, even after Tsugi closes.</Trans></p>
    {!connected ? <form className="tsugi-vault-form" onSubmit={e => { e.preventDefault(); void connect(); }}>
      <label><Trans>TorBox API key</Trans><input type="password" autoComplete="off" spellCheck={false} value={key} onChange={e => setKey(e.target.value)} required disabled={busy}/></label>
      <p><Trans>Find your API key in your TorBox account settings. Tsugi keeps it in memory until you close the app or disconnect.</Trans></p>
      <div className="tsugi-vault-actions"><button type="submit" className="tsugi-read-action tsugi-series-primary" disabled={busy || !key.trim()}><Trans>Connect TorBox</Trans></button></div>
    </form> : <>
      <div className="tsugi-vault-actions">
        <button type="button" className="tsugi-read-action" onClick={() => void refresh()} disabled={busy}><Trans>Refresh cloud downloads</Trans></button>
        <button type="button" className="tsugi-read-action" onClick={disconnect} disabled={busy}><Trans>Disconnect TorBox</Trans></button>
      </div>
      <form className="tsugi-vault-form" onSubmit={e => { e.preventDefault(); void submit(); }}>
        <label><Trans>Cloud download URL</Trans><input type="url" required value={link} onChange={e => { setLink(e.target.value); setPermitted(false); }} disabled={busy}/></label>
        <label><span><input type="checkbox" style={{width:'auto'}} checked={permitted} onChange={e => setPermitted(e.target.checked)} disabled={busy}/> <Trans>I have permission to download this file and send its URL to TorBox.</Trans></span></label>
        <div className="tsugi-vault-actions"><button type="submit" className="tsugi-read-action tsugi-series-primary" disabled={busy || !link.trim() || !permitted}><Trans>Send to TorBox</Trans></button></div>
      </form>
      {!compact&&<><h3><Trans>Cloud downloads (up to 100)</Trans></h3>
      {items.length === 0 ? <p><Trans>No web downloads returned.</Trans></p> : items.map(item => <div key={item.id} className="tsugi-vault-file-row"><span>{item.name || t`Unnamed download`}</span><span>{item.finished ? t`Complete` : item.state || t`Pending status`}</span></div>)}</>}
    </>}
    {busy && <p role="status"><Trans>Contacting TorBox…</Trans></p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
