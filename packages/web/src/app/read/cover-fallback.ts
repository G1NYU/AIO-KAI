import { storage, storedMap } from '../../lib/storage';

type Title = { title: string; author?: string | null; inLibrary: boolean };
const ENABLED = 'tsugi-library-cover-fallback-v1';
const cache = storedMap<string>('tsugi-library-cover-cache-v1', 250);
const misses = new Map<string, number>();
const pending = new Map<string, Promise<string | undefined>>();
let tail: Promise<unknown> = Promise.resolve();
let lastRequest = 0;

export function readCoverFallback(): boolean { return storage.get<boolean>(ENABLED) === true; }
export function saveCoverFallback(enabled: boolean): void { storage.set(ENABLED, enabled); }
export function mayLookUpCover(enabled: boolean, inLibrary: boolean, missing: boolean): boolean {
  return enabled && inLibrary && missing;
}
function normalized(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{Z}\s]/gu, '');
}
function authorKey(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().split(/[\p{P}\p{Z}\s]+/u).filter(Boolean).sort().join(' ');
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function validImage(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'cdn.myanimelist.net' && !url.port && !url.username && !url.password &&
      /^\/images\/manga\//.test(url.pathname) && /\.(?:jpe?g|png|webp)$/i.test(url.pathname) ? url.href : undefined;
  } catch { return undefined; }
}

/** An exact, unambiguous metadata match only. Never select the first fuzzy result. */
export function selectFallbackCover(payload: unknown, title: string, author?: string | null): string | undefined {
  const data = record(payload).data;
  if (!Array.isArray(data) || !normalized(title)) return undefined;
  const exact = new Map<number, Record<string, unknown>>();
  for (const raw of data.slice(0, 25)) {
    const item = record(raw);
    const titles = [item.title, item.title_english, item.title_japanese, ...(Array.isArray(item.titles) ? item.titles.map(value => record(value).title) : [])];
    if (!titles.some(value => typeof value === 'string' && normalized(value) === normalized(title))) continue;
    if (author?.trim()) {
      const authors = Array.isArray(item.authors) ? item.authors : [];
      if (!authors.some(value => { const name = record(value).name; return typeof name === 'string' && authorKey(name) === authorKey(author); })) continue;
    }
    if (typeof item.mal_id === 'number' && Number.isSafeInteger(item.mal_id) && item.mal_id > 0) exact.set(item.mal_id, item);
  }
  if (exact.size !== 1) return undefined;
  const item = [...exact.values()][0];
  const images = record(item.images);
  const jpg = record(images.jpg);
  const webp = record(images.webp);
  return [jpg.large_image_url, webp.large_image_url, jpg.image_url, webp.image_url].map(validImage).find(Boolean);
}

/** Queue only visible saved titles that have no usable source image. No auth,
 * source URLs, IDs or reading activity are sent to the public metadata API. */
export function lookupMissingCover(manga: Title, signal: AbortSignal): Promise<string | undefined> {
  if (!manga.inLibrary || signal.aborted || !readCoverFallback() || !manga.title.trim() || manga.title.length > 200) return Promise.resolve(undefined);
  const key = 'manga:' + JSON.stringify([normalized(manga.title), authorKey(manga.author || '')]);
  const saved = validImage(cache.get(key));
  if (saved) return Promise.resolve(saved);
  if ((misses.get(key) ?? 0) > Date.now()) return Promise.resolve(undefined);
  const existing = pending.get(key);
  if (existing) return existing;
  if (pending.size >= 16) return Promise.resolve(undefined);
  const task = tail.then(async () => {
    if (signal.aborted || !readCoverFallback()) return undefined;
    const delay = Math.max(0, lastRequest + 1200 - Date.now());
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (signal.aborted || !readCoverFallback()) return undefined;
    lastRequest = Date.now();
    const query = new URL('https://api.jikan.moe/v4/manga');
    query.searchParams.set('q', manga.title.trim());
    query.searchParams.set('limit', '25');
    query.searchParams.set('sfw', 'true');
    try {
      const response = await fetch(query, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) });
      if (!response.ok) throw new Error('metadata unavailable');
      const payload: unknown = await response.json();
      if (signal.aborted || !readCoverFallback()) return undefined;
      const url = selectFallbackCover(payload, manga.title, manga.author);
      if (url) cache.set(key, url);
      else misses.set(key, Date.now() + 3600000);
      return url;
    } catch {
      if (!signal.aborted) misses.set(key, Date.now() + 300000);
      return undefined;
    } finally {
      while (misses.size > 250) misses.delete(misses.keys().next().value!);
    }
  });
  pending.set(key, task);
  tail = task.catch(() => undefined);
  void task.finally(() => pending.delete(key));
  return task;
}
