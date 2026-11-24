import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readLaunchThemeMode, readWatchColors, rememberWatchColors, saveLaunchThemeMode } from '../src/lib/launcher-theme';

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

describe('Tsugi launcher palette', () => {
  it('uses the normalized Watch palette and preserves reset semantics', () => {
    expect(readLaunchThemeMode()).toBe('watch');
    rememberWatchColors({ background: '#112233', accent: '#6688aa' });
    expect(readWatchColors().background).toBe('#112233');
    expect(readWatchColors().accent).toMatch(/^#[0-9a-f]{6}$/i);
    rememberWatchColors({});
    expect(readWatchColors()).toEqual({ background: undefined, accent: undefined });
  });

  it('does not inject unvalidated saved styles', () => {
    saved.set('tsugi-launch-watch-colors-v1', JSON.stringify({
      background: 'url(https://example.test)', accent: '#123456; color: red',
    }));
    expect(readWatchColors()).toEqual({ background: undefined, accent: undefined });
  });

  it('persists an explicit independent player palette choice', () => {
    saveLaunchThemeMode('player');
    expect(readLaunchThemeMode()).toBe('player');
    saveLaunchThemeMode('watch');
    expect(readLaunchThemeMode()).toBe('watch');
  });
});
