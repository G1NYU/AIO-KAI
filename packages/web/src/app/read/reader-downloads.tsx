import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { BrushDownload, BrushPause, BrushPlay, BrushRefresh } from '@/components/tsugi-icons';
import { ReaderDownloadsController, MAX_DOWNLOAD_SELECTION, type DownloadRequest, type DownloadRejection, type ReaderDownload, type ReaderDownloadsState } from './reader-downloads-state';

export function useReaderDownloads(visible: boolean, request: DownloadRequest) {
  const [controller] = React.useState(() => new ReaderDownloadsController(request));
  const snapshot = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  React.useLayoutEffect(() => {
    controller.setActive(visible);
    return () => controller.setActive(false);
  }, [controller, visible]);
  return { controller, snapshot };
}

export function DownloadFeedback({ snapshot }: { snapshot: ReaderDownloadsState }) {
  if (snapshot.rejection) return <p role="alert" className="tsugi-read-error">{rejectionLabel(snapshot.rejection)}</p>;
  if (snapshot.notice === 'uncertain') return <p role="alert" className="tsugi-read-error">{snapshot.stale
    ? t({ id: 'The previous download request could not be confirmed. Refresh download status before trying another action.', message: 'The previous download request could not be confirmed. Refresh download status before trying another action.' })
    : t({ id: 'The previous download request could not be confirmed. Status was refreshed without repeating it. Check the queue before trying again.', message: 'The previous download request could not be confirmed. Status was refreshed without repeating it. Check the queue before trying again.' })}</p>;
  if (snapshot.notice === 'enqueue-downloads') return <p role="status" className="text-sm text-[--tsugi-muted]"><Trans id="Download request sent. View Downloads for progress.">Download request sent. View Downloads for progress.</Trans></p>;
  if (snapshot.notice === 'cancel-downloads') return <p role="status" className="text-sm text-[--tsugi-muted]"><Trans id="Selected queue entries cancelled. Cached files were kept.">Selected queue entries cancelled. Cached files were kept.</Trans></p>;
  if (snapshot.notice === 'retry-downloads') return <p role="status" className="text-sm text-[--tsugi-muted]"><Trans id="Retry request sent. Check the queue for progress.">Retry request sent. Check the queue for progress.</Trans></p>;
  if (snapshot.notice) return <p role="status" className="text-sm text-[--tsugi-muted]"><Trans id="Download queue updated.">Download queue updated.</Trans></p>;
  return null;
}

function rejectionLabel(reason: DownloadRejection) {
  switch (reason) {
    case 'queued': return t({ id: 'A selected chapter is already queued. Refresh download status or use Retry for failed downloads.', message: 'A selected chapter is already queued. Refresh download status or use Retry for failed downloads.' });
    case 'downloaded': return t({ id: 'A selected chapter is already marked downloaded. Refresh the chapter list.', message: 'A selected chapter is already marked downloaded. Refresh the chapter list.' });
    case 'local': return t({ id: 'Select chapters from an installed online source; local chapters do not need downloading.', message: 'Select chapters from an installed online source; local chapters do not need downloading.' });
    case 'unavailable': return t({ id: 'The selected chapter source is unavailable. Reload installed sources before downloading.', message: 'The selected chapter source is unavailable. Reload installed sources before downloading.' });
    case 'changed': return t({ id: 'The selected downloads changed. Refresh download status and select them again.', message: 'The selected downloads changed. Refresh download status and select them again.' });
    case 'capacity': return t({ id: 'The download queue would exceed 1000 chapters.', message: 'The download queue would exceed 1000 chapters.' });
    case 'selection': return t({ id: 'Select between 1 and 100 different chapters to download.', message: 'Select between 1 and 100 different chapters to download.' });
  }
}

function stateLabel(state: ReaderDownload['state']) {
  switch (state) {
    case 'QUEUED': return t({ id: 'Queued', message: 'Queued' });
    case 'DOWNLOADING': return t({ id: 'Downloading', message: 'Downloading' });
    case 'FINISHED': return t({ id: 'Finished', message: 'Finished' });
    case 'ERROR': return t({ id: 'Failed', message: 'Failed' });
  }
}
function selectionLabel(item: ReaderDownload) {
  const title = item.mangaTitle, chapter = item.chapterName;
  return t({ id: 'Select download {title}: {chapter}', message: `Select download ${title}: ${chapter}` });
}
function progressLabel(chapter: string) { return t({ id: 'Download progress for {chapter}', message: `Download progress for ${chapter}` }); }

export function ReaderDownloads({ downloads, disabled }: { downloads: ReturnType<typeof useReaderDownloads>; disabled: boolean }) {
  const { controller, snapshot } = downloads;
  const [selection, setSelection] = React.useState<number[]>([]);
  const [page, setPage] = React.useState(0);
  const queue = snapshot.status?.queue || [];
  const currentPage = Math.min(page, Math.max(0, Math.ceil(queue.length / MAX_DOWNLOAD_SELECTION) - 1));
  const rows = queue.slice(currentPage * MAX_DOWNLOAD_SELECTION, (currentPage + 1) * MAX_DOWNLOAD_SELECTION);
  const selected = selection.filter(id => queue.some(item => item.id === id));
  const failed = selected.filter(id => queue.some(item => item.id === id && item.state === 'ERROR'));
  const waiting = disabled || snapshot.busy;
  const blocked = waiting || snapshot.stale || !snapshot.status;
  async function change(action: Parameters<ReaderDownloadsController['change']>[0]) {
    await controller.change(action);
    setSelection([]);
  }
  const pageNumber = currentPage + 1, pageCount = Math.max(1, Math.ceil(queue.length / MAX_DOWNLOAD_SELECTION));
  return <section data-ui="reader-downloads" data-download-status={snapshot.stale ? 'stale' : 'current'} className="min-w-0 space-y-4">
    <div className="tsugi-reader-setting-group space-y-2 text-sm text-[--tsugi-muted]">
      <p><Trans id="The download queue resumes automatically when the Reader engine restarts. Cancelling a queue entry keeps any cached files.">The download queue resumes automatically when the Reader engine restarts. Cancelling a queue entry keeps any cached files.</Trans></p>
      <p><Trans id="Downloaded is the reading engine's status. It does not guarantee that every page is available offline.">Downloaded is the reading engine's status. It does not guarantee that every page is available offline.</Trans></p>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <button className="tsugi-read-action" disabled={waiting} onClick={() => void controller.refresh()}><BrushRefresh aria-hidden /><Trans id="Refresh downloads">Refresh downloads</Trans></button>
      <button className="tsugi-read-action" disabled={blocked || snapshot.status?.state !== 'STARTED'} onClick={() => void change({ kind: 'pause-downloads' })}><BrushPause aria-hidden /><Trans id="Pause downloads">Pause downloads</Trans></button>
      <button className="tsugi-read-action" disabled={blocked || snapshot.status?.state !== 'STOPPED' || !queue.some(item => item.state !== 'ERROR')} onClick={() => void change({ kind: 'resume-downloads' })}><BrushPlay aria-hidden /><Trans id="Resume downloads">Resume downloads</Trans></button>
    </div>
    {snapshot.busy && <p role="status" className="text-sm text-[--tsugi-muted]"><Trans id="Checking download queue…">Checking download queue…</Trans></p>}
    {snapshot.error && <p role="alert" className="tsugi-read-error"><Trans id="Download status could not be refreshed. The shown queue may be out of date. Refresh to try again.">Download status could not be refreshed. The shown queue may be out of date. Refresh to try again.</Trans></p>}
    <DownloadFeedback snapshot={snapshot} />
    {snapshot.status && <p className="text-sm text-[--tsugi-muted]" data-ui="download-queue-state">{snapshot.status.state === 'STARTED'
      ? t({ id: 'Downloader running', message: 'Downloader running' }) : t({ id: 'Downloader stopped', message: 'Downloader stopped' })}
      <span aria-hidden="true"> · </span>{queue.length} <Trans id="queue entries">queue entries</Trans>
      {snapshot.stale && <> · <Trans id="Last known status">Last known status</Trans></>}
    </p>}
    {!!rows.length && <>
      <div className="flex flex-wrap items-center gap-3 bg-[--tsugi-row] p-3">
        <label className="flex items-center gap-2"><input type="checkbox" checked={rows.every(item => selected.includes(item.id))} disabled={blocked} onChange={event => setSelection(event.target.checked ? rows.map(item => item.id) : [])} /><Trans id="Select visible downloads">Select visible downloads</Trans></label>
        <span className="text-sm text-[--tsugi-muted]">{selected.length} <Trans id="selected">selected</Trans></span>
        <button className="tsugi-read-action" disabled={blocked || !selected.length} onClick={() => void change({ kind: 'cancel-downloads', ids: selected })}><Trans id="Cancel selected downloads">Cancel selected downloads</Trans></button>
        <button className="tsugi-read-action" disabled={blocked || !failed.length} onClick={() => void change({ kind: 'retry-downloads', ids: failed })}><Trans id="Retry selected failed downloads">Retry selected failed downloads</Trans></button>
        {!!selected.length && <button className="tsugi-read-action" disabled={waiting} onClick={() => setSelection([])}><Trans id="Clear selection">Clear selection</Trans></button>}
      </div>
      <ul aria-label={t({ id: 'Chapter download queue', message: 'Chapter download queue' })}>
        {rows.map(item => {
          const percent = Math.round(item.progress * 100), pages = item.pageCount, tries = item.tries;
          return <li key={item.id} data-download-id={item.id} data-download-state={item.state} className="tsugi-read-row flex-wrap gap-3">
            <input type="checkbox" aria-label={selectionLabel(item)} checked={selected.includes(item.id)} disabled={blocked || (!selected.includes(item.id) && selected.length >= MAX_DOWNLOAD_SELECTION)} onChange={event => setSelection(event.target.checked ? [...selected, item.id] : selected.filter(id => id !== item.id))} />
            <div className="min-w-0 flex-1 basis-48"><strong className="block break-words">{item.mangaTitle}</strong><span className="block break-words text-sm text-[--tsugi-muted]">{item.chapterName}</span></div>
            <div className="min-w-0 flex-1 basis-48 space-y-1"><div className="flex flex-wrap justify-between gap-2 text-sm"><span>{stateLabel(item.state)}</span><span>{percent}%</span></div><progress className="block h-2 w-full accent-[--tsugi-accent]" value={item.progress} max={1} aria-label={progressLabel(item.chapterName)} /><div className="flex flex-wrap gap-x-3 text-xs text-[--tsugi-muted]">{pages >= 0 && <span><Trans id="Pages: {pages}">Pages: {pages}</Trans></span>}<span><Trans id="Attempts: {tries}">Attempts: {tries}</Trans></span>{item.isDownloaded && <span><Trans id="Downloaded">Downloaded</Trans></span>}</div></div>
          </li>;
        })}
      </ul>
      {pageCount > 1 && <nav className="flex flex-wrap items-center gap-3" aria-label={t({ id: 'Download queue pages', message: 'Download queue pages' })}>
        <button className="tsugi-read-action" disabled={waiting || currentPage === 0} onClick={() => { setPage(currentPage - 1); setSelection([]); }}><Trans id="Previous page">Previous page</Trans></button>
        <span className="text-sm text-[--tsugi-muted]"><Trans id="Page {pageNumber} of {pageCount}">Page {pageNumber} of {pageCount}</Trans></span>
        <button className="tsugi-read-action" disabled={waiting || currentPage + 1 >= pageCount} onClick={() => { setPage(currentPage + 1); setSelection([]); }}><Trans id="Next page">Next page</Trans></button>
      </nav>}
    </>}
    {snapshot.status && !queue.length && !snapshot.stale && <div className="tsugi-reading-empty"><BrushDownload aria-hidden /><h2><Trans id="No queued chapters">No queued chapters</Trans></h2><p><Trans id="Select chapters on a series page, then choose Download selected.">Select chapters on a series page, then choose Download selected.</Trans></p></div>}
  </section>;
}
