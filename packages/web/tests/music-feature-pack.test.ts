import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTrendingRecordings, parseTrendingRecordings } from '../src/lib/music/discovery';
import { DEFAULT_PLAYER_THEME, isPlayerTheme, PLAYER_PALETTES } from '../src/lib/music/player-theme';

afterEach(() => vi.unstubAllGlobals());

describe('AIO-KAI music theme pack', () => {
  it('only accepts bundled, validated theme names', () => {
    expect(DEFAULT_PLAYER_THEME).toBe('aio-dark');
    expect(Object.keys(PLAYER_PALETTES)).toHaveLength(3);
    expect(isPlayerTheme('nightfall')).toBe(true);
    expect(isPlayerTheme('__proto__')).toBe(false);
    expect(isPlayerTheme('https://elsewhere.test/skin.css')).toBe(false);
  });
});

describe('ListenBrainz provider-independent discovery', () => {
  const mock = {
    payload: { recordings: [
      { artist_name: 'Artist', track_name: 'First', listen_count: 21, release_name: 'Album' },
      { artist_name: 'Artist', track_name: 'First', listen_count: 12 },
      { artist_name: 'Someone', track_name: 'Second', listen_count: 7 },
      { artist_name: '', track_name: 'Not valid' },
    ] },
  };

  it('parses charts, deduplicates recordings and never injects streams', () => {
    const parsed = parseTrendingRecordings(mock);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ title: 'First', artist: 'Artist', listens: 21 });
    expect(parsed[0]).not.toHaveProperty('streamURL');
    expect(() => parseTrendingRecordings({})).toThrow('unexpected chart');
  });

  it('fetches public metadata without cookies or personal addon configuration', async () => {
    const calls: { url: string; credentials?: RequestCredentials }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, opts: RequestInit) => {
      calls.push({url, credentials: opts.credentials});
      return new Response(JSON.stringify(mock));
    }));
    expect((await fetchTrendingRecordings())[0].artist).toBe('Artist');
    expect(calls[0].url).toContain('api.listenbrainz.org/1/stats/sitewide/recordings');
    expect(calls[0].credentials).toBe('omit');
    expect(calls[0].url).not.toContain('manifest');
  });

  it('handles empty charts and API failures without untrusted URLs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, {status: 204})));
    expect(await fetchTrendingRecordings()).toEqual([]);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('private data included'); }));
    await expect(fetchTrendingRecordings()).rejects.toThrow('currently unreachable');
  });
});
