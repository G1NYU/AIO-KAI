import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readPlayerStage, savePlayerStage } from '../src/lib/music/player-layout';

const values = new Map<string, string>();
beforeEach(() => {
  values.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  });
});
afterEach(() => vi.unstubAllGlobals());

const file = {
  schemaVersion: 4, formFactor: 'desktop', name: 'My joined player',
  background: { type: 'solidColor', color: {hue: 0.5,saturation: 0.2,brightness: 0.1,alpha: 1} },
  layers: [{ id: 'song', kind: 'songTitle', visible: true,
    transform: { x: 0.5, y: 0.5, width: 0.45, height: 0.1 } }],
};

describe('Tsugi Studio player persistence', () => {
  it('restores a previously imported Studio player and its selection', () => {
    savePlayerStage('imported', file);
    const restored = readPlayerStage();
    expect(restored.id).toBe('imported');
    expect(restored.template?.name).toBe('My joined player');
    expect(restored.template?.layers[0].kind).toBe('songTitle');
  });
  it('keeps imported layouts when selecting a built-in stage', () => {
    savePlayerStage('imported', file);
    savePlayerStage('junction', file);
    expect(readPlayerStage().id).toBe('junction');
    expect(readPlayerStage().template?.name).toBe('My joined player');
  });
  it('rejects invalid saved imports without crashing', () => {
    savePlayerStage('imported', { ...file, layers: [{kind:'script',visible:true}] });
    expect(readPlayerStage().id).toBe('default');
    expect(readPlayerStage().template).toBeNull();
  });
  it('handles blocked local storage', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw Error('blocked'); },
      setItem: () => { throw Error('blocked'); },
    });
    expect(() => savePlayerStage('junction', file)).not.toThrow();
    expect(readPlayerStage().id).toBe('default');
  });
});
