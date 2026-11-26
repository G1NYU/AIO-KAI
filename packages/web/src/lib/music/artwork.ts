/** Request a larger version of the SAME known Google image. Never rewrite
 * signed URLs, guess an unrelated album, or upscale local artwork. */
export function expandedArtwork(original: string, target = 1024): string {
  target = Math.max(96, Math.min(2048, Math.round(target)));
  let url: URL;
  try { url = new URL(original); } catch { return original; }
  const googleImage = /^(?:lh[3-6]\.googleusercontent\.com|yt3\.(?:ggpht|googleusercontent)\.com)$/.test(url.hostname);
  if (url.protocol !== 'https:' || !googleImage
    || url.port || url.username || url.password || url.search || url.hash) return original;
  const size = /=w(\d{1,4})-h(\d{1,4})(?=-|$)/.exec(url.pathname);
  if (size) {
    const w = Number(size[1]), h = Number(size[2]), largest = Math.max(w, h);
    if (w <= 0 || h <= 0 || largest >= target) return original;
    const scale = target / largest;
    url.pathname = url.pathname.replace(size[0], '=w' + Math.round(w * scale) + '-h' + Math.round(h * scale));
    return url.href;
  }
  const square = /=s(\d{1,4})(?=-|$)/.exec(url.pathname);
  if (square && Number(square[1]) > 0 && Number(square[1]) < target) {
    url.pathname = url.pathname.replace(square[0], '=s' + target);
    return url.href;
  }
  return original;
}

/** Explicit standard thumbnails of the same video may use higher quality
 * variants. YouTube Music also supplies public sqp/rs resize URLs. Build a
 * separate canonical candidate for those; keep the exact original as fallback.
 * Unknown query parameters, hosts and paths are never rewritten. */
function videoArtwork(original: string, target: number): string[] {
  let url: URL;
  try { url = new URL(original); } catch { return []; }
  if (url.protocol !== 'https:' || url.hostname !== 'i.ytimg.com' || url.port || url.username || url.password || url.hash) return [];
  const transformed = url.search.length > 0;
  if (transformed) {
    const parameters = [...url.searchParams];
    if (parameters.length !== 2 || !url.searchParams.has('sqp') || !url.searchParams.has('rs')
      || parameters.some(([key, value]) => !['sqp', 'rs'].includes(key) || !/^[\w-]{1,512}$/.test(value))) return [];
  }
  const match = /^\/(vi|vi_webp)\/([\w-]{11})\/(default|mqdefault|hqdefault|sddefault|maxresdefault)\.(jpg|webp)$/.exec(url.pathname);
  if (!match) return [];
  const names = ['default','mqdefault','hqdefault','sddefault','maxresdefault'];
  const sizes = [120,320,480,640,1280];
  const originalIndex = names.indexOf(match[3]);
  let highest = sizes.findIndex(size => size >= target);
  if (highest < 0) highest = sizes.length - 1;
  // A queried filename can itself be reduced. Include its canonical form when
  // that quality is requested, while small rows keep the provider thumbnail.
  return names.slice(originalIndex + (transformed ? 0 : 1), highest + 1).reverse().map(name => {
    url.pathname = '/' + match[1] + '/' + match[2] + '/' + name + '.' + match[4];
    url.search = '';
    return url.href;
  });
}

/** Keep requests bounded and stable across small layout changes. object-cover
 * may crop a wide image to a square, so account for its decoded aspect too. */
export function artworkPixelTarget(minimum: number, width: number, height: number, ratio: number, naturalWidth = 0, naturalHeight = 0): number {
  const density = Number.isFinite(ratio) && ratio > 0 ? Math.min(4, ratio) : 1;
  const rendered = naturalWidth > 0 && naturalHeight > 0
    ? Math.max(width / naturalWidth, height / naturalHeight) * Math.max(naturalWidth, naturalHeight)
    : Math.max(width, height);
  const pixels = Number.isFinite(rendered) && rendered > 0 ? Math.ceil(rendered * density / 128) * 128 : 0;
  return Math.max(96, Math.min(2048, Math.max(minimum, pixels)));
}

export function artworkCandidates(original: string, target = 1024): string[] {
  target = Math.max(96, Math.min(2048, Math.round(target)));
  return [...new Set([
    ...videoArtwork(original, target),
    expandedArtwork(original, target),
    expandedArtwork(original, Math.min(544, Math.round(target * .6))),
    original,
  ])];
}

/** Some thumbnail endpoints return tiny placeholder images with HTTP 200.
 * Prefer a genuine larger decode, but keep the exact original as last resort. */
export function artworkAcceptable(candidate: string, original: string, width: number, height: number, target: number): boolean {
  return width > 0 && height > 0 && (candidate === original || Math.max(width, height) >= Math.min(512, target * .6));
}

/** Bounded, session-only cache of a decoded variant choice, not image bytes.
 * Browser HTTP cache owns the actual image. Never persist signed URLs. */
export class ArtworkChoiceCache {
  private entries = new Map<string, { url: string; expires: number }>();
  constructor(private limit = 96, private ttl = 5 * 60_000) {}
  get(source: string, target: number, now = Date.now()): string | undefined {
    const key = source + '\n' + target;
    const item = this.entries.get(key);
    if (!item) return;
    this.entries.delete(key);
    if (item.expires <= now) return;
    this.entries.set(key, item);
    return item.url;
  }
  remember(source: string, target: number, url: string, width: number, height: number, now = Date.now()): void {
    const choices = artworkCandidates(source, target);
    // A transient failure must not pin a small fallback ahead of the full
    // image for later player openings. The HTTP cache still retains its bytes.
    if (choices.length < 2 || !choices.includes(url) || Math.max(width, height) < target) return;
    const key = source + '\n' + target;
    this.entries.delete(key);
    this.entries.set(key, { url, expires: now + this.ttl });
    while (this.entries.size > this.limit) {
      const first = this.entries.keys().next();
      if (first.done) break;
      this.entries.delete(first.value);
    }
  }
}
