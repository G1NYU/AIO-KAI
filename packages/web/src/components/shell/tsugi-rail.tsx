import type { ReactNode } from 'react';
import { t } from '@lingui/core/macro';
import { TsugiBrand, TsugiMediaIcon } from '@/components/tsugi-brand';
import { TsugiIcon } from '@/components/tsugi-icons';
import { useDesktopArea } from '@/lib/desktop-area';
import { mediaDestinations } from './media-navigation';

/** The one desktop rail. Sections contribute actions, never their own geometry. */
export function TsugiRail({ area, disabled = false, children, footer, className = '', mediaClassName = '', globalSettings = true }: {
  area: 'video' | 'music' | 'read';
  disabled?: boolean;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  mediaClassName?: string;
  globalSettings?: boolean;
}) {
  const actions = useDesktopArea();
  if (!actions) return null;
  const allMedia = t({ id: 'All media', message: 'All media' });
  const settings = t({ id: 'App settings', message: 'App settings' });
  return <aside className={'tsugi-desktop-rail ' + className} data-ui="tsugi-desktop-rail" data-area={area}>
    <nav className={'tsugi-rail-media ' + mediaClassName} aria-label={t({ id: 'Media sections', message: 'Media sections' })}>
      <button type="button" className="tsugi-rail-brand" disabled={disabled} onClick={actions.openWelcome} title={allMedia} aria-label={allMedia}><TsugiBrand markOnly /></button>
      {mediaDestinations(actions).map(({ id, label, open }) => <button type="button" key={id} disabled={disabled} onClick={open} aria-current={area === id ? 'page' : undefined} title={label} aria-label={label}><TsugiMediaIcon area={id} /></button>)}
    </nav>
    <div className="tsugi-pixel-rule" aria-hidden="true" />
    <div className="tsugi-rail-workspace">{children}</div>
    {(globalSettings || footer) && <div className="tsugi-rail-footer"><div className="tsugi-pixel-rule" aria-hidden="true" />{globalSettings && <button type="button" className="tsugi-rail-global" disabled={disabled} onClick={actions.openSettings} title={settings} aria-label={settings}><TsugiIcon name="settings" /></button>}{footer}</div>}
  </aside>;
}
