import { useEffect, useRef } from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { PreparedVaultAudio, VaultAudioEntry } from '@/lib/music/vault-audio';

export type AudioImportReview = {
  jobId:string; name:string; bytes:number; prepared:PreparedVaultAudio; duplicate?:VaultAudioEntry;
};
export function VaultAudioImportReview({review,busy,onApply,onClose}:{review:AudioImportReview;busy:boolean;onApply:()=>void;onClose:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const node=dialog.current;if(node&&!node.open)node.showModal();return()=>{if(node?.open)node.close();};},[]);
  const minutes=Math.floor(review.prepared.duration/60),seconds=String(Math.floor(review.prepared.duration%60)).padStart(2,'0');
  return <dialog ref={dialog} className="tsugi-global-settings kura-import-review" data-ui="vault-audio-import-review" aria-label={t`Review audio import`}
    onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
    <header><div><p className="kura-eyebrow"><Trans>FROM VAULT TO YOUR LIBRARY</Trans></p><h2><Trans>Import into Music</Trans></h2></div>
      <button type="button" className="tsugi-read-action" disabled={busy} onClick={onClose}><Trans>Cancel import</Trans></button></header>
    <dl className="kura-import-facts">
      <dt><Trans>File</Trans></dt><dd className="break-words">{review.name}</dd>
      <dt><Trans>Size</Trans></dt><dd>{(review.bytes/1048576).toFixed(1)} MiB</dd>
      <dt><Trans>Duration</Trans></dt><dd>{minutes}:{seconds}</dd>
      <dt><Trans>Destination</Trans></dt><dd><Trans>Music / Local music</Trans></dd>
    </dl>
    <p className="kura-import-description"><Trans>Save a local audio copy that remains available after restarting Tsugi. The original download stays in Vault.</Trans></p>
    {review.duplicate?<section className="kura-import-duplicates" aria-label={t`Identical audio already saved`}><h3><Trans>Identical content already exists</Trans></h3>
      <p>{review.duplicate.title}</p><p><Trans>Reuse the existing saved copy instead of storing the audio twice.</Trans></p></section>:
      <p className="kura-import-clear"><Trans>No identical saved copy was found.</Trans></p>}
    <p className="kura-import-description"><Trans>Saved Vault audio uses up to 2 GiB and 250 files. Each file must be playable by the local audio engine and at most 128 MiB.</Trans></p>
    {busy&&<p role="status"><Trans>Saving audio…</Trans></p>}
    <button type="button" className="tsugi-read-action tsugi-series-primary" disabled={busy} onClick={onApply}>
      {review.duplicate?<Trans>Reuse saved copy</Trans>:<Trans>Confirm import</Trans>}
    </button>
  </dialog>;
}
