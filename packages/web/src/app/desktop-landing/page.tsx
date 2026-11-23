import { Trans } from '@lingui/react/macro';
import { BiFilm, BiMusic, BiRightArrowAlt } from 'react-icons/bi';
import { TsugiBrand } from '@/components/tsugi-brand';

/** The two media environments form a joined whole without duplicate chrome. */
export function DesktopLandingPage({
  openVideo,
  openMusic,
}: {
  openVideo(): void;
  openMusic(): void;
}) {
  return (
    <main data-page="desktop-landing"
      className="mx-auto flex min-h-screen max-w-[1440px] flex-col justify-center bg-[#090D10] px-8 py-20 text-[#E8EDF0] md:px-16">
      <header className="mb-20 max-w-3xl">
        <TsugiBrand />
        <p className="mt-12 text-xs uppercase tracking-[0.3em] text-[#9BAFB8]">
          <Trans>Separate worlds. One place.</Trans>
        </p>
        <h1 className="mt-6 text-5xl font-medium leading-[1.15] tracking-tight md:text-7xl">
          <Trans>Everything connects.</Trans>
        </h1>
        <p className="mt-6 max-w-xl text-base leading-7 text-[#9BAFB8]">
          <Trans>Music and moving pictures, joined without binding their accounts together.</Trans>
        </p>
      </header>
      <div className="grid border-t border-[#343D42] md:grid-cols-2">
        <button type="button" onClick={openVideo}
          className="group flex min-h-64 flex-col justify-between border-b border-[#343D42] px-1 py-8 text-left transition-colors hover:bg-white/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#BDD8E5] md:mr-8">
          <div className="flex items-center justify-between">
            <span className="text-xs tabular-nums tracking-widest text-[#9BAFB8]">01</span>
            <BiFilm aria-hidden className="text-2xl text-[#BDD8E5]" />
          </div>
          <div className="flex items-end justify-between">
            <div>
              <h2 className="text-3xl font-medium"><Trans>Movies & TV</Trans></h2>
              <p className="mt-3 text-sm text-[#9BAFB8]"><Trans>Enter your video library and connected sources.</Trans></p>
            </div>
            <BiRightArrowAlt aria-hidden className="text-3xl text-[#BDD8E5] transition-transform group-hover:translate-x-1" />
          </div>
        </button>
        <button type="button" onClick={openMusic}
          className="group flex min-h-64 flex-col justify-between border-b border-[#343D42] px-1 py-8 text-left transition-colors hover:bg-white/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#BDD8E5] md:ml-8">
          <div className="flex items-center justify-between">
            <span className="text-xs tabular-nums tracking-widest text-[#9BAFB8]">02</span>
            <BiMusic aria-hidden className="text-2xl text-[#BDD8E5]" />
          </div>
          <div className="flex items-end justify-between">
            <div>
              <h2 className="text-3xl font-medium"><Trans>Music</Trans></h2>
              <p className="mt-3 text-sm text-[#9BAFB8]"><Trans>Listen through your independent music addons.</Trans></p>
            </div>
            <BiRightArrowAlt aria-hidden className="text-3xl text-[#BDD8E5] transition-transform group-hover:translate-x-1" />
          </div>
        </button>
      </div>
    </main>
  );
}
