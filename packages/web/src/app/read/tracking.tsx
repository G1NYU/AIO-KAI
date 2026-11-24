import React from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { readRequest } from '@/lib/hosts/shell/reading';

export type Tracker = { id: number; name: string; isLoggedIn: boolean; supportsReadingDates: boolean; supportsPrivateTracking: boolean };
type Record = { id: number; trackerId: number; title: string; lastChapterRead: number; totalChapters: number; displayScore?: string };
type Match = { remoteId: string; title: string; totalChapters: number; publishingType: string; publishingStatus: string; startDate: string };
type Props = { mangaId: number; title: string; busy: boolean; run(work: () => Promise<void>): Promise<void>; openAccounts(): void };

export function MangaTracking({ mangaId, title, busy, run, openAccounts }: Props) {
  const [accounts, setAccounts] = React.useState<Tracker[]>([]);
  const [records, setRecords] = React.useState<Record[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [query, setQuery] = React.useState(title);
  const [provider, setProvider] = React.useState(0);
  const [matches, setMatches] = React.useState<Match[] | null>(null);
  const [selected, setSelected] = React.useState<Match | null>(null);
  const [notice, setNotice] = React.useState('');
  async function refresh() {
    const result = await readRequest<{ nodes: Record[] }>({ kind: 'track-records', mangaId });
    const providers = await readRequest<{ nodes: Tracker[] }>({ kind: 'trackers' });
    setRecords(result.nodes);
    setAccounts(providers.nodes);
    setLoaded(true);
    setProvider((old) => providers.nodes.some((p) => p.id === old && p.isLoggedIn && [1, 2].includes(p.id) && !result.nodes.some((r) => r.trackerId === p.id)) ? old : providers.nodes.find((p) => p.isLoggedIn && [1, 2].includes(p.id) && !result.nodes.some((r) => r.trackerId === p.id))?.id || 0);
  }
  async function search() {
    setNotice(''); setSelected(null); setMatches(null);
    const result = await readRequest<{ trackSearches: Match[] }>({ kind: 'tracker-search', id: provider, query: query.trim() });
    setMatches(result.trackSearches);
  }
  const available = accounts.filter((p) => p.isLoggedIn && [1, 2].includes(p.id) && !records.some((r) => r.trackerId === p.id));
  return <section className="my-5 space-y-4 border-b border-[--tsugi-line] pb-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-xl font-semibold"><Trans id="Tracking">Tracking</Trans></h3><div className="flex gap-2"><button className="tsugi-read-action" disabled={busy} onClick={openAccounts}><Trans id="Tracker accounts">Tracker accounts</Trans></button><button className="tsugi-read-action" disabled={busy} onClick={() => void run(refresh)}>{loaded ? t({id: "Refresh trackers", message: "Refresh trackers"}) : t({id: "Load tracking", message: "Load tracking"})}</button></div></div>
    <p className="text-sm text-[--tsugi-muted]"><Trans id="Choose the exact series on your tracker before linking. Sync sends your completed chapter progress; unlinking keeps the remote list entry.">Choose the exact series on your tracker before linking. Sync sends your completed chapter progress; unlinking keeps the remote list entry.</Trans></p>
    {loaded && records.map((record) => <div className="tsugi-read-row" key={record.id}><span><strong className="block">{record.title}</strong><small className="text-[--tsugi-muted]">{accounts.find((account) => account.id === record.trackerId)?.name} · {record.lastChapterRead}{record.totalChapters > 0 ? ' / ' + record.totalChapters : ''}</small></span><button className="tsugi-read-action" disabled={busy} onClick={() => void run(async () => { await readRequest({ kind: 'tracker-unbind', mangaId, recordId: record.id }); await refresh(); })}><Trans id="Unlink">Unlink</Trans></button></div>)}
    {records.length > 0 && <button className="tsugi-read-action" disabled={busy} onClick={() => void run(async () => { setNotice(''); await readRequest({ kind: 'tracker-sync', mangaId }); await refresh(); setNotice(t({ id: "Sync requested. The displayed progress is the reading engine’s last known tracker state.", message: "Sync requested. The displayed progress is the reading engine’s last known tracker state." })); })}><Trans id="Sync completed chapters">Sync completed chapters</Trans></button>}
    {notice && <p role="status" className="text-sm text-[--tsugi-muted]">{notice}</p>}
    {loaded && !available.length && !records.length && <p className="text-sm text-[--tsugi-muted]"><Trans id="Connect a supported tracker account to link this manga.">Connect a supported tracker account to link this manga.</Trans></p>}
    {!!available.length && <><form className="tsugi-reading-filters" onSubmit={(event) => { event.preventDefault(); void run(search); }}>
      <select className="tsugi-read-input" aria-label={t({ id: "Tracker service", message: "Tracker service" })} value={provider} disabled={busy} onChange={(event) => { setProvider(Number(event.target.value)); setMatches(null); setSelected(null); }}>{available.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select>
      <input className="tsugi-read-input grow" aria-label={t({ id: "Search tracker", message: "Search tracker" })} value={query} maxLength={200} disabled={busy} onChange={(event) => { setQuery(event.target.value); setMatches(null); setSelected(null); }} />
      <button className="tsugi-read-action" disabled={busy || !provider || !query.trim()}><Trans id="Search tracker">Search tracker</Trans></button>
    </form>
    {matches?.map((match) => <button key={String(match.remoteId)} className="tsugi-read-row" aria-pressed={selected?.remoteId === match.remoteId} disabled={busy} onClick={() => setSelected(match)}><span><strong className="block">{match.title}</strong><small className="text-[--tsugi-muted]">{[match.publishingType, match.publishingStatus, match.startDate].filter(Boolean).join(' · ')}</small></span><span>{match.totalChapters || '—'}</span></button>)}
    {matches?.length === 0 && <p><Trans id="No tracker matches found.">No tracker matches found.</Trans></p>}
    {selected && <div className="flex flex-wrap items-center gap-3"><strong>{selected.title}</strong><button className="tsugi-read-action" disabled={busy || !/^[1-9][0-9]{0,18}$/.test(selected.remoteId)} onClick={() => void run(async () => { await readRequest({ kind: 'tracker-bind', mangaId, id: provider, remoteId: selected.remoteId }); setSelected(null); setMatches(null); await refresh(); })}><Trans id="Link selected series">Link selected series</Trans></button></div>}</>}
  </section>;
}
