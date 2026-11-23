import { Trans } from '@lingui/react/macro';
import { BiFilm, BiMusic } from 'react-icons/bi';

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
      className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center gap-8 px-6 py-20"
    >
      <header className="max-w-2xl space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[--muted]">
          <Trans>Your media, your way</Trans>
        </p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          <Trans>What would you like to enjoy?</Trans>
        </h1>
        <p className="text-base text-[--muted]">
          <Trans>Music works independently of your Movies & TV connection.</Trans>
        </p>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        <button
          type="button"
          onClick={openVideo}
          className="group flex min-h-56 flex-col items-start justify-between rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-start transition-colors hover:border-white/25 hover:bg-white/[0.07] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <BiFilm aria-hidden className="text-4xl text-blue-200" />
          <span className="space-y-2">
            <span className="block text-2xl font-semibold"><Trans>Movies & TV</Trans></span>
            <span className="block text-sm text-[--muted]">
              <Trans>Continue with your AIOStreams configuration, addons and player.</Trans>
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={openMusic}
          className="group flex min-h-56 flex-col items-start justify-between rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-start transition-colors hover:border-white/25 hover:bg-white/[0.07] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <BiMusic aria-hidden className="text-4xl text-violet-200" />
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
