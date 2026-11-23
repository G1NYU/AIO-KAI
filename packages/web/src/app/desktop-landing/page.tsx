import { Trans } from '@lingui/react/macro';
import { BiFilm, BiMusic } from 'react-icons/bi';
import { TsugiBrand } from '@/components/tsugi-brand';

export function DesktopLandingPage({
  openVideo,
  openMusic,
}: {
  openVideo(): void;
  openMusic(): void;
}) {
  return (
    <main
      data-page="desktop-landing"
      className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center gap-12 bg-[#0B0B11] px-6 py-20 text-[#E9EAF2]"
    >
      <header className="max-w-3xl space-y-4">
        <TsugiBrand />
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#AAA4BD]">
          <Trans>Connected by choice</Trans>
        </p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          <Trans>Everything you love, together.</Trans>
        </h1>
        <p className="text-base text-[--muted]">
          <Trans>Tsugi connects your music and video addons without tying their accounts together.</Trans>
        </p>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        <button
          type="button"
          onClick={openVideo}
          className="group flex min-h-56 flex-col items-start justify-between rounded-3xl border border-[#302E3B] bg-[#171620] p-8 text-start transition-colors hover:border-[#465269] hover:bg-[#20202B] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <BiFilm aria-hidden className="text-4xl text-[#BDD5F1]" />
          <span className="space-y-2">
            <span className="block text-2xl font-semibold"><Trans>Movies & TV</Trans></span>
            <span className="block text-sm text-[--muted]">
              <Trans>Open your existing video configuration and its addons.</Trans>
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={openMusic}
          className="group flex min-h-56 flex-col items-start justify-between rounded-3xl border border-[#302E3B] bg-[#171620] p-8 text-start transition-colors hover:border-[#465269] hover:bg-[#20202B] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <BiMusic aria-hidden className="text-4xl text-[#AE9FD9]" />
          <span className="space-y-2">
            <span className="block text-2xl font-semibold"><Trans>Music</Trans></span>
            <span className="block text-sm text-[--muted]">
              <Trans>Enter the music space without a streaming-server account.</Trans>
            </span>
          </span>
        </button>
      </div>
    </main>
  );
}
