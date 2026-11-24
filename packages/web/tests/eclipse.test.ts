import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addonEndpoint, loadAddon, loadStore, manifestUrlFor, parseManifest,
  parseStoreRegistry, parseStream, parseTracks, resolveTrack, safeHttpsUrl, searchAddon,
  parseCatalogItems, catalogTrack, loadCatalog, loadDetail, parseDetail, parseSearchResults,
} from '../src/lib/music/eclipse';

import { providerFor } from '../src/lib/music/providers';
import type { MusicConnection } from '../src/lib/music/connections';

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
  it('preserves query-based access settings for addon search and stream endpoints', () => {
    const manifest = 'https://provider.example/private/manifest.json?key=synthetic-token';
    expect(addonEndpoint(manifest, 'search'))
      .toBe('https://provider.example/private/search?key=synthetic-token');
    expect(addonEndpoint(manifest, 'stream/track'))
      .toBe('https://provider.example/private/stream/track?key=synthetic-token');
  });

  it('reports fetch failures without exposing a personalized addon URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch from a private addon URL');
    }));
    await expect(loadAddon('https://provider.example/private/manifest.json'))
      .rejects.toThrow('Cannot reach the addon.');
  });

  it('accepts named catalog shelves and safely rejects malformed entries', () => {
    const manifest = parseManifest({
      id: 'my.catalog', name: 'My Catalog', version: '1.0',
      resources: ['search', 'stream', 'catalog'],
      catalogs: [
        { id: 'hits', type: 'track', name: 'Top Hits' },
        { id: 'albums', type: 'album', name: 'Albums' },
        { id: 'hits', type: 'track', name: 'Duplicate' },
        { id: 'bad', type: 'html', name: 'Unsafe' },
      ],
    });
    expect(manifest.catalogs?.map((row) => row.id)).toEqual(['hits', 'albums']);
    expect(parseCatalogItems({
      items: [
        { id: 'song', type: 'track', title: 'Song', artist: 'Artist', durationMs: 180000 },
        { id: 'album', type: 'album', title: 'Album' },
      ],
    }, 'track')).toHaveLength(1);
    expect(catalogTrack(parseCatalogItems({items: [{id:'song',type:'track',title:'Song',artist:'Artist',durationMs:180000}]}, 'track')[0]).duration).toBe(180);
  });

  it('keeps catalog requests scoped to source-owned ids and tokenized URLs', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      requests.push(url);
      if (url.includes('/catalog/')) return new Response(JSON.stringify({
        items: [{ id: 't-1', type: 'track', title: 'Track', artist: 'A', durationMs: 125000 }],
      }));
      return new Response(JSON.stringify({
        id: 'album/1', title: 'Album', tracks: [{ id: 't-1', title: 'Track', artist: 'A' }],
      }));
    }));
    const base = 'https://provider.test/private/manifest.json?quality=flac';
    const catalog = {id:'top/mixes',type:'track' as const,name:'Top'};
    const items = await loadCatalog(base, catalog, 120);
    expect(items[0].id).toBe('t-1');
    const result = await loadDetail(base, { id: 'album/1', type: 'album', title: 'Album' });
    expect(result.tracks[0].id).toBe('t-1');
    expect(requests[0]).toBe('https://provider.test/private/catalog/top%2Fmixes?quality=flac&skip=100');
    expect(requests[1]).toBe('https://provider.test/private/album/album%2F1?quality=flac');
  });

  it('parses all four Eclipse search result groups and artist details', () => {
    const result = parseSearchResults({
      tracks: [{ id: 'one', title: 'Track', artist: 'Artist' }],
      albums: [{ id: 'album', title: 'Album', artist: 'Artist' }],
      artists: [{ id: 'artist', name: 'Artist' }],
      playlists: [{ id: 'playlist', title: 'Playlist', creator: 'A' }],
    });
    expect(result.tracks).toHaveLength(1);
    expect(result.albums[0].type).toBe('album');
    expect(result.artists[0].title).toBe('Artist');
    expect(result.playlists[0].artist).toBe('A');
    const detail = parseDetail({
      id:'artist',name:'Artist',
      topTracks:[{id:'one',title:'Song',artist:'Artist'}],
      albums:[{id:'album',title:'Album',artist:'Artist'}],
    }, 'artist');
    expect(detail.tracks).toHaveLength(1);
    expect(detail.albums).toHaveLength(1);
  });

});

describe('unified music provider boundary', () => {
  const connection: MusicConnection = {
    id: 'legacy',
    url: 'https://provider.test/profile/manifest.json?config=synthetic',
    manifest: { id: 'test', name: 'Test', version: '1', resources: ['search', 'stream', 'catalog'] },
  };
  it('routes search, catalogs, details and playback through the bound provider', async () => {
    const requests: { url: string; signal?: AbortSignal | null }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, opts: RequestInit) => {
      requests.push({ url, signal: opts.signal });
      const path = new URL(url).pathname;
      if (path.endsWith('/manifest.json')) return new Response(JSON.stringify({
        ...connection.manifest, catalogs: [{ id: 'hits', type: 'track', name: 'Hits' }],
      }));
      if (path.endsWith('/search')) return new Response(JSON.stringify({ tracks: [
        { id: 'track/1', title: 'Song', artist: 'Artist' },
      ] }));
      if (path.endsWith('/catalog/hits')) return new Response(JSON.stringify({ items: [
        { id: 'track/1', type: 'track', title: 'Song', artist: 'Artist' },
      ] }));
      if (path.endsWith('/album/a')) return new Response(JSON.stringify({
        id: 'a', title: 'Album', tracks: [{ id: 'track/1', title: 'Song', artist: 'Artist' }],
      }));
      return new Response(JSON.stringify({ url: 'https://audio.example/song.flac' }));
    }));
    const provider = providerFor(connection);
    const signal = new AbortController().signal;
    expect(provider.kind).toBe('eclipse');
    const result = await provider.search('Artist & Song', signal);
    expect(result.tracks[0].id).toBe('track/1');
    const catalogs = await provider.catalogs(signal);
    expect(catalogs[0].id).toBe('hits');
    expect((await provider.catalog(catalogs[0], 0, signal))[0].id).toBe('track/1');
    expect((await provider.detail({ id: 'a', type: 'album', title: 'Album' }, signal)).title).toBe('Album');
    expect((await provider.resolve(result.tracks[0], signal)).url).toBe('https://audio.example/song.flac');
    expect(requests).toHaveLength(5);
    expect(requests.every(({ url, signal: requestSignal }) =>
      new URL(url).origin === 'https://provider.test' &&
      new URL(url).searchParams.get('config') === 'synthetic' && requestSignal === signal)).toBe(true);
    expect(new URL(requests[0].url).searchParams.get('q')).toBe('Artist & Song');
    expect(new URL(requests[4].url).pathname).toBe('/profile/stream/track%2F1');
  });
  it('returns no catalog shelves when a provider does not advertise catalogs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ...connection.manifest, resources: ['search', 'stream'],
      catalogs: [{ id: 'hits', type: 'track', name: 'Hits' }],
    }))));
    expect(await providerFor(connection).catalogs()).toEqual([]);
  });
  it('fails closed on an unregistered provider and never calls the network', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(() => providerFor({ ...connection, kind: 'unknown' } as unknown as MusicConnection))
      .toThrow('Unsupported music provider.');
    expect(fetch).not.toHaveBeenCalled();
  });
});
