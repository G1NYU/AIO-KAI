import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { FiArrowUpRight, FiSettings } from 'react-icons/fi';
import { TsugiBrand, TsugiMediaIcon } from '@/components/tsugi-brand';
import { useDesktopArea } from '@/lib/desktop-area';

/** One media index with direct destinations, even before a server is configured. */
export function DesktopLandingPage({ openVideo, openMusic, openRead }: {
  openVideo(): void; openMusic(): void; openRead?: () => void;
}) {
  const desktopArea = useDesktopArea();
  const sections = [
    { id: 'video' as const, label: t({ id: "Movies & TV", message: "Movies & TV" }), description: t({ id: "Cinema, series and your watchlist.", message: "Cinema, series and your watchlist." }), open: openVideo },
    { id: 'music' as const, label: t({ id: "Music", message: "Music" }), description: t({ id: "Your albums, tracks and playlists.", message: "Your albums, tracks and playlists." }), open: openMusic },
    ...(openRead ? [{ id: 'read' as const, label: t({ id: "Read", message: "Read" }), description: t({ id: "Manga, manhwa and your next chapter.", message: "Manga, manhwa and your next chapter." }), open: openRead }] : []),
  ];
  return <main data-page="desktop-landing" className="tsugi-landing tsugi-index">
    <header className="tsugi-index-header">
      <TsugiBrand markOnly />
      {desktopArea && <button type="button" className="tsugi-category-link" onClick={desktopArea.openSettings}><FiSettings aria-hidden /><Trans id="App settings">App settings</Trans></button>}
    </header>
    <div className="tsugi-index-body">
      <div className="tsugi-index-identity">
        <div className="tsugi-index-signature"><TsugiBrand markOnly /><span aria-hidden lang="ja">次</span></div>
        <h1 className="tsugi-index-wordmark"><Trans id="Tsugi">Tsugi</Trans><span aria-hidden>.</span></h1>
        <p><Trans id="One place for what comes next.">One place for what comes next.</Trans></p>
      </div>
      <nav className="tsugi-index-destinations" aria-label={t({ id: "Media sections", message: "Media sections" })}>
        <div className="tsugi-index-caption"><Trans id="Your media">Your media</Trans><span aria-hidden>{String(sections.length).padStart(2, '0')}</span></div>
        {sections.map(({ id, label, description, open }, index) => <button key={id} type="button" onClick={open} className="tsugi-index-link" aria-label={label}>
          <span className="tsugi-index-number" aria-hidden>{String(index + 1).padStart(2, '0')}</span>
          <TsugiMediaIcon area={id} />
          <span className="tsugi-index-copy"><strong>{label}</strong><small>{description}</small></span>
          <FiArrowUpRight className="tsugi-index-arrow" aria-hidden />
        </button>)}
      </nav>
    </div>
    <footer className="tsugi-index-footer"><span><Trans id="Watch · Listen · Read">Watch · Listen · Read</Trans></span><span><Trans id="Personal media workspace">Personal media workspace</Trans></span></footer>
  </main>;
}
