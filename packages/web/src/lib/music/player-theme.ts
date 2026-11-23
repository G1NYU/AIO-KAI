import { storage } from '../storage';

export type PlayerThemeId = 'aio-dark' | 'nightfall' | 'carbon';

export type PlayerPalette = {
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
    surface: '#12121B', canvas: '#0B0B11', panel: '#1C1B27',
    border: '#343142', accent: '#BDD5F1', accentText: '#12131B', muted: '#A8A3BC',
  },
  nightfall: {
    surface: '#171420', canvas: '#0d0b12', panel: '#211c2b',
    border: '#342d40', accent: '#d8cff4', accentText: '#1b1624', muted: '#b2a9bf',
  },
  carbon: {
    surface: '#13171b', canvas: '#090d10', panel: '#1a2127',
    border: '#303941', accent: '#b9d1e4', accentText: '#101820', muted: '#a8b7c3',
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
