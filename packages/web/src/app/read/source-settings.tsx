import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { readRequest } from '@/lib/hosts/shell/reading';
import type { SourceMetadata } from './source-metadata';

type Control = {
  id: string; title: string; kind: 'switch' | 'checkbox' | 'select' | 'unsupported';
  enabled: boolean; value?: boolean | number; options?: string[];
  reason?: 'unsupported-type' | 'disabled' | 'missing-key' | 'invalid-options' | 'unavailable-value';
};
type Preview = { reviewId: string; sourceId: string; sourceName: string; extensionName: string; versionName: string; controls: Control[] };
type Result = { reviewId: string; controlId: string; status: 'applied' | 'rolled-back' | 'cancelled'; checkpointId?: string; error?: string };
type Draft = { controlId: string; value: boolean | number };
const opaqueId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);

function checkedPreview(value: Preview, sourceId: string): Preview {
  const invalid = () => { throw new Error(t({ id: 'The source settings response could not be verified.', message: 'The source settings response could not be verified.' })); };
  if (!value || !opaqueId(value.reviewId) || value.sourceId !== sourceId || !Array.isArray(value.controls) || value.controls.length > 100) return invalid();
  for (const text of [value.sourceName, value.extensionName, value.versionName]) if (typeof text !== 'string' || [...text].length > 500) return invalid();
  const ids = new Set<string>();
  for (const control of value.controls) {
    if (!control || !opaqueId(control.id) || ids.has(control.id) || typeof control.title !== 'string' || [...control.title].length > 200 ||
        !['switch', 'checkbox', 'select', 'unsupported'].includes(control.kind) || typeof control.enabled !== 'boolean') return invalid();
    ids.add(control.id);
    if (control.options !== undefined && (!Array.isArray(control.options) || control.options.length > 64 || control.options.some(label => typeof label !== 'string' || [...label].length > 200))) return invalid();
    if (control.enabled && (control.kind === 'unsupported' || (control.kind === 'select'
      ? !Number.isInteger(control.value) || typeof control.value !== 'number' || control.value < 0 || control.value >= (control.options?.length || 0)
      : typeof control.value !== 'boolean'))) return invalid();
  }
  return value;
}
function displayedValue(control: Control, value: boolean | number) {
  return typeof value === 'boolean' ? value ? t({ id: 'On', message: 'On' }) : t({ id: 'Off', message: 'Off' }) : control.options?.[value] ?? t({ id: 'Unknown', message: 'Unknown' });
}

/** Opened only by an explicit Settings action. Native code retains preference
 * keys, positions and underlying option values; this UI receives opaque IDs. */
export function SourceSettings({ source, busy, request, onClose }: {
  source: SourceMetadata; busy: boolean; request: typeof readRequest; onClose: () => void;
}) {
  const dialog = React.useRef<HTMLDialogElement>(null);
  const initial = React.useRef<Promise<Preview> | null>(null);
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [reviewing, setReviewing] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [result, setResult] = React.useState<Result | null>(null);
  const working = busy || loading;
  const activeControl = preview?.controls.find(control => control.id === draft?.controlId);
  const failure = (reason: unknown) => reason instanceof Error ? reason.message : t({ id: 'The source settings request failed. Reload settings before trying again.', message: 'The source settings request failed. Reload settings before trying again.' });

  React.useEffect(() => {
    const node = dialog.current;
    if (node && !node.open) node.showModal();
    let active = true;
    // StrictMode can replay mounting effects. Reuse the initial request so the
    // native review displayed here is not invalidated by a second preview.
    const pending = initial.current ||= request<Preview>({ kind: 'source-preferences', source: source.id }).then(value => checkedPreview(value, source.id));
    pending.then(value => { if (active) setPreview(value); }, reason => { if (active) setError(reason instanceof Error ? reason.message : t({ id: 'Could not load source settings.', message: 'Could not load source settings.' })); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; if (node?.open) node.close(); };
  }, [source.id, request]);

  async function reload() {
    if (working) return;
    setLoading(true); setPreview(null); setDraft(null); setReviewing(false); setError(''); setResult(null);
    try { setPreview(checkedPreview(await request<Preview>({ kind: 'source-preferences', source: source.id }), source.id)); }
    catch (reason) { setError(failure(reason)); }
    finally { setLoading(false); }
  }
  async function close() {
    if (working) return;
    setLoading(true);
    try { if (preview) await request({ kind: 'cancel-source-preferences', reviewId: preview.reviewId }); }
    catch { /* Closing still discards every local capability; native expiry remains bounded. */ }
    finally { onClose(); }
  }
  function change(control: Control, value: boolean | number) {
    if (working || reviewing || !control.enabled || (draft && draft.controlId !== control.id)) return;
    setDraft(value === control.value ? null : { controlId: control.id, value });
    setError(''); setResult(null);
  }
  async function apply() {
    if (working || !reviewing || !preview || !draft || !activeControl?.enabled) return;
    const { reviewId } = preview, { controlId, value } = draft;
    // The native capability is single-use even if the reply is lost. Never
    // retry it or re-evaluate extension settings automatically after applying.
    setLoading(true); setPreview(null); setDraft(null); setReviewing(false); setError(''); setResult(null);
    try {
      const response = await request<Result>({ kind: 'apply-source-preference', reviewId, controlId, value });
      if (!response || response.reviewId !== reviewId || response.controlId !== controlId || !['applied', 'rolled-back', 'cancelled'].includes(response.status))
        throw new Error(t({ id: 'The setting result could not be verified. Reload settings to check its current value.', message: 'The setting result could not be verified. Reload settings to check its current value.' }));
      setResult(response);
    } catch (reason) { setError(failure(reason)); }
    finally { setLoading(false); }
  }

  return <dialog ref={dialog} className="tsugi-global-settings" data-ui="source-settings" role="dialog" aria-modal="true" aria-label={t({ id: 'Source settings', message: 'Source settings' })} onCancel={event => { event.preventDefault(); void close(); }}>
    <header><h2><Trans id="Source settings">Source settings</Trans></h2><button className="tsugi-read-action" disabled={working} onClick={() => void close()}><Trans id="Close">Close</Trans></button></header>
    <p className="mt-4 break-words font-semibold">{source.displayName || source.name}</p>
    {preview && <p className="mt-1 break-words text-xs text-[--tsugi-muted]">{preview.extensionName} · {preview.versionName}</p>}
    <p className="my-4 text-sm text-[--tsugi-muted]"><Trans id="Edit one switch, checkbox or single-choice setting at a time. Other setting types are not supported yet.">Edit one switch, checkbox or single-choice setting at a time. Other setting types are not supported yet.</Trans></p>
    {working && <p className="py-3" role="status"><Trans id="Checking source settings…">Checking source settings…</Trans></p>}
    {error && <p className="my-3 break-words text-sm" role="alert">{error}</p>}
    {result && <div className="tsugi-read-row my-4 block" role="status" data-source-settings-status={result.status}>
      {result.status === 'applied' ? <Trans id="Setting saved and verified after restarting Reader.">Setting saved and verified after restarting Reader.</Trans> : result.status === 'rolled-back' ? <Trans id="The setting could not be applied. The previous Reader state was restored and verified.">The setting could not be applied. The previous Reader state was restored and verified.</Trans> : <Trans id="Change cancelled. No setting was saved.">Change cancelled. No setting was saved.</Trans>}
      {result.error && <p className="mt-2 text-sm">{result.error}</p>}
    </div>}
    {preview && !preview.controls.length && <p className="py-3"><Trans id="This source exposes no visible settings.">This source exposes no visible settings.</Trans></p>}
    {preview?.controls.map(control => {
      const value = draft?.controlId === control.id ? draft.value : control.value;
      const disabled = working || reviewing || !control.enabled || (!!draft && draft.controlId !== control.id);
      return <div key={control.id} data-control-id={control.id} className="tsugi-read-row flex-wrap gap-3">
        {(control.kind === 'switch' || control.kind === 'checkbox') && typeof value === 'boolean' ? <label className="flex min-w-0 flex-1 items-center gap-3"><input type="checkbox" aria-label={control.title} checked={value} disabled={disabled} onChange={event => change(control, event.target.checked)} /><span className="break-words">{control.title}</span></label>
          : control.kind === 'select' && typeof value === 'number' && control.options ? <label className="flex min-w-0 flex-1 flex-wrap items-center gap-3"><span className="min-w-0 flex-1 break-words">{control.title}</span><select className="tsugi-read-input w-full min-w-0 sm:w-auto sm:max-w-[60%]" aria-label={control.title} value={value} disabled={disabled} onChange={event => change(control, Number(event.target.value))}>{control.options.map((label, index) => <option key={index} value={index}>{label}</option>)}</select></label>
            : <span className="min-w-0 break-words">{control.title}</span>}
        {!control.enabled && <p className="basis-full text-xs text-[--tsugi-muted]">{control.reason === 'disabled' ? <Trans id="Disabled by this source.">Disabled by this source.</Trans> : control.reason === 'unsupported-type' ? <Trans id="This setting type is not supported yet.">This setting type is not supported yet.</Trans> : <Trans id="This setting cannot be edited with its current definition.">This setting cannot be edited with its current definition.</Trans>}</p>}
      </div>;
    })}
    {draft && activeControl && <section className="my-4 rounded bg-[--tsugi-panel] p-4" aria-label={t({ id: 'Review setting change', message: 'Review setting change' })}>
      {reviewing ? <><h3 className="break-words font-semibold">{activeControl.title}</h3><p className="my-2 break-words">{displayedValue(activeControl, activeControl.value!)} → {displayedValue(activeControl, draft.value)}</p><p className="mb-3 text-sm text-[--tsugi-muted]"><Trans id="Reader will restart to verify this change. Confirm it in the native window when prompted.">Reader will restart to verify this change. Confirm it in the native window when prompted.</Trans></p></> : <p className="mb-3 text-sm"><Trans id="Review or cancel this change before editing another setting.">Review or cancel this change before editing another setting.</Trans></p>}
      <div className="flex flex-wrap gap-2"><button className="tsugi-read-action" disabled={working} onClick={() => reviewing ? void apply() : setReviewing(true)}>{reviewing ? <Trans id="Apply change">Apply change</Trans> : <Trans id="Review change">Review change</Trans>}</button><button className="tsugi-read-action" disabled={working} onClick={() => { setDraft(null); setReviewing(false); }}><Trans id="Cancel change">Cancel change</Trans></button></div>
    </section>}
    <div className="mt-4 flex flex-wrap gap-3"><button className="tsugi-read-action" disabled={working || !!draft} onClick={() => void reload()}><Trans id="Reload settings">Reload settings</Trans></button></div>
  </dialog>;
}
