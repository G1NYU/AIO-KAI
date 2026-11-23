import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { BiArrowBack, BiDisc, BiPause, BiPlay, BiSkipNext, BiSkipPrevious,
  BiShuffle, BiRepeat, BiListUl, BiVolumeFull, BiDotsHorizontalRounded,
  BiHeart, BiX, BiMessageSquareDetail } from 'react-icons/bi';
import type { MusicPlayerProps } from './player';
import type { EclipsePlayerTemplate, PlayerLayer } from '@/lib/music/player-template';
import { musicTime } from './player';
import { fetchTrackLyrics, lyricAt, type TrackLyrics } from '@/lib/music/lyrics';
import { storage } from '@/lib/storage';

/** Render only known player controls, never foreign HTML or remote scripts. */
export function EclipseStudioStage({
  p, template,
}: {
  p: MusicPlayerProps;
  template: EclipsePlayerTemplate;
}) {
  const song = p.track;
  const [queueOpen, setQueueOpen] = React.useState(false);
  const [optionsOpen, setOptionsOpen] = React.useState(false);
  const [lyricsOpen, setLyricsOpen] = React.useState(false);
  const [lyrics, setLyrics] = React.useState<TrackLyrics | null>(null);
  const [lyricsBusy, setLyricsBusy] = React.useState(false);
  const [lyricsError, setLyricsError] = React.useState('');
  const [favorite, setFavorite] = React.useState(false);
  const favoriteKey = p.sourceName + ':' + (song?.id ?? '');

  React.useEffect(() => {
    const saved = storage.get<string[]>('tsugi-local-favorites-v1');
    setFavorite(Array.isArray(saved) && saved.includes(favoriteKey));
  }, [favoriteKey]);

  React.useEffect(() => {
    setLyrics(null);
    setLyricsError('');
    if (!lyricsOpen || !song) return;
    const controller = new AbortController();
    setLyricsBusy(true);
    fetchTrackLyrics(song, controller.signal).then((value) => {
      if (!controller.signal.aborted) setLyrics(value);
    }).catch(() => {
      if (!controller.signal.aborted) setLyricsError(t`Lyrics are temporarily unavailable.`);
    }).finally(() => {
      if (!controller.signal.aborted) setLyricsBusy(false);
    });
    return () => controller.abort();
  }, [lyricsOpen, song]);

  function toggleFavorite() {
    const saved = storage.get<string[]>('tsugi-local-favorites-v1');
    const entries = Array.isArray(saved) ? saved.filter((v): v is string => typeof v === 'string') : [];
    const next = favorite ? entries.filter((v) => v !== favoriteKey) : [...entries.filter((v) => v !== favoriteKey), favoriteKey];
    storage.set('tsugi-local-favorites-v1', next.slice(-500));
    setFavorite(!favorite);
  }

  if (!song) return null;
  const time = Math.max(1, p.duration);
  const skippedCount = template.skippedLayers;
  const lyricIndex = lyrics ? lyricAt(lyrics.synced, p.position) : -1;

  function render(layer: PlayerLayer) {
    const song = p.track;
    if (!song) return null;
    switch (layer.kind) {
      case 'albumName':
        return <span className="block truncate">{song.album ?? ''}</span>;
      case 'text':
        return <span className="block truncate" style={{ fontWeight: layer.weight === 'semibold' ? 600 : layer.weight }}>{layer.content}</span>;
      case 'line':
        return <span aria-hidden className="block h-px w-full" style={{ backgroundColor: layer.color }} />;
      case 'releaseInfo':
        return <span className="block truncate text-xs">{[p.sourceName, song.album, p.quality].filter(Boolean).join(' · ')}</span>;
      case 'shuffle':
        return <button type="button" aria-label={t`Shuffle`} aria-pressed={p.shuffle}
          className="flex size-full items-center justify-center rounded-full hover:bg-white/10"
          onClick={() => p.onShuffle(!p.shuffle)}>
          <BiShuffle aria-hidden className="size-3/4" />
        </button>;
      case 'repeat':
        return <button type="button" aria-label={t`Repeat`} aria-pressed={p.repeat !== 'off'}
          className="flex size-full items-center justify-center rounded-full hover:bg-white/10"
          onClick={() => p.onRepeat(p.repeat === 'off' ? 'all' : p.repeat === 'all' ? 'one' : 'off')}>
          <BiRepeat aria-hidden className="size-3/4" />
          {p.repeat === 'one' && <span className="text-xs">1</span>}
        </button>;
      case 'volumeKnob':
        return <label className="flex w-full items-center gap-1" aria-label={t`Volume`}>
          <BiVolumeFull aria-hidden className="shrink-0 text-lg" />
          <input type="range" min={0} max={1} step={0.02} value={p.volume}
            onChange={(event) => p.onVolume(Number(event.target.value))}
            aria-label={t`Volume`} className="min-w-0 flex-1 accent-current" />
        </label>;
      case 'favorite':
        return <button type="button" aria-label={t`Favorite`} aria-pressed={favorite}
          className="flex size-full items-center justify-center rounded-full hover:bg-white/10"
          onClick={toggleFavorite}>
          <BiHeart aria-hidden className="size-3/4" style={{ fill: favorite ? layer.color : 'none' }} />
        </button>;
      case 'queue':
        return <button type="button" aria-label={t`Queue`} aria-expanded={queueOpen}
          className="flex size-full items-center justify-center rounded-full hover:bg-white/10"
          onClick={() => { setQueueOpen(!queueOpen); setOptionsOpen(false); }}>
          <BiListUl aria-hidden className="size-3/4" />
        </button>;
      case 'threeDotMenu':
        return <button type="button" aria-label={t`Player options`} aria-expanded={optionsOpen}
          className="flex size-full items-center justify-center rounded-full hover:bg-white/10"
          onClick={() => { setOptionsOpen(!optionsOpen); setQueueOpen(false); }}>
          <BiDotsHorizontalRounded aria-hidden className="size-3/4" />
        </button>;
      case 'lyrics':
        return <button type="button" aria-label={t`Lyrics`} aria-pressed={lyricsOpen}
          className="flex size-full items-center justify-center rounded-full hover:bg-white/10"
          onClick={() => setLyricsOpen(!lyricsOpen)}>
          <BiMessageSquareDetail aria-hidden className="size-3/4" />
        </button>;
      case 'lyricsInline':
        if (!lyricsOpen) return <button type="button" onClick={() => setLyricsOpen(true)}
            className="w-full text-center text-sm text-white/55 hover:text-white">
            <Trans>Show synchronized lyrics</Trans>
          </button>;
        if (lyricsBusy) return <span className="text-sm"><Trans>Loading lyrics…</Trans></span>;
        if (lyricsError) return <span className="text-xs">{lyricsError}</span>;
        if (lyrics?.synced.length) {
          return <div className="flex w-full flex-col items-center gap-1 overflow-hidden text-center">
            {lyrics.synced.slice(Math.max(0, lyricIndex), Math.max(0, lyricIndex) + 3).map((line, at) =>
              <span key={line.at} className={at === 0 ? 'block w-full truncate font-semibold' : 'block w-full truncate text-white/45'}>
                {line.text}
              </span>)}
          </div>;
        }
        if (lyrics?.plain.length) return <span className="block max-h-full overflow-hidden text-center text-sm">{lyrics.plain.slice(0, 3).join(' · ')}</span>;
        return <span className="text-center text-xs text-white/55"><Trans>No matching lyrics found.</Trans></span>;
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
      default:
        return null;
    }
  }
  return (
    <div className="mx-auto w-full max-w-[1740px] py-3">
      <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-white/10"
        style={{ backgroundColor: template.background, containerType: 'inline-size' }}>
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
              fontSize: 'clamp(9px, ' + layer.fontSize / 19.2 + 'cqw, ' + layer.fontSize + 'px)',
              textAlign: layer.align,
            }}>
            <div className="flex size-full min-w-0 items-center justify-center">{render(layer)}</div>
          </div>
        ))}
        {queueOpen && (
          <aside aria-label={t`Up next`}
            className="absolute inset-y-[10%] right-[4%] z-20 w-[min(390px,39%)] overflow-y-auto rounded-2xl border border-white/15 bg-[#161722] p-4 text-white shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-bold"><Trans>Up next</Trans> · {p.queue.length}</h3>
              <button type="button" aria-label={t`Close queue`} onClick={() => setQueueOpen(false)}
                className="rounded-full p-2 hover:bg-white/10"><BiX aria-hidden /></button>
            </div>
            <ol className="space-y-1">
              {p.queue.map((item, index) => (
                <li key={item.id + ':' + index}>
                  <button type="button" onClick={() => p.onQueue(index)}
                    aria-current={index === p.index ? 'true' : undefined}
                    className={index === p.index
                      ? 'w-full rounded-lg bg-white/15 px-3 py-2 text-left text-xs'
                      : 'w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-white/10'}>
                    <span className="block truncate font-semibold">{item.title}</span>
                    <span className="block truncate text-white/50">{item.artist}</span>
                  </button>
                </li>
              ))}
            </ol>
          </aside>
        )}
        {optionsOpen && (
          <section aria-label={t`Player options`}
            className="absolute right-[4%] top-[12%] z-30 w-52 space-y-1 rounded-xl border border-white/15 bg-[#191c28] p-3 text-white shadow-xl">
            <button type="button" onClick={() => { setQueueOpen(true); setOptionsOpen(false); }}
              className="block w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-white/10"><Trans>Show queue</Trans></button>
            <button type="button" onClick={() => { setLyricsOpen(true); setOptionsOpen(false); }}
              className="block w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-white/10"><Trans>Show lyrics</Trans></button>
            <button type="button" onClick={() => setOptionsOpen(false)}
              className="block w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-white/10"><Trans>Close menu</Trans></button>
          </section>
        )}
      </div>
      {template.skippedLayers > 0 && (
        <p className="mt-3 text-center text-xs text-white/40">
          <Trans>{skippedCount} unsupported or hidden Eclipse Studio layers are omitted.</Trans>
        </p>
      )}
    </div>
  );
}
