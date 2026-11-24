import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTrackLyrics, lyricAt, parseSyncedLyrics } from '../src/lib/music/lyrics';

afterEach(() => vi.unstubAllGlobals());

describe('LRCLIB lyrics opt-in', () => {
  it('parses timestamps and highlights the current line', () => {
    const lines = parseSyncedLyrics('[00:02.30] First line\n[00:04.20] Second\n[ar:Artist]\n');
    expect(lines).toEqual([{at:2.3,text:'First line'},{at:4.2,text:'Second'}]);
    expect(lyricAt(lines, 1)).toBe(-1);
    expect(lyricAt(lines, 3)).toBe(0);
    expect(lyricAt(lines, 5)).toBe(1);
  });

  it('requests only public song metadata and accepts strict song matches', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, opts: RequestInit) => {
      calls.push(url);
      expect(opts.credentials).toBe('omit');
      return new Response(JSON.stringify([
        {trackName:'Wrong Song',artistName:'Artist',syncedLyrics:'[00:01.00] wrong'},
        {trackName:'Track',artistName:'Artist',duration:180,syncedLyrics:'[00:01.00] Right'},
      ]));
    }));
    const result = await fetchTrackLyrics({id:'secret-track-id',title:'Track',artist:'Artist',duration:180});
    expect(result?.synced[0].text).toBe('Right');
    expect(calls[0]).toContain('lrclib.net/api/search');
    expect(calls[0]).not.toContain('secret-track-id');
  });

  it('rejects mismatched lyrics rather than displaying another recording', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      {trackName:'Track',artistName:'Artist',duration:190,plainLyrics:'Not our version'},
    ]))));
    expect(await fetchTrackLyrics({id:'a',title:'Track',artist:'Artist',duration:180})).toBeNull();
  });
});
