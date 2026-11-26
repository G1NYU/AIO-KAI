import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { LANDSCAPE_ROTATION_MS, landscapeArtworkPool, landscapeCandidates, localLandscapes, type LandscapeArtwork } from './landscape-artwork';
import './landscape-decoration.css';

const preferenceKey = 'tsugi.landscape.local-only';
const preferenceEvent = 'tsugi-landscape-preference';
let localOnly = false;
function externalEnabled() {
  try { return localStorage.getItem(preferenceKey) !== 'true'; }
  catch { return !localOnly; }
}
function subscribe(callback: () => void) {
  window.addEventListener(preferenceEvent, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(preferenceEvent, callback);
    window.removeEventListener('storage', callback);
  };
}
function setExternal(enabled: boolean) {
  localOnly = !enabled;
  try { localStorage.setItem(preferenceKey, String(localOnly)); } catch { /* In-memory preference. */ }
  window.dispatchEvent(new Event(preferenceEvent));
}
function subscribeVisibility(callback: () => void) {
  document.addEventListener('visibilitychange', callback);
  return () => document.removeEventListener('visibilitychange', callback);
}
const documentVisible = () => !document.hidden;

function ArtworkImage({ artwork, onFailure, onReady }: { artwork: LandscapeArtwork; onFailure: () => void; onReady: () => void }) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (loaded) return;
    const timer = window.setTimeout(onFailure, 6000);
    return () => window.clearTimeout(timer);
  }, [loaded, onFailure]);
  return <img src={artwork.url} alt="" referrerPolicy="no-referrer" data-artwork-provider={artwork.provider} style={{ opacity: loaded ? 1 : 0 }} onError={onFailure} onLoad={event => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    if (naturalWidth < 800 || naturalHeight < 300 || naturalWidth / naturalHeight < 1.2) { onFailure(); return; }
    setLoaded(true); onReady();
  }} />;
}

type DecorationProps = { fallback?: string; className?: string; active?: boolean };

/** Decorative landscapes never replace the real covers or metadata of a title. */
export function LandscapeDecoration(props: DecorationProps) {
  const external = useSyncExternalStore(subscribe, externalEnabled, () => true);
  return <DecorationContent key={external ? 'remote' : 'local'} {...props} external={external} />;
}

function DecorationContent({ fallback, className = '', active = true, external }: DecorationProps & { external: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [candidates, setCandidates] = useState<LandscapeArtwork[]>([]);
  const [artwork, setArtwork] = useState<LandscapeArtwork>();
  const [loadedUrl, setLoadedUrl] = useState('');
  const pageVisible = useSyncExternalStore(subscribeVisibility, documentVisible, () => true);
  const visible = active && inView && pageVisible;
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const observer = new IntersectionObserver(entries => setInView(entries.some(entry => entry.isIntersecting)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !external || candidates.length) return;
    const controller = new AbortController();
    let current = true;
    const timer = window.setTimeout(() => controller.abort(), 4000);
    void landscapeCandidates(controller.signal).then(result => {
      if (current) setCandidates([...result, ...localLandscapes(fallback)]);
    }).catch(() => {
      if (current) setCandidates(localLandscapes(fallback));
    }).finally(() => window.clearTimeout(timer));
    return () => { current = false; controller.abort(); window.clearTimeout(timer); };
  }, [visible, external, candidates.length, fallback]);
  const available = landscapeArtworkPool.available(candidates);
  const ready = !!artwork && loadedUrl === artwork.url;
  const advance = useCallback(() => {
    const next = landscapeArtworkPool.next(candidates, artwork?.url);
    if (next?.url === artwork?.url) return;
    setLoadedUrl('');
    setArtwork(next);
  }, [candidates, artwork]);
  useEffect(() => {
    if (visible && external && candidates.length && !artwork) advance();
  }, [visible, external, candidates.length, artwork, advance]);
  const onFailure = useCallback(() => {
    if (!artwork || !visible) return;
    landscapeArtworkPool.reject(artwork.url);
    advance();
  }, [artwork, visible, advance]);
  const onReady = useCallback(() => { if (artwork) setLoadedUrl(artwork.url); }, [artwork]);
  useEffect(() => {
    if (!visible || !external || !ready || available.length < 2) return;
    const timer = window.setInterval(() => {
      if (!document.hidden && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) advance();
    }, LANDSCAPE_ROTATION_MS);
    return () => window.clearInterval(timer);
  }, [visible, external, ready, available.length, artwork, advance]);

  return <>
    <div ref={container} className={'tsugi-hero-artwork ' + className} aria-hidden="true" data-ui="landscape-decoration">
      <svg viewBox="0 0 1600 600" preserveAspectRatio="xMidYMid slice">
        <rect width="1600" height="600" fill="#283749" />
        <circle cx="1170" cy="150" r="92" fill="#e2b18f" opacity=".78" />
        <path d="M0 410 260 230 410 340 660 120 920 365 1190 205 1600 420V600H0Z" fill="#526376" />
        <path d="M0 470 340 320 520 405 810 265 1090 420 1320 300 1600 445V600H0Z" fill="#37495b" />
        <path d="M0 560 340 460 650 520 965 395 1250 500 1600 420V600H0Z" fill="#192b3b" />
      </svg>
      {fallback && <img className="tsugi-design-illustration" src={fallback} alt="" />}
      {external && artwork && (ready || visible) && <ArtworkImage key={artwork.url} artwork={artwork} onFailure={onFailure} onReady={onReady} />}
    </div>
    <div className="tsugi-landscape-credit" data-ui="landscape-artwork-controls">
      {external && ready && <span>{artwork?.provider === 'kitsu' ? <Trans>Kitsu</Trans> : artwork?.provider === 'nekos' ? <Trans>Nekos API</Trans> : <Trans>Local artwork</Trans>}</span>}
      {external && ready && available.length > 1 && <button type="button" onClick={advance}><Trans>Next illustration</Trans></button>}
      {external ? <button type="button" title={t`External illustrations are filtered but may be incorrectly classified.`} onClick={() => setExternal(false)}><Trans>Use local artwork</Trans></button> : <button type="button" onClick={() => setExternal(true)}><Trans>Enable external illustration</Trans></button>}
    </div>
  </>;
}
