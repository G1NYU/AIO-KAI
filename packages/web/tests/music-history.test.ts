import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  makeRecentPlay, mergeRecentPlays, readRecentPlays, storeRecentPlays,
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
