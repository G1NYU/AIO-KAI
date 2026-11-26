import { useEffect, useRef, useState, type RefObject } from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { BrushBook, BrushDisc, BrushDownload, BrushFolder, BrushPlus, BrushRight } from '@/components/tsugi-icons';
import { useDesktopArea } from '@/lib/desktop-area';
import { appBridge } from '@/lib/hosts/shell/bridge';
import { LandscapeDecoration } from '@/components/landscape-decoration';
import { saveVaultFile, vaultPicker, vaultTarget } from './transfer';
import { NativeVaultQueue } from './native-queue';
import './kura.css';

function focusPanel(ref: RefObject<HTMLElement | null>, focusInput = false) {
  const panel = ref.current;
  if (!panel) return;
  panel.scrollIntoView({ block: 'start' });
  const field = focusInput ? panel.querySelector<HTMLInputElement | HTMLTextAreaElement>('input:not([type="checkbox"]), textarea') : null;
  (field || panel).focus({ preventScroll: true });
}

export function VaultPage({ track = null }: { track?: { id: string; title: string } | null }) {
  const actions = useDesktopArea();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<{ bytes: number; total: number | null }>({ bytes: 0, total: null });
  const [saved, setSaved] = useState<{ name: string; bytes: number }[]>([]);
  const controller = useRef<AbortController | null>(null);
  const capture = useRef<HTMLElement | null>(null);
  const transfers = useRef<HTMLElement | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const supported = !!vaultPicker();
  const nativeSupported = appBridge()?.platform === 'windows';

  async function download() {
    if (controller.current) return;
    const picker = vaultPicker();
    if (!picker) return;
    const active = new AbortController();
    controller.current = active;
    setBusy(true); setError(''); setProgress({ bytes: 0, total: null });
    try {
      const target = vaultTarget(input);
      const bytes = await saveVaultFile(target, picker, active.signal, (bytes, total) => setProgress({ bytes, total }));
      setSaved(old => [{ name: target.name, bytes }, ...old]); setInput('');
    } catch (e) {
      if (!active.signal.aborted && !(e instanceof DOMException && e.name === 'AbortError')) setError(e instanceof Error ? e.message : t`Download failed`);
    } finally {
      if (controller.current === active) { controller.current = null; setBusy(false); }
    }
  }

  return <main className="tsugi-vault-root kura-page" data-page="vault">
    <header className="tsugi-vault-page-header">
      <div className="kura-page-title"><p className="tsugi-feature-kicker"><Trans>Your space</Trans><span aria-hidden="true"> / </span><Trans>Download center</Trans></p><h1><Trans>Vault</Trans></h1></div>
      <div className="tsugi-vault-actions kura-library-links">
        {actions?.openBooks && <button className="tsugi-read-action" onClick={actions.openBooks} disabled={busy}><BrushBook aria-hidden/><Trans>Local books</Trans></button>}
        <button className="tsugi-read-action" onClick={actions?.openLocalMusic} disabled={busy || !actions?.openLocalMusic}><BrushDisc aria-hidden/><Trans>Local music</Trans></button>
        <button className="tsugi-read-action" onClick={actions?.openVideoDownloads} disabled={busy || !actions?.openVideoDownloads}><BrushDownload aria-hidden/><Trans>Video downloads</Trans></button>
      </div>
    </header>

    <section className="kura-hero" aria-labelledby="kura-hero-title" data-ui="kura-hero">
      <LandscapeDecoration className="kura-hero-art" fallback="/design/kura/hero-kura.webp"/>
      <div className="kura-hero-copy">
        <p className="kura-eyebrow"><Trans>TSUGI / YOUR PERSONAL VAULT</Trans></p>
        <h2 id="kura-hero-title"><Trans>Everything worth keeping.</Trans></h2>
        <p className="kura-hero-description"><Trans>A book. A song. A little discovery. Bring the things you love into one beautiful place.</Trans></p>
        <div className="kura-hero-actions">
          <button type="button" className="tsugi-read-action tsugi-series-primary" disabled={!nativeSupported || busy} onClick={() => focusPanel(capture, true)}><BrushPlus aria-hidden/><Trans>Add links</Trans></button>
          <button type="button" className="tsugi-read-action kura-hero-secondary" disabled={!nativeSupported || busy} onClick={() => focusPanel(transfers)}><Trans>View transfers</Trans><BrushRight aria-hidden/></button>
        </div>
      </div>
      <span className="kura-hero-japanese" lang="ja" aria-hidden="true">好きなものを、ここに。</span>
    </section>

    <NativeVaultQueue track={track} captureRef={capture} transfersRef={transfers} navigationDisabled={busy}/>

    <details className="tsugi-vault-advanced kura-manual-save">
      <summary><BrushFolder aria-hidden/><span><Trans>Save a direct file to a custom location</Trans></span></summary>
      <div className="kura-manual-grid">
        <section>
          <p className="kura-eyebrow"><Trans>CHOOSE YOUR OWN DESTINATION</Trans></p>
          <h2><Trans>Download a book or audio file</Trans></h2>
          <p className="kura-manual-description"><Trans>Use a direct HTTPS file link you have permission to download. PDF, EPUB and common audio formats, up to 256 MiB. The host must allow direct browser access.</Trans></p>
          <form className="tsugi-vault-form" onSubmit={e => { e.preventDefault(); void download(); }}>
            <label><Trans>File URL</Trans><input type="url" required value={input} onChange={e => setInput(e.target.value)} placeholder="https://example.com/book.epub" disabled={busy}/></label>
            <div className="tsugi-vault-actions">
              <button type="submit" className="tsugi-read-action tsugi-series-primary" disabled={busy || !supported || !input.trim()}><BrushDownload aria-hidden/><Trans>Choose destination and save</Trans></button>
              {busy && <button type="button" className="tsugi-read-action" onClick={() => controller.current?.abort()}><Trans>Cancel</Trans></button>}
            </div>
            {!supported && <p role="status" className="kura-notice"><Trans>Direct file saving is unavailable in this webview.</Trans></p>}
            {busy && <><progress aria-label={t`Download progress`} max={progress.total || undefined} value={progress.total ? progress.bytes : undefined}/><span role="status">{(progress.bytes / 1048576).toFixed(1)} MiB</span></>}
            {error && <p role="alert" className="kura-notice">{error}</p>}
          </form>
        </section>
        <section className="kura-session-files" aria-labelledby="kura-session-heading">
          <p className="kura-eyebrow"><Trans>A LITTLE CLOSER</Trans></p>
          <h2 id="kura-session-heading"><Trans>Saved this session</Trans></h2>
          {saved.length === 0 ? <div className="kura-session-empty"><BrushFolder aria-hidden/><p><Trans>No completed transfers yet.</Trans></p></div> : saved.map((file, i) => <div className="tsugi-vault-file-row" key={i}>{/\.(pdf|epub)$/i.test(file.name)?<BrushBook aria-hidden/>:<BrushDisc aria-hidden/>}<span>{file.name}</span><small>{(file.bytes / 1048576).toFixed(1)} MiB</small></div>)}
        </section>
      </div>
    </details>
    <footer className="kura-footer"><span><Trans>Your files. Your little universe.</Trans></span><span lang="ja" aria-hidden="true">あなたの、小さな世界。</span></footer>
  </main>;
}
