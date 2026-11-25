import { useEffect, useRef, useState } from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { torboxLink, TorBoxError, type TorBoxItem } from './torbox';
import { nativeTorBox, supportsNativeTorBox } from './native-torbox';
import { BrushFolder, BrushRefresh, BrushSearch, BrushPlus } from '@/components/tsugi-icons';

function errorMessage(error: unknown) {
  if (error instanceof TorBoxError) {
    if (error.kind === 'auth') return t`TorBox did not accept your API key or account access.`;
    if (error.kind === 'rate') return t`TorBox is rate limiting requests. Try again later.`;
    if (error.kind === 'network') return t`Could not reach TorBox from the desktop. Check your connection and try again.`;
  }
  return t`TorBox could not complete the request. Check your account and the download link.`;
}

export function TorBoxPanel({initialLink='',compact=false,manageOnly=false,onOpenCloud}:{initialLink?:string;compact?:boolean;manageOnly?:boolean;onOpenCloud?:()=>void} = {}) {
  const active = useRef<AbortController | null>(null);
  const [key, setKey] = useState('');
  const [connected, setConnected] = useState(false);
  const [link, setLink] = useState(initialLink);
  const [permitted, setPermitted] = useState(false);
  const [items, setItems] = useState<TorBoxItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query,setQuery]=useState('');
  const [cloudFilter,setCloudFilter]=useState<'all'|'active'|'done'>('all');
  const [addOpen,setAddOpen]=useState(compact||!!initialLink);
  const [checking,setChecking]=useState(true);
  useEffect(() => {
    let alive = true;
    if (supportsNativeTorBox()) void nativeTorBox('status').then(result => {
      if (!alive) return;
      setConnected(result.connected);setChecking(false);
      if (result.connected && !compact && !manageOnly) void nativeTorBox('list').then(list=>{if(alive)setItems(list.items||[]);}).catch(e=>{if(alive){setError(errorMessage(e));if(e instanceof TorBoxError && e.kind==='auth')setConnected(false);}});
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
      if(result.connected&&!manageOnly)setAddOpen(true);
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
      if(!compact){setAddOpen(false);try{const list=await nativeTorBox('list');signal.throwIfAborted();setItems(list.items||[]);setConnected(list.connected);}catch(e){if(!signal.aborted)setError(errorMessage(e));}}
    });
  }
  async function disconnect() {
    await run(async signal=>{await nativeTorBox('disconnect');signal.throwIfAborted();setKey('');setConnected(false);setItems([]);setPermitted(false);});
  }
  if(!supportsNativeTorBox())return <p role="status"><Trans>TorBox requires the updated Windows desktop application.</Trans></p>;
  const completed=items.filter(item=>item.finished).length;
  const visible=items.filter(item=>(cloudFilter==='all'||(cloudFilter==='done'?item.finished:!item.finished))&&item.name.toLowerCase().includes(query.trim().toLowerCase()));
  return <section data-ui="tsugi-torbox" className={compact?'tsugi-torbox-compact':'tsugi-torbox-workspace'}>
    <header className="tsugi-torbox-header">
      <div><h2>{manageOnly?<Trans>TorBox account</Trans>:<Trans>TorBox cloud downloads</Trans>}</h2>
      <p>{manageOnly?<Trans>Your cloud download provider</Trans>:<Trans>Web downloads · stored in your TorBox account</Trans>}</p></div>
      <span className="tsugi-vault-connection" data-connected={connected}>{checking?<Trans>Checking connection</Trans>:connected?<Trans>Connected</Trans>:<Trans>Not connected</Trans>}</span>
    </header>
    {checking?<p role="status"><Trans>Checking TorBox…</Trans></p>:!connected ? <form className="tsugi-vault-form tsugi-torbox-connect" onSubmit={e => { e.preventDefault(); void connect(); }}>
      <label><Trans>TorBox API key</Trans><input type="password" autoComplete="off" spellCheck={false} value={key} onChange={e => setKey(e.target.value)} required disabled={busy}/></label>
      <p className="tsugi-vault-hint"><Trans>Copy the API key from your TorBox account settings. Kept in memory for this session only.</Trans></p>
      <div className="tsugi-vault-actions"><button type="submit" className="tsugi-read-action tsugi-series-primary" disabled={busy || !key.trim()}><Trans>Connect TorBox</Trans></button></div>
    </form> : <>
      <div className="tsugi-torbox-commandbar tsugi-vault-actions">
        {manageOnly&&onOpenCloud&&<button type="button" className="tsugi-read-action tsugi-series-primary" onClick={onOpenCloud}><BrushFolder aria-hidden/><Trans>Open cloud downloads</Trans></button>}
        {!manageOnly&&!compact&&<button type="button" className="tsugi-read-action tsugi-series-primary" aria-expanded={addOpen} onClick={()=>setAddOpen(v=>!v)} disabled={busy}><BrushPlus aria-hidden/>{addOpen?<Trans>Close add download</Trans>:<Trans>New cloud download</Trans>}</button>}
        <button type="button" className="tsugi-read-action" onClick={() => void refresh()} disabled={busy}><BrushRefresh aria-hidden/>{manageOnly?<Trans>Verify connection</Trans>:<Trans>Refresh cloud downloads</Trans>}</button>
        <button type="button" className="tsugi-read-action" onClick={disconnect} disabled={busy}><Trans>Disconnect TorBox</Trans></button>
      </div>
      {manageOnly?<p className="tsugi-vault-hint"><Trans>Connected for this session.</Trans></p>:(compact||addOpen)&&<form className="tsugi-vault-form tsugi-torbox-submit" onSubmit={e => { e.preventDefault(); void submit(); }}>
        <label><Trans>Cloud download URL</Trans><input type="url" required value={link} placeholder="https://example.com/file.zip" onChange={e => { setLink(e.target.value); setPermitted(false); }} disabled={busy}/></label>
        <label><span><input type="checkbox" style={{width:'auto'}} checked={permitted} onChange={e => setPermitted(e.target.checked)} disabled={busy}/> <Trans>I have permission to download this file and send its URL to TorBox.</Trans></span></label>
        <div className="tsugi-vault-actions"><button type="submit" className="tsugi-read-action tsugi-series-primary" disabled={busy || !link.trim() || !permitted}><Trans>Send to TorBox</Trans></button><span className="tsugi-vault-hint"><Trans>Transfers continue in the cloud when Tsugi closes.</Trans></span></div>
      </form>}
      {!compact&&!manageOnly&&<>
        <div className="tsugi-torbox-listbar">
          <h3><Trans>Cloud downloads</Trans> <small>{items.length} / 100</small></h3>
          <label className="tsugi-torbox-search"><BrushSearch aria-hidden/><input aria-label={t`Search cloud downloads`} placeholder={t`Find a file`} value={query} onChange={e=>setQuery(e.target.value)}/></label>
          <select className="tsugi-read-input" aria-label={t`Cloud download filter`} value={cloudFilter} onChange={e=>setCloudFilter(e.target.value as typeof cloudFilter)}><option value="all"><Trans>All</Trans> ({items.length})</option><option value="active"><Trans>In progress</Trans> ({items.length-completed})</option><option value="done"><Trans>Completed</Trans> ({completed})</option></select>
        </div>
        {visible.length===0?<div className="tsugi-vault-empty"><BrushFolder aria-hidden/><p>{items.length?<Trans>No matching downloads.</Trans>:<Trans>No cloud downloads yet. Choose New cloud download to send a link.</Trans>}</p></div>:<div className="tsugi-torbox-table" role="table" aria-label={t`Cloud download list`}>
          <div className="tsugi-torbox-row tsugi-torbox-columns" role="row"><span role="columnheader"><Trans>File name</Trans></span><span role="columnheader"><Trans>Status</Trans></span></div>
          {visible.map(item=><div key={item.id} className="tsugi-torbox-row" role="row"><span role="cell" className="tsugi-torbox-filename" title={item.name}><BrushFolder aria-hidden/>{item.name||t`Unnamed download`}</span><span role="cell" className="tsugi-vault-connection" data-connected={item.finished}>{item.finished?t`Complete`:item.state||t`Pending status`}</span></div>)}
        </div>}
      </>}
    </>}
    {busy && <p role="status"><Trans>Contacting TorBox…</Trans></p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
