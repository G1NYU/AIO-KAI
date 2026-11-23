/**
 * A strictly declarative, non-executable subset of Eclipse Player Studio v4.
 * External URLs, CSS expressions, arbitrary actions and scripts are discarded.
 */
export type PlayerLayerKind =
  | 'artwork' | 'songTitle' | 'artistName' | 'progressBar' | 'elapsed'
  | 'remaining' | 'playPause' | 'previous' | 'next' | 'qualityBadge'
  | 'upNext' | 'close' | 'albumName' | 'text' | 'line'
  | 'shuffle' | 'repeat' | 'queue' | 'threeDotMenu' | 'volumeKnob'
  | 'lyrics' | 'lyricsInline' | 'favorite' | 'releaseInfo';

export type PlayerLayer = {
  id: string;
  kind: PlayerLayerKind;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  color: string;
  fontSize: number;
  align: 'left' | 'center' | 'right';
  /** Static text from the Eclipse Studio export. Render as React text only. */
  content: string;
  weight: 'normal' | 'medium' | 'semibold' | 'bold';
};

export type EclipsePlayerTemplate = {
  name: string;
  background: string;
  layers: PlayerLayer[];
  skippedLayers: number;
};

type Entry = Record<string, unknown>;

function entry(value: unknown): value is Entry {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value : undefined;
}

function hsbColor(value: unknown, fallback: string): string {
  if (!entry(value)) return fallback;
  const h = finite(value.hue, 0, 1);
  const s = finite(value.saturation, 0, 1);
  const v = finite(value.brightness, 0, 1);
  const a = finite(value.alpha, 0, 1);
  if (h === undefined || s === undefined || v === undefined) return fallback;
  const c = v * s;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m = v - c;
  const section = Math.floor(h * 6) % 6;
  const shades = [
    [c, x, 0], [x, c, 0], [0, c, x],
    [0, x, c], [x, 0, c], [c, 0, x],
  ][section];
  const rgb = shades.map((value) => Math.round((value + m) * 255));
  return 'rgba(' + rgb.join(',') + ',' + (a ?? 1) + ')';
}

const supported = new Set<PlayerLayerKind>([
  'artwork', 'songTitle', 'artistName', 'progressBar', 'elapsed', 'remaining',
  'playPause', 'previous', 'next', 'qualityBadge', 'upNext', 'close',
  'albumName', 'text', 'line', 'shuffle', 'repeat', 'queue',
  'threeDotMenu', 'volumeKnob', 'lyrics', 'lyricsInline', 'favorite', 'releaseInfo',
]);

export function parsePlayerTemplate(input: unknown): EclipsePlayerTemplate {
  if (!entry(input) || input.schemaVersion !== 4 || input.formFactor !== 'desktop' ||
      !Array.isArray(input.layers) || input.layers.length > 100) {
    throw new Error('Only Eclipse Studio v4 desktop player layouts are supported.');
  }
  const name = typeof input.name === 'string' && input.name.trim()
    ? input.name.trim().slice(0, 90) : '';
  const bg = entry(input.background) ? input.background : {};
  const background = hsbColor(bg.color, '#100e17');
  const layers: PlayerLayer[] = [];
  let skippedLayers = 0;
  for (const raw of input.layers) {
    if (!entry(raw) || raw.visible === false || !supported.has(raw.kind as PlayerLayerKind)) {
      skippedLayers++;
      continue;
    }
    const transform = raw.transform;
    if (!entry(transform)) { skippedLayers++; continue; }
    const x = finite(transform.x, 0, 1);
    const y = finite(transform.y, 0, 1);
    const width = finite(transform.width, 0.005, 1);
    const height = finite(transform.height, 0.005, 1);
    if (x === undefined || y === undefined || width === undefined || height === undefined) {
      skippedLayers++; continue;
    }
    const appearance = entry(raw.appearance) ? raw.appearance : {};
    const text = entry(raw.text) ? raw.text : {};
    layers.push({
      id: typeof raw.id === 'string' ? raw.id.slice(0, 100) : 'layer-' + layers.length,
      kind: raw.kind as PlayerLayerKind,
      x, y, width, height,
      opacity: finite(appearance.opacity, 0, 1) ?? 1,
      color: hsbColor(appearance.tint, '#ffffff'),
      fontSize: finite(text.fontSize, 8, 120) ?? 26,
      align: text.alignment === 'center' ? 'center' : text.alignment === 'trailing' ? 'right' : 'left',
      content: typeof text.content === 'string' ? text.content.slice(0, 180) : '',
      weight: text.weight === 'bold' ? 'bold' : text.weight === 'semibold'
        ? 'semibold' : text.weight === 'medium' ? 'medium' : 'normal',
    });
  }
  if (!layers.length) throw new Error('This player layout has no supported visible layers.');
  return { name, background, layers, skippedLayers };
}
