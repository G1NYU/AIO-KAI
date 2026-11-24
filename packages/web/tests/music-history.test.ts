import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  makeRecentPlay, mergeRecentPlays, readRecentPlays, storeRecentPlays, suggestMusicFromHistory,
} from '../src/lib/music/history';

const saved = new Map<string, string>();
beforeEach(() => {
  saved.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => { saved.set(key, value); },
    removeItem: (key: string) => { saved.delete(key); },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('Tsugi recent listening', () => {
  it('deduplicates source-scoped tracks and keeps newest first', () => {
    const first = makeRecentPlay('one', { id: 'song', title: 'One', artist: 'A' });
    const another = makeRecentPlay('two', { id: 'song', title: 'One', artist: 'A' });
    expect(mergeRecentPlays(mergeRecentPlays([first], another), first)).toEqual([first, another]);
  });
  it('never persists a resolved stream URL', () => {
    const item = makeRecentPlay('one', {
      id: 'song', title: 'One', artist: 'A', streamURL: 'https://secret.test/token',
    });
    saved.set('aiostreams-desktop-music-remember-v1', 'true');
    storeRecentPlays([item], true);
    expect(JSON.stringify([...saved.values()])).not.toContain('secret.test');
    expect(readRecentPlays()).toEqual([item]);
  });
  it('removes recorded history when source persistence is disabled', () => {
    saved.set('aiostreams-desktop-music-remember-v1', 'true');
    storeRecentPlays([makeRecentPlay('one', { id:'a', title:'A', artist:'B' })], true);
    storeRecentPlays([], false);
    expect(readRecentPlays()).toEqual([]);
  });
  it('ignores malformed saved entries', () => {
    saved.set('aiostreams-desktop-music-remember-v1', 'true');
    saved.set('tsugi-recent-music-v1', JSON.stringify([{ sourceId:'x', track: {title:123} }]));
    expect(readRecentPlays()).toEqual([]);
  });
});

describe('local catalogue suggestions', () => {
  it('ranks unheard tracks from the same source by known artist affinity', () => {
    const recent = [
      makeRecentPlay('yt', { id: 'heard', title: 'Heard', artist: 'Artist A' }),
      makeRecentPlay('yt', { id: 'heard2', title: 'Heard 2', artist: 'Artist B' }),
      makeRecentPlay('other', { id: 'foreign', title: 'Other', artist: 'Artist C' }),
    ];
    const items = [
      { id: 'b', title: 'B', artist: 'Artist B', type: 'track' as const },
      { id: 'heard', title: 'Heard', artist: 'Artist A', type: 'track' as const },
      { id: 'a', title: 'A', artist: ' artist a ', type: 'track' as const },
      { id: 'a', title: 'Duplicate', artist: 'Artist A', type: 'track' as const },
      { id: 'c', title: 'C', artist: 'Artist C', type: 'track' as const },
      { id: 'album', title: 'Album', artist: 'Artist A', type: 'album' as const },
    ];
    expect(suggestMusicFromHistory(items, recent, 'yt').map(item => item.id)).toEqual(['a', 'b']);
    expect(suggestMusicFromHistory(items, [], 'yt')).toEqual([]);
  });
});
