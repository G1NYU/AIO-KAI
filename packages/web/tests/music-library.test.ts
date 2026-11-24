import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMusicPlaylist, addToMusicPlaylist, importMusicPlaylist,
  exportMusicPlaylist, saveMusicLibrary, readMusicLibrary, savedTrack,
} from '../src/lib/music/library';

const data = new Map<string,string>();
beforeEach(() => {
  data.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key:string) => data.get(key) ?? null,
    setItem: (key:string, value:string) => { data.set(key, value); },
    removeItem: (key:string) => { data.delete(key); },
  });
  vi.stubGlobal('crypto', { randomUUID: () => '11111111-2222-4333-8444-555555555555' });
});

afterEach(() => vi.unstubAllGlobals());

describe('independent Tsugi playlists', () => {
  it('creates, saves and reloads collections without stream credentials', () => {
    const list = createMusicPlaylist('Evening');
    const song = savedTrack({
      id:'a',title:'Track',artist:'Artist',streamURL:'https://private.example/token',
    });
    const updated = addToMusicPlaylist(list,song);
    saveMusicLibrary([updated]);
    expect(readMusicLibrary()[0].tracks).toHaveLength(1);
    expect([...data.values()].join('')).not.toContain('private.example');
    expect(addToMusicPlaylist(updated,song).tracks).toHaveLength(1);
  });
  it('exports and imports Tsugi playlists without stream URLs', () => {
    const list = addToMusicPlaylist(createMusicPlaylist('Test'),
      savedTrack({id:'s',title:'Song',artist:'Singer'}));
    const imported = importMusicPlaylist('test.json',exportMusicPlaylist(list));
    expect(imported.name).toBe('Test');
    expect(imported.tracks[0].title).toBe('Song');
    expect(imported.tracks[0]).not.toHaveProperty('streamURL');
  });
  it('imports M3U metadata without storing paths or URLs', () => {
    const list = importMusicPlaylist('tracks.m3u',
      '#EXTM3U\n#EXTINF:210,Artist - Song\nhttps://secret.example/stream?access=abc\n');
    expect(list.tracks[0].title).toBe('Song');
    expect(JSON.stringify(list)).not.toContain('secret.example');
  });
  it('rejects invalid formats and overlarge imports', () => {
    expect(() => importMusicPlaylist('list.txt','invalid')).toThrow();
    expect(() => importMusicPlaylist('list.json','{}')).toThrow();
    expect(() => importMusicPlaylist('list.m3u','X'.repeat(1024*1024+1))).toThrow();
  });
});
