import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTrendingRecordings, parseTrendingRecordings } from '../src/lib/music/discovery';
import { DEFAULT_PLAYER_THEME, isPlayerTheme, PLAYER_PALETTES } from '../src/lib/music/player-theme';
import { NOCTURNE_STAGE } from '../src/lib/music/nocturne-stage';
import { JUNCTION_STAGE } from '../src/lib/music/junction-stage';

afterEach(() => vi.unstubAllGlobals());

describe('Tsugi music theme pack', () => {
  it('only accepts bundled, validated theme names', () => {
    expect(DEFAULT_PLAYER_THEME).toBe('sumi');
    expect(Object.keys(PLAYER_PALETTES).sort()).toEqual(['aio-dark', 'carbon', 'matte', 'mocha', 'nightfall', 'sumi']);
    expect(isPlayerTheme('sumi')).toBe(true);
    expect(isPlayerTheme('mocha')).toBe(true);
    expect(isPlayerTheme('matte')).toBe(true);
    expect(isPlayerTheme('nightfall')).toBe(true);
    expect(isPlayerTheme('__proto__')).toBe(false);
    expect(isPlayerTheme('https://elsewhere.test/skin.css')).toBe(false);
  });

  it('maintains readable contrast in every bundled player theme', () => {
    const luminance = (hex: string) => {
      const rgb = [1,3,5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
        .map((x) => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
      return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    };
    for (const palette of Object.values(PLAYER_PALETTES)) {
      const foreground = luminance(palette.foreground);
      const canvas = luminance(palette.canvas);
      const contrast = (Math.max(foreground, canvas) + 0.05) /
        (Math.min(foreground, canvas) + 0.05);
      expect(contrast).toBeGreaterThan(7);
    }
  });

  it('ships a rich Junction stage with real lyrics, queue and player transport', () => {
    expect(JUNCTION_STAGE.layers.length).toBeGreaterThanOrEqual(25);
    for (const kind of ['lyricsInline', 'queue', 'volumeKnob', 'shuffle', 'repeat', 'text', 'favorite']) {
      expect(JUNCTION_STAGE.layers.some((layer) => layer.kind === kind)).toBe(true);
    }
    expect(JUNCTION_STAGE.layers.every((layer) => layer.x >= 0 && layer.x <= 1)).toBe(true);
  });

  it('ships a complete Nocturne stage with real player controls', () => {
    expect(NOCTURNE_STAGE.layers).toHaveLength(12);
    expect(NOCTURNE_STAGE.layers.some((layer) => layer.kind === 'playPause')).toBe(true);
    expect(NOCTURNE_STAGE.layers.some((layer) => layer.kind === 'progressBar')).toBe(true);
    expect(NOCTURNE_STAGE.layers.every((layer) => layer.x >= 0 && layer.x <= 1)).toBe(true);
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
