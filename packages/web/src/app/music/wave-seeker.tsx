import { t } from '@lingui/core/macro';
import type { PlayerPalette } from '@/lib/music/player-theme';

type Props = {
  position: number;
  duration: number;
  paused: boolean;
  palette: PlayerPalette;
  onSeek(seconds: number): void;
};

// Two fixed-pitch rows of circular dots. The played region alone moves;
// the native range control remains the accessible interaction surface.
export function DotSeeker({ position, duration, paused, palette, onSeek }: Props) {
  const available = Number.isFinite(duration) && duration > 0;
  const max = available ? duration : 1;
  const value = available && Number.isFinite(position) ? Math.min(max, Math.max(0, position)) : 0;
  const progress = (value / max) * 100;
  return (
    <div className="tsugi-dot-seeker relative flex h-6 min-w-0 flex-1 items-center">
      <span aria-hidden className="tsugi-dot-track" style={{color:palette.muted}} />
      <span aria-hidden className="tsugi-dot-track tsugi-dot-played"
        style={{color:palette.accent, width: `${progress}%`}}
        data-playing={!paused && available ? 'true' : 'false'} />
      <input type="range" min={0} max={max} step={0.1} value={value}
        disabled={!available} onChange={(event) => onSeek(Number(event.target.value))}
        aria-label={t`Seek position`}
        className="tsugi-dot-input absolute inset-0 h-full w-full cursor-pointer" />
    </div>
  );
}
