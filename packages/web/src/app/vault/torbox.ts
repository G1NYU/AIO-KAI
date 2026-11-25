const api = 'https://api.torbox.app/v1/api/';
type Fetcher = typeof fetch;
export type TorBoxItem = { id: number; name: string; state: string; finished: boolean };

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function torboxLink(input: string): string {
  const url = new URL(input.trim());
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Invalid HTTPS link');
  return url.href;
}

export function torboxItems(payload: unknown): TorBoxItem[] {
  if (!Array.isArray(payload)) throw new Error('Invalid cloud list');
  const items: TorBoxItem[] = [];
  const seen = new Set<number>();
  for (const entry of payload) {
    const item = record(entry);
    if (typeof item.id !== 'number' || !Number.isSafeInteger(item.id) || item.id < 0 || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push({
      id: item.id,
      name: typeof item.name === 'string' ? item.name.slice(0, 300) : '',
      state: typeof item.download_state === 'string' ? item.download_state.slice(0, 80) : '',
      finished: item.download_finished === true,
    });
  }
  return items;
}

export class TorBoxError extends Error {
  constructor(public readonly kind: 'auth' | 'rate' | 'request' | 'network') { super(kind); }
}

async function request(token: string, path: 'webdl/mylist?limit=100&files=false' | 'webdl/createwebdownload', signal: AbortSignal, body?: URLSearchParams, fetcher: Fetcher = fetch) {
  const key = token.trim();
  if (!key || /[\r\n]/.test(key)) throw new TorBoxError('auth');
  let response: Response;
  try {
    response = await fetcher(api + path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' },
      body, signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store',
    });
  } catch { throw new TorBoxError('network'); }
  if (response.status === 401 || response.status === 403) throw new TorBoxError('auth');
  if (response.status === 429) throw new TorBoxError('rate');
  if (!response.ok) throw new TorBoxError('request');
  let data: Record<string, unknown>;
  try { data = record(await response.json()); } catch { throw new TorBoxError('request'); }
  if (data.success !== true) throw new TorBoxError('request');
  return data.data;
}

export async function listTorBox(token: string, signal: AbortSignal, fetcher?: Fetcher) {
  return torboxItems(await request(token, 'webdl/mylist?limit=100&files=false', signal, undefined, fetcher));
}

export async function submitTorBox(token: string, input: string, signal: AbortSignal, fetcher?: Fetcher) {
  await request(token, 'webdl/createwebdownload', signal, new URLSearchParams({ link: torboxLink(input) }), fetcher);
}
