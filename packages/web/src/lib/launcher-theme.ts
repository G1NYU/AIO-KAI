import { themeVariables } from '@aiostreams/ui/utils/palette';
import { storage } from './storage';

const WATCH_KEY = 'tsugi-launch-watch-colors-v1';
const MODE_KEY = 'tsugi-launch-theme-mode-v1';
type LaunchColors = { background?: string; accent?: string };
type LaunchThemeMode = 'watch' | 'player';

const hex = (value: unknown): string | undefined =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : undefined;

export function readWatchColors(): LaunchColors {
  const saved = storage.get<LaunchColors>(WATCH_KEY);
  return { background: hex(saved?.background), accent: hex(saved?.accent) };
}

/** Mirror only normalized appearance tokens from the current Watch profile.
 * The launcher's local copy survives leaving the session, not its raw CSS. */
export function rememberWatchColors(colors: LaunchColors): void {
  const vars = themeVariables(colors);
  const next = { background: hex(vars['--background']), accent: hex(vars['--brand']) };
  const old = readWatchColors();
  if (old.background !== next.background || old.accent !== next.accent) storage.set(WATCH_KEY, next);
}

export function readLaunchThemeMode(): LaunchThemeMode {
  return storage.get<unknown>(MODE_KEY) === 'player' ? 'player' : 'watch';
}

export function saveLaunchThemeMode(mode: LaunchThemeMode): void {
  storage.set(MODE_KEY, mode);
}
