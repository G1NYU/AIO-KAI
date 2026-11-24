import { readPlayerStage, type PlayerStageState } from './player-layout';
import type { EclipsePlayerTemplate, PlayerLayer } from './player-template';

/** A player export remains declarative; only validated color tokens enter global CSS. */
export type EclipseAppearance = {
  canvas: string; surface: string; panel: string;
  foreground: string; accent: string; muted: string;
};

type RGBA = { r: number; g: number; b: number; a: number };

function rgba(source: string): RGBA | null {
  const match = /^rgba\((\d{1,3}),(\d{1,3}),(\d{1,3}),(0(?:\.\d+)?|1(?:\.0+)?)\)$/.exec(source);
  if (!match) return null;
  const [r, g, b, a] = match.slice(1).map(Number);
  return [r, g, b].every(v => v >= 0 && v <= 255) && a >= 0 && a <= 1
    ? { r, g, b, a } : null;
}

function luminance(c: RGBA): number {
  const component = (v: number) => {
    const n = v / 255;
    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  };
  return component(c.r) * 0.2126 + component(c.g) * 0.7152 + component(c.b) * 0.0722;
}

function contrast(a: RGBA, b: RGBA): number {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function blend(color: RGBA, base: RGBA): RGBA {
  return {
    r: Math.round(color.r * color.a + base.r * (1 - color.a)),
    g: Math.round(color.g * color.a + base.g * (1 - color.a)),
    b: Math.round(color.b * color.a + base.b * (1 - color.a)),
    a: 1,
  };
}

function rgbCss({ r, g, b }: RGBA): string {
  return `rgb(${r} ${g} ${b})`;
}

export function deriveEclipseAppearance(template: EclipsePlayerTemplate): EclipseAppearance {
  const imported = rgba(template.background);
  // Studio supports alpha. Composite against the existing dark surface for opaque windows.
  const canvas = blend(imported ?? { r: 17, g: 17, b: 27, a: 1 },
    { r: 17, g: 17, b: 27, a: 1 });
  const black = { r: 20, g: 20, b: 26, a: 1 };
  const white = { r: 244, g: 244, b: 250, a: 1 };
  const foreground = contrast(black, canvas) >= contrast(white, canvas) ? black : white;
  const muted = blend({ ...foreground, a: 0.65 }, canvas);
  const preferred = ['progressBar', 'playPause', 'songTitle'];
  let accent: PlayerLayer | undefined;
  for (const kind of preferred) {
    accent = template.layers.find(layer => layer.kind === kind && layer.hasTint && rgba(layer.color));
    if (accent) break;
  }
  accent ??= template.layers.find(layer => layer.hasTint && rgba(layer.color));
  const candidate = accent ? rgba(accent.color) : null;
  const candidateSolid = candidate ? blend(candidate, canvas) : null;
  const finalAccent = candidateSolid && contrast(candidateSolid, canvas) >= 3
    ? candidateSolid : foreground;
  return {
    canvas: rgbCss(canvas),
    surface: rgbCss(blend({ ...foreground, a: 0.045 }, canvas)),
    panel: rgbCss(blend({ ...foreground, a: 0.09 }, canvas)),
    foreground: rgbCss(foreground),
    accent: rgbCss(finalAccent),
    muted: rgbCss(muted),
  };
}

export function applyEclipseAppearance(
  state: PlayerStageState = readPlayerStage(),
  root: HTMLElement = document.documentElement,
): void {
  if (state.id !== 'imported' || !state.template) {
    delete root.dataset.tsugiEclipse;
    for (const property of [
      '--tsugi-canvas', '--tsugi-surface', '--tsugi-panel',
      '--tsugi-ink', '--tsugi-muted', '--tsugi-accent',
    ]) {
      root.style.removeProperty(property);
    }
    return;
  }
  const appearance = deriveEclipseAppearance(state.template);
  root.dataset.tsugiEclipse = 'on';
  root.style.setProperty('--tsugi-canvas', appearance.canvas);
  root.style.setProperty('--tsugi-surface', appearance.surface);
  root.style.setProperty('--tsugi-panel', appearance.panel);
  root.style.setProperty('--tsugi-ink', appearance.foreground);
  root.style.setProperty('--tsugi-muted', appearance.muted);
  root.style.setProperty('--tsugi-accent', appearance.accent);
  // The entire desktop shell shares the palette; stage geometry remains independent.
}

export function notifyEclipseAppearance(): void {
  window.dispatchEvent(new Event('tsugi-eclipse-appearance-change'));
}
