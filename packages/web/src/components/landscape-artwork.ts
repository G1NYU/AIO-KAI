export type LandscapeArtwork = { url: string; provider: 'kitsu' | 'nekos' | 'local' };

export const LANDSCAPE_ROTATION_MS = 12_000;
const candidateLifetime = 15 * 60_000;
const retryLifetime = 60_000;

/** Bundled illustrations keep a useful rotation when a provider has only one
 * suitable cover. They remain decoration, never a title's source artwork. */
export function localLandscapes(fallback?: string): LandscapeArtwork[] {
  return [...new Set([fallback, '/design/yomi/hero-torii.webp', '/design/shared/hero-train.webp', '/design/shared/hero-neon.webp'])]
    .filter((url): url is string => !!url).map(url => ({ url, provider: 'local' }));
}

export const NEKOS_LANDSCAPE: LandscapeArtwork = {
  url: 'https://api.nekosapi.com/v4/images/random/file?rating=safe&tags=landscape',
  provider: 'nekos',
};
const kitsuUrl = 'https://kitsu.io/api/edge/manga?sort=popularityRank&page%5Blimit%5D=20';

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

export function kitsuLandscapes(payload: unknown): LandscapeArtwork[] {
  const data = record(payload)?.data;
  if (!Array.isArray(data)) return [];
  const urls = new Set<string>();
  for (const item of data) {
    const attributes = record(record(item)?.attributes);
    if (!attributes || attributes.adult === true || !['G', 'PG'].includes(String(attributes.ageRating))) continue;
    const cover = record(attributes.coverImage);
    const url = cover?.large ?? cover?.original;
    if (typeof url !== 'string') continue;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port ||
          !['media.kitsu.io', 'media.kitsu.app'].includes(parsed.hostname)) continue;
      urls.add(parsed.href);
    } catch { continue; }
    if (urls.size >= 8) break;
  }
  return Array.from(urls, url => ({ url, provider: 'kitsu' }));
}

async function fetchLandscapeCandidates(signal: AbortSignal): Promise<LandscapeArtwork[]> {
  try {
    const response = await fetch(kitsuUrl, {
      signal, credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/vnd.api+json' },
    });
    if (response.ok) return [...kitsuLandscapes(await response.json()), NEKOS_LANDSCAPE];
  } catch { /* Local artwork remains available even if both providers fail. */ }
  if (signal.aborted) throw new DOMException('', 'AbortError');
  return [NEKOS_LANDSCAPE];
}

/** One bounded, in-memory pool per app session. Visible consumers share the
 * request; cancelling the last consumer aborts it. No browsing history or
 * artwork URLs are written to storage. */
export class LandscapeArtworkPool {
  private cached?: { items: LandscapeArtwork[]; expires: number };
  private pending?: { controller: AbortController; promise: Promise<LandscapeArtwork[]>; users: number; settled: boolean };
  private failed = new Set<string>();
  private remaining: string[] = [];
  private last = '';

  constructor(
    private fetcher = fetchLandscapeCandidates,
    private clock = Date.now,
    private random = Math.random,
  ) {}

  load(signal: AbortSignal): Promise<LandscapeArtwork[]> {
    if (signal.aborted) return Promise.reject(new DOMException('', 'AbortError'));
    if (this.cached && this.cached.expires > this.clock()) return Promise.resolve(this.cached.items);
    if (!this.pending) {
      const controller = new AbortController();
      const request = { controller, promise: this.fetcher(controller.signal), users: 0, settled: false };
      this.pending = request;
      void request.promise.then(items => {
        request.settled = true;
        if (controller.signal.aborted) return;
        this.cached = { items, expires: this.clock() + (items.some(item => item.provider === 'kitsu') ? candidateLifetime : retryLifetime) };
        this.failed.clear();
      }, () => { request.settled = true; }).finally(() => {
        if (this.pending === request) this.pending = undefined;
      });
    }
    const request = this.pending;
    request.users++;
    return new Promise((resolve, reject) => {
      let finished = false;
      const release = () => {
        if (finished) return false;
        finished = true;
        signal.removeEventListener('abort', abort);
        if (--request.users === 0 && !request.settled) {
          request.controller.abort();
          if (this.pending === request) this.pending = undefined;
        }
        return true;
      };
      const abort = () => { if (release()) reject(new DOMException('', 'AbortError')); };
      signal.addEventListener('abort', abort, { once: true });
      void request.promise.then(items => { if (release()) resolve(items); }, error => { if (release()) reject(error); });
    });
  }

  available(items: LandscapeArtwork[]): LandscapeArtwork[] {
    return items.filter(item => !this.failed.has(item.url));
  }

  reject(url: string): void { this.failed.add(url); }

  next(items: LandscapeArtwork[], current?: string): LandscapeArtwork | undefined {
    const available = this.available(items);
    const urls = new Set(available.map(item => item.url));
    this.remaining = this.remaining.filter(url => urls.has(url));
    if (!this.remaining.length) {
      this.remaining = [...urls];
      for (let i = this.remaining.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [this.remaining[i], this.remaining[j]] = [this.remaining[j], this.remaining[i]];
      }
    }
    // Avoid both the currently displayed picture and the last picture chosen
    // by another hero, including at a cycle boundary or after navigation.
    let at = this.remaining.findIndex(url => url !== current && url !== this.last);
    if (at < 0) at = this.remaining.findIndex(url => url !== current);
    if (at < 0 && available.length > 1) {
      const other = available.find(item => item.url !== current)!;
      this.last = other.url;
      return other;
    }
    const [url] = this.remaining.splice(Math.max(0, at), 1);
    if (url) this.last = url;
    return available.find(item => item.url === url);
  }
}

export const landscapeArtworkPool = new LandscapeArtworkPool();
export const landscapeCandidates = (signal: AbortSignal) => landscapeArtworkPool.load(signal);
