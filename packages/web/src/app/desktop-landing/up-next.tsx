import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useDesktopArea } from '@/lib/desktop-area';
import { bookResumeRows, mangaResumeRows, orderedResumeRows, resumeKey, type ResumeRow } from '@/lib/up-next';
import { listBooks } from '@/app/read/book-library';
import { readRequest } from '@/lib/hosts/shell/reading';
import { navigate, to } from '@/lib/paths';

type Status = 'idle' | 'loading' | 'ready' | 'error';
type Result = { status: Status; rows: ResumeRow[] };
const empty: Result = {status:'idle', rows:[]};
// Dismissal is intentionally separate from progress, and is not persisted.
const dismissed = new Set<string>();
function mediaLabel(row: ResumeRow) {
  if (row.target.kind === 'book') return row.format === 'pdf' ? t`PDF` : t`EPUB`;
  if (row.target.kind === 'manga') return t`Manga`;
  return t`Music`;
}
export function UpNext({open, onClose}: {open:boolean; onClose:()=>void}) {
  const actions = useDesktopArea();
  const dialog = React.useRef<HTMLDialogElement>(null);
  const [books, setBooks] = React.useState<Result>(empty);
  const [manga, setManga] = React.useState<Result>(empty);
  const [revision, setRevision] = React.useState(0);
  const [hidden, setHidden] = React.useState(() => new Set(dismissed));
  const canBooks = !!actions?.openBooks;
  const canManga = !!actions?.readerReady && !!actions.openManga;
  React.useEffect(() => {
    const node = dialog.current;
    if (open && node && !node.open) node.showModal();
    else if (!open && node?.open) node.close();
    return () => { if (node?.open) node.close(); };
  }, [open]);
  React.useEffect(() => {
    if (!open) return;
    let current = true;
    setBooks(canBooks ? {status:'loading',rows:[]} : empty);
    setManga(canManga ? {status:'loading',rows:[]} : empty);
    if (canBooks) void listBooks().then(value => {
      if (current) setBooks({status:'ready',rows:bookResumeRows(value)});
    }).catch(() => { if (current) setBooks({status:'error',rows:[]}); });
    if (canManga) void readRequest<unknown>({kind:'history'}).then(value => {
      if (current) setManga({status:'ready',rows:mangaResumeRows(value)});
    }).catch(() => { if (current) setManga({status:'error',rows:[]}); });
    return () => { current = false; };
  }, [open, revision, canBooks, canManga]);
  const rows = orderedResumeRows([...books.rows,...manga.rows,...(actions?.musicResumeRows ?? [])].filter(row=>!hidden.has(resumeKey(row.target))));
  function hide(row: ResumeRow) {
    const key = resumeKey(row.target);
    if (dismissed.size >= 100) dismissed.delete(dismissed.values().next().value!);
    dismissed.add(key);
    setHidden(new Set(dismissed));
  }
  function resetHidden() { dismissed.clear(); setHidden(new Set()); }
  return <dialog ref={dialog} className="tsugi-global-settings tsugi-up-next" data-ui="tsugi-up-next" aria-labelledby="tsugi-up-next-title"
    onCancel={event=>{event.preventDefault();onClose();}}>
    <header className="flex items-start justify-between gap-4">
      <div><h2 id="tsugi-up-next-title"><Trans>Up next</Trans></h2><p><Trans>Pick up where you left off.</Trans></p></div>
      <button type="button" className="tsugi-read-action" onClick={onClose}><Trans>Close</Trans></button>
    </header>
    <div className="tsugi-up-next-tools">
      <button type="button" className="tsugi-read-action" onClick={()=>setRevision(value=>value+1)}><Trans>Refresh</Trans></button>
      {hidden.size>0 && <button type="button" className="tsugi-read-action" onClick={resetHidden}><Trans>Show hidden</Trans></button>}
      {!!actions?.openManga && !canManga && <button type="button" className="tsugi-read-action" onClick={()=>{onClose();actions.openManga?.();}}><Trans>Set up Manga to continue reading</Trans></button>}
    </div>
    {(books.status==='loading'||manga.status==='loading') && <p role="status"><Trans>Checking your libraries…</Trans></p>}
    {books.status==='error' && <p role="status"><Trans>Books could not be loaded. Refresh to try again.</Trans></p>}
    {manga.status==='error' && <p role="status"><Trans>Manga history could not be loaded. Refresh to try again.</Trans></p>}

    <div className="tsugi-up-next-list">
      {rows.map(row=>{ const { title, page } = row; return <article key={resumeKey(row.target)} className="tsugi-up-next-row">
        <div className="min-w-0">
          <small className="tsugi-up-next-type">{mediaLabel(row)}{row.current && <> · <Trans>Current player</Trans></>}</small>
          <h3>{row.title}</h3>
          {row.subtitle && <p>{row.subtitle}</p>}
          {row.page!==undefined && <p><Trans>Page {page}</Trans></p>}
          {row.at>0 && <p><time dateTime={new Date(row.at).toISOString()}>{new Date(row.at).toLocaleDateString()}</time></p>}
          {row.progress!==undefined && <progress max={1} value={row.progress} aria-label={t`Saved progress`}/>}
          {!row.available && <p><Trans>Original source disconnected</Trans></p>}
        </div>
        <div className="tsugi-up-next-actions">
          <button type="button" className="tsugi-read-action" disabled={!row.available} onClick={()=>{onClose();actions?.openResume?.(row.target);}}>
            {row.target.kind==='music' ? row.current ? <Trans>Open player</Trans> : <Trans>Play again</Trans> : <Trans>Resume</Trans>}
          </button>
          <button type="button" className="tsugi-read-action" aria-label={t`Hide ${title}`} onClick={()=>hide(row)}><Trans>Hide</Trans></button>
        </div>
      </article>; })}
      {!rows.length && books.status!=='loading' && manga.status!=='loading' && <p className="tsugi-up-next-empty"><Trans>Start reading or listening to see your recent items here.</Trans></p>}
      <article className="tsugi-up-next-row">
        <div className="min-w-0"><small className="tsugi-up-next-type"><Trans>Movies & TV</Trans></small><h3><Trans>Continue watching</Trans></h3><p><Trans>Resume from your active video profile.</Trans></p></div>
        <div className="tsugi-up-next-actions"><button type="button" className="tsugi-read-action" onClick={()=>{onClose();actions?.openVideo();navigate(to.home);}}><Trans>Open Movies & TV</Trans></button></div>
      </article>
    </div>
    <p className="tsugi-up-next-note"><Trans>Progress stays in your libraries. Hiding a shortcut never deletes history or downloads.</Trans></p>
  </dialog>;
}
