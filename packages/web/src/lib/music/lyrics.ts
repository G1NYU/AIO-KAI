import type { EclipseTrack } from './eclipse';
import { YOUTUBE_MUSIC_ID } from './connections';

export type TimedLyric = { at: number; text: string };
export type LyricTimingReason = 'video' | 'duration' | 'album' | 'ambiguous' | 'unconfirmed';
export type TrackLyrics = {
  synced: TimedLyric[]; plain: string[];
  recording: { id?: number; album: string; duration?: number };
  /** Metadata agreement is not an acoustic verification of provider timings. */
  timingReason: LyricTimingReason | null;
  identity: string;
};
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
    if (Number.isFinite(at) && Number(match[2]) < 60 && text) entries.push({ at, text });
    if (entries.length >= 350) break;
  }
  return entries.sort((a, b) => a.at - b.at);
}

export function lyricAt(lines: TimedLyric[], seconds: number, offset = 0): number {
  if (!Number.isFinite(seconds) || !Number.isFinite(offset)) return -1;
  let index = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].at + offset > seconds) break;
    index = i;
  }
  return index;
}

/** Positive correction delays lyrics; the audio clock is never changed. */
export function lyricSeekTime(line: TimedLyric, offset: number, duration?: number): number {
  const at = Math.max(0, line.at + offset);
  return typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? Math.min(at, duration) : at;
}

const durationOf = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 86_400 ? value : undefined;

/** Only decoder metadata enters this value, never the catalog's display
 * fallback. Ignore sub-50ms metadata jitter without rounding the match itself. */
export function stableMediaDuration(previous: number, measured: number): number {
  if (!durationOf(measured)) return previous;
  return previous > 0 && Math.abs(measured - previous) < 0.05 ? previous : measured;
}

export function isVideoRecording(track: EclipseTrack): boolean {
  if (track.recordingType === 'video') return true;
  if (track.recordingType === 'song') return false;
  // Older saved YouTube videos predate recordingType. Their exact thumbnail
  // path still identifies the same video; do not apply this to arbitrary art.
  try {
    const artwork = new URL(track.artworkURL ?? '');
    return /^[\w-]{11}$/.test(track.id) && artwork.protocol === 'https:' && artwork.hostname === 'i.ytimg.com'
      && new RegExp('^/(?:vi|vi_webp)/' + track.id + '/').test(artwork.pathname);
  } catch { return false; }
}

/** Prefer actual media duration and album agreement, never provider result
 * order alone. Videos can contain intros/edits even when total lengths match. */
export function selectTrackLyrics(payload: unknown, track: EclipseTrack, playbackDuration?: number, source?: string): TrackLyrics | null {
  if (!Array.isArray(payload)) return null;
  const duration = durationOf(playbackDuration), album = normalize(track.album ?? '');
  const candidates = payload.slice(0, 20).flatMap(candidate => {
    if (!isRow(candidate) || candidate.instrumental === true
      || typeof candidate.trackName !== 'string' || typeof candidate.artistName !== 'string'
      || normalize(candidate.trackName) !== normalize(track.title) || normalize(candidate.artistName) !== normalize(track.artist)) return [];
    const synced = parseSyncedLyrics(candidate.syncedLyrics);
    const plain = typeof candidate.plainLyrics === 'string'
      ? candidate.plainLyrics.slice(0, 25_000).split(/\r?\n/).filter(Boolean).slice(0, 250) : [];
    if (!synced.length && !plain.length) return [];
    const recording = {
      id: typeof candidate.id === 'number' && Number.isSafeInteger(candidate.id) && candidate.id > 0 ? candidate.id : undefined,
      album: typeof candidate.albumName === 'string' ? candidate.albumName.slice(0, 300) : '',
      duration: durationOf(candidate.duration),
    };
    const difference = duration && recording.duration ? Math.abs(duration - recording.duration) : Infinity;
    const albumMatch = !album || normalize(recording.album) === album;
    const timingKey = JSON.stringify(synced);
    const malformedTiming = typeof candidate.syncedLyrics === 'string' && /\[offset:/i.test(candidate.syncedLyrics)
      || !!recording.duration && synced.some(line => line.at > recording.duration! + 2);
    return [{ synced, plain: plain.length ? plain : synced.map(line => line.text), recording, difference, albumMatch, timingKey, malformedTiming }];
  }).sort((a, b) => Number(b.difference <= 2) - Number(a.difference <= 2)
    || Number(b.albumMatch) - Number(a.albumMatch)
    || (a.difference < b.difference ? -1 : a.difference > b.difference ? 1 : 0)
    || Number(b.synced.length > 0) - Number(a.synced.length > 0)
    || (a.recording.id ?? Infinity) - (b.recording.id ?? Infinity));
  const selected = candidates[0];
  if (!selected) return null;
  const ambiguous = candidates.some(candidate => candidate !== selected && candidate.difference <= 2
    && candidate.albumMatch === selected.albumMatch && candidate.synced.length > 0 && candidate.timingKey !== selected.timingKey);
  const timingReason: LyricTimingReason | null = isVideoRecording(track) ? 'video'
    : !duration || !selected.recording.duration || !selected.recording.id || selected.malformedTiming
      || source === YOUTUBE_MUSIC_ID && track.recordingType !== 'song' ? 'unconfirmed'
    : selected.difference > 2 ? 'duration' : !selected.albumMatch ? 'album' : ambiguous ? 'ambiguous' : null;
  return { synced: selected.synced, plain: selected.plain, recording: selected.recording, timingReason,
    identity: JSON.stringify([selected.recording, selected.synced, selected.plain]) };
}

/** Session-only, bounded corrections. Identity includes the exact source,
 * selected track, media duration and lyric content, never just title/artist. */
export function lyricRecordingKey(source: string, track: EclipseTrack, duration: number, lyrics: TrackLyrics): string {
  return JSON.stringify([source, track.id, duration, lyrics.identity]);
}

export class LyricTimingStore {
  private entries = new Map<string, number>();
  constructor(private limit = 32) {}
  get(key: string): number | undefined { return this.entries.get(key); }
  set(key: string, offset: number): void {
    if (!Number.isFinite(offset) || Math.abs(offset) > 120 || key.length > 150_000) return;
    this.entries.delete(key);
    this.entries.set(key, Math.round(offset * 100) / 100);
    while (this.entries.size > this.limit) {
      const first = this.entries.keys().next();
      if (first.done) break;
      this.entries.delete(first.value);
    }
  }
  reset(key: string): void { this.entries.delete(key); }
}

/** Explicit opt-in lookup. Never transmits addons, API keys or personal URLs. */
export async function fetchTrackLyrics(track: EclipseTrack, signal?: AbortSignal, playbackDuration?: number, source?: string): Promise<TrackLyrics | null> {
  if (!track.title?.trim() || !track.artist?.trim()) return null;
  const url = new URL('https://lrclib.net/api/search');
  url.searchParams.set('track_name', track.title);
  url.searchParams.set('artist_name', track.artist);
  let response: Response;
  try {
    response = await fetch(url.href, { signal, credentials: 'omit', redirect: 'error',
      // eslint-disable-next-line lingui/no-unlocalized-strings -- Public HTTP client identity, not UI text.
      headers: { 'Lrclib-Client': 'TSUGI (https://github.com/G1NYU/TSUGI)' } });
  } catch (reason) {
    if (signal?.aborted) throw reason;
    throw new Error('Lyrics service is unreachable.');
  }
  if (response.status === 404 || response.status === 204) return null;
  if (!response.ok) throw new Error('Lyrics service is temporarily unavailable.');
  const payload: unknown = await response.json();
  return selectTrackLyrics(payload, track, playbackDuration, source);
}
