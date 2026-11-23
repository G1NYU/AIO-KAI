import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';

/**
 * Tsugi: two interlocking strokes represent connecting music and video addons.
 * An original SVG drawn in React, not a recycled upstream product icon.
 * Flat strokes remain legible as a 24px navigation mark.
 */
export function TsugiBrand({
  markOnly = false,
  className = '',
}: {
  markOnly?: boolean;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-3 ${className}`} aria-label={t`Tsugi`}>
      <svg viewBox="0 0 64 64" aria-hidden="true"
        className="size-9 shrink-0" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 39.5a14.5 14.5 0 0 1 0-20.5l8.4-8.4a14.5 14.5 0 0 1 20.5 20.5l-4.8 4.8"
          stroke="#BEDAF1" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M44 24.5a14.5 14.5 0 0 1 0 20.5l-8.4 8.4a14.5 14.5 0 0 1-20.5-20.5l4.8-4.8"
          stroke="#9E97D4" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {!markOnly && (
        <span className="text-xl font-semibold uppercase tracking-[0.21em] text-[#E8EBF5]">
          <Trans>Tsugi</Trans>
        </span>
      )}
    </span>
  );
}
