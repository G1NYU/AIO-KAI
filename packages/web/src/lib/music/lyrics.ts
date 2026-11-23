import type { EclipseTrack } from './eclipse';

export type TimedLyric = { at: number; text: string };
export type TrackLyrics = { synced: TimedLyric[]; plain: string[] };
type Row = Record<string, unknown>;
const isRow = (v: unknown): v is Row =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const normalize = (s: string) =>
  s.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();

export function parseSyncedLyrics(input: unknown): TimedLyric[] {
  if (typeof input !== 'string') return [];
  const entries: TimedLyric[] = [];
  for (const raw of input.slice(0, 60_000).split(/\r?\n/)) {
    const match = /^\[(\d{1,3}):(\d{2}(?:\.\d{1,3})?)\](.*)$/.exec(raw);
    if (!match) continue;
    const at = Number(match[1]) * 60 + Number(match[2]);
    const text = match[3].trim().slice(0, 300);
    if (Number.isFinite(at) && text) entries.push({ at, text });
    if (entries.length >= 350) break;
  }
  return entries.sort((a, b) => a.at - b.at);
}

export function lyricAt(lines: TimedLyric[], seconds: number): number {
  let index = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].at > seconds) break;
    index = i;
  }
  return index;
}

/** Explicit opt-in lookup. Never transmits addons, API keys or personal URLs. */
export async function fetchTrackLyrics(track: EclipseTrack, signal?: AbortSignal): Promise<TrackLyrics | null> {
  if (!track.title?.trim() || !track.artist?.trim()) return null;
  const url = new URL('https://lrclib.net/api/search');
  url.searchParams.set('track_name', track.title);
  url.searchParams.set('artist_name', track.artist);
  let response: Response;
  try {
    response = await fetch(url.href, { signal, credentials: 'omit', redirect: 'error' });
  } catch (reason) {
    if (signal?.aborted) throw reason;
    throw new Error('Lyrics service is unreachable.');
  }
  if (response.status === 404 || response.status === 204) return null;
  if (!response.ok) throw new Error('Lyrics service is temporarily unavailable.');
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) return null;
  const selected = payload.slice(0, 20).find((candidate): candidate is Row => {
    if (!isRow(candidate)) return false;
    if (typeof candidate.trackName !== 'string' || typeof candidate.artistName !== 'string') return false;
    if (normalize(candidate.trackName) !== normalize(track.title) ||
        normalize(candidate.artistName) !== normalize(track.artist)) return false;
    return typeof track.duration !== 'number' || typeof candidate.duration !== 'number' ||
      Math.abs(track.duration - candidate.duration) <= 6;
  });
  if (!selected || selected.instrumental === true) return null;
  const synced = parseSyncedLyrics(selected.syncedLyrics);
  const plain = typeof selected.plainLyrics === 'string'
    ? selected.plainLyrics.slice(0, 25_000).split(/\r?\n/).filter(Boolean).slice(0, 250)
    : [];
  return synced.length || plain.length ? { synced, plain } : null;
}
