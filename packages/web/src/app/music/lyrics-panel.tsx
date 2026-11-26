import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { lyricAt, lyricSeekTime } from '@/lib/music/lyrics';
import type { TrackLyricsState } from './use-track-lyrics';
import './lyrics.css';

export function LyricsPanel({ state, position, duration, onSeek }: {
  state: TrackLyricsState; position: number; duration: number; onSeek(value: number): void;
}) {
  const controlsId = React.useId();
  if (state.busy) return <p className="text-sm"><Trans>Loading lyrics…</Trans></p>;
  if (state.error) return <p role="status" className="text-sm">{state.error}</p>;
  const lyrics = state.lyrics;
  if (!lyrics) return <p className="text-sm"><Trans>No matching lyrics found.</Trans></p>;
  const index = state.synchronized ? lyricAt(lyrics.synced, position, state.offset) : -1;
  const start = Math.max(0, index - 2);
  const lines = state.aligning ? lyrics.synced : lyrics.synced.slice(start, start + 8);
  return <>
    {lyrics.synced.length > 0 && <div className="tsugi-lyrics-timing">
      {!state.synchronized && <p role="status">{lyrics.timingReason === 'video'
        ? <Trans>This video may have a different intro or edit. Lyric timing is unconfirmed.</Trans>
        : <Trans>Lyrics found; timing is unconfirmed for this recording.</Trans>}</p>}
      <button type="button" aria-expanded={state.timingOpen} aria-controls={controlsId}
        onClick={() => state.showTiming(!state.timingOpen)}><Trans>Adjust lyrics timing</Trans></button>
      {state.timingOpen && <div id={controlsId} className="tsugi-lyrics-timing-controls">
        <p>{lyrics.recording.album && <span>{lyrics.recording.album} · </span>}
          <Trans>Lyrics offset</Trans> <output>{state.offset > 0 ? '+' : ''}{state.offset.toFixed(2)} s</output>
        </p>
        <div className="tsugi-lyrics-timing-actions">
          <button type="button" onClick={() => state.setOffset(state.offset - .5)} disabled={state.offset <= -120}><Trans>Lyrics earlier</Trans></button>
          <button type="button" onClick={() => state.setOffset(state.offset + .5)} disabled={state.offset >= 120}><Trans>Lyrics later</Trans></button>
          <button type="button" onClick={state.reset} disabled={!state.manual}><Trans>Reset timing</Trans></button>
          <button type="button" aria-pressed={state.aligning} onClick={() => state.setAligning(!state.aligning)}>
            {state.aligning ? <Trans>Cancel line matching</Trans> : <Trans>Match a sung line</Trans>}
          </button>
        </div>
        {state.aligning ? <p><Trans>Listen, then select the line being sung now. This changes lyric timing without seeking the audio.</Trans></p>
          : <p><Trans>Earlier shows lyrics sooner; later delays them. Adjustments last for this app session and this recording.</Trans></p>}
        {state.alignmentError && <p role="alert">{state.alignmentError}</p>}
      </div>}
    </div>}
    {state.aligning || state.synchronized ? <div className={'tsugi-stage-lyric-lines space-y-2' + (state.aligning ? ' tsugi-lyric-align' : '')} aria-label={state.aligning ? t`Choose the line being sung` : t`Lyrics`}>
      {lines.map((line, at) => {
        const time = lyricSeekTime(line, state.offset, duration);
        return <button key={line.at + ':' + at} type="button"
          onClick={() => state.aligning ? state.align(line.at, position) : onSeek(time)}
          aria-current={!state.aligning && start + at === index ? 'true' : undefined}
          className="oto-lyric-line block text-start">
          {!state.aligning && <span className="oto-lyric-time" aria-hidden="true">{Math.floor(time / 60)}:{String(Math.floor(time % 60)).padStart(2, '0')}</span>}
          {line.text}
        </button>;
      })}
    </div> : <div className="tsugi-stage-plain-lyrics text-sm">{lyrics.plain.map((line, at) => <p key={at}>{line}</p>)}</div>}
  </>;
}
