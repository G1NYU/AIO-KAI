/**
 * Public ListenBrainz site-wide charts, independent of the playback source.
 * Metadata is for discovery only. Users select an exact match from their addon.
 * No accounts, private addon URLs, credentials or automatic fallback matching.
 */
export const LISTENBRAINZ_CHARTS = 'https://api.listenbrainz.org/1/stats/sitewide/recordings?range=week&count=30';

export type TrendingRecording = {
  key: string;
  artist: string;
  title: string;
  album?: string;
  listens: number;
};

function obj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function name(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : undefined;
}

export function parseTrendingRecordings(value: unknown): TrendingRecording[] {
  if (!obj(value) || !obj(value.payload) || !Array.isArray(value.payload.recordings)) {
    throw new Error('ListenBrainz returned an unexpected chart response.');
  }
  const seen = new Set<string>();
  const result: TrendingRecording[] = [];
  for (const raw of value.payload.recordings) {
    if (!obj(raw)) continue;
    const artist = name(raw.artist_name);
    const title = name(raw.track_name);
    if (!artist || !title) continue;
    const key = artist.toLocaleLowerCase() + '|' + title.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      key, artist, title,
      album: name(raw.release_name),
      listens: typeof raw.listen_count === 'number' && Number.isFinite(raw.listen_count)
        ? Math.max(0, raw.listen_count) : 0,
    });
    if (result.length >= 24) break;
  }
  return result;
}

export async function fetchTrendingRecordings(signal?: AbortSignal): Promise<TrendingRecording[]> {
  let response: Response;
  try {
    response = await fetch(LISTENBRAINZ_CHARTS, {
      signal, credentials: 'omit', cache: 'no-store', redirect: 'error',
    });
  } catch (reason) {
    if (signal?.aborted) throw reason;
    throw new Error('ListenBrainz charts are currently unreachable.');
  }
  if (response.status === 204) return [];
  if (!response.ok) throw new Error('ListenBrainz charts are temporarily unavailable.');
  return parseTrendingRecordings(await response.json() as unknown);
}
