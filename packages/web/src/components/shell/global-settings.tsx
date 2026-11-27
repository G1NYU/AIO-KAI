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
import { MihonImportSettings } from './mihon-import-settings';
import { PortableArchiveSettings } from './portable-archive-settings';
import { StorageUsageSettings } from './storage-usage-settings';
import { TsugiReleaseSettings } from './tsugi-release-settings';
import { DiscordPresenceSettings } from './discord-presence-settings';
import { StremioAddonSettings } from './stremio-addon-settings';
import { FirstVersionSwitch } from '@/app/settings/_components/first-version-switch';
import { SupportSummarySettings } from './support-summary-settings';
import { Licenses } from '@/app/settings/_components/licenses';
import { TsugiIcon } from '@/components/tsugi-icons';
import { buildSupportSummary } from '@/lib/support-summary';
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
      const label = id === 'coral' ? t`Coral` : id === 'silver' ? t({ id: "Silver", message: "Silver" }) : id === 'blue' ? t({ id: "Blue", message: "Blue" }) : id === 'lavender' ? t({ id: "Lavender", message: "Lavender" }) : id === 'amber' ? t({ id: "Amber", message: "Amber" }) : t({ id: "Rose", message: "Rose" });
      return <button type="button" key={id} aria-pressed={accent === id} onClick={() => { savePlayerAccent(id); announce(theme); }}><i aria-hidden style={{ background: PLAYER_ACCENTS[id] }} />{label}</button>;
    })}</div>
    {hasImported && <label className="flex items-center gap-3"><input type="checkbox" checked={useImported} onChange={(event) => { storage.set(IMPORT_COLORS_KEY, event.target.checked); announce(theme); }} /><Trans id="Use imported player layout colours throughout Tsugi">Use imported player layout colours throughout Tsugi</Trans></label>}
  </section>;
}
export function GlobalSettingsDialog({open,onClose,hasReadSection=false}:{open:boolean;onClose():void;hasReadSection?:boolean}) {
  const [archive,setArchive]=React.useState<PortableArchive|null>(null);
  const [licensesOpen,setLicensesOpen]=React.useState(false);
  const licenseId=React.useId();
  const archived=(kind:ArchiveKind)=>archive?.entries.find(entry=>entry.kind===kind)?.payload;
  const [startup,setStartup] = React.useState(readStartupArea);
  const [layout,setLayout] = React.useState(() => readPlayerStage().id);
  const [matrix,setMatrix] = React.useState<MatrixMode>(readMatrixMode);
  const bridge = appBridge();
  const dialog = React.useRef<HTMLDialogElement>(null);
  const build=buildSupportSummary({webBuild:__APP_COMMIT__,webVersion:__APP_VERSION__,bridge,infoStatus:'unavailable'});
  const repo='https://github.com/G1NYU/TSUGI';
  const revision=build.web.build?.split(' ')[0];
  const source=revision?repo+'/tree/'+revision:repo+'/tree/feature/tsugi-read-runtime';
  const file=(path:string)=>repo+'/blob/'+(revision||'feature/tsugi-read-runtime')+'/'+path;
  React.useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) {
      setLayout(readPlayerStage().id);
      setMatrix(readMatrixMode());
      node.showModal();
    }
    else if (!open && node.open) {node.close();setLicensesOpen(false);}
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
    {bridge?.stremioAddons&&<section className="tsugi-app-general" aria-label={t`Watch playback preferences`}><h3><Trans>Playback</Trans></h3><FirstVersionSwitch/></section>}
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
    <DiscordPresenceSettings />
    {open && bridge?.stremioAddons && <StremioAddonSettings />}
    <PortableArchiveSettings archive={archive} onArchive={setArchive} />
    {/* Closing or replacing an archive invalidates every unconfirmed section review. */}
    <React.Fragment key={archive?.entries.map(entry=>entry.sha256).join(':')??'standalone'}>
      <PreferencesBackupSettings archiveEntry={archived('preferences')} onApplied={()=>{
        setStartup(readStartupArea()); setLayout(readPlayerStage().id); setMatrix(readMatrixMode());
        announce(readPlayerTheme()); notifyEclipseAppearance();
        window.dispatchEvent(new Event('tsugi-player-preferences-change'));
      }} />
      <MusicBackupSettings archiveEntry={archived('music')} />
      <BookBackupSettings archiveEntry={archived('books')} />
      <MangaBackupSettings archiveEntry={archived('manga')} />
    </React.Fragment>
    <MihonImportSettings />
    <StorageUsageSettings />
    <TsugiReleaseSettings />
    <section className="tsugi-app-general" data-ui="tsugi-report-bugs" aria-label={t`Report bugs`}>
      <h3 className="flex items-center gap-2"><TsugiIcon name="cicada" className="h-5 w-5 flex-none"/><Trans>Report bugs</Trans></h3>
      <p><Trans>Found a cicada? Search existing issues first, then describe the steps to reproduce the problem, what happened and what you expected.</Trans></p>
      <p><Trans>GitHub issues are public. Review screenshots and logs before sharing. Never include passwords, API keys, configured addon links, tokens or private media URLs.</Trans></p>
      <div className="flex flex-wrap gap-4">
        <a className="text-[--tsugi-accent] underline" href={repo+'/issues'} target="_blank" rel="noopener noreferrer"><Trans>Browse known issues</Trans></a>
        <a className="text-[--tsugi-accent] underline" href={repo+'/issues/new/choose'} target="_blank" rel="noopener noreferrer"><Trans>Report a bug</Trans></a>
        <a className="text-[--tsugi-accent] underline" href={file('docs/support.md')} target="_blank" rel="noopener noreferrer"><Trans>Reporting guide</Trans></a>
      </div>
      <p><Trans>Use Diagnostics below to create and review a safe build summary. Nothing is uploaded by this section.</Trans></p>
    </section>
    <SupportSummarySettings />
    <section className="tsugi-app-about" data-ui="tsugi-about" aria-label={t`About Tsugi`}>
      <h3 className="font-semibold text-[--tsugi-ink]"><Trans>About Tsugi</Trans></h3>
      {build.web.version&&<p><Trans>Application version</Trans> · {build.web.version}</p>}
      {build.web.build&&<p><Trans>Web build</Trans> · {build.web.build}</p>}
      {build.native.bridgeVersion&&<p><Trans>Native engine version</Trans> · {build.native.bridgeVersion}</p>}
      <p><Trans>Open-source desktop media workspace maintained by giinyu, independently developed from AIOStreams. Tsugi does not provide media, subscriptions or bundled content sources.</Trans></p>
      <div className="flex flex-wrap gap-4">
        <a className="text-[--tsugi-accent] underline" href={repo} target="_blank" rel="noopener noreferrer"><Trans>Project and documentation</Trans></a>
        <a className="text-[--tsugi-accent] underline" href={source} target="_blank" rel="noopener noreferrer">{revision?<Trans>Source for this build</Trans>:<Trans>Development source</Trans>}</a>
        <a className="text-[--tsugi-accent] underline" href={repo+'/releases'} target="_blank" rel="noopener noreferrer"><Trans>Releases and changelog</Trans></a>
      </div>
      <h4 className="mt-4 font-semibold text-[--tsugi-ink]"><Trans>Credits and attribution</Trans></h4>
      <p><Trans>Built on the work of open-source maintainers, contributors and independent service developers. Tsugi is not affiliated with or endorsed by these projects.</Trans></p>
      <ul className="grid gap-2">
        {[
          ['AIOStreams','https://github.com/Viren070/AIOStreams',t`Upstream application`],
          ['Seanime','https://github.com/5rahim/seanime',t`Interface foundations`],
          // eslint-disable-next-line lingui/no-unlocalized-strings -- canonical project name; the role is translated below.
          ['Stremio','https://github.com/Stremio',t`Addon ecosystem`],
          // eslint-disable-next-line lingui/no-unlocalized-strings -- canonical project name; the role is translated below.
          ['Nuvio','https://github.com/NuvioMedia/NuvioDesktop',t`Addon account interoperability reference`],
          ['Jellyfin','https://jellyfin.org',t`Media server API`],
          ['mpv','https://mpv.io',t`Native playback`],
          ['FFmpeg','https://ffmpeg.org',t`Media processing`],
          ['yt-dlp','https://github.com/yt-dlp/yt-dlp',t`Music source tooling`],
          // eslint-disable-next-line lingui/no-unlocalized-strings -- canonical project name; the role is translated below.
          ['Suwayomi','https://github.com/Suwayomi/Suwayomi-Server',t`Reading runtime`],
          // eslint-disable-next-line lingui/no-unlocalized-strings -- canonical project name; the role is translated below.
          ['Mihon','https://github.com/mihonapp/mihon',t`Reading library interoperability`],
          // eslint-disable-next-line lingui/no-unlocalized-strings -- canonical project name; the role is translated below.
          ['Readest / Foliate','https://github.com/readest/foliate-js',t`Ebook rendering`],
          // eslint-disable-next-line lingui/no-unlocalized-strings -- canonical project name; the role is translated below.
          ['PDF.js','https://github.com/mozilla/pdf.js',t`PDF rendering`],
          // eslint-disable-next-line lingui/no-unlocalized-strings -- canonical project name; the role is translated below.
          ['Aria2 Next','https://github.com/AnInsomniacy/aria2-next',t`Managed transfers`],
          // eslint-disable-next-line lingui/no-unlocalized-strings -- canonical project name; the role is translated below.
          ['RE-Harbor','https://github.com/G1NYU/RE-Harbor',t`Refract tracking reference`],
        ].map(([name,url,role])=><li className="flex flex-wrap items-baseline gap-x-2" key={name}><a className="text-[--tsugi-accent] underline" href={url} target="_blank" rel="noopener noreferrer">{name}</a><span>{role}</span></li>)}
      </ul>
      <p><Trans>Thanks also to Refract, MDBList, Discord, Deno, libass, the Eclipse community and all contributors to the libraries and providers used by Tsugi.</Trans></p>
      <h4 className="mt-4 font-semibold text-[--tsugi-ink]"><Trans>Licenses and notices</Trans></h4>
      <p><Trans>Tsugi is licensed under the GNU Affero General Public License version 3 (AGPL-3.0), inherited from AIOStreams. It is provided without warranty. Third-party components retain their own licenses and source obligations.</Trans></p>
      <div className="flex flex-wrap gap-4">
        <a className="text-[--tsugi-accent] underline" href={file('LICENSE')} target="_blank" rel="noopener noreferrer"><Trans>Read AGPL-3.0</Trans></a>
        <a className="text-[--tsugi-accent] underline" href={file('packages/desktop/THIRD-PARTY.md')} target="_blank" rel="noopener noreferrer"><Trans>Third-party notices</Trans></a>
        <a className="text-[--tsugi-accent] underline" href={file('README.md')+'#credits--license'} target="_blank" rel="noopener noreferrer"><Trans>Full acknowledgments</Trans></a>
      </div>
      <p><Trans>The portable release includes the project license, component notices and applicable source references. Browse the indexed licenses below, and consult the packaged notices for separately distributed tools.</Trans></p>
      <button type="button" className="tsugi-read-action justify-self-start" aria-expanded={licensesOpen} aria-controls={licenseId} onClick={()=>setLicensesOpen(value=>!value)}>{licensesOpen?<Trans>Hide dependency licenses</Trans>:<Trans>Browse dependency licenses</Trans>}</button>
      <div id={licenseId} hidden={!licensesOpen} className="min-w-0 space-y-3">{open&&licensesOpen&&<Licenses/>}</div>
    </section>
  </dialog>;
}
