import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { TsugiRail } from '@/components/shell/tsugi-rail';
import { BrushBook, BrushPlus, BrushSearch, BrushRefresh, BrushHistory, BrushGrid, BrushRight, BrushBack } from '@/components/tsugi-icons';
import { LandscapeSpotlight } from '@/components/landscape-spotlight';
import { LandscapeDecoration } from '@/components/landscape-decoration';
import { BrushHeading } from '@/components/brush-heading';
import { useDesktopArea } from '@/lib/desktop-area';
import { getBookFile, importBook, listBooks, removeBook, type BookEntry } from './book-library';
import { BookReader } from './book-reader';
import './yomi.css';

function BookCover({ book }: { book: BookEntry }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!book.cover) { setUrl(''); return; }
    const objectUrl = URL.createObjectURL(book.cover);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [book.cover]);
  return <div className="tsugi-manga-cover tsugi-book-cover">{url ? <img src={url} alt="" loading="lazy" onError={() => setUrl('')}/> : <span className="yomi-cover-fallback" aria-hidden="true"><BrushBook/><span>{book.title}</span><small>{book.format.toUpperCase()}</small></span>}</div>;
}

function bookDate(value: number | undefined) {
  if (!value || !Number.isFinite(value)) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function BooksPage() {
  const actions = useDesktopArea();
  const picker = useRef<HTMLInputElement>(null);
  const [books, setBooks] = useState<BookEntry[]>([]);
  const [active, setActive] = useState<{entry: BookEntry; file: File} | null>(null);
  const [details, setDetails] = useState<BookEntry | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'reading'>('all');
  const [format, setFormat] = useState<'all' | 'epub' | 'pdf'>('all');
  const [sort, setSort] = useState<'recent' | 'title'>('recent');
  const [spotlightId, setSpotlightId] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    try { setBooks(await listBooks()); setLoaded(true); }
    catch { setError(t`Could not read the local book library.`); }
    finally { setLoading(false); }
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
  const continuingBooks = books.filter(book => book.position !== undefined && (book.fraction || 0) < 1).sort((a,b) => (b.lastReadAt || b.addedAt) - (a.lastReadAt || a.addedAt));
  const continuing = continuingBooks.find(book => book.id === spotlightId) || continuingBooks[0];
  const resumePercent = Math.round((continuing?.fraction || 0) * 100);
  const rows = books.filter(book =>
    (!query.trim() || (book.title + ' ' + book.name).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) &&
    (filter === 'all' || (book.position !== undefined && (book.fraction || 0) < 1)) &&
    (format === 'all' || book.format === format)).sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title) : (b.lastReadAt || b.addedAt) - (a.lastReadAt || a.addedAt));
  function library() { setActive(null); setDetails(null); setConfirm(false); void refresh(); }
  return <main data-page="books" data-read-view={active ? 'book-reader' : details ? 'book-detail' : 'books'} className="tsugi-read-root tsugi-read-workspace yomi-workspace">
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
          <div><p className="yomi-eyebrow"><Trans>Your reading space</Trans></p><h1><Trans>Books</Trans></h1>{loaded && <p className="tsugi-library-summary"><Trans>Saved titles</Trans> <strong>{books.length}</strong><span aria-hidden="true"> · </span><Trans>EPUB & PDF</Trans></p>}</div>
          <label className="tsugi-reading-global"><BrushSearch aria-hidden/><input value={query} onChange={event => { setQuery(event.target.value); setDetails(null); }} aria-label={t`Search books`} placeholder={t`Search books`}/></label>
        </header>
        {!details && <LandscapeSpotlight designArea="read" localArtwork="/design/shared/hero-train.webp" title={continuing?.title || t`A room for words.`} eyebrow={continuing ? t`Continue reading` : t`Local books`} description={continuing ? t`${resumePercent}% read` : t`Keep your own EPUB and PDF collection available offline.`} actionLabel={continuing ? t`Resume reading` : t`Import books`} featuredKey={continuing?.id} featuredArtwork={continuing ? <BookCover book={continuing}/> : undefined} onNextFeatured={continuing && continuingBooks.length > 1 ? () => setSpotlightId(continuingBooks[(continuingBooks.indexOf(continuing) + 1) % continuingBooks.length].id) : undefined} onAction={() => continuing ? void open(continuing) : picker.current?.click()} disabled={busy || loading}/>}
        {loading && !busy && <p role="status" className="yomi-loading"><Trans>Loading your books…</Trans></p>}
        {busy && <p role="status"><Trans>Working with local files…</Trans></p>}
        {error && <p role="alert" className="tsugi-read-error">{error}</p>}
        {details ? <section>
          <button className="tsugi-read-action mb-6" onClick={library}><BrushBack aria-hidden/><Trans>Back</Trans></button>
          <div className="tsugi-manga-detail tsugi-book-detail yomi-series-hero"><LandscapeDecoration className="yomi-series-backdrop" fallback="/design/shared/hero-train.webp"/><BookCover book={details}/><div className="min-w-0">
            <p className="yomi-eyebrow"><Trans>In your library</Trans><span aria-hidden="true"> / </span>{details.format.toUpperCase()}</p>
            <BrushHeading as="h2" className="text-3xl font-semibold">{details.title}</BrushHeading><p className="my-3 text-sm text-[--tsugi-muted]">{details.format.toUpperCase()} · {(details.size/1048576).toFixed(1)} MiB</p>
            <div className="yomi-book-progress"><span>{details.position !== undefined ? <>{Math.round((details.fraction || 0)*100)}% <Trans>read</Trans></> : <Trans>Not started</Trans>}</span><progress aria-label={t`Reading progress`} max={1} value={details.fraction || 0}/></div>
            <div className="tsugi-series-actions flex flex-wrap gap-3">
              <button className="tsugi-read-action tsugi-series-primary" disabled={busy} onClick={() => void open(details)}>{details.position !== undefined ? <Trans>Resume reading</Trans> : <Trans>Read book</Trans>}</button>
              {confirm ? <><button className="tsugi-read-action" disabled={busy} onClick={() => void deleteCopy(details)}><Trans>Remove saved copy</Trans></button><button className="tsugi-read-action" onClick={() => setConfirm(false)}><Trans>Cancel</Trans></button></> : <button className="tsugi-read-action" onClick={() => setConfirm(true)}><Trans>Remove from library</Trans></button>}
            </div>
          </div></div>
          <div className="yomi-book-info"><section className="yomi-series-summary"><h3><Trans>About this copy</Trans></h3><dl className="yomi-facts"><div><dt><Trans>Format</Trans></dt><dd>{details.format.toUpperCase()}</dd></div><div><dt><Trans>File size</Trans></dt><dd>{(details.size/1048576).toFixed(1)} MiB</dd></div><div><dt><Trans>Added</Trans></dt><dd>{bookDate(details.addedAt)}</dd></div>{!!details.lastReadAt && <div><dt><Trans>Last opened</Trans></dt><dd>{bookDate(details.lastReadAt)}</dd></div>}<div className="yomi-fact-wide"><dt><Trans>Original filename</Trans></dt><dd>{details.name}</dd></div></dl></section><section className="yomi-series-summary"><BrushBook aria-hidden/><h3><Trans>Your place, kept.</Trans></h3><p><Trans>Open this book to adjust its reading appearance and continue from your saved position.</Trans></p></section></div>
        </section> : <section>
          {!!continuingBooks.length && filter === 'all' && format === 'all' && !query.trim() && <section className="tsugi-reading-resume"><div className="yomi-section-heading"><h2><Trans>Continue your story</Trans></h2><button className="tsugi-library-action" onClick={() => setFilter('reading')}><Trans>See in-progress books</Trans><BrushRight aria-hidden/></button></div><div className="tsugi-reading-resume-list">{continuingBooks.slice(0, 3).map(book => <button key={book.id} className="tsugi-reading-resume-card" disabled={busy} onClick={() => void open(book)}><BookCover book={book}/><span><small className="yomi-resume-kicker"><Trans>Continue ebook</Trans></small><strong>{book.title}</strong><small>{book.format.toUpperCase()} · {Math.round((book.fraction || 0) * 100)}%</small><span className="tsugi-reading-resume-progress"><progress max={1} value={book.fraction || 0} aria-label={t`Reading progress`}/></span><small className="tsugi-reading-resume-label"><Trans>Resume reading</Trans></small></span><BrushRight aria-hidden/></button>)}</div></section>}
          <div className="tsugi-library-controls"><div className="tsugi-reading-list-header"><nav className="tsugi-read-subnav" aria-label={t`Book library view`}><button aria-current={filter === 'all' ? 'page' : undefined} onClick={() => setFilter('all')}><Trans>All titles</Trans></button><button aria-current={filter === 'reading' ? 'page' : undefined} onClick={() => setFilter('reading')}><Trans>Reading</Trans></button></nav><div className="tsugi-reading-filters"><select className="tsugi-read-input" aria-label={t`Book format`} value={format} onChange={event => setFormat(event.target.value as typeof format)}><option value="all"><Trans>All formats</Trans></option><option value="epub">EPUB</option><option value="pdf">PDF</option></select><select className="tsugi-read-input" aria-label={t`Book sort`} value={sort} onChange={event => setSort(event.target.value as typeof sort)}><option value="recent"><Trans>Recently opened</Trans></option><option value="title"><Trans>Title</Trans></option></select><button className="tsugi-read-action" disabled={busy} onClick={() => picker.current?.click()}><BrushPlus aria-hidden/><Trans>Add EPUB or PDF</Trans></button><button className="tsugi-read-action" title={t`Refresh library`} aria-label={t`Refresh library`} disabled={loading || busy} onClick={() => { setError(''); void refresh(); }}><BrushRefresh aria-hidden/></button></div></div></div>
          {!books.length && !busy && !loading && loaded && <div className="tsugi-reading-empty"><BrushBook aria-hidden/><h2><Trans>Your library is empty</Trans></h2><p><Trans>Import a local EPUB or PDF to start reading.</Trans></p><button className="tsugi-read-action tsugi-series-primary" onClick={() => picker.current?.click()}><Trans>Choose your first book</Trans></button></div>}
          {!!books.length && !rows.length && <p className="py-6 text-[--tsugi-muted]"><Trans>No books match your filters.</Trans></p>}
          {!!books.length && <div className="tsugi-library-grid-heading"><h2>{filter === 'reading' ? <Trans>In progress</Trans> : <Trans>Your collection</Trans>}</h2><span>{rows.length}</span></div>}
          <div className="tsugi-manga-grid">{rows.map(book => <button key={book.id} className="tsugi-manga-card" disabled={busy} onClick={() => { setDetails(book); setConfirm(false); }}><BookCover book={book}/><span className="tsugi-manga-title">{book.title}</span><span className="yomi-book-card-meta"><span>{book.format.toUpperCase()}</span><span>{book.position !== undefined ? `${Math.round((book.fraction || 0)*100)}%` : t`Not started`}</span></span><progress aria-label={t`Reading progress`} max={1} value={book.fraction || 0}/></button>)}</div>
          <div className="yomi-library-links"><button type="button" disabled={busy} onClick={() => picker.current?.click()}><BrushPlus aria-hidden/><span><strong><Trans>Bring your own stories</Trans></strong><small><Trans>Add EPUB and PDF files from your device.</Trans></small></span><BrushRight aria-hidden/></button>{actions?.openManga && <button type="button" disabled={busy} onClick={actions.openManga}><BrushGrid aria-hidden/><span><strong><Trans>Explore your manga</Trans></strong><small><Trans>Open sources, chapters and your manga collection.</Trans></small></span><BrushRight aria-hidden/></button>}</div>
        </section>}
      </>}
    </div>
  </main>;
}
