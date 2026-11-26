import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { FiX } from 'react-icons/fi';
import type { MatrixMode } from './pixel-matrix';
import type { PlayerStageId } from '@/lib/music/player-layout';
import { AUDIO_PROFILES, type AudioProfile } from '@/lib/music/audio-profiles';
import { GlobalAppearanceSettings } from '@/components/shell/global-settings';

export function PlayerSettings({
  onClose, stage, onStage, importedName,
  showHeader, onShowHeader, studioContained, onStudioContained, onImport, matrixMode, onMatrixMode,
  audioProfile, onAudioProfile, eqEnabled, eqAvailable, onEqEnabled, eqError,
}: {
  onClose(): void;
  stage: PlayerStageId;
  onStage(value: PlayerStageId): void;
  importedName?: string;
  matrixMode: MatrixMode;
  onMatrixMode(value: MatrixMode): void;
  showHeader: boolean;
  onShowHeader(value: boolean): void;
  studioContained: boolean;
  onStudioContained(value: boolean): void;
  onImport(event: React.ChangeEvent<HTMLInputElement>): void;
  audioProfile: AudioProfile;
  onAudioProfile(profile: AudioProfile): void;
  eqEnabled: boolean;
  eqAvailable: boolean;
  onEqEnabled(value: boolean): void;
  eqError: string;
}) {
  const closeRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => closeRef.current?.focus(), []);

  return (
    <div className="tsugi-settings-backdrop fixed inset-0 z-[60] flex justify-end"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}>
      <aside role="dialog" aria-modal="true" aria-label={t`Player settings`}
        className="tsugi-settings-sheet h-full w-full max-w-[440px] overflow-y-auto px-7 pb-14 pt-14">
        <div className="mb-9 flex items-center justify-between gap-5">
          <h2 className="text-2xl font-semibold"><Trans>Player settings</Trans></h2>
          <button ref={closeRef} type="button" className="tsugi-icon-action"
            onClick={onClose} aria-label={t`Close`}>
            <FiX aria-hidden className="text-xl" />
          </button>
        </div>

        <label className="mb-9 flex items-center justify-between gap-4 text-sm">
          <Trans>Show player header</Trans>
          <input type="checkbox" checked={showHeader}
            onChange={(event) => onShowHeader(event.target.checked)}
            className="size-4" style={{accentColor:'var(--tsugi-accent)'}} />
        </label>

        {stage === 'imported' && <label className="mb-9 flex items-center justify-between gap-4 text-sm">
          <Trans>Fit Studio layout inside window</Trans>
          <input type="checkbox" checked={studioContained}
            onChange={(event) => onStudioContained(event.target.checked)}
            className="size-4" style={{accentColor:'var(--tsugi-accent)'}} />
        </label>}

        <label className="mb-8 block text-sm">
          <span className="mb-2 block text-[--tsugi-muted]"><Trans>Layout</Trans></span>
          <select aria-label={t`Player layout`} value={stage}
            onChange={(event) => onStage(event.target.value as PlayerStageId)}
            className="tsugi-menu-select w-full">
            <option value="default">{t`Default`}</option>
            <option value="junction">{t`Junction`}</option>
            <option value="nocturne">{t`Nocturne`}</option>
            {importedName && <option value="imported">{importedName}</option>}
          </select>
          <span className="mt-2 block text-xs leading-5 text-[--tsugi-muted]">
            {stage === 'default' ? <Trans>Large artwork and full-window listening controls.</Trans> : stage === 'junction' ? <Trans>Wide split workspace for artwork, lyrics and queue.</Trans> : stage === 'nocturne' ? <Trans>Full-bleed album backdrop, large cover and cinematic listening console.</Trans> : <Trans>Custom imported Studio composition.</Trans>}
          </span>
        </label>

        {stage !== 'imported' && <label className="mb-8 block text-sm">
          <span className="mb-2 block text-[--tsugi-muted]"><Trans>Pixel matrix</Trans></span>
          <select aria-label={t`Pixel matrix`} className="tsugi-menu-select w-full" value={matrixMode} onChange={event => onMatrixMode(event.target.value as MatrixMode)}>
            <option value="immersive">{t`Immersive`}</option>
            <option value="minimal">{t`Minimal`}</option>
            <option value="wave">{t`Dot wave`}</option>
            <option value="off">{t`Off`}</option>
          </select>
          <span className="mt-2 block text-xs leading-5 text-[--tsugi-muted]"><Trans>Immersive fills the background; Minimal uses a sparse lower field. Dot wave follows actual local waveform or native audio levels. Unsupported streams show no reactive wave. Reduced motion is respected.</Trans></span>
        </label>}
        <div className="mb-8 border-t border-[--tsugi-line] pt-8"><GlobalAppearanceSettings /></div>

        <section className="mb-9 border-t border-[--tsugi-line] pt-8" aria-label={t`Audio profiles`}>
          <h3 className="mb-5 text-lg font-semibold"><Trans>Audio profiles</Trans></h3>
          <label className="mb-6 block text-sm">
            <span className="mb-2 block text-[--tsugi-muted]"><Trans>Sound profile</Trans></span>
            <select className="tsugi-menu-select w-full" value={audioProfile}
              onChange={(event) => onAudioProfile(event.target.value as AudioProfile)}>
              {(Object.keys(AUDIO_PROFILES) as AudioProfile[]).map(id => (
                <option key={id} value={id}>
                  {id === 'flat' ? t`Flat` : id === 'warm' ? t`Warm`
                    : id === 'bass' ? t`Bass boost` : id === 'vocal' ? t`Vocal clarity`
                      : t`Bright`}
                </option>
              ))}
            </select>
          </label>
          <dl className="oto-eq-preview" aria-label={t`Three-band profile gains`}>
            {([
              { label:t`Low`, value:AUDIO_PROFILES[audioProfile].low },
              { label:t`Mid`, value:AUDIO_PROFILES[audioProfile].mid },
              { label:t`High`, value:AUDIO_PROFILES[audioProfile].high },
            ]).map(band => <div key={band.label}>
              <dt>{band.label}</dt>
              <dd>{band.value > 0 ? '+' : ''}{band.value} <Trans>dB</Trans></dd>
              <meter min={-6} max={6} value={band.value} aria-label={band.label} />
            </div>)}
          </dl>
          <label className="flex items-center justify-between gap-5 text-sm">
            <Trans>Enable equalizer</Trans>
            <input type="checkbox" className="size-4" disabled={!eqAvailable}
              checked={eqAvailable && eqEnabled}
              onChange={(event) => onEqEnabled(event.target.checked)}
              style={{accentColor:'var(--tsugi-accent)'}} />
          </label>
          <p className="mt-4 text-xs leading-5 text-[--tsugi-muted]">
            <Trans>The equalizer supports local audio and the Windows native YouTube Music engine. Other remote addon streams remain unmodified to avoid cross-origin audio interruptions.</Trans>
          </p>
          {eqError && <p role="alert" className="mt-3 text-xs text-amber-200">{eqError}</p>}
        </section>

        <label className="tsugi-primary-action inline-flex cursor-pointer items-center gap-2 text-sm">
          <Trans>Import Studio layout</Trans>
          <input type="file" accept=".eclipseplayer,application/json" className="sr-only"
            onChange={onImport} />
        </label>
      </aside>
    </div>
  );
}
