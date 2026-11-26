import { storage } from '../storage';
import { remembersMusicSources } from './connections';
import type { EclipseTrack } from './eclipse';

/** Metadata only. Never persist stream URLs or addon manifest credentials. */
export type RecentMusicPlay = {
  sourceId: string;
  playedAt?: number;
  track: Pick<EclipseTrack, 'id' | 'title' | 'artist' | 'album' | 'artworkURL' | 'duration' | 'recordingType' | 'isrc'>;
};

const KEY = 'tsugi-recent-music-v1';
const MAX = 16;

export function makeRecentPlay(sourceId: string, track: EclipseTrack, playedAt?: number): RecentMusicPlay {
  const { id, title, artist, album, artworkURL, duration, isrc } = track;
  return { sourceId, ...(typeof playedAt === 'number' && Number.isSafeInteger(playedAt) && playedAt > 0 && playedAt <= 8640000000000000 ? { playedAt } : {}), track: { id, title, artist, album, artworkURL, duration, isrc,
    ...(track.recordingType === 'song' || track.recordingType === 'video' ? { recordingType: track.recordingType } : {}) } };
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
  return Array.isArray(saved) ? saved.filter(valid).slice(0, MAX).map(item => makeRecentPlay(item.sourceId, item.track, item.playedAt)) : [];
}

export function storeRecentPlays(items: RecentMusicPlay[], allowStorage: boolean): void {
  if (!allowStorage) {
    storage.remove(KEY);
    return;
  }
  storage.set(KEY, items.slice(0, MAX).map((item) => makeRecentPlay(item.sourceId, item.track, item.playedAt)));
}
