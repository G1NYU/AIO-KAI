import type { ReactNode } from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { BrushSettings } from '@/components/tsugi-icons';
import { TsugiBrand, TsugiMediaIcon } from '@/components/tsugi-brand';
import { useDesktopArea, type DesktopAreaActions } from '@/lib/desktop-area';

export function mediaDestinations(actions: DesktopAreaActions) {
  return [
    { id: 'video' as const, label: t({ id: "Movies & TV", message: "Movies & TV" }), open: actions.openMovies ?? actions.openVideo },
    { id: 'music' as const, label: t({ id: "Music", message: "Music" }), open: actions.openMusic },
    ...(actions.openRead ? [{ id: 'read' as const, label: t({ id: 'Read', message: 'Read' }), open: actions.openRead }] : []),
    ...(actions.openVault ? [{ id: 'vault' as const, label: t({ id: 'Vault', message: 'Vault' }), open: actions.openVault }] : []),
  ];
}

export function MediaNavigation({ area, rail = false, disabled = false, className = '', tools }: {
  area: 'video' | 'music' | 'read' | 'vault';
  rail?: boolean;
  disabled?: boolean;
  className?: string;
  tools?: ReactNode;
}) {
  const actions = useDesktopArea();
  if (!actions) return null;
  const destinations = mediaDestinations(actions);
  return <nav className={`tsugi-media-navigation ${rail ? 'tsugi-media-navigation-rail' : ''} ${className}`} aria-label={t({ id: "Media sections", message: "Media sections" })}>
    {!rail && <button className="tsugi-category-link tsugi-entry-home" disabled={disabled} onClick={actions.openWelcome} aria-label={t({ id: "All media", message: "All media" })}><TsugiBrand /></button>}
    <div className="tsugi-media-destinations">{destinations.map(({ id, label, open }) => <button key={id} type="button" className="tsugi-category-link" aria-current={area === id ? 'page' : undefined} disabled={disabled} onClick={open} aria-label={label}><TsugiMediaIcon area={id} /><span>{label}</span></button>)}</div>
    <div className="tsugi-media-tools"><button className="tsugi-category-link tsugi-entry-settings" aria-label={t({ id: "App settings", message: "App settings" })} disabled={disabled} onClick={actions.openSettings}><BrushSettings aria-hidden /><span><Trans id="App settings">App settings</Trans></span></button>{tools}</div>
  </nav>;
}
