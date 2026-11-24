import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { FiArrowLeft, FiChevronLeft, FiChevronRight, FiSettings, FiMinus, FiPlus } from 'react-icons/fi';
import { readImage, readRequest } from '@/lib/hosts/shell/reading';
import { readerWindow, type ReadingChapter, type ReaderMode } from './reader-utils';

type Props = {
  title: string;
  chapter: ReadingChapter;
  count: number;
  start: number;
  previous?: ReadingChapter;
  next?: ReadingChapter;
  onClose(): void;
  onChapter(chapter: ReadingChapter): void;
  onSaved(index: number, finished: boolean): void;
};
type Page = { url: string; ratio?: number; shown?: boolean; error?: string };
type Preferences = { mode: ReaderMode; width: number; gap: boolean; rtl: boolean };
const DEFAULT: Preferences = { mode: 'scroll', width: 55, gap: false, rtl: false };
function readPreferences(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem('tsugi-reader-preferences') || 'null');
    if (!value) return DEFAULT;
    return {
      mode: ['scroll', 'single', 'spread'].includes(value.mode) ? value.mode : DEFAULT.mode,
      width: typeof value.width === 'number' && Number.isFinite(value.width) ? Math.min(100, Math.max(30, value.width)) : DEFAULT.width,
      gap: value.gap === true,
      rtl: value.rtl === true,
    };
  } catch { return DEFAULT; }
}

export function ChapterReader({ title, chapter, count, start, previous, next, onClose, onChapter, onSaved }: Props) {
  const [preferences, setPreferences] = React.useState(readPreferences);
  const [settings, setSettings] = React.useState(false);
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
  const mode = React.useRef(preferences.mode);
  const closeAction = React.useRef<null | (() => void)>(null);
  const focusedAt = React.useRef(Date.now());
  const saved = React.useRef<number | null>(null);
  const finish = React.useRef(false);
  const completed = React.useRef(chapter.isRead);
  const callbacks = React.useRef({ onSaved });
  callbacks.current = { onSaved };
  const failedSave = React.useRef(false);
  const generation = React.useRef(0);

  React.useEffect(() => {
    try { localStorage.setItem('tsugi-reader-preferences', JSON.stringify(preferences)); } catch { /* optional preference storage */ }
  }, [preferences]);

  function selectPage(page: number) {
    const target = Math.max(0, Math.min(count - 1, page));
    current.current = target;
    focusedAt.current = Date.now();
    failedSave.current = false;
    setSaveError('');
    setIndex(target);
    if (mode.current === 'scroll') pageElements.current.get(target)?.scrollIntoView({ block: 'start' });
  }

  React.useLayoutEffect(() => {
    mode.current = preferences.mode;
    if (preferences.mode === 'scroll') pageElements.current.get(current.current)?.scrollIntoView({ block: 'start' });
  }, [preferences.mode]);

  function trackScroll() {
    const element = viewport.current;
    if (!element || mode.current !== 'scroll' || closing) return;
    const bounds = element.getBoundingClientRect();
    const point = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + Math.min(bounds.height * 0.4, 240));
    const value = point?.closest<HTMLElement>('[data-reader-page]')?.dataset.readerPage;
    const page = value === undefined ? current.current : Number(value);
    if (Number.isInteger(page) && page >= 0 && page < count && page !== current.current) {
      current.current = page;
      focusedAt.current = Date.now();
      failedSave.current = false;
      setSaveError('');
      setIndex(page);
    }
    // Reaching the actual end of the last loaded page, not merely fetching it.
    if (!completed.current && page === count - 1 && memory.current[page]?.shown &&
      element.scrollHeight - element.scrollTop - element.clientHeight < 12) {
      finish.current = true;
    }
  }

  React.useEffect(() => {
    const controller = new AbortController();
    const session = ++generation.current;
    let running = false;
    const alive = () => !controller.signal.aborted && generation.current === session;
    function publish() { if (alive()) setPages({ ...memory.current }); }
    async function tick() {
      if (running || !alive()) return;
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
          } catch (error) {
            if (!alive()) return;
            failedSave.current = true;
            setSaveError(error instanceof Error ? error.message : t`Could not save reading progress.`);
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
          action();
          return;
        }
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
          if (!alive()) return;
          memory.current[missing] = { url: '', error: error instanceof Error ? error.message : t`Could not load this page.` };
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
  }
  function imageFailed(page: number) {
    const entry = memory.current[page];
    if (!entry) return;
    if (entry.url) URL.revokeObjectURL(entry.url);
    memory.current[page] = { url: '', error: t`Could not display this page.` };
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
    selectPage(index + delta * (preferences.mode === 'spread' ? 2 : 1));
  }
  React.useEffect(() => {
    function key(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLSelectElement || event.target instanceof HTMLButtonElement || closing) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const forward = event.key === (preferences.rtl && preferences.mode !== 'scroll' ? 'ArrowLeft' : 'ArrowRight');
        turn(forward ? 1 : -1);
      }
    }
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [index, preferences.mode, preferences.rtl, closing]);

  const displayed = preferences.mode === 'scroll' ? Array.from({ length: count }, (_, page) => page)
    : preferences.mode === 'spread' && index + 1 < count ? [index, index + 1] : [index];
  const canFinish = (index === count - 1 || (preferences.mode === 'spread' && index + 1 === count - 1)) && !!pages[count - 1]?.url;
  return <section className="tsugi-chapter-reader" data-mode={preferences.mode}>
    <header className="tsugi-chapter-toolbar">
      <button className="tsugi-read-action" disabled={closing} onClick={() => leave(onClose)}><FiArrowLeft aria-hidden /><Trans>Chapters</Trans></button>
      <div className="min-w-0 flex-1"><h2 className="truncate font-semibold">{title}</h2><p className="truncate text-xs text-[--tsugi-muted]">{chapter.name}{chapter.scanlator ? ' · ' + chapter.scanlator : ''}</p></div>
      <button className="tsugi-read-action" aria-label={t`Previous chapter`} disabled={closing || !previous} onClick={() => previous && leave(() => onChapter(previous))}><FiChevronLeft aria-hidden /></button>
      <button className="tsugi-read-action" aria-label={t`Next chapter`} disabled={closing || !next} onClick={() => next && leave(() => onChapter(next))}><FiChevronRight aria-hidden /></button>
      <button className="tsugi-read-action" aria-label={t`Reader settings`} aria-expanded={settings} onClick={() => setSettings(!settings)}><FiSettings aria-hidden /></button>
    </header>
    <div className="tsugi-chapter-body">
      <div ref={viewport} className="tsugi-chapter-viewport" onScroll={trackScroll}
        style={{ '--reader-width': preferences.width + '%', '--reader-gap': preferences.gap ? '12px' : '0px' } as React.CSSProperties}>
        <div className="tsugi-chapter-pages" data-direction={preferences.rtl && preferences.mode !== 'scroll' ? 'rtl' : 'ltr'}>
          {displayed.map((page) => <div data-reader-page={page} className="tsugi-chapter-page" key={page}
            ref={(node) => { if (node) pageElements.current.set(page, node); else pageElements.current.delete(page); }}>
            {pages[page]?.url ? <img src={pages[page].url} alt={t`Reading page` + ' ' + (page + 1)} onLoad={(event) => imageLoaded(page, event.currentTarget)} onError={() => imageFailed(page)} />
              : <div className="tsugi-chapter-placeholder" style={{ aspectRatio: ratios[page] || (preferences.mode === 'scroll' ? 0.62 : 0.72) }}>
                <span>{page + 1} / {count}</span>
                {pages[page]?.error ? <><p className="max-w-xs text-center text-xs">{pages[page].error}</p><button className="tsugi-read-action" onClick={() => retry(page)}><Trans>Retry page</Trans></button></> : <Trans>Loading page…</Trans>}
              </div>}
          </div>)}
        </div>
      </div>
      {settings && <aside className="tsugi-chapter-settings">
        <h3 className="font-semibold"><Trans>Reader settings</Trans></h3>
        <label><Trans>Reading mode</Trans><select value={preferences.mode} onChange={(event) => setPreferences((old) => ({ ...old, mode: event.target.value as ReaderMode }))}>
          <option value="scroll"><Trans>Continuous scroll</Trans></option><option value="single"><Trans>Single page</Trans></option><option value="spread"><Trans>Double page</Trans></option>
        </select></label>
        <label><Trans>Page width</Trans><input type="range" min={30} max={100} step={5} value={preferences.width} onChange={(event) => setPreferences((old) => ({ ...old, width: Number(event.target.value) }))} /></label>
        <label className="flex items-center justify-between"><Trans>Space between pages</Trans><input type="checkbox" checked={preferences.gap} onChange={(event) => setPreferences((old) => ({ ...old, gap: event.target.checked }))} /></label>
        <label className="flex items-center justify-between"><Trans>Right to left</Trans><input type="checkbox" disabled={preferences.mode === 'scroll'} checked={preferences.rtl} onChange={(event) => setPreferences((old) => ({ ...old, rtl: event.target.checked }))} /></label>
        <button className="tsugi-read-action" onClick={() => setPreferences(DEFAULT)}><Trans>Reset settings</Trans></button>
      </aside>}
    </div>
    <footer className="tsugi-chapter-toolbar tsugi-chapter-footer">
      <button className="tsugi-read-action" aria-label={t`Previous page`} disabled={closing || index === 0} onClick={() => turn(-1)}><FiChevronLeft aria-hidden /></button>
      <span className="tabular-nums text-sm">{index + 1} / {count}</span>
      <button className="tsugi-read-action" aria-label={t`Next page`} disabled={closing || index + 1 >= count} onClick={() => turn(1)}><FiChevronRight aria-hidden /></button>
      <input className="tsugi-chapter-jump" type="range" min={0} max={Math.max(1, count - 1)} value={index} disabled={count === 1 || closing} aria-label={t`Jump to page`} onChange={(event) => selectPage(Number(event.target.value))} />
      <button className="tsugi-read-action" aria-label={t`Decrease page width`} onClick={() => setPreferences((old) => ({ ...old, width: Math.max(30, old.width - 5) }))}><FiMinus aria-hidden /></button>
      <span className="text-sm tabular-nums">{preferences.width}%</span>
      <button className="tsugi-read-action" aria-label={t`Increase page width`} onClick={() => setPreferences((old) => ({ ...old, width: Math.min(100, old.width + 5) }))}><FiPlus aria-hidden /></button>
      {canFinish && <button className="tsugi-read-action" disabled={closing} onClick={() => leave(next ? () => onChapter(next) : onClose, true)}>{next ? t`Finish and continue` : t`Finish chapter`}</button>}
      {closing ? <span className="text-xs"><Trans>Saving progress…</Trans></span> : lastSaved !== null && <span className="text-xs text-[--tsugi-muted]"><Trans>Progress saved</Trans></span>}
    </footer>
    {saveError && <div className="tsugi-read-error" role="alert">{saveError} <button className="tsugi-read-action" onClick={() => { failedSave.current = false; setSaveError(''); }}><Trans>Retry</Trans></button><button className="tsugi-read-action" onClick={onClose}><Trans>Exit without saving</Trans></button></div>}
  </section>;
}
