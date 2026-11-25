import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { themeVariables } from '@aiostreams/ui/utils/palette';
import { PLAYER_PALETTES, readPlayerTheme, savePlayerTheme, isPlayerTheme, type PlayerThemeId, PLAYER_ACCENTS, readPlayerAccent, savePlayerAccent, withPlayerAccent, type PlayerPalette, type PlayerAccentId } from '@/lib/music/player-theme';
import { applyEclipseAppearance, deriveEclipseAppearance } from '@/lib/music/eclipse-appearance';
import { readPlayerStage } from '@/lib/music/player-layout';
import { storage } from '@/lib/storage';

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
export function GlobalSettingsDialog({open,onClose}:{open:boolean;onClose():void}) {
  const dialog = React.useRef<HTMLDialogElement>(null);
  React.useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    else if (!open && node.open) node.close();
  }, [open]);
  return <dialog ref={dialog} className="tsugi-global-settings" onCancel={(event) => { event.preventDefault(); onClose(); }} aria-labelledby="tsugi-app-settings-title">
    <header><h2 id="tsugi-app-settings-title"><Trans id="App settings">App settings</Trans></h2><button className="tsugi-read-action" onClick={onClose}><Trans id="Close">Close</Trans></button></header>
    <GlobalAppearanceSettings />
  </dialog>;
}
