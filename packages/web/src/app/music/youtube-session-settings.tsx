import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { requestYouTubeMusic } from '@/lib/hosts/shell/youtube-music';
import { nativeYouTubeTarget } from '@/lib/music/youtube-music';
import { youtubeSession, type YouTubeSessionMode } from '@/lib/music/youtube-session';

export function YouTubeSessionSettings({ trackId, onChanged }: { trackId?: string; onChanged(): void }) {
  const [mode, setMode] = React.useState<YouTubeSessionMode | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [revision, setRevision] = React.useState(0);
  const mounted = React.useRef(false);

  React.useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    setError('');
    youtubeSession(requestYouTubeMusic, 'status', controller.signal).then(value => {
      if (!controller.signal.aborted) setMode(value);
    }).catch(() => {
      if (!controller.signal.aborted) setError(t`Could not read the YouTube session. Check that this desktop build supports session controls, then retry.`);
    });
    return () => { mounted.current = false; controller.abort(); };
  }, [revision]);

  async function change(next: YouTubeSessionMode) {
    if (busy || mode === null || mode === next) return;
    setBusy(true);
    setError('');
    try {
      const result = await youtubeSession(requestYouTubeMusic, next);
      // The native choice has already changed even when this sheet was closed.
      onChanged();
      if (mounted.current) setMode(result);
    } catch {
      if (mounted.current) setError(t`Could not change the YouTube session. Check its status before retrying playback.`);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const trackUrl = trackId && /^[\w-]{11}$/.test(trackId) ? nativeYouTubeTarget(trackId) : 'https://www.youtube.com/';
  return <section aria-labelledby="youtube-session-heading" className="tsugi-source-section">
    <h3 id="youtube-session-heading"><Trans>YouTube session</Trans></h3>
    <p className="text-sm text-[--tsugi-muted]"><Trans>If YouTube asks you to sign in or verify, open the track in a regular Firefox window and complete that step there. Then let Tsugi use the YouTube session from your most recently used Firefox profile. Private windows and containers are excluded.</Trans></p>
    <p className="text-xs text-[--tsugi-muted]"><Trans>This applies to YouTube playback and Vault exports until Tsugi closes. The native tool reads Firefox cookies locally; sign-in data is excluded from app settings and backups. YouTube may still refuse access.</Trans></p>
    <p role="status" className="text-sm">
      {mode === 'firefox' ? <Trans>Firefox session selected for this app session.</Trans>
        : mode === 'anonymous' ? <Trans>Anonymous access. No browser session is used.</Trans>
          : <Trans>Checking YouTube session…</Trans>}
    </p>
    <div className="flex flex-wrap items-center gap-3">
      <a href={trackUrl} target="_blank" rel="noopener noreferrer" className="tsugi-library-action"><Trans>Open YouTube</Trans></a>
      {mode === 'firefox'
        ? <button type="button" className="tsugi-library-action" disabled={busy} onClick={() => void change('anonymous')}><Trans>Stop using Firefox session</Trans></button>
        : <button type="button" className="tsugi-library-action" disabled={busy || mode === null} onClick={() => void change('firefox')}><Trans>Use Firefox for this session</Trans></button>}
    </div>
    {busy && <p role="status" className="text-sm text-[--tsugi-muted]"><Trans>Changing session…</Trans></p>}
    {error && <div role="alert" className="text-sm text-red-300">
      <p>{error}</p>
      <button type="button" className="tsugi-library-action mt-2" disabled={busy} onClick={() => { setMode(null); setRevision(value => value + 1); }}><Trans>Check session again</Trans></button>
    </div>}
  </section>;
}
