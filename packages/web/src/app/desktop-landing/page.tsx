import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { FiMenu } from 'react-icons/fi';
import { TsugiFilmIcon, TsugiMusicIcon } from '@/components/tsugi-icons';
import { readLaunchThemeMode, readWatchColors, saveLaunchThemeMode } from '@/lib/launcher-theme';
import { TsugiBrand } from '@/components/tsugi-brand';
import { applyEclipseAppearance } from '@/lib/music/eclipse-appearance';
import {
  PLAYER_PALETTES, readPlayerTheme, savePlayerTheme, type PlayerThemeId,
} from '@/lib/music/player-theme';

/** An editorial media index. Add a section only when its destination exists. */
export function DesktopLandingPage({
  openVideo,
  openMusic,
}: {
  openVideo(): void;
  openMusic(): void;
}) {
  const [theme, setTheme] = React.useState<PlayerThemeId>(readPlayerTheme);
  const [mode, setMode] = React.useState(readLaunchThemeMode);
  const watch = mode === 'watch' ? readWatchColors() : { background: undefined, accent: undefined };
  const colors = {
    '--tsugi-entry-canvas': watch.background,
    '--tsugi-entry-accent': watch.accent,
  } as React.CSSProperties;

  React.useEffect(() => {
    document.documentElement.dataset.tsugiTheme = theme;
    applyEclipseAppearance();
    const update = () => applyEclipseAppearance();
    window.addEventListener('tsugi-eclipse-appearance-change', update);
    return () => window.removeEventListener('tsugi-eclipse-appearance-change', update);
  }, [theme]);

  function changeTheme(value: PlayerThemeId | 'watch') {
    const nextMode = value === 'watch' ? 'watch' : 'player';
    setMode(nextMode);
    saveLaunchThemeMode(nextMode);
    if (value === 'watch') return;
    setTheme(value);
    savePlayerTheme(value);
    window.dispatchEvent(new CustomEvent<PlayerThemeId>('tsugi-theme-change', { detail: value }));
  }

  const sections = [
    { id: 'video', label: t`Watch`, description: t`Movies & TV`, Icon: TsugiFilmIcon, open: openVideo },
    { id: 'music', label: t`Listen`, description: t`Music`, Icon: TsugiMusicIcon, open: openMusic },
  ];

  return (
    <main data-page="desktop-landing" style={colors}
      className="tsugi-landing relative flex min-h-dvh flex-col px-6 pb-8 pt-12 sm:px-12 lg:px-[6vw]">
      <header className="relative z-10 flex items-center justify-between gap-5">
        <TsugiBrand markOnly />
        <details className="tsugi-overflow">
          <summary aria-label={t`Settings`} className="tsugi-icon-action">
            <FiMenu aria-hidden className="text-xl" />
          </summary>
          <div className="tsugi-overflow-panel">
            <label htmlFor="tsugi-entry-theme" className="block text-xs font-medium text-[--tsugi-muted]">
              <Trans>Player theme</Trans>
            </label>
            <select id="tsugi-entry-theme" className="tsugi-menu-select mt-3 w-full"
              value={mode === 'watch' ? 'watch' : theme}
              onChange={(event) => changeTheme(event.target.value as PlayerThemeId | 'watch')}>
              <option value="watch">{t`Follow Watch colours`}</option>
              {(Object.keys(PLAYER_PALETTES) as PlayerThemeId[]).map((id) => (
                <option key={id} value={id}>
                  {id === 'mocha' ? t`Mocha` : id === 'matte' ? t`Matte black`
                    : id === 'aio-dark' ? t`Ink` : id === 'nightfall' ? t`Nightfall` : t`Carbon`}
                </option>
              ))}
            </select>
          </div>
        </details>
      </header>

      <div className="tsugi-entry-stage">
        <div className="tsugi-entry-composition">
          <div className="tsugi-entry-brand">
            <svg className="tsugi-entry-geometry" viewBox="0 0 240 160" aria-hidden="true">
              {/* An original folded-paper composition: three interlocking ribbons. */}
              <path d="M10 80 65 25 120 80 92 108 65 81 37 108Z" fill="currentColor" opacity=".72" />
              <path d="M65 25 120 25 175 80 120 135 92 108 120 80Z" fill="currentColor" opacity=".38" />
              <path d="M120 25 175 25 230 80 175 135 120 135 175 80Z" fill="currentColor" opacity=".16" />
              <path d="M65 25 120 80 92 108M120 25 175 80 120 135M175 25 230 80 175 135" fill="none" stroke="currentColor" strokeWidth="1" opacity=".65" />
            </svg>
            <h1 className="tsugi-entry-wordmark"><Trans>Tsugi</Trans></h1>
          </div>

          <nav className="tsugi-entry-index" aria-label={t`Media sections`}>
            <h2 className="sr-only"><Trans>Media sections</Trans></h2>
            <div className="tsugi-entry-list">
              {sections.map(({ id, label, description, Icon, open }) => (
                <button key={id} type="button" data-ui={`tsugi-entry-${id}`}
                  onClick={open} className="tsugi-entry-link">
                  <Icon aria-hidden className="tsugi-entry-icon" />
                  <span className="tsugi-entry-label-group">
                    <span className="tsugi-entry-label">{label}</span>
                    <span className="tsugi-entry-description">{description}</span>
                  </span>
                  <span aria-hidden="true" className="tsugi-entry-dot" />
                </button>
              ))}
            </div>
          </nav>
        </div>
      </div>
    </main>
  );
}
