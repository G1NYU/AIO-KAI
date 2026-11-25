import { storage } from '../storage';
import type { EclipseTrack } from './eclipse';

/** User-owned metadata. Never store resolved audio URLs, local paths or bearer-token addon URLs. */
export type SavedMusicTrack = Pick<EclipseTrack, 'id' | 'title' | 'artist' | 'album' | 'artworkURL' | 'duration' | 'isrc'> & {
  sourceId?: string;
};
export type SavedCollectionIdentity = { sourceId: string; id: string; type: 'album' | 'playlist' | 'artist' };
export type MusicPlaylist = { id: string; name: string; tracks: SavedMusicTrack[]; collection?: SavedCollectionIdentity };

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
  if (!clean(raw.title, 220)) return null;
  const safe = savedTrack(raw as EclipseTrack, raw.sourceId);
  // Provider identity is enough to replay a track whose artist metadata is absent.
  if (!safe.artist && (!safe.sourceId || !clean(raw.id, 350))) return null;
  return safe;
}

function collectionIdentity(value: unknown): SavedCollectionIdentity | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Partial<SavedCollectionIdentity>;
  const sourceId = clean(raw.sourceId, 40);
  const id = clean(raw.id, 350);
  if (!/^[a-f\d-]{32,40}$/i.test(sourceId) || !id || (raw.type !== 'album' && raw.type !== 'playlist' && raw.type !== 'artist')) return undefined;
  return { sourceId, id, type: raw.type };
}

export function sameMusicCollection(a: SavedCollectionIdentity | undefined, b: SavedCollectionIdentity): boolean {
  const identity = collectionIdentity(b);
  return !!a && !!identity && a.sourceId === identity.sourceId && a.id === identity.id && a.type === identity.type;
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
    return [{ id: clean(entry.id, 120), name: clean(entry.name, 80), tracks, collection: collectionIdentity(entry.collection) }];
  });
}

export function saveMusicLibrary(playlists: MusicPlaylist[]): void {
  storage.set(KEY, playlists.slice(0, MAX_LISTS).map(list => ({
    id: clean(list.id, 120), name: clean(list.name, 80),
    tracks: list.tracks.slice(0, MAX_TRACKS).map(t => savedTrack(t, t.sourceId)),
    collection: collectionIdentity(list.collection),
  })));
}

export function createMusicPlaylist(name: string): MusicPlaylist {
  const title = clean(name, 80);
  if (!title) throw new Error('Enter a playlist name.');
  return { id: crypto.randomUUID(), name: title, tracks: [] };
}

export function addToMusicPlaylist(list: MusicPlaylist, track: SavedMusicTrack): MusicPlaylist {
  const safe = savedTrack(track, track.sourceId);
  if (!safe.title || (!safe.artist && (!safe.sourceId || !clean(track.id, 350)))) return list;
  const exists = list.tracks.some(item =>
    item.id === safe.id && item.artist === safe.artist && item.sourceId === safe.sourceId);
  return exists ? list : { ...list, tracks: [...list.tracks, safe].slice(0, MAX_TRACKS) };
}

/** Save an ordered snapshot, not stream URLs. A provider/type/item identity
 * keeps equally named albums separate. A failed capacity check changes nothing. */
export function saveMusicCollection(lists: MusicPlaylist[], identity: SavedCollectionIdentity, name: string, tracks: EclipseTrack[]): MusicPlaylist[] | null {
  const collection = collectionIdentity(identity);
  const title = clean(name, 80);
  if (!collection || !title || !tracks.length || tracks.length > MAX_TRACKS) return null;
  const existing = lists.find(list => sameMusicCollection(list.collection, collection));
  if (existing) return lists;
  if (lists.length >= MAX_LISTS) return null;
  const entries = tracks.map(track => validTrack(savedTrack({
    ...track, album: track.album || (collection.type === 'album' ? name : undefined),
  }, collection.sourceId)));
  if (entries.some(entry => !entry)) return null;
  return [...lists, { ...createMusicPlaylist(title), collection, tracks: entries as SavedMusicTrack[] }];
}

export function isSavedMusicTrack(list: MusicPlaylist | undefined, track: EclipseTrack, sourceId: string): boolean {
  return !!list?.tracks.some(entry => entry.id === track.id && entry.sourceId === sourceId);
}

/** Bulk save results atomically; no partial save at the storage limit. */
export function saveMusicTracks(lists: MusicPlaylist[], listId: string, name: string, tracks: EclipseTrack[], sourceId: string): MusicPlaylist[] | null {
  const existing = lists.find(list => list.id === listId);
  if (!existing && lists.length >= MAX_LISTS) return null;
  const base = existing ?? { id: listId, name, tracks: [] };
  const entries = [...base.tracks];
  const keys = new Set(entries.map(track => JSON.stringify([track.sourceId, track.id])));
  for (const track of tracks) {
    const entry = validTrack(savedTrack(track, sourceId));
    if (!entry || entry.sourceId !== sourceId) return null;
    const key = JSON.stringify([entry.sourceId, entry.id]);
    if (!keys.has(key)) { keys.add(key); entries.push(entry); }
  }
  if (entries.length > MAX_TRACKS) return null;
  const next = { ...base, tracks: entries };
  return existing ? lists.map(list => list.id === listId ? next : list) : [...lists, next];
}

function fromM3U(text: string, unknownArtist: string): SavedMusicTrack[] {
  const tracks: SavedMusicTrack[] = [];
  let ext = '';
  for (const rawLine of text.split(/\r?\n/).slice(0, 5000)) {
    const line = rawLine.trim();
    if (line.startsWith('#EXTINF:')) {
      ext = line.slice(line.indexOf(',') + 1).trim();
      continue;
    }
    if (!line || line.startsWith('#')) continue;
    // An M3U without EXTINF must never persist remote URL paths or tokens as track titles.
    if (!ext && (/^[a-z][a-z0-9+.-]*:\/\//i.test(line) ||
      /^(?:blob:|data:|magnet:|\/\/)/i.test(line))) continue;
    // Files and remote stream addresses are discarded. Only metadata is imported.
    let label = ext;
    if (!label) {
      const file = line.split(/[\\/]/).pop() || '';
      label = file.split('?')[0].replace(/\.[a-z0-9]{2,6}$/i, '');
    }
    ext = '';
    const separator = label.indexOf(' - ');
    const artist = separator > 0 ? label.slice(0, separator) : unknownArtist;
    const title = separator > 0 ? label.slice(separator + 3) : label;
    if (title) tracks.push(savedTrack({ id: 'm3u:' + tracks.length + ':' + title, title, artist }));
    if (tracks.length >= MAX_TRACKS) break;
  }
  return tracks;
}

export function importMusicPlaylist(
  filename: string, text: string, unknownArtist = '—'
): MusicPlaylist {
  if (text.length > 1024 * 1024) throw new Error('Playlist files must be smaller than 1 MB.');
  const name = clean(filename.replace(/\.(json|m3u8?|csv)$/i, ''), 80);
  if (!name) throw new Error('Invalid playlist filename.');
  const base = createMusicPlaylist(name);
  if (/\.m3u8?$/i.test(filename)) return { ...base, tracks: fromM3U(text, unknownArtist) };
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

/** Resolve an imported metadata-only playlist entry against files opened this session.
 * Never guess when several local files could correspond to the same entry. */
export function findLocalPlaylistMatch(
  saved: SavedMusicTrack, candidates: EclipseTrack[]
): EclipseTrack | null {
  const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
  const exact = normalize(saved.artist + ' - ' + saved.title);
  const title = normalize(saved.title);
  if (!title) return null;
  const combined = candidates.filter(candidate => normalize(candidate.title) === exact);
  if (combined.length === 1) return combined[0];
  const short = candidates.filter(candidate => normalize(candidate.title) === title);
  return short.length === 1 ? short[0] : null;
}
