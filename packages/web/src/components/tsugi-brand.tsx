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
    {area === 'video' ? <path fillRule="evenodd" d="M3 5h26v22H3V5Zm3 3v3h3V8H6Zm0 13v3h3v-3H6Zm17-13v3h3V8h-3Zm0 13v3h3v-3h-3Zm-11 0 9-5-9-5v10Z" />
      : area === 'music' ? <path d="M5 10h4v12H5zM11 5h4v22h-4zM17 8h4v16h-4zM23 13h4v6h-4z" />
      : <path d="M3 5c5.8 0 9.2 1.6 12 4.1V28c-3.1-2.8-7-4.1-12-4.1V5Zm26 0c-5.8 0-9.2 1.6-12 4.1V28c3.1-2.8 7-4.1 12-4.1V5Z" />}
  </svg>;
}

/** Adapters for the existing navigation components, which accept icon types. */
export function TsugiMusicIcon({ className }: { className?: string }) { return <TsugiMediaIcon area="music" className={className} />; }
export function TsugiReadIcon({ className }: { className?: string }) { return <TsugiMediaIcon area="read" className={className} />; }
