/* eslint-disable lingui/no-unlocalized-strings -- provider protocol and remote metadata */
import type { EclipseSearchResults, EclipseTrack } from './eclipse';
import type { MusicProvider } from './providers';

export function publicSoundCloudId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 20 &&
    value[0] !== '0' && !/[^0-9]/.test(value) &&
    (value.length < 20 || value <= '18446744073709551615');
}

export function nativeSoundCloudTarget(id: string): string {
  if (!publicSoundCloudId(id)) throw new Error('Invalid SoundCloud track.');
  return 'https://api.soundcloud.com/tracks/' + id;
}

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

function metadata(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return text.length <= 220 && !/[\x00-\x1f\x7f]|:\/\/|(?:^|\s)(?:blob:|data:|bearer\s)/i.test(text) ? text : '';
}

function artwork(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash &&
      ['i1.sndcdn.com', 'i2.sndcdn.com', 'i3.sndcdn.com', 'i4.sndcdn.com'].includes(url.hostname) &&
      /\.(?:jpg|jpeg|png|webp)$/.test(url.pathname)) return url.href;
  } catch { /* invalid artwork never prevents playing a valid track */ }
}

export function parseSoundCloudTracks(value: unknown): EclipseSearchResults {
  if (!Array.isArray(value) || value.length > 20) throw new Error('Invalid SoundCloud search response.');
  const tracks: EclipseTrack[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const row = object(raw);
    const title = metadata(row.title);
    if (!publicSoundCloudId(row.id) || !title || seen.has(row.id)) continue;
    seen.add(row.id);
    const duration = typeof row.duration === 'number' && Number.isFinite(row.duration) &&
      row.duration > 0 && row.duration <= 86400 ? row.duration : undefined;
    tracks.push({ id: row.id, title, artist: metadata(row.artist), artworkURL: artwork(row.artworkURL),
      ...(duration === undefined ? {} : { duration }) });
  }
  return { tracks, albums: [], artists: [], playlists: [] };
}

export type SoundCloudSearchRequest = (
  query: string, signal?: AbortSignal, onTracks?: (rows: unknown[]) => void,
) => Promise<unknown[]>;

/** Native bridge owns public search and extraction; no CDN or signed media URL enters the UI. */
export function soundcloudMusicProvider(request: SoundCloudSearchRequest): MusicProvider {
  return {
    kind: 'soundcloud',
    async search(query, signal, onPartial) {
      const term = query.trim();
      if (!term || new TextEncoder().encode(term).length > 800 || /[\x00-\x1f\x7f]/.test(term))
        throw new Error('Invalid SoundCloud search.');
      if (signal?.aborted) throw new DOMException('', 'AbortError');
      const rows = await request(term, signal, onPartial ? items => {
        if (!signal?.aborted) onPartial(parseSoundCloudTracks(items));
      } : undefined);
      if (signal?.aborted) throw new DOMException('', 'AbortError');
      return parseSoundCloudTracks(rows);
    },
    async catalogs() { return []; },
    async catalog() { return []; },
    async detail() { throw new Error('SoundCloud collections are not supported.'); },
    async resolve(track) { return { url: nativeSoundCloudTarget(track.id) }; },
  };
}
