import React from 'react';
import { t } from '@lingui/core/macro';
import type { PlayerPalette } from '@/lib/music/player-theme';

type Props = {
  position: number;
  duration: number;
  paused: boolean;
  palette: PlayerPalette;
  onSeek(seconds: number): void;
};

// A continuous repeating sine-like stroke; no audio capture or animation timers.
const WAVE = (() => {
  // eslint-disable-next-line lingui/no-unlocalized-strings -- SVG path coordinates, not UI copy.
  let path = 'M -64 16';
  for (let i = 0; i < 82; i++) {
    const x = -64 + i * 16;
    // eslint-disable-next-line lingui/no-unlocalized-strings -- SVG path coordinates, not UI copy.
    path += ` Q ${x + 8} ${i % 2 ? 23 : 9} ${x + 16} 16`;
  }
  return path;
})();

export function WaveSeeker({ position, duration, paused, palette, onSeek }: Props) {
  const id = React.useId().replace(/:/g, '');
  const max = Number.isFinite(duration) && duration > 0 ? duration : 1;
  const value = Number.isFinite(position) ? Math.min(max, Math.max(0, position)) : 0;
  const progress = (value / max) * 1000;
  return (
    <div className="tsugi-wave-seeker relative flex h-9 min-w-0 flex-1 items-center">
      <svg viewBox="0 0 1000 32" preserveAspectRatio="none" aria-hidden
        className="tsugi-wave-art pointer-events-none h-8 w-full overflow-hidden">
        <defs>
          <clipPath id={id}>
            <rect x="0" y="0" width={progress} height="32" />
          </clipPath>
        </defs>
        <path d="M 0 16 H 1000" stroke={palette.border} strokeWidth="2"
          vectorEffect="non-scaling-stroke" fill="none" />
        <g clipPath={`url(#${id})`}>
          <path d={WAVE} stroke={palette.accent} strokeWidth="2.6"
            vectorEffect="non-scaling-stroke" fill="none"
            className={!paused && duration > 0 ? 'tsugi-wave-live' : undefined} />
        </g>
      </svg>
      <input type="range" min={0} max={max} step={0.1} value={value}
        disabled={duration <= 0} onChange={(event) => onSeek(Number(event.target.value))}
        aria-label={t`Seek position`}
        className="tsugi-wave-input absolute inset-0 h-full w-full cursor-pointer" />
    </div>
  );
}
