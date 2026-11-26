import { BrushBack as FiArrowLeft, BrushBook as FiBookOpen, BrushRight as FiChevronRight, BrushCompass as FiCompass, BrushGrid as FiGrid, BrushSearch as FiSearch, BrushSettings as FiSettings, BrushHistory as FiClock, BrushRefresh as FiRefreshCw, BrushBookmark as FiBookmark, BrushFolder as FiFolder, BrushBell as FiBell, BrushPlus as FiPlus, BrushCheck as FiCheck, BrushMigrate as FiRepeat } from '@/components/tsugi-icons';
import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { MediaNavigation } from '@/components/shell/media-navigation';
import { TsugiRail } from '@/components/shell/tsugi-rail';
import { BrushSliders, BrushDownload } from '@/components/tsugi-icons';
import { useDesktopArea } from '@/lib/desktop-area';
import { closeReadingChapter, prepareReading, readRequest, readImage, type ReadAction } from '@/lib/hosts/shell/reading';
import { ChapterReader } from './chapter-reader';
import { BatchAddWorkspace, MigrationWorkspace } from './collection-transfer';
import { LandscapeSpotlight } from '@/components/landscape-spotlight';
import { LandscapeDecoration } from '@/components/landscape-decoration';
import { lookupMissingCover, mayLookUpCover, readCoverFallback, saveCoverFallback } from './cover-fallback';
import { ReaderSettings } from './reader-settings';
import { ReaderDownloads, DownloadFeedback, useReaderDownloads } from './reader-downloads';
import { MAX_DOWNLOAD_SELECTION } from './reader-downloads-state';
import { LocalComicImport, useLocalComicImport } from './local-comic-import';
import type { LocalComicResult } from './local-comic-import-state';
import { SourceFeed, useSourceFeed } from './source-feed';
import type { FeedManga } from './source-feed-state';
import { normalizedContentWarning, sourceLanguages, sourceMatchesFilters, type ContentFilter, type SourceMetadata as Source } from './source-metadata';
import { SourceSettings } from './source-settings';
import { SourceIcon } from './source-icon';
import { MangaTracking, type Tracker } from './tracking';
import { readReaderPreferences, saveReaderPreferences } from './reader-preferences';
import { chapterGroups, neighboringChapter, cleanSynopsis, type ReadingChapter } from './reader-utils';
import { YomiBanner } from './yomi-banner';
import { BrushHeading } from '@/components/brush-heading';
import './yomi.css';

type Nodes<T> = { nodes: T[]; totalCount: number };
type Store = { indexUrl: string; name: string };
type Extension = { storeIndexUrl?: string | null; pkgName: string; name: string; lang: string; versionName: string; versionCodeLong?: string; isInstalled: boolean; isObsolete: boolean; hasUpdate?: boolean; contentWarning?: string | null };
type ExtensionUpdateResult = { package: string; status: 'updated' | 'rolled-back'; versionName: string; checkpointId: string; error?: string };
type ExtensionUpdateNotice = { package: string; name: string; status: 'updated' | 'rolled-back' | 'failed'; message: string };
function extensionUpdateLabel(name: string) { return t({ id: 'Select update for {name}', message: `Select update for ${name}` }); }
function sourceSettingsLabel(name: string) { return t({ id: 'Settings for {name}', message: `Settings for ${name}` }); }
function contentWarningLabel(value: unknown) {
  switch (normalizedContentWarning(value)) {
    case 'SAFE': return t({ id: 'Not flagged', message: 'Not flagged' });
    case 'MIXED': return t({ id: 'Mixed content', message: 'Mixed content' });
    case 'NSFW': return t({ id: '18+ content', message: '18+ content' });
    default: return t({ id: 'Unknown', message: 'Unknown' });
  }
}
function ContentFilterOptions() {
  return <><option value=""><Trans id="All content">All content</Trans></option>{(['SAFE', 'MIXED', 'NSFW'] as const).map(value => <option key={value} value={value}>{contentWarningLabel(value)}</option>)}</>;
}
function languageLabel(language: string) {
  if (language === 'all') return t({ id: 'Multilingual', message: 'Multilingual' });
  if (!language) return t({ id: 'Unknown language', message: 'Unknown language' });
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(language) || language; }
  catch { return language; }
}
function versionLabel(version: string, installed: boolean) {
  return installed ? t({ id: 'Installed version {version}', message: `Installed version ${version}` }) : t({ id: 'Available version {version}', message: `Available version ${version}` });
}
type Manga = { id: number | string; sourceId?: string; categories?: { nodes: { id: number }[] }; title: string; author?: string | null; artist?: string | null; genre?: string[]; thumbnailUrl?: string | null; description?: string | null; inLibrary: boolean; unreadCount?: number; lastReadChapter?: { id: number; name: string; lastPageRead: number; pageCount: number; isRead: boolean; lastReadAt?: number | string } | null };
type Chapter = ReadingChapter & { isDownloaded?: boolean };
type Details = { manga: Manga; chapters: Chapter[] };
type Catalogue = { mangas: Manga[]; hasNextPage: boolean };
type Reader = { chapter: Chapter; count: number; index: number; session: string };
type Tab = 'library' | 'history' | 'updates' | 'downloads' | 'categories' | 'migrate' | 'batch' | 'browse' | 'settings';
type Category = { id: number; name: string; order: number };
type Activity = Chapter & { manga: Manga; lastReadAt?: number | string; fetchedAt?: number | string; uploadDate?: number | string };
type UpdateStatus = { jobsInfo: { isRunning: boolean; totalJobs: number; finishedJobs: number; skippedCategoriesCount: number; skippedMangasCount: number } };

function activityDate(value?: number | string) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return '';
  const date = new Date(n < 100000000000 ? n * 1000 : n);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
type BrowseTab = 'sources' | 'extensions' | 'search' | 'feed';
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
  const [extensionState, setExtensionState] = React.useState<'all' | 'installed' | 'available' | 'updates' | 'obsolete'>('all');
  const [extensionContent, setExtensionContent] = React.useState<ContentFilter>('');
  const [sourceFilter, setSourceFilter] = React.useState('');
  const [sourceLanguage, setSourceLanguage] = React.useState('');
  const [sourceContent, setSourceContent] = React.useState<ContentFilter>('');
  const [sourcesLoaded, setSourcesLoaded] = React.useState(false);
  const [sourceSettings, setSourceSettings] = React.useState<Source | null>(null);
  const [libraryFilter, setLibraryFilter] = React.useState('');
  const [librarySort, setLibrarySort] = React.useState<'title' | 'recent'>('title');
  const [libraryView, setLibraryView] = React.useState<'all' | 'reading'>('all');
  const [spotlightChoice,setSpotlightChoice] = React.useState<{anchor:string;id:string}|null>(null);
  const [readerPreferences, setReaderPreferences] = React.useState(readReaderPreferences);
  const [coverFallback, setCoverFallback] = React.useState(readCoverFallback);
  const content = React.useRef<HTMLDivElement>(null);
  const [busy, setBusy] = React.useState(false);
  const lock = React.useRef(false);
  const [importRevision, setImportRevision] = React.useState(0);
  const refreshedImport = React.useRef(0);
  const [error, setError] = React.useState('');
  const [library, setLibrary] = React.useState<Nodes<Manga> | null>(null);
  const [categories, setCategories] = React.useState<Category[]>([]);
  const [categoryFilter, setCategoryFilter] = React.useState(0);
  const [categoryId, setCategoryId] = React.useState(0);
  const [categoryName, setCategoryName] = React.useState('');
  const [renameCategory, setRenameCategory] = React.useState('');
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [categorySearch, setCategorySearch] = React.useState('');
  const [history, setHistory] = React.useState<Nodes<Activity> | null>(null);
  const [updates, setUpdates] = React.useState<Nodes<Activity> | null>(null);
  const [updateStatus, setUpdateStatus] = React.useState<UpdateStatus | null>(null);
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
  const [downloadSelectionAttempted, setDownloadSelectionAttempted] = React.useState(false);
  const [localImportOpen, setLocalImportOpen] = React.useState(false);
  const [trackers, setTrackers] = React.useState<Nodes<Tracker> | null>(null);
  const [trackingOpen, setTrackingOpen] = React.useState(false);
  const [extensionFailures, setExtensionFailures] = React.useState<Record<string, string>>({});
  const [selectedExtensions, setSelectedExtensions] = React.useState<string[]>([]);
  const [extensionUpdateNotices, setExtensionUpdateNotices] = React.useState<ExtensionUpdateNotice[]>([]);
  const [updatingExtension, setUpdatingExtension] = React.useState('');
  const [stoppingExtensions, setStoppingExtensions] = React.useState(false);
  const stopExtensionUpdates = React.useRef(false);
  const active = React.useRef(true);
  const openGeneration = React.useRef(0);
  const feed = useSourceFeed(visible && tab === 'browse' && browseTab === 'feed' && !details && !reader);
  const serializedRequest = React.useCallback(async <T,>(action: ReadAction): Promise<T> => {
    if (lock.current) throw new Error(t({ id: 'Another Reader request is still running.', message: 'Another Reader request is still running.' }));
    lock.current = true; setBusy(true); setError('');
    try { return await readRequest<T>(action); }
    finally { lock.current = false; if (active.current) setBusy(false); }
  }, []);
  const downloads = useReaderDownloads(visible && tab === 'downloads' && !details && !reader, serializedRequest);
  const localImport = useLocalComicImport(serializedRequest);

  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await work(); }
    catch (e) { if (active.current) setError(e instanceof Error ? e.message : t({ id: "Reading request failed.", message: "Reading request failed." })); }
    finally { lock.current = false; if (active.current) setBusy(false); }
  }
  async function loadCategories() {
    const next = (await readRequest<Nodes<Category>>({ kind: 'categories' })).nodes.filter(item => item.id > 0).sort((a, b) => a.order - b.order);
    setCategories(next);
    setCategoryFilter(old => next.some(item => item.id === old) ? old : 0);
    setCategoryId(old => next.some(item => item.id === old) ? old : 0);
  }
  async function loadLibrary() {
    const first = await readRequest<Nodes<Manga>>({ kind: 'library' });
    const entries = new Map(first.nodes.map(item => [String(item.id), item]));
    let offset = first.nodes.length;
    while (offset < first.totalCount && offset < 100_000) {
      const page = await readRequest<Nodes<Manga>>({ kind: 'library-page', offset });
      if (!page.nodes.length) break;
      for (const item of page.nodes) entries.set(String(item.id), item);
      offset += page.nodes.length;
    }
    setLibrary({ nodes: [...entries.values()], totalCount: first.totalCount });
    await loadCategories();
  }
  async function loadHistory() { setHistory(await readRequest<Nodes<Activity>>({ kind: 'history' })); }
  async function loadUpdates() {
    setUpdates(await readRequest<Nodes<Activity>>({ kind: 'updates' }));
    setUpdateStatus(await readRequest<UpdateStatus>({ kind: 'library-update-status' }));
  }
  async function saveCategory(id: number | undefined, name: string) {
    const result = await readRequest<{ category: Category }>({ kind: 'save-category', id, name: name.trim() });
    await loadLibrary();
    setCategoryId(result.category.id);
    setRenameCategory(result.category.name);
    setCategoryName('');
    setConfirmDelete(false);
  }
  async function loadSources() {
    setSourcesLoaded(false); setSources([]);
    const result = await readRequest<Nodes<Source> & { complete: boolean }>({ kind: 'source-inventory' });
    if (result.complete !== true) throw new Error(t({ id: 'The installed source list is incomplete. Reload installed sources to try again.', message: 'The installed source list is incomplete. Reload installed sources to try again.' }));
    await loadStores();
    const installed = result.nodes.filter((item) => item.id !== '0');
    setSources(installed);
    setSourcesLoaded(true);
    setSource((old) => installed.some((item) => item.id === old) ? old : '');
  }
  async function loadStores() {
    setStores((await readRequest<Nodes<Store>>({ kind: 'stores' })).nodes);
  }
  async function loadExtensions(next = 0, term = appliedFilter, store = storeFilter, language = extensionLanguage, state = extensionState, content = extensionContent) {
    setExtensions(null); setSelectedExtensions([]);
    await loadStores();
    const result = await readRequest<Nodes<Extension>>({ kind: 'extensions', offset: next, query: term || undefined, store: store || undefined, language: language.trim() || undefined, installed: state === 'all' ? undefined : state !== 'available', updatesOnly: state === 'updates', obsoleteOnly: state === 'obsolete', contentWarning: content || undefined });
    setExtensions(result);
    setSelectedExtensions(previous => previous.filter(pkg => result.nodes.some(extension => extension.pkgName === pkg && extension.isInstalled && extension.hasUpdate && !extension.isObsolete)));
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
    return () => { active.current = false; openGeneration.current++; };
  }, []);
  React.useEffect(() => {
    const imported = () => setImportRevision(value => value + 1);
    window.addEventListener('tsugi-reader-imported', imported);
    return () => window.removeEventListener('tsugi-reader-imported', imported);
  }, []);
  React.useEffect(() => {
    // Settings can complete an import while this page remains mounted. Wait
    // for its current request to finish, then replace the cached collections.
    if (busy || lock.current || importRevision <= refreshedImport.current) return;
    refreshedImport.current = importRevision;
    void run(async () => {
      await loadLibrary();
      await loadHistory();
      await loadUpdates();
    });
  }, [importRevision, busy]);
  // Poll only while the update feed is visible; the native updater owns its
  // queue and continues safely when the user navigates away.
  React.useEffect(() => {
    if (!visible || tab !== 'updates' || details || reader || busy || !updateStatus?.jobsInfo.isRunning) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const status = await readRequest<UpdateStatus>({ kind: 'library-update-status' });
        if (cancelled) return;
        if (!status.jobsInfo.isRunning) {
          const result = await readRequest<Nodes<Activity>>({ kind: 'updates' });
          if (cancelled) return;
          setUpdates(result);
        }
        setUpdateStatus(status);
      } catch (reason) {
        if (!cancelled) {
          setUpdateStatus(null);
          setError(reason instanceof Error ? reason.message : t({ id: "Could not check update status.", message: "Could not check update status." }));
        }
      }
    }, 4000);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [visible, tab, details, reader, busy, updateStatus]);
  function switchTab(next: Tab) {
    setReader(null); setDetails(null); setTab(next);
    setError('');
    content.current?.scrollTo(0, 0);
    if (next === 'settings') { setSettingsPage(null); return; }
    if (next === 'downloads') return;
    if (next === 'browse') { setBrowseTab('sources'); setSource(''); setBrowse(null); }
    void run(next === 'migrate' || next === 'batch' ? async () => { await loadLibrary(); await loadSources(); } : next === 'library' || next === 'categories' ? loadLibrary : next === 'history' ? loadHistory : next === 'updates' ? loadUpdates : loadSources);
  }
  function switchBrowse(next: BrowseTab) {
    setDetails(null); setReader(null); setTab('browse'); setBrowseTab(next); setSource(''); setBrowse(null); setError('');
    content.current?.scrollTo(0, 0);
    if (next === 'extensions') void run(() => loadExtensions());
    else if (next !== 'feed') void run(loadSources);
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
  async function showManga(manga: Manga, cached = false) {
    setTrackingOpen(false);
    const id = Number(manga.id);
    if (!Number.isSafeInteger(id) || id < 1) throw new Error(t({ id: "Invalid manga identifier.", message: "Invalid manga identifier." }));
    setExpandedSynopsis(false);
    setChapterFilter('');
    setChapterState('all');
    setSelectedChapters([]);
    setDownloadSelectionAttempted(false);
    const data = await readRequest<Details>({ kind: cached ? 'cached-manga' : 'manga', id });
    setDetails(data);
    content.current?.scrollTo(0, 0);
    return data;
  }
  async function openActivity(entry: Activity) {
    const data = await showManga(entry.manga, true);
    const target = data.chapters.find(chapter => chapter.id === entry.id);
    if (!target) throw new Error(t({ id: "This saved chapter is no longer available.", message: "This saved chapter is no longer available." }));
    await openChapter(target);
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
    if (!active.current) return;
    const generation = ++openGeneration.current;
    const result = await readRequest<{ pageCount: number; session: string }>({ kind: 'chapter', id: chapter.id });
    const validSession = typeof result.session === 'string' && /^chapter-[1-9]\d{0,19}$/.test(result.session);
    const validPages = Number.isSafeInteger(result.pageCount) && result.pageCount >= 1 && result.pageCount <= 2000;
    // A native deep link may unmount Read while the chapter opens. No
    // ChapterReader will exist to release that late capability in this case.
    if (!active.current || generation !== openGeneration.current || !validSession || !validPages) {
      if (validSession) await closeReadingChapter(chapter.id, result.session);
      if (!active.current || generation !== openGeneration.current) return;
      throw new Error(t({ id: "This chapter has no supported pages.", message: "This chapter has no supported pages." }));
    }
    const index = chapter.isRead || !readReaderPreferences().resume ? 0 : Math.max(0, Math.min(chapter.lastPageRead || 0, result.pageCount - 1));
    setReader({ chapter, count: result.pageCount, index, session: result.session });
  }
  async function changeChapters(ids: number[], patch: { read?: boolean; bookmarked?: boolean }) {
    if (!ids.length) return;
    if (ids.length > 2000) throw new Error(t({ id: "Select at most 2000 chapters.", message: "Select at most 2000 chapters." }));
    const response = await readRequest<{ chapters: Pick<Chapter, 'id' | 'isRead' | 'isBookmarked' | 'lastPageRead'>[] }>({ kind: 'chapter-flags', ids, ...patch });
    const updated = new Map(response.chapters.map((chapter) => [chapter.id, chapter]));
    setDetails((old) => old ? { ...old, chapters: old.chapters.map((chapter) => ({ ...chapter, ...updated.get(chapter.id) })) } : old);
    setSelectedChapters([]);
  }
  async function refreshChapterDownloads(id: number) {
    try {
      const data = await readRequest<Details>({ kind: 'cached-manga', id });
      if (Number(data.manga.id) !== id || !Array.isArray(data.chapters)) throw Error('Invalid cached chapter status.');
      const updated = new Map(data.chapters.map(chapter => [chapter.id, chapter.isDownloaded]));
      setDetails(previous => previous && Number(previous.manga.id) === id ? { ...previous, chapters: previous.chapters.map(chapter => {
        const isDownloaded = updated.get(chapter.id);
        return typeof isDownloaded === 'boolean' ? { ...chapter, isDownloaded } : chapter;
      }) } : previous);
    } catch { throw new Error(t({ id: 'Chapter download status could not be refreshed. Open Downloads to check the queue.', message: 'Chapter download status could not be refreshed. Open Downloads to check the queue.' })); }
  }
  async function downloadSelected() {
    if (!details || busy || downloads.snapshot.busy || (downloads.snapshot.notice === 'uncertain' && downloads.snapshot.error) || !selectedChapters.length || selectedChapters.length > MAX_DOWNLOAD_SELECTION) return;
    const ids = selectedChapters.filter(id => details.chapters.some(chapter => chapter.id === id && chapter.isDownloaded !== true));
    if (!ids.length) return;
    const mangaId = Number(details.manga.id);
    setDownloadSelectionAttempted(true);
    if (await downloads.controller.change({ kind: 'enqueue-downloads', ids })) setSelectedChapters([]);
    await run(() => refreshChapterDownloads(mangaId));
  }
  function openImportedComic(result: Extract<LocalComicResult, { mangaId: number }>) {
    setLocalImportOpen(false); setTab('library');
    void run(async () => {
      const data = await showManga({ id: result.mangaId, title: result.title, inLibrary: true }, true);
      const chapter = firstChapter(data.chapters);
      if (!chapter) throw new Error(t({ id: 'The local comic has no available chapter yet. Refresh the library or choose the same CBZ again for a fresh review.', message: 'The local comic has no available chapter yet. Refresh the library or choose the same CBZ again for a fresh review.' }));
      await openChapter(chapter);
    });
  }
  async function changeExtension(extension: Extension) {
    setExtensionFailures((old) => { const next = { ...old }; delete next[extension.pkgName]; return next; });
    try {
      await readRequest({ kind: extension.isInstalled ? 'uninstall-extension' : 'install-extension', package: extension.pkgName });
    } catch (error) {
      setExtensionFailures((old) => ({ ...old, [extension.pkgName]: error instanceof Error ? error.message : t({ id: "Extension operation failed.", message: "Extension operation failed." }) }));
      return;
    }
    // A successful mutation can be followed by a failed list refresh. Keep
    // that error visible at page level even after stale rows are cleared.
    await loadExtensions(offset);
  }
  async function updateExtensions(candidates: Extension[]) {
    const batch = candidates.filter(extension => extension.isInstalled && extension.hasUpdate && !extension.isObsolete).slice(0, 100);
    if (!batch.length) return;
    stopExtensionUpdates.current = false; setStoppingExtensions(false); setExtensionUpdateNotices([]);
    try {
      for (const extension of batch) {
        if (stopExtensionUpdates.current || !active.current) break;
        setUpdatingExtension(extension.name);
        setExtensionFailures(previous => { const next = { ...previous }; delete next[extension.pkgName]; return next; });
        try {
          const result = await readRequest<ExtensionUpdateResult>({ kind: 'update-extension', package: extension.pkgName });
          if (result.package !== extension.pkgName || !['updated', 'rolled-back'].includes(result.status)) throw Error(t({ id: "The extension update returned an invalid result. Check the installed version before retrying.", message: "The extension update returned an invalid result. Check the installed version before retrying." }));
          const version = result.versionName;
          const message = result.status === 'updated' ? t({ id: 'Updated to {version}.', message: `Updated to ${version}.` }) : result.error || t({ id: "The update failed. The previous Reader state was restored.", message: "The update failed. The previous Reader state was restored." });
          if (!active.current) break;
          setExtensionUpdateNotices(previous => [...previous, { package: extension.pkgName, name: extension.name, status: result.status, message }]);
          if (result.status === 'rolled-back') {
            setExtensionFailures(previous => ({ ...previous, [extension.pkgName]: message }));
            break;
          }
          setSelectedExtensions(previous => previous.filter(pkg => pkg !== extension.pkgName));
        } catch (reason) {
          if (!active.current) break;
          const message = reason instanceof Error ? reason.message : t({ id: "Extension update failed.", message: "Extension update failed." });
          setExtensionFailures(previous => ({ ...previous, [extension.pkgName]: message }));
          setExtensionUpdateNotices(previous => [...previous, { package: extension.pkgName, name: extension.name, status: 'failed', message }]);
          break;
        }
      }
    } finally {
      if (active.current) {
        setUpdatingExtension(''); setStoppingExtensions(false);
        await loadExtensions(offset);
        await loadSources();
      }
    }
  }
  if (reader && details) return <ChapterReader key={reader.session} title={details.manga.title} visible={visible} onMusic={desktopArea?.openMusic} onAppSettings={desktopArea?.openSettings}
    chapter={reader.chapter} session={reader.session} count={reader.count} start={reader.index} chapters={details.chapters}
    previous={neighboringChapter(details.chapters, reader.chapter, -1)} next={neighboringChapter(details.chapters, reader.chapter, 1)}
    onClose={() => setReader(null)} onChapter={(chapter) => { setReader(null); void run(() => openChapter(chapter)); }}
    onSaved={(index, finished) => setDetails((old) => old ? { ...old, chapters: old.chapters.map((chapter) =>
      chapter.id === reader.chapter.id ? { ...chapter, lastPageRead: index, isRead: chapter.isRead || finished } : chapter) } : old)} />;

  const tabs = [
    { id: 'library' as const, label: t({ id: "Library", message: "Library" }), Icon: FiBookOpen },
    { id: 'history' as const, label: t({ id: "History", message: "History" }), Icon: FiClock },
    { id: 'updates' as const, label: t({ id: "Chapter updates", message: "Chapter updates" }), Icon: FiBell },
    { id: 'downloads' as const, label: t({ id: 'Downloads', message: 'Downloads' }), Icon: BrushDownload },
    { id: 'categories' as const, label: t({ id: "Categories", message: "Categories" }), Icon: FiFolder },
    { id: 'migrate' as const, label: t({ id: "Migrate", message: "Migrate" }), Icon: FiRepeat },
    { id: 'batch' as const, label: t({ id: "Batch Add", message: "Batch Add" }), Icon: FiPlus },
  ];
  const allLibrary = library?.nodes || [];
  const recent = allLibrary.filter((manga) => manga.lastReadChapter).sort((a, b) => Number(b.lastReadChapter?.lastReadAt || 0) - Number(a.lastReadChapter?.lastReadAt || 0));
  const continuing = recent.filter((manga) => !manga.lastReadChapter?.isRead || !!manga.unreadCount);
  const spotlightAnchor = String(continuing[0]?.id ?? '') + ':' + String(continuing[0]?.lastReadChapter?.lastReadAt ?? '');
  const featured = tab === 'library' ? (spotlightChoice?.anchor === spotlightAnchor ? continuing.find(manga=>String(manga.id)===spotlightChoice.id) : undefined) ?? continuing[0] : undefined;
  const categoryContains = (manga: Manga, id: number) => !!manga.categories?.nodes.some(item => item.id === id);
  const selectedCategory = categories.find(item => item.id === categoryId);
  const libraryRows = (libraryView === 'reading' ? continuing : allLibrary).filter(manga => !categoryFilter || categoryContains(manga, categoryFilter)).filter((manga) => (manga.title + ' ' + (manga.author || '')).toLowerCase().includes(libraryFilter.trim().toLowerCase())).sort((a, b) => librarySort === 'recent' ? Number(b.lastReadChapter?.lastReadAt || 0) - Number(a.lastReadChapter?.lastReadAt || 0) : a.title.localeCompare(b.title));
  const rows = tab === 'library' ? libraryRows : browse?.result.mangas || [];
  const matchingSources = sources.filter(item => sourceMatchesFilters(item, sourceFilter, sourceLanguage, sourceContent));
  const extensionLanguages = sourceLanguages([
    ...['en', 'fr', 'es', 'es-419', 'de', 'it', 'pt', 'pt-BR', 'id', 'ja', 'ko', 'zh', 'zh-Hans', 'zh-Hant', 'ar', 'ru', 'nl', 'pl', 'tr', 'uk', 'vi', 'th', 'all', extensionLanguage].map(lang => ({ lang })),
    ...sources, ...(extensions?.nodes || []),
  ]);
  const pageUpdateCount = extensions?.nodes.filter(item => item.isInstalled && item.hasUpdate && !item.isObsolete).length || 0;
  const chapterRows = details ? chapterGroups(details.chapters).map((group) => group.filter((chapter) => (chapter.name + ' ' + (chapter.scanlator || '')).toLowerCase().includes(chapterFilter.toLowerCase()) && (chapterState === 'all' || (chapterState === 'bookmarked' ? chapter.isBookmarked : (chapterState === 'read') === chapter.isRead)))).filter((group) => group.length) : [];
  if (chapterOrder === 'desc') chapterRows.reverse();
  const mangaRow = (manga: Manga, select?: (manga: Manga) => void) => <button className="tsugi-manga-card" key={manga.id} disabled={busy && (!globalSearching || globalStopping)} onClick={() => {
    if (select) { select(manga); return; }
    if (globalSearching) {
      pendingManga.current = manga;
      stopSearch.current = true;
      setGlobalStopping(true);
      return;
    }
    void run(async () => { await showManga(manga); });
  }}><MangaCover manga={manga} fallbackEnabled={visible && tab === 'library' && coverFallback} /><span className="tsugi-manga-title">{manga.title}</span>{!!manga.unreadCount && <span className="tsugi-manga-unread" title={t({ id: "Unread chapters", message: "Unread chapters" })}>{manga.unreadCount}</span>}{manga.author && <span className="truncate text-xs text-[--tsugi-muted]">{manga.author}</span>}{tab === 'library' && manga.lastReadChapter && <span className="yomi-card-progress"><span>{manga.lastReadChapter.name}</span>{manga.lastReadChapter.pageCount > 0 && <progress value={manga.lastReadChapter.isRead ? manga.lastReadChapter.pageCount : Math.min(manga.lastReadChapter.lastPageRead + 1, manga.lastReadChapter.pageCount)} max={manga.lastReadChapter.pageCount} aria-label={t({ id: "Chapter progress", message: "Chapter progress" })} />}</span>}</button>;
  const mangaGrid = (items: Manga[], select?: (manga: Manga) => void) => <div className="tsugi-manga-grid">{items.map(manga => mangaRow(manga, select))}</div>;
  const settingRow = (label: string, description: string, next: SettingsPage) => <button className="tsugi-read-row" disabled={busy} onClick={() => openSettings(next)}><span><span className="block font-medium">{label}</span><span className="text-sm text-[--tsugi-muted]">{description}</span></span><FiChevronRight aria-hidden /></button>;

  return <main data-page="read" data-read-view={details ? 'series' : tab === 'browse' ? browseTab : tab} className="tsugi-read-root tsugi-read-workspace yomi-workspace">
    <TsugiRail area="read" disabled={busy} className="tsugi-reading-rail" mediaClassName="tsugi-read-media-header">
      <nav className="tsugi-rail-local" aria-label={t({ id: "Reading sections", message: "Reading sections" })}>
        {desktopArea?.openBooks && <><span className="tsugi-reading-rail-label"><Trans id="Read">Read</Trans></span><button type="button" disabled={busy} onClick={desktopArea.openBooks} aria-label={t({ id: "Books", message: "Books" })} title={t({ id: "Books", message: "Books" })}><FiBookOpen aria-hidden/><Trans id="Books">Books</Trans></button><div className="tsugi-pixel-rule" aria-hidden="true"/></>}
        <span className="tsugi-reading-rail-label"><Trans id="Collection">Collection</Trans></span>
        {tabs.map(({ id, label, Icon }) => <button key={id} aria-label={label} title={label} aria-current={tab === id ? 'page' : undefined} disabled={busy} onClick={() => switchTab(id)}><Icon aria-hidden />{label}</button>)}
        <div className="tsugi-pixel-rule" aria-hidden="true" />
        <span className="tsugi-reading-rail-label"><Trans id="Discover">Discover</Trans></span>
        <button title={t({ id: "Browse", message: "Browse" })} aria-current={tab === 'browse' && browseTab === 'sources' ? 'page' : undefined} disabled={busy} onClick={() => switchBrowse('sources')}><FiCompass aria-hidden /><Trans id="Browse">Browse</Trans></button>
        <button title={t({ id: "Feed", message: "Feed" })} aria-current={tab === 'browse' && browseTab === 'feed' ? 'page' : undefined} disabled={busy} onClick={() => switchBrowse('feed')}><FiCompass aria-hidden /><Trans id="Feed">Feed</Trans></button>
        <button title={t({ id: "Global search", message: "Global search" })} aria-current={tab === 'browse' && browseTab === 'search' ? 'page' : undefined} disabled={busy} onClick={() => switchBrowse('search')}><FiSearch aria-hidden /><Trans id="Global search">Global search</Trans></button>
        <button title={t({ id: "Extensions", message: "Extensions" })} aria-current={tab === 'browse' && browseTab === 'extensions' ? 'page' : undefined} disabled={busy} onClick={() => switchBrowse('extensions')}><FiGrid aria-hidden /><Trans id="Extensions">Extensions</Trans></button>
        <div className="tsugi-pixel-rule" aria-hidden="true" />
        <span className="tsugi-reading-rail-label"><Trans id="Preferences">Preferences</Trans></span>
        <button title={t({ id: "Import local comic", message: "Import local comic" })} aria-label={t({ id: "Import local comic", message: "Import local comic" })} disabled={busy} onClick={() => { setLocalImportOpen(true); void localImport.controller.begin(); }}><FiPlus aria-hidden /><Trans id="Import local comic">Import local comic</Trans></button>
        <button title={t({ id: "Settings", message: "Settings" })} aria-current={tab === 'settings' ? 'page' : undefined} disabled={busy} onClick={() => switchTab('settings')}><BrushSliders aria-hidden /><Trans id="Settings">Settings</Trans></button>
      </nav>
    </TsugiRail>
    <div className="tsugi-reading-content" ref={content}>
      <header className="tsugi-reading-header">
        <div><p className="yomi-eyebrow"><Trans id="Your reading space">Your reading space</Trans></p><h1>{details ? t({ id: "Series", message: "Series" }) : tabs.find(item => item.id === tab)?.label ?? (tab === 'settings' ? t({ id: "Settings", message: "Settings" }) : browseTab === 'search' ? t({ id: "Global search", message: "Global search" }) : browseTab === 'extensions' ? t({ id: "Extensions", message: "Extensions" }) : browseTab === 'feed' ? t({ id: "Feed", message: "Feed" }) : t({ id: "Browse", message: "Browse" }))}</h1>
          {!details && tab === 'library' && library && <p className="tsugi-library-summary"><Trans id="Saved titles">Saved titles</Trans> <strong>{allLibrary.length}</strong><span aria-hidden="true"> · </span><Trans id="Unread chapters">Unread chapters</Trans> <strong>{allLibrary.reduce((sum, manga) => sum + (manga.unreadCount || 0), 0)}</strong></p>}
        </div>
        {!(tab === 'browse' && browseTab === 'search' && !details) && <form className="tsugi-reading-global" onSubmit={(event) => { event.preventDefault(); if (!globalQuery.trim() || busy) return; setDetails(null); setTab('browse'); setBrowseTab('search'); void run(async () => { const result = await readRequest<Nodes<Source>>({ kind: 'sources' }); const available = result.nodes.filter((item) => item.id !== '0'); setSources(available); await searchAll(available); }); }}>
          <FiSearch aria-hidden /><input value={globalQuery} onChange={(event) => setGlobalQuery(event.target.value)} maxLength={200} placeholder={t({ id: "Search all installed sources", message: "Search all installed sources" })} aria-label={t({ id: "Global manga search", message: "Global manga search" })} /><button disabled={busy || !globalQuery.trim()} aria-label={t({ id: "Search", message: "Search" })}><FiChevronRight aria-hidden /></button>
        </form>}
      </header>
    {visible && !details && !reader && (tab === 'library' || (tab === 'browse' && browseTab === 'sources')) && <LandscapeSpotlight
      designArea="read" localArtwork={tab === 'browse' ? '/design/shared/hero-neon.webp' : '/design/yomi/hero-torii.webp'}
      title={featured?.title || (tab === 'browse' ? t({ id: 'Find your next story.', message: 'Find your next story.' }) : t({ id: 'A world between pages.', message: 'A world between pages.' }))}
      eyebrow={featured ? t({ id: 'Continue reading', message: 'Continue reading' }) : t({ id: 'Reading room', message: 'Reading room' })}
      description={featured?.lastReadChapter?.name || t({ id: 'Find your next story or return to your collection.', message: 'Find your next story or return to your collection.' })}
      actionLabel={featured ? t({ id: 'Resume reading', message: 'Resume reading' }) : tab === 'browse' ? t({ id: 'Search manga', message: 'Search manga' }) : t({ id: 'Explore sources', message: 'Explore sources' })}
      featuredKey={featured ? String(featured.id) : undefined}
      featuredArtwork={featured ? <MangaCover manga={featured} /> : undefined}
      onNextFeatured={featured && continuing.length>1 ? ()=>setSpotlightChoice({anchor:spotlightAnchor,id:String(continuing[(continuing.indexOf(featured)+1)%continuing.length].id)}) : undefined}
      onAction={() => { if (featured) void run(() => resumeManga(featured)); else switchBrowse(tab === 'library' ? 'sources' : 'search'); }} disabled={busy} />}
    {!details && (tab === 'history' || tab === 'updates') && <YomiBanner eyebrow={tab === 'history' ? t({ id: 'The path so far', message: 'The path so far' }) : t({ id: 'Back on the shelf', message: 'Back on the shelf' })} title={tab === 'history' ? t({ id: 'Your reading journal.', message: 'Your reading journal.' }) : t({ id: 'One chapter becomes another.', message: 'One chapter becomes another.' })} description={tab === 'history' ? t({ id: 'Return to the exact chapter you opened.', message: 'Return to the exact chapter you opened.' }) : t({ id: 'Unread chapters from your library, ordered by when they were added.', message: 'Unread chapters from your library, ordered by when they were added.' })} />}
    {!details && tab === 'categories' && <YomiBanner eyebrow={t({ id: 'Collected by you', message: 'Collected by you' })} title={t({ id: 'A home for every story.', message: 'A home for every story.' })} description={t({ id: 'Create shelves for the stories you want to keep together.', message: 'Create shelves for the stories you want to keep together.' })} artwork="/design/shared/hero-train.webp" />}
    {!details && tab === 'downloads' && <YomiBanner eyebrow={t({ id: 'Stories to take with you', message: 'Stories to take with you' })} title={t({ id: 'Ready for the next chapter.', message: 'Ready for the next chapter.' })} description={t({ id: 'Manage your chapter queue and check the latest download status.', message: 'Manage your chapter queue and check the latest download status.' })} artwork="/design/shared/hero-train.webp" />}
    {!details && tab === 'settings' && <YomiBanner eyebrow={t({ id: 'Make it yours', message: 'Make it yours' })} title={t({ id: 'Read your own way.', message: 'Read your own way.' })} description={t({ id: 'Set up your sources, reading layout and connected trackers.', message: 'Set up your sources, reading layout and connected trackers.' })} />}
    {busy && <p className="mb-4 text-sm text-[--tsugi-muted]" role="status"><Trans id="Working…">Working…</Trans></p>}
    {error && <div role="alert" className="tsugi-read-error mb-4">{error}</div>}
    {details ? <section>
      <button className="tsugi-read-action mb-6" disabled={busy} onClick={() => { setDetails(null); setError(''); if (tab === 'library') void run(loadLibrary); else if (tab === 'history') void run(loadHistory); else if (tab === 'updates') void run(loadUpdates); content.current?.scrollTo(0, 0); }}><FiArrowLeft aria-hidden /><Trans id="Back">Back</Trans></button>
      <div className="tsugi-series-layout">
      <aside className="tsugi-manga-detail yomi-series-hero">
        <LandscapeDecoration className="yomi-series-backdrop" fallback="/design/yomi/hero-torii.webp" active={visible} />
        <MangaCover manga={details.manga} fallbackEnabled={visible && coverFallback} />
        <div className="min-w-0">
          <p className="yomi-eyebrow"><Trans id="Manga">Manga</Trans>{details.manga.inLibrary && <><span aria-hidden="true"> / </span><Trans id="In your library">In your library</Trans></>}</p>
          <BrushHeading as="h2" className="text-3xl font-semibold tracking-tight">{details.manga.title}</BrushHeading>
          {details.manga.author && <p className="mt-2 text-[--tsugi-muted]">{details.manga.author}</p>}
          {details.manga.genre?.length ? <div className="my-3 flex flex-wrap gap-2 text-xs text-[--tsugi-muted]">{details.manga.genre.map((genre) => <span className="tsugi-manga-genre" key={genre}>{genre}</span>)}</div> : null}
          <div className="tsugi-series-actions flex flex-wrap gap-3">
            <button className="tsugi-read-action" disabled={busy} onClick={() => void run(async () => { const inLibrary = !details.manga.inLibrary; await readRequest({ kind: 'set-library', id: Number(details.manga.id), inLibrary }); setDetails({ ...details, manga: { ...details.manga, inLibrary } }); })}>{details.manga.inLibrary ? t({ id: "Remove from library", message: "Remove from library" }) : t({ id: "Add to library", message: "Add to library" })}</button>
            {details.chapters.length > 0 && <button className="tsugi-read-action tsugi-series-primary" disabled={busy} onClick={() => void run(() => openChapter(firstChapter(details.chapters)!))}><FiBookOpen aria-hidden /><Trans id="Start or resume reading">Start or resume reading</Trans></button>}
            <button className="tsugi-read-action" aria-expanded={trackingOpen} disabled={busy} onClick={() => setTrackingOpen(!trackingOpen)}><Trans id="Tracking">Tracking</Trans></button>
          </div>
        </div>
      </aside>
      <div className="yomi-series-body">
      <div className="tsugi-series-chapters">
      {trackingOpen && <MangaTracking key={details.manga.id} mangaId={Number(details.manga.id)} title={details.manga.title} busy={busy} run={run} openAccounts={() => { switchTab('settings'); openSettings('trackers'); }} />}
      <div className="tsugi-reading-list-header"><h3 className="text-xl font-medium"><Trans id="Chapters">Chapters</Trans> <span className="text-sm text-[--tsugi-muted]">({chapterRows.length})</span></h3><div className="tsugi-reading-filters"><input className="tsugi-read-input" value={chapterFilter} onChange={(event) => setChapterFilter(event.target.value)} placeholder={t({ id: "Find a chapter", message: "Find a chapter" })} aria-label={t({ id: "Find a chapter", message: "Find a chapter" })} /><select className="tsugi-read-input" aria-label={t({ id: "Chapter status", message: "Chapter status" })} value={chapterState} onChange={(event) => setChapterState(event.target.value as typeof chapterState)}><option value="all"><Trans id="All chapters">All chapters</Trans></option><option value="unread"><Trans id="Unread">Unread</Trans></option><option value="read"><Trans id="Read">Read</Trans></option><option value="bookmarked"><Trans id="Bookmarked">Bookmarked</Trans></option></select><button className="tsugi-read-action" onClick={() => setChapterOrder(chapterOrder === 'asc' ? 'desc' : 'asc')}>{chapterOrder === 'asc' ? t({ id: "Oldest first", message: "Oldest first" }) : t({ id: "Newest first", message: "Newest first" })}</button></div></div>
      {!details.chapters.length && <p><Trans id="No chapters found.">No chapters found.</Trans></p>}
      {!chapterRows.length && details.chapters.length > 0 && <p className="py-6 text-[--tsugi-muted]"><Trans id="No chapters match your filters.">No chapters match your filters.</Trans></p>}
      {!!details.chapters.length && <div className="my-3 flex flex-wrap items-center gap-2"><button className="tsugi-read-action" disabled={busy || downloads.snapshot.busy} onClick={() => void run(() => refreshChapterDownloads(Number(details.manga.id)))}><FiRefreshCw aria-hidden /><Trans id="Refresh download status">Refresh download status</Trans></button><button className="tsugi-read-action" disabled={busy || downloads.snapshot.busy} onClick={() => switchTab('downloads')}><BrushDownload aria-hidden /><Trans id="View Downloads">View Downloads</Trans></button></div>}
      {(downloadSelectionAttempted || downloads.snapshot.notice === 'uncertain') && <div className="my-3"><DownloadFeedback snapshot={downloads.snapshot} /></div>}
      {!!chapterRows.length && <div className="tsugi-chapter-selection">
        <label><input type="checkbox" checked={chapterRows.flat().every((chapter) => selectedChapters.includes(chapter.id))} disabled={busy || chapterRows.flat().length > 2000} onChange={(event) => setSelectedChapters(event.target.checked ? chapterRows.flat().map((chapter) => chapter.id) : [])} /><Trans id="Select visible chapters">Select visible chapters</Trans></label>
        {!!selectedChapters.length && <><span>{selectedChapters.length} <Trans id="selected">selected</Trans></span><button className="tsugi-read-action" disabled={busy || downloads.snapshot.busy || (downloads.snapshot.notice === 'uncertain' && downloads.snapshot.error) || selectedChapters.length > MAX_DOWNLOAD_SELECTION || !details.chapters.some(chapter => selectedChapters.includes(chapter.id) && chapter.isDownloaded !== true)} onClick={() => void downloadSelected()}><BrushDownload aria-hidden /><Trans id="Download selected">Download selected</Trans></button><button className="tsugi-read-action" disabled={busy} onClick={() => void run(() => changeChapters(selectedChapters, { read: true }))}><Trans id="Mark read">Mark read</Trans></button><button className="tsugi-read-action" disabled={busy} onClick={() => void run(() => changeChapters(selectedChapters, { read: false }))}><Trans id="Mark unread">Mark unread</Trans></button><button className="tsugi-read-action" disabled={busy} onClick={() => void run(() => changeChapters(selectedChapters, { bookmarked: true }))}><Trans id="Bookmark">Bookmark</Trans></button><button className="tsugi-read-action" onClick={() => setSelectedChapters([])}><Trans id="Clear selection">Clear selection</Trans></button></>}
        {selectedChapters.length > MAX_DOWNLOAD_SELECTION && <span className="text-sm text-[--tsugi-muted]"><Trans id="Select at most 100 chapters to download at once.">Select at most 100 chapters to download at once.</Trans></span>}
        {details.chapters.some(chapter => selectedChapters.includes(chapter.id) && chapter.isDownloaded === true) && <span className="text-sm text-[--tsugi-muted]"><Trans id="Already downloaded chapters are skipped.">Already downloaded chapters are skipped.</Trans></span>}
      </div>}
      {chapterRows.map((group) => {
        const first = group[0];
        const chapterRow = (chapter: Chapter) => <div className="tsugi-chapter-list-item" key={chapter.id} data-read-state={chapter.isRead ? 'read' : chapter.lastPageRead > 0 ? 'resume' : 'unread'}>
          <input type="checkbox" checked={selectedChapters.includes(chapter.id)} disabled={busy} aria-label={t({ id: "Select chapter", message: "Select chapter" }) + ' ' + chapter.name} onChange={(event) => setSelectedChapters((ids) => event.target.checked ? [...ids, chapter.id] : ids.filter((id) => id !== chapter.id))} />
          <button className="tsugi-read-row tsugi-chapter-row" disabled={busy} onClick={() => void run(() => openChapter(chapter))}><span><span className="block font-medium">{chapter.name}</span><span className="text-xs text-[--tsugi-muted]">{chapter.scanlator || (group.length > 1 ? t({ id: "Unknown translation group", message: "Unknown translation group" }) : '')}</span></span><span className="text-right text-xs text-[--tsugi-muted]">{chapter.isDownloaded === true && <span className="block" data-chapter-downloaded={chapter.id}><Trans id="Downloaded">Downloaded</Trans></span>}{chapter.isRead ? t({ id: "Read", message: "Read" }) : chapter.lastPageRead > 0 ? t({ id: "Resume", message: "Resume" }) : t({ id: "Unread", message: "Unread" })}</span></button>
          <button className="tsugi-reader-icon" disabled={busy} aria-pressed={!!chapter.isBookmarked} aria-label={chapter.isBookmarked ? t({ id: "Remove bookmark", message: "Remove bookmark" }) : t({ id: "Bookmark chapter", message: "Bookmark chapter" })} onClick={() => void run(() => changeChapters([chapter.id], { bookmarked: !chapter.isBookmarked }))}><FiBookmark aria-hidden /></button>
        </div>;
        return group.length === 1 ? chapterRow(first) : <details key={first.id} className="tsugi-chapter-versions"><summary><span className="font-medium">{first.name}</span><span className="text-xs text-[--tsugi-muted]">{group.length} <Trans id="versions">versions</Trans></span></summary><div className="pl-5">{group.map(chapterRow)}</div></details>;
      })}
      </div>
      <aside className="yomi-series-summary">
        <h3><Trans id="About this story">About this story</Trans></h3>
        {details.manga.description ? <div className="yomi-series-synopsis">
          <p className="whitespace-pre-wrap">{expandedSynopsis ? cleanSynopsis(details.manga.description) : cleanSynopsis(details.manga.description).slice(0, 650) + (cleanSynopsis(details.manga.description).length > 650 ? '…' : '')}</p>
          {cleanSynopsis(details.manga.description).length > 650 && <button className="tsugi-library-action mt-2" onClick={() => setExpandedSynopsis(!expandedSynopsis)}>{expandedSynopsis ? t({ id: "Show less", message: "Show less" }) : t({ id: "Read more", message: "Read more" })}</button>}
        </div> : <p className="text-sm text-[--tsugi-muted]"><Trans id="No synopsis is available from this source.">No synopsis is available from this source.</Trans></p>}
        <dl className="yomi-facts"><div><dt><Trans id="Chapters">Chapters</Trans></dt><dd>{chapterGroups(details.chapters).length}</dd></div><div><dt><Trans id="Read">Read</Trans></dt><dd>{chapterGroups(details.chapters).filter(group => group.some(chapter => chapter.isRead)).length}</dd></div>{details.manga.artist && <div><dt><Trans id="Artist">Artist</Trans></dt><dd>{details.manga.artist}</dd></div>}</dl>
      </aside>
      </div>
      </div>
    </section> : tab === 'downloads' ? <ReaderDownloads downloads={downloads} disabled={busy} /> : tab === 'settings' ? (
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
          : <div className="yomi-repository-settings" data-ui="reader-repositories">
            <header>
              <h2 className="text-xl font-semibold"><Trans id="Extension repositories">Extension repositories</Trans></h2>
              <p><Trans id="Paste the HTTPS extension repository index URL you use with Mihon, Komikku or another compatible Tachiyomi fork. Adding a repository lists its extensions; install the ones you want from Extensions.">Paste the HTTPS extension repository index URL you use with Mihon, Komikku or another compatible Tachiyomi fork. Adding a repository lists its extensions; install the ones you want from Extensions.</Trans></p>
            </header>
            <form className="yomi-repository-form" onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await readRequest({ kind: 'add-store', index: repository.trim() });
                setRepository('');
                await loadStores();
                await readRequest({ kind: 'refresh-extensions' });
              });
            }}>
              <label className="yomi-repository-field">
                <span><Trans id="Repository index URL">Repository index URL</Trans></span>
                <input className="tsugi-read-input" type="url" required value={repository} onChange={(event) => setRepository(event.target.value)} placeholder={t({ id: "HTTPS repository index URL", message: "HTTPS repository index URL" })} aria-label={t({ id: "Repository index URL", message: "Repository index URL" })} />
              </label>
              <button className="tsugi-read-action" disabled={busy || !repository.trim()}><Trans id="Add repository">Add repository</Trans></button>
            </form>
            {!stores.length && !busy && <p className="yomi-repository-empty"><Trans id="No repositories added yet.">No repositories added yet.</Trans></p>}
            {!!stores.length && <ul className="yomi-repository-list" aria-label={t({ id: "Extension repositories", message: "Extension repositories" })}>
              {stores.map((store) => <li className="yomi-repository-row" key={store.indexUrl}>
                <div className="yomi-repository-identity"><strong>{store.name}</strong><span>{store.indexUrl}</span></div>
                <button className="tsugi-read-action" disabled={busy} onClick={() => void run(async () => { await readRequest({ kind: 'remove-store', index: store.indexUrl }); if (storeFilter === store.indexUrl) setStoreFilter(''); await loadStores(); await readRequest({ kind: 'refresh-extensions' }); })}><Trans id="Remove">Remove</Trans></button>
              </li>)}
            </ul>}
            <p className="yomi-repository-trust"><Trans id="Only install extensions from publishers you trust. Extensions run with your Windows account permissions; their signatures are not independently verified.">Only install extensions from publishers you trust. Extensions run with your Windows account permissions; their signatures are not independently verified.</Trans></p>
            <button className="tsugi-read-action" disabled={busy} onClick={() => switchTab('browse')}><Trans id="Return to Browse">Return to Browse</Trans></button>
          </div>}
      </section>
    ) : tab === 'migrate' ? <MigrationWorkspace library={allLibrary} sources={sources} busy={busy} run={run} reload={loadLibrary} />
    : tab === 'batch' ? <BatchAddWorkspace library={allLibrary} sources={sources} busy={busy} run={run} reload={loadLibrary} />
    : tab === 'history' || tab === 'updates' ? (
      <section className="tsugi-reading-activity">
        <div className="tsugi-reading-list-header">
          <div><h2 className="text-xl font-semibold">{tab === 'history' ? <Trans id="Recently read chapters">Recently read chapters</Trans> : <Trans id="Recently fetched unread chapters">Recently fetched unread chapters</Trans>}</h2>
          <p className="mt-1 text-sm text-[--tsugi-muted]">{tab === 'history' ? <Trans id="Return to the exact chapter you opened.">Return to the exact chapter you opened.</Trans> : <Trans id="Unread chapters from your library, ordered by when they were added.">Unread chapters from your library, ordered by when they were added.</Trans>}</p></div>
          <div className="flex flex-wrap gap-2">
            {tab === 'updates' && <button className="tsugi-read-action" disabled={busy || updateStatus?.jobsInfo.isRunning} onClick={() => void run(async () => {
              setUpdateStatus(await readRequest<UpdateStatus>({ kind: 'start-library-update' }));
              setUpdates(await readRequest<Nodes<Activity>>({ kind: 'updates' }));
            })}><FiRefreshCw aria-hidden /><Trans id="Check for chapters">Check for chapters</Trans></button>}
            <button className="tsugi-read-action" disabled={busy} onClick={() => void run(tab === 'history' ? loadHistory : loadUpdates)}><Trans id="Refresh feed">Refresh feed</Trans></button>
          </div>
        </div>
        {tab === 'updates' && updateStatus && <div className="tsugi-reader-update-status" role="status">
          <span>{updateStatus.jobsInfo.isRunning ? <Trans id="Checking library">Checking library</Trans> : <Trans id="Library update idle">Library update idle</Trans>}</span>
          {updateStatus.jobsInfo.totalJobs > 0 && <><progress max={updateStatus.jobsInfo.totalJobs} value={updateStatus.jobsInfo.finishedJobs} aria-label={t({ id: "Library update progress", message: "Library update progress" })} /><span>{updateStatus.jobsInfo.finishedJobs}/{updateStatus.jobsInfo.totalJobs}</span></>}
          {updateStatus.jobsInfo.skippedMangasCount > 0 && <small>{updateStatus.jobsInfo.skippedMangasCount} <Trans id="titles skipped by update preferences">titles skipped by update preferences</Trans></small>}
        </div>}
        {(tab === 'history' ? history : updates)?.nodes.map(entry => <button key={entry.id} type="button" className="tsugi-read-row tsugi-reader-activity-row" disabled={busy} onClick={() => void run(() => openActivity(entry))}>
          <MangaCover manga={entry.manga} fallbackEnabled={visible && coverFallback} />
          <span className="min-w-0 grow yomi-activity-copy"><strong className="block truncate">{entry.manga.title}</strong><small className="block text-[--tsugi-muted]">{entry.name}{tab === 'history' && entry.pageCount > 0 ? ' · ' + Math.min(entry.lastPageRead + 1, entry.pageCount) + '/' + entry.pageCount : ''}</small>{tab === 'history' && entry.pageCount > 0 && <progress max={entry.pageCount} value={entry.isRead ? entry.pageCount : Math.min(entry.lastPageRead + 1, entry.pageCount)} aria-label={t({ id: "Chapter progress", message: "Chapter progress" })} />}</span>
          <small className="text-[--tsugi-muted] yomi-activity-date">{activityDate(tab === 'history' ? entry.lastReadAt : entry.fetchedAt)}</small>
          <span className="yomi-row-action">{tab === 'history' ? <Trans id="Resume">Resume</Trans> : <Trans id="Read">Read</Trans>}<FiChevronRight aria-hidden /></span>
        </button>)}
        {!busy && (tab === 'history' ? history : updates)?.nodes.length === 0 && <div className="tsugi-reading-empty">{tab === 'history' ? <FiClock aria-hidden /> : <FiBell aria-hidden />}<h2>{tab === 'history' ? <Trans id="No reading history yet">No reading history yet</Trans> : <Trans id="No unread updates">No unread updates</Trans>}</h2><p>{tab === 'history' ? <Trans id="Your reading activity will appear here.">Your reading activity will appear here.</Trans> : <Trans id="Check your library for new chapters.">Check your library for new chapters.</Trans>}</p></div>}
        {((tab === 'history' ? history : updates)?.totalCount ?? 0) > 100 && <p className="mt-4 text-sm text-[--tsugi-muted]"><Trans id="Showing the latest 100 chapters.">Showing the latest 100 chapters.</Trans></p>}
      </section>
    ) : tab === 'categories' ? (
      <section className="tsugi-reader-categories" data-category-selected={!!selectedCategory}>
        <aside className="tsugi-category-list">
          <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); if (categoryName.trim()) void run(() => saveCategory(undefined, categoryName)); }}>
            <input className="tsugi-read-input min-w-0 grow" value={categoryName} maxLength={80} onChange={event => setCategoryName(event.target.value)} placeholder={t({ id: "New category", message: "New category" })} aria-label={t({ id: "New category", message: "New category" })} />
            <button className="tsugi-read-action" disabled={busy || !categoryName.trim()}><FiPlus aria-hidden /><Trans id="Create category">Create category</Trans></button>
          </form>
          <nav aria-label={t({ id: "Custom categories", message: "Custom categories" })} className="yomi-category-cards">
            {categories.map((category, index) => <button type="button" key={category.id} className="tsugi-category-item yomi-category-card" aria-current={categoryId === category.id ? 'page' : undefined} onClick={() => { setCategoryId(category.id); setRenameCategory(category.name); setConfirmDelete(false); }} disabled={busy}>
              <img className="yomi-category-art" src={index % 2 ? '/design/shared/hero-train.webp' : '/design/shared/hero-neon.webp'} alt="" />
              <span className="yomi-category-copy"><FiFolder aria-hidden /><BrushHeading as="strong">{category.name}</BrushHeading><small>{allLibrary.filter(manga => categoryContains(manga, category.id)).length} <Trans id="Saved titles">Saved titles</Trans></small></span>
              <span className="yomi-cover-stack" aria-hidden="true">{allLibrary.filter(manga => categoryContains(manga, category.id)).slice(0, 3).map(manga => <MangaCover key={manga.id} manga={manga} fallbackEnabled={visible && coverFallback} />)}</span>
            </button>)}
          </nav>
        </aside>
        {selectedCategory ? <section className="min-w-0">
          <div className="tsugi-reading-list-header"><h2 className="text-xl font-semibold">{selectedCategory.name}</h2><button className="tsugi-read-action" disabled={busy} onClick={() => { setCategoryFilter(categoryId); setLibraryView('all'); setLibraryFilter(''); switchTab('library'); }}><Trans id="Open shelf">Open shelf</Trans></button></div>
          <form className="mb-3 flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); if (renameCategory.trim()) void run(() => saveCategory(categoryId, renameCategory)); }}>
            <input className="tsugi-read-input min-w-0 grow" value={renameCategory} maxLength={80} onChange={event => setRenameCategory(event.target.value)} aria-label={t({ id: "Category name", message: "Category name" })} />
            <button className="tsugi-read-action" disabled={busy || !renameCategory.trim() || renameCategory.trim() === selectedCategory.name}><Trans id="Rename category">Rename category</Trans></button>
            <button type="button" className="tsugi-read-action" disabled={busy} onClick={() => setConfirmDelete(value => !value)}><Trans id="Delete category">Delete category</Trans></button>
          </form>
          {confirmDelete && <div className="tsugi-reader-category-confirm"><p><Trans id="Remove this category? Your manga and reading progress will stay in the library.">Remove this category? Your manga and reading progress will stay in the library.</Trans></p><button className="tsugi-read-action" disabled={busy} onClick={() => void run(async () => { await readRequest({ kind: 'delete-category', id: categoryId }); setCategoryId(0); setConfirmDelete(false); await loadLibrary(); })}><Trans id="Confirm category deletion">Confirm category deletion</Trans></button><button className="tsugi-read-action" onClick={() => setConfirmDelete(false)}><Trans id="Cancel">Cancel</Trans></button></div>}
          <input className="tsugi-read-input my-4 w-full" value={categorySearch} onChange={event => setCategorySearch(event.target.value)} placeholder={t({ id: "Filter titles", message: "Filter titles" })} aria-label={t({ id: "Filter category titles", message: "Filter category titles" })} />
          <p className="mb-2 text-sm text-[--tsugi-muted]"><Trans id="Select titles to include on this shelf. A title can belong to several categories.">Select titles to include on this shelf. A title can belong to several categories.</Trans></p>
          {allLibrary.filter(manga => manga.title.toLowerCase().includes(categorySearch.trim().toLowerCase())).map(manga => <label key={manga.id} className="tsugi-read-row tsugi-reader-category-title">
            <MangaCover manga={manga} fallbackEnabled={visible && coverFallback} />
            <span className="min-w-0 grow truncate">{manga.title}</span>
            {categoryContains(manga, categoryId) && <FiCheck aria-hidden />}
            <input type="checkbox" checked={categoryContains(manga, categoryId)} disabled={busy} onChange={event => { const assigned = event.target.checked; void run(async () => { await readRequest({ kind: 'assign-category', mangaId: Number(manga.id), categoryId, assigned }); await loadLibrary(); }); }} />
          </label>)}
          {!allLibrary.length && <p className="text-sm text-[--tsugi-muted]"><Trans id="Save manga to your library before assigning categories.">Save manga to your library before assigning categories.</Trans></p>}
          {library && library.totalCount > library.nodes.length && <p className="mt-3 text-sm text-[--tsugi-muted]"><Trans id="Some library entries could not be loaded.">Some library entries could not be loaded.</Trans></p>}
        </section> : <div className="tsugi-reading-empty"><FiFolder aria-hidden /><h2><Trans id="Organize your collection">Organize your collection</Trans></h2><p><Trans id="Create a category or choose one to manage its titles.">Create a category or choose one to manage its titles.</Trans></p></div>}
      </section>
    ) : tab === 'browse' ? (
      <section>
        <nav className="tsugi-read-subnav mb-7" aria-label={t({ id: "Browse sections", message: "Browse sections" })}>
          {[{ id: 'sources' as const, label: t({ id: "Sources", message: "Sources" }), Icon: FiCompass }, { id: 'feed' as const, label: t({ id: "Feed", message: "Feed" }), Icon: FiCompass }, { id: 'extensions' as const, label: t({ id: "Extensions", message: "Extensions" }), Icon: FiGrid }, { id: 'search' as const, label: t({ id: "Global search", message: "Global search" }), Icon: FiSearch }].map(({ id, label, Icon }) =>
            <button key={id} disabled={busy} aria-current={browseTab === id ? 'page' : undefined} onClick={() => switchBrowse(id)}><Icon aria-hidden />{label}</button>)}
        </nav>
        {browseTab === 'feed' ? <SourceFeed feed={feed} busy={busy} onRequest={() => setError('')} renderManga={(items, select) => mangaGrid(items, item => select(item as FeedManga))} onOpen={item => { void run(async () => { await showManga(item); }); }} /> : browseTab === 'extensions' ? <section data-ui="extension-browser">
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <h2 className="mr-auto text-xl font-semibold"><Trans id="Extensions">Extensions</Trans></h2>
            <button className="tsugi-read-action" disabled={busy} onClick={() => void run(async () => { await readRequest({ kind: 'refresh-extensions' }); await loadExtensions(); })}><Trans id="Check extension updates">Check extension updates</Trans></button>
          </div>
          <form className="tsugi-reading-filters mb-4" onSubmit={(event) => { event.preventDefault(); void run(() => loadExtensions(0, filter.trim())); }}>
            <input className="tsugi-read-input grow" value={filter} maxLength={200} onChange={(event) => setFilter(event.target.value)} placeholder={t({ id: "Search all extensions", message: "Search all extensions" })} aria-label={t({ id: "Search extensions", message: "Search extensions" })} />
            <select className="tsugi-read-input" aria-label={t({ id: "Repository", message: "Repository" })} value={storeFilter} disabled={busy} onChange={(event) => { const index = event.target.value; setStoreFilter(index); void run(() => loadExtensions(0, filter.trim(), index)); }}>
              <option value=""><Trans id="All repositories">All repositories</Trans></option>{stores.map((store) => <option key={store.indexUrl} value={store.indexUrl}>{store.name}</option>)}
            </select>
            <select className="tsugi-read-input" aria-label={t({ id: "Extension status", message: "Extension status" })} value={extensionState} disabled={busy} onChange={(event) => { const value = event.target.value as typeof extensionState; setExtensionState(value); void run(() => loadExtensions(0, filter.trim(), storeFilter, extensionLanguage, value)); }}><option value="all"><Trans id="All extensions">All extensions</Trans></option><option value="installed"><Trans id="Installed">Installed</Trans></option><option value="available"><Trans id="Available">Available</Trans></option><option value="updates"><Trans id="Updates available">Updates available</Trans></option><option value="obsolete"><Trans id="Obsolete">Obsolete</Trans></option></select>
            <select className="tsugi-read-input" aria-label={t({ id: "Extension language", message: "Extension language" })} value={extensionLanguage} disabled={busy} onChange={(event) => { const value = event.target.value; setExtensionLanguage(value); void run(() => loadExtensions(0, filter.trim(), storeFilter, value)); }}><option value=""><Trans id="All languages">All languages</Trans></option>{extensionLanguages.map(lang => <option key={lang} value={lang}>{languageLabel(lang)}</option>)}</select>
            <select className="tsugi-read-input" aria-label={t({ id: 'Extension content', message: 'Extension content' })} value={extensionContent} disabled={busy} onChange={event => { const value = event.target.value as ContentFilter; setExtensionContent(value); void run(() => loadExtensions(0, filter.trim(), storeFilter, extensionLanguage, extensionState, value)); }}><ContentFilterOptions /></select>
            <button className="tsugi-read-action" disabled={busy}><Trans id="Search">Search</Trans></button>
          </form>
          <p className="mb-3 text-xs text-[--tsugi-muted]"><Trans id="Content labels come from extensions. Not flagged does not guarantee suitability.">Content labels come from extensions. Not flagged does not guarantee suitability.</Trans></p>
          {extensions && <p className="mb-3 flex flex-wrap gap-x-4 text-sm text-[--tsugi-muted]"><span>{extensions.totalCount.toLocaleString()} <Trans id="matching extensions">matching extensions</Trans></span>{pageUpdateCount > 0 && <span><Trans id="{pageUpdateCount} updates on this page">{pageUpdateCount} updates on this page</Trans></span>}</p>}
          {extensionState === 'updates' && <p className="mb-3 text-sm text-[--tsugi-muted]"><Trans id="Each update requires approval in a native window. Updates run one at a time with a recovery copy and stop if an update fails or is cancelled.">Each update requires approval in a native window. Updates run one at a time with a recovery copy and stop if an update fails or is cancelled.</Trans></p>}
          {extensions?.nodes.some(extension => extension.isInstalled && extension.hasUpdate && !extension.isObsolete) && <div className="mb-4 flex flex-wrap items-center gap-3">
            <button className="tsugi-read-action" disabled={busy} onClick={() => setSelectedExtensions(extensions.nodes.filter(extension => extension.isInstalled && extension.hasUpdate && !extension.isObsolete).map(extension => extension.pkgName))}><Trans id="Select updates on this page">Select updates on this page</Trans></button>
            <button className="tsugi-read-action" disabled={busy || !selectedExtensions.length} onClick={() => void run(() => updateExtensions(extensions.nodes.filter(extension => selectedExtensions.includes(extension.pkgName))))}><Trans id="Update selected">Update selected</Trans> ({selectedExtensions.length})</button>
            {!!selectedExtensions.length && <button className="tsugi-read-action" disabled={busy} onClick={() => setSelectedExtensions([])}><Trans id="Clear selection">Clear selection</Trans></button>}
          </div>}
          {updatingExtension && <div className="mb-4 flex flex-wrap items-center gap-3" role="status"><span><Trans id="Reviewing or updating {updatingExtension}…">Reviewing or updating {updatingExtension}…</Trans></span><button className="tsugi-read-action" disabled={stoppingExtensions} onClick={() => { stopExtensionUpdates.current = true; setStoppingExtensions(true); }}>{stoppingExtensions ? t({ id: "Stopping after this update…", message: "Stopping after this update…" }) : t({ id: "Stop after current update", message: "Stop after current update" })}</button></div>}
          {extensionUpdateNotices.length > 0 && <section className="mb-4" aria-label={t({ id: "Extension update results", message: "Extension update results" })} aria-live="polite">
            {extensionUpdateNotices.map(notice => <div key={notice.package} className="tsugi-read-row"><span><strong className="block">{notice.name}</strong><span className="block text-sm">{notice.status === 'rolled-back' && <Trans id="Previous state restored. ">Previous state restored. </Trans>}{notice.message}</span></span></div>)}
          </section>}
          {!stores.length && !busy && <button className="tsugi-read-action" onClick={() => { setTab('settings'); openSettings('repositories'); }}><Trans id="Add an extension repository">Add an extension repository</Trans></button>}
          {extensions && !extensions.nodes.length && !busy && <p className="py-6 text-[--tsugi-muted]"><Trans id="No matching extensions.">No matching extensions.</Trans></p>}
          {extensions?.nodes.map((extension) => <div key={extension.pkgName} data-extension-package={extension.pkgName} className="tsugi-read-row flex-wrap">
            {extension.isInstalled && extension.hasUpdate && !extension.isObsolete && <input type="checkbox" aria-label={extensionUpdateLabel(extension.name)} disabled={busy} checked={selectedExtensions.includes(extension.pkgName)} onChange={event => setSelectedExtensions(previous => event.target.checked ? [...previous, extension.pkgName] : previous.filter(pkg => pkg !== extension.pkgName))} />}
            <SourceIcon extension={extension} variant="extension" />
            <span className="min-w-0 basis-56 flex-1"><span className="block break-words font-medium">{extension.name}{extension.isInstalled && extension.hasUpdate === true && !extension.isObsolete && <small className="ms-2 text-[--tsugi-accent]"><Trans id="Update available">Update available</Trans></small>}{extension.isInstalled && extension.isObsolete && <small className="ms-2 text-[--tsugi-muted]"><Trans id="Obsolete">Obsolete</Trans></small>}</span><span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[--tsugi-muted]"><span>{languageLabel(extension.lang)}</span><span>{contentWarningLabel(extension.contentWarning)}</span><span>{versionLabel(extension.versionName, extension.isInstalled)}</span></span><span className="block break-all text-xs text-[--tsugi-muted]">{extension.pkgName}</span><span className="block break-words text-xs text-[--tsugi-muted]"><Trans id="Current repository">Current repository</Trans>: {stores.find(store => store.indexUrl === extension.storeIndexUrl)?.name || t({ id: 'Unknown', message: 'Unknown' })}</span></span>
            {extension.isInstalled && extension.hasUpdate && !extension.isObsolete && <button className="tsugi-read-action" disabled={busy} onClick={() => void run(() => updateExtensions([extension]))}><Trans id="Update">Update</Trans></button>}
            <button className="tsugi-read-action" disabled={busy || (!extension.isInstalled && extension.isObsolete)} onClick={() => void run(() => changeExtension(extension))}>{extension.isInstalled ? t({ id: "Uninstall", message: "Uninstall" }) : t({ id: "Install", message: "Install" })}</button>
            {extensionFailures[extension.pkgName] && <p className="basis-full text-xs text-[--tsugi-muted]" role="alert">{extensionFailures[extension.pkgName]}</p>}
          </div>)}
          {!!extensions?.totalCount && <div className="mt-4 flex items-center justify-between gap-3"><button className="tsugi-read-action" disabled={busy || offset === 0} onClick={() => void run(() => loadExtensions(Math.max(0, offset - 100)))}><Trans id="Previous">Previous</Trans></button><span>{offset + extensions.nodes.length} / {extensions.totalCount}</span><button className="tsugi-read-action" disabled={busy || offset + 100 >= extensions.totalCount} onClick={() => void run(() => loadExtensions(offset + 100))}><Trans id="Next">Next</Trans></button></div>}
        </section> : browseTab === 'search' ? <section className="tsugi-global-search-workspace">
          <div className="tsugi-search-console">
          <div className="tsugi-search-intro"><h2><Trans id="Find your next story">Find your next story</Trans></h2><p><Trans id="Search across installed manga sources and compare their results.">Search across installed manga sources and compare their results.</Trans></p></div>
          <form className="tsugi-search-form" onSubmit={(event) => { event.preventDefault(); void run(() => searchAll()); }}>
            <input className="tsugi-read-input grow" value={globalQuery} maxLength={200} onChange={(event) => setGlobalQuery(event.target.value)} placeholder={t({ id: "Search manga across installed sources", message: "Search manga across installed sources" })} aria-label={t({ id: "Global manga search", message: "Global manga search" })} />
            <button className="tsugi-read-action" disabled={busy || !globalQuery.trim() || !sources.length}><FiSearch aria-hidden /><Trans id="Search">Search</Trans></button>
            {globalSearching && <button type="button" className="tsugi-read-action" disabled={globalStopping} onClick={() => { stopSearch.current = true; setGlobalStopping(true); }}>{globalStopping ? t({ id: "Stopping after current source…", message: "Stopping after current source…" }) : t({ id: "Stop search", message: "Stop search" })}</button>}
          </form>
          {!sources.length && !busy && <button className="tsugi-read-action" onClick={() => switchBrowse('extensions')}><Trans id="Install a source extension">Install a source extension</Trans></button>}
          {globalTerm && <div className="tsugi-search-status" role="status"><span><strong>{globalTerm}</strong> · {globalCompleted} / {sources.length} <Trans id="sources checked">sources checked</Trans></span><progress value={globalCompleted} max={Math.max(1,sources.length)} aria-label={t({ id: "Source search progress", message: "Source search progress" })} /><span>{globalResults.reduce((sum,group)=>sum+(group.result?.mangas.length??0),0)} <Trans id="results shown">results shown</Trans></span></div>}
          </div>
          {globalResults.map((group) => <section key={group.source.id} className="tsugi-search-source" data-result-state={group.error?'error':group.result?.mangas.length?'matches':'empty'}><header className="tsugi-search-source-header"><div className="tsugi-search-source-label"><FiCompass aria-hidden /><h3>{group.source.displayName || group.source.name}</h3><span className="tsugi-search-language">{group.source.lang.toUpperCase()}</span></div><span className="tsugi-search-result-count">{group.error?<Trans id="Unavailable">Unavailable</Trans>:<><Trans id="Results">Results</Trans>: {group.result?.mangas.length??0}{group.result?.hasNextPage?'+':''}</>}</span></header>
            {group.error ? <p className="py-3 text-sm text-[--tsugi-muted]">{group.error}</p> : group.result?.mangas.length ? mangaGrid(group.result.mangas) : <p className="py-3 text-sm text-[--tsugi-muted]"><Trans id="No matches.">No matches.</Trans></p>}
            {group.result?.hasNextPage && <button className="tsugi-read-action mt-2" disabled={busy} onClick={() => { setBrowseTab('sources'); setSource(group.source.id); setQuery(globalTerm); setBrowse({ source: group.source.id, query: globalTerm, mode: 'search', page: 1, result: group.result! }); }}><Trans id="More results">More results</Trans></button>}
          </section>)}
        </section> : !source ? <section data-ui="source-browser">
          <div className="tsugi-reading-list-header flex-wrap gap-3"><h2 className="mr-auto text-xl font-semibold"><Trans id="Installed sources">Installed sources</Trans></h2><button className="tsugi-read-action" disabled={busy} onClick={() => void run(loadSources)}><Trans id="Reload installed sources">Reload installed sources</Trans></button></div>
          <div className="tsugi-reading-filters mb-3">
            <input className="tsugi-read-input grow" maxLength={200} placeholder={t({ id: "Filter installed sources", message: "Filter installed sources" })} aria-label={t({ id: "Filter installed sources", message: "Filter installed sources" })} value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} />
            <select className="tsugi-read-input" aria-label={t({ id: 'Source language', message: 'Source language' })} value={sourceLanguage} onChange={event => setSourceLanguage(event.target.value)}><option value=""><Trans id="All languages">All languages</Trans></option>{sourceLanguages([...sources, { lang: sourceLanguage }]).map(lang => <option key={lang} value={lang}>{languageLabel(lang)}</option>)}</select>
            <select className="tsugi-read-input" aria-label={t({ id: 'Source content', message: 'Source content' })} value={sourceContent} onChange={event => setSourceContent(event.target.value as ContentFilter)}><ContentFilterOptions /></select>
          </div>
          <p className="mb-3 text-xs text-[--tsugi-muted]"><Trans id="Content labels come from extensions. Not flagged does not guarantee suitability.">Content labels come from extensions. Not flagged does not guarantee suitability.</Trans></p>
          {sourcesLoaded && <p className="mb-3 text-sm text-[--tsugi-muted]" role="status">{matchingSources.length} / {sources.length} <Trans id="sources shown">sources shown</Trans></p>}
          {sourcesLoaded && !sources.length && !busy && <div className="py-6"><p className="mb-3 text-[--tsugi-muted]"><Trans id="No installed sources. Install an extension to start browsing.">No installed sources. Install an extension to start browsing.</Trans></p><button className="tsugi-read-action" onClick={() => switchBrowse('extensions')}><Trans id="Browse extensions">Browse extensions</Trans></button></div>}
          {sourcesLoaded && sources.length > 0 && !matchingSources.length && <p className="py-6 text-[--tsugi-muted]"><Trans id="No sources match these filters.">No sources match these filters.</Trans></p>}
          {matchingSources.map(item => <div key={item.id} className="tsugi-read-row flex-wrap gap-3"><button data-source-id={item.id} className="flex min-w-0 basis-52 flex-1 items-center gap-3 rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[--tsugi-accent]" disabled={busy} onClick={() => { setSource(item.id); setQuery(''); setBrowse(null); void run(() => catalogue('popular', 1, item.id, '')); }}>
            <SourceIcon extension={item.extension} /><span className="min-w-0 flex-1 text-left"><span className="block break-words font-medium">{item.displayName || item.name}</span><span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[--tsugi-muted]"><span>{languageLabel(item.lang)}</span><span>{contentWarningLabel(item.contentWarning)}</span>{item.supportsLatest && <span><Trans id="Latest supported">Latest supported</Trans></span>}{item.isConfigurable && <span><Trans id="Configurable source">Configurable source</Trans></span>}</span>{item.extension && <><span className="block break-words text-xs text-[--tsugi-muted]">{item.extension.name} · {versionLabel(item.extension.versionName, item.extension.isInstalled)}</span><span className="block break-all text-xs text-[--tsugi-muted]">{item.extension.pkgName}</span>{item.extension.isObsolete ? <span className="text-xs text-[--tsugi-muted]"><Trans id="Obsolete extension">Obsolete extension</Trans></span> : item.extension.hasUpdate && <span className="text-xs text-[--tsugi-accent]"><Trans id="Extension update available">Extension update available</Trans></span>}</>}</span><FiChevronRight className="shrink-0" aria-hidden />
          </button>{item.isConfigurable && <button className="tsugi-read-action" aria-label={sourceSettingsLabel(item.displayName || item.name)} disabled={busy} onClick={() => setSourceSettings(item)}><FiSettings aria-hidden /><Trans id="Settings">Settings</Trans></button>}</div>)}
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
    ) : <section className="tsugi-library-workspace">
      {continuing.length > 0 && libraryView === 'all' && !categoryFilter && !libraryFilter.trim() && <section className="tsugi-reading-resume" aria-label={t({ id: "Continue reading", message: "Continue reading" })}>
        <div className="yomi-section-heading"><h2><Trans id="Continue reading">Continue reading</Trans></h2><button className="tsugi-library-action" disabled={busy} onClick={() => switchTab('history')}><Trans id="Your reading history">Your reading history</Trans><FiChevronRight aria-hidden /></button></div>
        <div className="tsugi-reading-resume-list">{continuing.slice(0, 3).map((manga) => {
          const chapter = manga.lastReadChapter;
          const pageCount = chapter?.pageCount ?? 0;
          const page = Math.max(1, Math.min(pageCount, (chapter?.lastPageRead ?? 0) + 1));
          const showProgress = !!chapter && !chapter.isRead && pageCount > 0;
          return <button key={manga.id} className="tsugi-reading-resume-card" disabled={busy} onClick={() => void run(() => resumeManga(manga))}>
            <MangaCover manga={manga} fallbackEnabled={visible && coverFallback} />
            <span><small className="yomi-resume-kicker"><Trans id="Continue manga">Continue manga</Trans></small><strong>{manga.title}</strong><small>{chapter?.name}</small>
              {showProgress && <span className="tsugi-reading-resume-progress"><progress value={page} max={pageCount} aria-label={t({ id: "Chapter progress", message: "Chapter progress" })} /><small>{page}/{pageCount}</small></span>}
              <small className="tsugi-reading-resume-label">{chapter?.isRead ? t({ id: "Next chapter", message: "Next chapter" }) : t({ id: "Resume reading", message: "Resume reading" })}</small>
            </span><FiChevronRight aria-hidden /></button>;
        })}</div>
      </section>}
      <div className="tsugi-library-controls">
      {categories.length > 0 && <nav className="tsugi-library-shelves" aria-label={t({ id: "Library categories", message: "Library categories" })}><button type="button" aria-current={!categoryFilter ? 'page' : undefined} onClick={() => setCategoryFilter(0)}><Trans id="All shelves">All shelves</Trans></button>{categories.map(category => <button type="button" key={category.id} aria-current={categoryFilter === category.id ? 'page' : undefined} onClick={() => setCategoryFilter(category.id)}>{category.name}</button>)}<button type="button" disabled={busy} onClick={() => switchTab('categories')}><FiPlus aria-hidden /><Trans id="Manage categories">Manage categories</Trans></button></nav>}
      <div className="tsugi-reading-list-header"><nav className="tsugi-read-subnav" aria-label={t({ id: "Library view", message: "Library view" })}><button aria-current={libraryView === 'all' ? 'page' : undefined} onClick={() => setLibraryView('all')}><Trans id="All manga">All manga</Trans></button><button aria-current={libraryView === 'reading' ? 'page' : undefined} onClick={() => setLibraryView('reading')}><Trans id="In progress">In progress</Trans></button></nav><div className="tsugi-reading-filters"><input className="tsugi-read-input" placeholder={t({ id: "Find in library", message: "Find in library" })} aria-label={t({ id: "Find in library", message: "Find in library" })} value={libraryFilter} onChange={(event) => setLibraryFilter(event.target.value)} /><select className="tsugi-read-input" aria-label={t({ id: "Library sort", message: "Library sort" })} value={librarySort} onChange={(event) => setLibrarySort(event.target.value as typeof librarySort)}><option value="title"><Trans id="Title">Title</Trans></option><option value="recent"><Trans id="Recently read">Recently read</Trans></option></select><button className="tsugi-read-action" disabled={busy} onClick={() => { setLocalImportOpen(true); void localImport.controller.begin(); }}><FiPlus aria-hidden /><Trans id="Import CBZ">Import CBZ</Trans></button><button className="tsugi-read-action" disabled={busy} onClick={() => void run(loadLibrary)} aria-label={t({ id: "Refresh library", message: "Refresh library" })}><FiRefreshCw aria-hidden /></button></div></div>
      </div>
      {library && !allLibrary.length && !busy && <div className="tsugi-reading-empty"><FiBookOpen aria-hidden /><h2><Trans id="Your library is empty">Your library is empty</Trans></h2><p><Trans id="Browse a source to add manga and keep your reading progress in one place.">Browse a source to add manga and keep your reading progress in one place.</Trans></p><div className="tsugi-empty-actions"><button className="tsugi-read-action tsugi-empty-primary" onClick={() => switchTab('browse')}><Trans id="Browse sources">Browse sources</Trans></button><button className="tsugi-read-action" onClick={() => switchBrowse('extensions')}><Trans id="Extensions">Extensions</Trans></button></div></div>}
      {!!allLibrary.length && !rows.length && !busy && <p className="py-8 text-[--tsugi-muted]"><Trans id="No manga match your filters.">No manga match your filters.</Trans></p>}
      {!!allLibrary.length && <div className="tsugi-library-grid-heading"><h2>{libraryView === 'reading' ? <Trans id="In progress">In progress</Trans> : <Trans id="Your collection">Your collection</Trans>}</h2><span>{rows.length}</span></div>}
      {mangaGrid(rows)}
      {library && library.totalCount > library.nodes.length && <p className="mt-3 text-sm text-[--tsugi-muted]"><Trans id="Some library entries could not be loaded.">Some library entries could not be loaded.</Trans></p>}
      <div className="yomi-library-links">
        <button type="button" disabled={busy} onClick={() => switchTab('categories')}><FiFolder aria-hidden /><span><strong><Trans id="A shelf of your own">A shelf of your own</Trans></strong><small><Trans id="Bring your saved stories together in categories.">Bring your saved stories together in categories.</Trans></small></span><FiChevronRight aria-hidden /></button>
        <button type="button" disabled={busy} onClick={() => switchTab('downloads')}><BrushDownload aria-hidden /><span><strong><Trans id="Chapter downloads">Chapter downloads</Trans></strong><small><Trans id="Check your queue and manage saved chapters.">Check your queue and manage saved chapters.</Trans></small></span><FiChevronRight aria-hidden /></button>
      </div>
    </section>}
    </div>
    {sourceSettings && <SourceSettings key={sourceSettings.id} source={sourceSettings} busy={busy} request={serializedRequest} onClose={() => setSourceSettings(null)} />}
    {localImportOpen && <LocalComicImport localImport={localImport} busy={busy} onClose={() => setLocalImportOpen(false)} onImported={() => run(loadLibrary)} onOpen={openImportedComic} />}
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
  return <div ref={box} className="tsugi-manga-cover">{url && !failed ? <img src={url} alt="" data-cover-origin="source" onError={() => setFailed(true)} /> : eligible && fallback ? <img src={fallback} alt="" referrerPolicy="no-referrer" data-cover-origin="metadata" onError={() => setFallback('')} /> : <span className="yomi-cover-fallback" aria-hidden="true"><FiBookOpen /><span>{manga.title}</span></span>}</div>;
}

/** One-time native setup without a console window or manual script. */
export function ReadSetupPage({ openWelcome, onReady, openBooks }: { openWelcome(): void; onReady(): void; openBooks?: () => void }) {
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
  return <main data-page="read-setup" className="tsugi-read-root yomi-setup min-h-dvh px-6 pb-12 pt-12 sm:px-10 lg:px-[5vw]">
    <MediaNavigation area="read" disabled={busy} />
    <h1 className="my-9 text-4xl font-semibold tracking-tight"><Trans id="Read">Read</Trans></h1>
    <YomiBanner eyebrow={t({ id: 'Your reading space', message: 'Your reading space' })} title={t({ id: 'A world between pages.', message: 'A world between pages.' })} description={t({ id: 'Set up manga reading or open your local book collection.', message: 'Set up manga reading or open your local book collection.' })} />
    <section className="max-w-2xl space-y-4">
      <h2 className="text-xl font-semibold"><Trans id="Set up reading">Set up reading</Trans></h2>
      <p className="text-[--tsugi-muted]"><Trans id="Tsugi will download and verify its reading engine once. Internet access and a writable application folder are required. No separate Java or manga server installation is needed.">Tsugi will download and verify its reading engine once. Internet access and a writable application folder are required. No separate Java or manga server installation is needed.</Trans></p>
      <div className="border-t border-[--tsugi-line] pt-4">
        <h3 className="font-semibold"><Trans id="Mihon-compatible extensions">Mihon-compatible extensions</Trans></h3>
        <p className="mt-2 text-sm leading-relaxed text-[--tsugi-muted]"><Trans id="Already use Mihon, Komikku or another Tachiyomi-compatible fork? Tsugi supports the same compatible extension repositories. After setup, add a trusted repository URL in Settings → Browse → Sources → Extension repositories, then install individual extensions from Extensions. Sources are not bundled, and compatibility varies by extension.">Already use Mihon, Komikku or another Tachiyomi-compatible fork? Tsugi supports the same compatible extension repositories. After setup, add a trusted repository URL in Settings → Browse → Sources → Extension repositories, then install individual extensions from Extensions. Sources are not bundled, and compatibility varies by extension.</Trans></p>
      </div>
      {busy && <p role="status" className="text-[--tsugi-muted]"><Trans id="Preparing reading engine… This may take a few minutes.">Preparing reading engine… This may take a few minutes.</Trans></p>}
      {error && <p role="alert" className="tsugi-read-error">{error}</p>}
      <div className="flex flex-wrap gap-3">
        <button className="tsugi-read-action" disabled={busy} onClick={() => void setup()}>{busy ? t({ id: "Preparing…", message: "Preparing…" }) : error ? t({ id: "Retry setup", message: "Retry setup" }) : t({ id: "Set up reading", message: "Set up reading" })}</button>
        {openBooks && <button className="tsugi-read-action" disabled={busy} onClick={openBooks}><Trans id="Open local books">Open local books</Trans></button>}
        <button className="tsugi-read-action" disabled={busy} onClick={openWelcome}><Trans id="Back to all media">Back to all media</Trans></button>
      </div>
    </section>
  </main>;
}
