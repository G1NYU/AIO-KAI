import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { FiBookOpen, FiFilm, FiHeadphones, FiMenu } from 'react-icons/fi';
import { TsugiBrand } from '@/components/tsugi-brand';
import { useDesktopArea } from '@/lib/desktop-area';

/** An editorial media index. Add a section only when its destination exists. */
export function DesktopLandingPage({
  openVideo,
  openMusic,
  openRead,
}: {
  openVideo(): void;
  openMusic(): void;
  openRead?: () => void;
}) {
  const desktopArea = useDesktopArea();

  const sections = [
    { id: 'video', label: t`Movies & TV`, Icon: FiFilm, open: openVideo },
    { id: 'music', label: t`Music`, Icon: FiHeadphones, open: openMusic },
    ...(openRead ? [{ id: 'read', label: t({ id: 'Read', message: 'Read' }), Icon: FiBookOpen, open: openRead }] : []),
  ];

  return (
    <main data-page="desktop-landing"
      className="tsugi-landing relative flex min-h-dvh flex-col px-6 pb-8 pt-12 sm:px-12 lg:px-[4vw]">
      <header className="relative z-10 flex items-center justify-between gap-5">
        <TsugiBrand markOnly />
        {desktopArea && <button type="button" className="tsugi-icon-action" aria-label={t({ id: "App settings", message: "App settings" })} onClick={desktopArea.openSettings}><FiMenu aria-hidden className="text-xl" /></button>}
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
