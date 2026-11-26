import { validBookProgress } from '../app/read/book-guards';
import type { RecentMusicPlay } from './music/history';
import type { EclipseTrack } from './music/eclipse';

export type ResumeTarget =
  | { kind: 'book'; id: string }
  | { kind: 'manga'; mangaId: number; chapterId: number; title: string; chapter: string }
  | { kind: 'music'; sourceId: string; trackId: string };

export type ResumeRow = {
  target: ResumeTarget;
  title: string;
  subtitle: string;
  at: number;
  progress?: number;
  page?: number;
  format?: 'epub' | 'pdf';
  available: boolean;
  current?: boolean;
};

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const label = (value: unknown, max = 1000): string =>
  typeof value === 'string' && value.trim() && value.length <= max ? value : '';
function numericId(value: unknown): number | null {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^[1-9]\d{0,15}$/.test(value))) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 && n <= 2147483647 ? n : null;
}
function timestamp(value: unknown): number {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d{1,16}$/.test(value))) return 0;
  const n = Number(value);
  const ms = n < 100000000000 ? n * 1000 : n;
  return Number.isSafeInteger(ms) && ms > 0 && ms <= 8640000000000000 ? ms : 0;
}

export function resumeKey(target: ResumeTarget): string {
  switch (target.kind) {
    case 'book': return JSON.stringify(['book', target.id]);
    case 'manga': return JSON.stringify(['manga', target.mangaId, target.chapterId]);
    case 'music': return JSON.stringify(['music', target.sourceId, target.trackId]);
  }
}

export function orderedResumeRows(rows: ResumeRow[], limit = 12): ResumeRow[] {
  const seen = new Set<string>();
  return [...rows].sort((a, b) => Number(!!b.current) - Number(!!a.current) || b.at - a.at)
    .filter(row => {
      const key = resumeKey(row.target);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, limit);
}

/** Read-only projection. Never carry file bytes, paths, covers or EPUB CFIs into the hub. */
export function bookResumeRows(value: unknown): ResumeRow[] {
  if (!Array.isArray(value)) return [];
  return orderedResumeRows(value.flatMap((item): ResumeRow[] => {
    const row = record(item);
    if (!row || typeof row.id !== 'string' || !/^[a-f0-9]{32}$/.test(row.id)) return [];
    const title = label(row.title);
    const format = row.format;
    if (!title || (format !== 'epub' && format !== 'pdf')) return [];
    const progress = validBookProgress(format, row.position, row.fraction);
    if (!progress || progress.fraction >= 1) return [];
    return [{ target: {kind:'book', id:row.id}, title, subtitle:'', format, at:timestamp(row.lastReadAt),
      progress:progress.fraction, available:true }];
  }));
}

/** The reader's history is the source of truth; finished chapters are not restarted. */
export function mangaResumeRows(value: unknown): ResumeRow[] {
  const nodes = record(value)?.nodes;
  if (!Array.isArray(nodes)) return [];
  return orderedResumeRows(nodes.slice(0, 100).flatMap((item): ResumeRow[] => {
    const row = record(item);
    const manga = record(row?.manga);
    const mangaId = numericId(manga?.id), chapterId = numericId(row?.id);
    const title = label(manga?.title), chapter = label(row?.name);
    const page = row?.lastPageRead, count = row?.pageCount;
    if (!row || mangaId === null || chapterId === null || !title || !chapter || row.isRead !== false ||
      typeof page !== 'number' || !Number.isInteger(page) || page < 0 || page >= 2000 ||
      typeof count !== 'number' || !Number.isInteger(count) || count <= page || count > 2000) return [];
    return [{target:{kind:'manga', mangaId, chapterId, title, chapter}, title, subtitle:chapter,
      page:page + 1, progress:page / count, at:timestamp(row.lastReadAt), available:true}];
  }));
}

export function musicResumeRows(recent: RecentMusicPlay[], sourceIds: string[], current?: {sourceId:string; track:EclipseTrack}): ResumeRow[] {
  const connected = new Set(sourceIds);
  const entries = current ? [{...current, playedAt:0, current:true}, ...recent.map(row => ({...row,current:false}))] :
    recent.map(row => ({...row,current:false}));
  return orderedResumeRows(entries.slice(0, 17).flatMap((entry): ResumeRow[] => {
    const sourceId = label(entry.sourceId, 256), trackId = label(entry.track?.id, 512);
    const title = label(entry.track?.title);
    if (!sourceId || !trackId || !title) return [];
    return [{target:{kind:'music',sourceId,trackId},title,subtitle:label(entry.track?.artist),
      at:timestamp(entry.playedAt),available:entry.current || connected.has(sourceId),current:entry.current}];
  }));
}
