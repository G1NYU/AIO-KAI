import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import {
  BiChevronDown, BiDisc, BiExpand, BiListUl, BiPause, BiPlay,
  BiRepeat, BiShuffle, BiSkipNext, BiSkipPrevious, BiVolumeFull,
} from 'react-icons/bi';
import { FiExpand, FiRepeat, FiShuffle, FiSkipBack, FiSkipForward, FiVolume2 } from 'react-icons/fi';
import type { EclipseTrack } from '@/lib/music/eclipse';
import { parsePlayerTemplate } from '@/lib/music/player-template';
import { readPlayerStage, savePlayerStage, type PlayerStageId } from '@/lib/music/player-layout';
import { EclipseStudioStage } from './studio-player';
import { JunctionPlayer } from './junction-player';
import { NOCTURNE_STAGE } from '@/lib/music/nocturne-stage';
import { JUNCTION_STAGE } from '@/lib/music/junction-stage';
import { PLAYER_PALETTES, readPlayerTheme, savePlayerTheme, type PlayerPalette, type PlayerThemeId } from '@/lib/music/player-theme';

export type RepeatMode = 'off' | 'all' | 'one';

export type MusicPlayerProps = {
  track: EclipseTrack | null;
  sourceName: string;
  queue: EclipseTrack[];
  index: number;
  paused: boolean;
  loading: boolean;
  error: string;
  position: number;
  duration: number;
  volume: number;
  quality: string;
  expanded: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  onExpanded(value: boolean): void;
  onToggle(): void;
  onNext(auto?: boolean): void;
  onPrevious(): void;
  onSeek(seconds: number): void;
  onVolume(value: number): void;
  onShuffle(value: boolean): void;
  onRepeat(mode: RepeatMode): void;
  onQueue(index: number): void;
};

const buttonClass = 'tsugi-control inline-flex size-10 items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2';

export function musicTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const n = Math.floor(value);
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}

function Artwork({ track, large = false }: { track: EclipseTrack; large?: boolean }) {
  const size = large ? 'aspect-square w-full max-w-[440px] rounded-2xl' : 'size-12 shrink-0 rounded-xl';
  return track.artworkURL
    ? <img src={track.artworkURL} alt="" referrerPolicy="no-referrer"
        className={`${size} border border-white/10 bg-white/[0.05] object-cover`} />
    : <span className={`${size} flex items-center justify-center border border-white/10 bg-[#211d30]`}>
        <BiDisc aria-hidden className={large ? 'text-8xl text-violet-200' : 'text-3xl text-violet-200'} />
      </span>;
}

export function Transport({ p, palette, large = false }: { p: MusicPlayerProps; palette: PlayerPalette; large?: boolean }) {
  return (
    <div className={`flex items-center justify-center ${large ? 'gap-3' : 'gap-1'}`}>
      <button type="button" onClick={() => p.onShuffle(!p.shuffle)} aria-label={t`Shuffle`}
        aria-pressed={p.shuffle} className={buttonClass}>
        <FiShuffle aria-hidden className={large ? 'text-lg' : 'text-base'} />
      </button>
      <button type="button" onClick={p.onPrevious} aria-label={t`Previous track`}
        className={buttonClass}><FiSkipBack aria-hidden className={large ? 'text-2xl' : 'text-lg'} /></button>
      <button type="button" disabled={p.loading} onClick={p.onToggle}
        aria-label={p.paused ? t`Play` : t`Pause`}
        className={`tsugi-play-toggle inline-flex ${large ? 'size-[66px]' : 'size-11'} items-center justify-center disabled:opacity-50`}
        style={{backgroundColor:palette.accent,color:palette.accentText}}>
        {p.paused
          ? <BiPlay aria-hidden className={large ? 'text-4xl' : 'text-2xl'} />
          : <BiPause aria-hidden className={large ? 'text-4xl' : 'text-2xl'} />}
      </button>
      <button type="button" onClick={() => p.onNext()} aria-label={t`Next track`}
        className={buttonClass}><FiSkipForward aria-hidden className={large ? 'text-2xl' : 'text-lg'} /></button>
      <button type="button" onClick={() => p.onRepeat(p.repeat === 'off' ? 'all' : p.repeat === 'all' ? 'one' : 'off')}
        aria-pressed={p.repeat !== 'off'} aria-label={t`Repeat`}
        className={`${buttonClass} relative`}>
        <FiRepeat aria-hidden className={large ? 'text-lg' : 'text-base'} />
        {p.repeat === 'one' && <span className="absolute -bottom-0.5 text-[9px] font-bold">1</span>}
      </button>
    </div>
  );
}

export function Timeline({ p, palette }: { p: MusicPlayerProps; palette: PlayerPalette }) {
  const max = Math.max(1, p.duration);
  const progress = Math.min(100, Math.max(0, p.position / max * 100));
  return (
    <div className="flex w-full items-center gap-3 text-xs tabular-nums"
      style={{color:palette.muted}}>
      <span className="w-10 text-right">{musicTime(p.position)}</span>
      <input type="range" min={0} max={max} step={0.1} value={Math.min(max,p.position)}
        onChange={(e) => p.onSeek(Number(e.target.value))}
        aria-label={t`Seek position`}
        style={{background:`linear-gradient(to right, ${palette.accent} ${progress}%, rgba(255,255,255,.16) ${progress}%)`}}
        className="tsugi-range min-w-0 flex-1" />
      <span className="w-10">{musicTime(Math.max(0,p.duration-p.position))}</span>
    </div>
  );
}

export function MusicPlayer({ p }: { p: MusicPlayerProps }) {
  const [initialStage] = React.useState(readPlayerStage);
  const [stageId, setStageId] = React.useState<PlayerStageId>(initialStage.id);
  const [importedTemplate, setImportedTemplate] = React.useState(initialStage.template);
  const [importedJson, setImportedJson] = React.useState<unknown>(initialStage.imported);
  const [importError, setImportError] = React.useState('');
  const [theme, setTheme] = React.useState<PlayerThemeId>(readPlayerTheme);
  const palette = PLAYER_PALETTES[theme];
  const template = stageId === 'junction' ? JUNCTION_STAGE
    : stageId === 'nocturne' ? NOCTURNE_STAGE
    : stageId === 'imported' ? importedTemplate : null;

  React.useEffect(() => {
    document.documentElement.dataset.tsugiTheme = theme;
    return () => { delete document.documentElement.dataset.tsugiTheme; };
  }, [theme]);

  React.useEffect(() => {
    const sync = (event: Event) => {
      const next = (event as CustomEvent<PlayerThemeId>).detail;
      if (next in PLAYER_PALETTES) setTheme(next);
    };
    window.addEventListener('tsugi-theme-change', sync);
    return () => window.removeEventListener('tsugi-theme-change', sync);
  }, []);

  function changeStage(next: PlayerStageId) {
    if (next === 'imported' && !importedTemplate) return;
    setStageId(next);
    savePlayerStage(next, importedJson);
    setImportError('');
  }

  function changeTheme(value: PlayerThemeId) {
    setTheme(value);
    savePlayerTheme(value);
    window.dispatchEvent(new CustomEvent<PlayerThemeId>('tsugi-theme-change', { detail: value }));
  }

  async function importLayout(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 1024 * 1024) {
      setImportError(t`Player layouts must be smaller than 1 MB.`);
      return;
    }
    try {
      const json = JSON.parse(await file.text()) as unknown;
      const result = parsePlayerTemplate(json);
      setImportedJson(json);
      setImportedTemplate(result);
      setStageId('imported');
      savePlayerStage('imported', json);
      setImportError('');
    } catch (reason) {
      setImportError(reason instanceof Error ? reason.message : t`This Eclipse player file could not be imported.`);
    }
  }

  React.useEffect(() => {
    if (!p.expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') p.onExpanded(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [p.expanded, p.onExpanded]);

  const track = p.track;
  if (!track) return null;
  return (
    <>
      <section aria-label={t`Music player`}
        className="tsugi-mini-player fixed bottom-3 left-3 right-3 z-30"
        style={{backgroundColor: palette.surface, borderColor: palette.border}}>
        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-2 sm:px-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,500px)_minmax(0,1fr)]">
          <button type="button" onClick={() => p.onExpanded(true)}
            className="flex min-w-0 max-w-[420px] items-center gap-3 rounded-xl px-1 text-left hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/60">
            <Artwork track={track} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-white">{track.title}</span>
              <span className="block truncate text-xs text-white/55">{track.artist}</span>
              {p.quality && <span className="block truncate text-[10px]" style={{color:palette.muted}}>{p.quality}</span>}
            </span>
          </button>
          <div className="order-3 col-span-2 mx-auto flex w-full max-w-[560px] flex-col items-center gap-0.5 lg:order-none lg:col-span-1 lg:justify-self-center">
            <Transport p={p} palette={palette} />
            <Timeline p={p} palette={palette} />
          </div>
          <div className="flex items-center justify-self-end gap-1.5 sm:gap-3">
            <div className="hidden items-center gap-2 sm:flex">
              <FiVolume2 aria-hidden className="text-lg" style={{color:palette.muted}} />
              <input type="range" min={0} max={1} step={0.02} value={p.volume}
                aria-label={t`Volume`} onChange={(e) => p.onVolume(Number(e.target.value))}
                style={{background:`linear-gradient(to right, ${palette.accent} ${p.volume*100}%, rgba(255,255,255,.16) ${p.volume*100}%)`}} className="tsugi-range w-16 lg:w-24" />
            </div>
            <button type="button" onClick={() => p.onExpanded(true)} aria-label={t`Expand player`}
              className={buttonClass}><FiExpand aria-hidden className="text-xl" /></button>
          </div>
        </div>
        {(p.loading || p.error) && (
          <p role={p.error ? 'alert' : 'status'} className="mt-2 text-center text-xs text-amber-200">
            {p.error || <Trans>Resolving audio…</Trans>}
          </p>
        )}
      </section>
      {p.expanded && (
        <section role="dialog" aria-modal="true" aria-label={t`Now playing`}
          className="tsugi-player-dialog fixed inset-0 z-50 overflow-y-auto"
          style={{backgroundColor:palette.canvas}}>
          <div aria-hidden className="tsugi-player-ambient" />
          <div aria-hidden className="tsugi-chrome-wash" />
          <div className="mx-auto flex min-h-dvh w-full flex-col px-4 pb-8 pt-12 sm:px-8">
            <header className="tsugi-player-toolbar mx-auto flex w-full max-w-[1520px] flex-wrap items-center justify-between gap-4"
              style={{borderColor:palette.border}}>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em]" style={{color:palette.muted}}>
                  <Trans>Now playing</Trans>
                </p>
                <p className="mt-1 text-sm text-white/50">{p.sourceName}</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-xs" style={{color:palette.muted}}>
                  <Trans>Layout</Trans>
                  <select aria-label={t`Player layout`} value={stageId}
                    onChange={(event) => changeStage(event.target.value as PlayerStageId)}
                    className="tsugi-player-select min-w-32 text-xs"
                    style={{backgroundColor: palette.panel, borderColor: palette.border, color:palette.foreground}}>
                    <option value="default">{t`Default`}</option>
                    <option value="junction">{t`Junction`}</option>
                    <option value="nocturne">{t`Nocturne`}</option>
                    {importedTemplate && <option value="imported">
                      {importedTemplate.name || t`Imported Studio layout`}
                    </option>}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-xs text-white/60">
                  <Trans>Player theme</Trans>
                  <select value={theme} onChange={(event) => changeTheme(event.target.value as PlayerThemeId)}
                    className="tsugi-player-select text-xs"
                    style={{backgroundColor: palette.panel, borderColor: palette.border}}>
                    {(Object.keys(PLAYER_PALETTES) as PlayerThemeId[]).map((id) => (
                      <option key={id} value={id}>
                        {id === 'mocha' ? t`Mocha` : id === 'matte' ? t`Matte black`
                          : id === 'aio-dark' ? t`Ink` : id === 'nightfall' ? t`Nightfall` : t`Carbon`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="tsugi-player-select cursor-pointer text-xs hover:bg-white/10">
                  <Trans>Import Studio layout</Trans>
                  <input type="file" accept=".eclipseplayer,application/json" className="sr-only"
                    onChange={(event) => void importLayout(event)} />
                </label>
                <button type="button" onClick={() => p.onExpanded(false)} aria-label={t`Minimise player`}
                  className={buttonClass}><BiChevronDown aria-hidden className="text-3xl" /></button>
              </div>
            </header>
            {importError && <p role="alert" className="mt-4 text-sm text-amber-200">{importError}</p>}
            {stageId === 'junction' ? (
              <JunctionPlayer p={p} palette={palette} />
            ) : template ? (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center py-3">
                <EclipseStudioStage p={p} template={template} palette={palette} />
                {(p.loading || p.error) && (
                  <p role={p.error ? 'alert' : 'status'} className="mt-3 text-center text-sm text-amber-200">
                    {p.error || <Trans>Resolving audio…</Trans>}
                  </p>
                )}
              </div>
            ) : (
            <div className="mx-auto grid w-full max-w-[1330px] flex-1 items-center gap-10 py-8 lg:grid-cols-[minmax(0,1fr)_minmax(330px,1fr)] xl:gap-16">
              <div className="flex flex-col items-center gap-8">
                <div className="w-full max-w-[440px] rounded-2xl border p-2" style={{backgroundColor:palette.panel,borderColor:palette.border}}>
                  <Artwork track={track} large />
                </div>
                <div className="w-full max-w-[460px] text-center">
                  <h1 className="truncate text-3xl font-semibold tracking-tight sm:text-4xl">{track.title}</h1>
                  <p className="mt-2 truncate text-lg text-white/60">{track.artist}</p>
                  <p className="mt-1 truncate text-sm text-white/35">{track.album ?? ''}</p>
                </div>
                <div className="w-full max-w-[540px] space-y-5">
                  <Timeline p={p} palette={palette} />
                  <Transport p={p} palette={palette} large />
                  <div className="flex items-center justify-center gap-3 text-white/60">
                    <BiVolumeFull aria-hidden />
                    <input type="range" min={0} max={1} step={0.02} value={p.volume}
                      aria-label={t`Volume`} onChange={(e) => p.onVolume(Number(e.target.value))}
                      style={{accentColor: palette.accent}}
                      className="w-40 cursor-pointer" />
                  </div>
                </div>
                {(p.loading || p.error) && (
                  <p role={p.error ? 'alert' : 'status'} className="max-w-lg text-center text-sm text-amber-200">
                    {p.error || <Trans>Resolving audio…</Trans>}
                  </p>
                )}
              </div>
              <aside className="tsugi-junction-secondary w-full self-stretch p-5 sm:p-7"
                style={{backgroundColor:palette.panel,borderColor:palette.border}}>
                <div className="mb-5 flex items-center gap-3">
                  <BiListUl aria-hidden className="text-2xl" style={{color: palette.accent}} />
                  <h2 className="text-lg font-semibold"><Trans>Up next</Trans></h2>
                  <span className="ml-auto text-xs text-white/50">{p.queue.length}</span>
                </div>
                <ol className="max-h-[64vh] space-y-2 overflow-y-auto">
                  {p.queue.map((item, index) => (
                    <li key={item.id + ':' + index}>
                      <button type="button" onClick={() => p.onQueue(index)}
                        aria-current={index === p.index ? 'true' : undefined}
                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/10 ${index === p.index ? 'bg-white/10 text-white' : 'text-white/75'}`}>
                        <span className="w-5 shrink-0 text-xs tabular-nums text-white/40">{index + 1}</span>
                        {item.artworkURL
                          ? <img src={item.artworkURL} alt="" referrerPolicy="no-referrer"
                              className="size-10 rounded-none object-cover" loading="lazy" />
                          : <BiDisc aria-hidden className="text-2xl" />}
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{item.title}</span>
                          <span className="block truncate text-xs text-white/45">{item.artist}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              </aside>
            </div>
            )}
          </div>
        </section>
      )}
    </>
  );
}
