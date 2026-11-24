import React from 'react';
import { t } from '@lingui/core/macro';
import { FiVolume2, FiVolumeX } from 'react-icons/fi';

/** One consistent mute/level control for the compact dock and immersive player. */
export function VolumeControl({
  value, onChange, compact = false,
}: {
  value: number;
  onChange(next: number): void;
  compact?: boolean;
}) {
  const prior = React.useRef(0.7);
  const mute = value <= 0.001;
  function toggle() {
    if (!mute) {
      prior.current = value;
      onChange(0);
    } else {
      onChange(prior.current > 0 ? prior.current : 0.7);
    }
  }
  return (
    <div data-ui="tsugi-volume" className={`tsugi-volume flex items-center gap-3 ${compact ? 'tsugi-volume-compact' : ''}`}>
      <button type="button" className="tsugi-control flex size-9 shrink-0 items-center justify-center"
        onClick={toggle} aria-label={mute ? t`Unmute` : t`Mute`}>
        {mute ? <FiVolumeX aria-hidden className="text-lg" />
          : <FiVolume2 aria-hidden className="text-lg" />}
      </button>
      <input type="range" min={0} max={1} step={0.01} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={t`Volume`} aria-valuetext={`${Math.round(value * 100)}%`}
        style={{ '--tsugi-level': `${value * 100}%` } as React.CSSProperties}
        className="tsugi-volume-range w-28 sm:w-36" />
    </div>
  );
}
