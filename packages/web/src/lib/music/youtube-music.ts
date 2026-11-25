/* eslint-disable lingui/no-unlocalized-strings -- provider protocol and remote metadata */
import { safeHttpsUrl, type EclipseCatalogDefinition, type EclipseCatalogItem, type EclipseDetail, type EclipseSearchResults, type EclipseTrack } from './eclipse';
import type { MusicProvider } from './providers';

type ObjectValue = Record<string, unknown>;
type Operation = 'search' | 'browse' | 'audio' | 'home';
export type YouTubeMusicRequest = (operation: Operation, value: string, signal?: AbortSignal) => Promise<unknown>;

const obj = (value: unknown): ObjectValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
const arr = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const str = (value: unknown): string => typeof value === 'string' ? value : '';
const videoId = (id: string): boolean => /^[\w-]{11}$/.test(id);
/** Windows owns extraction in the native audio worker. Construct only the
 * canonical public watch target, never a guessed CDN or cached signed URL. */
export function nativeYouTubeTarget(id: string): string {
  if (!videoId(id)) throw new Error('Invalid YouTube Music track.');
  return 'https://www.youtube.com/watch?v=' + id;
}
const browseId = (id: string): boolean => /^(?:MPRE|UC|VL|MPLA|OLAK5uy_)[\w-]{1,175}$/.test(id);

function nodes(root: unknown, key: string, limit = 500): ObjectValue[] {
  const result: ObjectValue[] = [];
  let visited = 0;
  function walk(value: unknown, depth: number) {
    if (depth > 48 || ++visited > 30000 || result.length >= limit) return;
    if (Array.isArray(value)) {
      for (const child of value) walk(child, depth + 1);
    } else {
      const node = obj(value);
      if (node[key] && typeof node[key] === 'object') {
        result.push(obj(node[key]));
        return;
      }
      for (const child of Object.values(node)) walk(child, depth + 1);
    }
  }
  walk(root, 0);
  return result;
}

function runs(value: unknown): ObjectValue[] {
  return arr(obj(value).runs).map(obj);
}
function text(value: unknown): string {
  return runs(value).map(run => str(run.text)).join('').trim();
}
function columns(row: ObjectValue): ObjectValue[][] {
  return arr(row.flexColumns).map(col => runs(obj(obj(col).musicResponsiveListItemFlexColumnRenderer).text));
}
function endpoint(run: ObjectValue): ObjectValue {
  return obj(obj(run.navigationEndpoint).browseEndpoint);
}
function kind(id: string): EclipseCatalogItem['type'] | null {
  if (!browseId(id)) return null;
  if (id.startsWith('MPRE')) return 'album';
  if (id.startsWith('UC')) return 'artist';
  return 'playlist';
}
function thumbnail(row: ObjectValue): string | undefined {
  const candidates = nodes(row.thumbnail ?? row.thumbnailRenderer, 'musicThumbnailRenderer', 1);
  const items = arr(obj(candidates[0]?.thumbnail).thumbnails);
  // Some renderer responses are not sorted by size. Choose the largest
  // declared thumbnail, using provider order only when dimensions are absent.
  return items.map((item, index) => {
    const entry = obj(item);
    const width = Number(entry.width);
    const height = Number(entry.height);
    return { url: safeHttpsUrl(entry.url), area: Number.isFinite(width * height) && width > 0 && height > 0 ? width * height : 0, index };
  }).filter(item => item.url).sort((a, b) => b.area - a.area || b.index - a.index)[0]?.url;
}
function duration(row: ObjectValue, subtitle: ObjectValue[]): number | undefined {
  const fixed = arr(row.fixedColumns).map(col => text(obj(obj(col).musicResponsiveListItemFixedColumnRenderer).text));
  const values = [...fixed, ...subtitle.map(run => str(run.text))];
  const value = values.find(value => /^\d{1,2}:\d{2}(?::\d{2})?$/.test(value.trim()));
  return value?.split(':').reduce((seconds, part) => seconds * 60 + Number(part), 0);
}

function decodeRow(row: ObjectValue): { track?: EclipseTrack; item?: EclipseCatalogItem } {
  const cols = columns(row);
  const titleRuns = cols[0] ?? runs(row.title);
  const title = titleRuns.map(run => str(run.text)).join('').trim();
  if (!title) return {};
  const subtitle = cols[1] ?? runs(row.subtitle);
  const artworkURL = thumbnail(row);
  const navigation = obj(row.navigationEndpoint);
  const directBrowse = str(obj(navigation.browseEndpoint).browseId) ||
    str(endpoint(titleRuns[0] ?? {}).browseId);
  const type = kind(directBrowse);
  const names = subtitle.filter(run => kind(str(endpoint(run).browseId)) === 'artist')
    .map(run => str(run.text).trim()).filter(Boolean);
  const fallback = subtitle.map(run => str(run.text)).join('').split(/[•·]/)
    .map(part => part.trim()).find(part =>
      part && !/^(song|video|album|artist|playlist|single|ep)$/i.test(part) &&
      !/^\d{1,2}:\d{2}(?::\d{2})?$/.test(part));
  const artist = [...new Set(names)].join(', ') || fallback || '';
  if (type) return { item: { id: directBrowse, type, title, artist: type === 'artist' ? undefined : artist || undefined, artworkURL } };
  const id = str(obj(row.playlistItemData).videoId) || str(obj(navigation.watchEndpoint).videoId) ||
    str(obj(obj(titleRuns[0]?.navigationEndpoint).watchEndpoint).videoId);
  if (!videoId(id)) return {};
  const album = subtitle.find(run => kind(str(endpoint(run).browseId)) === 'album');
  return { track: { id, title, artist, artworkURL, album: str(album?.text) || undefined, duration: duration(row, subtitle) } };
}

/** Only item-level endpoints determine identity. Do not select unrelated menu IDs. */
export function parseYouTubeMusicResults(root: unknown): EclipseSearchResults {
  const result: EclipseSearchResults = { tracks: [], albums: [], artists: [], playlists: [] };
  const seen = new Set<string>();
  const rows = [...nodes(root, 'musicResponsiveListItemRenderer'), ...nodes(root, 'musicTwoRowItemRenderer'), ...nodes(root, 'musicCardShelfRenderer')];
  for (const row of rows) {
    const { track, item } = decodeRow(row);
    const id = track ? 'track:' + track.id : item ? item.type + ':' + item.id : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (track) result.tracks.push(track);
    else if (item?.type === 'album') result.albums.push(item);
    else if (item?.type === 'artist') result.artists.push(item);
    else if (item?.type === 'playlist') result.playlists.push(item);
  }
  return result;
}

export function parseYouTubeMusicDetail(root: unknown, item: EclipseCatalogItem): EclipseDetail {
  const result = parseYouTubeMusicResults(root);
  return {
    id: item.id, title: item.title, artist: item.artist, artworkURL: item.artworkURL,
    tracks: result.tracks.map(track => ({ ...track, artist: track.artist || item.artist || item.title,
      album: track.album ?? (item.type === 'album' ? item.title : undefined),
      artworkURL: track.artworkURL ?? item.artworkURL })),
    albums: item.type === 'artist' ? result.albums : [],
  };
}

type HomeShelf = { definition: EclipseCatalogDefinition; items: EclipseCatalogItem[] };

/** Home shelves keep provider titles and item identities, not invented chart ranks.
 * Mixed shelves retain their source title but are split by playable item type. */
export function parseYouTubeMusicHome(root: unknown): HomeShelf[] {
  const shelves: HomeShelf[] = [];
  const sections = [
    ...nodes(root, 'musicCarouselShelfRenderer', 30),
    ...nodes(root, 'musicShelfRenderer', 30),
  ];
  for (const [index, section] of sections.entries()) {
    const header = obj(obj(section.header).musicCarouselShelfBasicHeaderRenderer);
    const name = text(header.title) || text(section.title);
    if (!name) continue;
    const result = parseYouTubeMusicResults(section.contents);
    const tracks: EclipseCatalogItem[] = result.tracks.map(track => ({
      id: track.id, type: 'track', title: track.title, artist: track.artist,
      album: track.album, artworkURL: track.artworkURL,
      durationMs: track.duration === undefined ? undefined : track.duration * 1000,
    }));
    const groups: EclipseCatalogItem[][] = [tracks, result.albums, result.artists, result.playlists];
    for (const items of groups) {
      const type = items[0]?.type;
      if (!type) continue;
      shelves.push({ definition: { id: 'home:' + index + ':' + type, name, type }, items: items.slice(0, 30) });
      if (shelves.length >= 16) return shelves;
    }
  }
  return shelves;
}

export function youtubeMusicProvider(request: YouTubeMusicRequest): MusicProvider {
  // The discovery page calls catalogs() and then catalog() on this same
  // provider. Fetch once, rather than issuing parallel remote browse requests.
  let home: HomeShelf[] = [];
  return {
    kind: 'youtube-music',
    async search(query, signal) {
      return parseYouTubeMusicResults(await request('search', query.trim().slice(0, 200), signal));
    },
    async catalogs(signal) {
      home = parseYouTubeMusicHome(await request('home', '', signal));
      return home.map(shelf => shelf.definition);
    },
    async catalog(definition, skip = 0) {
      if (skip > 0) return [];
      return home.find(shelf => shelf.definition.id === definition.id && shelf.definition.type === definition.type)?.items ?? [];
    },
    async detail(item, signal) {
      if (item.type === 'track' || !browseId(item.id)) throw new Error('Invalid YouTube Music collection.');
      return parseYouTubeMusicDetail(await request('browse', item.id, signal), item);
    },
    async resolve(track, signal) {
      if (!videoId(track.id)) throw new Error('Invalid YouTube Music track.');
      const result = obj(await request('audio', track.id, signal));
      const url = safeHttpsUrl(result.url);
      const nativeTarget = url === 'https://www.youtube.com/watch?v=' + track.id;
      if (!url || (!nativeTarget && (!/(^|\.)googlevideo\.com$/.test(new URL(url).hostname) || new URL(url).port))) {
        throw new Error('YouTube Music did not provide a playable audio stream.');
      }
      return { url, format: str(result.format), quality: str(result.quality) };
    },
  };
}
