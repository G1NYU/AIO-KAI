import { BrushDisc as BiDisc, BrushPause as BiPause, BrushPlay as BiPlay, BrushDown as FiChevronDown, BrushHeart as FiHeart, BrushList as FiList, BrushExpand as FiMaximize2, BrushRepeat as FiRepeat, BrushShuffle as FiShuffle, BrushPrevious as FiSkipBack, BrushNext as FiSkipForward } from '@/components/tsugi-icons';
import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';

import { BrushDownload, BrushSettings } from '@/components/tsugi-icons';
import { TsugiBrand } from '@/components/tsugi-brand';
import { TrackDownload } from './track-download';
import type { EclipseTrack } from '@/lib/music/eclipse';
import { parsePlayerTemplate } from '@/lib/music/player-template';
import { readPlayerStage, savePlayerStage, readMatrixMode, saveMatrixMode, type PlayerStageId } from '@/lib/music/player-layout';
import { EclipseStudioStage } from './studio-player';
import { JunctionPlayer } from './junction-player';
import { MusicArtwork } from './music-artwork';
import { PlaybackQueue } from './playback-queue';
import { PlayerSettings } from './player-settings';
import type { MatrixMode } from './pixel-matrix';
import { DotSeeker } from './wave-seeker';
import { VolumeControl } from './volume-control';
import { storage } from '@/lib/storage';
import type { AudioProfile } from '@/lib/music/audio-profiles';
import { notifyEclipseAppearance } from '@/lib/music/eclipse-appearance';
import type { PlayerPalette } from '@/lib/music/player-theme';
import { resolveGlobalPalette } from '@/components/shell/global-settings';

export type RepeatMode = 'off' | 'all' | 'one';

export type MusicPlayerProps = {
  track: EclipseTrack | null;
  sourceId?: string;
  sourceName: string;
  queue: EclipseTrack[];
  index: number;
  paused: boolean;
  loading: boolean;
  error: string;
  position: number;
  duration: number;
  /** Decoder duration; zero while only the catalog display estimate is known. */
  mediaDuration: number;
  volume: number;
  quality: string;
  expanded: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  audioProfile: AudioProfile;
  eqEnabled: boolean;
  eqAvailable: boolean;
  eqError: string;
  analyser?: AnalyserNode | null;
  visualizerUnavailable?: boolean;
  nativeMeter?: React.RefObject<{level:number;at:number} | null>;
  nativeMeterAvailable?: boolean;
  onMatrixActive?(active: boolean): void;
  isFavorite: boolean;
  canFavorite: boolean;
  canDownload?: boolean;
  onFavorite(): void;
  onAudioProfile(profile: AudioProfile): void;
  onEqEnabled(value: boolean): void;
  onExpanded(value: boolean): void;
  onToggle(): void;
  onNext(auto?: boolean): void;
  onPrevious(): void;
  onSeek(seconds: number): void;
  onVolume(value: number): void;
  onShuffle(value: boolean): void;
  onRepeat(mode: RepeatMode): void;
  onQueue(index: number): void;
  onMoveQueue(index: number, direction: -1 | 1): void;
  onRemoveQueue(index: number): void;
  onClearUpcoming(): void;
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
    ? <MusicArtwork source={track.artworkURL} target={large ? 1024 : 160} responsive={large}
        className={`${size} border border-[--tsugi-line] bg-[--tsugi-surface] object-cover`} />
    : <span className={`${size} flex items-center justify-center border border-[--tsugi-line] bg-[--tsugi-surface] text-[--tsugi-muted]`}>
        <BiDisc aria-hidden className={large ? 'text-8xl' : 'text-3xl'} />
      </span>;
}

export function Transport({ p, palette, large = false }: { p: MusicPlayerProps; palette: PlayerPalette; large?: boolean }) {
  return (
    <div className={`oto-transport flex items-center justify-center ${large ? 'gap-3' : 'gap-1'}`}>
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
  return (
    <div className="oto-timeline flex w-full items-center gap-3 text-xs tabular-nums"
      style={{color:palette.muted}}>
      <span className="w-10 shrink-0 text-right">{musicTime(p.position)}</span>
      <DotSeeker position={p.position} duration={p.duration} paused={p.paused}
        palette={palette} onSeek={p.onSeek} />
      <span className="w-10 shrink-0">-{musicTime(Math.max(0,p.duration-p.position))}</span>
    </div>
  );
}

export function MusicPlayer({ p }: { p: MusicPlayerProps }) {
  const [initialStage] = React.useState(readPlayerStage);
  const [stageId, setStageId] = React.useState<PlayerStageId>(initialStage.id);
  const [importedTemplate, setImportedTemplate] = React.useState(initialStage.template);
  const [importedJson, setImportedJson] = React.useState<unknown>(initialStage.imported);
  const [importError, setImportError] = React.useState('');
  const [palette, setPalette] = React.useState(resolveGlobalPalette);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [downloadTrack,setDownloadTrack] = React.useState<{id:string;title:string}|null>(null);
  const [studioContained, setStudioContained] = React.useState(() =>
    storage.get<boolean>('tsugi-studio-contained-v1') === true
  );
  const [showHeader, setShowHeader] = React.useState(() =>
    storage.get<boolean>('tsugi-player-header-visible-v1') === true
  );
  const [matrixMode, setMatrixMode] = React.useState<MatrixMode>(readMatrixMode);
  const template = stageId === 'imported' ? importedTemplate : null;
  const matrixActive = p.expanded && stageId !== 'imported' && matrixMode !== 'off';
  const onMatrixActive = p.onMatrixActive;
  React.useEffect(() => {
    onMatrixActive?.(matrixActive);
    return () => onMatrixActive?.(false);
  }, [matrixActive, onMatrixActive]);

  React.useEffect(() => {
    const sync = () => {
      const saved = readPlayerStage();
      setStageId(saved.id);
      setImportedJson(saved.imported);
      setImportedTemplate(saved.template);
      setMatrixMode(readMatrixMode());
    };
    window.addEventListener('tsugi-player-preferences-change', sync);
    return () => window.removeEventListener('tsugi-player-preferences-change', sync);
  }, []);

  React.useEffect(() => {
    notifyEclipseAppearance();
  }, [stageId, importedTemplate, importedJson]);

  React.useEffect(() => {
    const sync = () => setPalette(resolveGlobalPalette());
    sync();
    window.addEventListener('tsugi-theme-change', sync);
    window.addEventListener('tsugi-eclipse-appearance-change', sync);
    return () => { window.removeEventListener('tsugi-theme-change', sync); window.removeEventListener('tsugi-eclipse-appearance-change', sync); };
  }, []);

  function changeStage(next: PlayerStageId) {
    if (next === 'imported' && !importedTemplate) return;
    setStageId(next);
    savePlayerStage(next, importedJson);
    setImportError('');
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
      setSettingsOpen(false);
    } catch (reason) {
      setImportError(reason instanceof Error ? reason.message : t`This Eclipse player file could not be imported.`);
    }
  }

  React.useEffect(() => {
    if (!p.expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (downloadTrack) return;
      if (settingsOpen) setSettingsOpen(false);
      else p.onExpanded(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [p.expanded, p.onExpanded, settingsOpen, downloadTrack]);

  const track = p.track;
  if (!track) return null;
  return (
    <>
      {!p.expanded && <section aria-label={t`Music player`}
        className="tsugi-mini-player oto-mini-player fixed inset-x-0 bottom-0 z-30"
        style={{backgroundColor: palette.surface, borderColor: palette.border}}>
        <div className="tsugi-mini-player-grid">
          <button type="button" onClick={() => p.onExpanded(true)}
            className="tsugi-mini-track flex min-w-0 items-center gap-3 text-left focus-visible:outline focus-visible:outline-2">
            <Artwork track={track} />
            <span className="min-w-0 flex-1">
              <span className="tsugi-mini-title block truncate font-semibold">{track.title}</span>
              {track.artist && <span className="tsugi-mini-artist block truncate">{track.artist}</span>}
              {(p.sourceName || p.quality) && <span className="tsugi-mini-meta block truncate">{[p.sourceName, p.quality].filter(Boolean).join(' · ')}</span>}
            </span>
          </button>
          <div className="tsugi-mini-transport flex w-full flex-col items-center gap-1">
            <Transport p={p} palette={palette} />
            <Timeline p={p} palette={palette} />
          </div>
          <div className="tsugi-mini-tools flex items-center justify-self-end gap-3">
            {p.canDownload&&<button type="button" className={buttonClass} aria-label={t`Download track`} title={t`Download track`} onClick={()=>setDownloadTrack({id:track.id,title:track.title})}><BrushDownload aria-hidden className="text-lg"/></button>}
            {p.canFavorite && <button type="button" className={buttonClass} onClick={p.onFavorite}
              aria-label={t`Save playing track`} aria-pressed={p.isFavorite}>
              <FiHeart aria-hidden className="text-lg" fill={p.isFavorite ? 'currentColor' : 'none'} />
            </button>}
            <details className="tsugi-mini-queue" data-ui="mini-queue">
              <summary className="tsugi-control" aria-label={t`Playback queue`}>
                <FiList aria-hidden /><span className="tsugi-mini-queue-count">{p.queue.length}</span>
              </summary>
              <div className="tsugi-mini-queue-panel">
                <PlaybackQueue p={p} onSelect={event => event.currentTarget.closest('details')?.removeAttribute('open')} />
              </div>
            </details>
            <div className="tsugi-mini-volume">
              <VolumeControl compact value={p.volume} onChange={p.onVolume} />
            </div>
            <button type="button" className={`${buttonClass} oto-mini-settings`} aria-label={t`Player settings`} title={t`Player settings`} onClick={() => { p.onExpanded(true); setSettingsOpen(true); }}><BrushSettings aria-hidden /></button>
            <button type="button" onClick={() => p.onExpanded(true)} aria-label={t`Expand player`}
              className={buttonClass}><FiMaximize2 aria-hidden className="text-xl" /></button>
          </div>
        </div>
        {(p.loading || p.error) && (
          <p role={p.error ? 'alert' : 'status'} className="mt-2 text-center text-xs text-amber-200">
            {p.error || <Trans>Resolving audio…</Trans>}
          </p>
        )}
      </section>}
      {p.expanded && (
        <section role="dialog" aria-modal="true" aria-label={t`Now playing`}
          data-stage={stageId} className="tsugi-player-dialog oto-player fixed inset-0 z-50 overflow-y-auto"
          style={{backgroundColor:palette.canvas}}>
          {stageId === 'imported' && <div aria-hidden className="tsugi-player-ambient" />}
          <div className="tsugi-player-shell flex min-h-dvh w-full flex-col px-[3vw] pb-10 pt-14">
            <header className="tsugi-player-hud relative z-40 flex min-h-12 items-center justify-between gap-6">
              <button type="button" className={buttonClass}
                aria-label={t`Minimise player`} onClick={() => p.onExpanded(false)}>
                <FiChevronDown aria-hidden className="text-2xl" />
              </button>
              <div className="tsugi-player-brand"><TsugiBrand className="tsugi-player-signature" /><span className="tsugi-player-section"><Trans>Music</Trans></span></div>
              {showHeader && (
                <div className="oto-player-context min-w-0 text-center">
                  <p className="text-xs font-semibold uppercase tracking-widest text-[--tsugi-muted]">
                    <Trans>Now playing</Trans>
                  </p>
                  <p className="truncate text-sm">{p.sourceName}</p>
                </div>
              )}
              <div className="flex items-center gap-2">{p.canDownload&&<button type="button" className={buttonClass} aria-label={t`Download track`} title={t`Download track`} onClick={()=>setDownloadTrack({id:track.id,title:track.title})}><BrushDownload aria-hidden className="text-xl"/></button>}
              <button type="button" className={buttonClass}
                aria-label={t`Player settings`} onClick={() => setSettingsOpen(true)}>
                <BrushSettings aria-hidden className="text-xl" />
              </button></div>
            </header>
            {importError && <p role="alert" className="mt-4 text-sm text-amber-200">{importError}</p>}
            {template ? (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center py-4">
                <EclipseStudioStage p={p} template={template} palette={palette}
                  contained={studioContained} />
                {(p.loading || p.error) && (
                  <p role={p.error ? 'alert' : 'status'} className="mt-3 text-sm text-amber-200">
                    {p.error || <Trans>Resolving audio…</Trans>}
                  </p>
                )}
              </div>
            ) : <JunctionPlayer key={stageId} p={p} palette={palette} matrixMode={matrixMode} layout={stageId === 'imported' ? 'default' : stageId} />}
          </div>
          {settingsOpen && (
            <PlayerSettings onClose={() => setSettingsOpen(false)}
              stage={stageId} onStage={changeStage}
              importedName={importedTemplate?.name || (importedTemplate ? t`Imported Studio layout` : undefined)}
              audioProfile={p.audioProfile} onAudioProfile={p.onAudioProfile}
              eqEnabled={p.eqEnabled} eqAvailable={p.eqAvailable}
              onEqEnabled={p.onEqEnabled} eqError={p.eqError}
              matrixMode={matrixMode} onMatrixMode={(value) => { setMatrixMode(value); saveMatrixMode(value); }}
              showHeader={showHeader}
              studioContained={studioContained}
              onStudioContained={(value) => {
                setStudioContained(value);
                storage.set('tsugi-studio-contained-v1', value);
              }}
              onShowHeader={(value) => {
                setShowHeader(value);
                storage.set('tsugi-player-header-visible-v1', value);
              }}
              onImport={(event) => { void importLayout(event); }} />
          )}
        </section>
      )}
      {downloadTrack&&<TrackDownload track={downloadTrack} onClose={()=>setDownloadTrack(null)}/>}
    </>
  );
}
