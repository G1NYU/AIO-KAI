import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { FiArrowUpRight, FiFilm, FiHeadphones } from 'react-icons/fi';
import { TsugiBrand } from '@/components/tsugi-brand';
import { PLAYER_PALETTES, readPlayerTheme, savePlayerTheme, type PlayerThemeId } from '@/lib/music/player-theme';

/** A desktop gateway, not an unrelated third media-player shell. */
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
  const palette = PLAYER_PALETTES[theme];

  function changeTheme(value: PlayerThemeId) {
    setTheme(value);
    savePlayerTheme(value);
    window.dispatchEvent(new CustomEvent<PlayerThemeId>('tsugi-theme-change', { detail: value }));
  }

  return (
    <main data-page="desktop-landing"
      className="tsugi-landing relative flex min-h-dvh flex-col overflow-hidden px-6 pb-12 pt-16 text-[--tsugi-ink] sm:px-12 lg:px-[clamp(48px,6vw,112px)]">
      <div aria-hidden className="tsugi-chrome-wash" />
      <div aria-hidden className="tsugi-landing-atmosphere pointer-events-none absolute inset-0" />
      <div className="relative mx-auto flex w-full max-w-[1480px] flex-1 flex-col">
        <nav className="flex items-center justify-between gap-5">
          <TsugiBrand />
          <label className="tsugi-theme-menu flex items-center gap-3 text-xs" style={{ color: palette.muted }}>
            <span className="hidden sm:inline"><Trans>Player theme</Trans></span>
            <select aria-label={t`Player theme`} value={theme}
              onChange={(event) => changeTheme(event.target.value as PlayerThemeId)}>
              <option value="mocha">{t`Mocha`}</option>
              <option value="matte">{t`Matte black`}</option>
              <option value="aio-dark">{t`Ink`}</option>
              <option value="nightfall">{t`Nightfall`}</option>
              <option value="carbon">{t`Carbon`}</option>
            </select>
          </label>
        </nav>

        <div className="my-auto grid gap-12 py-16 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,.7fr)] xl:items-end">
          <header className="max-w-[850px]">
            <p className="tsugi-eyebrow"><Trans>Separate worlds. One place.</Trans></p>
            <h1 className="mt-6 max-w-3xl text-[clamp(3.2rem,6.1vw,6.8rem)] font-semibold leading-[1.05] tracking-[-0.06em]">
              <Trans>Everything connects.</Trans>
            </h1>
            <p className="mt-7 max-w-[580px] text-sm leading-7 text-[--tsugi-muted] sm:text-base">
              <Trans>Music and moving pictures, joined without binding their accounts together.</Trans>
            </p>
          </header>
          <div className="tsugi-landing-join hidden min-h-56 items-center justify-center xl:flex" aria-hidden>
            <span className="tsugi-join-orbit tsugi-join-orbit-one" />
            <span className="tsugi-join-orbit tsugi-join-orbit-two" />
            <span className="tsugi-join-center"><TsugiBrand markOnly /></span>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2" aria-label={t`Media sections`}>
          <button type="button" onClick={openVideo}
            className="tsugi-entry-card group relative flex min-h-56 flex-col items-start justify-between overflow-hidden p-7 text-left sm:p-9">
            <span className="flex w-full items-center justify-between">
              <span className="tsugi-entry-index tsugi-entry-index-one"><Trans>Movies & TV</Trans></span>
              <FiFilm aria-hidden className="text-xl" />
            </span>
            <span className="flex w-full items-end justify-between gap-5">
              <span className="min-w-0">
                <span className="block text-3xl font-semibold tracking-tight"><Trans>Movies & TV</Trans></span>
                <span className="mt-3 block text-sm text-[--tsugi-muted]">
                  <Trans>Enter your video library and connected sources.</Trans>
                </span>
              </span>
              <span className="tsugi-entry-action flex size-11 shrink-0 items-center justify-center">
                <FiArrowUpRight aria-hidden className="size-5" />
              </span>
            </span>
          </button>
          <button type="button" onClick={openMusic}
            className="tsugi-entry-card group relative flex min-h-56 flex-col items-start justify-between overflow-hidden p-7 text-left sm:p-9">
            <span className="flex w-full items-center justify-between">
              <span className="tsugi-entry-index tsugi-entry-index-two"><Trans>Music</Trans></span>
              <FiHeadphones aria-hidden className="text-xl" />
            </span>
            <span className="flex w-full items-end justify-between gap-5">
              <span className="min-w-0">
                <span className="block text-3xl font-semibold tracking-tight"><Trans>Music</Trans></span>
                <span className="mt-3 block text-sm text-[--tsugi-muted]">
                  <Trans>Listen through your independent music addons.</Trans>
                </span>
              </span>
              <span className="tsugi-entry-action flex size-11 shrink-0 items-center justify-center">
                <FiArrowUpRight aria-hidden className="size-5" />
              </span>
            </span>
          </button>
        </div>
      </div>
    </main>
  );
}
