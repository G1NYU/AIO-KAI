import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { BrushBack, BrushLeft, BrushRight } from '@/components/tsugi-icons';
import { storage } from '@/lib/storage';
import { updateBook, validBookProgress, type BookEntry } from './book-library';

type Tone = 'dark' | 'paper' | 'light';
type Flow = 'paginated' | 'scrolled';
type Appearance = { font: number; tone: Tone; flow: Flow };
type TocItem = { label: string; target: string };
const key = 'tsugi-ebook-appearance-v1';
function initialAppearance(): Appearance {
  const saved = storage.get<Partial<Appearance>>(key);
  return {
    font: typeof saved?.font === 'number' && saved.font >= 12 && saved.font <= 32 ? saved.font : 18,
    tone: saved?.tone === 'paper' || saved?.tone === 'light' ? saved.tone : 'dark',
    flow: saved?.flow === 'scrolled' ? 'scrolled' : 'paginated',
  };
}
function isolatedOrigin() {
  if (location.origin === 'http://aiostreams.localhost') return 'http://tsugi-books.localhost';
  if (location.hostname === '127.0.0.1' && location.protocol === 'http:') return new URL(location.href.replace('127.0.0.1', 'localhost')).origin;
  return null;
}
function tocItems(input: unknown): TocItem[] {
  return Array.isArray(input) ? input.filter((item): item is TocItem =>
    !!item && typeof item.label === 'string' && item.label.length <= 1000 &&
    typeof item.target === 'string' && item.target.length <= 4000).slice(0, 500) : [];
}

export function BookReader({ entry, file, onClose }: { entry: BookEntry; file: File; onClose: () => void }) {
  const origin = isolatedOrigin();
  const frame = useRef<HTMLIFrameElement>(null);
  const sent = useRef(false);
  const writing = useRef<Promise<void>>(Promise.resolve());
  const [appearance, setAppearance] = useState(initialAppearance);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [title, setTitle] = useState(entry.title);
  const [fraction, setFraction] = useState(entry.fraction || 0);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(typeof entry.position === 'number' ? entry.position : 1);
  const [closing, setClosing] = useState(false);
  const send = useCallback((type: string, data: Record<string, unknown> = {}) => {
    if (origin) frame.current?.contentWindow?.postMessage({ channel: 'tsugi-ebook', type, ...data }, origin);
  }, [origin]);
  const persist = useCallback((patch: Parameters<typeof updateBook>[1]) => {
    writing.current = writing.current.catch(() => {}).then(() => updateBook(entry.id, patch)).catch(() => {
      setError(t`Could not save local reading progress.`);
    });
  }, [entry.id]);
  const init = useCallback(() => {
    if (sent.current) return;
    sent.current = true;
    send('open', { file, position: entry.position, ...appearance });
  }, [file, entry.position, appearance, send]);
  useEffect(() => {
    if (!origin) return;
    const receive = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== frame.current?.contentWindow || event.data?.channel !== 'tsugi-ebook') return;
      const message = event.data;
      if (message.type === 'ready') init();
      if (message.type === 'error') setError(t`This ebook could not be opened or rendered.`);
      if (message.type === 'opened' && message.format === entry.format) {
        setReady(true);
        if (typeof message.title === 'string' && message.title.length <= 1000) {
          setTitle(message.title); persist({ title: message.title });
        }
        setToc(tocItems(message.toc));
        if (typeof message.pages === 'number' && Number.isSafeInteger(message.pages) && message.pages > 0 && message.pages <= 20000) setPages(message.pages);
      }
      if (message.type === 'progress') {
        const progress = validBookProgress(entry.format, message.position, message.fraction);
        if (!progress) return;
        setFraction(progress.fraction);
        if (typeof progress.position === 'number') setPage(progress.position);
        persist(progress);
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [entry.format, init, origin, persist]);
  useEffect(() => {
    if (ready || error || !origin) return;
    const timer = window.setTimeout(() => setError(t`The isolated ebook engine did not respond.`), 30000);
    return () => window.clearTimeout(timer);
  }, [ready, error, origin]);
  function change(next: Appearance) {
    setAppearance(next); storage.set(key, next); send('appearance', next);
  }
  async function close() {
    setClosing(true);
    await writing.current;
    onClose();
  }
  return <section className="tsugi-book-reader" data-ui="tsugi-book-reader">
    <header className="tsugi-chapter-toolbar tsugi-book-toolbar">
      <button type="button" className="tsugi-read-action" disabled={closing} onClick={() => void close()}><BrushBack aria-hidden/><Trans>Back to books</Trans></button>
      <strong className="truncate">{title}</strong>
      <span data-ui="book-progress">{Math.round(fraction * 100)}%</span>
      <button type="button" className="tsugi-read-action" aria-label={t`Previous page`} disabled={!ready || closing} onClick={() => send('prev')}><BrushLeft aria-hidden/></button>
      <button type="button" className="tsugi-read-action" aria-label={t`Next page`} disabled={!ready || closing} onClick={() => send('next')}><BrushRight aria-hidden/></button>
    </header>
    <div className="tsugi-book-preferences">
      {entry.format === 'epub' ? <>
        <label><Trans>Font size</Trans><input type="range" min={12} max={32} value={appearance.font} onChange={event => change({ ...appearance, font: Number(event.target.value) })}/></label>
        <label><Trans>Page layout</Trans><select className="tsugi-read-input" value={appearance.flow} onChange={event => change({ ...appearance, flow: event.target.value === 'scrolled' ? 'scrolled' : 'paginated' })}><option value="paginated"><Trans>Paginated</Trans></option><option value="scrolled"><Trans>Continuous scroll</Trans></option></select></label>
        <label><Trans>Paper</Trans><select className="tsugi-read-input" value={appearance.tone} onChange={event => change({ ...appearance, tone: event.target.value === 'paper' ? 'paper' : event.target.value === 'light' ? 'light' : 'dark' })}><option value="dark"><Trans>Dark</Trans></option><option value="paper"><Trans>Sepia</Trans></option><option value="light"><Trans>Light</Trans></option></select></label>
        {!!toc.length && <label><Trans>Contents</Trans><select className="tsugi-read-input" value="" onChange={event => { if (event.target.value) send('go', { target: event.target.value }); }}><option value=""><Trans>Choose chapter</Trans></option>{toc.map((item,i) => <option key={i} value={item.target}>{item.label}</option>)}</select></label>}
      </> : pages > 0 && <label><Trans>Page</Trans><input className="tsugi-read-input" type="number" min={1} max={pages} value={page} onChange={event => { const next = Number(event.target.value); if (Number.isInteger(next) && next >= 1 && next <= pages) send('go', { target: next }); }}/><span>/ {pages}</span></label>}
    </div>
    {!ready && !error && <p role="status"><Trans>Opening local book…</Trans></p>}
    {error && <p role="alert" className="tsugi-read-error">{error}</p>}
    {origin ? <iframe ref={frame} title={t`Isolated ebook renderer`} sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer" src={new URL('/tsugi-books/index.html', origin).href} onLoad={() => send('hello')}/> : <p role="alert"><Trans>The isolated ebook engine requires a supported Windows build.</Trans></p>}
  </section>;
}
