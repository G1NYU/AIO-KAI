import { describe, expect, it, vi } from 'vitest';
import { youtubeSession } from '../src/lib/music/youtube-session';
import { shouldPrefetchNativeTrack, type YouTubeMusicRequest } from '../src/lib/music/youtube-music';

describe('explicit native YouTube session', () => {
  it('only checks state until an explicit native mode is requested', async () => {
    const request = vi.fn<YouTubeMusicRequest>(async (_operation, value) => ({ mode: value === 'firefox' ? 'firefox' : 'anonymous' }));
    const controller = new AbortController();
    await expect(youtubeSession(request, 'status', controller.signal)).resolves.toBe('anonymous');
    expect(request).toHaveBeenCalledExactlyOnceWith('session', 'status', controller.signal);
    await expect(youtubeSession(request, 'firefox')).resolves.toBe('firefox');
    await expect(youtubeSession(request, 'anonymous')).resolves.toBe('anonymous');
    expect(request.mock.calls.map(call => call[1])).toEqual(['status', 'firefox', 'anonymous']);
  });

  it('rejects unrecognized modes and malformed native replies', async () => {
    const request = vi.fn(async () => ({ mode: 'anonymous' }));
    await expect(youtubeSession(request, 'firefox:profile' as 'firefox')).rejects.toThrow('Invalid YouTube');
    expect(request).not.toHaveBeenCalled();
    for (const reply of [null, 'firefox', [], {}, { mode: 'chrome' }, { mode: 1 }]) {
      await expect(youtubeSession(async () => reply, 'status')).rejects.toThrow('unavailable');
    }
  });

  it('does not claim authentication or retain fields beyond the mode', async () => {
    const reply = { mode: 'firefox', cookie: 'SYNTHETIC_PRIVATE', profile: 'SYNTHETIC_PRIVATE', authenticated: true };
    expect(await youtubeSession(async () => reply, 'firefox')).toBe('firefox');
    const failure = new Error('Native request failed');
    await expect(youtubeSession(async () => { throw failure; }, 'firefox')).rejects.toBe(failure);
  });
});

describe('native YouTube prefetch timing', () => {
  it('waits until the final twenty seconds so startup retains bandwidth', () => {
    expect(shouldPrefetchNativeTrack(2, 180)).toBe(false);
    expect(shouldPrefetchNativeTrack(159.9, 180)).toBe(false);
    expect(shouldPrefetchNativeTrack(160, 180)).toBe(true);
    expect(shouldPrefetchNativeTrack(179, 180)).toBe(true);
    for (const [position, duration] of [[0, 10], [1, 10], [181, 180], [20, 0], [-1, 180], [NaN, 180], [20, Infinity]]) {
      expect(shouldPrefetchNativeTrack(position, duration)).toBe(false);
    }
  });
});
