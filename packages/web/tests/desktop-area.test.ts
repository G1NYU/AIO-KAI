import { describe, expect, it } from 'vitest';
import { initialDesktopArea, allowsMusicPlayback } from '../src/lib/desktop-area';

describe('unified Tsugi launcher', () => {
  it('starts on the media index whether a video server is saved or not', () => {
    expect(initialDesktopArea(true, false, true)).toBe('welcome');
    expect(initialDesktopArea(true, true, true)).toBe('welcome');
  });
  it('preserves older desktop and browser behavior outside the unified package', () => {
    expect(initialDesktopArea(true, true)).toBe('video');
    expect(initialDesktopArea(true, false)).toBe('welcome');
    expect(initialDesktopArea(false, true, true)).toBe('video');
  });
});

describe('cross-media audio policy', () => {
  it('keeps music running while reading or in the launcher, but not during video', () => {
    expect(allowsMusicPlayback('music')).toBe(true);
    expect(allowsMusicPlayback('read')).toBe(true);
    expect(allowsMusicPlayback('welcome')).toBe(true);
    expect(allowsMusicPlayback('video')).toBe(false);
  });
});
