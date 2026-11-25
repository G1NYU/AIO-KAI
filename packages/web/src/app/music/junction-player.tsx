import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { FiHeart, FiList, FiMessageSquare, FiX } from 'react-icons/fi';
import { VolumeControl } from './volume-control';
import { MusicArtwork } from './music-artwork';
import { BiDisc } from 'react-icons/bi';
import type { MusicPlayerProps } from './player';
import { Timeline, Transport } from './player';
import type { PlayerPalette } from '@/lib/music/player-theme';
import { fetchTrackLyrics, lyricAt, type TrackLyrics } from '@/lib/music/lyrics';

/** A responsive Tsugi composition; imported Studio templates use their own renderer. */
export function JunctionPlayer({
  p, palette, layout,
}: {
  p: MusicPlayerProps;
  palette: PlayerPalette;
  layout: 'default' | 'junction' | 'nocturne';
}) {
  const song = p.track;
  const [queueOpen, setQueueOpen] = React.useState(false);
  const [lyricsOpen, setLyricsOpen] = React.useState(false);
  const [lyrics, setLyrics] = React.useState<TrackLyrics | null>(null);
  const [lyricsBusy, setLyricsBusy] = React.useState(false);
  const [lyricsError, setLyricsError] = React.useState('');
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

  if (!song) return null;
  const next = p.queue[p.index + 1];
  const lyricIndex = lyrics ? lyricAt(lyrics.synced, p.position) : -1;
  return (
    <div data-ui="tsugi-junction" data-layout={layout}
      className="tsugi-native-stage grid w-full flex-1 items-center">
      {layout === 'nocturne' && song.artworkURL && <div className="tsugi-nocturne-backdrop" aria-hidden="true"><MusicArtwork source={song.artworkURL} className="size-full object-cover" /></div>}
      <section className="tsugi-stage-artwork mx-auto flex w-full min-w-0 flex-col justify-center">
        <div className="relative isolate">
          {song.artworkURL
            ? <MusicArtwork source={song.artworkURL} className="tsugi-junction-art aspect-square w-full object-cover" />
            : <span className="tsugi-junction-art flex aspect-square items-center justify-center"
                style={{ background: palette.panel, color:palette.muted }}>
                <BiDisc aria-hidden className="text-[clamp(4rem,9vw,8rem)]" />
              </span>}
        </div>
        <div className="mt-5 flex min-w-0 items-center justify-between gap-5 text-xs"
          style={{ color: palette.muted }}>
          <span className="truncate">{p.quality || p.sourceName}</span>
          {next && <span className="min-w-0 max-w-[60%] truncate text-right">
            <Trans>Up next</Trans> · {next.title}
          </span>}
        </div>
      </section>

      <section className="tsugi-junction-content relative flex min-w-0 flex-col justify-center">
        <header className="min-w-0">
          <p className="tsugi-eyebrow"><Trans>Now playing</Trans></p>
          <h1 className="tsugi-track-title mt-5 break-words text-[clamp(2.2rem,4.5vw,4.8rem)] font-semibold leading-[1.07] tracking-[-.055em]">
            {song.title}
          </h1>
          <p className="mt-4 text-xl font-medium" style={{color:palette.foreground}}>{song.artist}</p>
          <p className="mt-1 truncate text-sm" style={{color:palette.muted}}>{song.album ?? p.sourceName}</p>
        </header>

        <div className="tsugi-stage-lyrics" style={{color:palette.muted}}>
          {!lyricsOpen ? (
            <button type="button" className="text-left text-sm hover:underline"
              onClick={() => setLyricsOpen(true)}>
              <Trans>Show synchronized lyrics</Trans>
            </button>
          ) : lyricsBusy ? <p className="text-sm"><Trans>Loading lyrics…</Trans></p>
            : lyricsError ? <p role="status" className="text-sm">{lyricsError}</p>
            : lyrics?.synced.length ? (
              <div className="tsugi-stage-lyric-lines space-y-2" aria-label={t`Lyrics`}>
                {lyrics.synced.slice(Math.max(0,lyricIndex),Math.max(0,lyricIndex)+(layout === 'nocturne' ? 5 : 2)).map((line,at) =>
                  <button key={line.at + ':' + at} type="button" onClick={() => p.onSeek(line.at)}
                    aria-current={lyricIndex >= 0 && at === 0 ? 'true' : undefined}
                    className={at === 0 ? 'block text-start text-lg font-medium' : 'block text-start text-sm opacity-60'}>
                    {line.text}
                  </button>)}
              </div>
            ) : lyrics?.plain.length ? <div className="tsugi-stage-plain-lyrics text-sm">{lyrics.plain.map((line,at) => <p key={at}>{line}</p>)}</div>
            : <p className="text-sm"><Trans>No matching lyrics found.</Trans></p>}
        </div>

        <div className="space-y-5">
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

        {queueOpen && (
          <section aria-label={t`Up next`} className="tsugi-junction-secondary overflow-hidden py-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold"><Trans>Up next</Trans></h2>
              <button type="button" aria-label={t`Close queue`}
                className="tsugi-control flex size-8 items-center justify-center"
                onClick={() => setQueueOpen(false)}><FiX aria-hidden /></button>
            </div>
            <ol className="max-h-52 space-y-1 overflow-y-auto">
              {p.queue.map((item,index) => (
                <li key={item.id + ':' + index}>
                  <button type="button" onClick={() => p.onQueue(index)}
                    aria-current={index === p.index ? 'true' : undefined}
                    className="flex w-full items-center gap-3 py-2 text-left text-xs hover:bg-white/[0.04]"
                    style={{color:index === p.index ? palette.accent : palette.foreground}}>
                    <span className="w-5 shrink-0 text-right tabular-nums opacity-60">{index + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    <span className="max-w-[35%] truncate opacity-50">{item.artist}</span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        )}

        {(p.loading || p.error) && (
          <p role={p.error ? 'alert' : 'status'} className="text-sm text-amber-200">
            {p.error || <Trans>Resolving audio…</Trans>}
          </p>
        )}
      </section>
    </div>
  );
}
