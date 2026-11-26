import React from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { collectLocalManga, planMangaRestore } from '@/lib/backup/manga';
import { MIHON_BACKUP_LIMIT, parseMihonBackup, prepareMihonProgress, type MihonImport, type MihonPageReview } from '@/lib/backup/mihon';
import { prepareMangaRestore, readRestoreSessionState, restoreSessionBusy, reviewRestoreSection, RestoreSessionError, RESTORE_SESSION_EVENT } from '@/lib/backup/restore-session';
import { supportsReading } from '@/lib/hosts/shell/reading';
import { MangaBackupSettings } from './manga-backup-settings';
import { MihonReconstruction } from './mihon-reconstruction';
import { restoreSessionFeedback } from './restore-session-feedback';

export function MihonImportSettings() {
  const [parsed, setParsed] = React.useState<MihonImport | null>(null);
  const [includePages, setIncludePages] = React.useState(false);
  const [prepared, setPrepared] = React.useState<{ id: number; sessionId: string; payload: string; pages: MihonPageReview; report: string } | null>(null);
  const revision = React.useRef(0);
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState('');
  const [error, setError] = React.useState('');
  function activeChapter() { return !!document.querySelector('.tsugi-chapter-reader'); }
  function freshImport() {
    if (restoreSessionBusy()) throw new RestoreSessionError('busy');
    reviewRestoreSection('manga', undefined);
  }
  React.useEffect(() => {
    const changed = () => setPrepared(current => {
      if (!current) return current;
      const state = readRestoreSessionState();
      return state.kind === 'ready' && state.session.id === current.sessionId ? current : null;
    });
    window.addEventListener(RESTORE_SESSION_EVENT, changed);
    window.addEventListener('storage', changed);
    return () => { window.removeEventListener(RESTORE_SESSION_EVENT, changed); window.removeEventListener('storage', changed); };
  }, []);

  async function load(file: File | undefined) {
    if (!file) return;
    if (activeChapter()) { setError(t`Close the current chapter before reviewing a Mihon backup.`); return; }
    try { freshImport(); } catch (reason) { setError(restoreSessionFeedback(reason) ?? t`An existing restore must be resolved before starting a Mihon import.`); return; }
    setBusy(true); setError(''); setParsed(null); setPrepared(null); setIncludePages(false);
    setProgress(t`Reading the Mihon backup…`);
    try {
      if (file.size > MIHON_BACKUP_LIMIT) throw Error('mihon-size');
      setParsed(await parseMihonBackup(new Uint8Array(await file.arrayBuffer()), { manga: t`Untitled manga`, chapter: t`Unnamed chapter`, source: t`Unnamed source` }));
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : '';
      setError(code === 'mihon-size' || code === 'mihon-expanded-size'
        ? t`This backup exceeds the 16 MiB file or 32 MiB decompressed limit. Export a smaller backup from Mihon. Nothing was imported.`
        : code === 'size' ? t`The converted reading data exceeds the 8 MiB review limit. Export a smaller backup from Mihon. Nothing was imported.`
        : code === 'mihon-gzip-unavailable' ? t`This device cannot decompress Mihon backups. Update the app's browser runtime before retrying. Nothing was imported.`
        : t`This backup could not be safely decoded. Use a supported Mihon .tachibk or .proto.gz backup with up to 1,000 titles and 100,000 chapters. Damaged files, duplicate identities and invalid values are rejected. Nothing was imported.`);
    } finally { setBusy(false); setProgress(''); }
  }

  async function prepare() {
    if (!parsed) return;
    if (activeChapter()) { setError(t`Close the current chapter before preparing a Mihon import.`); return; }
    try { freshImport(); } catch (reason) { setError(restoreSessionFeedback(reason) ?? t`An existing restore must be resolved before starting a Mihon import.`); return; }
    setBusy(true); setError(''); setPrepared(null);
    try {
      const local = await collectLocalManga((done, total) => setProgress(t`Checking local manga: ${done} / ${total}`));
      const projection = prepareMihonProgress(parsed, local, includePages);
      const payload = JSON.stringify(projection.backup);
      const plan = planMangaRestore(projection.backup, local);
      const localTitles = new Map(local.map(row => [row.identity, row]));
      const unresolved = projection.backup.manga.flatMap(row => {
        const match = localTitles.get(row.identity);
        const exact = match?.sourceId === row.sourceId ? match : undefined;
        const knownChapters = new Set(exact?.chapters.map(chapter => chapter.identity) ?? []);
        const chapters = row.chapters.filter(chapter => !knownChapters.has(chapter.identity)).map(({ identity, name }) => ({ identity, name }));
        return !exact || chapters.length ? [{ title: row.title, sourceId: row.sourceId, identity: row.identity, categories: row.categories, missingTitle: !exact, chapters }] : [];
      });
      const report = JSON.stringify({
        format: 'tsugi-mihon-import-report', version: 1, supportedSchema: 'mihon-v0.21.3-protobuf',
        counts: parsed.report, partialPages: projection.pages, sourceNames: parsed.sources,
        titles: plan.rows.map(({ identity, sourceId, title, state, matched, unmatched, kept }) => ({ identity, sourceId, title, state, matched, unmatched, kept })),
        unresolved,
      }, null, 2);
      setProgress(t`Saving the recovery checkpoint…`);
      const session = await prepareMangaRestore(payload);
      setPrepared({ id: ++revision.current, sessionId: session.id, payload, pages: projection.pages, report });
    } catch (reason) {
      setError(restoreSessionFeedback(reason) ?? t`The Mihon import checkpoint could not be prepared. Check the Reader runtime and backup limits before retrying. Nothing was imported by this action.`);
    } finally { setBusy(false); setProgress(''); }
  }

  function downloadReport() {
    if (!prepared) return;
    const url = URL.createObjectURL(new Blob([prepared.report], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'tsugi-mihon-import-report.json';
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (!supportsReading()) return null;
  return <section className="tsugi-app-general" aria-label={t`Mihon backup import`}>
    <h3><Trans>Mihon backup import</Trans></h3>
    <p><Trans>Import a real Mihon .tachibk or .proto.gz backup. Files are decoded locally using the supported Mihon 0.21.3 protobuf schema, including compatible older backups. The limit is 16 MiB per file and 32 MiB after decompression.</Trans></p>
    <p><Trans>Use the complete library import to reconstruct titles and chapters from the backup, or the existing-title merge to apply only exact matches already in Read. Source installation remains a separate trusted action.</Trans></p>
    <label className="min-w-0"><span><Trans>Choose a Mihon backup</Trans></span><input type="file" accept=".tachibk,.proto.gz,.gz,.proto,application/gzip,application/octet-stream" className="tsugi-read-input w-full min-w-0 max-w-full" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void load(file); }} /></label>
    {busy && <p role="status">{progress || t`Preparing the Mihon import…`}</p>}
    {parsed && <div className="space-y-3">
      <h4><Trans>Decoded backup</Trans></h4>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt><Trans>Library titles</Trans></dt><dd>{parsed.report.titles}</dd>
        <dt><Trans>Chapters</Trans></dt><dd>{parsed.report.chapters}</dd>
        <dt><Trans>Categories</Trans></dt><dd>{parsed.report.categories}</dd>
        <dt><Trans>Source names</Trans></dt><dd>{parsed.report.sources}</dd>
        <dt><Trans>Partial page positions</Trans></dt><dd>{parsed.report.partialPositions}</dd>
        <dt><Trans>History records for conflict checks</Trans></dt><dd>{parsed.report.historyMatched}</dd>
        <dt><Trans>History entries without a backed-up chapter</Trans></dt><dd>{parsed.report.historyUnmatched}</dd>
        <dt><Trans>Non-library titles skipped</Trans></dt><dd>{parsed.report.nonLibraryTitles}</dd>
        <dt><Trans>Ambiguous or unsupported categories skipped</Trans></dt><dd>{parsed.report.categoriesSkipped}</dd>
        <dt><Trans>Unresolved category assignments</Trans></dt><dd>{parsed.report.categoryAssignmentsSkipped}</dd>
      </dl>
      <p><Trans>Read flags and bookmarks can be merged after review. Existing categories and newer reading progress are kept. The complete import also restores chapter history and optional supported tracker references. Reading durations, account connections, downloads and images are not imported.</Trans></p>
      <details>
        <summary><Trans>Data excluded from this import</Trans></summary>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt><Trans>Tracker references available for separate review</Trans></dt><dd>{parsed.report.trackingRecords}</dd>
          <dt><Trans>App preference entries</Trans></dt><dd>{parsed.report.appPreferences}</dd>
          <dt><Trans>Source preference groups</Trans></dt><dd>{parsed.report.sourcePreferences}</dd>
          <dt><Trans>Extension repository entries</Trans></dt><dd>{parsed.report.extensionStores}</dd>
          <dt><Trans>Other metadata fields</Trans></dt><dd>{parsed.report.metadataFieldsOmitted}</dd>
          <dt><Trans>Unsupported labels replaced</Trans></dt><dd>{parsed.report.labelsReplaced}</dd>
        </dl>
        <p><Trans>Source preferences may contain credentials. Their values, app settings, tracker account data and repository addresses are discarded without applying them.</Trans></p>
      </details>
      {parsed.sources.length > 0 && <details><summary><Trans>Sources named in the backup</Trans></summary><ul className="max-h-48 overflow-auto">{parsed.sources.map(source => <li key={source.id} className="tsugi-read-row"><span className="min-w-0 break-words">{source.name}</span><small>{source.id}</small></li>)}</ul><p><Trans>These names come from the backup. The matched restore preview checks which sources are currently available.</Trans></p></details>}
      {parsed.report.partialPositions > 0 && <label className="flex items-start gap-2"><input type="checkbox" checked={includePages} disabled={busy || prepared !== null} onChange={event => setIncludePages(event.target.checked)} /><span><Trans>Include eligible partial page positions</Trans><small className="block"><Trans>Mihon backups do not contain page counts. Allow a forward position only when the exact local chapter has a cached page count, the position is in range, and local progress is not newer. The preview and apply check the local chapter again.</Trans></small></span></label>}
      {!prepared && <MihonReconstruction parsed={parsed} includePages={includePages} busy={busy} onBusy={setBusy} />}
      {!prepared && <button type="button" className="tsugi-read-action" disabled={busy} onClick={() => void prepare()}><Trans>Prepare Mihon import checkpoint</Trans></button>}
      {prepared && <>
        <p role="status"><Trans>The recovery checkpoint is saved. Review the proposed changes below before applying progress or categories.</Trans></p>
        {prepared.pages.requested > 0 && <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt><Trans>Eligible partial page positions</Trans></dt><dd>{prepared.pages.eligible}</dd>
          <dt><Trans>Partial pages left unchanged</Trans></dt><dd>{prepared.pages.requested - prepared.pages.eligible}</dd>
        </dl>}
        <button type="button" className="tsugi-read-action" onClick={downloadReport}><Trans>Download import and unresolved entries report</Trans></button>
        <MangaBackupSettings key={prepared.id} archiveEntry={prepared.payload} importOnly importLabel={t`Review Mihon import`} />
      </>}
    </div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
