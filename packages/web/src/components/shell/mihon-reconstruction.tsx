import React from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import type { MihonImport } from '@/lib/backup/mihon';
import { readRequest } from '@/lib/hosts/shell/reading';
import { runRestoreSection } from '@/lib/backup/restore-session';
import { restoreSessionFeedback } from './restore-session-feedback';

type ImportRow = { title: string; sourceId: string; state: 'new' | 'merge' | 'local-files-required' | 'cached-title-not-in-library'; chapters: number; history: number; trackers: number; trackerConflicts: number; partialSkipped: number };
type Review = { reviewId: string; rows: ImportRow[]; categories: string[]; includesTrackers: boolean; includesPartialPages: boolean };
type Result = { status: 'imported' | 'rolled-back' | 'cancelled'; checkpointId?: string; rows?: ImportRow[] };

export function MihonReconstruction({ parsed, includePages, busy, onBusy }: { parsed: MihonImport; includePages: boolean; busy: boolean; onBusy(value: boolean): void }) {
  const [includeTrackers, setIncludeTrackers] = React.useState(false);
  const [review, setReview] = React.useState<Review | null>(null);
  const [result, setResult] = React.useState<Result | null>(null);
  const [error, setError] = React.useState('');
  const latest = React.useRef<string | null>(null);
  const revision = React.useRef(0);
  React.useEffect(() => {
    revision.current++;
    const previous = latest.current; latest.current = null;
    setReview(null); setResult(null); setError('');
    if (previous) void readRequest({ kind: 'cancel-mihon-import', reviewId: previous }).catch(() => undefined);
  }, [parsed, includePages, includeTrackers]);
  React.useEffect(() => () => {
    revision.current++;
    if (latest.current) void readRequest({ kind: 'cancel-mihon-import', reviewId: latest.current }).catch(() => undefined);
  }, []);
  function closed() {
    if (document.querySelector('.tsugi-chapter-reader')) throw Error('open-reader');
  }
  async function prepare() {
    const version = revision.current;
    onBusy(true); setError(''); setResult(null); setReview(null);
    try {
      closed();
      const next = await runRestoreSection('manga', undefined, undefined, () => readRequest<Review>({ kind: 'review-mihon-import', input: { ...parsed.reconstruction, includePartialPages: includePages, includeTrackers } }));
      if (!/^[a-f\d]{32}$/.test(next.reviewId) || !Array.isArray(next.rows) || next.rows.length !== parsed.reconstruction.manga.length) throw Error('invalid-review');
      if (version !== revision.current) { await readRequest({ kind: 'cancel-mihon-import', reviewId: next.reviewId }); return; }
      latest.current = next.reviewId; setReview(next);
    } catch (reason) {
      setError(restoreSessionFeedback(reason) ?? t`The complete import could not be reviewed. Close the current chapter, finish downloads and pause library updates, then try again. Nothing was imported.`);
    } finally { onBusy(false); }
  }
  async function apply() {
    if (!review) return;
    onBusy(true); setError('');
    try {
      closed();
      const next = await runRestoreSection('manga', undefined, undefined, () => readRequest<Result>({ kind: 'apply-mihon-import', reviewId: review.reviewId }));
      if (!['imported', 'rolled-back', 'cancelled'].includes(next.status)) throw Error('invalid-result');
      latest.current = null; setResult(next); setReview(null);
      if (next.status === 'imported') window.dispatchEvent(new Event('tsugi-reader-imported'));
    } catch (reason) {
      latest.current = null; setReview(null);
      setError(restoreSessionFeedback(reason) ?? t`The import was not confirmed. Review the library again before retrying. If the Reader cannot start, restart Tsugi to finish native recovery.`);
    } finally { onBusy(false); }
  }
  async function cancel() {
    if (!review) return;
    const reviewId = review.reviewId; latest.current = null; setReview(null);
    await readRequest({ kind: 'cancel-mihon-import', reviewId }).catch(() => undefined);
    setResult({ status: 'cancelled' });
  }
  function report() {
    const rows = result?.rows ?? review?.rows;
    if (!rows) return;
    const body = JSON.stringify({ format: 'tsugi-mihon-complete-import-report', version: 1, result: result?.status ?? 'review',
      counts: parsed.report, rows, sourceNames: parsed.sources, identityExclusions: parsed.reconstructionSkipped,
      trackerReferences: parsed.reconstruction.manga.flatMap(row => row.trackers.map(tracker => ({ title: row.title, sourceId: row.sourceId, ...tracker }))),
    }, null, 2);
    const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'tsugi-mihon-complete-import-report.json';
    document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const rows = review?.rows ?? result?.rows;
  return <section className="space-y-3" aria-label={t`Complete Mihon library import`}>
    <h4><Trans>Complete library import</Trans></h4>
    <p><Trans>Reconstruct missing remote titles and chapters directly from this backup, including reading history. No source search or installation is needed for the import. Add each trusted extension separately to resume online reading. Existing progress and categories are preserved.</Trans></p>
    {parsed.report.trackingRecords > 0 && <label className="flex items-start gap-2"><input type="checkbox" checked={includeTrackers} disabled={busy} onChange={event => setIncludeTrackers(event.target.checked)} /><span><Trans>Import MyAnimeList and AniList title references</Trans><small className="block"><Trans>This saves public title mappings locally. It does not connect accounts or update trackers. Existing different mappings and ambiguous references are kept unchanged and reported.</Trans></small></span></label>}
    {parsed.reconstructionSkipped.length > 0 && <div role="status"><p><Trans>Some identifiers contain private credentials or an unsupported address format. These items are excluded from reconstruction. Exact existing-title merges remain available.</Trans></p><ul>{parsed.reconstructionSkipped.map((row, index) => { const { chaptersSkipped } = row; return <li key={index}>{row.title} — {row.titleSkipped ? t`Title excluded` : t`${chaptersSkipped} chapters excluded`}</li>; })}</ul></div>}
    {!review && <button type="button" className="tsugi-read-action" disabled={busy} onClick={() => void prepare()}><Trans>Review complete library import</Trans></button>}
    {rows && <>
      <div className="max-h-64 overflow-auto" aria-label={t`Mihon title import review`}>{rows.map((row, index) => { const { chapters, history, trackers, trackerConflicts, partialSkipped } = row; return <div key={index} className="tsugi-read-row">
        <span className="min-w-0 break-words">{row.title}<small className="block">{row.sourceId}</small></span>
        <span className="min-w-0 text-sm">{row.state === 'new' ? t`New title` : row.state === 'merge' ? t`Merge existing title` : row.state === 'local-files-required' ? t`Skipped: local media required` : t`Skipped: add the cached title to your library first`}<small className="block"><Trans>{chapters} new chapters · {history} history entries · {trackers} tracker references</Trans></small>{row.trackerConflicts > 0 && <small className="block"><Trans>{trackerConflicts} tracker conflicts left unchanged</Trans></small>}{row.partialSkipped > 0 && <small className="block"><Trans>{partialSkipped} partial positions left unchanged</Trans></small>}</span>
      </div>; })}</div>
      <button type="button" className="tsugi-read-action" onClick={report}><Trans>Download complete import report</Trans></button>
    </>}
    {review && <><p><Trans>Applying creates a private recovery copy, imports only the reviewed metadata, restarts the Reader and verifies the result. A failed verification restores the previous data. A Windows confirmation appears before changes.</Trans></p><button type="button" className="tsugi-read-action" disabled={busy} onClick={() => void apply()}><Trans>Apply complete library import</Trans></button><button type="button" className="tsugi-read-action" disabled={busy} onClick={() => void cancel()}><Trans>Cancel import review</Trans></button></>}
    {result?.status === 'imported' && <p role="status"><Trans>The reviewed library import was verified after restart. Review skipped items in the report.</Trans></p>}
    {result?.status === 'rolled-back' && <p role="alert"><Trans>The import could not be verified. The previous Reader metadata was restored. Review the backup again before retrying.</Trans></p>}
    {result?.status === 'cancelled' && <p role="status"><Trans>The import was cancelled. Nothing was imported.</Trans></p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
