import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { FiSettings } from 'react-icons/fi';
import { TsugiBrand, TsugiMediaIcon } from '@/components/tsugi-brand';
import { useDesktopArea } from '@/lib/desktop-area';

/** Direct media destinations, independent of server configuration. */
export function DesktopLandingPage({ openVideo, openMusic, openRead, openVault }: {
  openVideo(): void; openMusic(): void; openRead?: () => void; openVault?: () => void;
}) {
  const desktopArea = useDesktopArea();
  const sections = [
    { id: 'video' as const, label: t({ id: "Movies & TV", message: "Movies & TV" }), open: openVideo },
    { id: 'music' as const, label: t({ id: "Music", message: "Music" }), open: openMusic },
    ...(openRead ? [{ id: 'read' as const, label: t({ id: 'Read', message: 'Read' }), open: openRead }] : []),
    ...(openVault ? [{ id: 'vault' as const, label: t({ id: 'Vault', message: 'Vault' }), open: openVault }] : []),
  ];
  return <main data-page="desktop-landing" className="tsugi-landing tsugi-index">
    <header className="tsugi-index-header">
      {desktopArea && <button type="button" className="tsugi-category-link" onClick={desktopArea.openSettings}><FiSettings aria-hidden /><Trans id="App settings">App settings</Trans></button>}
    </header>
    <div className="tsugi-index-body">
      <div className="tsugi-index-identity">
        <div className="tsugi-index-signature"><TsugiBrand markOnly /></div>
        <h1 className="tsugi-index-wordmark"><Trans id="Tsugi">Tsugi</Trans></h1>
      </div>
      <nav className="tsugi-index-destinations" aria-label={t({ id: "Media sections", message: "Media sections" })}>
        {sections.map(({ id, label, open }) => <button key={id} type="button" onClick={open} className="tsugi-index-link" aria-label={label}>
          <TsugiMediaIcon area={id} />
          <span className="tsugi-index-copy">{label}</span>
        </button>)}
      </nav>
    </div>
  </main>;
}
