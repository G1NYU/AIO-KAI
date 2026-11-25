import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTrendingRecordings, parseTrendingRecordings } from '../src/lib/music/discovery';
import { DEFAULT_PLAYER_THEME, isPlayerTheme, PLAYER_PALETTES, PLAYER_ACCENTS, isPlayerAccent, withPlayerAccent } from '../src/lib/music/player-theme';
import { NOCTURNE_STAGE } from '../src/lib/music/nocturne-stage';
import { JUNCTION_STAGE } from '../src/lib/music/junction-stage';
import { artworkCandidates, expandedArtwork } from '../src/lib/music/artwork';
import { nativeYouTubeTarget, parseYouTubeMusicResults } from '../src/lib/music/youtube-music';

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

describe('Independent accents and expanded album artwork', () => {
  it('keeps canvas independent of the selected accent', () => {
    for (const palette of Object.values(PLAYER_PALETTES)) {
      for (const id of Object.keys(PLAYER_ACCENTS)) {
        if (!isPlayerAccent(id)) throw new Error('invalid preset');
        const result = withPlayerAccent(palette, id);
        expect(result.canvas).toBe(palette.canvas);
        expect(result.accent).toBe(PLAYER_ACCENTS[id]);
      }
    }
    expect(isPlayerAccent('__proto__')).toBe(false);
    expect(withPlayerAccent({ ...PLAYER_PALETTES.sumi, canvas: 'rgb(245 245 245)', foreground: 'rgb(20 20 26)' }, 'silver').accent).toBe('rgb(20 20 26)');
  });
  it('requests larger exact Google album artwork while preserving its aspect and options', () => {
    expect(expandedArtwork('https://lh3.googleusercontent.com/album=w120-h120-l90-rj')).toBe('https://lh3.googleusercontent.com/album=w1024-h1024-l90-rj');
    expect(expandedArtwork('https://lh3.googleusercontent.com/album=w120-h60')).toBe('https://lh3.googleusercontent.com/album=w1024-h512');
    expect(expandedArtwork('https://lh3.googleusercontent.com/album=s200-c')).toBe('https://lh3.googleusercontent.com/album=s1024-c');
    for (const url of ['https://lh3.googleusercontent.com/album=w1200-h1200', 'https://lh3.googleusercontent.com/album=w120-h120?sig=test', 'https://lh3.googleusercontent.com.example.test/album=w120-h120', 'blob:local', 'https://i.ytimg.com/vi/abcdefghijk/default.jpg']) expect(expandedArtwork(url)).toBe(url);
  });
  it('tries an intermediate exact-image size before the small thumbnail', () => {
    const source = 'https://lh3.googleusercontent.com/album=w120-h120';
    expect(artworkCandidates(source)).toEqual([
      'https://lh3.googleusercontent.com/album=w1024-h1024',
      'https://lh3.googleusercontent.com/album=w544-h544', source,
    ]);
    expect(artworkCandidates('blob:local')).toEqual(['blob:local']);
    expect(artworkCandidates('https://lh3.googleusercontent.com/album=w120-h120?sig=test')).toEqual(['https://lh3.googleusercontent.com/album=w120-h120?sig=test']);
  });
  it('selects the largest declared YouTube Music thumbnail, not the last one', () => {
    const large = 'https://lh3.googleusercontent.com/art=w544-h544';
    const result = parseYouTubeMusicResults({ musicResponsiveListItemRenderer: {
      playlistItemData: { videoId: 'abcdefghijk' },
      flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Fixture song' }] } } }],
      thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: [
        { url: large, width: 544, height: 544 }, { url: 'https://lh3.googleusercontent.com/art=w60-h60', width: 60, height: 60 },
      ] } } },
    } });
    expect(result.tracks[0]?.artworkURL).toBe(large);
  });
});


describe('Windows native playback admission', () => {
  it('constructs only canonical public targets for the native resolver', () => {
    expect(nativeYouTubeTarget('abcdefghijk')).toBe('https://www.youtube.com/watch?v=abcdefghijk');
    for (const id of ['abc','abcdefghij/','abcdefghijk&list=x','https://example.test']) expect(()=>nativeYouTubeTarget(id)).toThrow();
  });
});
