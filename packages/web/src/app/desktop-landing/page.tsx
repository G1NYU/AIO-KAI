import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { FiFilm, FiHeadphones, FiMenu } from 'react-icons/fi';
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

  React.useEffect(() => {
    document.documentElement.dataset.tsugiTheme = theme;
    applyEclipseAppearance();
    const update = () => applyEclipseAppearance();
    window.addEventListener('tsugi-eclipse-appearance-change', update);
    return () => window.removeEventListener('tsugi-eclipse-appearance-change', update);
  }, [theme]);

  function changeTheme(value: PlayerThemeId) {
    setTheme(value);
    savePlayerTheme(value);
    window.dispatchEvent(new CustomEvent<PlayerThemeId>('tsugi-theme-change', { detail: value }));
  }

  const sections = [
    { id: 'video', label: t`Movies & TV`, Icon: FiFilm, open: openVideo },
    { id: 'music', label: t`Music`, Icon: FiHeadphones, open: openMusic },
  ];

  return (
    <main data-page="desktop-landing"
      className="tsugi-landing relative flex min-h-dvh flex-col px-6 pb-8 pt-12 sm:px-12 lg:px-[4vw]">
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
              value={theme} onChange={(event) => changeTheme(event.target.value as PlayerThemeId)}>
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
            <span aria-hidden className="tsugi-entry-mark"><TsugiBrand markOnly /></span>
            <h1 className="tsugi-entry-wordmark"><Trans>Tsugi</Trans></h1>
          </div>

          <nav className="tsugi-entry-index" aria-label={t`Media sections`}>
            <h2 className="sr-only"><Trans>Media sections</Trans></h2>
            <div className="tsugi-entry-list">
              {sections.map(({ id, label, Icon, open }) => (
                <button key={id} type="button" onClick={open} className="tsugi-entry-link">
                  <span className="tsugi-entry-label-group">
                    <Icon aria-hidden className="tsugi-entry-icon" />
                    <span className="tsugi-entry-label">{label}</span>
                    <span aria-hidden className="tsugi-entry-dots"><i /><i /><i /></span>
                  </span>
                </button>
              ))}
            </div>
          </nav>
        </div>
      </div>
    </main>
  );
}
