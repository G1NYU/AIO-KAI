import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { BiArrowBack, BiDisc, BiFilm, BiMusic } from 'react-icons/bi';

/** Music's independent shell. Streaming providers are deliberately not mocked. */
export function MusicPage({
  openVideo,
  openWelcome,
}: {
  openVideo(): void;
  openWelcome(): void;
}) {
  return (
    <main data-page="music" className="min-h-screen px-6 py-7 sm:px-10">
      <div className="mx-auto max-w-6xl">
        <nav aria-label={t`Media sections`} className="mb-12 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={openWelcome}
            className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm text-[--muted] transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
          >
            <BiArrowBack aria-hidden />
            <Trans>All media</Trans>
          </button>
          <button
            type="button"
            onClick={openVideo}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm transition-colors hover:bg-white/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
          >
            <BiFilm aria-hidden />
            <Trans>Movies & TV</Trans>
          </button>
        </nav>
        <header className="mb-10 flex items-center gap-4">
          <span className="rounded-2xl border border-white/10 bg-white/[0.05] p-4">
            <BiMusic aria-hidden className="text-4xl text-violet-200" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[--muted]">
              <Trans>Independent listening</Trans>
            </p>
            <h1 className="text-4xl font-semibold tracking-tight"><Trans>Music</Trans></h1>
          </div>
        </header>
        <section className="flex min-h-80 flex-col items-center justify-center gap-5 rounded-3xl border border-white/10 bg-white/[0.03] px-8 py-16 text-center">
          <BiDisc aria-hidden className="text-6xl text-violet-200/80" />
          <h2 className="text-2xl font-semibold"><Trans>Your music space is ready</Trans></h2>
          <p className="max-w-lg text-sm leading-6 text-[--muted]">
            <Trans>Music sources and playback are the next milestone. This screen does not require your AIOStreams configuration, and no demo tracks or fake providers are shown.</Trans>
          </p>
        </section>
      </div>
    </main>
  );
}
