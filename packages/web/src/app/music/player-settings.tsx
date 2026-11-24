import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { FiX } from 'react-icons/fi';
import type { PlayerStageId } from '@/lib/music/player-layout';
import { PLAYER_PALETTES, type PlayerThemeId } from '@/lib/music/player-theme';

export function PlayerSettings({
  onClose, stage, onStage, importedName, theme, onTheme,
  showHeader, onShowHeader, onImport,
}: {
  onClose(): void;
  stage: PlayerStageId;
  onStage(value: PlayerStageId): void;
  importedName?: string;
  theme: PlayerThemeId;
  onTheme(value: PlayerThemeId): void;
  showHeader: boolean;
  onShowHeader(value: boolean): void;
  onImport(event: React.ChangeEvent<HTMLInputElement>): void;
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
        </label>

        <label className="mb-8 block text-sm">
          <span className="mb-2 block text-[--tsugi-muted]"><Trans>Player theme</Trans></span>
          <select value={theme} onChange={(event) => onTheme(event.target.value as PlayerThemeId)}
            className="tsugi-menu-select w-full">
            {(Object.keys(PLAYER_PALETTES) as PlayerThemeId[]).map((id) => (
              <option key={id} value={id}>
                {id === 'mocha' ? t`Mocha` : id === 'matte' ? t`Matte black`
                  : id === 'aio-dark' ? t`Ink` : id === 'nightfall' ? t`Nightfall` : t`Carbon`}
              </option>
            ))}
          </select>
        </label>

        <label className="tsugi-primary-action inline-flex cursor-pointer items-center gap-2 text-sm">
          <Trans>Import Studio layout</Trans>
          <input type="file" accept=".eclipseplayer,application/json" className="sr-only"
            onChange={onImport} />
        </label>
      </aside>
    </div>
  );
}
