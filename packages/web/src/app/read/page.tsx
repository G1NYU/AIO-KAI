import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { FiBookOpen, FiChevronRight, FiCompass, FiGrid } from 'react-icons/fi';
import { TsugiBrand } from '@/components/tsugi-brand';
import { applyEclipseAppearance } from '@/lib/music/eclipse-appearance';
import { readPlayerTheme } from '@/lib/music/player-theme';
import { isReaderPagePath, readRequest } from '@/lib/hosts/shell/reading';

type Nodes<T> = { nodes: T[]; totalCount: number };
type Source = { id: string; name: string; lang: string; displayName?: string; supportsLatest: boolean };
type Store = { indexUrl: string; name: string };
type Extension = { pkgName: string; name: string; lang: string; versionName: string; isInstalled: boolean; isObsolete: boolean };
type Manga = { id: number | string; title: string; author?: string | null; description?: string | null; inLibrary: boolean };
type Chapter = { id: number; name: string; isRead: boolean; lastPageRead: number; pageCount: number };
type Details = { manga: Manga; chapters: Chapter[] };
type Catalogue = { mangas: Manga[]; hasNextPage: boolean };
type Reader = { chapter: Chapter; count: number; index: number; path: string };
type Tab = 'library' | 'browse' | 'extensions';
type Mode = 'popular' | 'latest' | 'search';

export function ReadPage({ openWelcome, openVideo, openMusic }: {
  openWelcome(): void; openVideo(): void; openMusic(): void;
}) {
  const [tab, setTab] = React.useState<Tab>('library');
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
    setSources(result.nodes);
    setSource((old) => result.nodes.some((item) => item.id === old) ? old : result.nodes[0]?.id || '');
  }
  async function loadExtensions(next = 0) {
    setStores((await readRequest<Nodes<Store>>({ kind: 'stores' })).nodes);
    setExtensions(await readRequest<Nodes<Extension>>({ kind: 'extensions', offset: next }));
    setOffset(next);
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
    void run(next === 'library' ? loadLibrary : next === 'browse' ? loadSources : () => loadExtensions());
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
  const tabs = [{ id: 'library' as const, label: t`Library`, Icon: FiBookOpen }, { id: 'browse' as const, label: t`Browse`, Icon: FiCompass }, { id: 'extensions' as const, label: t`Extensions`, Icon: FiGrid }];
  const rows = tab === 'library' ? library?.nodes || [] : browse?.result.mangas || [];
  const visible = extensions?.nodes.filter((item) => (item.name + ' ' + item.pkgName + ' ' + item.lang).toLowerCase().includes(filter.trim().toLowerCase())) || [];

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
    </section> : tab === 'extensions' ? <section className="space-y-6">
      <div>
        <h2 className="mb-3 text-xl font-semibold"><Trans>Repositories</Trans></h2>
        <p className="mb-4 max-w-3xl text-sm text-[--tsugi-muted]"><Trans>Only install extensions from publishers you trust. Extensions execute code with your Windows account permissions. Tsugi does not independently verify their signatures.</Trans></p>
        <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void run(async () => { await readRequest({ kind: 'add-store', index: repository.trim() }); setRepository(''); await loadExtensions(); }); }}>
          <input className="tsugi-read-input grow" type="url" required value={repository} onChange={(event) => setRepository(event.target.value)} placeholder={t`HTTPS repository index URL`} aria-label={t`Repository index URL`} /><button className="tsugi-read-action" disabled={busy || !repository.trim()}><Trans>Add repository</Trans></button>
        </form>
        {stores.map((store) => <div className="tsugi-read-row" key={store.indexUrl}><span className="min-w-0"><span className="block font-medium">{store.name}</span><span className="block break-all text-xs text-[--tsugi-muted]">{store.indexUrl}</span></span><button className="tsugi-read-action" disabled={busy} onClick={() => void run(async () => { await readRequest({ kind: 'remove-store', index: store.indexUrl }); await loadExtensions(); })}><Trans>Remove</Trans></button></div>)}
      </div>
      <div className="flex flex-wrap items-center gap-3"><h2 className="mr-auto text-xl font-semibold"><Trans>Extensions</Trans></h2><input className="tsugi-read-input" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={t`Filter this page`} aria-label={t`Filter extensions`} /><button className="tsugi-read-action" disabled={busy} onClick={() => void run(async () => { await readRequest({ kind: 'refresh-extensions' }); await loadExtensions(); })}><Trans>Refresh extensions</Trans></button></div>
      {!visible.length && <p className="text-[--tsugi-muted]"><Trans>No extensions on this page. Add a repository and refresh.</Trans></p>}
      {visible.map((extension) => <div key={extension.pkgName} className="tsugi-read-row"><span className="min-w-0"><span className="block font-medium">{extension.name}</span><span className="block break-all text-xs text-[--tsugi-muted]">{extension.lang} · {extension.versionName} · {extension.pkgName}</span></span><button className="tsugi-read-action" disabled={busy || (!extension.isInstalled && extension.isObsolete)} onClick={() => void run(async () => { await readRequest({ kind: extension.isInstalled ? 'uninstall-extension' : 'install-extension', package: extension.pkgName }); await loadExtensions(offset); })}>{extension.isInstalled ? t`Uninstall` : t`Install`}</button></div>)}
      <div className="flex items-center justify-between gap-3"><button className="tsugi-read-action" disabled={busy || offset === 0} onClick={() => void run(() => loadExtensions(Math.max(0, offset - 100)))}><Trans>Previous</Trans></button><span>{offset + (extensions?.nodes.length || 0)} / {extensions?.totalCount || 0}</span><button className="tsugi-read-action" disabled={busy || offset + 100 >= (extensions?.totalCount || 0)} onClick={() => void run(() => loadExtensions(offset + 100))}><Trans>Next</Trans></button></div>
    </section> : <section>
      {tab === 'browse' ? <div className="mb-6 space-y-3">
        <div className="flex flex-wrap gap-2"><select className="tsugi-read-input" aria-label={t`Source`} value={source} onChange={(event) => { setSource(event.target.value); setBrowse(null); }} disabled={busy}>{sources.map((item) => <option key={item.id} value={item.id}>{item.displayName || item.name} · {item.lang}</option>)}</select><button className="tsugi-read-action" disabled={busy || !source} onClick={() => void run(() => catalogue('popular'))}><Trans>Popular</Trans></button><button className="tsugi-read-action" disabled={busy || !sources.find((item) => item.id === source)?.supportsLatest} onClick={() => void run(() => catalogue('latest'))}><Trans>Latest</Trans></button></div>
        <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void run(() => catalogue('search')); }}><input className="tsugi-read-input grow" value={query} maxLength={200} onChange={(event) => setQuery(event.target.value)} placeholder={t`Search manga`} aria-label={t`Search manga`} /><button className="tsugi-read-action" disabled={busy || !source || !query.trim()}><Trans>Search</Trans></button></form>
        {!sources.length && <button className="tsugi-read-action" disabled={busy} onClick={() => switchTab('extensions')}><Trans>Install a source extension</Trans></button>}
      </div> : <div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-semibold"><Trans>Library</Trans></h2><button className="tsugi-read-action" disabled={busy} onClick={() => void run(loadLibrary)}><Trans>Refresh</Trans></button></div>}
      {!rows.length && !busy && <p className="py-8 text-[--tsugi-muted]">{tab === 'library' ? t`Your library is empty. Browse a source to add manga.` : t`Select a source and browse or search.`}</p>}
      {rows.map((manga) => <button className="tsugi-read-row" key={manga.id} disabled={busy} onClick={() => void run(() => showManga(manga))}><span><span className="block font-medium">{manga.title}</span>{manga.author && <span className="text-sm text-[--tsugi-muted]">{manga.author}</span>}</span><FiChevronRight aria-hidden /></button>)}
      {tab === 'library' && library && library.totalCount > library.nodes.length && <p className="mt-3 text-sm text-[--tsugi-muted]"><Trans>Showing the first 100 library entries.</Trans></p>}
      {tab === 'browse' && browse && <div className="mt-4 flex items-center justify-between"><button className="tsugi-read-action" disabled={busy || browse.page === 1} onClick={() => void run(() => catalogue(browse.mode, browse.page - 1, browse.source, browse.query))}><Trans>Previous</Trans></button><span>{browse.page}</span><button className="tsugi-read-action" disabled={busy || !browse.result.hasNextPage} onClick={() => void run(() => catalogue(browse.mode, browse.page + 1, browse.source, browse.query))}><Trans>Next</Trans></button></div>}
    </section>}
  </main>;
}

/** Missing setup is an actionable state, never a silently missing destination. */
export function ReadSetupPage({ openWelcome }: { openWelcome(): void }) {
  return <main data-page="read-setup" className="tsugi-read-root min-h-dvh px-6 pb-12 pt-12 sm:px-10 lg:px-[5vw]">
    <button className="tsugi-read-action" onClick={openWelcome} aria-label={t`All media`}><TsugiBrand markOnly /></button>
    <h1 className="my-9 text-4xl font-semibold tracking-tight"><Trans>Read</Trans></h1>
    <section className="max-w-2xl space-y-4">
      <h2 className="text-xl font-semibold"><Trans>Reading setup required</Trans></h2>
      <p className="text-[--tsugi-muted]"><Trans>The reading engine is not ready. Close Tsugi, then run Start Tsugi.cmd from the extracted portable folder. Internet access is required for the first setup.</Trans></p>
      <p className="text-[--tsugi-muted]"><Trans>If setup fails, leave your data folder intact and check the error shown by the launcher.</Trans></p>
      <button className="tsugi-read-action" onClick={openWelcome}><Trans>Back to all media</Trans></button>
    </section>
  </main>;
}
