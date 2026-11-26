import { afterEach, describe, expect, it, vi } from 'vitest';
import { readMusicSources, remembersMusicSources, saveMusicSources, youtubeMusicConnection, soundcloudMusicConnection, SOUNDCLOUD_MUSIC_ID } from '../src/lib/music/connections';

import { parseYouTubeMusicHome, youtubeMusicProvider } from '../src/lib/music/youtube-music';
import { parseSoundCloudTracks, publicSoundCloudId, nativeSoundCloudTarget, soundcloudMusicProvider } from '../src/lib/music/soundcloud';
import { providerFor } from '../src/lib/music/providers';

const values = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem(key: string) { return values.get(key) ?? null; },
  setItem(key: string, value: string) { values.set(key, value); },
  removeItem(key: string) { values.delete(key); },
});

const example = {
  id: 'testing',
  url: 'https://example.test/fictional-secret/manifest.json',
  manifest: {
    id: 'test.provider', name: 'Test source', version: '1.0',
    resources: ['search', 'stream'],
  },
};

afterEach(() => {
  values.clear();
});

describe('remembered music sources', () => {
  it('does not store private sources without explicit consent', () => {
    saveMusicSources(false, [example]);
    expect(readMusicSources()).toEqual([]);
    expect(values.size).toBe(0);
  });

  it('restores opted-in sources, then forgets them when unchecked', () => {
    saveMusicSources(true, [example]);
    expect(remembersMusicSources()).toBe(true);
    expect(readMusicSources()).toEqual([example]);
    saveMusicSources(false, [example]);
    expect(remembersMusicSources()).toBe(false);
    expect(readMusicSources()).toEqual([]);
  });

  it('ignores malformed saved data and duplicates', () => {
    saveMusicSources(true, [example, example]);
    expect(readMusicSources()).toEqual([example]);
    values.set('aiostreams-desktop-music-sources-v1', JSON.stringify([{ url: 'javascript:bad' }]));
    expect(readMusicSources()).toEqual([]);
  });
});

describe('provider discriminator migration', () => {
  it('keeps existing stored source IDs and explicit Eclipse provider kinds', () => {
    saveMusicSources(true, [{ ...example, kind: 'eclipse' }]);
    expect(readMusicSources()).toEqual([{ ...example, kind: 'eclipse' }]);
  });
  it('rejects unknown provider kinds instead of guessing an addon transport', () => {
    values.set('aiostreams-desktop-music-remember-v1', 'true');
    values.set('aiostreams-desktop-music-sources-v1', JSON.stringify([
      { ...example, kind: 'future-provider' },
    ]));
    expect(readMusicSources()).toEqual([]);
  });
});

describe('built-in YouTube Music connection', () => {
  it('restores fixed provider metadata and ignores stored endpoint overrides', () => {
    const source = youtubeMusicConnection();
    saveMusicSources(true, [{ ...source, url: 'https://untrusted.example/' }, example]);
    expect(readMusicSources()).toEqual([source, example]);
  });
});

describe('YouTube Music native playback target', () => {
  const track = { id: 'abcdefghijk', title: 'Fixture', artist: 'Fixture' };
  const url = 'https://www.youtube.com/watch?v=abcdefghijk';

  it('accepts the exact native target and preserves direct media on other platforms', async () => {
    const request = vi.fn(async () => ({ url }));
    await expect(youtubeMusicProvider(request).resolve(track)).resolves.toMatchObject({ url });
    expect(request).toHaveBeenCalledWith('audio', track.id, undefined);
    const direct = 'https://media.googlevideo.com/audio';
    await expect(youtubeMusicProvider(async () => ({ url: direct })).resolve(track))
      .resolves.toMatchObject({ url: direct });
  });

  it('rejects mismatched video IDs and unrelated destinations', async () => {
    for (const invalid of [url + '&list=extra', 'https://www.youtube.com/watch?v=zyxwvutsrqp', 'https://example.test/audio']) {
      await expect(youtubeMusicProvider(async () => ({ url: invalid })).resolve(track)).rejects.toThrow();
    }
  });
});

describe('YouTube Music home catalogues', () => {
  const row = (title: string, navigationEndpoint: object) => ({
    musicTwoRowItemRenderer: {
      title: { runs: [{ text: title }] }, navigationEndpoint,
      subtitle: { runs: [{ text: 'Fixture artist' }] },
      thumbnailRenderer: {
        musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: 'https://example.test/cover.jpg' }] } },
      },
    },
  });
  const home = {
    contents: {
      sectionListRenderer: {
        contents: [
          { musicCarouselShelfRenderer: {
            header: { musicCarouselShelfBasicHeaderRenderer: { title: { runs: [{ text: 'From the provider' }] } } },
            contents: [
              row('Track', { watchEndpoint: { videoId: 'abcdefghijk' } }),
              row('Track duplicate', { watchEndpoint: { videoId: 'abcdefghijk' } }),
              row('Album', { browseEndpoint: { browseId: 'MPREfixture' } }),
              row('Invalid', { watchEndpoint: { videoId: 'short' } }),
            ],
          } },
          { musicShelfRenderer: {
            title: { runs: [{ text: 'Unsupported' }] },
            contents: [row('Invalid', { browseEndpoint: { browseId: 'FEmusic_library' } })],
          } },
        ],
      },
    },
  };

  it('keeps real shelf titles, artwork and validated identities; separates mixed collections', () => {
    const shelves = parseYouTubeMusicHome(home);
    expect(shelves.map(shelf => shelf.definition)).toEqual([
      { id: 'home:0:track', name: 'From the provider', type: 'track' },
      { id: 'home:0:album', name: 'From the provider', type: 'album' },
    ]);
    expect(shelves[0]?.items).toMatchObject([{ id: 'abcdefghijk', title: 'Track', artworkURL: 'https://example.test/cover.jpg' }]);
    expect(shelves[1]?.items).toMatchObject([{ id: 'MPREfixture', title: 'Album' }]);
    expect(parseYouTubeMusicHome(null)).toEqual([]);
  });

  it('loads one home response per discovery refresh and exposes only its own catalogues', async () => {
    const request = vi.fn(async () => home);
    const provider = youtubeMusicProvider(request);
    const signal = new AbortController().signal;
    const definitions = await provider.catalogs(signal);
    expect(request).toHaveBeenCalledWith('home', '', signal);
    const first = definitions[0]!;
    expect(await provider.catalog(first, 0, signal)).toHaveLength(1);
    expect(await provider.catalog(first, 30, signal)).toEqual([]);
    expect(await provider.catalog({ ...first, id: 'unknown' })).toEqual([]);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('built-in public SoundCloud source', () => {
  const track = { id: '123456789', title: 'Fixture song', artist: 'Fixture artist', duration: 42.5 };
  it('restores the canonical source without trusting stored endpoints', () => {
    const source = soundcloudMusicConnection();
    saveMusicSources(true, [{ ...source, url: 'https://private.test/token' }, { ...source, id: 'forged' }, example]);
    expect(readMusicSources()).toEqual([source, example]);
    expect(source.id).toBe(SOUNDCLOUD_MUSIC_ID);
    expect(providerFor(source).kind).toBe('soundcloud');
  });
  it('validates the complete decimal identity without a private token or arbitrary URL', async () => {
    expect(publicSoundCloudId('18446744073709551615')).toBe(true);
    for (const id of ['', '0', '01', '1\n', '1/2', '123?secret_token=x', '18446744073709551616']) {
      expect(publicSoundCloudId(id)).toBe(false);
      expect(() => nativeSoundCloudTarget(id)).toThrow();
    }
    const request = vi.fn();
    await expect(soundcloudMusicProvider(request).resolve(track)).resolves.toEqual({ url: 'https://api.soundcloud.com/tracks/123456789' });
    expect(request).not.toHaveBeenCalled();
  });
  it('projects only public display metadata and deduplicates partial rows', () => {
    const safe = { ...track, artworkURL: 'https://i1.sndcdn.com/artworks-fixture-t500x500.jpg' };
    const result = parseSoundCloudTracks([
      { ...safe, streamURL: 'https://private.test/secret', http_headers: { Authorization: 'private' } },
      safe, { ...track, id: '456', artworkURL: 'https://i1.sndcdn.com/private.jpg?token=secret' },
      { ...track, id: '789?secret=1' }, { ...track, id: '222', title: 'https://private.test/secret' },
    ]);
    expect(result.tracks).toEqual([safe, { ...track, id: '456', artworkURL: undefined }]);
    expect(result.albums).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/private|secret|streamURL|Authorization/);
    expect(() => parseSoundCloudTracks(Array(21).fill(track))).toThrow();
  });
  it('delivers incremental results, honors cancellation and does not invent catalogues', async () => {
    const abort = new AbortController();
    const partial = vi.fn();
    const request = vi.fn(async (_query: string, signal?: AbortSignal, onRows?: (rows: unknown[]) => void) => {
      expect(signal).toBe(abort.signal);
      onRows?.([track]);
      return [track, { ...track, id: '456' }];
    });
    const provider = soundcloudMusicProvider(request);
    const result = await provider.search(' fixture ', abort.signal, partial);
    expect(partial).toHaveBeenCalledWith(parseSoundCloudTracks([track]));
    expect(result.tracks).toHaveLength(2);
    expect(request).toHaveBeenCalledTimes(1);
    expect(await provider.catalogs()).toEqual([]);
    abort.abort();
    await expect(provider.search('fixture', abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
