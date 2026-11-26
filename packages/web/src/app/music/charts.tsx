import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { BiDisc, BiSearch } from 'react-icons/bi';
import { fetchTrendingRecordings, type TrendingRecording } from '@/lib/music/discovery';

/** Only suggestions: playback must be chosen from the connected addon. */
export function MusicCharts({ onFind }: { onFind(recording: TrendingRecording): void }) {
  const [tracks, setTracks] = React.useState<TrendingRecording[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    const controller = new AbortController();
    fetchTrendingRecordings(controller.signal).then((list) => {
      if (!controller.signal.aborted) setTracks(list);
    }).catch(() => {
      if (!controller.signal.aborted) setError(true);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, []);

  return (
    <section aria-label={t`Independent music discovery`}
      className="tsugi-music-charts border-t border-white/10 px-0 py-7">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-white/40">
            <Trans>ListenBrainz charts</Trans>
          </p>
          <h3 className="text-xl font-semibold text-white sm:text-2xl"><Trans>Trending this week</Trans></h3>
          <p className="mt-2 text-xs text-white/50">
            <Trans>Discover tracks independently of your music source. Select one to search your addon.</Trans>
          </p>
        </div>
        <a href="https://listenbrainz.org/statistics/" target="_blank" rel="noopener noreferrer"
          className="text-xs text-white/55 underline underline-offset-4 hover:text-white">
          <Trans>About these charts</Trans>
        </a>
      </div>
      {loading && <p role="status" className="text-sm text-white/50"><Trans>Loading music…</Trans></p>}
      {error && <p role="status" className="text-sm text-white/50">
        <Trans>Community charts are temporarily unavailable. Your addon still supports search.</Trans>
      </p>}
      {!loading && !error && !tracks.length && (
        <p className="text-sm text-white/50"><Trans>No chart entries are available right now.</Trans></p>
      )}
      <div className="grid gap-x-7 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {tracks.slice(0, 15).map((item, index) => (
          <button key={item.key} type="button" onClick={() => onFind(item)}
            className="tsugi-music-chart-row group flex min-w-0 items-center gap-3 border-b border-white/[0.08] px-0 py-4 text-left transition-colors hover:bg-white/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/60">
            <span className="w-6 shrink-0 text-right text-xs tabular-nums text-white/35">{index + 1}</span>
            <span className="flex size-11 shrink-0 items-center justify-center text-[--tsugi-muted]">
              <BiDisc aria-hidden className="text-2xl text-white/45" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-white">{item.title}</span>
              <span className="mt-1 block truncate text-xs text-white/50">{item.artist}</span>
            </span>
            <BiSearch aria-hidden className="shrink-0 text-base text-white/35 group-hover:text-white" />
          </button>
        ))}
      </div>
    </section>
  );
}
