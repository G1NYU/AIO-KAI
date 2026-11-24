import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { FiArrowLeft, FiBookOpen, FiChevronRight, FiCompass, FiGrid, FiSearch, FiSettings, FiFilm, FiHeadphones, FiGlobe, FiClock, FiBook, FiRefreshCw } from 'react-icons/fi';
import { TsugiBrand } from '@/components/tsugi-brand';
import { applyEclipseAppearance } from '@/lib/music/eclipse-appearance';
import { readPlayerTheme } from '@/lib/music/player-theme';
import { prepareReading, readRequest, readImage } from '@/lib/hosts/shell/reading';
import { ChapterReader } from './chapter-reader';
import { ReaderSettings } from './reader-settings';
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
type SettingsPage = 'browse' | 'sources' | 'repositories' | 'reader' | null;
type SearchGroup = { source: Source; result?: Catalogue; error?: string };
type Mode = 'popular' | 'latest' | 'search';

export function ReadPage({ openWelcome, openVideo, openMusic }: {
  openWelcome(): void; openVideo(): void; openMusic(): void;
}) {
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
  const [storeFilter, setStoreFilter] = React.useState('');
  const [appliedFilter, setAppliedFilter] = React.useState('');
  const [extensionLanguage, setExtensionLanguage] = React.useState('');
  const [extensionState, setExtensionState] = React.useState<'all' | 'installed' | 'available'>('all');
  const [sourceFilter, setSourceFilter] = React.useState('');
  const [libraryFilter, setLibraryFilter] = React.useState('');
  const [librarySort, setLibrarySort] = React.useState<'title' | 'recent'>('title');
  const [libraryView, setLibraryView] = React.useState<'all' | 'reading'>('all');
  const [readerPreferences, setReaderPreferences] = React.useState(readReaderPreferences);
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
  const [chapterState, setChapterState] = React.useState<'all' | 'unread' | 'read'>('all');
  const [extensionFailures, setExtensionFailures] = React.useState<Record<string, string>>({});
  const active = React.useRef(true);

  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await work(); }
    catch (e) { if (active.current) setError(e instanceof Error ? e.message : t`Reading request failed.`); }
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
    setGlobalStopping(false);
    setGlobalSearching(true);
    for (const [index, item] of available.entries()) {
      if (!active.current || stopSearch.current) break;
      let group: SearchGroup;
      try {
        group = { source: item, result: await readRequest<Catalogue>({ kind: 'catalogue', source: item.id, page: 1, mode: 'search', query: term }) };
      } catch (error) {
        group = { source: item, error: error instanceof Error ? error.message : t`Search failed.` };
      }
      if (!active.current) break;
      setGlobalResults((old) => [...old, group]);
      setGlobalCompleted(index + 1);
    }
    setGlobalSearching(false);
    setGlobalStopping(false);
  }
  React.useEffect(() => {
    active.current = true;
    document.documentElement.dataset.tsugiTheme = readPlayerTheme();
    applyEclipseAppearance();
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
    if (next === 'repositories') void run(loadStores);
  }
  async function catalogue(mode: Mode, page = 1, selection = source, term = query.trim()) {
    if (!selection || (mode === 'search' && !term)) return;
    const result = await readRequest<Catalogue>({ kind: 'catalogue', source: selection, mode, page, query: mode === 'search' ? term : undefined });
    setBrowse({ source: selection, query: term, mode, page, result });
  }
  async function showManga(manga: Manga) {
    const id = Number(manga.id);
    if (!Number.isSafeInteger(id) || id < 1) throw new Error(t`Invalid manga identifier.`);
    setExpandedSynopsis(false);
    setChapterFilter('');
    setChapterState('all');
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
    if (!Number.isSafeInteger(result.pageCount) || result.pageCount < 1 || result.pageCount > 2000) throw new Error(t`This chapter has no supported pages.`);
    const index = chapter.isRead || !readReaderPreferences().resume ? 0 : Math.max(0, Math.min(chapter.lastPageRead || 0, result.pageCount - 1));
    setReader({ chapter, count: result.pageCount, index });
  }
  async function changeExtension(extension: Extension) {
    setExtensionFailures((old) => { const next = { ...old }; delete next[extension.pkgName]; return next; });
    try {
      await readRequest({ kind: extension.isInstalled ? 'uninstall-extension' : 'install-extension', package: extension.pkgName });
      await loadExtensions(offset);
    } catch (error) {
      setExtensionFailures((old) => ({ ...old, [extension.pkgName]: error instanceof Error ? error.message : t`Extension operation failed.` }));
    }
  }
  if (reader && details) return <ChapterReader key={reader.chapter.id} title={details.manga.title}
    chapter={reader.chapter} count={reader.count} start={reader.index} chapters={details.chapters}
    previous={neighboringChapter(details.chapters, reader.chapter, -1)} next={neighboringChapter(details.chapters, reader.chapter, 1)}
    onClose={() => setReader(null)} onChapter={(chapter) => { setReader(null); void run(() => openChapter(chapter)); }}
    onSaved={(index, finished) => setDetails((old) => old ? { ...old, chapters: old.chapters.map((chapter) =>
      chapter.id === reader.chapter.id ? { ...chapter, lastPageRead: index, isRead: chapter.isRead || finished } : chapter) } : old)} />;

  const tabs = [{ id: 'library' as const, label: t`Library`, Icon: FiBookOpen }];
  const allLibrary = library?.nodes || [];
  const recent = allLibrary.filter((manga) => manga.lastReadChapter).sort((a, b) => Number(b.lastReadChapter?.lastReadAt || 0) - Number(a.lastReadChapter?.lastReadAt || 0));
  const libraryRows = (libraryView === 'reading' ? recent : allLibrary).filter((manga) => (manga.title + ' ' + (manga.author || '')).toLowerCase().includes(libraryFilter.trim().toLowerCase())).sort((a, b) => librarySort === 'recent' ? Number(b.lastReadChapter?.lastReadAt || 0) - Number(a.lastReadChapter?.lastReadAt || 0) : a.title.localeCompare(b.title));
  const rows = tab === 'library' ? libraryRows : browse?.result.mangas || [];
  const chapterRows = details ? chapterGroups(details.chapters).map((group) => group.filter((chapter) => (chapter.name + ' ' + (chapter.scanlator || '')).toLowerCase().includes(chapterFilter.toLowerCase()) && (chapterState === 'all' || (chapterState === 'read') === chapter.isRead))).filter((group) => group.length) : [];
  if (chapterOrder === 'desc') chapterRows.reverse();
  const mangaRow = (manga: Manga) => <button className="tsugi-manga-card" key={manga.id} disabled={busy} onClick={() => void run(async () => { await showManga(manga); })}><MangaCover manga={manga} /><span className="tsugi-manga-title">{manga.title}</span>{!!manga.unreadCount && <span className="tsugi-manga-unread">{manga.unreadCount}</span>}{manga.author && <span className="truncate text-xs text-[--tsugi-muted]">{manga.author}</span>}</button>;
  const mangaGrid = (items: Manga[]) => <div className="tsugi-manga-grid">{items.map(mangaRow)}</div>;
  const settingRow = (label: string, description: string, next: SettingsPage) => <button className="tsugi-read-row" disabled={busy} onClick={() => openSettings(next)}><span><span className="block font-medium">{label}</span><span className="text-sm text-[--tsugi-muted]">{description}</span></span><FiChevronRight aria-hidden /></button>;

  return <main data-page="read" className="tsugi-read-root tsugi-read-workspace">
    <aside className="tsugi-reading-rail">
      <button className="tsugi-reading-brand" disabled={busy} onClick={openWelcome} aria-label={t`All media`}><TsugiBrand markOnly /><strong>Tsugi</strong></button>
      <nav aria-label={t`Reading sections`}>
        <span className="tsugi-reading-rail-label"><Trans>Collection</Trans></span>
        {tabs.filter(({ id }) => id === 'library').map(({ id, label, Icon }) => <button key={id} aria-current={tab === id ? 'page' : undefined} disabled={busy} onClick={() => switchTab(id)}><Icon aria-hidden />{label}</button>)}
        <span className="tsugi-reading-rail-label"><Trans>Discover</Trans></span>
        <button aria-current={tab === 'browse' && browseTab === 'sources' ? 'page' : undefined} disabled={busy} onClick={() => switchBrowse('sources')}><FiCompass aria-hidden /><Trans>Browse</Trans></button>
        <button aria-current={tab === 'browse' && browseTab === 'search' ? 'page' : undefined} disabled={busy} onClick={() => switchBrowse('search')}><FiSearch aria-hidden /><Trans>Global search</Trans></button>
        <button aria-current={tab === 'browse' && browseTab === 'extensions' ? 'page' : undefined} disabled={busy} onClick={() => switchBrowse('extensions')}><FiGrid aria-hidden /><Trans>Extensions</Trans></button>
        <span className="tsugi-reading-rail-label"><Trans>Preferences</Trans></span>
        <button aria-current={tab === 'settings' ? 'page' : undefined} disabled={busy} onClick={() => switchTab('settings')}><FiSettings aria-hidden /><Trans>Settings</Trans></button>
      </nav>
      <div className="tsugi-reading-rail-bottom"><button disabled={busy} onClick={openVideo}><FiFilm aria-hidden /><Trans>Movies & TV</Trans></button><button disabled={busy} onClick={openMusic}><FiHeadphones aria-hidden /><Trans>Music</Trans></button></div>
    </aside>
    <div className="tsugi-reading-content" ref={content}>
      <header className="tsugi-reading-header">
        <div><p className="tsugi-reading-kicker"><FiBook aria-hidden /><Trans>Read</Trans></p><h1>{details ? t`Series` : tab === 'library' ? t`Library` : tab === 'settings' ? t`Settings` : browseTab === 'search' ? t`Global search` : browseTab === 'extensions' ? t`Extensions` : t`Browse`}</h1></div>
        <form className="tsugi-reading-global" onSubmit={(event) => { event.preventDefault(); if (!globalQuery.trim() || busy) return; setDetails(null); setTab('browse'); setBrowseTab('search'); void run(async () => { const result = await readRequest<Nodes<Source>>({ kind: 'sources' }); const available = result.nodes.filter((item) => item.id !== '0'); setSources(available); await searchAll(available); }); }}>
          <FiSearch aria-hidden /><input value={globalQuery} onChange={(event) => setGlobalQuery(event.target.value)} maxLength={200} placeholder={t`Search all installed sources`} aria-label={t`Global manga search`} /><button disabled={busy || !globalQuery.trim()} aria-label={t`Search`}><FiChevronRight aria-hidden /></button>
        </form>
      </header>
    {busy && <p className="mb-4 text-sm text-[--tsugi-muted]" role="status"><Trans>Working…</Trans></p>}
    {error && <div role="alert" className="tsugi-read-error mb-4">{error}</div>}
    {details ? <section>
      <button className="tsugi-read-action mb-6" disabled={busy} onClick={() => { setDetails(null); setError(''); if (tab === 'library') void run(loadLibrary); content.current?.scrollTo(0, 0); }}><FiArrowLeft aria-hidden /><Trans>Back</Trans></button>
      <div className="tsugi-manga-detail">
        <MangaCover manga={details.manga} />
        <div className="min-w-0">
          <h2 className="text-3xl font-semibold tracking-tight">{details.manga.title}</h2>
          {details.manga.author && <p className="mt-2 text-[--tsugi-muted]">{details.manga.author}</p>}
          {details.manga.genre?.length ? <div className="my-3 flex flex-wrap gap-2 text-xs text-[--tsugi-muted]">{details.manga.genre.map((genre) => <span className="tsugi-manga-genre" key={genre}>{genre}</span>)}</div> : null}
          {details.manga.description && <div className="mt-4 max-w-3xl text-sm leading-relaxed">
            <p className="whitespace-pre-wrap">{expandedSynopsis ? cleanSynopsis(details.manga.description) : cleanSynopsis(details.manga.description).slice(0, 650) + (cleanSynopsis(details.manga.description).length > 650 ? '…' : '')}</p>
            {cleanSynopsis(details.manga.description).length > 650 && <button className="tsugi-library-action mt-2" onClick={() => setExpandedSynopsis(!expandedSynopsis)}>{expandedSynopsis ? t`Show less` : t`Read more`}</button>}
          </div>}
          <div className="my-5 flex flex-wrap gap-3">
            <button className="tsugi-read-action" disabled={busy} onClick={() => void run(async () => { const inLibrary = !details.manga.inLibrary; await readRequest({ kind: 'set-library', id: Number(details.manga.id), inLibrary }); setDetails({ ...details, manga: { ...details.manga, inLibrary } }); })}>{details.manga.inLibrary ? t`Remove from library` : t`Add to library`}</button>
            {details.chapters.length > 0 && <button className="tsugi-read-action" disabled={busy} onClick={() => void run(() => openChapter(firstChapter(details.chapters)!))}><FiBookOpen aria-hidden /><Trans>Start or resume reading</Trans></button>}
          </div>
        </div>
      </div>
      <div className="tsugi-reading-list-header"><h3 className="text-xl font-medium"><Trans>Chapters</Trans> <span className="text-sm text-[--tsugi-muted]">({chapterRows.length})</span></h3><div className="tsugi-reading-filters"><input className="tsugi-read-input" value={chapterFilter} onChange={(event) => setChapterFilter(event.target.value)} placeholder={t`Find a chapter`} aria-label={t`Find a chapter`} /><select className="tsugi-read-input" aria-label={t`Chapter status`} value={chapterState} onChange={(event) => setChapterState(event.target.value as typeof chapterState)}><option value="all"><Trans>All chapters</Trans></option><option value="unread"><Trans>Unread</Trans></option><option value="read"><Trans>Read</Trans></option></select><button className="tsugi-read-action" onClick={() => setChapterOrder(chapterOrder === 'asc' ? 'desc' : 'asc')}>{chapterOrder === 'asc' ? t`Oldest first` : t`Newest first`}</button></div></div>
      {!details.chapters.length && <p><Trans>No chapters found.</Trans></p>}
      {!chapterRows.length && details.chapters.length > 0 && <p className="py-6 text-[--tsugi-muted]"><Trans>No chapters match your filters.</Trans></p>}
      {chapterRows.map((group) => {
        const first = group[0];
        const chapterRow = (chapter: Chapter) => <button className="tsugi-read-row tsugi-chapter-row" key={chapter.id} disabled={busy} onClick={() => void run(() => openChapter(chapter))}><span><span className="block font-medium">{chapter.name}</span><span className="text-xs text-[--tsugi-muted]">{chapter.scanlator || (group.length > 1 ? t`Unknown translation group` : '')}</span></span><span className="text-xs text-[--tsugi-muted]">{chapter.isRead ? t`Read` : chapter.lastPageRead > 0 ? t`Resume` : t`Unread`}</span></button>;
        return group.length === 1 ? chapterRow(first) : <details key={first.id} className="tsugi-chapter-versions"><summary><span className="font-medium">{first.name}</span><span className="text-xs text-[--tsugi-muted]">{group.length} <Trans>versions</Trans></span></summary><div className="pl-5">{group.map(chapterRow)}</div></details>;
      })}
    </section> : tab === 'settings' ? (
      <section className="tsugi-read-settings">
        <nav className="mb-6 flex flex-wrap items-center gap-2 text-sm text-[--tsugi-muted]" aria-label={t`Settings path`}>
          <button disabled={busy} onClick={() => openSettings(null)}><Trans>Settings</Trans></button>
          {settingsPage === 'reader' ? <><FiChevronRight aria-hidden /><span><Trans>Reader</Trans></span></> : settingsPage && <><FiChevronRight aria-hidden /><button disabled={busy} onClick={() => openSettings('browse')}><Trans>Browse</Trans></button></>}
          {(settingsPage === 'sources' || settingsPage === 'repositories') && <><FiChevronRight aria-hidden /><button disabled={busy} onClick={() => openSettings('sources')}><Trans>Sources</Trans></button></>}
          {settingsPage === 'repositories' && <><FiChevronRight aria-hidden /><span><Trans>Extension repositories</Trans></span></>}
        </nav>
        {settingsPage === null ? <div className="tsugi-reading-settings-index">{settingRow(t`Browse`, t`Manage manga sources and extensions.`, 'browse')}{settingRow(t`Reader`, t`Set the default reading layout, appearance and controls.`, 'reader')}</div>
          : settingsPage === 'reader' ? <ReaderSettings value={readerPreferences} onChange={(value) => { setReaderPreferences(value); saveReaderPreferences(value); }} />
          : settingsPage === 'browse' ? settingRow(t`Sources`, t`Manage extension sources and repositories.`, 'sources')
          : settingsPage === 'sources' ? settingRow(t`Extension repositories`, t`Add or remove trusted extension stores.`, 'repositories')
          : <>
            <h2 className="text-xl font-semibold"><Trans>Extension repositories</Trans></h2>
            <p className="my-3 text-sm text-[--tsugi-muted]"><Trans>Paste a compatible HTTPS repository index URL. Adding a repository does not install extensions.</Trans></p>
            <form className="flex flex-wrap gap-2" onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await readRequest({ kind: 'add-store', index: repository.trim() });
                setRepository('');
                await loadStores();
                await readRequest({ kind: 'refresh-extensions' });
              });
            }}>
              <input className="tsugi-read-input grow" type="url" required value={repository} onChange={(event) => setRepository(event.target.value)} placeholder={t`HTTPS repository index URL`} aria-label={t`Repository index URL`} />
              <button className="tsugi-read-action" disabled={busy || !repository.trim()}><Trans>Add repository</Trans></button>
            </form>
            {!stores.length && !busy && <p className="py-6 text-[--tsugi-muted]"><Trans>No repositories added yet.</Trans></p>}
            {stores.map((store) => <div className="tsugi-read-row" key={store.indexUrl}><span className="min-w-0"><span className="block font-medium">{store.name}</span><span className="block break-all text-xs text-[--tsugi-muted]">{store.indexUrl}</span></span><button className="tsugi-read-action" disabled={busy} onClick={() => void run(async () => { await readRequest({ kind: 'remove-store', index: store.indexUrl }); if (storeFilter === store.indexUrl) setStoreFilter(''); await loadStores(); await readRequest({ kind: 'refresh-extensions' }); })}><Trans>Remove</Trans></button></div>)}
            <p className="my-4 text-sm text-[--tsugi-muted]"><Trans>Only install extensions from publishers you trust. Extensions run with your Windows account permissions; their signatures are not independently verified.</Trans></p>
            <button className="tsugi-read-action" disabled={busy} onClick={() => switchTab('browse')}><Trans>Return to Browse</Trans></button>
          </>}
      </section>
    ) : tab === 'browse' ? (
      <section>
        <nav className="tsugi-read-subnav mb-7" aria-label={t`Browse sections`}>
          {[{ id: 'sources' as const, label: t`Sources`, Icon: FiCompass }, { id: 'extensions' as const, label: t`Extensions`, Icon: FiGrid }, { id: 'search' as const, label: t`Global search`, Icon: FiSearch }].map(({ id, label, Icon }) =>
            <button key={id} disabled={busy} aria-current={browseTab === id ? 'page' : undefined} onClick={() => switchBrowse(id)}><Icon aria-hidden />{label}</button>)}
        </nav>
        {browseTab === 'extensions' ? <section>
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <h2 className="mr-auto text-xl font-semibold"><Trans>Extensions</Trans></h2>
            <button className="tsugi-read-action" disabled={busy} onClick={() => void run(async () => { await readRequest({ kind: 'refresh-extensions' }); await loadExtensions(); })}><Trans>Refresh extensions</Trans></button>
          </div>
          <form className="tsugi-reading-filters mb-4" onSubmit={(event) => { event.preventDefault(); void run(() => loadExtensions(0, filter.trim())); }}>
            <input className="tsugi-read-input grow" value={filter} maxLength={200} onChange={(event) => setFilter(event.target.value)} placeholder={t`Search all extensions`} aria-label={t`Search extensions`} />
            <select className="tsugi-read-input" aria-label={t`Repository`} value={storeFilter} disabled={busy} onChange={(event) => { const index = event.target.value; setStoreFilter(index); void run(() => loadExtensions(0, filter.trim(), index)); }}>
              <option value=""><Trans>All repositories</Trans></option>{stores.map((store) => <option key={store.indexUrl} value={store.indexUrl}>{store.name}</option>)}
            </select>
            <select className="tsugi-read-input" aria-label={t`Extension status`} value={extensionState} disabled={busy} onChange={(event) => { const value = event.target.value as typeof extensionState; setExtensionState(value); void run(() => loadExtensions(0, filter.trim(), storeFilter, extensionLanguage, value)); }}><option value="all"><Trans>All extensions</Trans></option><option value="installed"><Trans>Installed</Trans></option><option value="available"><Trans>Available</Trans></option></select>
            <select className="tsugi-read-input" aria-label={t`Extension language`} value={extensionLanguage} disabled={busy} onChange={(event) => { const value = event.target.value; setExtensionLanguage(value); void run(() => loadExtensions(0, filter.trim(), storeFilter, value)); }}><option value=""><Trans>All languages</Trans></option>{['en','fr','es','de','it','pt','id','ja','ko','zh','ar','ru','all'].map((lang) => <option key={lang} value={lang}>{lang === 'all' ? t`Multilingual` : new Intl.DisplayNames(['en'], { type: 'language' }).of(lang) || lang}</option>)}</select>
            <button className="tsugi-read-action" disabled={busy}><Trans>Search</Trans></button>
          </form>
          {extensions && <p className="mb-3 text-sm text-[--tsugi-muted]">{extensions.totalCount.toLocaleString()} <Trans>matching extensions</Trans></p>}
          {!stores.length && !busy && <button className="tsugi-read-action" onClick={() => { setTab('settings'); openSettings('repositories'); }}><Trans>Add an extension repository</Trans></button>}
          {extensions && !extensions.nodes.length && !busy && <p className="py-6 text-[--tsugi-muted]"><Trans>No matching extensions.</Trans></p>}
          {extensions?.nodes.map((extension) => <div key={extension.pkgName} className="tsugi-read-row flex-wrap"><span className="min-w-0"><span className="block font-medium">{extension.name}</span><span className="block break-all text-xs text-[--tsugi-muted]">{extension.lang} · {extension.versionName} · {stores.find((store) => store.indexUrl === extension.storeIndexUrl)?.name || extension.pkgName}</span></span><button className="tsugi-read-action" disabled={busy || (!extension.isInstalled && extension.isObsolete)} onClick={() => void run(() => changeExtension(extension))}>{extension.isInstalled ? t`Uninstall` : t`Install`}</button>{extensionFailures[extension.pkgName] && <p className="basis-full text-xs text-[--tsugi-muted]" role="alert">{extensionFailures[extension.pkgName]}</p>}</div>)}
          {!!extensions?.totalCount && <div className="mt-4 flex items-center justify-between gap-3"><button className="tsugi-read-action" disabled={busy || offset === 0} onClick={() => void run(() => loadExtensions(Math.max(0, offset - 100)))}><Trans>Previous</Trans></button><span>{offset + extensions.nodes.length} / {extensions.totalCount}</span><button className="tsugi-read-action" disabled={busy || offset + 100 >= extensions.totalCount} onClick={() => void run(() => loadExtensions(offset + 100))}><Trans>Next</Trans></button></div>}
        </section> : browseTab === 'search' ? <section>
          <form className="mb-5 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void run(() => searchAll()); }}>
            <input className="tsugi-read-input grow" value={globalQuery} maxLength={200} onChange={(event) => setGlobalQuery(event.target.value)} placeholder={t`Search manga across installed sources`} aria-label={t`Global manga search`} />
            <button className="tsugi-read-action" disabled={busy || !globalQuery.trim() || !sources.length}><FiSearch aria-hidden /><Trans>Search</Trans></button>
            {globalSearching && <button type="button" className="tsugi-read-action" disabled={globalStopping} onClick={() => { stopSearch.current = true; setGlobalStopping(true); }}>{globalStopping ? t`Stopping after current source…` : t`Stop search`}</button>}
          </form>
          {!sources.length && !busy && <button className="tsugi-read-action" onClick={() => switchBrowse('extensions')}><Trans>Install a source extension</Trans></button>}
          {globalTerm && <p className="mb-4 text-sm text-[--tsugi-muted]" role="status">{globalTerm} · {globalCompleted} / {sources.length}</p>}
          {globalResults.map((group) => <section key={group.source.id} className="mb-7"><h3 className="border-b border-[--tsugi-line] pb-2 font-semibold">{group.source.displayName || group.source.name}</h3>
            {group.error ? <p className="py-3 text-sm text-[--tsugi-muted]">{group.error}</p> : group.result?.mangas.length ? mangaGrid(group.result.mangas) : <p className="py-3 text-sm text-[--tsugi-muted]"><Trans>No matches.</Trans></p>}
            {group.result?.hasNextPage && <button className="tsugi-read-action mt-2" disabled={busy} onClick={() => { setBrowseTab('sources'); setSource(group.source.id); setQuery(globalTerm); setBrowse({ source: group.source.id, query: globalTerm, mode: 'search', page: 1, result: group.result! }); }}><Trans>More results</Trans></button>}
          </section>)}
        </section> : !source ? <section>
          <div className="tsugi-reading-list-header"><h2 className="text-xl font-semibold"><Trans>Installed sources</Trans></h2><input className="tsugi-read-input" placeholder={t`Filter installed sources`} aria-label={t`Filter installed sources`} value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} /></div>
          {!sources.length && !busy && <div className="py-6"><p className="mb-3 text-[--tsugi-muted]"><Trans>No installed sources. Install an extension to start browsing.</Trans></p><button className="tsugi-read-action" onClick={() => switchBrowse('extensions')}><Trans>Browse extensions</Trans></button></div>}
          {sources.filter((item) => ((item.displayName || item.name) + ' ' + item.lang).toLowerCase().includes(sourceFilter.toLowerCase())).map((item) => <button key={item.id} className="tsugi-read-row" disabled={busy} onClick={() => { setSource(item.id); setQuery(''); setBrowse(null); void run(() => catalogue('popular', 1, item.id, '')); }}><span className="flex items-center gap-3"><FiGlobe aria-hidden /><span><span className="block font-medium">{item.displayName || item.name}</span><span className="text-sm text-[--tsugi-muted]">{item.lang}</span></span></span><FiChevronRight aria-hidden /></button>)}
        </section> : <section>
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <button className="tsugi-read-action" disabled={busy} onClick={() => { setSource(''); setBrowse(null); }}><FiArrowLeft aria-hidden /><Trans>Sources</Trans></button>
            <h2 className="mr-auto text-xl font-semibold">{sources.find((item) => item.id === source)?.displayName || sources.find((item) => item.id === source)?.name}</h2>
            <button className="tsugi-read-action" disabled={busy} onClick={() => void run(() => catalogue('popular'))}><Trans>Popular</Trans></button>
            <button className="tsugi-read-action" disabled={busy || !sources.find((item) => item.id === source)?.supportsLatest} onClick={() => void run(() => catalogue('latest'))}><Trans>Latest</Trans></button>
          </div>
          <form className="mb-5 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void run(() => catalogue('search')); }}><input className="tsugi-read-input grow" value={query} maxLength={200} onChange={(event) => setQuery(event.target.value)} placeholder={t`Search manga`} aria-label={t`Search manga`} /><button className="tsugi-read-action" disabled={busy || !query.trim()}><Trans>Search</Trans></button></form>
          {mangaGrid(rows)}
          {!rows.length && !busy && <p className="py-6 text-[--tsugi-muted]"><Trans>No manga found.</Trans></p>}
          {browse && <div className="mt-4 flex items-center justify-between"><button className="tsugi-read-action" disabled={busy || browse.page === 1} onClick={() => void run(() => catalogue(browse.mode, browse.page - 1, browse.source, browse.query))}><Trans>Previous</Trans></button><span>{browse.page}</span><button className="tsugi-read-action" disabled={busy || !browse.result.hasNextPage} onClick={() => void run(() => catalogue(browse.mode, browse.page + 1, browse.source, browse.query))}><Trans>Next</Trans></button></div>}
        </section>}
      </section>
    ) : <section>
      {recent.length > 0 && libraryView === 'all' && !libraryFilter.trim() && <section className="tsugi-reading-resume"><h2><FiClock aria-hidden /><Trans>Continue reading</Trans></h2><div className="tsugi-reading-resume-list">{recent.slice(0, 6).map((manga) => <button key={manga.id} className="tsugi-reading-resume-card" disabled={busy} onClick={() => void run(() => resumeManga(manga))}><MangaCover manga={manga} /><span><strong>{manga.title}</strong><small>{manga.lastReadChapter?.name}</small><small>{manga.lastReadChapter?.isRead ? t`Next chapter` : t`Resume reading`}</small></span><FiChevronRight /></button>)}</div></section>}
      <div className="tsugi-reading-list-header"><nav className="tsugi-read-subnav" aria-label={t`Library view`}><button aria-current={libraryView === 'all' ? 'page' : undefined} onClick={() => setLibraryView('all')}><Trans>All manga</Trans></button><button aria-current={libraryView === 'reading' ? 'page' : undefined} onClick={() => setLibraryView('reading')}><Trans>In progress</Trans></button></nav><div className="tsugi-reading-filters"><input className="tsugi-read-input" placeholder={t`Find in library`} aria-label={t`Find in library`} value={libraryFilter} onChange={(event) => setLibraryFilter(event.target.value)} /><select className="tsugi-read-input" aria-label={t`Library sort`} value={librarySort} onChange={(event) => setLibrarySort(event.target.value as typeof librarySort)}><option value="title"><Trans>Title</Trans></option><option value="recent"><Trans>Recently read</Trans></option></select><button className="tsugi-read-action" disabled={busy} onClick={() => void run(loadLibrary)} aria-label={t`Refresh library`}><FiRefreshCw aria-hidden /></button></div></div>
      {!allLibrary.length && !busy && <div className="tsugi-reading-empty"><FiBookOpen aria-hidden /><h2><Trans>Your library is empty</Trans></h2><p><Trans>Browse a source to add manga and keep your reading progress in one place.</Trans></p><button className="tsugi-read-action" onClick={() => switchTab('browse')}><Trans>Browse sources</Trans></button></div>}
      {!!allLibrary.length && !rows.length && !busy && <p className="py-8 text-[--tsugi-muted]"><Trans>No manga match your filters.</Trans></p>}
      {mangaGrid(rows)}
      {library && library.totalCount > library.nodes.length && <p className="mt-3 text-sm text-[--tsugi-muted]"><Trans>Showing the first 100 library entries.</Trans></p>}
    </section>}
    </div>
  </main>;
}

function MangaCover({ manga }: { manga: Manga }) {
  const box = React.useRef<HTMLDivElement>(null);
  const [url, setUrl] = React.useState('');
  const [failed, setFailed] = React.useState(false);
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
  return <div ref={box} className="tsugi-manga-cover">{url && !failed ? <img src={url} alt="" onError={() => setFailed(true)} /> : <FiBookOpen aria-hidden />}</div>;
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
      setError(error instanceof Error ? error.message : t`Reading setup failed.`);
      setBusy(false);
    }
  }
  return <main data-page="read-setup" className="tsugi-read-root min-h-dvh px-6 pb-12 pt-12 sm:px-10 lg:px-[5vw]">
    <button className="tsugi-read-action" disabled={busy} onClick={openWelcome} aria-label={t`All media`}><TsugiBrand markOnly /></button>
    <h1 className="my-9 text-4xl font-semibold tracking-tight"><Trans>Read</Trans></h1>
    <section className="max-w-2xl space-y-4">
      <h2 className="text-xl font-semibold"><Trans>Set up reading</Trans></h2>
      <p className="text-[--tsugi-muted]"><Trans>Tsugi will download and verify its reading engine once. Internet access and a writable application folder are required. No separate Java or manga server installation is needed.</Trans></p>
      {busy && <p role="status" className="text-[--tsugi-muted]"><Trans>Preparing reading engine… This may take a few minutes.</Trans></p>}
      {error && <p role="alert" className="tsugi-read-error">{error}</p>}
      <div className="flex flex-wrap gap-3">
        <button className="tsugi-read-action" disabled={busy} onClick={() => void setup()}>{busy ? t`Preparing…` : error ? t`Retry setup` : t`Set up reading`}</button>
        <button className="tsugi-read-action" disabled={busy} onClick={openWelcome}><Trans>Back to all media</Trans></button>
      </div>
    </section>
  </main>;
}
