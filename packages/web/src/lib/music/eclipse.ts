/** Public Eclipse addon protocol. Personalized manifest URLs remain runtime-only. */
export const ECLIPSE_STORE_REGISTRY = 'https://eclipsemusic.app/addonstore/registry.json';

export type EclipseStoreEntry = {
  id: string;
  name: string;
  description: string;
  author?: string;
  version?: string;
  icon?: string;
  setupUrl?: string;
  manifestUrl?: string;
};

export type EclipseItemType = 'track' | 'album' | 'artist' | 'playlist';

export type EclipseCatalogDefinition = {
  id: string;
  type: EclipseItemType;
  name: string;
};

export type EclipseCatalogItem = {
  id: string;
  type: EclipseItemType;
  title: string;
  artist?: string;
  album?: string;
  artworkURL?: string;
  durationMs?: number;
  isrc?: string;
  year?: string;
};

export type EclipseSearchResults = {
  tracks: EclipseTrack[];
  albums: EclipseCatalogItem[];
  artists: EclipseCatalogItem[];
  playlists: EclipseCatalogItem[];
};

export type EclipseDetail = {
  id: string;
  title: string;
  description?: string;
  artist?: string;
  artworkURL?: string;
  tracks: EclipseTrack[];
  albums: EclipseCatalogItem[];
};

export type EclipseManifest = {
  id: string;
  name: string;
  version: string;
  description?: string;
  icon?: string;
  resources: string[];
  types?: string[];
  catalogs?: EclipseCatalogDefinition[];
};

export type EclipseTrack = {
  id: string;
  title: string;
  artist: string;
  album?: string;
  artworkURL?: string;
  duration?: number;
  streamURL?: string;
  isrc?: string;
};

export type EclipseStream = {
  url: string;
  format?: string;
  manifest?: string;
  quality?: string;
};

type RecordValue = Record<string, unknown>;

function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Never open arbitrary external URI schemes or embedded URL credentials. */
export function safeHttpsUrl(value: unknown): string | undefined {
  const raw = asString(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function parseStoreRegistry(value: unknown): EclipseStoreEntry[] {
  if (!record(value) || !Array.isArray(value.addons)) {
    throw new Error('The Eclipse addon store returned an invalid registry.');
  }
  const ids = new Set<string>();
  const entries: EclipseStoreEntry[] = [];
  for (const raw of value.addons) {
    if (!record(raw)) continue;
    const id = asString(raw.id);
    const name = asString(raw.name);
    const setupUrl = safeHttpsUrl(raw.setupUrl);
    const manifestUrl = safeHttpsUrl(raw.manifestUrl);
    if (!id || !name || (!setupUrl && !manifestUrl) || ids.has(id)) continue;
    ids.add(id);
    entries.push({
      id, name, setupUrl, manifestUrl,
      description: asString(raw.description) ?? '',
      author: asString(raw.author),
      version: asString(raw.version),
      icon: safeHttpsUrl(raw.icon),
    });
  }
  return entries;
}

/** Accept both a base URL and a full /manifest.json URL, preserving tokenized paths. */
export function manifestUrlFor(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('Enter a complete HTTPS addon URL.');
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (!(url.protocol === 'https:' || (local && url.protocol === 'http:')) ||
      url.username || url.password) {
    throw new Error('Only HTTPS addon URLs are supported. HTTP is allowed for localhost development.');
  }
  if (!url.pathname.endsWith('/manifest.json')) {
    url.pathname = url.pathname.replace(/\/$/, '') + '/manifest.json';
  }
  url.hash = '';
  return url.href;
}

function itemType(input: unknown): EclipseItemType | undefined {
  return input === 'track' || input === 'album' || input === 'artist' || input === 'playlist'
    ? input : undefined;
}

export function parseCatalogDefinitions(input: unknown): EclipseCatalogDefinition[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  return input.flatMap((raw): EclipseCatalogDefinition[] => {
    if (!record(raw)) return [];
    const id = asString(raw.id);
    const type = itemType(raw.type);
    const name = asString(raw.name);
    if (!id || !type || !name || seen.has(id)) return [];
    seen.add(id);
    return [{ id, type, name }];
  }).slice(0, 40);
}

function catalogItem(raw: unknown, fallback?: EclipseItemType): EclipseCatalogItem | null {
  if (!record(raw)) return null;
  const type = itemType(raw.type) ?? fallback;
  const id = asString(raw.id);
  const title = asString(raw.title) ?? (type === 'artist' ? asString(raw.name) : undefined);
  if (!type || !id || !title) return null;
  return {
    id, type, title,
    artist: asString(raw.artist) ?? asString(raw.creator),
    album: asString(raw.album),
    artworkURL: safeHttpsUrl(raw.artworkURL),
    durationMs: typeof raw.durationMs === 'number' && raw.durationMs >= 0
      ? raw.durationMs : undefined,
    isrc: asString(raw.isrc),
    year: typeof raw.year === 'number' ? String(raw.year) : asString(raw.year),
  };
}

export function parseCatalogItems(value: unknown, type: EclipseItemType): EclipseCatalogItem[] {
  if (!record(value) || !Array.isArray(value.items)) {
    throw new Error('The addon returned an invalid music catalog.');
  }
  return value.items.flatMap((raw): EclipseCatalogItem[] => {
    const item = catalogItem(raw, type);
    return item && item.type === type ? [item] : [];
  });
}

export function parseSearchResults(value: unknown): EclipseSearchResults {
  if (!record(value)) throw new Error('The addon returned invalid search results.');
  const parseGroup = (key: string, type: EclipseItemType): EclipseCatalogItem[] => {
    const group = value[key];
    if (group === undefined) return [];
    if (!Array.isArray(group)) throw new Error('The addon returned invalid search results.');
    return group.flatMap((raw): EclipseCatalogItem[] => {
      const item = catalogItem(raw, type);
      return item && item.type === type ? [item] : [];
    });
  };
  return {
    tracks: parseTracks(value),
    albums: parseGroup('albums', 'album'),
    artists: parseGroup('artists', 'artist'),
    playlists: parseGroup('playlists', 'playlist'),
  };
}

export function parseDetail(value: unknown, type: Exclude<EclipseItemType, 'track'>): EclipseDetail {
  if (!record(value)) throw new Error('The addon returned an invalid music detail page.');
  const id = asString(value.id);
  const title = asString(value.title) ?? asString(value.name);
  if (!id || !title) throw new Error('The addon returned an invalid music detail page.');
  const trackKey = type === 'artist' ? 'topTracks' : 'tracks';
  const tracks = parseTracks({ tracks: value[trackKey] ?? [] });
  const albums = type === 'artist' && Array.isArray(value.albums)
    ? value.albums.flatMap((raw): EclipseCatalogItem[] => {
      const item = catalogItem(raw, 'album');
      return item?.type === 'album' ? [item] : [];
    })
    : [];
  return {
    id, title,
    description: asString(value.description) ?? asString(value.bio),
    artist: asString(value.artist) ?? asString(value.creator),
    artworkURL: safeHttpsUrl(value.artworkURL),
    tracks, albums,
  };
}

export function parseManifest(value: unknown): EclipseManifest {
  if (!record(value)) throw new Error('The addon did not return a manifest.');
  const id = asString(value.id);
  const name = asString(value.name);
  const version = asString(value.version);
  const resources = Array.isArray(value.resources)
    ? value.resources.filter((r): r is string => typeof r === 'string')
    : [];
  if (!id || !name || !version ||
      !resources.includes('search') || !resources.includes('stream')) {
    throw new Error('This addon does not support both music search and streaming.');
  }
  return {
    id, name, version, resources,
    description: asString(value.description),
    icon: safeHttpsUrl(value.icon),
    types: Array.isArray(value.types)
      ? value.types.filter((t): t is string => typeof t === 'string')
      : undefined,
    ...(Array.isArray(value.catalogs) ? { catalogs: parseCatalogDefinitions(value.catalogs) } : {}),
  };
}

export function parseTracks(value: unknown): EclipseTrack[] {
  if (!record(value) || (value.tracks !== undefined && !Array.isArray(value.tracks))) {
    throw new Error('The addon returned invalid search results.');
  }
  return (value.tracks ?? []).flatMap((raw): EclipseTrack[] => {
    if (!record(raw)) return [];
    const id = asString(raw.id);
    const title = asString(raw.title);
    const artist = asString(raw.artist);
    if (!id || !title || !artist) return [];
    return [{
      id, title, artist,
      album: asString(raw.album),
      artworkURL: safeHttpsUrl(raw.artworkURL),
      streamURL: safeHttpsUrl(raw.streamURL),
      duration: typeof raw.duration === 'number' && raw.duration >= 0 ? raw.duration : undefined,
      isrc: asString(raw.isrc),
    }];
  });
}

function isAdaptiveStream(url: string): boolean {
  const path = new URL(url).pathname.toLowerCase();
  return path.endsWith('.m3u8') || path.endsWith('.mpd');
}

export function parseStream(value: unknown): EclipseStream {
  if (!record(value)) throw new Error('The addon returned an invalid stream response.');
  const url = safeHttpsUrl(value.url);
  if (!url) throw new Error('The addon did not provide a secure playable URL.');
  const manifest = asString(value.manifest);
  if ((manifest && manifest !== 'none') || isAdaptiveStream(url)) {
    throw new Error('This stream uses HLS or DASH. Native engine support is required before playback.');
  }
  return {
    url,
    format: asString(value.format),
    manifest,
    quality: asString(value.quality),
  };
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      signal,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    // Browser errors may contain private addon URLs; do not surface them.
    throw new Error('Cannot reach the addon. Check its availability and desktop cross-origin support.');
  }
  if (!response.ok) throw new Error('Request failed (HTTP ' + response.status + ').');
  return response.json() as Promise<unknown>;
}

export async function loadStore(signal?: AbortSignal): Promise<EclipseStoreEntry[]> {
  return parseStoreRegistry(await getJson(ECLIPSE_STORE_REGISTRY, signal));
}

export async function loadAddon(input: string, signal?: AbortSignal): Promise<EclipseManifest> {
  return parseManifest(await getJson(manifestUrlFor(input), signal));
}

export function addonEndpoint(input: string, path: string): string {
  const url = new URL(manifestUrlFor(input));
  url.pathname = url.pathname.slice(0, -'manifest.json'.length) + path.replace(/^\//, '');
  // Preserve query-string configuration parameters used by some private addons.
  return url.href;
}

export async function searchAddon(input: string, query: string, signal?: AbortSignal): Promise<EclipseTrack[]> {
  const url = new URL(addonEndpoint(input, 'search'));
  url.searchParams.set('q', query);
  return parseTracks(await getJson(url.href, signal));
}

export async function resolveTrack(input: string, track: EclipseTrack, signal?: AbortSignal): Promise<EclipseStream> {
  if (track.streamURL) return parseStream({ url: track.streamURL });
  return parseStream(await getJson(
    addonEndpoint(input, 'stream/' + encodeURIComponent(track.id)), signal
  ));
}

/** Catalog IDs are addon-owned; never resolve them against another provider. */
export async function loadCatalog(
  manifestUrl: string, catalog: EclipseCatalogDefinition, skip = 0, signal?: AbortSignal
): Promise<EclipseCatalogItem[]> {
  const url = new URL(addonEndpoint(manifestUrl, 'catalog/' + encodeURIComponent(catalog.id)));
  url.searchParams.set('skip', String(Math.max(0, Math.floor(skip / 100) * 100)));
  return parseCatalogItems(await getJson(url.href, signal), catalog.type);
}

export async function loadDetail(
  manifestUrl: string, item: EclipseCatalogItem, signal?: AbortSignal
): Promise<EclipseDetail> {
  if (item.type === 'track') throw new Error('Tracks do not have a detail endpoint.');
  const endpoint = addonEndpoint(manifestUrl, item.type + '/' + encodeURIComponent(item.id));
  return parseDetail(await getJson(endpoint, signal), item.type);
}

export async function searchAddonAll(
  manifestUrl: string, query: string, signal?: AbortSignal
): Promise<EclipseSearchResults> {
  const url = new URL(addonEndpoint(manifestUrl, 'search'));
  url.searchParams.set('q', query);
  return parseSearchResults(await getJson(url.href, signal));
}

/** Catalog metadata is in milliseconds; the HTML audio player expects seconds. */
export function catalogTrack(item: EclipseCatalogItem): EclipseTrack {
  if (item.type !== 'track') throw new Error('This catalog item is not a track.');
  return {
    id: item.id, title: item.title, artist: item.artist ?? '',
    album: item.album,
    artworkURL: item.artworkURL,
    duration: item.durationMs === undefined ? undefined : item.durationMs / 1000,
    isrc: item.isrc,
  };
}
