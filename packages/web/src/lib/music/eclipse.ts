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

export type EclipseManifest = {
  id: string;
  name: string;
  version: string;
  description?: string;
  icon?: string;
  resources: string[];
  types?: string[];
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
  const response = await fetch(url, {
    signal,
    credentials: 'omit',
    redirect: 'error',
  });
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
  url.search = '';
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
