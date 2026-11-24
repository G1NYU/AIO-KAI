import { describe, expect, it } from 'vitest';
import { parsePlayerTemplate } from '../src/lib/music/player-template';

describe('Eclipse Studio v4 player layout import', () => {
  const fixture = {
    schemaVersion: 4, formFactor: 'desktop', name: 'Test Monolith',
    background: { type: 'solidColor', color: {
      hue: 0.65, saturation: 0.2, brightness: 0.1, alpha: 1,
    } },
    layers: [
      { id: 'title', kind: 'songTitle', visible: true,
        transform: { x: 0.7, y: 0.2, width: 0.4, height: 0.06 },
        appearance: { opacity: 1 }, text: { fontSize: 56, alignment: 'leading' } },
      { id: 'art', kind: 'artwork', visible: true,
        transform: { x: 0.25, y: 0.5, width: 0.4, height: 0.6 } },
      { id: 'lyrics', kind: 'lyricsInline', visible: true,
        transform: { x: 0.8, y: 0.4, width: 0.3, height: 0.2 } },
    ],
  };

  it('accepts known layout and keeps only supported layers', () => {
    const parsed = parsePlayerTemplate(fixture);
    expect(parsed.name).toBe('Test Monolith');
    expect(parsed.layers.map((layer) => layer.kind)).toEqual(['songTitle', 'artwork', 'lyricsInline']);
    expect(parsed.layers[0].fontSize).toBe(56);
    expect(parsed.skippedLayers).toBe(0);
    expect(parsed.background.startsWith('rgba(')).toBe(true);
    expect(parsed.layers[0].hasTint).toBe(false);
  });

  it('retains explicit Studio tints for fullscreen playback', () => {
    const tinted = parsePlayerTemplate({ ...fixture, layers: [{
      ...fixture.layers[0], appearance: {
        opacity: 1, tint: { hue: 0.5, saturation: 0.8, brightness: 0.9, alpha: 0.7 },
      },
    }] });
    expect(tinted.layers[0].hasTint).toBe(true);
    expect(tinted.layers[0].color).toMatch(/^rgba\\(/);
    expect(tinted.background.startsWith('rgba(')).toBe(true);
  });

  it('rejects executable or unsupported formats', () => {
    expect(() => parsePlayerTemplate({ schemaVersion: 3, formFactor: 'desktop', layers: [] }))
      .toThrow('Studio v4');
    expect(() => parsePlayerTemplate({ ...fixture, formFactor: 'phone' })).toThrow();
    expect(() => parsePlayerTemplate({ ...fixture, layers: [{ kind: 'iframe', visible: true,
      transform: {x: 0.5,y: 0.5,width: 0.5,height: 0.5} }] })).toThrow('no supported');
  });

  it('filters invalid positions and dimensions', () => {
    const parsed = parsePlayerTemplate({ ...fixture, layers: [
      fixture.layers[0],
      { ...fixture.layers[1], transform: { x: 999, y: 0.5, width: 1, height: 1 } },
    ] });
    expect(parsed.layers).toHaveLength(1);
  });

  it('accepts richer Eclipse Studio controls but skips unknown cast transports', () => {
    const kinds = ['albumName', 'shuffle', 'repeat', 'queue', 'volumeKnob',
      'favorite', 'releaseInfo', 'lyrics', 'text', 'line', 'connect', 'outputDevice'];
    const parsed = parsePlayerTemplate({ ...fixture, layers: kinds.map((kind, i) => ({
      kind, id: 'advanced-' + i, visible: true,
      transform: { x: 0.1, y: 0.1, width: 0.15, height: 0.05 },
      text: kind === 'text' ? { content: '<script>not executable</script>', weight: 'bold' } : {},
    })) });
    expect(parsed.layers).toHaveLength(10);
    expect(parsed.skippedLayers).toBe(2);
    expect(parsed.layers.find((layer) => layer.kind === 'text')?.content)
      .toBe('<script>not executable</script>');
    expect(parsed.layers.find((layer) => layer.kind === 'text')?.weight).toBe('bold');
  });
});
