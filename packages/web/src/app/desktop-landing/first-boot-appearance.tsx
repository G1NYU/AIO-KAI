import React from 'react';
import { Trans } from '@lingui/react/macro';
import { GlobalAppearanceSettings } from '@/components/shell/global-settings';
import { TsugiBrand } from '@/components/tsugi-brand';
import { storage } from '@/lib/storage';

const key = 'tsugi-onboarding-complete-v1';
let completedInSession = false;

export function FirstBootAppearance() {
  const [open, setOpen] = React.useState(() => !completedInSession && storage.get<boolean>(key) !== true);
  const dialog = React.useRef<HTMLDialogElement>(null);
  React.useEffect(() => {
    const node = dialog.current;
    if (open && node && !node.open) node.showModal();
    else if (!open && node?.open) node.close();
    return () => { if (node?.open) node.close(); };
  }, [open]);
  function finish() {
    completedInSession = true;
    storage.set(key, true);
    setOpen(false);
  }
  return <dialog ref={dialog} className="tsugi-global-settings tsugi-onboarding" data-ui="tsugi-onboarding" aria-labelledby="tsugi-onboarding-title" onCancel={event => { event.preventDefault(); finish(); }}>
    <header>
      <div className="tsugi-onboarding-title">
        <TsugiBrand markOnly />
        <div><h2 id="tsugi-onboarding-title"><Trans>Make Tsugi yours</Trans></h2><p><Trans>Choose how your workspace looks before you start.</Trans></p></div>
      </div>
    </header>
    <GlobalAppearanceSettings />
    <footer className="tsugi-onboarding-footer">
      <p><Trans>Your choices apply immediately. You can always change them in App settings.</Trans></p>
      <div className="tsugi-onboarding-actions">
        <button type="button" className="tsugi-read-action" onClick={finish}><Trans>Skip for now</Trans></button>
        <button type="button" className="tsugi-read-action tsugi-series-primary" onClick={finish}><Trans>Enter Tsugi</Trans></button>
      </div>
    </footer>
  </dialog>;
}
