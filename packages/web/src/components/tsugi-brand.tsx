import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';

/** Two precise interlocking pieces: flat geometry, no decorative container. */
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
        <path d="M9 10H40V22H23V42H9V10Z"
          stroke="#BED8E5" strokeWidth="5" strokeLinejoin="miter" />
        <path d="M55 54H24V42H41V22H55V54Z"
          stroke="#9DA8B7" strokeWidth="5" strokeLinejoin="miter" />
      </svg>
      {!markOnly && (
        <span className="text-xl font-semibold uppercase tracking-[0.17em] text-[#E8EDF0]">
          <Trans>Tsugi</Trans>
        </span>
      )}
    </span>
  );
}
