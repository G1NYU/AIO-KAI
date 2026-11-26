import React from 'react';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import {
  applyReaderCacheCleanup, cancelReaderCacheCleanup, reviewReaderCacheCleanup, supportsReaderCacheCleanup,
  ReaderCacheCleanupError, type ReaderCacheGroup, type ReaderCacheResult, type ReaderCacheReview,
} from '@/lib/backup/reader-cache-cleanup';
import { readRestoreSessionState, restoreSessionBusy, RestoreSessionError, RESTORE_SESSION_EVENT, RESTORE_SESSION_KEY } from '@/lib/backup/restore-session';

function size(bytes: number) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KiB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MiB';
  return (bytes / 1073741824).toFixed(2) + ' GiB';
}
function groupName(kind: ReaderCacheGroup['kind']) {
  return kind === 'pages' ? t({ id: 'Temporary chapter images', message: 'Temporary chapter images' })
    : t({ id: 'Temporary thumbnails', message: 'Temporary thumbnails' });
}
function fileCount(count: number) { return plural(count, { one: '# file', other: '# files' }); }
function feedback(reason: unknown) {
  if (reason instanceof ReaderCacheCleanupError) {
    switch (reason.code) {
      case 'unsupported': return t({ id: 'Set up Reader on Windows before reviewing its temporary images.', message: 'Set up Reader on Windows before reviewing its temporary images.' });
      case 'locks': return t({ id: 'This browser runtime cannot safely coordinate cleanup with other windows. Update the app before retrying.', message: 'This browser runtime cannot safely coordinate cleanup with other windows. Update the app before retrying.' });
      case 'active-reader': return t({ id: 'Close the current book or chapter before reviewing or removing temporary Reader images.', message: 'Close the current book or chapter before reviewing or removing temporary Reader images.' });
      case 'empty': return t({ id: 'No temporary Reader images were selected for removal.', message: 'No temporary Reader images were selected for removal.' });
      case 'response': return t({ id: 'The image-cache review could not be verified. Review the current cache again.', message: 'The image-cache review could not be verified. Review the current cache again.' });
      case 'native-changed': return t({ id: 'The temporary image cache changed or the review expired. Review the cache again. No images were removed.', message: 'The temporary image cache changed or the review expired. Review the cache again. No images were removed.' });
      case 'native-unsafe': return t({ id: 'The temporary image cache is redirected, shared or outside private storage. No images were removed.', message: 'The temporary image cache is redirected, shared or outside private storage. No images were removed.' });
      case 'native-unverified': return t({ id: 'The temporary image cache could not be verified within its safety limits. No images were removed.', message: 'The temporary image cache could not be verified within its safety limits. No images were removed.' });
      case 'native-in-use': return t({ id: 'A temporary image is in use or cannot be removed. Close it and review the cache again. No images were removed.', message: 'A temporary image is in use or cannot be removed. Close it and review the cache again. No images were removed.' });
      case 'native-busy': return t({ id: 'Finish Reader downloads and library updates, and disable automatic jobs before clearing cached images. No images were removed.', message: 'Finish Reader downloads and library updates, and disable automatic jobs before clearing cached images. No images were removed.' });
      case 'native-reader-open': return t({ id: 'Close the open manga chapter before clearing cached images. No images were removed.', message: 'Close the open manga chapter before clearing cached images. No images were removed.' });
      case 'native-closing': return t({ id: 'Reader is closing. Wait for it to finish before reviewing the cache again. No images were removed.', message: 'Reader is closing. Wait for it to finish before reviewing the cache again. No images were removed.' });
    }
  }
  if (reason instanceof RestoreSessionError) {
    if (reason.code === 'busy') return t({ id: 'Another backup, restore or cleanup operation is running. Wait for it to finish.', message: 'Another backup, restore or cleanup operation is running. Wait for it to finish.' });
    return t({ id: 'Resolve the saved restore record in Data & storage before reviewing temporary Reader images.', message: 'Resolve the saved restore record in Data & storage before reviewing temporary Reader images.' });
  }
  return t({ id: 'The temporary image cache could not be reviewed. Close Reader and wait for downloads or library updates to finish before trying again.', message: 'The temporary image cache could not be reviewed. Close Reader and wait for downloads or library updates to finish before trying again.' });
}

export function ReaderCacheCleanupSettings({ onChanged }: { onChanged(): void }) {
  const [review, setReview] = React.useState<ReaderCacheReview | null>(null);
  const [result, setResult] = React.useState<ReaderCacheResult | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [applying, setApplying] = React.useState(false);
  const [notice, setNotice] = React.useState('');
  const [error, setError] = React.useState('');
  const [restoreState, setRestoreState] = React.useState(readRestoreSessionState);
  const [restoreBusy, setRestoreBusy] = React.useState(restoreSessionBusy);
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    const refresh = () => {
      const state = readRestoreSessionState();
      setRestoreState(state); setRestoreBusy(restoreSessionBusy());
      if (state.kind !== 'empty') setReview(null);
    };
    const storage = (event: StorageEvent) => { if (event.key === null || event.key === RESTORE_SESSION_KEY) refresh(); };
    window.addEventListener(RESTORE_SESSION_EVENT, refresh); window.addEventListener('storage', storage);
    return () => {
      mounted.current = false;
      window.removeEventListener(RESTORE_SESSION_EVENT, refresh); window.removeEventListener('storage', storage);
    };
  }, []);
  if (!supportsReaderCacheCleanup()) return null;
  const blocked = restoreState.kind !== 'empty';
  const disabled = busy || restoreBusy || blocked || result?.runtimeReady === false;

  async function prepare() {
    setBusy(true); setError(''); setNotice(''); setResult(null); setReview(null);
    try { const value = await reviewReaderCacheCleanup(); if (mounted.current) setReview(value); }
    catch (reason) { if (mounted.current) setError(feedback(reason)); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function cancel() {
    if (!review) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await cancelReaderCacheCleanup(review);
      if (mounted.current) setNotice(t({ id: 'Image cleanup cancelled. No temporary images were removed.', message: 'Image cleanup cancelled. No temporary images were removed.' }));
    } catch (reason) { if (mounted.current) setError(feedback(reason)); }
    finally { if (mounted.current) { setReview(null); setBusy(false); } }
  }
  async function apply() {
    if (!review) return;
    let dispatched = false;
    setBusy(true); setApplying(true); setError(''); setNotice(''); setResult(null);
    try {
      const outcome = await applyReaderCacheCleanup(review, () => { dispatched = true; });
      if (!mounted.current) return;
      if (outcome.status === 'cancelled') {
        setNotice(t({ id: 'Image cleanup cancelled. No temporary images were removed.', message: 'Image cleanup cancelled. No temporary images were removed.' }));
      } else { setResult(outcome); onChanged(); }
    } catch (reason) {
      if (!mounted.current) return;
      if (dispatched && !(reason instanceof ReaderCacheCleanupError && reason.noImagesRemoved)) {
        onChanged();
        setError(t({ id: 'The image removal result could not be confirmed. Some temporary images may have changed. Check Reader, refresh storage and review the current cache before trying again.', message: 'The image removal result could not be confirmed. Some temporary images may have changed. Check Reader, refresh storage and review the current cache before trying again.' }));
      } else setError(feedback(reason));
    } finally { if (mounted.current) { setReview(null); setBusy(false); setApplying(false); } }
  }

  const reviewedFiles = review?.totalFiles ?? 0;
  const reviewedCount = fileCount(reviewedFiles);
  const reviewedSize = size(review?.totalBytes ?? 0);
  const removedFiles = result?.removedFiles ?? 0;
  const removedCount = plural(removedFiles, { one: '# temporary image file', other: '# temporary image files' });
  const removedSize = size(result?.removedBytes ?? 0);
  return <section className="space-y-3" aria-label={t({ id: 'Temporary Reader images', message: 'Temporary Reader images' })}>
    <h4><Trans id="Temporary Reader images">Temporary Reader images</Trans></h4>
    <p><Trans id="Review temporary chapter images and thumbnails. Downloaded chapters, local comics, your library, reading progress and source sessions are kept.">Review temporary chapter images and thumbnails. Downloaded chapters, local comics, your library, reading progress and source sessions are kept.</Trans></p>
    <p><Trans id="Images may need to load again while online. Reader briefly restarts after you confirm removal.">Images may need to load again while online. Reader briefly restarts after you confirm removal.</Trans></p>
    {blocked && <p role="status"><Trans id="Resolve the saved restore record in Data & storage before reviewing temporary Reader images.">Resolve the saved restore record in Data &amp; storage before reviewing temporary Reader images.</Trans></p>}
    <button className="tsugi-read-action" type="button" disabled={disabled || review !== null} onClick={() => void prepare()}><Trans id="Review temporary Reader images">Review temporary Reader images</Trans></button>
    {busy && <p role="status">{applying
      ? t({ id: 'Waiting for Windows confirmation, removing reviewed images and restarting Reader…', message: 'Waiting for Windows confirmation, removing reviewed images and restarting Reader…' })
      : t({ id: 'Checking the temporary image cache…', message: 'Checking the temporary image cache…' })}</p>}
    {review && <div className="space-y-3" role="region" aria-label={t({ id: 'Temporary image removal review', message: 'Temporary image removal review' })}>
      <p role="status"><Trans id="Temporary images selected: {reviewedCount} ({reviewedSize}).">Temporary images selected: {reviewedCount} ({reviewedSize}).</Trans></p>
      <dl className="grid gap-1">{review.groups.map(group => <div key={group.kind} className="flex flex-wrap items-baseline gap-3 py-2"><dt className="min-w-0 flex-1">{groupName(group.kind)}</dt><dd>{fileCount(group.files)} · {size(group.bytes)}</dd></div>)}</dl>
      {reviewedFiles === 0 ? <p><Trans id="No temporary Reader images were found. No files need removal.">No temporary Reader images were found. No files need removal.</Trans></p>
        : <p><Trans id="Only these temporary images will be removed. Windows asks for confirmation and checks them again. This review expires after 10 minutes.">Only these temporary images will be removed. Windows asks for confirmation and checks them again. This review expires after 10 minutes.</Trans></p>}
      <div className="flex flex-wrap gap-2">
        {reviewedFiles > 0 && <button className="tsugi-read-action" type="button" disabled={disabled} onClick={() => void apply()}><Trans id="Remove reviewed temporary images">Remove reviewed temporary images</Trans></button>}
        <button className="tsugi-read-action" type="button" disabled={disabled} onClick={() => void cancel()}><Trans id="Cancel image cleanup review">Cancel image cleanup review</Trans></button>
      </div>
    </div>}
    {result && <div className="space-y-2" role="region" aria-label={t({ id: 'Temporary image cleanup result', message: 'Temporary image cleanup result' })}>
      <p role="status"><Trans id="Verified removal: {removedCount} ({removedSize}).">Verified removal: {removedCount} ({removedSize}).</Trans></p>
      <dl className="grid gap-1">{result.groups.map(group => <div key={group.kind} className="flex flex-wrap items-baseline gap-3 py-2"><dt className="min-w-0 flex-1">{groupName(group.kind)}</dt><dd>{fileCount(group.removedFiles)} · {size(group.removedBytes)}</dd></div>)}</dl>
      {result.status === 'partial' && <p role="alert"><Trans id="Some temporary images could not be removed or verified. Review the remaining cache before another cleanup.">Some temporary images could not be removed or verified. Review the remaining cache before another cleanup.</Trans></p>}
      {!result.runtimeReady && <p role="alert"><Trans id="Reader did not restart. Restart Tsugi before continuing to read or clean up images.">Reader did not restart. Restart Tsugi before continuing to read or clean up images.</Trans></p>}
      <p>{result.message}</p>
    </div>}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
