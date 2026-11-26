import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { copyToClipboard } from '@aiostreams/ui/utils/clipboard';
import { appBridge, ask } from '@/lib/hosts/shell/bridge';
import { supportSummaryText } from '@/lib/support-summary';

export function SupportSummarySettings() {
  const [preview, setPreview] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [copying, setCopying] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const mounted = React.useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function refresh() {
    if (busy || copying) return;
    setBusy(true); setPreview(''); setMessage('');
    const bridge = appBridge();
    let nativeInfo: unknown, infoStatus: 'available' | 'unavailable' | 'failed' = 'unavailable';
    try {
      if (bridge) {
        nativeInfo = await ask({ type: 'app-info' }, 'app-info', { timeoutMs: 10_000 });
        infoStatus = 'available';
      }
    } catch { infoStatus = 'failed'; }
    if (!mounted.current) return;
    setPreview(supportSummaryText({ webBuild: __APP_COMMIT__, webVersion: __APP_VERSION__, bridge, nativeInfo, infoStatus }));
    if (infoStatus === 'failed') setMessage(t({ id: 'Native version details did not respond. Available build and capability fields are still included.', message: 'Native version details did not respond. Available build and capability fields are still included.' }));
    else if (!bridge) setMessage(t({ id: 'Native engine details are unavailable in this environment.', message: 'Native engine details are unavailable in this environment.' }));
    setBusy(false);
  }
  async function copy() {
    if (!preview || busy || copying) return;
    setCopying(true); setMessage('');
    try {
      await copyToClipboard(preview, {
        onSuccess: () => { if (mounted.current) setMessage(t({ id: 'Support summary copied.', message: 'Support summary copied.' })); },
        onError: () => { if (mounted.current) setMessage(t({ id: 'Could not copy automatically. Select the preview and copy it manually.', message: 'Could not copy automatically. Select the preview and copy it manually.' })); },
      });
    } catch { if (mounted.current) setMessage(t({ id: 'Could not copy automatically. Select the preview and copy it manually.', message: 'Could not copy automatically. Select the preview and copy it manually.' })); }
    finally { if (mounted.current) setCopying(false); }
  }
  return <section className="tsugi-app-general" data-ui="support-summary" aria-label={t({ id: 'Diagnostics', message: 'Diagnostics' })}>
    <h3><Trans id="Advanced">Advanced</Trans></h3>
    <h4 className="font-semibold"><Trans id="Diagnostics">Diagnostics</Trans></h4>
    <p><Trans id="Create a support summary of build versions and supported engines. This does not test accounts or provider access.">Create a support summary of build versions and supported engines. This does not test accounts or provider access.</Trans></p>
    <p><Trans id="No logs, library titles, account details or connection addresses are included. Only the preview below is copied.">No logs, library titles, account details or connection addresses are included. Only the preview below is copied.</Trans></p>
    <div className="flex flex-wrap gap-3">
      <button className="tsugi-read-action" disabled={busy || copying} onClick={() => void refresh()}>{preview ? <Trans id="Refresh support summary">Refresh support summary</Trans> : <Trans id="Create support summary">Create support summary</Trans>}</button>
      {preview && <button className="tsugi-read-action" disabled={busy || copying} onClick={() => void copy()}><Trans id="Copy support summary">Copy support summary</Trans></button>}
    </div>
    {busy && <p role="status"><Trans id="Reading native version details…">Reading native version details…</Trans></p>}
    {message && <p role="status">{message}</p>}
    {preview && <textarea className="tsugi-read-input mt-3 w-full min-w-0 font-mono text-xs" rows={14} readOnly spellCheck={false} aria-label={t({ id: 'Support summary preview', message: 'Support summary preview' })} value={preview} />}
  </section>;
}
