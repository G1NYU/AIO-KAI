import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { formatBytes } from '@aiostreams/ui/core/format';
import { LocalComicImportController, localComicImportBusy, type LocalComicRequest, type LocalComicResult, type LocalComicError } from './local-comic-import-state';

export function useLocalComicImport(request: LocalComicRequest) {
  const [controller] = React.useState(() => new LocalComicImportController(request));
  const snapshot = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  React.useEffect(() => { controller.setMounted(true); return () => controller.setMounted(false); }, [controller]);
  return { controller, snapshot };
}

function errorLabel(error: LocalComicError) {
  switch (error) {
    case 'invalid': return t({ id: 'The CBZ archive could not be safely imported. Choose a supported PNG/JPEG archive within the import limits.', message: 'The CBZ archive could not be safely imported. Choose a supported PNG/JPEG archive within the import limits.' });
    case 'expired': return t({ id: 'The CBZ import review expired or changed. Choose the archive again.', message: 'The CBZ import review expired or changed. Choose the archive again.' });
    case 'folder': return t({ id: 'CBZ import requires the default private local manga folder.', message: 'CBZ import requires the default private local manga folder.' });
    case 'unreadable': return t({ id: 'The selected CBZ could not be read. Close other applications using it and choose it again.', message: 'The selected CBZ could not be read. Close other applications using it and choose it again.' });
    case 'choose': return t({ id: 'The CBZ could not be reviewed. Nothing was added to Read. Choose a supported archive to try again.', message: 'The CBZ could not be reviewed. Nothing was added to Read. Choose a supported archive to try again.' });
    case 'unconfirmed': return t({ id: 'The import result could not be confirmed. Check your library, or choose the same CBZ again for a fresh review. The import was not repeated automatically.', message: 'The import result could not be confirmed. Check your library, or choose the same CBZ again for a fresh review. The import was not repeated automatically.' });
    case 'cancel': return t({ id: 'Cancellation could not be confirmed. This review was discarded. Choose the CBZ again before importing it.', message: 'Cancellation could not be confirmed. This review was discarded. Choose the CBZ again before importing it.' });
  }
}

export function LocalComicImport({ localImport, busy, onClose, onImported, onOpen }: {
  localImport: ReturnType<typeof useLocalComicImport>; busy: boolean; onClose(): void;
  onImported(): Promise<void>; onOpen(result: Extract<LocalComicResult, { mangaId: number }>): void;
}) {
  const dialog = React.useRef<HTMLDialogElement>(null);
  const { controller, snapshot } = localImport;
  const { review, result, error } = snapshot;
  const working = busy || localComicImportBusy(snapshot);
  React.useEffect(() => {
    const node = dialog.current;
    if (node && !node.open) node.showModal();
    return () => { if (node?.open) node.close(); };
  }, []);
  async function close() {
    if (working) return;
    if (await controller.cancel()) onClose();
  }
  async function apply() {
    const result = await controller.apply();
    if (result && 'mangaId' in result) await onImported();
  }
  return <dialog ref={dialog} data-ui="local-comic-import" className="tsugi-global-settings" role="dialog" aria-modal="true" aria-label={t({ id: 'Import local comic', message: 'Import local comic' })} onCancel={event => { event.preventDefault(); void close(); }}>
    <header><h2><Trans id="Import local comic">Import local comic</Trans></h2><button className="tsugi-read-action" disabled={working} onClick={() => void close()}><Trans id="Close">Close</Trans></button></header>
    <p className="my-4 text-sm text-[--tsugi-muted]"><Trans id="Choose one CBZ with PNG or JPEG pages. Archives are limited to 256 MiB, 512 MiB after expansion and 2,000 pages. Review it before adding it to Read.">Choose one CBZ with PNG or JPEG pages. Archives are limited to 256 MiB, 512 MiB after expansion and 2,000 pages. Review it before adding it to Read.</Trans></p>
    {working && <p role="status" className="my-4 text-sm text-[--tsugi-muted]">{snapshot.phase === 'choosing'
      ? t({ id: 'Choose a CBZ in the native file window. Tsugi will validate it for review.', message: 'Choose a CBZ in the native file window. Tsugi will validate it for review.' })
      : snapshot.phase === 'applying' ? t({ id: 'Adding the reviewed comic… Confirm in the native window if prompted.', message: 'Adding the reviewed comic… Confirm in the native window if prompted.' })
      : snapshot.phase === 'cancelling' ? t({ id: 'Discarding the import review…', message: 'Discarding the import review…' })
      : t({ id: 'Refreshing your library…', message: 'Refreshing your library…' })}</p>}
    {error && <p role="alert" className="tsugi-read-error my-4">{errorLabel(error)}</p>}
    {review && <section aria-label={t({ id: 'CBZ import review', message: 'CBZ import review' })} className="my-4 space-y-3" data-local-comic-review={review.reviewId}>
      <h3 className="break-words text-lg font-semibold">{review.title}</h3>
      <dl>
        <div className="tsugi-read-row gap-3"><dt><Trans id="Pages">Pages</Trans></dt><dd>{review.pageCount}</dd></div>
        <div className="tsugi-read-row gap-3"><dt><Trans id="Archive size">Archive size</Trans></dt><dd>{formatBytes(review.archiveBytes)}</dd></div>
        <div className="tsugi-read-row gap-3"><dt><Trans id="Expanded archive size">Expanded archive size</Trans></dt><dd>{formatBytes(review.expandedBytes)}</dd></div>
      </dl>
      <p className="bg-[--tsugi-row] p-3 text-sm" data-local-comic-duplicate={String(review.duplicate)}>{review.duplicate
        ? t({ id: 'Pages from this archive are already stored. Confirmation will reuse them and finish registration if needed. Existing reading progress and bookmarks are kept.', message: 'Pages from this archive are already stored. Confirmation will reuse them and finish registration if needed. Existing reading progress and bookmarks are kept.' })
        : t({ id: 'Its pages will be copied into the local Reader library as one comic and use the existing reading modes. Your original CBZ remains unchanged.', message: 'Its pages will be copied into the local Reader library as one comic and use the existing reading modes. Your original CBZ remains unchanged.' })}</p>
      <p className="bg-[--tsugi-row-alt] p-3 text-sm text-[--tsugi-muted]"><Trans id="Portable backups save library and reading metadata. They do not include the CBZ or its page images; keep a separate copy of your original archive.">Portable backups save library and reading metadata. They do not include the CBZ or its page images; keep a separate copy of your original archive.</Trans></p>
      <div className="flex flex-wrap gap-2"><button className="tsugi-read-action" disabled={working} onClick={() => void apply()}>{review.duplicate ? <Trans id="Use existing copy">Use existing copy</Trans> : <Trans id="Add to Read">Add to Read</Trans>}</button><button className="tsugi-read-action" disabled={working} onClick={() => void controller.cancel()}><Trans id="Cancel import">Cancel import</Trans></button></div>
    </section>}
    {result && <section className="my-4 space-y-3 bg-[--tsugi-row] p-3" data-local-comic-result={result.status}>
      <p role="status">{result.status === 'imported' ? <Trans id="Comic added to Read.">Comic added to Read.</Trans>
        : result.status === 'already-imported' ? <Trans id="The existing comic is ready. Its reading progress and bookmarks were preserved.">The existing comic is ready. Its reading progress and bookmarks were preserved.</Trans>
        : result.status === 'published-unregistered' ? <Trans id="The comic files were saved, but Reader registration could not be confirmed. Choose the same CBZ again to review and finish registration. Existing files will be reused.">The comic files were saved, but Reader registration could not be confirmed. Choose the same CBZ again to review and finish registration. Existing files will be reused.</Trans>
        : <Trans id="Import cancelled. No comic was added by this review.">Import cancelled. No comic was added by this review.</Trans>}</p>
      {'title' in result && <p className="break-words font-semibold">{result.title}</p>}
      {'mangaId' in result && <button className="tsugi-read-action" disabled={working} onClick={() => onOpen(result)}>{result.status === 'already-imported' ? <Trans id="Open existing comic">Open existing comic</Trans> : <Trans id="Open in Reader">Open in Reader</Trans>}</button>}
    </section>}
    <div className="mt-4 flex flex-wrap gap-2"><button className="tsugi-read-action" disabled={working} onClick={() => void controller.begin()}>{review ? <Trans id="Choose another CBZ">Choose another CBZ</Trans> : <Trans id="Choose CBZ">Choose CBZ</Trans>}</button>{(error === 'unconfirmed' || result?.status === 'published-unregistered') && <button className="tsugi-read-action" disabled={working} onClick={() => void onImported().then(onClose)}><Trans id="Refresh library">Refresh library</Trans></button>}</div>
  </dialog>;
}
