import { BrushClose, BrushDisc } from '@/components/tsugi-icons';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type React from 'react';
import type { MusicPlayerProps } from './player';
import { MusicArtwork } from './music-artwork';
import { QueueControls, ClearUpcoming } from './queue-controls';

export function PlaybackQueue({ p, onSelect, onClose }: {
  p: MusicPlayerProps;
  onSelect?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onClose?: () => void;
}) {
  return <>
    <div className="tsugi-queue-heading">
      <div><h2><Trans>Playback queue</Trans></h2><small className="text-[--tsugi-muted]">{p.queue.length} <Trans>tracks</Trans></small></div>
      <ClearUpcoming p={p} />
      {onClose && <button type="button" aria-label={t`Close queue`} className="tsugi-control flex size-9 items-center justify-center" onClick={onClose}><BrushClose aria-hidden /></button>}
    </div>
    <ol className="tsugi-queue-list">
      {p.queue.map((item, at) => {
        const current = at === p.index;
        const duration = item.duration;
        return <li key={item.id + ':' + at} data-current={current}>
          <button type="button" className="tsugi-queue-track" aria-current={current ? 'true' : undefined} disabled={p.loading}
            onClick={event => { p.onQueue(at); onSelect?.(event); }}>
            <span className="tsugi-mini-queue-number">{at + 1}</span>
            {item.artworkURL ? <MusicArtwork source={item.artworkURL} target={160} loading="lazy" className="tsugi-queue-art" /> : <span className="tsugi-queue-art"><BrushDisc aria-hidden /></span>}
            <span className="min-w-0">
              <strong className="block truncate">{item.title}</strong>
              <small className="block truncate">{item.artist}</small>
              <small className="block">{current ? <Trans>Now playing</Trans> : at < p.index ? <Trans>Played</Trans> : <Trans>Up next</Trans>}</small>
            </span>
            {typeof duration === 'number' && Number.isFinite(duration) && duration > 0 && <span className="tsugi-queue-duration tabular-nums">{Math.floor(duration / 60)}:{String(Math.floor(duration % 60)).padStart(2, '0')}</span>}
          </button>
          <QueueControls p={p} at={at} />
        </li>;
      })}
    </ol>
  </>;
}
