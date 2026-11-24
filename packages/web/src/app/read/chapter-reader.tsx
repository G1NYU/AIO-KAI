import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { FiArrowLeft, FiChevronLeft, FiChevronRight, FiSettings, FiMinus, FiPlus, FiMaximize, FiMinimize, FiList } from 'react-icons/fi';
import { TsugiMediaIcon } from '@/components/tsugi-brand';
import { readImage, readRequest } from '@/lib/hosts/shell/reading';
import { readerWindow, nextPageIndex, visibleReadingPage, chapterGroups, type ReadingChapter } from './reader-utils';
import { ReaderSettings } from './reader-settings';
import { readReaderPreferences, saveReaderPreferences, READER_DEFAULTS } from './reader-preferences';

type Props = {
  title: string;
  visible: boolean;
  onMusic?: () => void;
  onAppSettings?: () => void;
  chapter: ReadingChapter;
  count: number;
  start: number;
  chapters: ReadingChapter[];
  previous?: ReadingChapter;
  next?: ReadingChapter;
  onClose(): void;
  onChapter(chapter: ReadingChapter): void;
  onSaved(index: number, finished: boolean): void;
};
type Page = { url: string; ratio?: number; shown?: boolean; error?: string };
export function ChapterReader({ title, visible, onMusic, onAppSettings, chapter, count, start, chapters, previous, next, onClose, onChapter, onSaved }: Props) {
  const [preferences, setPreferences] = React.useState(readReaderPreferences);
  const [settings, setSettings] = React.useState(false);
  const [chapterMenu, setChapterMenu] = React.useState(false);
  const [chapterQuery, setChapterQuery] = React.useState('');
  const [chapterDescending, setChapterDescending] = React.useState(false);
  const [chromeVisible, setChromeVisible] = React.useState(true);
  const [readAtEnd, setReadAtEnd] = React.useState(false);
  const [index, setIndex] = React.useState(start);
  const [pages, setPages] = React.useState<Record<number, Page>>({});
  const [ratios, setRatios] = React.useState<Record<number, number>>({});
  const [saveError, setSaveError] = React.useState('');
  const [lastSaved, setLastSaved] = React.useState<number | null>(null);
  const [closing, setClosing] = React.useState(false);
  const viewport = React.useRef<HTMLDivElement>(null);
  const pageElements = React.useRef(new Map<number, HTMLDivElement>());
  const memory = React.useRef<Record<number, Page>>({});
  const current = React.useRef(index);
  const visibleRef = React.useRef(visible);
  visibleRef.current = visible;
  const anchor = React.useRef({ index: start, fraction: 0 });
  const mode = React.useRef(preferences.mode);
  const closeAction = React.useRef<null | (() => void)>(null);
  const focusedAt = React.useRef(Date.now());
  const saved = React.useRef<number | null>(null);
  const finish = React.useRef(false);
  const completed = React.useRef(chapter.isRead);
  const callbacks = React.useRef({ onSaved, onChapter, next, autoNext: preferences.autoNext });
  callbacks.current = { onSaved, onChapter, next, autoNext: preferences.autoNext };
  const progressFrame = React.useRef(0);
  const failedSave = React.useRef(false);
  const generation = React.useRef(0);

  React.useEffect(() => {
    saveReaderPreferences(preferences);
  }, [preferences]);

  function selectPage(page: number) {
    const target = Math.max(0, Math.min(count - 1, page));
    current.current = target;
    anchor.current = { index: target, fraction: 0 };
    focusedAt.current = Date.now();
    failedSave.current = false;
    setSaveError('');
    setReadAtEnd(false);
    setIndex(target);
    if (mode.current === 'scroll') jumpTo(target);
    else if (viewport.current) viewport.current.scrollTop = 0;
  }

  function jumpTo(page: number) {
    const node = pageElements.current.get(page);
    const root = viewport.current;
    if (node && root) root.scrollTop += node.getBoundingClientRect().top - root.getBoundingClientRect().top;
  }

  React.useLayoutEffect(() => {
    const changedMode = mode.current !== preferences.mode;
    mode.current = preferences.mode;
    const root = viewport.current;
    if (!root || !visible) return;
    if (preferences.mode === 'scroll') {
      const node = pageElements.current.get(anchor.current.index);
      if (node) {
        const rect = node.getBoundingClientRect();
        const bounds = root.getBoundingClientRect();
        root.scrollTop += rect.top - bounds.top + rect.height * anchor.current.fraction;
      } else jumpTo(current.current);
    } else if (changedMode) root.scrollTop = 0;
  }, [preferences.mode, preferences.width, preferences.gap, preferences.focus, settings, chapterMenu, visible]);

  function trackScroll() {
    const element = viewport.current;
    if (!element || !visibleRef.current || mode.current !== 'scroll' || closing) return;
    const bounds = element.getBoundingClientRect();
    const line = bounds.top + Math.min(bounds.height * 0.35, 220);
    // Inspect the actual page geometry. Pointer hit-testing fails in gaps
    // and when a settings drawer overlays the center of the viewport.
    let lo = 0, hi = count - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      const rect = pageElements.current.get(mid)?.getBoundingClientRect();
      if (!rect || rect.bottom >= line) hi = mid;
      else lo = mid + 1;
    }
    const nearby = [lo - 1, lo, lo + 1].flatMap((index) => {
      const rect = pageElements.current.get(index)?.getBoundingClientRect();
      return rect ? [{ index, top: rect.top, bottom: rect.bottom }] : [];
    });
    const page = visibleReadingPage(nearby, line) ?? current.current;
    // The top edge is the zoom anchor, independent of the progress reading line.
    let topLo = 0, topHi = count - 1;
    while (topLo < topHi) {
      const mid = Math.floor((topLo + topHi) / 2);
      const rect = pageElements.current.get(mid)?.getBoundingClientRect();
      if (!rect || rect.bottom > bounds.top) topHi = mid;
      else topLo = mid + 1;
    }
    const topRect = pageElements.current.get(topLo)?.getBoundingClientRect();
    if (topRect?.height) anchor.current = { index: topLo, fraction: Math.min(1, Math.max(0, (bounds.top - topRect.top) / topRect.height)) };
    if (Number.isInteger(page) && page >= 0 && page < count && page !== current.current) {
      current.current = page;
      focusedAt.current = Date.now();
      failedSave.current = false;
      setSaveError('');
      setIndex(page);
    }
    // Reaching the actual end of the last loaded page, not merely fetching it.
    const last = pageElements.current.get(count - 1)?.getBoundingClientRect();
    const atEnd = !!last && last.top < bounds.bottom && last.bottom <= bounds.bottom + 12 && memory.current[count - 1]?.shown === true &&
      element.scrollHeight - element.scrollTop - element.clientHeight < 12;
    setReadAtEnd(atEnd);
    if (!completed.current && atEnd) finish.current = true;
  }

  function queueScroll() {
    cancelAnimationFrame(progressFrame.current);
    progressFrame.current = requestAnimationFrame(trackScroll);
  }
  React.useEffect(() => () => cancelAnimationFrame(progressFrame.current), []);
  React.useEffect(() => {
    const root = viewport.current;
    if (!root || !preferences.wheelZoom) return;
    function zoom(event: WheelEvent) {
      if (!event.ctrlKey) return;
      event.preventDefault();
      setPreferences((old) => ({ ...old, width: Math.min(100, Math.max(25, old.width + (event.deltaY < 0 ? 5 : -5))) }));
    }
    root.addEventListener('wheel', zoom, { passive: false });
    return () => root.removeEventListener('wheel', zoom);
  }, [preferences.wheelZoom]);

  React.useEffect(() => {
    const controller = new AbortController();
    const session = ++generation.current;
    let running = false;
    const alive = () => !controller.signal.aborted && generation.current === session;
    function publish() { if (alive()) setPages({ ...memory.current }); }
    async function tick() {
      if (running || !alive() || !visibleRef.current) return;
      running = true;
      try {
        const page = current.current;
        const visible = mode.current === 'spread' && page + 1 < count && memory.current[page + 1]?.shown ? page + 1 : page;
        const wantFinish = finish.current && memory.current[count - 1]?.shown === true;
        const progress = wantFinish ? count - 1 : visible;
        const exiting = closeAction.current;
        const shouldSave = memory.current[progress]?.shown && !failedSave.current &&
          (saved.current !== progress || wantFinish) && (exiting || wantFinish || Date.now() - focusedAt.current >= 550);
        if (shouldSave) {
          try {
            await readRequest({ kind: 'progress', chapterId: chapter.id, index: progress, finished: wantFinish });
            if (!alive()) return;
            saved.current = progress;
            finish.current = false;
            if (wantFinish) completed.current = true;
            setLastSaved(progress);
            setSaveError('');
            callbacks.current.onSaved(progress, wantFinish);
            if (visibleRef.current && wantFinish && mode.current === 'scroll' && !closeAction.current && callbacks.current.autoNext && callbacks.current.next) {
              const nextChapter = callbacks.current.next;
              closeAction.current = () => callbacks.current.onChapter(nextChapter);
              setClosing(true);
            }
          } catch (error) {
            if (!alive()) return;
            failedSave.current = true;
            setSaveError(error instanceof Error ? error.message : t({ id: "Could not save reading progress.", message: "Could not save reading progress." }));
          }
        }
        if (!alive()) return;
        if (closeAction.current) {
          if (failedSave.current) {
            closeAction.current = null;
            setClosing(false);
            return;
          }
          const action = closeAction.current;
          closeAction.current = null;
          // Switching to Music keeps this reader mounted; release the busy
          // state before executing the navigation callback.
          setClosing(false);
          action();
          return;
        }
        if (!visibleRef.current) return;
        const wanted = readerWindow(current.current, count, mode.current);
        let evicted = false;
        for (const key of Object.keys(memory.current)) {
          const number = Number(key);
          if (!wanted.includes(number)) {
            const url = memory.current[number].url;
            if (url) URL.revokeObjectURL(url);
            delete memory.current[number];
            evicted = true;
          }
        }
        if (evicted) publish();
        const missing = wanted.find((number) => !memory.current[number]);
        if (missing === undefined) return;
        try {
          const url = await readImage({ kind: 'page', chapterId: chapter.id, index: missing }, controller.signal);
          if (!alive()) { URL.revokeObjectURL(url); return; }
          if (!readerWindow(current.current, count, mode.current).includes(missing)) { URL.revokeObjectURL(url); return; }
          memory.current[missing] = { url };
        } catch (error) {
          if (!alive() || !readerWindow(current.current, count, mode.current).includes(missing)) return;
          memory.current[missing] = { url: '', error: error instanceof Error ? error.message : t({ id: "Could not load this page.", message: "Could not load this page." }) };
        }
        publish();
      } finally { running = false; }
    }
    const timer = window.setInterval(() => void tick(), 160);
    void tick();
    return () => {
      controller.abort();
      window.clearInterval(timer);
      for (const page of Object.values(memory.current)) if (page.url) URL.revokeObjectURL(page.url);
      memory.current = {};
    };
  }, [chapter.id, count]);

  function imageLoaded(page: number, image: HTMLImageElement) {
    const entry = memory.current[page];
    if (!entry || entry.url !== image.getAttribute('src')) return;
    if (image.naturalWidth && image.naturalHeight) {
      const ratio = image.naturalWidth / image.naturalHeight;
      entry.ratio = ratio;
      setRatios((old) => old[page] === ratio ? old : { ...old, [page]: ratio });
    }
    entry.shown = true;
    setPages({ ...memory.current });
    // A one-page chapter can be fully visible without a scroll event.
    if (mode.current === 'scroll') queueScroll();
  }
  function imageFailed(page: number) {
    const entry = memory.current[page];
    if (!entry) return;
    if (entry.url) URL.revokeObjectURL(entry.url);
    memory.current[page] = { url: '', error: t({ id: "Could not display this page.", message: "Could not display this page." }) };
    setPages({ ...memory.current });
  }
  function retry(page: number) {
    delete memory.current[page];
    setPages({ ...memory.current });
  }
  function leave(action: () => void, complete = false) {
    if (closing) return;
    if (complete) {
      if (!memory.current[count - 1]?.shown) return;
      finish.current = !completed.current;
    }
    failedSave.current = false;
    closeAction.current = action;
    setClosing(true);
    setSaveError('');
  }
  function turn(delta: number) {
    selectPage(nextPageIndex(index, count, preferences.mode, delta));
  }
  React.useEffect(() => {
    function key(event: KeyboardEvent) {
      if (!visibleRef.current || document.querySelector('dialog[open]')) return;
      if (event.key === 'Escape' && !closing) { event.preventDefault(); if (settings) setSettings(false); else if (chapterMenu) setChapterMenu(false); else leave(onClose); return; }
      if (event.altKey || event.ctrlKey || event.metaKey || event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement || closing) return;
      if (event.key.toLowerCase() === 'f') { setPreferences((old) => ({ ...old, focus: !old.focus })); return; }
      if (event.key.toLowerCase() === 's') { setSettings((old) => !old); setChapterMenu(false); return; }
      if ((event.key === 'ArrowUp' || event.key === 'ArrowDown' || (event.key === ' ' && !(event.target instanceof HTMLButtonElement))) && preferences.mode === 'scroll') {
        event.preventDefault();
        viewport.current?.scrollBy({ top: event.key === 'ArrowUp' || (event.key === ' ' && event.shiftKey) ? -160 : 160, behavior: 'smooth' });
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const forward = event.key === (preferences.rtl && preferences.mode !== 'scroll' ? 'ArrowLeft' : 'ArrowRight');
        turn(forward ? 1 : -1);
      }
    }
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [index, preferences.mode, preferences.rtl, closing, settings, chapterMenu, onClose]);

  const displayed = preferences.mode === 'scroll' ? Array.from({ length: count }, (_, page) => page)
    : preferences.mode === 'spread' && index + 1 < count ? [index, index + 1] : [index];
  const canFinish = (preferences.mode === 'scroll' ? readAtEnd : index === count - 1 || (preferences.mode === 'spread' && index + 1 === count - 1)) && !!pages[count - 1]?.shown;
  const menuGroups = chapterGroups(chapters).filter((group) => group.some((item) => (item.name + ' ' + (item.scanlator || '')).toLowerCase().includes(chapterQuery.toLowerCase())));
  if (chapterDescending) menuGroups.reverse();
  return <section className="tsugi-chapter-reader" data-active={visible ? 'true' : 'false'} data-mode={preferences.mode} data-fit={preferences.mode === 'scroll' ? 'width' : preferences.fit} data-background={preferences.background}
    data-focus={preferences.focus && !settings && !chapterMenu && !chromeVisible && !closing && !saveError ? 'hidden' : 'visible'}
    data-focus-enabled={preferences.focus && !settings && !chapterMenu ? 'true' : 'false'}
    onPointerMove={(event) => {
      if (!preferences.focus) return;
      const height = window.innerHeight;
      setChromeVisible(event.clientY < 105 || event.clientY > height - 90);
    }}>

    <header className="tsugi-chapter-toolbar">
      <button className="tsugi-read-action" disabled={closing} onClick={() => leave(onClose)}><FiArrowLeft aria-hidden /><Trans id="Chapters">Chapters</Trans></button>
      <div className="min-w-0 flex-1"><h2 className="truncate font-semibold">{title}</h2><p className="truncate text-xs text-[--tsugi-muted]">{chapter.name}{chapter.scanlator ? ' · ' + chapter.scanlator : ''}</p></div>
      <button className="tsugi-read-action" aria-label={t({ id: "Chapter list", message: "Chapter list" })} aria-expanded={chapterMenu} onClick={() => { setChapterMenu(!chapterMenu); setSettings(false); }}><FiList aria-hidden /><span className="tsugi-reader-chapter-label">{chapter.name}</span></button>
      <button className="tsugi-read-action" aria-label={t({ id: "Previous chapter", message: "Previous chapter" })} disabled={closing || !previous} onClick={() => previous && leave(() => onChapter(previous))}><FiChevronLeft aria-hidden /></button>
      <button className="tsugi-read-action" aria-label={t({ id: "Next chapter", message: "Next chapter" })} disabled={closing || !next} onClick={() => next && leave(() => onChapter(next))}><FiChevronRight aria-hidden /></button>
      {onMusic && <button className="tsugi-read-action" disabled={closing} onClick={() => leave(onMusic)} aria-label={t({ id: "Music", message: "Music" })}><TsugiMediaIcon area="music" /></button>}
      {onAppSettings && <button className="tsugi-read-action" disabled={closing} onClick={onAppSettings} aria-label={t({ id: "App settings", message: "App settings" })}><FiSettings aria-hidden /><span className="tsugi-reader-chapter-label"><Trans id="App settings">App settings</Trans></span></button>}
      <button className="tsugi-read-action" aria-label={t({ id: "Reader settings", message: "Reader settings" })} aria-expanded={settings} onClick={() => { setSettings(!settings); setChapterMenu(false); }}><FiSettings aria-hidden /></button>
      <button className="tsugi-read-action" aria-label={t({ id: "Focus mode", message: "Focus mode" })} aria-pressed={preferences.focus} onClick={() => { setPreferences((old) => ({ ...old, focus: !old.focus })); setChromeVisible(false); }}>{preferences.focus ? <FiMinimize aria-hidden /> : <FiMaximize aria-hidden />}</button>
    </header>
    <div className="tsugi-chapter-body">
      <div ref={viewport} className="tsugi-chapter-viewport" onScroll={queueScroll}
        style={{ '--reader-width': preferences.width + '%', '--reader-gap': preferences.gap ? '12px' : '0px', '--reader-height': Math.round(preferences.width / READER_DEFAULTS.width * 85) + 'vh' } as React.CSSProperties}>
        <div className="tsugi-chapter-pages" data-direction={preferences.rtl && preferences.mode !== 'scroll' ? 'rtl' : 'ltr'}>
          {displayed.map((page) => <div data-reader-page={page} className="tsugi-chapter-page" key={page}
            ref={(node) => { if (node) pageElements.current.set(page, node); else pageElements.current.delete(page); }}>
            {pages[page]?.url ? <img src={pages[page].url} alt={t({ id: "Reading page", message: "Reading page" }) + ' ' + (page + 1)} onLoad={(event) => imageLoaded(page, event.currentTarget)} onError={() => imageFailed(page)} />
              : <div className="tsugi-chapter-placeholder" style={{ aspectRatio: ratios[page] || (preferences.mode === 'scroll' ? 0.62 : 0.72) }}>
                <span>{page + 1} / {count}</span>
                {pages[page]?.error ? <><p className="max-w-xs text-center text-xs">{pages[page].error}</p><button className="tsugi-read-action" onClick={() => retry(page)}><Trans id="Retry page">Retry page</Trans></button></> : <Trans id="Loading page…">Loading page…</Trans>}
              </div>}
          </div>)}
        </div>
      </div>
      {settings && <aside className="tsugi-chapter-settings"><ReaderSettings value={preferences} onChange={setPreferences} onClose={() => setSettings(false)} /></aside>}
      {chapterMenu && <aside className="tsugi-chapter-settings tsugi-reader-chapter-menu">
        <h3 className="font-semibold"><Trans id="Chapters">Chapters</Trans></h3>
        <input className="tsugi-read-input" value={chapterQuery} onChange={(event) => setChapterQuery(event.target.value)} placeholder={t({ id: "Find a chapter", message: "Find a chapter" })} aria-label={t({ id: "Find a chapter", message: "Find a chapter" })} />
        <button className="tsugi-reader-link" onClick={() => setChapterDescending(!chapterDescending)}>{chapterDescending ? t({ id: "Newest first", message: "Newest first" }) : t({ id: "Oldest first", message: "Oldest first" })}</button>
        {menuGroups.map((group) => <div key={group[0].id} className="tsugi-reader-chapter-group">{group.map((item) => <button key={item.id} className="tsugi-read-row" aria-current={item.id === chapter.id ? 'page' : undefined} disabled={closing || item.id === chapter.id} onClick={() => leave(() => onChapter(item))}><span>{item.name}{item.scanlator && <small className="block text-[--tsugi-muted]">{item.scanlator}</small>}</span><small>{item.isRead ? t({ id: "Read", message: "Read" }) : item.lastPageRead > 0 ? t({ id: "Resume", message: "Resume" }) : ''}</small></button>)}</div>)}
      </aside>}
    </div>
    <footer className="tsugi-chapter-toolbar tsugi-chapter-footer">
      <button className="tsugi-read-action" aria-label={t({ id: "Previous page", message: "Previous page" })} disabled={closing || index === 0} onClick={() => turn(-1)}><FiChevronLeft aria-hidden /></button>
      <span className="tabular-nums text-sm">{index + 1} / {count}</span>
      <button className="tsugi-read-action" aria-label={t({ id: "Next page", message: "Next page" })} disabled={closing || index + 1 >= count} onClick={() => turn(1)}><FiChevronRight aria-hidden /></button>
      <input className="tsugi-chapter-jump" type="range" min={0} max={Math.max(1, count - 1)} value={index} disabled={count === 1 || closing} aria-label={t({ id: "Jump to page", message: "Jump to page" })} onChange={(event) => selectPage(Number(event.target.value))} />
      <button className="tsugi-read-action" aria-label={t({ id: "Decrease page width", message: "Decrease page width" })} onClick={() => setPreferences((old) => ({ ...old, width: Math.max(25, old.width - 5) }))}><FiMinus aria-hidden /></button>
      <button className="tsugi-reader-link text-sm tabular-nums" aria-label={t({ id: "Reset page size", message: "Reset page size" })} onClick={() => setPreferences((old) => ({ ...old, width: READER_DEFAULTS.width }))}>{preferences.width}%</button>
      <button className="tsugi-read-action" aria-label={t({ id: "Increase page width", message: "Increase page width" })} onClick={() => setPreferences((old) => ({ ...old, width: Math.min(100, old.width + 5) }))}><FiPlus aria-hidden /></button>
      {canFinish && <button className="tsugi-read-action" disabled={closing} onClick={() => leave(next ? () => onChapter(next) : onClose, true)}>{next ? t({ id: "Finish and continue", message: "Finish and continue" }) : t({ id: "Finish chapter", message: "Finish chapter" })}</button>}
      {closing ? <span className="text-xs"><Trans id="Saving progress…">Saving progress…</Trans></span> : lastSaved !== null && <span className="text-xs text-[--tsugi-muted]"><Trans id="Progress saved">Progress saved</Trans></span>}
    </footer>
    {saveError && <div className="tsugi-read-error" role="alert">{saveError} <button className="tsugi-read-action" onClick={() => { failedSave.current = false; setSaveError(''); }}><Trans id="Retry">Retry</Trans></button><button className="tsugi-read-action" onClick={onClose}><Trans id="Exit without saving">Exit without saving</Trans></button></div>}
  </section>;
}
