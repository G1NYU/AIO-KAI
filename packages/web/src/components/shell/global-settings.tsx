import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { themeVariables } from '@aiostreams/ui/utils/palette';
import { PLAYER_PALETTES, readPlayerTheme, savePlayerTheme, isPlayerTheme, type PlayerThemeId, PLAYER_ACCENTS, readPlayerAccent, savePlayerAccent, withPlayerAccent, type PlayerPalette, type PlayerAccentId } from '@/lib/music/player-theme';
import { applyEclipseAppearance, deriveEclipseAppearance } from '@/lib/music/eclipse-appearance';
import { readPlayerStage, savePlayerStage, readMatrixMode, saveMatrixMode, type PlayerStageId } from '@/lib/music/player-layout';
import type { MatrixMode } from '@/app/music/pixel-matrix';
import { notifyEclipseAppearance } from '@/lib/music/eclipse-appearance';
import { storage } from '@/lib/storage';
import { readStartupArea, saveStartupArea, type StartupArea } from '@/lib/desktop-area';
import { appBridge } from '@/lib/hosts/shell/bridge';
import { PreferencesBackupSettings } from './preferences-backup-settings';
import { MusicBackupSettings } from './music-backup-settings';
import { BookBackupSettings } from './book-backup-settings';
import { MangaBackupSettings } from './manga-backup-settings';
import { PortableArchiveSettings } from './portable-archive-settings';
import { StorageUsageSettings } from './storage-usage-settings';
import { TsugiReleaseSettings } from './tsugi-release-settings';
import type { ArchiveKind, PortableArchive } from '@/lib/backup/archive';

const IMPORT_COLORS_KEY = 'tsugi-global-import-colors-v1';
const importedColors = () => storage.get<boolean>(IMPORT_COLORS_KEY) !== false;
const announce = (theme: PlayerThemeId) => window.dispatchEvent(new CustomEvent('tsugi-theme-change', { detail: theme }));

export function resolveGlobalPalette(): PlayerPalette {
  const palette = PLAYER_PALETTES[readPlayerTheme()];
  const stage = readPlayerStage();
  const imported = importedColors() && stage.id === 'imported' && stage.template ? deriveEclipseAppearance(stage.template) : null;
  const base = imported ? { ...palette, ...imported, border: 'color-mix(in srgb, ' + imported.foreground + ' 12%, ' + imported.canvas + ')' } : palette;
  return withPlayerAccent(base, readPlayerAccent());
}

/** One root palette for all desktop media areas. */
export function applyGlobalAppearance(root = document.documentElement) {
  const theme = readPlayerTheme();
  const stage = readPlayerStage();
  const useImported = importedColors() && stage.id === 'imported' && !!stage.template;
  root.dataset.tsugiTheme = theme;
  applyEclipseAppearance(useImported ? stage : { id: 'default', imported: null, template: null }, root);
  const a = resolveGlobalPalette();
  const border = a.border;
  const focus = useImported ? a.foreground : '#D5D5DC';
  root.dataset.tsugiAccent = readPlayerAccent();
  const vars = { ...themeVariables({ background: a.canvas, accent: a.accent }),
    '--background': a.canvas, '--foreground': a.foreground, '--paper': a.panel, '--brand': a.accent,
    '--ring': focus, '--tsugi-focus': focus, '--tsugi-on-accent': a.accentText, '--border': border, '--muted': a.muted,
    '--tsugi-canvas': a.canvas, '--tsugi-surface': a.surface, '--tsugi-panel': a.panel,
    '--tsugi-ink': a.foreground, '--tsugi-muted': a.muted, '--tsugi-accent': a.accent,
    '--tsugi-line': border, '--tsugi-wash': 'color-mix(in srgb, ' + a.foreground + ' 7%, ' + a.canvas + ')',
    '--tsugi-glass': a.panel,
    '--tsugi-row': a.surface,
    '--tsugi-row-alt': 'color-mix(in srgb, ' + a.surface + ' 95%, ' + a.foreground + ')',
    '--tsugi-row-hover': 'color-mix(in srgb, ' + a.surface + ' 90%, ' + a.foreground + ')',
    '--tsugi-row-active': 'color-mix(in srgb, ' + a.surface + ' 86%, ' + a.accent + ')',
    '--tsugi-raised': a.panel,
  };
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value);
}

export function GlobalAppearance() {
  React.useLayoutEffect(() => {
    const update = () => applyGlobalAppearance();
    update();
    window.addEventListener('tsugi-theme-change', update);
    window.addEventListener('tsugi-eclipse-appearance-change', update);
    return () => {
      window.removeEventListener('tsugi-theme-change', update);
      window.removeEventListener('tsugi-eclipse-appearance-change', update);
    };
  }, []);
  return null;
}

export function GlobalAppearanceSettings() {
  const [theme, setTheme] = React.useState(readPlayerTheme);
  const [accent, setAccent] = React.useState(readPlayerAccent);
  const [useImported, setUseImported] = React.useState(importedColors);
  const [hasImported, setHasImported] = React.useState(() => readPlayerStage().id === 'imported');
  React.useEffect(() => {
    const sync = () => { setTheme(readPlayerTheme()); setAccent(readPlayerAccent()); setUseImported(importedColors()); setHasImported(readPlayerStage().id === 'imported'); };
    window.addEventListener('tsugi-theme-change', sync);
    window.addEventListener('tsugi-eclipse-appearance-change', sync);
    return () => { window.removeEventListener('tsugi-theme-change', sync); window.removeEventListener('tsugi-eclipse-appearance-change', sync); };
  }, []);
  function choose(id: PlayerThemeId) {
    if (!isPlayerTheme(id)) return;
    // Choosing an explicit palette must take effect even with a saved imported layout.
    storage.set(IMPORT_COLORS_KEY, false);
    savePlayerTheme(id);
    announce(id);
  }
  return <section className="tsugi-global-appearance">
    <h3><Trans id="Appearance">Appearance</Trans></h3>
    <p><Trans>One palette for Movies &amp; TV, Music, Read and Vault.</Trans></p>
    <div className="tsugi-global-palettes">{(Object.keys(PLAYER_PALETTES) as PlayerThemeId[]).map((id) => {
      const p = PLAYER_PALETTES[id];
      const label = id === 'sumi' ? t({ id: "Default", message: "Default" }) : id === 'mocha' ? t({ id: "Mocha", message: "Mocha" }) : id === 'matte' ? t({ id: "Matte black", message: "Matte black" }) : id === 'aio-dark' ? t({ id: "Ink", message: "Ink" }) : id === 'nightfall' ? t({ id: "Nightfall", message: "Nightfall" }) : t({ id: "Carbon", message: "Carbon" });
      return <button type="button" key={id} aria-pressed={theme === id && !(hasImported && useImported)} onClick={() => choose(id)}><span className="tsugi-global-swatch" style={{ background:p.canvas, borderColor:p.border }}><i style={{ background:p.accent }} /></span>{label}</button>;
    })}</div>
    <h3 className="tsugi-accent-heading"><Trans id="Accent">Accent</Trans></h3>
    <div className="tsugi-accent-options">{(Object.keys(PLAYER_ACCENTS) as PlayerAccentId[]).map(id => {
      const label = id === 'silver' ? t({ id: "Silver", message: "Silver" }) : id === 'blue' ? t({ id: "Blue", message: "Blue" }) : id === 'lavender' ? t({ id: "Lavender", message: "Lavender" }) : id === 'amber' ? t({ id: "Amber", message: "Amber" }) : t({ id: "Rose", message: "Rose" });
      return <button type="button" key={id} aria-pressed={accent === id} onClick={() => { savePlayerAccent(id); announce(theme); }}><i aria-hidden style={{ background: PLAYER_ACCENTS[id] }} />{label}</button>;
    })}</div>
    {hasImported && <label className="flex items-center gap-3"><input type="checkbox" checked={useImported} onChange={(event) => { storage.set(IMPORT_COLORS_KEY, event.target.checked); announce(theme); }} /><Trans id="Use imported player layout colours throughout Tsugi">Use imported player layout colours throughout Tsugi</Trans></label>}
  </section>;
}
export function GlobalSettingsDialog({open,onClose,hasReadSection=false}:{open:boolean;onClose():void;hasReadSection?:boolean}) {
  const [archive,setArchive]=React.useState<PortableArchive|null>(null);
  const archived=(kind:ArchiveKind)=>archive?.entries.find(entry=>entry.kind===kind)?.payload;
  const [startup,setStartup] = React.useState(readStartupArea);
  const [layout,setLayout] = React.useState(() => readPlayerStage().id);
  const [matrix,setMatrix] = React.useState<MatrixMode>(readMatrixMode);
  const bridge = appBridge();
  const dialog = React.useRef<HTMLDialogElement>(null);
  React.useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) {
      setLayout(readPlayerStage().id);
      setMatrix(readMatrixMode());
      node.showModal();
    }
    else if (!open && node.open) node.close();
  }, [open]);
  return <dialog ref={dialog} className="tsugi-global-settings" onCancel={(event) => { event.preventDefault(); onClose(); }} aria-labelledby="tsugi-app-settings-title">
    <header><h2 id="tsugi-app-settings-title"><Trans id="App settings">App settings</Trans></h2><button className="tsugi-read-action" onClick={onClose}><Trans id="Close">Close</Trans></button></header>
    <section className="tsugi-app-general" aria-label={t`General preferences`}>
      <h3><Trans>General</Trans></h3>
      <label><Trans>Open on startup</Trans>
        <select className="tsugi-menu-select w-full" value={startup === 'read' && !hasReadSection ? 'auto' : startup} onChange={event => {
          const value = event.target.value as StartupArea;
          saveStartupArea(value);
          setStartup(value);
        }}>
          <option value="auto">{t`Automatic (recommended)`}</option>
          <option value="welcome">{t`Media index`}</option>
          <option value="video">{t`Movies & TV`}</option>
          <option value="music">{t`Music`}</option>
          {hasReadSection && <option value="read">{t`Read`}</option>}
          <option value="vault">{t`Vault`}</option>
        </select>
      </label>
      <p><Trans>Applies the next time Tsugi opens. Each media section keeps its own source, reading, playback and transfer settings.</Trans></p>
    </section>
    <section className="tsugi-app-general" aria-label={t`Music playback preferences`}>
      <h3><Trans>Music playback</Trans></h3>
      <label><Trans>Default player layout</Trans>
        <select className="tsugi-menu-select w-full" value={layout} onChange={event => {
          const value = event.target.value as PlayerStageId;
          savePlayerStage(value, readPlayerStage().imported);
          setLayout(value);
          notifyEclipseAppearance();
          window.dispatchEvent(new Event('tsugi-player-preferences-change'));
        }}>
          <option value="default">{t`Default`}</option>
          <option value="junction">{t`Junction`}</option>
          <option value="nocturne">{t`Nocturne`}</option>
          {readPlayerStage().template && <option value="imported">{t`Imported Studio layout`}</option>}
        </select>
      </label>
      <label><Trans>Default visualizer</Trans>
        <select className="tsugi-menu-select w-full" value={matrix} onChange={event => {
          const value = event.target.value as MatrixMode;
          saveMatrixMode(value);
          setMatrix(value);
          window.dispatchEvent(new Event('tsugi-player-preferences-change'));
        }}>
          <option value="immersive">{t`Immersive`}</option>
          <option value="minimal">{t`Minimal`}</option>
          <option value="wave">{t`Dot wave`}</option>
          <option value="off">{t`Off`}</option>
        </select>
      </label>
      <p><Trans>Choose how the expanded player opens. Imported layouts retain their own composition.</Trans></p>
    </section>
    <GlobalAppearanceSettings />
    <PortableArchiveSettings archive={archive} onArchive={setArchive} />
    <PreferencesBackupSettings archiveEntry={archived('preferences')} onApplied={()=>{
      setStartup(readStartupArea()); setLayout(readPlayerStage().id); setMatrix(readMatrixMode());
      announce(readPlayerTheme()); notifyEclipseAppearance();
      window.dispatchEvent(new Event('tsugi-player-preferences-change'));
    }} />
    <MusicBackupSettings archiveEntry={archived('music')} />
    <BookBackupSettings archiveEntry={archived('books')} />
    <MangaBackupSettings archiveEntry={archived('manga')} />
    <StorageUsageSettings />
    <TsugiReleaseSettings />
    <section className="tsugi-app-about" aria-label={t`About Tsugi`}>
      <h3 className="font-semibold text-[--tsugi-ink]"><Trans>About Tsugi</Trans></h3>
      {bridge?.version && <p><Trans>Native engine version</Trans> · {bridge.version}</p>}
      <p><Trans>Open-source desktop media workspace. Music sources and server connections are managed in their respective sections.</Trans></p>
      <a className="text-[--tsugi-accent] underline" href="https://github.com/G1NYU/TSUGI" target="_blank" rel="noopener noreferrer"><Trans>Project and documentation</Trans></a>
    </section>
  </dialog>;
}
