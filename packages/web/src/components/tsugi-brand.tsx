import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { BiHeadphone, BiBookOpen } from 'react-icons/bi';

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

/** Use the 24px outline family of the movie sidebar throughout Tsugi. */
export function TsugiMediaIcon({ area, className = '' }: { area: 'video' | 'music' | 'read'; className?: string }) {
  const classes = 'tsugi-media-icon ' + className;
  if (area === 'music') return <BiHeadphone aria-hidden="true" className={classes} />;
  if (area === 'read') return <BiBookOpen aria-hidden="true" className={classes} />;
  return <svg viewBox="0 0 24 24" aria-hidden="true" className={classes} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <path d="m10 9 5 3-5 3Z" fill="currentColor" stroke="none" />
  </svg>;
}

/** Adapters for the existing navigation components, which accept icon types. */
export function TsugiMusicIcon({ className }: { className?: string }) { return <TsugiMediaIcon area="music" className={className} />; }
export function TsugiReadIcon({ className }: { className?: string }) { return <TsugiMediaIcon area="read" className={className} />; }
