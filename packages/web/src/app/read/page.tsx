import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { FiArrowLeft, FiBookOpen, FiChevronRight, FiCompass, FiGrid, FiSearch, FiSettings } from 'react-icons/fi';
import { TsugiBrand } from '@/components/tsugi-brand';
import { applyEclipseAppearance } from '@/lib/music/eclipse-appearance';
import { readPlayerTheme } from '@/lib/music/player-theme';
import { isReaderPagePath, prepareReading, readRequest } from '@/lib/hosts/shell/reading';

type Nodes<T> = { nodes: T[]; totalCount: number };
type Source = { id: string; name: string; lang: string; displayName?: string; supportsLatest: boolean };
type Store = { indexUrl: string; name: string };
type Extension = { storeIndexUrl?: string | null; pkgName: string; name: string; lang: string; versionName: string; isInstalled: boolean; isObsolete: boolean };
type Manga = { id: number | string; title: string; author?: string | null; description?: string | null; inLibrary: boolean };
type Chapter = { id: number; name: string; isRead: boolean; lastPageRead: number; pageCount: number };
type Details = { manga: Manga; chapters: Chapter[] };
type Catalogue = { mangas: Manga[]; hasNextPage: boolean };
type Reader = { chapter: Chapter; count: number; index: number; path: string };
type Tab = 'library' | 'browse' | 'settings';
type BrowseTab = 'sources' | 'extensions' | 'search';
type SettingsPage = 'browse' | 'sources' | 'repositories' | null;
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
  const [loaded, setLoaded] = React.useState('');
  const [savedPath, setSavedPath] = React.useState('');
  const saved = React.useRef('');
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
  async function loadExtensions(next = 0, term = appliedFilter, store = storeFilter) {
    await loadStores();
    setExtensions(await readRequest<Nodes<Extension>>({ kind: 'extensions', offset: next, query: term || undefined, store: store || undefined }));
    setOffset(next);
    setAppliedFilter(term);
  }
  async function searchAll() {
    const term = globalQuery.trim();
    if (!term) return;
    setGlobalTerm(term);
    setGlobalCompleted(0);
    setGlobalResults([]);
    stopSearch.current = false;
    setGlobalStopping(false);
    setGlobalSearching(true);
    for (const [index, item] of sources.entries()) {
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
    if (next === 'settings') { setSettingsPage(null); return; }
    if (next === 'browse') { setBrowseTab('sources'); setSource(''); setBrowse(null); }
    void run(next === 'library' ? loadLibrary : loadSources);
  }
  function switchBrowse(next: BrowseTab) {
    setDetails(null); setReader(null); setBrowseTab(next); setSource(''); setBrowse(null);
    if (next === 'extensions') void run(() => loadExtensions());
    else void run(loadSources);
  }
  function openSettings(next: SettingsPage) {
    setSettingsPage(next); setError('');
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
    setDetails(await readRequest<Details>({ kind: 'manga', id }));
  }
  async function showPage(chapter: Chapter, count: number, index: number) {
    const result = await readRequest<{ path: string; index: number }>({ kind: 'page', chapterId: chapter.id, index });
    if (!isReaderPagePath(result.path) || result.index !== index) throw new Error(t`Invalid reading page.`);
    setLoaded(''); setSavedPath(''); saved.current = '';
    setReader({ chapter, count, index, path: result.path });
  }
  async function openChapter(chapter: Chapter) {
    const result = await readRequest<{ pageCount: number }>({ kind: 'chapter', id: chapter.id });
    if (!Number.isSafeInteger(result.pageCount) || result.pageCount < 1) throw new Error(t`This chapter has no pages.`);
    const index = chapter.isRead ? 0 : Math.max(0, Math.min(chapter.lastPageRead || 0, result.pageCount - 1));
    await showPage(chapter, result.pageCount, index);
  }
  async function persist(current: Reader) {
    if (saved.current === current.path) return;
    await readRequest({ kind: 'progress', chapterId: current.chapter.id, index: current.index, finished: current.index + 1 === current.count });
    saved.current = current.path; setSavedPath(current.path);
    setDetails((old) => old ? { ...old, chapters: old.chapters.map((chapter) =>
      chapter.id === current.chapter.id ? { ...chapter, lastPageRead: current.index, isRead: chapter.isRead || current.index + 1 === current.count } : chapter) } : old);
  }
  React.useEffect(() => {
    if (!busy && reader && loaded === reader.path && saved.current !== reader.path && !error) void run(() => persist(reader));
  }, [busy, reader, loaded, error]);
  function turnPage(delta: number) {
    if (!reader || loaded !== reader.path) return;
    const next = reader.index + delta;
    if (next < 0 || next >= reader.count) return;
    void run(async () => { await persist(reader); await showPage(reader.chapter, reader.count, next); });
  }
  const tabs = [{ id: 'library' as const, label: t`Library`, Icon: FiBookOpen }, { id: 'browse' as const, label: t`Browse`, Icon: FiCompass }, { id: 'settings' as const, label: t`Settings`, Icon: FiSettings }];
  const rows = tab === 'library' ? library?.nodes || [] : browse?.result.mangas || [];
  const mangaRow = (manga: Manga) => <button className="tsugi-read-row" key={manga.id} disabled={busy} onClick={() => void run(() => showManga(manga))}><span><span className="block font-medium">{manga.title}</span>{manga.author && <span className="text-sm text-[--tsugi-muted]">{manga.author}</span>}</span><FiChevronRight aria-hidden /></button>;
  const settingRow = (label: string, description: string, next: SettingsPage) => <button className="tsugi-read-row" disabled={busy} onClick={() => openSettings(next)}><span><span className="block font-medium">{label}</span><span className="text-sm text-[--tsugi-muted]">{description}</span></span><FiChevronRight aria-hidden /></button>;

  return <main data-page="read" className="tsugi-read-root min-h-dvh px-6 pb-12 pt-12 sm:px-10 lg:px-[5vw]">
    <header className="flex flex-wrap items-center justify-between gap-5">
      <button className="tsugi-read-action" disabled={busy} onClick={openWelcome} aria-label={t`All media`}><TsugiBrand markOnly /></button>
      <div className="flex gap-3"><button className="tsugi-read-action" disabled={busy} onClick={openVideo}><Trans>Movies & TV</Trans></button><button className="tsugi-read-action" disabled={busy} onClick={openMusic}><Trans>Music</Trans></button></div>
    </header>
    <div className="my-9 flex flex-wrap items-end justify-between gap-4">
      <h1 className="text-4xl font-semibold tracking-tight"><Trans>Read</Trans></h1>
      <nav className="flex flex-wrap gap-2" aria-label={t`Reading sections`}>{tabs.map(({ id, label, Icon }) => <button key={id} className="tsugi-read-action" aria-current={tab === id ? 'page' : undefined} disabled={busy} onClick={() => switchTab(id)}><Icon aria-hidden />{label}</button>)}</nav>
    </div>
    {busy && <p className="mb-4 text-sm text-[--tsugi-muted]" role="status"><Trans>Working…</Trans></p>}
    {error && <div role="alert" className="tsugi-read-error mb-4">{error}</div>}
    {reader ? <section>
      <div className="flex flex-wrap items-center justify-between gap-3 py-3"><button className="tsugi-read-action" disabled={busy} onClick={() => { setReader(null); setError(''); }}><Trans>Chapters</Trans></button><h2 className="text-lg font-medium">{reader.chapter.name}</h2><span>{reader.index + 1} / {reader.count}</span></div>
      <div className="tsugi-read-image"><img key={reader.path} src={reader.path} alt={t`Reading page`} onLoad={() => setLoaded(reader.path)} onError={() => setError(t`Could not display this page.`)} /></div>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
        <button className="tsugi-read-action" disabled={busy || reader.index === 0 || loaded !== reader.path} onClick={() => turnPage(-1)}><Trans>Previous</Trans></button>
        <button className="tsugi-read-action" disabled={busy} onClick={() => void run(() => showPage(reader.chapter, reader.count, reader.index))}><Trans>Reload page</Trans></button>
        {reader.index + 1 < reader.count ? <button className="tsugi-read-action" disabled={busy || loaded !== reader.path} onClick={() => turnPage(1)}><Trans>Next</Trans></button> : <button className="tsugi-read-action" disabled={busy || loaded !== reader.path} onClick={() => void run(async () => { await persist(reader); setReader(null); })}><Trans>Finish chapter</Trans></button>}
      </div>
      {savedPath === reader.path && <p className="mt-3 text-center text-xs text-[--tsugi-muted]"><Trans>Progress saved</Trans></p>}
      {error && loaded === reader.path && <button className="tsugi-read-action mt-3" disabled={busy} onClick={() => void run(() => persist(reader))}><Trans>Retry saving progress</Trans></button>}
    </section> : details ? <section>
      <button className="tsugi-read-action mb-5" disabled={busy} onClick={() => { setDetails(null); setError(''); if (tab === 'library') void run(loadLibrary); }}><Trans>Back</Trans></button>
      <h2 className="text-3xl font-semibold">{details.manga.title}</h2>
      {details.manga.author && <p className="mt-2 text-[--tsugi-muted]">{details.manga.author}</p>}
      {details.manga.description && <p className="mt-4 max-w-3xl whitespace-pre-wrap text-sm leading-relaxed">{details.manga.description}</p>}
      <button className="tsugi-read-action my-5" disabled={busy} onClick={() => void run(async () => { const inLibrary = !details.manga.inLibrary; await readRequest({ kind: 'set-library', id: Number(details.manga.id), inLibrary }); setDetails({ ...details, manga: { ...details.manga, inLibrary } }); })}>{details.manga.inLibrary ? t`Remove from library` : t`Add to library`}</button>
      <h3 className="mb-2 text-lg font-medium"><Trans>Chapters</Trans></h3>
      {!details.chapters.length && <p><Trans>No chapters found.</Trans></p>}
      {details.chapters.map((chapter) => <button className="tsugi-read-row" key={chapter.id} disabled={busy} onClick={() => void run(() => openChapter(chapter))}><span>{chapter.name}</span><span className="text-sm text-[--tsugi-muted]">{chapter.isRead ? t`Read` : chapter.lastPageRead > 0 ? t`Resume` : t`Unread`}</span></button>)}
    </section> : tab === 'settings' ? (
      <section className="tsugi-read-settings">
        <nav className="mb-6 flex flex-wrap items-center gap-2 text-sm text-[--tsugi-muted]" aria-label={t`Settings path`}>
          <button disabled={busy} onClick={() => openSettings(null)}><Trans>Settings</Trans></button>
          {settingsPage && <><FiChevronRight aria-hidden /><button disabled={busy} onClick={() => openSettings('browse')}><Trans>Browse</Trans></button></>}
          {(settingsPage === 'sources' || settingsPage === 'repositories') && <><FiChevronRight aria-hidden /><button disabled={busy} onClick={() => openSettings('sources')}><Trans>Sources</Trans></button></>}
          {settingsPage === 'repositories' && <><FiChevronRight aria-hidden /><span><Trans>Extension repositories</Trans></span></>}
        </nav>
        {settingsPage === null ? settingRow(t`Browse`, t`Manage manga sources and extensions.`, 'browse')
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
          <form className="mb-4 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void run(() => loadExtensions(0, filter.trim())); }}>
            <input className="tsugi-read-input grow" value={filter} maxLength={200} onChange={(event) => setFilter(event.target.value)} placeholder={t`Search all extensions`} aria-label={t`Search extensions`} />
            <select className="tsugi-read-input" aria-label={t`Repository`} value={storeFilter} disabled={busy} onChange={(event) => { const index = event.target.value; setStoreFilter(index); void run(() => loadExtensions(0, filter.trim(), index)); }}>
              <option value=""><Trans>All repositories</Trans></option>{stores.map((store) => <option key={store.indexUrl} value={store.indexUrl}>{store.name}</option>)}
            </select>
            <button className="tsugi-read-action" disabled={busy}><Trans>Search</Trans></button>
          </form>
          {!stores.length && !busy && <button className="tsugi-read-action" onClick={() => { setTab('settings'); openSettings('repositories'); }}><Trans>Add an extension repository</Trans></button>}
          {extensions && !extensions.nodes.length && !busy && <p className="py-6 text-[--tsugi-muted]"><Trans>No matching extensions.</Trans></p>}
          {extensions?.nodes.map((extension) => <div key={extension.pkgName} className="tsugi-read-row"><span className="min-w-0"><span className="block font-medium">{extension.name}</span><span className="block break-all text-xs text-[--tsugi-muted]">{extension.lang} · {extension.versionName} · {stores.find((store) => store.indexUrl === extension.storeIndexUrl)?.name || extension.pkgName}</span></span><button className="tsugi-read-action" disabled={busy || (!extension.isInstalled && extension.isObsolete)} onClick={() => void run(async () => { await readRequest({ kind: extension.isInstalled ? 'uninstall-extension' : 'install-extension', package: extension.pkgName }); await loadExtensions(offset); })}>{extension.isInstalled ? t`Uninstall` : t`Install`}</button></div>)}
          {!!extensions?.totalCount && <div className="mt-4 flex items-center justify-between gap-3"><button className="tsugi-read-action" disabled={busy || offset === 0} onClick={() => void run(() => loadExtensions(Math.max(0, offset - 100)))}><Trans>Previous</Trans></button><span>{offset + extensions.nodes.length} / {extensions.totalCount}</span><button className="tsugi-read-action" disabled={busy || offset + 100 >= extensions.totalCount} onClick={() => void run(() => loadExtensions(offset + 100))}><Trans>Next</Trans></button></div>}
        </section> : browseTab === 'search' ? <section>
          <form className="mb-5 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void run(searchAll); }}>
            <input className="tsugi-read-input grow" value={globalQuery} maxLength={200} onChange={(event) => setGlobalQuery(event.target.value)} placeholder={t`Search manga across installed sources`} aria-label={t`Global manga search`} />
            <button className="tsugi-read-action" disabled={busy || !globalQuery.trim() || !sources.length}><FiSearch aria-hidden /><Trans>Search</Trans></button>
            {globalSearching && <button type="button" className="tsugi-read-action" disabled={globalStopping} onClick={() => { stopSearch.current = true; setGlobalStopping(true); }}>{globalStopping ? t`Stopping after current source…` : t`Stop search`}</button>}
          </form>
          {!sources.length && !busy && <button className="tsugi-read-action" onClick={() => switchBrowse('extensions')}><Trans>Install a source extension</Trans></button>}
          {globalTerm && <p className="mb-4 text-sm text-[--tsugi-muted]" role="status">{globalTerm} · {globalCompleted} / {sources.length}</p>}
          {globalResults.map((group) => <section key={group.source.id} className="mb-7"><h3 className="border-b border-[--tsugi-line] pb-2 font-semibold">{group.source.displayName || group.source.name}</h3>
            {group.error ? <p className="py-3 text-sm text-[--tsugi-muted]">{group.error}</p> : group.result?.mangas.length ? group.result.mangas.map(mangaRow) : <p className="py-3 text-sm text-[--tsugi-muted]"><Trans>No matches.</Trans></p>}
            {group.result?.hasNextPage && <button className="tsugi-read-action mt-2" disabled={busy} onClick={() => { setBrowseTab('sources'); setSource(group.source.id); setQuery(globalTerm); setBrowse({ source: group.source.id, query: globalTerm, mode: 'search', page: 1, result: group.result! }); }}><Trans>More results</Trans></button>}
          </section>)}
        </section> : !source ? <section>
          <h2 className="mb-2 text-xl font-semibold"><Trans>Installed sources</Trans></h2>
          {!sources.length && !busy && <div className="py-6"><p className="mb-3 text-[--tsugi-muted]"><Trans>No installed sources. Install an extension to start browsing.</Trans></p><button className="tsugi-read-action" onClick={() => switchBrowse('extensions')}><Trans>Browse extensions</Trans></button></div>}
          {sources.map((item) => <button key={item.id} className="tsugi-read-row" disabled={busy} onClick={() => { setSource(item.id); setQuery(''); setBrowse(null); void run(() => catalogue('popular', 1, item.id, '')); }}><span><span className="block font-medium">{item.displayName || item.name}</span><span className="text-sm text-[--tsugi-muted]">{item.lang}</span></span><FiChevronRight aria-hidden /></button>)}
        </section> : <section>
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <button className="tsugi-read-action" disabled={busy} onClick={() => { setSource(''); setBrowse(null); }}><FiArrowLeft aria-hidden /><Trans>Sources</Trans></button>
            <h2 className="mr-auto text-xl font-semibold">{sources.find((item) => item.id === source)?.displayName || sources.find((item) => item.id === source)?.name}</h2>
            <button className="tsugi-read-action" disabled={busy} onClick={() => void run(() => catalogue('popular'))}><Trans>Popular</Trans></button>
            <button className="tsugi-read-action" disabled={busy || !sources.find((item) => item.id === source)?.supportsLatest} onClick={() => void run(() => catalogue('latest'))}><Trans>Latest</Trans></button>
          </div>
          <form className="mb-5 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void run(() => catalogue('search')); }}><input className="tsugi-read-input grow" value={query} maxLength={200} onChange={(event) => setQuery(event.target.value)} placeholder={t`Search manga`} aria-label={t`Search manga`} /><button className="tsugi-read-action" disabled={busy || !query.trim()}><Trans>Search</Trans></button></form>
          {rows.map(mangaRow)}
          {!rows.length && !busy && <p className="py-6 text-[--tsugi-muted]"><Trans>No manga found.</Trans></p>}
          {browse && <div className="mt-4 flex items-center justify-between"><button className="tsugi-read-action" disabled={busy || browse.page === 1} onClick={() => void run(() => catalogue(browse.mode, browse.page - 1, browse.source, browse.query))}><Trans>Previous</Trans></button><span>{browse.page}</span><button className="tsugi-read-action" disabled={busy || !browse.result.hasNextPage} onClick={() => void run(() => catalogue(browse.mode, browse.page + 1, browse.source, browse.query))}><Trans>Next</Trans></button></div>}
        </section>}
      </section>
    ) : <section>
      <div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-semibold"><Trans>Library</Trans></h2><button className="tsugi-read-action" disabled={busy} onClick={() => void run(loadLibrary)}><Trans>Refresh</Trans></button></div>
      {!rows.length && !busy && <div className="py-8"><p className="mb-4 text-[--tsugi-muted]"><Trans>Your library is empty. Browse a source to add manga.</Trans></p><button className="tsugi-read-action" onClick={() => switchTab('browse')}><Trans>Browse</Trans></button></div>}
      {rows.map(mangaRow)}
      {library && library.totalCount > library.nodes.length && <p className="mt-3 text-sm text-[--tsugi-muted]"><Trans>Showing the first 100 library entries.</Trans></p>}
    </section>}
  </main>;
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
