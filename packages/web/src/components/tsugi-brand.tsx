import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { TsugiIcon } from './tsugi-icons';

/** Keep the original bundled Tsugi lettering without the former brush seal. */
export function TsugiBrand({
  className = '',
}: {
  /** Legacy callers receive the lettering too, never the removed seal. */
  markOnly?: boolean;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center justify-center ${className}`} data-ui="tsugi-brand" aria-label={t`Tsugi`}>
      <span className="tsugi-brand-wordmark text-lg font-semibold tracking-[0.01em] text-[--tsugi-ink]">
        <Trans>Tsugi</Trans>
      </span>
    </span>
  );
}

/** Use the 24px outline family of the movie sidebar throughout Tsugi. */
export function TsugiMediaIcon({ area, className = '' }: { area: 'video' | 'music' | 'read' | 'vault'; className?: string }) {
  return <TsugiIcon name={area === 'read' ? 'book' : area} className={'tsugi-media-icon ' + className} />;
}

/** Adapters for the existing navigation components, which accept icon types. */
export function TsugiMusicIcon({ className }: { className?: string }) { return <TsugiMediaIcon area="music" className={className} />; }
export function TsugiReadIcon({ className }: { className?: string }) { return <TsugiMediaIcon area="read" className={className} />; }

export function TsugiVaultIcon({ className }: { className?: string }) { return <TsugiMediaIcon area="vault" className={className} />; }
