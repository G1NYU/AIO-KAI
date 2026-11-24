import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { FiArrowLeft, FiBookOpen, FiChevronRight, FiCompass, FiGrid, FiSearch, FiSettings, FiGlobe, FiClock, FiRefreshCw, FiBookmark } from 'react-icons/fi';
import { MediaNavigation } from '@/components/shell/media-navigation';
import { useDesktopArea } from '@/lib/desktop-area';
import { prepareReading, readRequest, readImage } from '@/lib/hosts/shell/reading';
import { ChapterReader } from './chapter-reader';
import { lookupMissingCover, mayLookUpCover, readCoverFallback, saveCoverFallback } from './cover-fallback';
import { ReaderSettings } from './reader-settings';
import { MangaTracking, type Tracker } from './tracking';
import { readReaderPreferences, saveReaderPreferences } from './reader-preferences';
import { chapterGroups, neighboringChapter, cleanSynopsis, type ReadingChapter as Chapter } from './reader-utils';

type Nodes<T> = { nodes: T[]; totalCount: number };
type Source = { id: string; name: string; lang: string; displayName?: string; supportsLatest: boolean };
type Store = { indexUrl: string; name: string };
type Extension = { storeIndexUrl?: string | null; pkgName: string; name: string; lang: string; versionName: string; isInstalled: boolean; isObsolete: boolean };
type Manga = { id: number | string; title: string; author?: string | null; artist?: string | null; genre?: string[]; thumbnailUrl?: string | null; description?: string | null; inLibrary: boolean; unreadCount?: number; lastReadChapter?: { id: number; name: string; lastPageRead: number; pageCount: number; isRead: boolean; lastReadAt?: number | string } | null };
type Details = { manga: Manga; chapters: Chapter[] };
type Catalogue = { mangas: Manga[]; hasNextPage: boolean };
type Reader = { chapter: Chapter; count: number; index: number };
type Tab = 'library' | 'browse' | 'settings';
type BrowseTab = 'sources' | 'extensions' | 'search';
type SettingsPage = 'browse' | 'sources' | 'repositories' | 'reader' | 'trackers' | null;
type SearchGroup = { source: Source; result?: Catalogue; error?: string };
type Mode = 'popular' | 'latest' | 'search';

export function ReadPage({ visible }: {
  visible: boolean;
}) {
  const desktopArea = useDesktopArea();
  const [tab, setTab] = React.useState<Tab>('library');
  const [browseTab, setBrowseTab] = React.useState<BrowseTab>('sources');
  const [settingsPage, setSettingsPage] = React.useState<SettingsPage>(null);
  const [globalQuery, setGlobalQuery] = React.useState('');
  const [globalTerm, setGlobalTerm] = React.useState('');
  const [globalResults, setGlobalResults] = React.useState<SearchGroup[]>([]);
  const [globalCompleted, setGlobalCompleted] = React.useState(0);
  const [globalSearching, setGlobalSearching] = React.useState(false);
  const [globalStopping, setGlobalStopping] = React.useState(false);
  const stopSearch = React.useRef(false);
  const pendingManga = React.useRef<Manga | null>(null);
  const [storeFilter, setStoreFilter] = React.useState('');
  const [appliedFilter, setAppliedFilter] = React.useState('');
  const [extensionLanguage, setExtensionLanguage] = React.useState('');
  const [extensionState, setExtensionState] = React.useState<'all' | 'installed' | 'available'>('all');
  const [sourceFilter, setSourceFilter] = React.useState('');
  const [libraryFilter, setLibraryFilter] = React.useState('');
  const [librarySort, setLibrarySort] = React.useState<'title' | 'recent'>('title');
  const [libraryView, setLibraryView] = React.useState<'all' | 'reading'>('all');
  const [readerPreferences, setReaderPreferences] = React.useState(readReaderPreferences);
  const [coverFallback, setCoverFallback] = React.useState(readCoverFallback);
  const content = React.useRef<HTMLDivElement>(null);
  const [busy, setBusy] = React.useState(false);
  const lock = React.useRef(false);
  const [error, setError] = React.useState('');
  const [library, setLibrary] = React.useState<Nodes<Manga> | null>(null);
  const [sources, setSources] = React.useState<Source[]>([]);
  const [source, setSource] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [browse, setBrowse] = React.useState<{ source: string; query: string; mode: Mode; page: number; result: Catalogue } | null>(null);
  const [stores, setStores] = React.useState<Store[]>([]);
  const [repository, setRepository] = React.useState('');
  const [extensions, setExtensions] = React.useState<Nodes<Extension> | null>(null);
  const [offset, setOffset] = React.useState(0);
  const [filter, setFilter] = React.useState('');
  const [details, setDetails] = React.useState<Details | null>(null);
  const [reader, setReader] = React.useState<Reader | null>(null);
  const [expandedSynopsis, setExpandedSynopsis] = React.useState(false);
  const [chapterFilter, setChapterFilter] = React.useState('');
  const [chapterOrder, setChapterOrder] = React.useState<'asc' | 'desc'>('asc');
  const [chapterState, setChapterState] = React.useState<'all' | 'unread' | 'read' | 'bookmarked'>('all');
  const [selectedChapters, setSelectedChapters] = React.useState<number[]>([]);
  const [trackers, setTrackers] = React.useState<Nodes<Tracker> | null>(null);
  const [trackingOpen, setTrackingOpen] = React.useState(false);
  const [extensionFailures, setExtensionFailures] = React.useState<Record<string, string>>({});
  const active = React.useRef(true);

  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await work(); }
    catch (e) { if (active.current) setError(e instanceof Error ? e.message : t({ id: "Reading request failed.", message: "Reading request failed." })); }
    finally { lock.current = false; if (active.current) setBusy(false); }
  }
  async function loadLibrary() { setLibrary(await readRequest<Nodes<Manga>>({ kind: 'library' })); }
  async function loadSources() {
    const result = await readRequest<Nodes<Source>>({ kind: 'sources' });
    const installed = result.nodes.filter((item) => item.id !== '0');
    setSources(installed);
    setSource((old) => installed.some((item) => item.id === old) ? old : '');
  }
  async function loadStores() {
    setStores((await readRequest<Nodes<Store>>({ kind: 'stores' })).nodes);
  }
  async function loadExtensions(next = 0, term = appliedFilter, store = storeFilter, language = extensionLanguage, state = extensionState) {
    await loadStores();
    setExtensions(await readRequest<Nodes<Extension>>({ kind: 'extensions', offset: next, query: term || undefined, store: store || undefined, language: language.trim() || undefined, installed: state === 'all' ? undefined : state === 'installed' }));
    setOffset(next);
    setAppliedFilter(term);
  }
  async function searchAll(available = sources) {
    const term = globalQuery.trim();
    if (!term) return;
    setGlobalTerm(term);
    setGlobalCompleted(0);
    setGlobalResults([]);
    stopSearch.current = false;
    pendingManga.current = null;
    setGlobalStopping(false);
    setGlobalSearching(true);
    for (const [index, item] of available.entries()) {
      if (!active.current || stopSearch.current) break;
      let group: SearchGroup;
      try {
        group = { source: item, result: await readRequest<Catalogue>({ kind: 'catalogue', source: item.id, page: 1, mode: 'search', query: term }) };
      } catch (error) {
        group = { source: item, error: error instanceof Error ? error.message : t({ id: "Search failed.", message: "Search failed." }) };
      }
      if (!active.current) break;
      setGlobalResults((old) => [...old, group]);
      setGlobalCompleted(index + 1);
    }
    setGlobalSearching(false);
    setGlobalStopping(false);
    const selected = pendingManga.current;
    pendingManga.current = null;
    if (selected && active.current) await showManga(selected);
  }
  React.useEffect(() => {
    active.current = true;
    void run(loadLibrary);
    return () => { active.current = false; };
  }, []);
  function switchTab(next: Tab) {
    setReader(null); setDetails(null); setTab(next);
    setError('');
    content.current?.scrollTo(0, 0);
    if (next === 'settings') { setSettingsPage(null); return; }
    if (next === 'browse') { setBrowseTab('sources'); setSource(''); setBrowse(null); }
    void run(next === 'library' ? loadLibrary : loadSources);
  }
  function switchBrowse(next: BrowseTab) {
    setDetails(null); setReader(null); setTab('browse'); setBrowseTab(next); setSource(''); setBrowse(null); setError('');
    content.current?.scrollTo(0, 0);
    if (next === 'extensions') void run(() => loadExtensions());
    else void run(loadSources);
  }
  function openSettings(next: SettingsPage) {
    setSettingsPage(next); setError('');
    if (next === 'reader') setReaderPreferences(readReaderPreferences());
    if (next === 'trackers') void run(async () => setTrackers(await readRequest<Nodes<Tracker>>({ kind: 'trackers' })));
    if (next === 'repositories') void run(loadStores);
  }
  async function catalogue(mode: Mode, page = 1, selection = source, term = query.trim()) {
    if (!selection || (mode === 'search' && !term)) return;
    const result = await readRequest<Catalogue>({ kind: 'catalogue', source: selection, mode, page, query: mode === 'search' ? term : undefined });
    setBrowse({ source: selection, query: term, mode, page, result });
  }
  async function showManga(manga: Manga) {
    setTrackingOpen(false);
    const id = Number(manga.id);
    if (!Number.isSafeInteger(id) || id < 1) throw new Error(t({ id: "Invalid manga identifier.", message: "Invalid manga identifier." }));
    setExpandedSynopsis(false);
    setChapterFilter('');
    setChapterState('all');
    setSelectedChapters([]);
    const data = await readRequest<Details>({ kind: 'manga', id });
    setDetails(data);
    content.current?.scrollTo(0, 0);
    return data;
  }
  async function resumeManga(manga: Manga) {
    const data = await showManga(manga);
    const last = data.chapters.find((chapter) => chapter.id === manga.lastReadChapter?.id);
    const target = last && !last.isRead ? last : last ? neighboringChapter(data.chapters, last, 1) || last : firstChapter(data.chapters);
    if (target) await openChapter(target);
  }
  function firstChapter(chapters: Chapter[]) {
    const groups = chapterGroups(chapters);
    return chapters.find((chapter) => !chapter.isRead && chapter.lastPageRead > 0) || groups.find((group) => group.some((chapter) => !chapter.isRead))?.find((chapter) => !chapter.isRead) || groups[0]?.[0];
  }
  async function openChapter(chapter: Chapter) {
    const result = await readRequest<{ pageCount: number }>({ kind: 'chapter', id: chapter.id });
    if (!Number.isSafeInteger(result.pageCount) || result.pageCount < 1 || result.pageCount > 2000) throw new Error(t({ id: "This chapter has no supported pages.", message: "This chapter has no supported pages." }));
    const index = chapter.isRead || !readReaderPreferences().resume ? 0 : Math.max(0, Math.min(chapter.lastPageRead || 0, result.pageCount - 1));
    setReader({ chapter, count: result.pageCount, index });
  }
  async function changeChapters(ids: number[], patch: { read?: boolean; bookmarked?: boolean }) {
    if (!ids.length) return;
    if (ids.length > 2000) throw new Error(t({ id: "Select at most 2000 chapters.", message: "Select at most 2000 chapters." }));
    const response = await readRequest<{ chapters: Pick<Chapter, 'id' | 'isRead' | 'isBookmarked' | 'lastPageRead'>[] }>({ kind: 'chapter-flags', ids, ...patch });
    const updated = new Map(response.chapters.map((chapter) => [chapter.id, chapter]));
    setDetails((old) => old ? { ...old, chapters: old.chapters.map((chapter) => ({ ...chapter, ...updated.get(chapter.id) })) } : old);
    setSelectedChapters([]);
  }
  async function changeExtension(extension: Extension) {
    setExtensionFailures((old) => { const next = { ...old }; delete next[extension.pkgName]; return next; });
    try {
      await readRequest({ kind: extension.isInstalled ? 'uninstall-extension' : 'install-extension', package: extension.pkgName });
      await loadExtensions(offset);
    } catch (error) {
      setExtensionFailures((old) => ({ ...old, [extension.pkgName]: error instanceof Error ? error.message : t({ id: "Extension operation failed.", message: "Extension operation failed." }) }));
    }
  }
  if (reader && details) return <ChapterReader key={reader.chapter.id} title={details.manga.title} visible={visible} onMusic={desktopArea?.openMusic} onAppSettings={desktopArea?.openSettings}
    chapter={reader.chapter} count={reader.count} start={reader.index} chapters={details.chapters}
    previous={neighboringChapter(details.chapters, reader.chapter, -1)} next={neighboringChapter(details.chapters, reader.chapter, 1)}
    onClose={() => setReader(null)} onChapter={(chapter) => { setReader(null); void run(() => openChapter(chapter)); }}
    onSaved={(index, finished) => setDetails((old) => old ? { ...old, chapters: old.chapters.map((chapter) =>
      chapter.id === reader.chapter.id ? { ...chapter, lastPageRead: index, isRead: chapter.isRead || finished } : chapter) } : old)} />;

  const tabs = [{ id: 'library' as const, label: t({ id: "Library", message: "Library" }), Icon: FiBookOpen }];
  const allLibrary = library?.nodes || [];
  const recent = allLibrary.filter((manga) => manga.lastReadChapter).sort((a, b) => Number(b.lastReadChapter?.lastReadAt || 0) - Number(a.lastReadChapter?.lastReadAt || 0));
  const libraryRows = (libraryView === 'reading' ? recent.filter((manga) => !manga.lastReadChapter?.isRead || !!manga.unreadCount) : allLibrary).filter((manga) => (manga.title + ' ' + (manga.author || '')).toLowerCase().includes(libraryFilter.trim().toLowerCase())).sort((a, b) => librarySort === 'recent' ? Number(b.lastReadChapter?.lastReadAt || 0) - Number(a.lastReadChapter?.lastReadAt || 0) : a.title.localeCompare(b.title));
  const rows = tab === 'library' ? libraryRows : browse?.result.mangas || [];
  const chapterRows = details ? chapterGroups(details.chapters).map((group) => group.filter((chapter) => (chapter.name + ' ' + (chapter.scanlator || '')).toLowerCase().includes(chapterFilter.toLowerCase()) && (chapterState === 'all' || (chapterState === 'bookmarked' ? chapter.isBookmarked : (chapterState === 'read') === chapter.isRead)))).filter((group) => group.length) : [];
  if (chapterOrder === 'desc') chapterRows.reverse();
  const mangaRow = (manga: Manga) => <button className="tsugi-manga-card" key={manga.id} disabled={busy && (!globalSearching || globalStopping)} onClick={() => {
    if (globalSearching) {
      pendingManga.current = manga;
      stopSearch.current = true;
      setGlobalStopping(true);
      return;
    }
    void run(async () => { await showManga(manga); });
  }}><MangaCover manga={manga} fallbackEnabled={visible && tab === 'library' && coverFallback} /><span className="tsugi-manga-title">{manga.title}</span>{!!manga.unreadCount && <span className="tsugi-manga-unread" title={t({ id: "Unread chapters", message: "Unread chapters" })}>{manga.unreadCount}</span>}{manga.author && <span className="truncate text-xs text-[--tsugi-muted]">{manga.author}</span>}</button>;
  const mangaGrid = (items: Manga[]) => <div className="tsugi-manga-grid">{items.map(mangaRow)}</div>;
  const settingRow = (label: string, description: string, next: SettingsPage) => <button className="tsugi-read-row" disabled={busy} onClick={() => openSettings(next)}><span><span className="block font-medium">{label}</span><span className="text-sm text-[--tsugi-muted]">{description}</span></span><FiChevronRight aria-hidden /></button>;

  return <main data-page="read" className="tsugi-read-root tsugi-read-workspace">
    <header className="tsugi-read-media-header"><MediaNavigation area="read" disabled={busy} /></header>
    <aside className="tsugi-reading-rail">
      <nav aria-label={t({ id: "Reading sections", message: "Reading sections" })}>
        <span className="tsugi-reading-rail-label"><Trans id="Collection">Collection</Trans></span>
        {tabs.filter(({ id }) => id === 'library').map(({ id, label, Icon }) => <button key={id} aria-current={tab === id ? 'page' : undefined} disabled={busy} onClick={() => switchTab(id)}><Icon aria-hidden />{label}</button>)}
        <span className="tsugi-reading-rail-label"><Trans id="Discover">Discover</Trans></span>
        <button aria-current={tab === 'browse' && browseTab === 'sources' ? 'page' : undefined} disabled={busy} onClick={() => switchBrowse('sources')}><FiCompass aria-hidden /><Trans id="Browse">Browse</Trans></button>
        <button aria-current={tab === 'browse' && browseTab === 'search' ? 'page' : undefined} disabled={busy} onClick={() => switchBrowse('search')}><FiSearch aria-hidden /><Trans id="Global search">Global search</Trans></button>
        <button aria-current={tab === 'browse' && browseTab === 'extensions' ? 'page' : undefined} disabled={busy} onClick={() => switchBrowse('extensions')}><FiGrid aria-hidden /><Trans id="Extensions">Extensions</Trans></button>
        <span className="tsugi-reading-rail-label"><Trans id="Preferences">Preferences</Trans></span>
        <button aria-current={tab === 'settings' ? 'page' : undefined} disabled={busy} onClick={() => switchTab('settings')}><FiSettings aria-hidden /><Trans id="Settings">Settings</Trans></button>
      </nav>
    </aside>
    <div className="tsugi-reading-content" ref={content}>
      <header className="tsugi-reading-header">
        <div><h1>{details ? t({ id: "Series", message: "Series" }) : tab === 'library' ? t({ id: "Library", message: "Library" }) : tab === 'settings' ? t({ id: "Settings", message: "Settings" }) : browseTab === 'search' ? t({ id: "Global search", message: "Global search" }) : browseTab === 'extensions' ? t({ id: "Extensions", message: "Extensions" }) : t({ id: "Browse", message: "Browse" })}</h1>
          {!details && tab === 'library' && <p className="tsugi-library-summary"><Trans id="Saved titles">Saved titles</Trans> <strong>{allLibrary.length}</strong><span aria-hidden="true"> · </span><Trans id="Unread chapters">Unread chapters</Trans> <strong>{allLibrary.reduce((sum, manga) => sum + (manga.unreadCount || 0), 0)}</strong></p>}
        </div>
        <form className="tsugi-reading-global" onSubmit={(event) => { event.preventDefault(); if (!globalQuery.trim() || busy) return; setDetails(null); setTab('browse'); setBrowseTab('search'); void run(async () => { const result = await readRequest<Nodes<Source>>({ kind: 'sources' }); const available = result.nodes.filter((item) => item.id !== '0'); setSources(available); await searchAll(available); }); }}>
          <FiSearch aria-hidden /><input value={globalQuery} onChange={(event) => setGlobalQuery(event.target.value)} maxLength={200} placeholder={t({ id: "Search all installed sources", message: "Search all installed sources" })} aria-label={t({ id: "Global manga search", message: "Global manga search" })} /><button disabled={busy || !globalQuery.trim()} aria-label={t({ id: "Search", message: "Search" })}><FiChevronRight aria-hidden /></button>
        </form>
      </header>
    {busy && <p className="mb-4 text-sm text-[--tsugi-muted]" role="status"><Trans id="Working…">Working…</Trans></p>}
    {error && <div role="alert" className="tsugi-read-error mb-4">{error}</div>}
    {details ? <section>
      <button className="tsugi-read-action mb-6" disabled={busy} onClick={() => { setDetails(null); setError(''); if (tab === 'library') void run(loadLibrary); content.current?.scrollTo(0, 0); }}><FiArrowLeft aria-hidden /><Trans id="Back">Back</Trans></button>
      <div className="tsugi-series-layout">
      <aside className="tsugi-manga-detail">
        <MangaCover manga={details.manga} fallbackEnabled={visible && coverFallback} />
        <div className="min-w-0">
          <h2 className="text-3xl font-semibold tracking-tight">{details.manga.title}</h2>
          {details.manga.author && <p className="mt-2 text-[--tsugi-muted]">{details.manga.author}</p>}
          {details.manga.genre?.length ? <div className="my-3 flex flex-wrap gap-2 text-xs text-[--tsugi-muted]">{details.manga.genre.map((genre) => <span className="tsugi-manga-genre" key={genre}>{genre}</span>)}</div> : null}
          {details.manga.description && <div className="mt-4 max-w-3xl text-sm leading-relaxed">
            <p className="whitespace-pre-wrap">{expandedSynopsis ? cleanSynopsis(details.manga.description) : cleanSynopsis(details.manga.description).slice(0, 650) + (cleanSynopsis(details.manga.description).length > 650 ? '…' : '')}</p>
            {cleanSynopsis(details.manga.description).length > 650 && <button className="tsugi-library-action mt-2" onClick={() => setExpandedSynopsis(!expandedSynopsis)}>{expandedSynopsis ? t({ id: "Show less", message: "Show less" }) : t({ id: "Read more", message: "Read more" })}</button>}
          </div>}
          <div className="tsugi-series-actions my-5 flex flex-wrap gap-3">
            <button className="tsugi-read-action" disabled={busy} onClick={() => void run(async () => { const inLibrary = !details.manga.inLibrary; await readRequest({ kind: 'set-library', id: Number(details.manga.id), inLibrary }); setDetails({ ...details, manga: { ...details.manga, inLibrary } }); })}>{details.manga.inLibrary ? t({ id: "Remove from library", message: "Remove from library" }) : t({ id: "Add to library", message: "Add to library" })}</button>
            {details.chapters.length > 0 && <button className="tsugi-read-action tsugi-series-primary" disabled={busy} onClick={() => void run(() => openChapter(firstChapter(details.chapters)!))}><FiBookOpen aria-hidden /><Trans id="Start or resume reading">Start or resume reading</Trans></button>}
            <button className="tsugi-read-action" aria-expanded={trackingOpen} disabled={busy} onClick={() => setTrackingOpen(!trackingOpen)}><Trans id="Tracking">Tracking</Trans></button>
          </div>
        </div>
      </aside>
      <div className="tsugi-series-chapters">
      {trackingOpen && <MangaTracking key={details.manga.id} mangaId={Number(details.manga.id)} title={details.manga.title} busy={busy} run={run} openAccounts={() => { switchTab('settings'); openSettings('trackers'); }} />}
      <div className="tsugi-reading-list-header"><h3 className="text-xl font-medium"><Trans id="Chapters">Chapters</Trans> <span className="text-sm text-[--tsugi-muted]">({chapterRows.length})</span></h3><div className="tsugi-reading-filters"><input className="tsugi-read-input" value={chapterFilter} onChange={(event) => setChapterFilter(event.target.value)} placeholder={t({ id: "Find a chapter", message: "Find a chapter" })} aria-label={t({ id: "Find a chapter", message: "Find a chapter" })} /><select className="tsugi-read-input" aria-label={t({ id: "Chapter status", message: "Chapter status" })} value={chapterState} onChange={(event) => setChapterState(event.target.value as typeof chapterState)}><option value="all"><Trans id="All chapters">All chapters</Trans></option><option value="unread"><Trans id="Unread">Unread</Trans></option><option value="read"><Trans id="Read">Read</Trans></option><option value="bookmarked"><Trans id="Bookmarked">Bookmarked</Trans></option></select><button className="tsugi-read-action" onClick={() => setChapterOrder(chapterOrder === 'asc' ? 'desc' : 'asc')}>{chapterOrder === 'asc' ? t({ id: "Oldest first", message: "Oldest first" }) : t({ id: "Newest first", message: "Newest first" })}</button></div></div>
      {!details.chapters.length && <p><Trans id="No chapters found.">No chapters found.</Trans></p>}
      {!chapterRows.length && details.chapters.length > 0 && <p className="py-6 text-[--tsugi-muted]"><Trans id="No chapters match your filters.">No chapters match your filters.</Trans></p>}
      {!!chapterRows.length && <div className="tsugi-chapter-selection">
        <label><input type="checkbox" checked={chapterRows.flat().every((chapter) => selectedChapters.includes(chapter.id))} disabled={busy || chapterRows.flat().length > 2000} onChange={(event) => setSelectedChapters(event.target.checked ? chapterRows.flat().map((chapter) => chapter.id) : [])} /><Trans id="Select visible chapters">Select visible chapters</Trans></label>
        {!!selectedChapters.length && <><span>{selectedChapters.length} <Trans id="selected">selected</Trans></span><button className="tsugi-read-action" disabled={busy} onClick={() => void run(() => changeChapters(selectedChapters, { read: true }))}><Trans id="Mark read">Mark read</Trans></button><button className="tsugi-read-action" disabled={busy} onClick={() => void run(() => changeChapters(selectedChapters, { read: false }))}><Trans id="Mark unread">Mark unread</Trans></button><button className="tsugi-read-action" disabled={busy} onClick={() => void run(() => changeChapters(selectedChapters, { bookmarked: true }))}><Trans id="Bookmark">Bookmark</Trans></button><button className="tsugi-read-action" onClick={() => setSelectedChapters([])}><Trans id="Clear selection">Clear selection</Trans></button></>}
      </div>}
      {chapterRows.map((group) => {
        const first = group[0];
        const chapterRow = (chapter: Chapter) => <div className="tsugi-chapter-list-item" key={chapter.id}>
          <input type="checkbox" checked={selectedChapters.includes(chapter.id)} disabled={busy} aria-label={t({ id: "Select chapter", message: "Select chapter" }) + ' ' + chapter.name} onChange={(event) => setSelectedChapters((ids) => event.target.checked ? [...ids, chapter.id] : ids.filter((id) => id !== chapter.id))} />
          <button className="tsugi-read-row tsugi-chapter-row" disabled={busy} onClick={() => void run(() => openChapter(chapter))}><span><span className="block font-medium">{chapter.name}</span><span className="text-xs text-[--tsugi-muted]">{chapter.scanlator || (group.length > 1 ? t({ id: "Unknown translation group", message: "Unknown translation group" }) : '')}</span></span><span className="text-xs text-[--tsugi-muted]">{chapter.isRead ? t({ id: "Read", message: "Read" }) : chapter.lastPageRead > 0 ? t({ id: "Resume", message: "Resume" }) : t({ id: "Unread", message: "Unread" })}</span></button>
          <button className="tsugi-reader-icon" disabled={busy} aria-pressed={!!chapter.isBookmarked} aria-label={chapter.isBookmarked ? t({ id: "Remove bookmark", message: "Remove bookmark" }) : t({ id: "Bookmark chapter", message: "Bookmark chapter" })} onClick={() => void run(() => changeChapters([chapter.id], { bookmarked: !chapter.isBookmarked }))}><FiBookmark aria-hidden /></button>
        </div>;
        return group.length === 1 ? chapterRow(first) : <details key={first.id} className="tsugi-chapter-versions"><summary><span className="font-medium">{first.name}</span><span className="text-xs text-[--tsugi-muted]">{group.length} <Trans id="versions">versions</Trans></span></summary><div className="pl-5">{group.map(chapterRow)}</div></details>;
      })}
      </div>
      </div>
    </section> : tab === 'settings' ? (
      <section className="tsugi-read-settings">
        <nav className="mb-6 flex flex-wrap items-center gap-2 text-sm text-[--tsugi-muted]" aria-label={t({ id: "Settings path", message: "Settings path" })}>
          <button disabled={busy} onClick={() => openSettings(null)}><Trans id="Settings">Settings</Trans></button>
          {settingsPage === 'reader' || settingsPage === 'trackers' ? <><FiChevronRight aria-hidden /><span>{settingsPage === 'reader' ? t({ id: "Reader", message: "Reader" }) : t({ id: "Trackers", message: "Trackers" })}</span></> : settingsPage && <><FiChevronRight aria-hidden /><button disabled={busy} onClick={() => openSettings('browse')}><Trans id="Browse">Browse</Trans></button></>}
          {(settingsPage === 'sources' || settingsPage === 'repositories') && <><FiChevronRight aria-hidden /><button disabled={busy} onClick={() => openSettings('sources')}><Trans id="Sources">Sources</Trans></button></>}
          {settingsPage === 'repositories' && <><FiChevronRight aria-hidden /><span><Trans id="Extension repositories">Extension repositories</Trans></span></>}
        </nav>
        {settingsPage === null ? <div className="tsugi-reading-settings-index">{settingRow(t({ id: "Browse", message: "Browse" }), t({ id: "Manage manga sources and extensions.", message: "Manage manga sources and extensions." }), 'browse')}{settingRow(t({ id: "Reader", message: "Reader" }), t({ id: "Set the default reading layout, appearance and controls.", message: "Set the default reading layout, appearance and controls." }), 'reader')}{settingRow(t({ id: "Trackers", message: "Trackers" }), t({ id: "See tracking services available in the reading engine.", message: "See tracking services available in the reading engine." }), 'trackers')}</div>
          : settingsPage === 'trackers' ? <section className="tsugi-reading-settings-index">
              <h2 className="text-xl font-semibold"><Trans id="Trackers">Trackers</Trans></h2>
              <p className="text-sm text-[--tsugi-muted]"><Trans id="Connect MyAnimeList or AniList in your browser. Link individual manga from their detail pages. Other providers are listed but not yet enabled for login.">Connect MyAnimeList or AniList in your browser. Link individual manga from their detail pages. Other providers are listed but not yet enabled for login.</Trans></p>
              {trackers?.nodes.map((tracker) => <div key={tracker.id} className="tsugi-read-row"><span><strong className="block">{tracker.name}</strong><small className="text-[--tsugi-muted]">{tracker.isLoggedIn ? t({ id: "Connected in reading engine", message: "Connected in reading engine" }) : t({ id: "Not connected", message: "Not connected" })}</small></span>{[1, 2].includes(tracker.id) ? <button className="tsugi-read-action" disabled={busy} onClick={() => void run(async () => { await readRequest({ kind: tracker.isLoggedIn ? 'tracker-logout' : 'tracker-login', id: tracker.id }); setTrackers(await readRequest<Nodes<Tracker>>({ kind: 'trackers' })); })}>{tracker.isLoggedIn ? t({ id: "Disconnect", message: "Disconnect" }) : t({ id: "Connect", message: "Connect" })}</button> : <small className="text-[--tsugi-muted]"><Trans id="Login not enabled yet">Login not enabled yet</Trans></small>}</div>)}
              {busy && <p className="text-sm text-[--tsugi-muted]" role="status"><Trans id="If connecting an account, complete authorization in your browser and return to Tsugi.">If connecting an account, complete authorization in your browser and return to Tsugi.</Trans></p>}
              <button className="tsugi-read-action self-start" disabled={busy} onClick={() => openSettings('trackers')}><Trans id="Refresh trackers">Refresh trackers</Trans></button>
            </section>
          : settingsPage === 'reader' ? <><ReaderSettings value={readerPreferences} onChange={(value) => { setReaderPreferences(value); saveReaderPreferences(value); }} /><div className="tsugi-reader-settings-content mt-8 border-t border-[--tsugi-line] pt-6"><h3 className="text-lg font-semibold"><Trans id="Library artwork">Library artwork</Trans></h3><label className="tsugi-reader-setting-toggle"><span><strong><Trans id="Find missing library covers">Find missing library covers</Trans></strong><small><Trans id="Search Jikan for the titles of saved manga only when their source cover is missing or fails. Existing covers always take priority.">Search Jikan for the titles of saved manga only when their source cover is missing or fails. Existing covers always take priority.</Trans></small></span><input type="checkbox" checked={coverFallback} onChange={event => { saveCoverFallback(event.target.checked); setCoverFallback(event.target.checked); }} /></label></div></>
          : settingsPage === 'browse' ? settingRow(t({ id: "Sources", message: "Sources" }), t({ id: "Manage extension sources and repositories.", message: "Manage extension sources and repositories." }), 'sources')
          : settingsPage === 'sources' ? settingRow(t({ id: "Extension repositories", message: "Extension repositories" }), t({ id: "Add or remove trusted extension stores.", message: "Add or remove trusted extension stores." }), 'repositories')
          : <>
            <h2 className="text-xl font-semibold"><Trans id="Extension repositories">Extension repositories</Trans></h2>
            <p className="my-3 text-sm text-[--tsugi-muted]"><Trans id="Paste a compatible HTTPS repository index URL. Adding a repository does not install extensions.">Paste a compatible HTTPS repository index URL. Adding a repository does not install extensions.</Trans></p>
            <form className="flex flex-wrap gap-2" onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await readRequest({ kind: 'add-store', index: repository.trim() });
                setRepository('');
                await loadStores();
                await readRequest({ kind: 'refresh-extensions' });
              });
            }}>
              <input className="tsugi-read-input grow" type="url" required value={repository} onChange={(event) => setRepository(event.target.value)} placeholder={t({ id: "HTTPS repository index URL", message: "HTTPS repository index URL" })} aria-label={t({ id: "Repository index URL", message: "Repository index URL" })} />
              <button className="tsugi-read-action" disabled={busy || !repository.trim()}><Trans id="Add repository">Add repository</Trans></button>
            </form>
            {!stores.length && !busy && <p className="py-6 text-[--tsugi-muted]"><Trans id="No repositories added yet.">No repositories added yet.</Trans></p>}
            {stores.map((store) => <div className="tsugi-read-row" key={store.indexUrl}><span className="min-w-0"><span className="block font-medium">{store.name}</span><span className="block break-all text-xs text-[--tsugi-muted]">{store.indexUrl}</span></span><button className="tsugi-read-action" disabled={busy} onClick={() => void run(async () => { await readRequest({ kind: 'remove-store', index: store.indexUrl }); if (storeFilter === store.indexUrl) setStoreFilter(''); await loadStores(); await readRequest({ kind: 'refresh-extensions' }); })}><Trans id="Remove">Remove</Trans></button></div>)}
            <p className="my-4 text-sm text-[--tsugi-muted]"><Trans id="Only install extensions from publishers you trust. Extensions run with your Windows account permissions; their signatures are not independently verified.">Only install extensions from publishers you trust. Extensions run with your Windows account permissions; their signatures are not independently verified.</Trans></p>
            <button className="tsugi-read-action" disabled={busy} onClick={() => switchTab('browse')}><Trans id="Return to Browse">Return to Browse</Trans></button>
          </>}
      </section>
    ) : tab === 'browse' ? (
      <section>
        <nav className="tsugi-read-subnav mb-7" aria-label={t({ id: "Browse sections", message: "Browse sections" })}>
          {[{ id: 'sources' as const, label: t({ id: "Sources", message: "Sources" }), Icon: FiCompass }, { id: 'extensions' as const, label: t({ id: "Extensions", message: "Extensions" }), Icon: FiGrid }, { id: 'search' as const, label: t({ id: "Global search", message: "Global search" }), Icon: FiSearch }].map(({ id, label, Icon }) =>
            <button key={id} disabled={busy} aria-current={browseTab === id ? 'page' : undefined} onClick={() => switchBrowse(id)}><Icon aria-hidden />{label}</button>)}
        </nav>
        {browseTab === 'extensions' ? <section>
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <h2 className="mr-auto text-xl font-semibold"><Trans id="Extensions">Extensions</Trans></h2>
            <button className="tsugi-read-action" disabled={busy} onClick={() => void run(async () => { await readRequest({ kind: 'refresh-extensions' }); await loadExtensions(); })}><Trans id="Refresh extensions">Refresh extensions</Trans></button>
          </div>
          <form className="tsugi-reading-filters mb-4" onSubmit={(event) => { event.preventDefault(); void run(() => loadExtensions(0, filter.trim())); }}>
            <input className="tsugi-read-input grow" value={filter} maxLength={200} onChange={(event) => setFilter(event.target.value)} placeholder={t({ id: "Search all extensions", message: "Search all extensions" })} aria-label={t({ id: "Search extensions", message: "Search extensions" })} />
            <select className="tsugi-read-input" aria-label={t({ id: "Repository", message: "Repository" })} value={storeFilter} disabled={busy} onChange={(event) => { const index = event.target.value; setStoreFilter(index); void run(() => loadExtensions(0, filter.trim(), index)); }}>
              <option value=""><Trans id="All repositories">All repositories</Trans></option>{stores.map((store) => <option key={store.indexUrl} value={store.indexUrl}>{store.name}</option>)}
            </select>
            <select className="tsugi-read-input" aria-label={t({ id: "Extension status", message: "Extension status" })} value={extensionState} disabled={busy} onChange={(event) => { const value = event.target.value as typeof extensionState; setExtensionState(value); void run(() => loadExtensions(0, filter.trim(), storeFilter, extensionLanguage, value)); }}><option value="all"><Trans id="All extensions">All extensions</Trans></option><option value="installed"><Trans id="Installed">Installed</Trans></option><option value="available"><Trans id="Available">Available</Trans></option></select>
            <select className="tsugi-read-input" aria-label={t({ id: "Extension language", message: "Extension language" })} value={extensionLanguage} disabled={busy} onChange={(event) => { const value = event.target.value; setExtensionLanguage(value); void run(() => loadExtensions(0, filter.trim(), storeFilter, value)); }}><option value=""><Trans id="All languages">All languages</Trans></option>{['en','fr','es','de','it','pt','id','ja','ko','zh','ar','ru','all'].map((lang) => <option key={lang} value={lang}>{lang === 'all' ? t({ id: "Multilingual", message: "Multilingual" }) : new Intl.DisplayNames(['en'], { type: 'language' }).of(lang) || lang}</option>)}</select>
            <button className="tsugi-read-action" disabled={busy}><Trans id="Search">Search</Trans></button>
          </form>
          {extensions && <p className="mb-3 text-sm text-[--tsugi-muted]">{extensions.totalCount.toLocaleString()} <Trans id="matching extensions">matching extensions</Trans></p>}
          {!stores.length && !busy && <button className="tsugi-read-action" onClick={() => { setTab('settings'); openSettings('repositories'); }}><Trans id="Add an extension repository">Add an extension repository</Trans></button>}
          {extensions && !extensions.nodes.length && !busy && <p className="py-6 text-[--tsugi-muted]"><Trans id="No matching extensions.">No matching extensions.</Trans></p>}
          {extensions?.nodes.map((extension) => <div key={extension.pkgName} className="tsugi-read-row flex-wrap"><span className="min-w-0"><span className="block font-medium">{extension.name}</span><span className="block break-all text-xs text-[--tsugi-muted]">{extension.lang} · {extension.versionName} · {stores.find((store) => store.indexUrl === extension.storeIndexUrl)?.name || extension.pkgName}</span></span><button className="tsugi-read-action" disabled={busy || (!extension.isInstalled && extension.isObsolete)} onClick={() => void run(() => changeExtension(extension))}>{extension.isInstalled ? t({ id: "Uninstall", message: "Uninstall" }) : t({ id: "Install", message: "Install" })}</button>{extensionFailures[extension.pkgName] && <p className="basis-full text-xs text-[--tsugi-muted]" role="alert">{extensionFailures[extension.pkgName]}</p>}</div>)}
          {!!extensions?.totalCount && <div className="mt-4 flex items-center justify-between gap-3"><button className="tsugi-read-action" disabled={busy || offset === 0} onClick={() => void run(() => loadExtensions(Math.max(0, offset - 100)))}><Trans id="Previous">Previous</Trans></button><span>{offset + extensions.nodes.length} / {extensions.totalCount}</span><button className="tsugi-read-action" disabled={busy || offset + 100 >= extensions.totalCount} onClick={() => void run(() => loadExtensions(offset + 100))}><Trans id="Next">Next</Trans></button></div>}
        </section> : browseTab === 'search' ? <section>
          <form className="mb-5 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void run(() => searchAll()); }}>
            <input className="tsugi-read-input grow" value={globalQuery} maxLength={200} onChange={(event) => setGlobalQuery(event.target.value)} placeholder={t({ id: "Search manga across installed sources", message: "Search manga across installed sources" })} aria-label={t({ id: "Global manga search", message: "Global manga search" })} />
            <button className="tsugi-read-action" disabled={busy || !globalQuery.trim() || !sources.length}><FiSearch aria-hidden /><Trans id="Search">Search</Trans></button>
            {globalSearching && <button type="button" className="tsugi-read-action" disabled={globalStopping} onClick={() => { stopSearch.current = true; setGlobalStopping(true); }}>{globalStopping ? t({ id: "Stopping after current source…", message: "Stopping after current source…" }) : t({ id: "Stop search", message: "Stop search" })}</button>}
          </form>
          {!sources.length && !busy && <button className="tsugi-read-action" onClick={() => switchBrowse('extensions')}><Trans id="Install a source extension">Install a source extension</Trans></button>}
          {globalTerm && <p className="mb-4 text-sm text-[--tsugi-muted]" role="status">{globalTerm} · {globalCompleted} / {sources.length}</p>}
          {globalResults.map((group) => <section key={group.source.id} className="mb-7"><h3 className="border-b border-[--tsugi-line] pb-2 font-semibold">{group.source.displayName || group.source.name}</h3>
            {group.error ? <p className="py-3 text-sm text-[--tsugi-muted]">{group.error}</p> : group.result?.mangas.length ? mangaGrid(group.result.mangas) : <p className="py-3 text-sm text-[--tsugi-muted]"><Trans id="No matches.">No matches.</Trans></p>}
            {group.result?.hasNextPage && <button className="tsugi-read-action mt-2" disabled={busy} onClick={() => { setBrowseTab('sources'); setSource(group.source.id); setQuery(globalTerm); setBrowse({ source: group.source.id, query: globalTerm, mode: 'search', page: 1, result: group.result! }); }}><Trans id="More results">More results</Trans></button>}
          </section>)}
        </section> : !source ? <section>
          <div className="tsugi-reading-list-header"><h2 className="text-xl font-semibold"><Trans id="Installed sources">Installed sources</Trans></h2><input className="tsugi-read-input" placeholder={t({ id: "Filter installed sources", message: "Filter installed sources" })} aria-label={t({ id: "Filter installed sources", message: "Filter installed sources" })} value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} /></div>
          {!sources.length && !busy && <div className="py-6"><p className="mb-3 text-[--tsugi-muted]"><Trans id="No installed sources. Install an extension to start browsing.">No installed sources. Install an extension to start browsing.</Trans></p><button className="tsugi-read-action" onClick={() => switchBrowse('extensions')}><Trans id="Browse extensions">Browse extensions</Trans></button></div>}
          {sources.filter((item) => ((item.displayName || item.name) + ' ' + item.lang).toLowerCase().includes(sourceFilter.toLowerCase())).map((item) => <button key={item.id} className="tsugi-read-row" disabled={busy} onClick={() => { setSource(item.id); setQuery(''); setBrowse(null); void run(() => catalogue('popular', 1, item.id, '')); }}><span className="flex items-center gap-3"><FiGlobe aria-hidden /><span><span className="block font-medium">{item.displayName || item.name}</span><span className="text-sm text-[--tsugi-muted]">{item.lang}</span></span></span><FiChevronRight aria-hidden /></button>)}
        </section> : <section>
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <button className="tsugi-read-action" disabled={busy} onClick={() => { setSource(''); setBrowse(null); }}><FiArrowLeft aria-hidden /><Trans id="Sources">Sources</Trans></button>
            <h2 className="mr-auto text-xl font-semibold">{sources.find((item) => item.id === source)?.displayName || sources.find((item) => item.id === source)?.name}</h2>
            <button className="tsugi-read-action" disabled={busy} onClick={() => void run(() => catalogue('popular'))}><Trans id="Popular">Popular</Trans></button>
            <button className="tsugi-read-action" disabled={busy || !sources.find((item) => item.id === source)?.supportsLatest} onClick={() => void run(() => catalogue('latest'))}><Trans id="Latest">Latest</Trans></button>
          </div>
          <form className="mb-5 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void run(() => catalogue('search')); }}><input className="tsugi-read-input grow" value={query} maxLength={200} onChange={(event) => setQuery(event.target.value)} placeholder={t({ id: "Search manga", message: "Search manga" })} aria-label={t({ id: "Search manga", message: "Search manga" })} /><button className="tsugi-read-action" disabled={busy || !query.trim()}><Trans id="Search">Search</Trans></button></form>
          {mangaGrid(rows)}
          {!rows.length && !busy && <p className="py-6 text-[--tsugi-muted]"><Trans id="No manga found.">No manga found.</Trans></p>}
          {browse && <div className="mt-4 flex items-center justify-between"><button className="tsugi-read-action" disabled={busy || browse.page === 1} onClick={() => void run(() => catalogue(browse.mode, browse.page - 1, browse.source, browse.query))}><Trans id="Previous">Previous</Trans></button><span>{browse.page}</span><button className="tsugi-read-action" disabled={busy || !browse.result.hasNextPage} onClick={() => void run(() => catalogue(browse.mode, browse.page + 1, browse.source, browse.query))}><Trans id="Next">Next</Trans></button></div>}
        </section>}
      </section>
    ) : <section>
      {recent.length > 0 && libraryView === 'all' && !libraryFilter.trim() && <section className="tsugi-reading-resume"><h2><FiClock aria-hidden /><Trans id="Continue reading">Continue reading</Trans></h2><div className="tsugi-reading-resume-list">{recent.slice(0, 6).map((manga) => <button key={manga.id} className="tsugi-reading-resume-card" disabled={busy} onClick={() => void run(() => resumeManga(manga))}><MangaCover manga={manga} fallbackEnabled={visible && coverFallback} /><span><strong>{manga.title}</strong><small>{manga.lastReadChapter?.name}</small><small>{manga.lastReadChapter?.isRead ? t({ id: "Next chapter", message: "Next chapter" }) : t({ id: "Resume reading", message: "Resume reading" })}</small></span><FiChevronRight /></button>)}</div></section>}
      <div className="tsugi-reading-list-header"><nav className="tsugi-read-subnav" aria-label={t({ id: "Library view", message: "Library view" })}><button aria-current={libraryView === 'all' ? 'page' : undefined} onClick={() => setLibraryView('all')}><Trans id="All manga">All manga</Trans></button><button aria-current={libraryView === 'reading' ? 'page' : undefined} onClick={() => setLibraryView('reading')}><Trans id="In progress">In progress</Trans></button></nav><div className="tsugi-reading-filters"><input className="tsugi-read-input" placeholder={t({ id: "Find in library", message: "Find in library" })} aria-label={t({ id: "Find in library", message: "Find in library" })} value={libraryFilter} onChange={(event) => setLibraryFilter(event.target.value)} /><select className="tsugi-read-input" aria-label={t({ id: "Library sort", message: "Library sort" })} value={librarySort} onChange={(event) => setLibrarySort(event.target.value as typeof librarySort)}><option value="title"><Trans id="Title">Title</Trans></option><option value="recent"><Trans id="Recently read">Recently read</Trans></option></select><button className="tsugi-read-action" disabled={busy} onClick={() => void run(loadLibrary)} aria-label={t({ id: "Refresh library", message: "Refresh library" })}><FiRefreshCw aria-hidden /></button></div></div>
      {!allLibrary.length && !busy && <div className="tsugi-reading-empty"><FiBookOpen aria-hidden /><h2><Trans id="Your library is empty">Your library is empty</Trans></h2><p><Trans id="Browse a source to add manga and keep your reading progress in one place.">Browse a source to add manga and keep your reading progress in one place.</Trans></p><div className="tsugi-empty-actions"><button className="tsugi-read-action tsugi-empty-primary" onClick={() => switchTab('browse')}><Trans id="Browse sources">Browse sources</Trans></button><button className="tsugi-read-action" onClick={() => switchBrowse('extensions')}><Trans id="Extensions">Extensions</Trans></button></div></div>}
      {!!allLibrary.length && !rows.length && !busy && <p className="py-8 text-[--tsugi-muted]"><Trans id="No manga match your filters.">No manga match your filters.</Trans></p>}
      {mangaGrid(rows)}
      {library && library.totalCount > library.nodes.length && <p className="mt-3 text-sm text-[--tsugi-muted]"><Trans id="Showing the first 100 library entries.">Showing the first 100 library entries.</Trans></p>}
    </section>}
    </div>
  </main>;
}

function MangaCover({ manga, fallbackEnabled = false }: { manga: Manga; fallbackEnabled?: boolean }) {
  return <SourceMangaCover key={String(manga.id) + ':' + (manga.thumbnailUrl ?? '')} manga={manga} fallbackEnabled={fallbackEnabled} />;
}
function SourceMangaCover({ manga, fallbackEnabled }: { manga: Manga; fallbackEnabled: boolean }) {
  const box = React.useRef<HTMLDivElement>(null);
  const [url, setUrl] = React.useState('');
  const [failed, setFailed] = React.useState(false);
  const [fallback, setFallback] = React.useState('');
  React.useEffect(() => {
    const node = box.current;
    const id = Number(manga.id);
    if (!node || !manga.thumbnailUrl || !Number.isSafeInteger(id) || id < 1) return;
    const controller = new AbortController();
    let objectUrl = '';
    setUrl(''); setFailed(false);
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void readImage({ kind: 'cover', id }, controller.signal).then((image) => {
        if (controller.signal.aborted) { URL.revokeObjectURL(image); return; }
        objectUrl = image; setUrl(image);
      }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    }, { rootMargin: '200px' });
    observer.observe(node);
    return () => { controller.abort(); observer.disconnect(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [manga.id, manga.thumbnailUrl]);
  const eligible = mayLookUpCover(fallbackEnabled, manga.inLibrary, !manga.thumbnailUrl || failed);
  React.useEffect(() => {
    setFallback('');
    const node = box.current;
    if (!node || !eligible) return;
    const controller = new AbortController();
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      void lookupMissingCover({ title: manga.title, author: manga.author, inLibrary: manga.inLibrary }, controller.signal).then(result => {
        if (!controller.signal.aborted && result) setFallback(result);
      });
    });
    observer.observe(node);
    return () => { observer.disconnect(); controller.abort(); };
  }, [eligible, manga.title, manga.author, manga.inLibrary]);
  return <div ref={box} className="tsugi-manga-cover">{url && !failed ? <img src={url} alt="" data-cover-origin="source" onError={() => setFailed(true)} /> : eligible && fallback ? <img src={fallback} alt="" referrerPolicy="no-referrer" data-cover-origin="metadata" onError={() => setFallback('')} /> : <FiBookOpen aria-hidden />}</div>;
}

/** One-time native setup without a console window or manual script. */
export function ReadSetupPage({ openWelcome, onReady }: { openWelcome(): void; onReady(): void }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  async function setup() {
    setBusy(true);
    setError('');
    try {
      await prepareReading();
      onReady();
    } catch (error) {
      setError(error instanceof Error ? error.message : t({ id: "Reading setup failed.", message: "Reading setup failed." }));
      setBusy(false);
    }
  }
  return <main data-page="read-setup" className="tsugi-read-root min-h-dvh px-6 pb-12 pt-12 sm:px-10 lg:px-[5vw]">
    <MediaNavigation area="read" disabled={busy} />
    <h1 className="my-9 text-4xl font-semibold tracking-tight"><Trans id="Read">Read</Trans></h1>
    <section className="max-w-2xl space-y-4">
      <h2 className="text-xl font-semibold"><Trans id="Set up reading">Set up reading</Trans></h2>
      <p className="text-[--tsugi-muted]"><Trans id="Tsugi will download and verify its reading engine once. Internet access and a writable application folder are required. No separate Java or manga server installation is needed.">Tsugi will download and verify its reading engine once. Internet access and a writable application folder are required. No separate Java or manga server installation is needed.</Trans></p>
      {busy && <p role="status" className="text-[--tsugi-muted]"><Trans id="Preparing reading engine… This may take a few minutes.">Preparing reading engine… This may take a few minutes.</Trans></p>}
      {error && <p role="alert" className="tsugi-read-error">{error}</p>}
      <div className="flex flex-wrap gap-3">
        <button className="tsugi-read-action" disabled={busy} onClick={() => void setup()}>{busy ? t({ id: "Preparing…", message: "Preparing…" }) : error ? t({ id: "Retry setup", message: "Retry setup" }) : t({ id: "Set up reading", message: "Set up reading" })}</button>
        <button className="tsugi-read-action" disabled={busy} onClick={openWelcome}><Trans id="Back to all media">Back to all media</Trans></button>
      </div>
    </section>
  </main>;
}
