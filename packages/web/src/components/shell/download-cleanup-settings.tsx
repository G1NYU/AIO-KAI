import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import {
  applyDownloadCleanup, cancelDownloadCleanup, DownloadCleanupError, DOWNLOAD_CLEANUP_PAGE_SIZE, DOWNLOAD_CLEANUP_SELECTION_LIMIT,
  listDownloadCleanupCandidates, reviewDownloadCleanup, supportsDownloadCleanup,
  type DownloadCleanupCandidates, type DownloadCleanupItem, type DownloadCleanupResult, type DownloadCleanupReview,
} from '@/lib/backup/download-cleanup';
import { readRestoreSessionState, restoreSessionBusy, RestoreSessionError, RESTORE_SESSION_EVENT, RESTORE_SESSION_KEY } from '@/lib/backup/restore-session';

function size(bytes: number) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KiB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MiB';
  return (bytes / 1073741824).toFixed(2) + ' GiB';
}
function feedback(reason: unknown) {
  if (reason instanceof DownloadCleanupError) {
    switch (reason.code) {
      case 'unsupported': return t({ id: 'Chapter cleanup requires Reader and managed backups on Windows.', message: 'Chapter cleanup requires Reader and managed backups on Windows.' });
      case 'active-reader': return t({ id: 'Close the current book or chapter before reviewing or removing downloads.', message: 'Close the current book or chapter before reviewing or removing downloads.' });
      case 'locks': return t({ id: 'This browser runtime cannot safely coordinate cleanup with other windows. Update the app before retrying.', message: 'This browser runtime cannot safely coordinate cleanup with other windows. Update the app before retrying.' });
      case 'backup': return t({ id: 'The metadata safety backup could not be saved and verified. No download removal was started.', message: 'The metadata safety backup could not be saved and verified. No download removal was started.' });
      case 'coverage': return t({ id: 'The metadata backup does not cover every selected chapter in its reviewed state. No download removal was started. Refresh the list and review again.', message: 'The metadata backup does not cover every selected chapter in its reviewed state. No download removal was started. Refresh the list and review again.' });
      case 'selection': return t({ id: 'Select up to 50 chapter downloads from the current page.', message: 'Select up to 50 chapter downloads from the current page.' });
      case 'selection-size': return t({ id: 'A cleanup review can include up to 2 GiB. Select fewer chapter downloads.', message: 'A cleanup review can include up to 2 GiB. Select fewer chapter downloads.' });
      case 'changed': return t({ id: 'The download list changed. Refresh it and review the selection again.', message: 'The download list changed. Refresh it and review the selection again.' });
      case 'expired': return t({ id: 'The cleanup review expired or Reader restarted. Refresh the list and review the selection again. No download removal was started.', message: 'The cleanup review expired or Reader restarted. Refresh the list and review the selection again. No download removal was started.' });
      case 'response': return t({ id: 'The download review could not be verified. Refresh the list before trying again.', message: 'The download review could not be verified. Refresh the list before trying again.' });
    }
  }
  if (reason instanceof RestoreSessionError) {
    if (reason.code === 'busy') return t({ id: 'Another backup, restore or cleanup operation is running. Wait for it to finish.', message: 'Another backup, restore or cleanup operation is running. Wait for it to finish.' });
    if (reason.code === 'active-reader') return t({ id: 'Close the current book or chapter before reviewing or removing downloads.', message: 'Close the current book or chapter before reviewing or removing downloads.' });
    return t({ id: 'Resolve the saved restore record in Data & storage before reviewing or removing downloads.', message: 'Resolve the saved restore record in Data & storage before reviewing or removing downloads.' });
  }
  if (reason instanceof Error && reason.message === 'Cleanup requires the default private download folder and disabled automatic downloads and scheduled library updates.')
    return t({ id: 'Cleanup requires the default TSUGI download folder. Disable automatic chapter downloads and scheduled library updates before reviewing cleanup.', message: 'Cleanup requires the default TSUGI download folder. Disable automatic chapter downloads and scheduled library updates before reviewing cleanup.' });
  return t({ id: 'Cleanup could not proceed. Close Reader, wait for downloads or library updates to finish, and disable automatic downloads and scheduled library updates before retrying. External storage and ambiguous files are not eligible.', message: 'Cleanup could not proceed. Close Reader, wait for downloads or library updates to finish, and disable automatic downloads and scheduled library updates before retrying. External storage and ambiguous files are not eligible.' });
}
function formatLabel(format: DownloadCleanupItem['format']) {
  return format === 'cbz' ? t({ id: 'CBZ archive', message: 'CBZ archive' }) : t({ id: 'Chapter folder', message: 'Chapter folder' });
}
function selectionLabel(item: DownloadCleanupItem) {
  const chapter = item.chapterName, title = item.mangaTitle;
  return t({ id: 'Select {chapter} from {title}', message: `Select ${chapter} from ${title}` });
}

export function DownloadCleanupSettings({ onChanged }: { onChanged(): void }) {
  const [inventory, setInventory] = React.useState<DownloadCleanupCandidates | null>(null);
  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [review, setReview] = React.useState<DownloadCleanupReview | null>(null);
  const [result, setResult] = React.useState<{ outcome: DownloadCleanupResult; items: DownloadCleanupItem[] } | null>(null);
  const [backupName, setBackupName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [error, setError] = React.useState('');
  const [restoreState, setRestoreState] = React.useState(readRestoreSessionState);
  const [restoreBusy, setRestoreBusy] = React.useState(restoreSessionBusy);
  React.useEffect(() => {
    const refresh = () => {
      const state = readRestoreSessionState();
      setRestoreState(state); setRestoreBusy(restoreSessionBusy());
      if (state.kind !== 'empty') { setReview(null); setSelected(new Set()); }
    };
    const storage = (event: StorageEvent) => { if (event.key === null || event.key === RESTORE_SESSION_KEY) refresh(); };
    window.addEventListener(RESTORE_SESSION_EVENT, refresh); window.addEventListener('storage', storage);
    return () => { window.removeEventListener(RESTORE_SESSION_EVENT, refresh); window.removeEventListener('storage', storage); };
  }, []);
  if (!supportsDownloadCleanup()) return null;
  const blocked = restoreState.kind !== 'empty';
  const operationBusy = busy || restoreBusy;
  const disabled = operationBusy || blocked;
  const selectionCount = selected.size;

  async function scan(offset = 0) {
    setBusy(true); setError(''); setNotice(''); setResult(null); setReview(null); setSelected(new Set()); setInventory(null);
    setProgress(t({ id: 'Checking managed chapter downloads…', message: 'Checking managed chapter downloads…' }));
    try { setInventory(await listDownloadCleanupCandidates(offset)); }
    catch (reason) { setError(feedback(reason)); }
    finally { setBusy(false); setProgress(''); }
  }
  async function prepare() {
    if (!inventory) return;
    setBusy(true); setError(''); setNotice(''); setResult(null); setBackupName('');
    setProgress(t({ id: 'Preparing a download cleanup review…', message: 'Preparing a download cleanup review…' }));
    try { setReview(await reviewDownloadCleanup(inventory.items.filter(item => selected.has(item.chapterId)))); }
    catch (reason) { setReview(null); setError(feedback(reason)); }
    finally { setBusy(false); setProgress(''); }
  }
  async function cancel() {
    if (!review) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await cancelDownloadCleanup(review);
      setNotice(t({ id: 'Download cleanup cancelled. No chapter downloads were removed.', message: 'Download cleanup cancelled. No chapter downloads were removed.' }));
    } catch (reason) { setError(feedback(reason)); }
    finally { setReview(null); setSelected(new Set()); setBusy(false); }
  }
  async function apply() {
    if (!review) return;
    const reviewed = review;
    let dispatched = false;
    setBusy(true); setError(''); setNotice(''); setResult(null); setBackupName('');
    try {
      const applied = await applyDownloadCleanup(reviewed, {
        onStage: stage => setProgress(stage === 'backup'
          ? t({ id: 'Saving and verifying a metadata safety backup…', message: 'Saving and verifying a metadata safety backup…' })
          : t({ id: 'Waiting for Windows confirmation and checking the selected downloads…', message: 'Waiting for Windows confirmation and checking the selected downloads…' })),
        onBackup: backup => setBackupName(backup.name),
        onDispatched: () => { dispatched = true; },
      });
      if ('cancelled' in applied.outcome) {
        setNotice(t({ id: 'Download cleanup cancelled. No chapter downloads were removed.', message: 'Download cleanup cancelled. No chapter downloads were removed.' }));
      } else {
        setResult({ outcome: applied.outcome, items: reviewed.items });
        if (applied.outcome.removedCount > 0 || applied.outcome.items.some(item => item.status === 'failed')) onChanged();
        setInventory(null);
      }
    } catch (reason) {
      if (dispatched) {
        onChanged(); setInventory(null);
        setError(reason instanceof DownloadCleanupError && (reason.code === 'changed' || reason.code === 'expired') ? feedback(reason)
          : t({ id: 'The removal result could not be confirmed. Some files may have changed. Keep the metadata backup, refresh storage and review the current downloads before retrying.', message: 'The removal result could not be confirmed. Some files may have changed. Keep the metadata backup, refresh storage and review the current downloads before retrying.' }));
      } else setError(feedback(reason));
    } finally { setReview(null); setSelected(new Set()); setBusy(false); setProgress(''); }
  }

  const first = inventory ? inventory.offset + 1 : 0;
  const last = inventory ? inventory.offset + inventory.items.length : 0;
  const totalCount = inventory?.totalCount ?? 0;
  const totalSize = size(inventory?.totalBytes ?? 0);
  const reviewedCount = review?.items.length ?? 0;
  const reviewedSize = size(review?.totalBytes ?? 0);
  const reviewedFiles = review?.items.reduce((sum, item) => sum + item.files, 0) ?? 0;
  const removedCount = result?.outcome.removedCount ?? 0;
  const removedSize = size(result?.outcome.removedBytes ?? 0);
  return <section className="space-y-3" aria-label={t({ id: 'Downloaded chapter cleanup', message: 'Downloaded chapter cleanup' })}>
    <h4><Trans id="Downloaded chapter cleanup">Downloaded chapter cleanup</Trans></h4>
    <p><Trans id="Choose completed downloads of read, unbookmarked chapters in your library. Only verified files in TSUGI-managed storage are eligible. Your library, categories, bookmarks and reading progress are kept.">Choose completed downloads of read, unbookmarked chapters in your library. Only verified files in TSUGI-managed storage are eligible. Your library, categories, bookmarks and reading progress are kept.</Trans></p>
    <p><Trans id="A verified metadata backup is saved before removal. Downloaded pages are not included in that backup.">A verified metadata backup is saved before removal. Downloaded pages are not included in that backup.</Trans></p>
    {blocked && <p role="status"><Trans id="Resolve the saved restore record in Data & storage before reviewing or removing downloads.">Resolve the saved restore record in Data &amp; storage before reviewing or removing downloads.</Trans></p>}
    <button type="button" className="tsugi-read-action" disabled={disabled || review !== null} onClick={() => void scan()}><Trans id="Find eligible chapter downloads">Find eligible chapter downloads</Trans></button>
    {busy && <p role="status">{progress || t({ id: 'Closing the download cleanup review…', message: 'Closing the download cleanup review…' })}</p>}
    {inventory && <div className="space-y-3">
      <p role="status"><Trans id="Eligible chapters: {totalCount} ({totalSize}).">Eligible chapters: {totalCount} ({totalSize}).</Trans></p>
      {!inventory.items.length && <p><Trans id="No eligible chapter downloads were found. Unread, bookmarked, incomplete, external or unverifiable downloads are kept.">No eligible chapter downloads were found. Unread, bookmarked, incomplete, external or unverifiable downloads are kept.</Trans></p>}
      {inventory.items.length > 0 && <>
        <p><Trans id="Showing {first}–{last} of {totalCount}. Select up to 50 chapters on this page.">Showing {first}–{last} of {totalCount}. Select up to 50 chapters on this page.</Trans></p>
        <ul className="grid gap-0 max-h-96 overflow-y-auto overflow-x-hidden" aria-label={t({ id: 'Eligible downloaded chapters', message: 'Eligible downloaded chapters' })}>
          {inventory.items.map(item => <li className="tsugi-read-row flex-wrap" key={item.chapterId} data-state={selected.has(item.chapterId) ? 'checked' : 'unchecked'}>
            <label className="!flex flex-1 min-w-0 items-start gap-3">
              <input type="checkbox" className="mt-1" checked={selected.has(item.chapterId)}
                aria-label={selectionLabel(item)}
                disabled={disabled || review !== null || (!selected.has(item.chapterId) && selectionCount >= DOWNLOAD_CLEANUP_SELECTION_LIMIT)}
                onChange={event => { const checked = event.target.checked; setSelected(current => { const next = new Set(current); if (checked) next.add(item.chapterId); else next.delete(item.chapterId); return next; }); }} />
              <span className="min-w-0 break-words"><strong className="block">{item.mangaTitle}</strong><span>{item.chapterName}</span><small className="block text-[--tsugi-muted]">{item.sourceName} · {formatLabel(item.format)}</small></span>
            </label>
            <span className="shrink-0">{size(item.bytes)}</span>
          </li>)}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="tsugi-read-action" disabled={disabled || review !== null || inventory.offset === 0} onClick={() => void scan(inventory.offset - DOWNLOAD_CLEANUP_PAGE_SIZE)}><Trans id="Previous download page">Previous download page</Trans></button>
          <button type="button" className="tsugi-read-action" disabled={disabled || review !== null || inventory.offset + inventory.items.length >= inventory.totalCount} onClick={() => void scan(inventory.offset + DOWNLOAD_CLEANUP_PAGE_SIZE)}><Trans id="Next download page">Next download page</Trans></button>
          <button type="button" className="tsugi-read-action" disabled={disabled || review !== null || selectionCount === 0} onClick={() => void prepare()}><Trans id="Review selected downloads">Review selected downloads</Trans></button>
          <span><Trans id="Selected chapters: {selectionCount}">Selected chapters: {selectionCount}</Trans></span>
        </div>
      </>}
    </div>}
    {review && <div className="space-y-3" role="region" aria-label={t({ id: 'Chapter download removal review', message: 'Chapter download removal review' })}>
      <h5><Trans id="Chapter download removal review">Chapter download removal review</Trans></h5>
      <p><Trans id="Remove {reviewedCount} chapter downloads: {reviewedFiles} files, {reviewedSize}.">Remove {reviewedCount} chapter downloads: {reviewedFiles} files, {reviewedSize}.</Trans></p>
      <ul className="grid gap-0 max-h-64 overflow-auto">{review.items.map(item => <li className="tsugi-read-row flex-wrap" key={item.chapterId}><span className="min-w-0 break-words"><strong className="block">{item.mangaTitle}</strong>{item.chapterName}<small className="block text-[--tsugi-muted]">{item.sourceName} · {formatLabel(item.format)}</small></span><span>{size(item.bytes)}</span></li>)}</ul>
      <p><Trans id="Only these chapter downloads will be removed. Windows asks for confirmation and checks the selection again. This review expires after 10 minutes.">Only these chapter downloads will be removed. Windows asks for confirmation and checks the selection again. This review expires after 10 minutes.</Trans></p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="tsugi-read-action" disabled={disabled} onClick={() => void apply()}><Trans id="Remove reviewed chapter downloads">Remove reviewed chapter downloads</Trans></button>
        <button type="button" className="tsugi-read-action" disabled={disabled} onClick={() => void cancel()}><Trans id="Cancel chapter cleanup review">Cancel chapter cleanup review</Trans></button>
      </div>
    </div>}
    {result && <div className="space-y-2">
      <p role="status"><Trans id="Verified removal: {removedCount} chapter downloads ({removedSize}).">Verified removal: {removedCount} chapter downloads ({removedSize}).</Trans></p>
      {!result.outcome.metadataPreserved && <p role="alert"><Trans id="Reading metadata could not be fully verified. The batch stopped. Keep the safety backup and review your library before another cleanup.">Reading metadata could not be fully verified. The batch stopped. Keep the safety backup and review your library before another cleanup.</Trans></p>}
      {result.outcome.items.some(item => item.status !== 'removed') && <p><Trans id="The batch stopped at the first failure. Refresh the list and review any remaining downloads before trying again.">The batch stopped at the first failure. Refresh the list and review any remaining downloads before trying again.</Trans></p>}
      <ul className="grid gap-0" aria-label={t({ id: 'Chapter cleanup results', message: 'Chapter cleanup results' })}>{result.outcome.items.map((item, index) => <li className="tsugi-read-row flex-wrap" key={item.chapterId}>
        <span className="min-w-0 break-words"><strong className="block">{result.items[index].mangaTitle}</strong>{result.items[index].chapterName}{item.error && <small className="block">{item.error}</small>}</span>
        <span>{item.status === 'removed' ? t({ id: 'Removed', message: 'Removed' }) : item.status === 'failed' ? t({ id: 'Removal could not be verified', message: 'Removal could not be verified' }) : t({ id: 'Not attempted', message: 'Not attempted' })}</span>
      </li>)}</ul>
    </div>}
    {backupName && <p><Trans id="Metadata safety backup kept in managed backups:">Metadata safety backup kept in managed backups:</Trans> <code className="break-all">{backupName}</code></p>}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
