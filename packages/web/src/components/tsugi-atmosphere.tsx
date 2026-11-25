import { Trans } from '@lingui/react/macro';

/** Local signature only. No competing brand mark, repeated texture or artwork. */
export function TsugiAtmosphere({ placement }: { placement: 'entry' | 'library' }) {
  return <div className="tsugi-atmosphere" data-placement={placement} aria-hidden="true">
    <span className="tsugi-atmosphere-brand tsugi-brand-wordmark"><Trans>Tsugi</Trans></span>
  </div>;
}
