import { useEffect,useRef,useState } from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { TsugiRail } from '@/components/shell/tsugi-rail';
import { LandscapeSpotlight } from '@/components/landscape-spotlight';
import { useDesktopArea } from '@/lib/desktop-area';
import { saveVaultFile,vaultPicker,vaultTarget } from './transfer';
import { TorBoxPanel } from './torbox-panel';
import { NativeVaultQueue } from './native-queue';

export function VaultPage(){
  const actions=useDesktopArea();
  const [input,setInput]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [progress,setProgress]=useState<{bytes:number;total:number|null}>({bytes:0,total:null});
  const [saved,setSaved]=useState<{name:string;bytes:number}[]>([]);
  const controller=useRef<AbortController|null>(null);
  const form=useRef<HTMLInputElement>(null);
  useEffect(()=>()=>controller.current?.abort(),[]);
  const supported=!!vaultPicker();
  async function download(){
    if(controller.current)return;
    const picker=vaultPicker();if(!picker)return;
    const active=new AbortController();
    controller.current=active;setBusy(true);setError('');setProgress({bytes:0,total:null});
    try {
      const target=vaultTarget(input);
      const bytes=await saveVaultFile(target,picker,active.signal,(bytes,total)=>setProgress({bytes,total}));
      setSaved(old=>[{name:target.name,bytes},...old]);setInput('');
    }catch(e){if(!active.signal.aborted&&!(e instanceof DOMException&&e.name==='AbortError'))setError(e instanceof Error?e.message:t`Download failed`);}
    finally{if(controller.current===active){controller.current=null;setBusy(false);}}
  }
  return <main className="tsugi-vault-root" data-page="vault">
    <TsugiRail area="vault" disabled={busy}/>
    <LandscapeSpotlight title={t`Vault`} eyebrow={t`Your media collection`} description={t`Books, music and downloads, in one place.`} actionLabel={t`Save a file`} onAction={()=>form.current?.focus()} disabled={busy||!supported}/>
    <section className="tsugi-vault-actions">
      {actions?.openBooks&&<button className="tsugi-read-action" onClick={actions.openBooks} disabled={busy}><Trans>Local books</Trans></button>}
      <button className="tsugi-read-action" onClick={actions?.openLocalMusic} disabled={busy}><Trans>Local music</Trans></button>
      <button className="tsugi-read-action" onClick={actions?.openVideoDownloads} disabled={busy}><Trans>Video downloads</Trans></button>
    </section>
    <h2><Trans>Download a book or audio file</Trans></h2>
    <p><Trans>Use a direct HTTPS file link you have permission to download. PDF, EPUB and common audio formats, up to 256 MiB. The host must allow direct browser access.</Trans></p>
    <form className="tsugi-vault-form" onSubmit={e=>{e.preventDefault();void download();}}>
      <label><Trans>File URL</Trans><input ref={form} type="url" required value={input} onChange={e=>setInput(e.target.value)} placeholder="https://example.com/book.epub" disabled={busy}/></label>
      <div className="tsugi-vault-actions"><button type="submit" className="tsugi-read-action tsugi-series-primary" disabled={busy||!supported||!input.trim()}><Trans>Choose destination and save</Trans></button>
        {busy&&<button type="button" className="tsugi-read-action" onClick={()=>controller.current?.abort()}><Trans>Cancel</Trans></button>}
      </div>
      {!supported&&<p role="status"><Trans>Direct file saving is unavailable in this webview.</Trans></p>}
      {busy&&<><progress max={progress.total||undefined} value={progress.total?progress.bytes:undefined}/><span role="status">{(progress.bytes/1048576).toFixed(1)} MiB</span></>}
      {error&&<p role="alert">{error}</p>}
    </form>
    <div className="tsugi-pixel-rule" style={{height:4,marginBlock:24}} aria-hidden="true"/>
    <h2><Trans>Saved this session</Trans></h2>
    {saved.length===0?<p><Trans>No completed transfers yet.</Trans></p>:saved.map((file,i)=><div className="tsugi-vault-file-row" key={i}><span>{file.name}</span><span>{(file.bytes/1048576).toFixed(1)} MiB</span></div>)}
    <div className="tsugi-pixel-rule" style={{height:4,marginBlock:24}} aria-hidden="true"/>
    <NativeVaultQueue/>
    <div className="tsugi-pixel-rule" style={{height:4,marginBlock:24}} aria-hidden="true"/>
    <TorBoxPanel/>
  </main>;
}
