import { storage } from '../storage';

export type PlayerThemeId = 'mocha' | 'matte' | 'aio-dark' | 'nightfall' | 'carbon';

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
    panel: '#181E22', border: '#343D42', accent: '#BDD8E5',
    accentText: '#0E1518', muted: '#9BAFB8',
  },
  nightfall: {
    foreground: '#EBE8F0', surface: '#14121A', canvas: '#0C0B10',
    panel: '#1C1923', border: '#3A3542', accent: '#C4B9D7',
    accentText: '#16121C', muted: '#AEA5BE',
  },
  carbon: {
    foreground: '#E0E6E8', surface: '#121516', canvas: '#0B0E0F',
    panel: '#1B2022', border: '#3A4447', accent: '#B3C9C9',
    accentText: '#0E1516', muted: '#9FADAF',
  },
};

/** Keep the existing key: migrating it would reset current users' choices. */
const KEY = 'aiokai-desktop-player-theme-v1';
export const DEFAULT_PLAYER_THEME: PlayerThemeId = 'mocha';

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
