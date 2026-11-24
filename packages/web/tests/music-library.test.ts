import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMusicPlaylist, addToMusicPlaylist, importMusicPlaylist,
  exportMusicPlaylist, saveMusicLibrary, readMusicLibrary, savedTrack,
  findLocalPlaylistMatch,
} from '../src/lib/music/library';

import {
  scanMusicFolder, type MusicFolderHandle, type MusicFileHandle,
} from '../src/lib/music/remembered-folder';

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
  it('does not convert a URL without EXTINF into stored metadata', () => {
    const list = importMusicPlaylist('remote.m3u',
      '#EXTM3U\nhttps://private.example/secret-token/song.mp3?code=abc\n');
    expect(list.tracks).toHaveLength(0);
    expect(JSON.stringify(list)).not.toContain('secret-token');
  });
  it('matches M3U metadata to an unambiguous opened local audio file', () => {
    const saved = importMusicPlaylist('mix.m3u',
      '#EXTM3U\n#EXTINF:250,Artist - Song\nSong.mp3\n').tracks[0];
    const file = { id:'local:1', title:'Artist - Song', artist:'Local file' };
    expect(findLocalPlaylistMatch(saved,[file])?.id).toBe('local:1');
    expect(findLocalPlaylistMatch(saved,[file,file])).toBeNull();
  });
  it('rejects invalid formats and overlarge imports', () => {
    expect(() => importMusicPlaylist('list.txt','invalid')).toThrow();
    expect(() => importMusicPlaylist('list.json','{}')).toThrow();
    expect(() => importMusicPlaylist('list.m3u','X'.repeat(1024*1024+1))).toThrow();
  });
});

describe('remembered music folders', () => {
  function file(name: string): MusicFileHandle {
    return { kind: 'file', name, getFile: vi.fn(async () => { throw new Error('scan must not read audio'); }) };
  }
  function directory(name: string, children: (MusicFileHandle | MusicFolderHandle)[]): MusicFolderHandle {
    return {
      kind: 'directory', name,
      async *values() { yield* children; },
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
    };
  }
  it('scans nested audio and ignores non-audio without opening file contents', async () => {
    const track = file('A.FLAC');
    const result = await scanMusicFolder(directory('Music', [file('ignore.txt'), directory('Album', [track]), file('B.mp3')]));
    expect(result.entries.map(entry => entry.path)).toEqual(['Album/A.FLAC', 'B.mp3']);
    expect(result.entries[0].id).toBe('folder:Album/A.FLAC');
    expect(track.getFile).not.toHaveBeenCalled();
    expect(result.truncated).toBe(false);
  });
  it('caps the number of indexed files', async () => {
    const result = await scanMusicFolder(directory('Music', [file('1.mp3'), file('2.mp3'), file('3.mp3')]), 2);
    expect(result.entries).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });
});
