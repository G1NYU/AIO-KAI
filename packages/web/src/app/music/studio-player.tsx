import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { BiArrowBack, BiDisc, BiPause, BiPlay, BiSkipNext, BiSkipPrevious,
  BiShuffle, BiRepeat, BiListUl, BiVolumeFull, BiDotsHorizontalRounded,
  BiHeart, BiX, BiMessageSquareDetail } from 'react-icons/bi';
import type { MusicPlayerProps } from './player';
import type { EclipsePlayerTemplate, PlayerLayer } from '@/lib/music/player-template';
import type { PlayerPalette } from '@/lib/music/player-theme';
import { musicTime } from './player';
import { MusicArtwork } from './music-artwork';
import { lyricAt } from '@/lib/music/lyrics';
import { useTrackLyrics } from './use-track-lyrics';
import { LyricsPanel } from './lyrics-panel';
import { storage } from '@/lib/storage';

/** Render only known player controls, never foreign HTML or remote scripts. */
function stageColor(layer: PlayerLayer, palette: PlayerPalette): string {
  if (layer.hasTint) return layer.color;
  if (layer.kind === 'line') return palette.border;
  if (layer.kind === 'qualityBadge' || layer.kind === 'progressBar') return palette.accent;
  if (['elapsed', 'remaining', 'upNext', 'releaseInfo', 'albumName'].includes(layer.kind))
    return palette.muted;
  return palette.foreground;
}

export function EclipseStudioStage({
  p, template, palette, contained = false,
}: {
  p: MusicPlayerProps;
  template: EclipsePlayerTemplate;
  palette: PlayerPalette;
  contained?: boolean;
}) {
  const song = p.track;
  const [queueOpen, setQueueOpen] = React.useState(false);
  const [optionsOpen, setOptionsOpen] = React.useState(false);
  const [lyricsOpen, setLyricsOpen] = React.useState(false);
  const [timingPanel, setTimingPanel] = React.useState(false);
  const lyricsState = useTrackLyrics(song, p.sourceId ?? p.sourceName, p.mediaDuration, lyricsOpen);
  const { lyrics, busy: lyricsBusy, error: lyricsError } = lyricsState;
  const [favorite, setFavorite] = React.useState(false);
  const favoriteKey = p.sourceName + ':' + (song?.id ?? '');

  React.useEffect(() => {
    const saved = storage.get<string[]>('tsugi-local-favorites-v1');
    setFavorite(Array.isArray(saved) && saved.includes(favoriteKey));
  }, [favoriteKey]);

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
  const lyricIndex = lyricsState.synchronized && lyrics ? lyricAt(lyrics.synced, p.position, lyricsState.offset) : -1;

  function render(layer: PlayerLayer) {
    const song = p.track;
    if (!song) return null;
    switch (layer.kind) {
      case 'albumName':
        return <span className="block truncate">{song.album ?? ''}</span>;
      case 'text': {
        const label = layer.content || (layer.id === 'junction-2'
          ? t`TSUGI / JUNCTION` : layer.id === 'junction-4'
            ? t`NOW PLAYING / CONNECTED SOUND` : layer.id === 'junction-24'
              ? t`UP NEXT / YOUR QUEUE` : '');
        return <span className="block truncate"
          style={{ fontWeight: layer.weight === 'semibold' ? 600 : layer.weight === 'medium' ? 500 : layer.weight }}>
          {label}
        </span>;
      }
      case 'line':
        return <span aria-hidden className="block h-px w-full" style={{ backgroundColor: palette.border }} />;
      case 'releaseInfo':
        return <span className="block truncate text-xs">{[p.sourceName, song.album, p.quality].filter(Boolean).join(' · ')}</span>;
      case 'shuffle':
        return <button type="button" aria-label={t`Shuffle`} aria-pressed={p.shuffle}
          className="flex size-full items-center justify-center rounded-none hover:bg-white/10"
          onClick={() => p.onShuffle(!p.shuffle)}>
          <BiShuffle aria-hidden className="size-3/4" />
        </button>;
      case 'repeat':
        return <button type="button" aria-label={t`Repeat`} aria-pressed={p.repeat !== 'off'}
          className="flex size-full items-center justify-center rounded-none hover:bg-white/10"
          onClick={() => p.onRepeat(p.repeat === 'off' ? 'all' : p.repeat === 'all' ? 'one' : 'off')}>
          <BiRepeat aria-hidden className="size-3/4" />
          {p.repeat === 'one' && <span className="text-xs">1</span>}
        </button>;
      case 'volumeKnob':
        return <label className="flex w-full items-center gap-1" aria-label={t`Volume`}>
          <BiVolumeFull aria-hidden className="shrink-0 text-lg" />
          <input type="range" min={0} max={1} step={0.02} value={p.volume}
            onChange={(event) => p.onVolume(Number(event.target.value))}
            aria-label={t`Volume`} className="min-w-0 flex-1" style={{ accentColor: palette.accent }} />
        </label>;
      case 'favorite':
        return <button type="button" aria-label={t`Favorite`} aria-pressed={favorite}
          className="flex size-full items-center justify-center rounded-none hover:bg-white/10"
          onClick={toggleFavorite}>
          <BiHeart aria-hidden className="size-3/4" style={{ fill: favorite ? palette.accent : 'none' }} />
        </button>;
      case 'queue':
        return <button type="button" aria-label={t`Queue`} aria-expanded={queueOpen}
          className="flex size-full items-center justify-center rounded-none hover:bg-white/10"
          onClick={() => { setQueueOpen(!queueOpen); setOptionsOpen(false); }}>
          <BiListUl aria-hidden className="size-3/4" />
        </button>;
      case 'threeDotMenu':
        return <button type="button" aria-label={t`Player options`} aria-expanded={optionsOpen}
          className="flex size-full items-center justify-center rounded-none hover:bg-white/10"
          onClick={() => { setOptionsOpen(!optionsOpen); setQueueOpen(false); }}>
          <BiDotsHorizontalRounded aria-hidden className="size-3/4" />
        </button>;
      case 'lyrics':
        return <button type="button" aria-label={t`Lyrics`} aria-pressed={lyricsOpen}
          className="flex size-full items-center justify-center rounded-none hover:bg-white/10"
          onClick={() => setLyricsOpen(!lyricsOpen)}>
          <BiMessageSquareDetail aria-hidden className="size-3/4" />
        </button>;
      case 'lyricsInline':
        if (!lyricsOpen) return <button type="button" onClick={() => setLyricsOpen(true)}
            className="w-full text-center text-sm text-white/55 hover:text-white">
            <Trans>Show lyrics</Trans>
          </button>;
        if (lyricsBusy) return <span className="text-sm"><Trans>Loading lyrics…</Trans></span>;
        if (lyricsError) return <span className="text-xs">{lyricsError}</span>;
        if (lyricsState.synchronized && lyrics?.synced.length) {
          return <div className="flex w-full flex-col items-center gap-1 overflow-hidden text-center">
            <button type="button" className="text-xs" onClick={() => { lyricsState.showTiming(true); setTimingPanel(true); }}><Trans>Adjust lyrics timing</Trans></button>
            {lyrics.synced.slice(Math.max(0, lyricIndex), Math.max(0, lyricIndex) + 3).map((line, at) =>
              <span key={line.at} className={at === 0 && lyricIndex >= 0 ? 'block w-full truncate font-semibold' : 'block w-full truncate text-white/45'}>
                {line.text}
              </span>)}
          </div>;
        }
        if (lyrics?.plain.length) return <div className="w-full overflow-hidden text-center text-sm">
          {lyrics.synced.length > 0 && <button type="button" className="block w-full text-xs" onClick={() => { lyricsState.showTiming(true); setTimingPanel(true); }}><Trans>Timing unconfirmed · Adjust lyrics timing</Trans></button>}
          <span>{lyrics.plain.slice(0, 3).join(' · ')}</span>
        </div>;
        return <span className="text-center text-xs text-white/55"><Trans>No matching lyrics found.</Trans></span>;
      case 'artwork':
        return song.artworkURL
          ? <MusicArtwork source={song.artworkURL} responsive className="tsugi-studio-artwork size-full object-cover" />
          : <span className="flex size-full items-center justify-center bg-[#282138]">
              <BiDisc aria-hidden className="text-6xl" />
            </span>;
      case 'songTitle': return <span className="block truncate font-semibold tracking-tight">{song.title}</span>;
      case 'artistName': return <span className="block truncate">{song.artist}</span>;
      case 'elapsed': return <span>{musicTime(p.position)}</span>;
      case 'remaining': return <span>-{musicTime(Math.max(0, p.duration - p.position))}</span>;
      case 'qualityBadge': return p.quality
        ? <span className="truncate text-sm font-semibold uppercase">{p.quality}</span> : null;
      case 'upNext': return <span className="block truncate text-xs">
        {p.queue[p.index + 1]
          ? p.queue[p.index + 1].artist + ' · ' + p.queue[p.index + 1].title
          : ''}
      </span>;
      case 'progressBar':
        return <input aria-label={t`Seek position`} type="range"
          min={0} max={time} step={0.1} value={Math.min(time, p.position)}
          onChange={(e) => p.onSeek(Number(e.target.value))}
          className="w-full cursor-pointer" style={{ accentColor: palette.accent }} />;
      case 'playPause':
        return <button type="button" disabled={p.loading} onClick={p.onToggle}
          aria-label={p.paused ? t`Play` : t`Pause`}
          className="flex size-full items-center justify-center rounded-none hover:bg-white/10">
          {p.paused ? <BiPlay aria-hidden className="size-3/4" /> : <BiPause aria-hidden className="size-3/4" />}
        </button>;
      case 'previous':
        return <button type="button" onClick={p.onPrevious} aria-label={t`Previous track`}
          className="flex size-full items-center justify-center rounded-none hover:bg-white/10">
          <BiSkipPrevious aria-hidden className="size-3/4" />
        </button>;
      case 'next':
        return <button type="button" onClick={() => p.onNext()} aria-label={t`Next track`}
          className="flex size-full items-center justify-center rounded-none hover:bg-white/10">
          <BiSkipNext aria-hidden className="size-3/4" />
        </button>;
      case 'close':
        return <button type="button" onClick={() => p.onExpanded(false)} aria-label={t`Close player`}
          className="flex size-full items-center justify-center rounded-none hover:bg-white/10">
          <BiArrowBack aria-hidden className="size-3/4" />
        </button>;
      default:
        return null;
    }
  }
  return (
    <div data-ui="tsugi-studio-viewport"
      data-size={contained ? 'contained' : 'full'}
      className={contained
        ? 'relative mx-auto aspect-video w-full max-w-[min(94vw,calc((100dvh-120px)*1.777778))] overflow-hidden'
        : 'fixed inset-0 h-dvh w-screen overflow-hidden'}>
      <div data-ui="tsugi-studio-stage" className="relative h-full w-full overflow-hidden"
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
              color: stageColor(layer, palette),
              fontSize: 'clamp(11px, ' + layer.fontSize / 19.2 + 'cqw, ' + layer.fontSize * 1.2 + 'px)',
              textAlign: layer.align,
            }}>
            <div className="flex size-full min-w-0 items-center justify-center">{render(layer)}</div>
          </div>
        ))}
        {queueOpen && (
          <aside aria-label={t`Up next`}
            className="tsugi-junction-secondary absolute inset-y-[10%] right-[4%] z-20 w-[min(390px,39%)] overflow-y-auto p-4" style={{backgroundColor:palette.panel,borderColor:palette.border,color:palette.foreground}}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-bold"><Trans>Up next</Trans> · {p.queue.length}</h3>
              <button type="button" aria-label={t`Close queue`} onClick={() => setQueueOpen(false)}
                className="rounded-none p-2 hover:bg-white/10"><BiX aria-hidden /></button>
            </div>
            <ol className="space-y-1">
              {p.queue.map((item, index) => (
                <li key={item.id + ':' + index}>
                  <button type="button" onClick={() => p.onQueue(index)}
                    aria-current={index === p.index ? 'true' : undefined}
                    className={index === p.index
                      ? 'w-full rounded-none bg-white/15 px-3 py-2 text-left text-xs'
                      : 'w-full rounded-none px-3 py-2 text-left text-xs hover:bg-white/10'}>
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
            className="tsugi-junction-secondary absolute right-[4%] top-[12%] z-30 w-52 space-y-1 p-3" style={{backgroundColor:palette.panel,borderColor:palette.border,color:palette.foreground}}>
            <button type="button" onClick={() => { setQueueOpen(true); setOptionsOpen(false); }}
              className="block w-full rounded-none px-3 py-2 text-left text-xs hover:bg-white/10"><Trans>Show queue</Trans></button>
            <button type="button" onClick={() => { setLyricsOpen(true); setOptionsOpen(false); }}
              className="block w-full rounded-none px-3 py-2 text-left text-xs hover:bg-white/10"><Trans>Show lyrics</Trans></button>
            <button type="button" onClick={() => { setLyricsOpen(true); setTimingPanel(true); setOptionsOpen(false); }}
              className="block w-full rounded-none px-3 py-2 text-left text-xs hover:bg-white/10"><Trans>Adjust lyrics timing</Trans></button>
            <button type="button" onClick={() => setOptionsOpen(false)}
              className="block w-full rounded-none px-3 py-2 text-left text-xs hover:bg-white/10"><Trans>Close menu</Trans></button>
          </section>
        )}
        {lyricsOpen && timingPanel && <aside className="tsugi-studio-lyrics-timing" aria-label={t`Lyrics timing`}>
          <button type="button" onClick={() => setTimingPanel(false)}><Trans>Close lyrics timing</Trans></button>
          <LyricsPanel state={lyricsState} position={p.position} duration={p.duration} onSeek={p.onSeek} />
        </aside>}
      </div>
      {template.skippedLayers > 0 && (
        <details className="mx-auto mt-1 w-fit text-center text-xs text-white/35">
          <summary className="cursor-pointer rounded-none px-2 py-1 hover:text-white/70">
            <Trans>Studio compatibility</Trans>
          </summary>
          <p className="pb-2">
            <Trans>{skippedCount} unsupported or hidden Eclipse Studio layers are omitted.</Trans>
          </p>
        </details>
      )}
    </div>
  );
}
