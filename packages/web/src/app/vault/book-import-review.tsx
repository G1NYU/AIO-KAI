import { useEffect, useRef } from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import type { BookEntry } from '@/app/read/book-library';

export type BookImportReview = {
  id: string;
  name: string;
  bytes: number;
  duplicates: Pick<BookEntry, 'id' | 'title' | 'name' | 'size'>[];
};

export function VaultBookImportReview({ review, busy, saving, anotherCopy, onAnotherCopy, onApply, onClose }: {
  review: BookImportReview;
  busy: boolean;
  saving: boolean;
  anotherCopy: boolean;
  onAnotherCopy: (value: boolean) => void;
  onApply: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (node && !node.open) node.showModal();
    return () => { if (node?.open) node.close(); };
  }, []);
  return <dialog ref={dialog} className="tsugi-global-settings" data-ui="vault-book-import-review" aria-label={t`Review book import`} onCancel={event => { event.preventDefault(); if (!saving) onClose(); }}>
    <header><h2><Trans>Import into Books</Trans></h2><button type="button" className="tsugi-read-action" disabled={saving} onClick={onClose}><Trans>Cancel import</Trans></button></header>
    <dl className="my-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
      <dt><Trans>File</Trans></dt><dd className="break-words">{review.name}</dd>
      <dt><Trans>Size</Trans></dt><dd>{(review.bytes / 1048576).toFixed(1)} MiB</dd>
      <dt><Trans>Destination</Trans></dt><dd><Trans>Books</Trans></dd>
    </dl>
    <p className="my-4 text-sm text-[--tsugi-muted]"><Trans>A saved copy will be added to your local Books library. The completed download stays in Vault.</Trans></p>
    {review.duplicates.length > 0 ? <section className="my-4 rounded bg-[--tsugi-panel] p-4" aria-label={t`Possible duplicate books`}>
      <h3 className="font-semibold"><Trans>Books already contains this filename</Trans></h3>
      <p className="my-2 text-sm text-[--tsugi-muted]"><Trans>Matching names do not confirm identical content. Existing books and reading progress will be kept.</Trans></p>
      <ul className="my-3 space-y-2 text-sm">{review.duplicates.map(book => <li key={book.id} className="break-words">{book.title} · {(book.size / 1048576).toFixed(1)} MiB</li>)}</ul>
      <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={anotherCopy} disabled={busy} onChange={event => onAnotherCopy(event.target.checked)}/><Trans>Import another copy</Trans></label>
    </section> : <p className="my-3 text-sm"><Trans>No matching filename was found in Books.</Trans></p>}
    {busy && <p role="status" className="my-3 text-sm">{saving?<Trans>Saving book…</Trans>:<Trans>Importing completed file…</Trans>}</p>}
    <button type="button" className="tsugi-read-action" disabled={busy || (review.duplicates.length > 0 && !anotherCopy)} onClick={onApply}><Trans>Confirm import</Trans></button>
  </dialog>;
}
