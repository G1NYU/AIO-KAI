import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { nativeMotionLevel, pcmMotionLevel, prepareMascot, readMascot, readPlayerVisuals, savePlayerVisuals,
  writeMascot, type MascotRecord, type NativeMotionSample, type PlayerVisuals } from '@/lib/music/player-visuals';

type MascotUrls = {image:string;poster:string};
const VisualsContext = React.createContext<{prefs:PlayerVisuals;urls:MascotUrls|null}>({
  prefs:{seekMotion:true,mascot:'off'},urls:null,
});
export const PlayerVisualsProvider = VisualsContext.Provider;
export function useVisuals() { return React.useContext(VisualsContext); }

export function useMotionAllowed() {
  const [allowed,setAllowed] = React.useState(() => !document.hidden && !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  React.useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setAllowed(!document.hidden && !media.matches);
    sync();
    document.addEventListener('visibilitychange',sync);
    media.addEventListener('change',sync);
    return () => {
      document.removeEventListener('visibilitychange',sync);
      media.removeEventListener('change',sync);
    };
  },[]);
  return allowed;
}

/** One sampler per visible player; never attach another audio graph or
 * animate an invented signal. Update the decorative elements, not React's
 * playback tree or the accessible range input. */
export function usePlayerMotion(ref: React.RefObject<HTMLElement|null>, enabled: boolean, identity: string,
  expanded: boolean, analyser?: AnalyserNode|null, nativeMeter?: React.RefObject<NativeMotionSample|null>) {
  React.useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const samples = analyser ? new Uint8Array(analyser.fftSize) : null;
    let frame = 0, last = -Infinity;
    const paint = (level: number) => {
      const moving = level > .012;
      root.style.setProperty('--tsugi-audio-energy',moving ? level.toFixed(4) : '0');
      root.dataset.audioMotion = moving ? 'reactive' : 'still';
      for (const image of root.querySelectorAll<HTMLImageElement>('img[data-motion-art]')) {
        const next = moving ? image.dataset.motionArt : image.dataset.staticArt;
        if (next && image.getAttribute('src') !== next) image.setAttribute('src',next);
      }
    };
    paint(0);
    const tick = (now: number) => {
      if (!root.isConnected) return;
      if (now-last >= 1000/24) {
        let level = 0;
        if (!document.hidden && !window.matchMedia('(prefers-reduced-motion: reduce)').matches && root.getClientRects().length) {
          if (analyser && samples && analyser.context.state === 'running') {
            analyser.getByteTimeDomainData(samples);
            level = pcmMotionLevel(samples);
          } else if (nativeMeter) level = nativeMotionLevel(nativeMeter.current,performance.now());
        }
        paint(level);
        last = now;
      }
      frame = requestAnimationFrame(tick);
    };
    if (enabled && (analyser || nativeMeter)) frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); paint(0); };
  },[ref,enabled,identity,expanded,analyser,nativeMeter]);
}

export function usePlayerVisualSettings() {
  const [prefs,setPrefs] = React.useState(readPlayerVisuals);
  const [record,setRecord] = React.useState<MascotRecord|null>(null);
  const [urls,setUrls] = React.useState<MascotUrls|null>(null);
  const [busy,setBusy] = React.useState(true);
  const [error,setError] = React.useState('');
  const pending = React.useRef(true);
  const mounted = React.useRef(false);

  React.useEffect(() => {
    mounted.current = true;
    let active = true;
    void readMascot().then(value => {
      if (active) setRecord(value);
    }).catch(() => {
      if (active) setError(t`Could not read the saved listening mascot.`);
    }).finally(() => { if (active) { pending.current = false; setBusy(false); } });
    return () => { active = false; mounted.current = false; };
  },[]);
  React.useEffect(() => {
    if (!record) { setUrls(null); return; }
    const image = URL.createObjectURL(record.image), poster = URL.createObjectURL(record.poster);
    setUrls({image,poster});
    return () => { URL.revokeObjectURL(image); URL.revokeObjectURL(poster); };
  },[record]);

  function change(value: PlayerVisuals) {
    if (savePlayerVisuals(value)) { setPrefs(value); setError(''); }
    else setError(t`Could not save the player visual preferences.`);
  }
  async function importImage(file: File) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const next = await prepareMascot(file);
      if (!mounted.current) return;
      await writeMascot(next);
      if (!mounted.current) return;
      setRecord(next);
      change({...readPlayerVisuals(),mascot:'custom'});
    } catch { if (mounted.current) setError(t`Could not import the mascot. Choose a valid PNG, WebP or GIF within 4 MB and 1024 × 1024 pixels.`); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  async function removeImage() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      await writeMascot(null);
      if (!mounted.current) return;
      setRecord(null);
      const saved = readPlayerVisuals();
      if (saved.mascot === 'custom') change({...saved,mascot:'off'});
    } catch { if (mounted.current) setError(t`Could not remove the saved mascot.`); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  return {prefs,urls,busy,error,change,importImage,removeImage};
}
export type VisualSettingsState = ReturnType<typeof usePlayerVisualSettings>;

export function ListeningSpirit() {
  const {prefs,urls} = useVisuals();
  if (prefs.mascot === 'off' || (prefs.mascot === 'custom' && !urls)) return null;
  return <span className="tsugi-listening-spirit" data-ui="listening-mascot" data-mascot={prefs.mascot} aria-hidden="true">
    {prefs.mascot === 'custom' && urls
      ? <img alt="" src={urls.poster} data-static-art={urls.poster} data-motion-art={urls.image} />
      : <svg viewBox="0 0 64 64" fill="none">
          <path d="M15 31C15 17 23 10 32 10S49 17 49 31v17l-8-5-9 7-9-7-8 5Z" fill="currentColor" opacity=".88" />
          <path d="M10 32v-5a22 22 0 0 1 44 0v5" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"/>
          <rect x="8" y="28" width="9" height="15" rx="4" fill="currentColor"/>
          <rect x="47" y="28" width="9" height="15" rx="4" fill="currentColor"/>
          <path d="M25 28v2m14-2v2m-10 6q3 3 6 0" stroke="var(--tsugi-canvas,#161619)" strokeWidth="2.6" strokeLinecap="round"/>
          <path d="m51 10 4 2-4 2-2 4-2-4-4-2 4-2 2-4Z" fill="currentColor" opacity=".7"/>
        </svg>}
  </span>;
}

export function PlayerVisualSettings({state}: {state:VisualSettingsState}) {
  const {prefs,urls,busy,error,change,importImage,removeImage} = state;
  return <section className="mb-8 border-t border-[--tsugi-line] pt-8 space-y-4" aria-label={t`Audio-reactive visuals`}>
    <h3 className="text-lg font-semibold"><Trans>Audio-reactive visuals</Trans></h3>
    <label className="flex items-center justify-between gap-4 text-sm">
      <Trans>Reactive seek bar</Trans>
      <input type="checkbox" checked={prefs.seekMotion} onChange={e=>change({...prefs,seekMotion:e.target.checked})}
        style={{accentColor:'var(--tsugi-accent)'}} />
    </label>
    <label className="block text-sm">
      <span className="mb-2 block"><Trans>Listening mascot</Trans></span>
      <select className="tsugi-menu-select w-full" value={prefs.mascot}
        onChange={e=>change({...prefs,mascot:e.target.value as PlayerVisuals['mascot']})}>
        <option value="off">{t`Off`}</option>
        <option value="builtin">{t`Listening spirit`}</option>
        <option value="custom" disabled={!urls}>{t`Custom image`}</option>
      </select>
    </label>
    {urls && <img src={urls.poster} alt={t`Saved mascot preview`} className="h-16 w-16 object-contain" />}
    <label className="tsugi-primary-action inline-flex cursor-pointer items-center gap-2 text-sm">
      <Trans>Import mascot image</Trans>
      <input type="file" accept="image/png,image/webp,image/gif" className="sr-only" disabled={busy}
        onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void importImage(file);}} />
    </label>
    {urls && <button type="button" disabled={busy} className="tsugi-read-action text-sm" onClick={()=>void removeImage()}><Trans>Remove custom image</Trans></button>}
    <p className="text-xs leading-5 text-[--tsugi-muted]"><Trans>Uses measured audio levels only. Custom images stay on this device; motion stops when paused, hidden, reduced motion is enabled, or audio analysis is unavailable. PNG, WebP and GIF up to 4 MB and 1024 × 1024 pixels.</Trans></p>
    {error && <p role="alert" className="text-xs text-amber-200">{error}</p>}
  </section>;
}
