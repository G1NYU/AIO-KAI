import React from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { shellDownloads } from '@/lib/hosts/shell/downloads';
import { youtubeVaultJob } from '@/app/vault/native-job';
import { TorBoxPanel } from '@/app/vault/torbox-panel';
import { supportsNativeTorBox } from '@/app/vault/native-torbox';

export function TrackDownload({track,onClose}:{track:{id:string;title:string};onClose:()=>void}) {
  const dialog=React.useRef<HTMLDialogElement>(null);
  const [cloud,setCloud]=React.useState(false);
  const [allowed,setAllowed]=React.useState(false);
  const [busy,setBusy]=React.useState(false);
  const [notice,setNotice]=React.useState('');
  const [error,setError]=React.useState('');
  const cancel=React.useRef<(()=>void)|null>(null);
  const url=new URL('https://www.youtube.com/watch');
  url.searchParams.set('v',track.id);
  const link=url.href;
  React.useEffect(()=>{
    const node=dialog.current;
    if(node&&!node.open)node.showModal();
    return ()=>{cancel.current?.();if(node?.open)node.close();};
  },[]);
  function local(){
    if(!allowed||busy||notice)return;
    setError('');
    try {
      const id='vault-'+Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
      const job=youtubeVaultJob(link,id,track.title);
      setBusy(true);
      const stop=shellDownloads.subscribe(event=>{
        if(event.type==='state'&&event.jobs.some(row=>row.id===id)){
          cancel.current?.();setBusy(false);setNotice(t`Added to Vault. You can follow the download there.`);
        }
      });
      const timer=window.setTimeout(()=>{
        cancel.current?.();setBusy(false);setError(t`The download was not acknowledged. Check Vault before retrying.`);
      },8000);
      cancel.current=()=>{window.clearTimeout(timer);stop();cancel.current=null;};
      shellDownloads.add([job]);
    }catch{cancel.current?.();setBusy(false);setError(t`Could not queue this YouTube track.`);}
  }
  return <dialog ref={dialog} className="tsugi-global-settings tsugi-track-download" aria-label={t`Download track`} onCancel={event=>{event.preventDefault();onClose();}}>
    <header><h2><Trans>Download track</Trans></h2><button type="button" className="tsugi-read-action" onClick={onClose}><Trans>Close</Trans></button></header>
    <p className="tsugi-track-download-title">{track.title}</p>
    <div className="tsugi-vault-actions">
      <button type="button" className="tsugi-read-action" aria-pressed={!cloud} disabled={busy} onClick={()=>setCloud(false)}><Trans>Save to this PC</Trans></button>
      {supportsNativeTorBox()&&<button type="button" className="tsugi-read-action" aria-pressed={cloud} disabled={busy} onClick={()=>setCloud(true)}><Trans>Send to TorBox</Trans></button>}
    </div>
    {cloud?<TorBoxPanel initialLink={link} compact/>:<>
      <p><Trans>Save the available M4A audio in your Vault download folder.</Trans></p>
      <label className="tsugi-track-permission"><input type="checkbox" checked={allowed} onChange={event=>setAllowed(event.target.checked)} disabled={busy||!!notice}/><Trans>I have permission to download this track.</Trans></label>
      <button type="button" className="tsugi-read-action tsugi-series-primary" disabled={!allowed||busy||!!notice} onClick={local}><Trans>Download</Trans></button>
      {busy&&<p role="status"><Trans>Adding download…</Trans></p>}
      {notice&&<p role="status">{notice}</p>}
      {error&&<p role="alert">{error}</p>}
    </>}
  </dialog>;
}
