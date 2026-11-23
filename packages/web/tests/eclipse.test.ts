import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addonEndpoint, loadAddon, loadStore, manifestUrlFor, parseManifest,
  parseStoreRegistry, parseStream, parseTracks, resolveTrack, safeHttpsUrl, searchAddon,
} from '../src/lib/music/eclipse';

afterEach(() => vi.unstubAllGlobals());

describe('Eclipse public addon compatibility', () => {
  it('filters duplicate and unsafe registry entries', () => {
    expect(parseStoreRegistry({ addons: [
      { id: 'one', name: 'SoundCloud', setupUrl: 'https://sc.eclipsemusic.app/' },
      { id: 'one', name: 'Duplicate', setupUrl: 'https://ignore.example/' },
      { id: 'two', name: 'Grid', manifestUrl: 'https://provider.example/manifest.json' },
      { id: 'bad', name: 'Code', setupUrl: 'javascript:alert(1)' },
    ] }).map(({ id }) => id)).toEqual(['one', 'two']);
    expect(() => parseStoreRegistry({})).toThrow('invalid registry');
  });

  it('preserves personal URL paths while rejecting unsafe schemes', () => {
    expect(safeHttpsUrl('https://user:pass@example.com/')).toBeUndefined();
    expect(manifestUrlFor('https://source.example/fake-secret/'))
      .toBe('https://source.example/fake-secret/manifest.json');
    expect(addonEndpoint('https://source.example/fake-secret/manifest.json', 'stream/a%2Fb'))
      .toBe('https://source.example/fake-secret/stream/a%2Fb');
    expect(() => manifestUrlFor('file:///etc/passwd')).toThrow('HTTPS');
    expect(() => manifestUrlFor('http://remote.example/')).toThrow('HTTPS');
  });

  it('supports YouTube base URLs plus UltraMax and Tido manifest shapes with fake tokens', () => {
    const youtube = 'https://youtube.example/u/fake-profile';
    const deezer = 'https://deezer.example/' + 'a'.repeat(192) + '/manifest.json';
    const tidal = 'https://tidal.example/0123456789abcdef0123456789abcdef/manifest.json';
    for (const [input, expected] of [
      [youtube, youtube + '/manifest.json'], [deezer, deezer], [tidal, tidal],
    ]) {
      expect(manifestUrlFor(input)).toBe(expected);
      expect(addonEndpoint(input, 'search')).toBe(expected.replace(/manifest\.json$/, 'search'));
    }
  });

  it('accepts Tido optional resources but not a store-only manifest', () => {
    expect(parseManifest({
      id: 'com.example.tido', name: 'Tido', version: '1.44.3',
      resources: ['search', 'stream', 'settings', 'isrc', 'resolve', 'notifications'],
    }).resources).toContain('stream');
    expect(() => parseManifest({ id: 'store', name: 'Store', version: '1', resources: ['addon-store'] }))
      .toThrow('both music search and streaming');
  });

  it('parses tracks and rejects non-HTTP media and malformed results', () => {
    expect(parseTracks({ albums: [{ id: 'a' }] })).toEqual([]);
    expect(parseTracks({ tracks: [
      { id: 'one', title: 'Track', artist: 'Artist', artworkURL: 'data:text/html,bad' },
    ] })[0].artworkURL).toBeUndefined();
    expect(() => parseTracks({ tracks: {} })).toThrow('invalid search results');
  });

  it('rejects HLS and DASH, even for direct stream URLs', async () => {
    expect(parseStream({ url: 'https://audio.example/a.flac' }).url).toBe('https://audio.example/a.flac');
    expect(() => parseStream({ url: 'https://audio.example/a.m3u8', manifest: 'hls' })).toThrow('HLS or DASH');
    expect(() => parseStream({ url: 'https://audio.example/a.mpd' })).toThrow('HLS or DASH');
    await expect(resolveTrack('https://provider.example/fake/manifest.json',
      { id: 'a', title: 'Track', artist: 'Artist', streamURL: 'https://audio.example/a.m3u8' }
    )).rejects.toThrow('HLS or DASH');
  });

  it('uses the documented endpoints without sending session cookies', async () => {
    const requests: { url: string; credentials?: RequestCredentials }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, opts: RequestInit) => {
      requests.push({ url, credentials: opts.credentials });
      if (url.endsWith('registry.json')) return new Response(JSON.stringify({
        addons: [{ id: 'one', name: 'Test', setupUrl: 'https://test.example/' }],
      }));
      if (url.endsWith('manifest.json')) return new Response(JSON.stringify({
        id: 'source', name: 'Source', version: '1', resources: ['search', 'stream'],
      }));
      if (url.includes('/search?')) return new Response(JSON.stringify({
        tracks: [{ id: 'track/one', title: 'One', artist: 'Artist' }],
      }));
      return new Response(JSON.stringify({ url: 'https://audio.example/track.mp3' }));
    }));
    expect((await loadStore())[0].id).toBe('one');
    const manifest = 'https://source.example/fake-token/manifest.json';
    expect((await loadAddon(manifest)).name).toBe('Source');
    const tracks = await searchAddon(manifest, 'My song');
    expect(tracks[0].id).toBe('track/one');
    expect((await resolveTrack(manifest, tracks[0])).url).toBe('https://audio.example/track.mp3');
    expect(requests.map(({ url }) => url)).toContain('https://source.example/fake-token/search?q=My+song');
    expect(requests.every(({ credentials }) => credentials === 'omit')).toBe(true);
  });
});
