import type { ReactNode } from 'react';
import { t } from '@lingui/core/macro';
import { TsugiBrand, TsugiMediaIcon } from '@/components/tsugi-brand';
import { TsugiIcon } from '@/components/tsugi-icons';
import { useDesktopArea } from '@/lib/desktop-area';
import { mediaDestinations } from './media-navigation';

/** The one desktop rail. Sections contribute actions, never their own geometry. */
export function TsugiRail({ area, disabled = false, children, footer, className = '', mediaClassName = '', globalSettings = true, onVideoOpen }: {
  area: 'home' | 'video' | 'music' | 'read' | 'vault';
  disabled?: boolean;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  mediaClassName?: string;
  globalSettings?: boolean;
  onVideoOpen?: () => void;
}) {
  const actions = useDesktopArea();
  if (!actions) return null;
  const allMedia = t({ id: 'All media', message: 'All media' });
  const settings = t({ id: 'App settings', message: 'App settings' });
  const sectionLabel = area === 'home' ? t({ id: 'Home', message: 'Home' }) : area === 'read' ? t({ id: 'Read', message: 'Read' }) : area === 'music' ? t({ id: 'Music', message: 'Music' }) : area === 'vault' ? t({ id: 'Vault', message: 'Vault' }) : t({ id: 'Video', message: 'Video' });
  return <aside className={'tsugi-desktop-rail ' + className} data-ui="tsugi-desktop-rail" data-area={area} aria-label={sectionLabel}>
    <button type="button" className="tsugi-rail-brand" disabled={disabled} onClick={actions.openWelcome} title={allMedia} aria-label={allMedia}>
      <TsugiBrand className="tsugi-rail-signature" />
      <span className="tsugi-rail-context" aria-hidden="true">{sectionLabel}</span>
    </button>
    <div className="tsugi-rail-workspace">{children}</div>
    <nav className={'tsugi-rail-media ' + mediaClassName} aria-label={t({ id: 'Media sections', message: 'Media sections' })}>
      {mediaDestinations(actions).map(({ id, label, open }) => <button type="button" key={id} data-name={id} disabled={disabled} onClick={() => id === 'video' && onVideoOpen ? onVideoOpen() : open()} aria-current={area === id ? 'page' : undefined} title={label} aria-label={label}><TsugiMediaIcon area={id} /></button>)}
    </nav>
    {(globalSettings || footer) && <div className="tsugi-rail-footer">{globalSettings && <button type="button" className="tsugi-rail-global" disabled={disabled} onClick={actions.openSettings} title={settings} aria-label={settings}><TsugiIcon name="settings" /><span>{settings}</span></button>}{footer}</div>}
  </aside>;
}
