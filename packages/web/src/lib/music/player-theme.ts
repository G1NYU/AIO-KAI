import { storage } from '../storage';

export type PlayerThemeId = 'aio-dark' | 'nightfall' | 'carbon';

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

export const PLAYER_PALETTES: Record<PlayerThemeId, PlayerPalette> = {
  'aio-dark': {
    foreground: '#E8EDF0', surface: '#101418', canvas: '#090D10', panel: '#181E22',
    border: '#343D42', accent: '#BDD8E5', accentText: '#0E1518', muted: '#9BAFB8',
  },
  nightfall: {
    foreground: '#EBE8F0', surface: '#14121A', canvas: '#0C0B10', panel: '#1C1923',
    border: '#3A3542', accent: '#C4B9D7', accentText: '#16121C', muted: '#AEA5BE',
  },
  carbon: {
    foreground: '#E0E6E8', surface: '#121516', canvas: '#0B0E0F', panel: '#1B2022',
    border: '#3A4447', accent: '#B3C9C9', accentText: '#0E1516', muted: '#9FADAF',
  },
};

const KEY = 'aiokai-desktop-player-theme-v1';
export const DEFAULT_PLAYER_THEME: PlayerThemeId = 'aio-dark';

export function isPlayerTheme(value: unknown): value is PlayerThemeId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PLAYER_PALETTES, value);
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
  if (isPlayerTheme(theme)) {
    try { storage.set(KEY, theme); } catch { /* Storage can be disabled. */ }
  }
}
