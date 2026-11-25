import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { FiArrowRight, FiCheck, FiSearch } from 'react-icons/fi';
import { readRequest } from '@/lib/hosts/shell/reading';
import type { ReadingChapter } from './reader-utils';
import { batchTitles, migrationPlan, titleKey } from './collection-transfer-utils';

type Title = { id: number | string; sourceId?: string; title: string; author?: string | null; inLibrary: boolean; categories?: { nodes: { id: number }[] } };
type Source = { id: string; name: string; displayName?: string; lang: string };
type Details = { manga: Title; chapters: ReadingChapter[] };
type Props = { library: Title[]; sources: Source[]; busy: boolean; run: (work: () => Promise<void>) => Promise<void>; reload: () => Promise<void> };
type BatchRow = { title: string; options: Title[]; selected: string; status: string; finished?: boolean };
const idOf = (item: Title) => Number(item.id);
const errorMessage = (error: unknown) => error instanceof Error ? error.message : t({ id: "Reading request failed.", message: "Reading request failed." });
async function search(source: string, title: string) {
  const result = await readRequest<{ mangas: Title[] }>({ kind: 'catalogue', source, page: 1, mode: 'search', query: title });
  return [...new Map(result.mangas.map(item => [String(item.id), item])).values()];
}
const cached = (id: number) => readRequest<Details>({ kind: 'cached-manga', id });
const SourcePicker = ({ sources, source, onChange, busy, label }: { sources: Source[]; source: string; onChange: (value: string) => void; busy: boolean; label: string }) => (
  <select className="tsugi-read-input min-w-0" aria-label={label} value={source} disabled={busy} onChange={event => onChange(event.target.value)}>
    <option value=""><Trans id="Choose installed source">Choose installed source</Trans></option>
    {sources.map(item => <option key={item.id} value={item.id}>{item.displayName || item.name} · {item.lang}</option>)}
  </select>
);
function chunks(ids: number[]) {
  const groups: number[][] = [];
  for (let i = 0; i < ids.length; i += 2000) groups.push(ids.slice(i, i + 2000));
  return groups;
}
export function MigrationWorkspace({ library, sources, busy, run, reload }: Props) {
  const [originalId, setOriginalId] = React.useState('');
  const [source, setSource] = React.useState('');
  const [term, setTerm] = React.useState('');
  const [results, setResults] = React.useState<Title[] | null>(null);
  const [preview, setPreview] = React.useState<{ original: Details; replacement: Details } | null>(null);
  const [message, setMessage] = React.useState('');
  const original = library.find(item => String(item.id) === originalId);
  const plan = preview && migrationPlan(preview.original.chapters, preview.replacement.chapters);
  const reset = () => { setResults(null); setPreview(null); setMessage(''); };
  async function prepare(item: Title) {
    if (!original || idOf(original) === idOf(item)) throw new Error(t({ id: "Choose a different edition.", message: "Choose a different edition." }));
    const from = await cached(idOf(original));
    const to = await readRequest<Details>({ kind: 'manga', id: idOf(item) });
    if (!from.manga.inLibrary || from.manga.sourceId === to.manga.sourceId && from.manga.sourceId) throw new Error(t({ id: "Choose a saved title and a different source.", message: "Choose a saved title and a different source." }));
    if (!to.chapters.length) throw new Error(t({ id: "Replacement has no chapters.", message: "Replacement has no chapters." }));
    setPreview({ original: from, replacement: to }); setMessage('');
  }
  async function apply() {
    if (!preview || !plan) return;
    const from = await cached(idOf(preview.original.manga)), to = await cached(idOf(preview.replacement.manga));
    if (!from.manga.inLibrary || idOf(from.manga) === idOf(to.manga) || !to.chapters.length) throw new Error(t({ id: "The original or replacement changed. Create a new preview.", message: "The original or replacement changed. Create a new preview." }));
    const next = migrationPlan(from.chapters, to.chapters);
    if (JSON.stringify(next) !== JSON.stringify(plan)) {
      setPreview({ original: from, replacement: to });
      throw new Error(t({ id: "Chapter state changed. Review the updated preview before applying.", message: "Chapter state changed. Review the updated preview before applying." }));
    }
    try {
      await readRequest({ kind: 'set-library', id: idOf(to.manga), inLibrary: true });
      for (const ids of chunks(next.read)) await readRequest({ kind: 'chapter-flags', ids, read: true });
      for (const ids of chunks(next.bookmarked)) await readRequest({ kind: 'chapter-flags', ids, bookmarked: true });
      for (const category of from.manga.categories?.nodes || []) if (category.id > 0 && !to.manga.categories?.nodes.some(item => item.id === category.id))
        await readRequest({ kind: 'assign-category', mangaId: idOf(to.manga), categoryId: category.id, assigned: true });
      const verified = await cached(idOf(to.manga));
      if (!verified.manga.inLibrary || next.read.some(id => !verified.chapters.some(chapter => chapter.id === id && chapter.isRead)) ||
          next.bookmarked.some(id => !verified.chapters.some(chapter => chapter.id === id && chapter.isBookmarked)) ||
          (from.manga.categories?.nodes || []).some(category => category.id > 0 && !verified.manga.categories?.nodes.some(item => item.id === category.id)))
        throw new Error(t({ id: "Replacement saved but transfer verification failed. The original is unchanged.", message: "Replacement saved but transfer verification failed. The original is unchanged." }));
      setMessage(t({ id: "Replacement verified. Original retained. Review unmatched chapters and page progress before removing it manually.", message: "Replacement verified. Original retained. Review unmatched chapters and page progress before removing it manually." }));
      setPreview(null);
    } catch (error) {
      setPreview(null);
      throw new Error(t({ id: "Transfer stopped; the original is unchanged. The replacement may contain partial changes. Reopen the preview to retry. ", message: "Transfer stopped; the original is unchanged. The replacement may contain partial changes. Reopen the preview to retry. " }) + errorMessage(error));
    } finally { await reload(); }
  }
  return <section className="tsugi-transfer-workspace">
    <div className="tsugi-transfer-intro"><h2><Trans id="Move to a working source">Move to a working source</Trans></h2><p><Trans id="Search for a replacement edition and preview completed chapters and bookmarks. The original is read from the local database, not its extension, and is never removed automatically.">Search for a replacement edition and preview completed chapters and bookmarks. The original is read from the local database, not its extension, and is never removed automatically.</Trans></p></div>
    <div className="tsugi-transfer-form">
      <label><Trans id="Saved title">Saved title</Trans><select className="tsugi-read-input" aria-label={t({ id: "Original title", message: "Original title" })} disabled={busy} value={originalId} onChange={event => { setOriginalId(event.target.value); setTerm(library.find(item => String(item.id) === event.target.value)?.title || ''); setSource(''); reset(); }}><option value=""><Trans id="Choose a saved title">Choose a saved title</Trans></option>{library.map(item => <option key={item.id} value={String(item.id)}>{item.title}</option>)}</select></label>
      <label><Trans id="Replacement source">Replacement source</Trans><SourcePicker label={t({ id: "Replacement source", message: "Replacement source" })} sources={sources.filter(item => item.id !== original?.sourceId)} source={source} onChange={value => { setSource(value); reset(); }} busy={busy} /></label>
      <form onSubmit={event => { event.preventDefault(); if (original && source && term.trim()) void run(async () => { reset(); setResults((await search(source, term.trim())).filter(item => String(item.id) !== originalId)); }); }} className="tsugi-transfer-search">
        <input className="tsugi-read-input grow min-w-0" aria-label={t({ id: "Replacement title search", message: "Replacement title search" })} maxLength={200} value={term} disabled={busy} onChange={event => { setTerm(event.target.value); reset(); }} />
        <button className="tsugi-read-action" disabled={busy || !original || !source || !term.trim()}><FiSearch aria-hidden /> <Trans id="Search replacement">Search replacement</Trans></button>
      </form>
    </div>
    {results?.map(item => <button key={item.id} type="button" className="tsugi-read-row" disabled={busy} onClick={() => void run(() => prepare(item))}><span><strong>{item.title}</strong><small className="block text-[--tsugi-muted]">{item.author || t({ id: "Unknown author", message: "Unknown author" })}{item.inLibrary ? t({ id: " · Already saved", message: " · Already saved" }) : ''}</small></span><FiArrowRight aria-hidden /></button>)}
    {results?.length === 0 && <p><Trans id="No results on this source. Try another title or source.">No results on this source. Try another title or source.</Trans></p>}
    {preview && plan && <div className="tsugi-transfer-preview">
      <h2><Trans id="Transfer preview">Transfer preview</Trans></h2><p>{preview.original.manga.title} → {preview.replacement.manga.title}</p>
      <div className="tsugi-transfer-stats">{[[plan.matched, t({ id: "Matched chapters", message: "Matched chapters" })], [plan.read.length, t({ id: "Mark read", message: "Mark read" })], [plan.bookmarked.length, t({ id: "Copy bookmarks", message: "Copy bookmarks" })], [plan.unmatched.length, t({ id: "Unmatched", message: "Unmatched" })], [plan.partial.length, t({ id: "Page progress retained on original", message: "Page progress retained on original" })]].map(([count, label]) => <div key={label}><strong>{count}</strong><small>{label}</small></div>)}</div>
      {!!plan.unmatched.length && <p><Trans id="Ambiguous or missing chapters">Ambiguous or missing chapters</Trans>: {plan.unmatched.join(', ')}</p>}
      {!!plan.partial.length && <p><Trans id="Unfinished chapter page positions are not copied across editions">Unfinished chapter page positions are not copied across editions</Trans>: {plan.partial.join(', ')}</p>}
      <p><Trans id="Custom categories are copied additively. Downloads, tracker links and historical timestamps stay on the original.">Custom categories are copied additively. Downloads, tracker links and historical timestamps stay on the original.</Trans></p>
      <button className="tsugi-read-action" disabled={busy} onClick={() => void run(apply)}><Trans id="Copy progress and keep original">Copy progress and keep original</Trans></button>
    </div>}
    {message && <p role="status" className="tsugi-transfer-result"><FiCheck aria-hidden /> {message}</p>}
  </section>;
}

export function BatchAddWorkspace({ library, sources, busy, run, reload }: Props) {
  const [format, setFormat] = React.useState<'titles' | 'csv' | 'mihon'>('titles');
  const [source, setSource] = React.useState('');
  const [input, setInput] = React.useState('');
  const [rows, setRows] = React.useState<BatchRow[]>([]);
  const [message, setMessage] = React.useState('');
  const [processed, setProcessed] = React.useState(0);
  const [searching, setSearching] = React.useState(false);
  const stop = React.useRef(false);
  const saved = new Set(library.map(item => titleKey(item.title)));
  async function lookup() {
    const titles = batchTitles(input, format);
    if (!titles.length || titles.length > 100) throw new Error(t({ id: "Enter 1–100 unique titles per batch.", message: "Enter 1–100 unique titles per batch." }));
    setRows([]); setProcessed(0); setMessage(''); stop.current = false; setSearching(true);
    for (const title of titles) {
      if (stop.current) break;
      let row: BatchRow;
      if (saved.has(titleKey(title))) row = { title, options: [], selected: '', status: t({ id: "Already in library", message: "Already in library" }) };
      else try {
        const options = (await search(source, title)).filter(item => !item.inLibrary && !saved.has(titleKey(item.title)));
        const exact = options.filter(item => titleKey(item.title) === titleKey(title));
        row = { title, options, selected: exact.length === 1 ? String(exact[0].id) : '', status: options.length ? t({ id: "Review match", message: "Review match" }) : t({ id: "No unsaved match", message: "No unsaved match" }) };
      } catch (error) { row = { title, options: [], selected: '', status: errorMessage(error) }; }
      setRows(old => [...old, row]); setProcessed(value => value + 1);
    }
    setSearching(false);
    setMessage(stop.current ? t({ id: "Search stopped. You can review the matches found so far.", message: "Search stopped. You can review the matches found so far." }) : t({ id: "Search complete. Review the matches before adding.", message: "Search complete. Review the matches before adding." }));
  }
  async function add() {
    const known = new Set(library.map(item => titleKey(item.title))), ids = new Set(library.map(item => String(item.id)));
    let count = 0;
    for (const row of rows) {
      const item = row.options.find(option => String(option.id) === row.selected);
      if (!item) continue;
      let status = t({ id: "Already in library", message: "Already in library" });
      let finished = true;
      try {
        const fresh = await cached(idOf(item));
        if (!fresh.manga.inLibrary && !known.has(titleKey(item.title)) && !ids.has(String(item.id))) {
          const result = await readRequest<{ manga: Title }>({ kind: 'set-library', id: idOf(item), inLibrary: true });
          if (!result.manga.inLibrary) throw new Error(t({ id: "Library addition not confirmed.", message: "Library addition not confirmed." }));
          known.add(titleKey(item.title)); ids.add(String(item.id)); count++; status = t({ id: "Added", message: "Added" });
        }
      } catch (error) { status = errorMessage(error); finished = false; }
      setRows(old => old.map(current => current.title === row.title ? { ...current, status, finished, selected: finished ? '' : current.selected } : current));
    }
    setMessage(t({ id: 'Batch import completed', message: `${count} titles added. Existing entries were not overwritten.` }));
    await reload();
  }
  return <section className="tsugi-transfer-workspace">
    <div className="tsugi-transfer-intro"><h2><Trans id="Build your collection">Build your collection</Trans></h2><p><Trans id="Paste a title per line, CSV, or a converted Mihon backup JSON. Search one installed source at a time, review matches and add them together. This imports titles only, not external chapter progress or tracker IDs.">Paste a title per line, CSV, or a converted Mihon backup JSON. Search one installed source at a time, review matches and add them together. This imports titles only, not external chapter progress or tracker IDs.</Trans></p></div>
    <div className="tsugi-transfer-form">
      <label><Trans id="Import format">Import format</Trans><select className="tsugi-read-input" aria-label={t({ id: "Import format", message: "Import format" })} disabled={busy} value={format} onChange={event => { setFormat(event.target.value as typeof format); setRows([]); setMessage(''); }}><option value="titles"><Trans id="One title per line">One title per line</Trans></option><option value="csv"><Trans id="CSV title column">CSV title column</Trans></option><option value="mihon"><Trans id="Converted Mihon JSON">Converted Mihon JSON</Trans></option></select></label>
      <label><Trans id="Search source">Search source</Trans><SourcePicker label={t({ id: "Search source", message: "Search source" })} sources={sources} source={source} onChange={value => { setSource(value); setRows([]); setMessage(''); }} busy={busy} /></label>
      <textarea className="tsugi-read-input tsugi-batch-input" aria-label={t({ id: "Titles to import", message: "Titles to import" })} rows={7} maxLength={2000000} disabled={busy} value={input} onChange={event => { setInput(event.target.value); setRows([]); setMessage(''); }} placeholder={format === 'titles' ? t({ id: "One title per line", message: "One title per line" }) : format === 'csv' ? t({ id: "title,status,chaptersRead", message: "title,status,chaptersRead" }) : t({ id: "Paste converted backup JSON", message: "Paste converted backup JSON" })} />
      <div className="flex flex-wrap items-center gap-2"><button className="tsugi-read-action" disabled={busy || !source || !input.trim()} onClick={() => void run(lookup)}><Trans id="Find matches">Find matches</Trans></button>{searching && <button className="tsugi-read-action" onClick={() => { stop.current = true; }}><Trans id="Stop after current search">Stop after current search</Trans></button>}<small><Trans id="Batch search progress">{processed} searched</Trans></small></div>
    </div>
    {rows.map(row => <div key={row.title} className="tsugi-read-row tsugi-batch-row"><span className="min-w-0"><strong>{row.title}</strong><small className="block text-[--tsugi-muted]">{row.status}</small></span>{row.options.length > 0 && <select className="tsugi-read-input" aria-label={t({ id: 'Review title match', message: 'Review title match' }) + ': ' + row.title} value={row.selected} disabled={busy || row.finished} onChange={event => setRows(old => old.map(item => item.title === row.title ? { ...item, selected: event.target.value } : item))}><option value=""><Trans id="Skip title">Skip title</Trans></option>{row.options.map(item => <option key={item.id} value={String(item.id)}>{item.title}{item.author ? ' · ' + item.author : ''}</option>)}</select>}</div>)}
    {rows.length > 0 && <button className="tsugi-read-action mt-5" disabled={busy || !rows.some(row => row.selected)} onClick={() => void run(add)}><Trans id="Add reviewed titles">Add reviewed titles</Trans> ({rows.filter(row => row.selected).length})</button>}
    {message && <p role="status" className="tsugi-transfer-result">{message}</p>}
  </section>;
}
