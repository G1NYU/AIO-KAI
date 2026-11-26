import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTrackLyrics, lyricAt, lyricSeekTime, lyricRecordingKey, LyricTimingStore, parseSyncedLyrics, selectTrackLyrics, isVideoRecording, stableMediaDuration } from '../src/lib/music/lyrics';
import { parseYouTubeMusicResults, parseYouTubeMusicHome } from '../src/lib/music/youtube-music';
import { catalogTrack } from '../src/lib/music/eclipse';
import { savedTrack } from '../src/lib/music/library';
import { makeRecentPlay } from '../src/lib/music/history';
import { YOUTUBE_MUSIC_ID } from '../src/lib/music/connections';

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
        {id:1,trackName:'Track',artistName:'Artist',albumName:'Album',duration:180,syncedLyrics:'[00:01.00] Right'},
      ]));
    }));
    const result = await fetchTrackLyrics({id:'secret-track-id',title:'Track',artist:'Artist',duration:120}, undefined, 180, 'private-source-id');
    expect(result?.synced[0].text).toBe('Right');
    expect(result?.timingReason).toBeNull();
    expect(calls[0]).toContain('lrclib.net/api/search');
    expect(calls[0]).not.toContain('secret-track-id');
    expect(calls[0]).not.toContain('private-source-id');
  });

  it('does not present mismatched recording timestamps as synchronized', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      {trackName:'Track',artistName:'Artist',duration:190,plainLyrics:'Not our version'},
    ]))));
    const result = await fetchTrackLyrics({id:'a',title:'Track',artist:'Artist',duration:180}, undefined, 180);
    expect(result?.timingReason).not.toBeNull();
    expect(result?.synced).toEqual([]);
  });
});

describe('Recording-aware lyric timing', () => {
  const track = { id:'original-song', title:'Original song', artist:'Original artist', album:'Original album', duration:180 };
  const record = (patch: Record<string, unknown> = {}) => ({ id:1,trackName:track.title,artistName:track.artist,
    albumName:track.album,duration:180,syncedLyrics:'[00:10.00]Original opening\n[00:20.00]Original second line',...patch });

  it('ranks actual decoded duration ahead of catalog duration and response order', () => {
    const lyrics = selectTrackLyrics([record(), record({id:2,duration:210,syncedLyrics:'[00:12.00]Longer original edit'})], track, 210);
    expect(lyrics?.recording.id).toBe(2);
    expect(lyrics?.timingReason).toBeNull();
    expect(lyrics?.synced[0].at).toBe(12);
  });
  it('never substitutes a catalog estimate while decoder duration is unknown', () => {
    expect(selectTrackLyrics([record()],track,0)?.timingReason).toBe('unconfirmed');
    expect(selectTrackLyrics([record()],track)?.timingReason).toBe('unconfirmed');
    expect(stableMediaDuration(0,0)).toBe(0);
    expect(stableMediaDuration(0,Number.NaN)).toBe(0);
    expect(stableMediaDuration(0,180.013)).toBe(180.013);
  });
  it('ignores tiny decoder jitter without rounding recording matching or hiding material changes', () => {
    const known=stableMediaDuration(0,182.013);
    expect(stableMediaDuration(known,182.016)).toBe(known);
    expect(stableMediaDuration(known,0)).toBe(known);
    expect(stableMediaDuration(known,184)).toBe(184);
    expect(selectTrackLyrics([record()],track,known)?.timingReason).toBe('duration');
  });
  it('uses the declared album to distinguish equal-length recordings', () => {
    const lyrics = selectTrackLyrics([record({id:2,albumName:'Other release',syncedLyrics:'[00:08.00]Other edit'}),record()],track,180);
    expect(lyrics?.recording.id).toBe(1);
    expect(lyrics?.timingReason).toBeNull();
    expect(selectTrackLyrics([record({albumName:'Other release'})],track,180)?.timingReason).toBe('album');
  });
  it('requires duration within two seconds and never guesses an offset from total length', () => {
    expect(selectTrackLyrics([record()],track,182)?.timingReason).toBeNull();
    const mismatch = selectTrackLyrics([record()],track,187);
    expect(mismatch?.timingReason).toBe('duration');
    expect(mismatch?.synced[0].at).toBe(10);
    expect(selectTrackLyrics([record()],track,0)?.timingReason).toBe('unconfirmed');
    expect(selectTrackLyrics([record({duration:undefined})],track,180)?.timingReason).toBe('unconfirmed');
  });
  it('does not treat copied video-length metadata as proof of synchronized video lyrics', () => {
    const video = { ...track, recordingType:'video' as const, duration:188 };
    const lyrics = selectTrackLyrics([record(), record({id:2,duration:188})],video,188);
    expect(lyrics?.recording.id).toBe(2);
    expect(lyrics?.timingReason).toBe('video');
    expect(lyrics?.plain).toEqual(['Original opening','Original second line']);
  });
  it('keeps restored YouTube records without a song/video identity unconfirmed', () => {
    const restored={...track,id:'abcdefghijk'};
    expect(selectTrackLyrics([record()],restored,180,YOUTUBE_MUSIC_ID)?.timingReason).toBe('unconfirmed');
    expect(selectTrackLyrics([record()],{...restored,recordingType:'song'},180,YOUTUBE_MUSIC_ID)?.timingReason).toBeNull();
    expect(selectTrackLyrics([record()],restored,180,'independent-source')?.timingReason).toBeNull();
  });
  it('marks conflicting near-duration timelines as ambiguous, but identical releases agree', () => {
    const withoutAlbum = {...track,album:undefined};
    expect(selectTrackLyrics([record(),record({id:2,albumName:'Compilation'})],withoutAlbum,180)?.timingReason).toBeNull();
    expect(selectTrackLyrics([record(),record({id:2,syncedLyrics:'[00:14.00]Different original timing'})],withoutAlbum,180)?.timingReason).toBe('ambiguous');
  });
  it('keeps unknown identity, unsupported embedded offsets and impossible timelines unconfirmed', () => {
    expect(selectTrackLyrics([record({id:undefined})],track,180)?.timingReason).toBe('unconfirmed');
    expect(selectTrackLyrics([record({syncedLyrics:'[offset:500]\n[00:10.00]Original line'})],track,180)?.timingReason).toBe('unconfirmed');
    expect(selectTrackLyrics([record({syncedLyrics:'[03:10.00]Beyond this recording'})],track,180)?.timingReason).toBe('unconfirmed');
    expect(parseSyncedLyrics('[00:75.00]Invalid seconds\n[01:15.00]Original valid line')).toEqual([{at:75,text:'Original valid line'}]);
  });
  it('requires exact title and artist identity even for matching durations', () => {
    expect(selectTrackLyrics([record({trackName:'Original song (live)'})],track)).toBeNull();
    expect(selectTrackLyrics([record({artistName:'Another artist'})],track)).toBeNull();
    expect(selectTrackLyrics([record({instrumental:true})],track)).toBeNull();
  });
  it('uses one offset for highlighting, displayed timestamps and line seek', () => {
    const lines = parseSyncedLyrics(record().syncedLyrics);
    expect(lyricAt(lines,12,3)).toBe(-1);
    expect(lyricAt(lines,13,3)).toBe(0);
    expect(lyricSeekTime(lines[0],3,180)).toBe(13);
    expect(lyricAt(lines,7,-3)).toBe(0);
    expect(lyricSeekTime(lines[0],-3,180)).toBe(7);
    expect(lyricSeekTime(lines[0],-20,180)).toBe(0);
    expect(lyricSeekTime(lines[1],3,21)).toBe(21);
    expect(lyricAt(lines,Number.NaN,0)).toBe(-1);
  });
  it('isolates and resets bounded session corrections by source, track, duration and lyric identity', () => {
    const lyrics = selectTrackLyrics([record()],track)!;
    const store = new LyricTimingStore(2), key = lyricRecordingKey('source-a',track,180,lyrics);
    store.set(key,3);
    expect(store.get(key)).toBe(3);
    for(const other of [lyricRecordingKey('source-b',track,180,lyrics),lyricRecordingKey('source-a',{...track,id:'different'},180,lyrics),
      lyricRecordingKey('source-a',track,181,lyrics),lyricRecordingKey('source-a',track,180,{...lyrics,identity:'changed lyrics'})]) expect(store.get(other)).toBeUndefined();
    store.reset(key);expect(store.get(key)).toBeUndefined();
    store.set(key,0);expect(store.get(key)).toBe(0);
    store.set('bad',Number.NaN);store.set('bad',121);expect(store.get('bad')).toBeUndefined();
    store.set('second',1);store.set('third',2);expect(store.get(key)).toBeUndefined();
  });
  it('retains YouTube video identity through shelves, saved tracks and recent playback', () => {
    const row = { musicResponsiveListItemRenderer: { playlistItemData:{videoId:'abcdefghijk'},
      flexColumns:[{musicResponsiveListItemFlexColumnRenderer:{text:{runs:[{text:track.title}]}}},
        {musicResponsiveListItemFlexColumnRenderer:{text:{runs:[{text:'Video'},{text:' · '},{text:track.artist},{text:' · '},{text:'3:08'}]}}}],
    } };
    const video = parseYouTubeMusicResults([row]).tracks[0];
    expect(video.recordingType).toBe('video');expect(video.duration).toBe(188);
    expect(savedTrack(video).recordingType).toBe('video');
    expect(makeRecentPlay('source',video).track.recordingType).toBe('video');
    const home = parseYouTubeMusicHome({musicCarouselShelfRenderer:{title:{runs:[{text:'Original shelf'}]},contents:[row]}});
    expect(catalogTrack(home[0].items[0]).recordingType).toBe('video');
    expect(isVideoRecording({...track,id:'abcdefghijk',artworkURL:'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg?sqp=synthetic&rs=synthetic'})).toBe(true);
    expect(isVideoRecording({...track,id:'abcdefghijk',artworkURL:'https://i.ytimg.com.example.test/vi/abcdefghijk/hqdefault.jpg'})).toBe(false);
  });
});
