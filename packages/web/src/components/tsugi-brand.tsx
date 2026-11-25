import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { TsugiIcon } from './tsugi-icons';

/** Original brush-stroke つ (the opening sound of Tsugi), in a restrained seal. */
export function TsugiBrand({
  markOnly = false,
  className = '',
}: {
  markOnly?: boolean;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-3 ${className}`} aria-label={t`Tsugi`}>
      <svg viewBox="0 0 128 128" aria-hidden="true"
        className="size-9 shrink-0" xmlns="http://www.w3.org/2000/svg">
        <path d="M14 49C20 38 38 30 57 26C77 21 99 27 111 40C122 53 118 73 105 89C92 104 72 113 48 117L58 110L51 112C69 100 83 86 91 73C99 59 98 49 87 44C72 36 49 43 33 53L19 61L23 55L13 60L17 53ZM23 46C44 34 65 29 82 33C60 32 42 39 23 46ZM76 99C89 88 101 76 104 62C103 78 92 91 76 99ZM23 55L39 46L29 53Z"
          fillRule="evenodd" fill="var(--tsugi-ink, #CDD6F4)" />
      </svg>
      {!markOnly && (
        <span className="tsugi-brand-wordmark text-lg font-semibold tracking-[0.01em] text-[--tsugi-ink]">
          <Trans>Tsugi</Trans>
        </span>
      )}
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
