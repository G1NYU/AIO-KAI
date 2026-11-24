import { describe, expect, it } from 'vitest';
import { applyEclipseAppearance, deriveEclipseAppearance } from '../src/lib/music/eclipse-appearance';
import { parsePlayerTemplate } from '../src/lib/music/player-template';

const layout = parsePlayerTemplate({
  schemaVersion: 4, formFactor: 'desktop',
  background: { type:'solidColor', color:{hue:.72,saturation:.44,brightness:.24,alpha:1} },
  layers: [{
    id:'seek',kind:'progressBar',visible:true,
    transform:{x:.5,y:.7,width:.8,height:.02},
    appearance:{tint:{hue:.72,saturation:.4,brightness:.9,alpha:1}},
  }],
});

describe('full-window Eclipse appearance', () => {
  it('derives application surfaces and readable foreground', () => {
    const appearance = deriveEclipseAppearance(layout);
    expect(appearance.canvas).toMatch(/^rgb\(/);
    expect(appearance.accent).toMatch(/^rgb\(/);
    expect(appearance.foreground).not.toBe(appearance.canvas);
  });
  it('writes and clears the entire root palette', () => {
    const attributes: Record<string,string> = {};
    const root = {
      dataset: {} as Record<string,string>,
      style: {
        setProperty: (key:string,value:string) => { attributes[key]=value; },
        removeProperty: (key:string) => { delete attributes[key]; },
      },
    } as unknown as HTMLElement;
    applyEclipseAppearance({ id:'imported', imported:null, template:layout },root);
    expect(root.dataset.tsugiEclipse).toBe('on');
    expect(attributes['--tsugi-canvas']).toBeTruthy();
    expect(attributes['--tsugi-panel']).toBeTruthy();
    expect(attributes['--background']).toBe(attributes['--tsugi-canvas']);
    expect(attributes['--foreground']).toBe(attributes['--tsugi-ink']);
    expect(attributes['--brand']).toBe(attributes['--tsugi-accent']);
    applyEclipseAppearance({ id:'junction', imported:null, template:layout },root);
    expect(root.dataset.tsugiEclipse).toBeUndefined();
    expect(attributes['--tsugi-canvas']).toBeUndefined();
    expect(attributes['--background']).toBeUndefined();
    expect(attributes['--brand']).toBeUndefined();
  });
});
