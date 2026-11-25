export type LandscapeArtwork = { url: string; provider: 'kitsu' | 'nekos' };

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

export async function landscapeCandidates(signal: AbortSignal): Promise<LandscapeArtwork[]> {
  try {
    const response = await fetch(kitsuUrl, {
      signal, credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/vnd.api+json' },
    });
    if (response.ok) return [...kitsuLandscapes(await response.json()), NEKOS_LANDSCAPE];
  } catch { /* Local artwork remains available even if both providers fail. */ }
  return [NEKOS_LANDSCAPE];
}
