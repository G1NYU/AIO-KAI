import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';

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
        <path d="M22 44 C43 34 71 27 91 35 C113 43 118 63 108 83 C98 102 75 113 51 116 C72 102 92 85 95 67 C98 52 87 46 72 46 C59 46 45 50 32 59 C26 63 18 58 18 52 C18 49 19 47 22 44 Z"
          fill="var(--tsugi-ink, #CDD6F4)" />
      </svg>
      {!markOnly && (
        <span className="tsugi-brand-wordmark text-lg font-semibold tracking-[0.01em] text-[--tsugi-ink]">
          <Trans>Tsugi</Trans>
        </span>
      )}
    </span>
  );
}

/** Original filled glyphs. Negative space ties all three to the same grid. */
export function TsugiMediaIcon({ area, className = '' }: { area: 'video' | 'music' | 'read'; className?: string }) {
  return <svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true" className={`tsugi-media-icon ${className}`}>
    {area === 'video' ? <path fillRule="evenodd" d="M5 6h22a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3Zm8 4v12l8-6-8-6Z" />
      : area === 'music' ? <path fillRule="evenodd" d="M16 3a13 13 0 0 0-13 13v6a5 5 0 0 0 5 5h3V15H7a9 9 0 0 1 18 0h-4v12h3a5 5 0 0 0 5-5v-6A13 13 0 0 0 16 3Z" />
      : <path fillRule="evenodd" d="M5 4h9l2 2 2-2h9v23h-9l-2 2-2-2H5V4Zm3 4v16h6l2 1.5V9l-2-1H8Zm11 0v12l2-1.5 2 1.5V8h-4Z" />}
  </svg>;
}

/** Adapters for the existing navigation components, which accept icon types. */
export function TsugiMusicIcon({ className }: { className?: string }) { return <TsugiMediaIcon area="music" className={className} />; }
export function TsugiReadIcon({ className }: { className?: string }) { return <TsugiMediaIcon area="read" className={className} />; }
