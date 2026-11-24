import { afterEach, describe, expect, it, vi } from 'vitest';
import { readMusicSources, remembersMusicSources, saveMusicSources, youtubeMusicConnection } from '../src/lib/music/connections';

import { youtubeMusicProvider } from '../src/lib/music/youtube-music';

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
