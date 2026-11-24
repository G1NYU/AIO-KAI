import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { themeVariables } from '@aiostreams/ui/utils/palette';
import { PLAYER_PALETTES, readPlayerTheme, savePlayerTheme, isPlayerTheme, type PlayerThemeId } from '@/lib/music/player-theme';
import { applyEclipseAppearance, deriveEclipseAppearance } from '@/lib/music/eclipse-appearance';
import { readPlayerStage } from '@/lib/music/player-layout';
import { storage } from '@/lib/storage';

const IMPORT_COLORS_KEY = 'tsugi-global-import-colors-v1';
const importedColors = () => storage.get<boolean>(IMPORT_COLORS_KEY) !== false;
const announce = (theme: PlayerThemeId) => window.dispatchEvent(new CustomEvent('tsugi-theme-change', { detail: theme }));

/** One root palette for all desktop media areas. */
export function applyGlobalAppearance(root = document.documentElement) {
  const theme = readPlayerTheme();
  const palette = PLAYER_PALETTES[theme];
  const stage = readPlayerStage();
  const useImported = importedColors() && stage.id === 'imported' && !!stage.template;
  root.dataset.tsugiTheme = theme;
  applyEclipseAppearance(useImported ? stage : { id: 'default', imported: null, template: null }, root);
  const a = useImported && stage.template ? deriveEclipseAppearance(stage.template) : palette;
  const border = useImported ? 'color-mix(in srgb, ' + a.foreground + ' 12%, ' + a.canvas + ')' : palette.border;
  const vars = { ...themeVariables({ background: a.canvas, accent: a.accent }),
    '--background': a.canvas, '--foreground': a.foreground, '--paper': a.panel, '--brand': a.accent,
    '--ring': a.accent, '--border': border, '--muted': a.muted,
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
  const [useImported, setUseImported] = React.useState(importedColors);
  const [hasImported, setHasImported] = React.useState(() => readPlayerStage().id === 'imported');
  React.useEffect(() => {
    const sync = () => { setTheme(readPlayerTheme()); setUseImported(importedColors()); setHasImported(readPlayerStage().id === 'imported'); };
    window.addEventListener('tsugi-theme-change', sync);
    window.addEventListener('tsugi-eclipse-appearance-change', sync);
    return () => { window.removeEventListener('tsugi-theme-change', sync); window.removeEventListener('tsugi-eclipse-appearance-change', sync); };
  }, []);
  function choose(id: PlayerThemeId) {
    if (!isPlayerTheme(id)) return;
    savePlayerTheme(id);
    announce(id);
  }
  return <section className="tsugi-global-appearance">
    <h3><Trans id="Appearance">Appearance</Trans></h3>
    <p><Trans id="One palette for Movies & TV, Music and Read.">One palette for Movies &amp; TV, Music and Read.</Trans></p>
    <div className="tsugi-global-palettes">{(Object.keys(PLAYER_PALETTES) as PlayerThemeId[]).map((id) => {
      const p = PLAYER_PALETTES[id];
      const label = id === 'mocha' ? t({ id: "Mocha", message: "Mocha" }) : id === 'matte' ? t({ id: "Matte black", message: "Matte black" }) : id === 'aio-dark' ? t({ id: "Ink", message: "Ink" }) : id === 'nightfall' ? t({ id: "Nightfall", message: "Nightfall" }) : t({ id: "Carbon", message: "Carbon" });
      return <button type="button" key={id} aria-pressed={theme === id && !(hasImported && useImported)} onClick={() => choose(id)}><span className="tsugi-global-swatch" style={{ background:p.canvas, borderColor:p.border }}><i style={{ background:p.accent }} /></span>{label}</button>;
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
