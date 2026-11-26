import React from 'react';
import { t } from '@lingui/core/macro';
import type { EclipseTrack } from '@/lib/music/eclipse';
import { fetchTrackLyrics, lyricRecordingKey, LyricTimingStore, type TrackLyrics } from '@/lib/music/lyrics';

const corrections = new LyricTimingStore();

export function useTrackLyrics(track: EclipseTrack | null, source: string, duration: number, enabled: boolean) {
  const requestKey = JSON.stringify([source, track?.id, track?.title, track?.artist, track?.album, track?.recordingType, duration]);
  const [result, setResult] = React.useState<{ key: string; lyrics: TrackLyrics | null; busy: boolean; error: string } | null>(null);
  const [controls, setControls] = React.useState<{ key: string; open: boolean; aligning: boolean } | null>(null);
  const [, update] = React.useState(0);
  const [alignmentError, setAlignmentError] = React.useState<{ key: string; text: string } | null>(null);
  React.useEffect(() => {
    if (!enabled || !track) return;
    const controller = new AbortController();
    setResult({ key: requestKey, lyrics: null, busy: true, error: '' });
    fetchTrackLyrics(track, controller.signal, duration, source).then(lyrics => {
      if (!controller.signal.aborted) setResult({ key: requestKey, lyrics, busy: false, error: '' });
    }).catch(() => {
      if (!controller.signal.aborted) setResult({ key: requestKey, lyrics: null, busy: false, error: t`Lyrics are temporarily unavailable.` });
    });
    return () => controller.abort();
  }, [track, source, duration, enabled, requestKey]);
  const current = enabled && result?.key === requestKey ? result : null;
  const lyrics = current?.lyrics ?? null;
  const key = React.useMemo(() => track && lyrics ? lyricRecordingKey(source, track, duration, lyrics) : '', [track, source, duration, lyrics]);
  const correction = key ? corrections.get(key) : undefined;
  const offset = correction ?? 0;
  const open = controls?.key === key && controls.open;
  const aligning = controls?.key === key && controls.aligning;
  const setOffset = (value: number) => {
    if (!key || !Number.isFinite(value)) return;
    corrections.set(key, Math.max(-120, Math.min(120, value)));
    setAlignmentError(null);
    update(revision => revision + 1);
  };
  return {
    lyrics, key, offset, manual: correction !== undefined,
    synchronized: !!lyrics?.synced.length && (lyrics.timingReason === null || correction !== undefined),
    busy: enabled && (!current || current.busy), error: current?.error ?? '',
    timingOpen: !!open, aligning: !!aligning,
    alignmentError: alignmentError?.key === key ? alignmentError.text : '',
    showTiming: (value: boolean) => setControls({ key, open: value, aligning: false }),
    setAligning: (value: boolean) => { setAlignmentError(null); setControls({ key, open: true, aligning: value }); },
    setOffset,
    align: (lineTime: number, playbackTime: number) => {
      const value = playbackTime - lineTime;
      if (!Number.isFinite(value) || Math.abs(value) > 120) {
        setAlignmentError({ key, text: t`Choose a line within two minutes of the current playback time.` });
        return;
      }
      setOffset(value);
      setControls({ key, open: true, aligning: false });
    },
    reset: () => { corrections.reset(key); setAlignmentError(null); setControls({ key, open: true, aligning: false }); update(revision => revision + 1); },
  };
}

export type TrackLyricsState = ReturnType<typeof useTrackLyrics>;
