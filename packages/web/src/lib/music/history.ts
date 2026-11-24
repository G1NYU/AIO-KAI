import { storage } from '../storage';
import { remembersMusicSources } from './connections';
import type { EclipseCatalogItem, EclipseTrack } from './eclipse';

/** Metadata only. Never persist stream URLs or addon manifest credentials. */
export type RecentMusicPlay = {
  sourceId: string;
  track: Pick<EclipseTrack, 'id' | 'title' | 'artist' | 'album' | 'artworkURL' | 'duration' | 'isrc'>;
};

const KEY = 'tsugi-recent-music-v1';
const MAX = 16;

export function makeRecentPlay(sourceId: string, track: EclipseTrack): RecentMusicPlay {
  const { id, title, artist, album, artworkURL, duration, isrc } = track;
  return { sourceId, track: { id, title, artist, album, artworkURL, duration, isrc } };
}

function valid(entry: unknown): entry is RecentMusicPlay {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  const item = entry as Partial<RecentMusicPlay>;
  const t = item.track;
  return typeof item.sourceId === 'string' &&
    t !== null && typeof t === 'object' &&
    typeof t.id === 'string' && typeof t.title === 'string' &&
    typeof t.artist === 'string';
}

export function mergeRecentPlays(
  current: RecentMusicPlay[], next: RecentMusicPlay
): RecentMusicPlay[] {
  return [
    next,
    ...current.filter((item) =>
      item.sourceId !== next.sourceId || item.track.id !== next.track.id),
  ].slice(0, MAX);
}

export function readRecentPlays(): RecentMusicPlay[] {
  if (!remembersMusicSources()) return [];
  const saved = storage.get<unknown>(KEY);
  return Array.isArray(saved) ? saved.filter(valid).slice(0, MAX) : [];
}

export function storeRecentPlays(items: RecentMusicPlay[], allowStorage: boolean): void {
  if (!allowStorage) {
    storage.remove(KEY);
    return;
  }
  storage.set(KEY, items.slice(0, MAX).map((item) => makeRecentPlay(item.sourceId, item.track)));
}

/** Local, source-scoped suggestions from already loaded catalogue metadata.
 * No external requests or profile transmission, and no fabricated results. */
export function suggestMusicFromHistory(
  items: readonly EclipseCatalogItem[], recent: readonly RecentMusicPlay[], sourceId: string,
): EclipseCatalogItem[] {
  const own = recent.filter(entry => entry.sourceId === sourceId).slice(0, MAX);
  const played = new Set(own.map(entry => entry.track.id));
  const artistKey = (name?: string) => name?.normalize('NFKC').trim().toLowerCase() ?? '';
  const weights = new Map<string, number>();
  for (const [index, entry] of own.entries()) {
    const key = artistKey(entry.track.artist);
    if (key) weights.set(key, (weights.get(key) ?? 0) + own.length - index);
  }
  const seen = new Set<string>();
  const candidates: { item: EclipseCatalogItem; score: number }[] = [];
  for (const item of items) {
    if (item.type !== 'track' || played.has(item.id) || seen.has(item.id)) continue;
    const score = weights.get(artistKey(item.artist)) ?? 0;
    if (!score) continue;
    seen.add(item.id);
    candidates.push({ item, score });
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, 12).map(candidate => candidate.item);
}
