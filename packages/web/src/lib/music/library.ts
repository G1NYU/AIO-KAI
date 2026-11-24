import { storage } from '../storage';
import type { EclipseTrack } from './eclipse';

/** User-owned metadata. Never store resolved audio URLs, local paths or bearer-token addon URLs. */
export type SavedMusicTrack = Pick<EclipseTrack, 'id' | 'title' | 'artist' | 'album' | 'artworkURL' | 'duration' | 'isrc'> & {
  sourceId?: string;
};
export type MusicPlaylist = { id: string; name: string; tracks: SavedMusicTrack[] };

const KEY = 'tsugi-independent-playlists-v1';
const MAX_LISTS = 100;
const MAX_TRACKS = 1000;

const clean = (value: unknown, limit: number): string =>
  typeof value === 'string' ? value.trim().slice(0, limit) : '';

export function savedTrack(track: EclipseTrack, sourceId?: string): SavedMusicTrack {
  const title = clean(track.title, 220);
  const artist = clean(track.artist, 220);
  const id = clean(track.id, 350) || title + ':' + artist;
  return {
    id, title, artist,
    album: clean(track.album, 220) || undefined,
    artworkURL: typeof track.artworkURL === 'string' && /^https:\/\//.test(track.artworkURL)
      ? track.artworkURL.slice(0, 2048) : undefined,
    duration: typeof track.duration === 'number' && Number.isFinite(track.duration)
      && track.duration >= 0 ? track.duration : undefined,
    isrc: clean(track.isrc, 40) || undefined,
    sourceId: sourceId && /^[a-f\d-]{32,40}$/i.test(sourceId) ? sourceId : undefined,
  };
}

function validTrack(value: unknown): SavedMusicTrack | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<SavedMusicTrack>;
  if (!clean(raw.title, 220) || !clean(raw.artist, 220)) return null;
  return savedTrack(raw as EclipseTrack, raw.sourceId);
}

export function readMusicLibrary(): MusicPlaylist[] {
  const raw = storage.get<unknown>(KEY);
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_LISTS).flatMap((candidate): MusicPlaylist[] => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const entry = candidate as Record<string, unknown>;
    if (!clean(entry.name, 80) || !clean(entry.id, 120) || !Array.isArray(entry.tracks)) return [];
    const tracks = entry.tracks.slice(0, MAX_TRACKS)
      .map(validTrack).filter((track): track is SavedMusicTrack => track !== null);
    return [{ id: clean(entry.id, 120), name: clean(entry.name, 80), tracks }];
  });
}

export function saveMusicLibrary(playlists: MusicPlaylist[]): void {
  storage.set(KEY, playlists.slice(0, MAX_LISTS).map(list => ({
    id: clean(list.id, 120), name: clean(list.name, 80),
    tracks: list.tracks.slice(0, MAX_TRACKS).map(t => savedTrack(t, t.sourceId)),
  })));
}

export function createMusicPlaylist(name: string): MusicPlaylist {
  const title = clean(name, 80);
  if (!title) throw new Error('Enter a playlist name.');
  return { id: crypto.randomUUID(), name: title, tracks: [] };
}

export function addToMusicPlaylist(list: MusicPlaylist, track: SavedMusicTrack): MusicPlaylist {
  const safe = savedTrack(track, track.sourceId);
  if (!safe.title || !safe.artist) return list;
  const exists = list.tracks.some(item =>
    item.id === safe.id && item.artist === safe.artist && item.sourceId === safe.sourceId);
  return exists ? list : { ...list, tracks: [...list.tracks, safe].slice(0, MAX_TRACKS) };
}

function fromM3U(text: string): SavedMusicTrack[] {
  const tracks: SavedMusicTrack[] = [];
  let ext = '';
  for (const rawLine of text.split(/\r?\n/).slice(0, 5000)) {
    const line = rawLine.trim();
    if (line.startsWith('#EXTINF:')) {
      ext = line.slice(line.indexOf(',') + 1).trim();
      continue;
    }
    if (!line || line.startsWith('#')) continue;
    // Files and remote stream addresses are discarded. Only metadata is imported.
    let label = ext;
    if (!label) {
      const file = line.split(/[\\/]/).pop() || '';
      label = file.split('?')[0].replace(/\.[a-z0-9]{2,6}$/i, '');
    }
    ext = '';
    const separator = label.indexOf(' - ');
    const artist = separator > 0 ? label.slice(0, separator) : 'Unknown artist';
    const title = separator > 0 ? label.slice(separator + 3) : label;
    if (title) tracks.push(savedTrack({ id: 'm3u:' + tracks.length + ':' + title, title, artist }));
    if (tracks.length >= MAX_TRACKS) break;
  }
  return tracks;
}

export function importMusicPlaylist(filename: string, text: string): MusicPlaylist {
  if (text.length > 1024 * 1024) throw new Error('Playlist files must be smaller than 1 MB.');
  const name = clean(filename.replace(/\.(json|m3u8?|csv)$/i, ''), 80) || 'Imported playlist';
  const base = createMusicPlaylist(name);
  if (/\.m3u8?$/i.test(filename)) return { ...base, tracks: fromM3U(text) };
  if (/\.json$/i.test(filename)) {
    let source: unknown;
    try { source = JSON.parse(text); } catch { throw new Error('Invalid playlist JSON.'); }
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      throw new Error('Invalid Tsugi playlist.');
    }
    const data = source as Record<string, unknown>;
    if (data.format !== 'tsugi-playlist' || data.version !== 1 || !Array.isArray(data.tracks)) {
      throw new Error('Unsupported playlist format.');
    }
    return {
      ...base, name: clean(data.name, 80) || name,
      tracks: data.tracks.slice(0, MAX_TRACKS)
        .map(validTrack).filter((track): track is SavedMusicTrack => track !== null),
    };
  }
  throw new Error('Import a Tsugi JSON or M3U playlist.');
}

export function exportMusicPlaylist(list: MusicPlaylist): string {
  return JSON.stringify({
    format: 'tsugi-playlist', version: 1, name: list.name,
    tracks: list.tracks.map(track => savedTrack(track, track.sourceId)),
  }, null, 2);
}
