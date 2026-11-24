import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { FiArrowUpRight, FiFilm, FiHeadphones, FiMenu } from 'react-icons/fi';
import { TsugiBrand } from '@/components/tsugi-brand';
import {
  PLAYER_PALETTES, readPlayerTheme, savePlayerTheme, type PlayerThemeId,
} from '@/lib/music/player-theme';

/** A quiet gateway into two independent media environments. */
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
  }, [theme]);

  function changeTheme(value: PlayerThemeId) {
    setTheme(value);
    savePlayerTheme(value);
    window.dispatchEvent(new CustomEvent<PlayerThemeId>('tsugi-theme-change', { detail: value }));
  }

  return (
    <main data-page="desktop-landing"
      className="tsugi-landing relative flex min-h-dvh flex-col overflow-hidden px-6 pb-10 pt-16 sm:px-12 lg:px-[4vw]">
      <div aria-hidden className="tsugi-landing-atmosphere pointer-events-none absolute inset-0" />
      <header className="relative z-10 flex items-center justify-between gap-5">
        <TsugiBrand />
        <details className="tsugi-overflow">
          <summary aria-label={t`Settings`} className="tsugi-icon-action">
            <FiMenu aria-hidden className="text-xl" />
          </summary>
          <div className="tsugi-overflow-panel">
            <label htmlFor="tsugi-gateway-theme" className="block text-xs font-medium text-[--tsugi-muted]">
              <Trans>Player theme</Trans>
            </label>
            <select id="tsugi-gateway-theme" className="tsugi-menu-select mt-3 w-full"
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

      <div className="tsugi-gateway-hero relative flex flex-1 flex-col items-center justify-center py-16">
        <span aria-hidden className="tsugi-gateway-mark"><TsugiBrand markOnly /></span>
        <h1 className="mt-7 text-center text-[clamp(3.2rem,7vw,7.5rem)] font-semibold tracking-[-.08em]">
          <Trans>Tsugi</Trans>
        </h1>
      </div>

      <nav className="tsugi-gateway-nav relative grid gap-x-10 md:grid-cols-2" aria-label={t`Media sections`}>
        <button type="button" onClick={openVideo} className="tsugi-gateway-link group">
          <span className="flex items-center gap-4">
            <FiFilm aria-hidden className="text-xl text-[--tsugi-muted]" />
            <span className="text-[clamp(1.7rem,2.7vw,3rem)] font-medium tracking-tight"><Trans>Movies & TV</Trans></span>
          </span>
          <FiArrowUpRight aria-hidden className="text-2xl transition-transform group-hover:translate-x-1 group-hover:-translate-y-1" />
        </button>
        <button type="button" onClick={openMusic} className="tsugi-gateway-link group">
          <span className="flex items-center gap-4">
            <FiHeadphones aria-hidden className="text-xl text-[--tsugi-muted]" />
            <span className="text-[clamp(1.7rem,2.7vw,3rem)] font-medium tracking-tight"><Trans>Music</Trans></span>
          </span>
          <FiArrowUpRight aria-hidden className="text-2xl transition-transform group-hover:translate-x-1 group-hover:-translate-y-1" />
        </button>
      </nav>
    </main>
  );
}
