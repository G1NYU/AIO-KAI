import { t } from '@lingui/core/macro';
import { BiArrowBack, BiDisc, BiPause, BiPlay, BiSkipNext, BiSkipPrevious } from 'react-icons/bi';
import type { MusicPlayerProps } from './player';
import type { EclipsePlayerTemplate, PlayerLayer } from '@/lib/music/player-template';
import { musicTime } from './player';

/** Render only known player controls, never foreign HTML or remote scripts. */
export function EclipseStudioStage({
  p, template,
}: {
  p: MusicPlayerProps;
  template: EclipsePlayerTemplate;
}) {
  const song = p.track;
  if (!song) return null;
  const time = Math.max(1, p.duration);
  function render(layer: PlayerLayer) {
    switch (layer.kind) {
      case 'artwork':
        return song.artworkURL
          ? <img src={song.artworkURL} alt="" draggable={false} referrerPolicy="no-referrer"
              className="size-full rounded-lg object-cover shadow-2xl" />
          : <span className="flex size-full items-center justify-center bg-[#282138]">
              <BiDisc aria-hidden className="text-6xl" />
            </span>;
      case 'songTitle': return <span className="block truncate font-bold">{song.title}</span>;
      case 'artistName': return <span className="block truncate">{song.artist}</span>;
      case 'elapsed': return <span>{musicTime(p.position)}</span>;
      case 'remaining': return <span>-{musicTime(Math.max(0, p.duration - p.position))}</span>;
      case 'qualityBadge': return p.quality
        ? <span className="truncate text-sm font-bold uppercase">{p.quality}</span> : null;
      case 'upNext': return <span className="block truncate text-xs">
        {p.queue[p.index + 1]
          ? p.queue[p.index + 1].artist + ' · ' + p.queue[p.index + 1].title
          : ''}
      </span>;
      case 'progressBar':
        return <input aria-label={t`Seek position`} type="range"
          min={0} max={time} step={0.1} value={Math.min(time, p.position)}
          onChange={(e) => p.onSeek(Number(e.target.value))}
          className="w-full cursor-pointer accent-violet-200" />;
      case 'playPause':
        return <button type="button" disabled={p.loading} onClick={p.onToggle}
          aria-label={p.paused ? t`Play` : t`Pause`}
          className="flex size-full items-center justify-center rounded-full hover:bg-white/10">
          {p.paused ? <BiPlay aria-hidden className="size-3/4" /> : <BiPause aria-hidden className="size-3/4" />}
        </button>;
      case 'previous':
        return <button type="button" onClick={p.onPrevious} aria-label={t`Previous track`}
          className="flex size-full items-center justify-center rounded-full hover:bg-white/10">
          <BiSkipPrevious aria-hidden className="size-3/4" />
        </button>;
      case 'next':
        return <button type="button" onClick={() => p.onNext()} aria-label={t`Next track`}
          className="flex size-full items-center justify-center rounded-full hover:bg-white/10">
          <BiSkipNext aria-hidden className="size-3/4" />
        </button>;
      case 'close':
        return <button type="button" onClick={() => p.onExpanded(false)} aria-label={t`Close player`}
          className="flex size-full items-center justify-center rounded-full hover:bg-white/10">
          <BiArrowBack aria-hidden className="size-3/4" />
        </button>;
    }
  }
  return (
    <div className="mx-auto w-full max-w-[1480px] py-5">
      <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-white/10"
        style={{ backgroundColor: template.background }}>
        {template.layers.map((layer) => (
          <div key={layer.id} className="absolute flex items-center justify-center"
            style={{
              left: layer.x * 100 + '%',
              top: layer.y * 100 + '%',
              width: layer.width * 100 + '%',
              height: layer.height * 100 + '%',
              transform: 'translate(-50%, -50%)',
              opacity: layer.opacity,
              color: layer.color,
              fontSize: 'clamp(10px, ' + layer.fontSize / 14 + 'vw, ' + layer.fontSize + 'px)',
              textAlign: layer.align,
            }}>
            <div className="w-full">{render(layer)}</div>
          </div>
        ))}
      </div>
      {template.skippedLayers > 0 && (
        <p className="mt-3 text-center text-xs text-white/40">
          {template.skippedLayers} unsupported or hidden Eclipse Studio layers are omitted.
        </p>
      )}
    </div>
  );
}
