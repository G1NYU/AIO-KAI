import { BrushHeart as FiHeart, BrushList as FiList, BrushLyrics as FiMessageSquare, BrushDisc as BiDisc } from '@/components/tsugi-icons';
import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';

import { VolumeControl } from './volume-control';
import { MusicArtwork } from './music-artwork';
import { PixelMatrix, type MatrixMode } from './pixel-matrix';
import { PlaybackQueue } from './playback-queue';

import type { MusicPlayerProps } from './player';
import { Timeline, Transport } from './player';
import type { PlayerPalette } from '@/lib/music/player-theme';
import { useTrackLyrics } from './use-track-lyrics';
import { LyricsPanel } from './lyrics-panel';
import { BrushHeading } from '@/components/brush-heading';
import { ListeningSpirit } from './player-visuals';

/** A responsive Tsugi composition; imported Studio templates use their own renderer. */
export function JunctionPlayer({
  p, palette, layout, matrixMode,
}: {
  p: MusicPlayerProps;
  palette: PlayerPalette;
  layout: 'default' | 'junction' | 'nocturne';
  matrixMode: MatrixMode;
}) {
  const song = p.track;
  const [queueOpen, setQueueOpen] = React.useState(false);
  const [lyricsOpen, setLyricsOpen] = React.useState(false);
  const lyrics = useTrackLyrics(song, p.sourceId ?? p.sourceName, p.mediaDuration, lyricsOpen);

  if (!song) return null;
  const next = p.queue[p.index + 1];
  return (
    <div data-ui="tsugi-junction" data-layout={layout} data-lyrics-open={lyricsOpen}
      className="tsugi-native-stage grid w-full flex-1 items-center">
      {layout === 'nocturne' && song.artworkURL && <div className="tsugi-nocturne-backdrop" aria-hidden="true"><MusicArtwork source={song.artworkURL} responsive className="size-full object-cover" /></div>}
      {matrixMode !== 'off' && <PixelMatrix mode={matrixMode} accent={palette.accent} paused={p.paused || p.loading || p.visible === false || !!p.error} analyser={p.analyser} nativeMeter={p.nativeMeter} />}
      <section className="tsugi-stage-artwork mx-auto flex w-full min-w-0 flex-col justify-center">
        <div className="relative isolate">
          {song.artworkURL
            ? <MusicArtwork source={song.artworkURL} responsive className="tsugi-junction-art aspect-square w-full object-cover" />
            : <span className="tsugi-junction-art flex aspect-square items-center justify-center"
                style={{ background: palette.panel, color:palette.muted }}>
                <BiDisc aria-hidden className="text-[clamp(4rem,9vw,8rem)]" />
              </span>}
          <ListeningSpirit />
        </div>
        <div className="mt-5 flex min-w-0 items-center justify-between gap-5 text-xs"
          style={{ color: palette.muted }}>
          <span className="truncate">{p.quality || p.sourceName}</span>
          {next && <span className="min-w-0 max-w-[60%] truncate text-right">
            <Trans>Up next</Trans> · {next.title}
          </span>}
        </div>
        {lyricsOpen && <div className="oto-lyrics-track"><p className="oto-overline">{song.album || p.sourceName}</p><BrushHeading as="h2">{song.title}</BrushHeading><p>{song.artist}</p></div>}
      </section>

      <section className="tsugi-junction-content relative flex min-w-0 flex-col justify-center">
        <header className="oto-listening-heading min-w-0">
          <p className="tsugi-eyebrow"><Trans>Now playing</Trans></p>
          {matrixMode !== 'off' && <p className="tsugi-matrix-label">{p.analyser || p.nativeMeterAvailable ? (matrixMode === 'wave' ? <Trans>Audio-reactive dot wave</Trans> : <Trans>Audio-reactive matrix</Trans>) : matrixMode === 'wave' ? (p.visualizerUnavailable ? <Trans>Audio visualization unavailable for this stream</Trans> : <Trans>Waiting for audio data</Trans>) : <Trans>Ambient matrix</Trans>}</p>}
          <BrushHeading className="tsugi-track-title mt-5 break-words text-[clamp(2.2rem,4.5vw,4.8rem)] font-semibold leading-[1.07] tracking-[-.055em]">
            {song.title}
          </BrushHeading>
          <p className="mt-4 text-xl font-medium" style={{color:palette.foreground}}>{song.artist}</p>
          <p className="mt-1 truncate text-sm" style={{color:palette.muted}}>{song.album ?? p.sourceName}</p>
        </header>

        <div className="tsugi-stage-lyrics" style={{color:palette.muted}}>
          {!lyricsOpen ? (
            <button type="button" className="text-left text-sm hover:underline"
              onClick={() => setLyricsOpen(true)}>
              <Trans>Show lyrics</Trans>
            </button>
          ) : <LyricsPanel state={lyrics} position={p.position} duration={p.duration} onSeek={p.onSeek} />}
        </div>

        <div className="oto-listening-transport space-y-5">
          <Timeline p={p} palette={palette} />
          <Transport p={p} palette={palette} large />
        </div>

        <div className="tsugi-stage-actions flex flex-wrap items-center justify-between gap-3 pt-4">
          <div className="flex items-center gap-1">
            <button type="button" className="tsugi-control flex size-11 items-center justify-center"
              aria-pressed={p.isFavorite} aria-label={t`Favorite`}
              disabled={!p.canFavorite} onClick={p.onFavorite}>
              <FiHeart aria-hidden className="text-lg" fill={p.isFavorite ? palette.accent : 'none'} />
            </button>
            <button type="button" className="tsugi-control flex size-11 items-center justify-center"
              aria-label={t`Lyrics`} aria-pressed={lyricsOpen}
              onClick={() => setLyricsOpen(!lyricsOpen)}>
              <FiMessageSquare aria-hidden className="text-lg" />
            </button>
            <button type="button" className="tsugi-control flex size-11 items-center justify-center"
              aria-label={t`Queue`} aria-expanded={queueOpen}
              onClick={() => setQueueOpen(!queueOpen)}>
              <FiList aria-hidden className="text-lg" />
            </button>
          </div>
          <VolumeControl value={p.volume} onChange={p.onVolume} />
        </div>

        {!lyricsOpen && next && <button type="button" className="oto-up-next" disabled={p.loading} onClick={() => p.onQueue(p.index + 1)}>
          {next.artworkURL ? <MusicArtwork source={next.artworkURL} target={160} className="oto-row-art" /> : <span className="oto-row-art oto-row-placeholder"><BiDisc aria-hidden /></span>}
          <span><small><Trans>Up next</Trans></small><strong>{next.title}</strong><span>{next.artist}</span></span>
          <FiList aria-hidden />
        </button>}

        {(p.loading || p.error) && (
          <p role={p.error ? 'alert' : 'status'} className="text-sm text-amber-200">
            {p.error || <Trans>Resolving audio…</Trans>}
          </p>
        )}
      </section>
      {queueOpen && <section className="tsugi-stage-queue" aria-label={t`Playback queue`}>
        <PlaybackQueue p={p} onClose={() => setQueueOpen(false)} />
      </section>}
    </div>
  );
}
