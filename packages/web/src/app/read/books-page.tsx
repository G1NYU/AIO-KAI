import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { TsugiRail } from '@/components/shell/tsugi-rail';
import { BrushBook, BrushPlus, BrushSearch, BrushRefresh, BrushHistory, BrushGrid } from '@/components/tsugi-icons';
import { LandscapeSpotlight } from '@/components/landscape-spotlight';
import { useDesktopArea } from '@/lib/desktop-area';
import { getBookFile, importBook, listBooks, removeBook, type BookEntry } from './book-library';
import { BookReader } from './book-reader';

function BookCover({ book }: { book: BookEntry }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!book.cover) { setUrl(''); return; }
    const objectUrl = URL.createObjectURL(book.cover);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [book.cover]);
  return <div className="tsugi-manga-cover tsugi-book-cover">{url ? <img src={url} alt="" loading="lazy" onError={() => setUrl('')}/> : <><BrushBook aria-hidden/><span>{book.format.toUpperCase()}</span></>}</div>;
}

export function BooksPage() {
  const actions = useDesktopArea();
  const picker = useRef<HTMLInputElement>(null);
  const [books, setBooks] = useState<BookEntry[]>([]);
  const [active, setActive] = useState<{entry: BookEntry; file: File} | null>(null);
  const [details, setDetails] = useState<BookEntry | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'reading'>('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const refresh = useCallback(async () => {
    try { setBooks(await listBooks()); } catch { setError(t`Could not read the local book library.`); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(()=>{
    const restored=()=>{setDetails(null);setConfirm(false);void refresh();};
    window.addEventListener('tsugi-book-metadata-restored',restored);
    return ()=>window.removeEventListener('tsugi-book-metadata-restored',restored);
  },[refresh]);
  async function add(files: FileList | null) {
    if (!files || busy) return;
    const selected = Array.from(files).slice(0, 20);
    setBusy(true); setError('');
    let failed = 0;
    for (const file of selected) {
      try { await importBook(file); } catch { failed++; }
    }
    if (failed) setError(t`${failed} books could not be imported. Choose valid EPUB or PDF files of at most 128 MiB.`);
    await refresh(); setBusy(false);
  }
  async function open(entry: BookEntry) {
    setBusy(true); setError('');
    try { setActive({ entry, file: await getBookFile(entry) }); setDetails(null); setConfirm(false); }
    catch { setError(t`Could not open the saved book.`); }
    finally { setBusy(false); }
  }
  async function deleteCopy(entry: BookEntry) {
    setBusy(true); setError('');
    try { await removeBook(entry.id); setDetails(null); setConfirm(false); await refresh(); }
    catch { setError(t`Could not remove the saved copy.`); }
    finally { setBusy(false); }
  }
  const continuing = books.filter(book => book.position !== undefined && (book.fraction || 0) < 1).sort((a,b) => (b.lastReadAt || b.addedAt) - (a.lastReadAt || a.addedAt))[0];
  const resumePercent = Math.round((continuing?.fraction || 0) * 100);
  const rows = books.filter(book =>
    (!query.trim() || (book.title + ' ' + book.name).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) &&
    (filter === 'all' || (book.position !== undefined && (book.fraction || 0) < 1)));
  function library() { setActive(null); setDetails(null); setConfirm(false); void refresh(); }
  return <main data-page="books" className="tsugi-read-root tsugi-read-workspace">
    <TsugiRail area="read" disabled={busy} className="tsugi-reading-rail" mediaClassName="tsugi-read-media-header">
      <nav className="tsugi-rail-local" aria-label={t`Reading sections`}>
        <span className="tsugi-reading-rail-label"><Trans>Read</Trans></span>
        {actions?.openManga && <button type="button" title={t`Manga`} aria-label={t`Manga`} disabled={busy} onClick={actions.openManga}><BrushGrid aria-hidden/><Trans>Manga</Trans></button>}
        <button type="button" title={t`Books`} aria-label={t`Books`} aria-current="page" onClick={library}><BrushBook aria-hidden/><Trans>Books</Trans></button>
        <div className="tsugi-pixel-rule" aria-hidden="true"/>
        <span className="tsugi-reading-rail-label"><Trans>Collection</Trans></span>
        <button type="button" title={t`All books`} aria-label={t`All books`} disabled={busy} onClick={() => { library(); setFilter('all'); }}><BrushGrid aria-hidden/><Trans>All books</Trans></button>
        <button type="button" title={t`In progress`} aria-label={t`In progress`} disabled={busy} onClick={() => { library(); setFilter('reading'); }}><BrushHistory aria-hidden/><Trans>In progress</Trans></button>
        <button type="button" title={t`Import books`} aria-label={t`Import books`} disabled={busy} onClick={() => picker.current?.click()}><BrushPlus aria-hidden/><Trans>Import books</Trans></button>
      </nav>
    </TsugiRail>
    <div className="tsugi-reading-content tsugi-books-content">
      <input ref={picker} type="file" hidden multiple accept=".epub,.pdf" aria-label={t`Choose ebook files`} onChange={event => { void add(event.target.files); event.currentTarget.value = ''; }}/>
      {active ? <BookReader key={active.entry.id} {...active} onClose={library}/> : <>
        <header className="tsugi-reading-header">
          <div><h1><Trans>Books</Trans></h1><p className="tsugi-library-summary"><Trans>Saved titles</Trans> <strong>{books.length}</strong></p></div>
          <label className="tsugi-reading-global"><BrushSearch aria-hidden/><input value={query} onChange={event => { setQuery(event.target.value); setDetails(null); }} aria-label={t`Search books`} placeholder={t`Search books`}/></label>
        </header>
        {!details && <LandscapeSpotlight title={continuing?.title || t`Your reading room`} eyebrow={continuing ? t`Continue reading` : t`Local books`} description={continuing ? t`${resumePercent}% read` : t`Keep your own EPUB and PDF collection available offline.`} actionLabel={continuing ? t`Resume reading` : t`Import books`} onAction={() => continuing ? void open(continuing) : picker.current?.click()} disabled={busy}/>}
        {busy && <p role="status"><Trans>Working with local files…</Trans></p>}
        {error && <p role="alert" className="tsugi-read-error">{error}</p>}
        {details ? <section>
          <button className="tsugi-read-action mb-6" onClick={library}><Trans>Back</Trans></button>
          <div className="tsugi-manga-detail tsugi-book-detail"><BookCover book={details}/><div>
            <h2 className="text-3xl font-semibold">{details.title}</h2><p className="text-sm text-[--tsugi-muted]">{details.format.toUpperCase()} · {(details.size/1048576).toFixed(1)} MiB</p>
            <p className="my-3">{Math.round((details.fraction || 0)*100)}%</p>
            <div className="tsugi-series-actions flex flex-wrap gap-3">
              <button className="tsugi-read-action tsugi-series-primary" disabled={busy} onClick={() => void open(details)}>{details.position !== undefined ? <Trans>Resume reading</Trans> : <Trans>Read book</Trans>}</button>
              {confirm ? <><button className="tsugi-read-action" disabled={busy} onClick={() => void deleteCopy(details)}><Trans>Remove saved copy</Trans></button><button className="tsugi-read-action" onClick={() => setConfirm(false)}><Trans>Cancel</Trans></button></> : <button className="tsugi-read-action" onClick={() => setConfirm(true)}><Trans>Remove from library</Trans></button>}
            </div>
          </div></div>
        </section> : <section>
          <div className="tsugi-reading-list-header"><h2 className="text-xl font-medium">{filter === 'reading' ? <Trans>In progress</Trans> : <Trans>Your collection</Trans>} <span className="text-sm text-[--tsugi-muted]">({rows.length})</span></h2><div className="tsugi-reading-filters"><button className="tsugi-read-action" disabled={busy} onClick={() => picker.current?.click()}><BrushPlus aria-hidden/><Trans>Add EPUB or PDF</Trans></button><button className="tsugi-read-action" title={t`Refresh library`} aria-label={t`Refresh library`} onClick={() => void refresh()}><BrushRefresh aria-hidden/></button></div></div>
          {!books.length && !busy && <div className="tsugi-reading-empty"><BrushBook aria-hidden/><h2><Trans>Your library is empty</Trans></h2><p><Trans>Import a local EPUB or PDF to start reading.</Trans></p></div>}
          {!!books.length && !rows.length && <p className="py-6 text-[--tsugi-muted]"><Trans>No books match your filters.</Trans></p>}
          <div className="tsugi-manga-grid">{rows.map(book => <button key={book.id} className="tsugi-manga-card" disabled={busy} onClick={() => { setDetails(book); setConfirm(false); }}><BookCover book={book}/><span className="tsugi-manga-title">{book.title}</span><span className="text-xs text-[--tsugi-muted]">{Math.round((book.fraction || 0)*100)}%</span><progress aria-label={t`Reading progress`} max={1} value={book.fraction || 0}/></button>)}</div>
        </section>}
      </>}
    </div>
  </main>;
}
