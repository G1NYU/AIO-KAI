import { storage } from '../storage';

export type PlayerThemeId = 'mocha' | 'matte' | 'aio-dark' | 'nightfall' | 'carbon' | 'sumi';

export type PlayerPalette = {
  foreground: string;
  surface: string;
  canvas: string;
  panel: string;
  border: string;
  accent: string;
  accentText: string;
  muted: string;
};

/** Mocha uses official Catppuccin tokens; Matte deliberately uses neutral blacks. */
export const PLAYER_PALETTES: Record<PlayerThemeId, PlayerPalette> = {
  sumi: {
    foreground: '#E8E6DF', surface: '#171A1D', canvas: '#101214',
    panel: '#202428', border: '#363C41', accent: '#D5D5DC',
    accentText: '#101214', muted: '#A3ABB0',
  },
  mocha: {
    foreground: '#CDD6F4', surface: '#181825', canvas: '#11111B',
    panel: '#1E1E2E', border: '#313244', accent: '#B4BEFE',
    accentText: '#11111B', muted: '#A6ADC8',
  },
  matte: {
    foreground: '#E8E8EB', surface: '#101114', canvas: '#08090B',
    panel: '#17181D', border: '#303136', accent: '#D5D5DC',
    accentText: '#101114', muted: '#A4A5B0',
  },
  'aio-dark': {
    foreground: '#E8EDF0', surface: '#101418', canvas: '#090D10',
    panel: '#181E22', border: '#343D42', accent: '#D5D5DC',
    accentText: '#0E1518', muted: '#9BAFB8',
  },
  nightfall: {
    foreground: '#EBE8F0', surface: '#14121A', canvas: '#0C0B10',
    panel: '#1C1923', border: '#3A3542', accent: '#C4B9D7',
    accentText: '#16121C', muted: '#AEA5BE',
  },
  carbon: {
    foreground: '#E0E6E8', surface: '#121516', canvas: '#0B0E0F',
    panel: '#1B2022', border: '#3A4447', accent: '#D5D5DC',
    accentText: '#0E1516', muted: '#9FADAF',
  },
};

/** Keep the existing key: migrating it would reset current users' choices. */
const KEY = 'aiokai-desktop-player-theme-v1';
export const DEFAULT_PLAYER_THEME: PlayerThemeId = 'sumi';

export function isPlayerTheme(value: unknown): value is PlayerThemeId {
  return typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(PLAYER_PALETTES, value);
}

export function readPlayerTheme(): PlayerThemeId {
  try {
    const value = storage.get<unknown>(KEY);
    return isPlayerTheme(value) ? value : DEFAULT_PLAYER_THEME;
  } catch {
    return DEFAULT_PLAYER_THEME;
  }
}

export function savePlayerTheme(theme: PlayerThemeId): void {
  if (!isPlayerTheme(theme)) return;
  try { storage.set(KEY, theme); storage.set('tsugi-global-import-colors-v1', false); } catch { /* Device storage may be blocked. */ }
}

/** Accent and canvas are independent saved preferences. Presets are deliberately
 *  constrained to accessible colors instead of accepting arbitrary CSS. */
export const PLAYER_ACCENTS = {
  silver: '#D5D5DC',
  blue: '#9AB8FF',
  lavender: '#B4BEFE',
  amber: '#E4BA87',
  rose: '#E9A0A8',
} as const;
export type PlayerAccentId = keyof typeof PLAYER_ACCENTS;
const ACCENT_KEY = 'tsugi-global-accent-v1';
export function isPlayerAccent(value: unknown): value is PlayerAccentId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PLAYER_ACCENTS, value);
}
export function readPlayerAccent(): PlayerAccentId {
  try {
    const value = storage.get<unknown>(ACCENT_KEY);
    return isPlayerAccent(value) ? value : 'silver';
  } catch { return 'silver'; }
}
export function savePlayerAccent(value: PlayerAccentId): void {
  if (isPlayerAccent(value)) storage.set(ACCENT_KEY, value);
}
function luminance(value: string): number | undefined {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  const rgb = /^rgb\(\s*(\d{1,3})[ ,]+(\d{1,3})[ ,]+(\d{1,3})\s*\)$/.exec(value);
  const channels = hex ? [0,2,4].map(i => parseInt(hex[1].slice(i,i+2),16)) : rgb ? rgb.slice(1).map(Number) : null;
  if (!channels || channels.some(n => n > 255)) return undefined;
  const linear = channels.map(v => { const n = v / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; });
  return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
}
export function withPlayerAccent(palette: PlayerPalette, id: PlayerAccentId): PlayerPalette {
  const canvas = luminance(palette.canvas) ?? 0;
  const candidate = PLAYER_ACCENTS[id];
  const light = luminance(candidate) ?? 1;
  const ratio = (Math.max(canvas, light) + .05) / (Math.min(canvas, light) + .05);
  // Imported light layouts must remain readable. Fall back to the derived
  // contrasting text rather than painting a pale control on a pale canvas.
  const accent = ratio >= 3 ? candidate : palette.foreground;
  const accentText = (luminance(accent) ?? 1) > .179 ? '#101214' : '#FFFFFF';
  return { ...palette, accent, accentText };
}
