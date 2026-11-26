import { isPlayerTheme, isPlayerAccent, readPlayerTheme, readPlayerAccent, type PlayerThemeId, type PlayerAccentId } from '../music/player-theme';
import { readMatrixMode, readPlayerStage, type MatrixMode } from '../music/player-layout';
import { isStartupArea, readStartupArea, type StartupArea } from '../desktop-area';
import { isAudioProfile, readAudioProfile, type AudioProfile } from '../music/audio-profiles';
import { normalizeReaderPreferences, readReaderPreferences, type ReaderPreferences } from '../../app/read/reader-preferences';
import { announceSourceFeedPreferencesChange, parseSourceFeedPreferences, readSourceFeedPreferences, SOURCE_FEED_PREFERENCE_KEY, type SourceFeedPreferences } from '../../app/read/source-feed-preferences';

export const MAX_PREFERENCES_BACKUP_BYTES = 16 * 1024;
type BuiltInLayout = 'default' | 'junction' | 'nocturne';
type Preferences = {
  theme: PlayerThemeId; accent: PlayerAccentId; startup: StartupArea;
  matrix: MatrixMode; layout: BuiltInLayout | null; audioProfile: AudioProfile;
  reader: ReaderPreferences;
};
export type PreferencesBackupV1 = { format: 'tsugi-preferences'; version: 1; settings: Preferences };
export type PreferencesBackupV2 = { format: 'tsugi-preferences'; version: 2; settings: Preferences & { feed: SourceFeedPreferences } };
export type PreferencesBackup = PreferencesBackupV1 | PreferencesBackupV2;

// Exact, audited preference keys only. Never enumerate WebView storage or
// serialize server credentials, source manifests, URLs, media or raw Studio JSON.
const keys = {
  theme:'aiokai-desktop-player-theme-v1', accent:'tsugi-global-accent-v1',
  startup:'tsugi-startup-area-v1', matrix:'tsugi-matrix-mode-v1',
  layout:'tsugi-desktop-player-stage-v1', audioProfile:'tsugi-audio-profile-v1',
  reader:'tsugi-reader-preferences', importedColors:'tsugi-global-import-colors-v1',
  feed:SOURCE_FEED_PREFERENCE_KEY,
} as const;
function record(value: unknown): Record<string,unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string,unknown> : null;
}
function exact(value: Record<string,unknown>, fields: string[]) {
  return Object.keys(value).length === fields.length && fields.every(key=>Object.prototype.hasOwnProperty.call(value,key));
}
function builtIn(value: unknown): value is BuiltInLayout {
  return value === 'default' || value === 'junction' || value === 'nocturne';
}
function matrixMode(value: unknown): value is MatrixMode {
  return value === 'off' || value === 'minimal' || value === 'immersive' || value === 'wave';
}
export function parsePreferencesBackup(text: string): PreferencesBackup {
  if (new TextEncoder().encode(text).length > MAX_PREFERENCES_BACKUP_BYTES) throw new Error('size');
  const root=record(JSON.parse(text));
  if (!root || !exact(root,['format','version','settings']) || root.format !== 'tsugi-preferences' || (root.version !== 1 && root.version !== 2)) throw new Error('format');
  const p=record(root.settings);
  if (!p || !exact(p,['theme','accent','startup','matrix','layout','audioProfile','reader',...(root.version===2?['feed']:[])]) ||
      !isPlayerTheme(p.theme) || !isPlayerAccent(p.accent) || !isStartupArea(p.startup) ||
      !matrixMode(p.matrix) || !(p.layout === null || builtIn(p.layout)) || !isAudioProfile(p.audioProfile)) throw new Error('preferences');
  const reader=record(p.reader), normalized=normalizeReaderPreferences(p.reader);
  if (!reader || !exact(reader,Object.keys(normalized)) ||
      Object.entries(normalized).some(([key,value])=>reader[key]!==value)) throw new Error('reader preferences');
  const settings:Preferences={theme:p.theme,accent:p.accent,startup:p.startup,matrix:p.matrix,
    layout:p.layout,audioProfile:p.audioProfile,reader:normalized};
  return root.version===2?{format:'tsugi-preferences',version:2,settings:{...settings,feed:parseSourceFeedPreferences(p.feed)}}
    :{format:'tsugi-preferences',version:1,settings};
}
export function capturePreferencesBackup(): PreferencesBackupV2 {
  // Existing reader helpers default on blocked storage; probe reads first so a
  // blocked storage backend cannot masquerade as a successful backup.
  for (const key of Object.values(keys)) localStorage.getItem(key);
  const stage=readPlayerStage();
  return {format:'tsugi-preferences',version:2,settings:{
    theme:readPlayerTheme(),accent:readPlayerAccent(),startup:readStartupArea(),
    matrix:readMatrixMode(),layout:builtIn(stage.id)?stage.id:null,
    audioProfile:readAudioProfile(),reader:readReaderPreferences(),feed:readSourceFeedPreferences(),
  }};
}

/** Kept in memory for a single review. Raw values never enter an export. */
export function preferenceRestoreBaseline(backup: PreferencesBackup): ReadonlyMap<string, string | null> {
  const verified=parsePreferencesBackup(JSON.stringify(backup));
  const targets = Object.values(keys).filter(key => (key !== keys.layout || verified.settings.layout !== null) && (key !== keys.feed || verified.version===2));
  return new Map(targets.map(key => [key, localStorage.getItem(key)]));
}

/** Apply only a validated preferences file. On an ordinary write failure,
 * restore the original raw values; report explicitly if storage also blocks rollback.
 * This is not a full app transaction or protection against process termination. */
export function applyPreferencesBackup(backup: PreferencesBackup, baseline?: ReadonlyMap<string, string | null>): 'stale' | 'applied' | 'unchanged' | 'rollback-failed' {
  const verified=parsePreferencesBackup(JSON.stringify(backup)),p=verified.settings;
  const writes: [string,string][]=[
    [keys.theme,JSON.stringify(p.theme)],[keys.accent,JSON.stringify(p.accent)],
    [keys.startup,JSON.stringify(p.startup)],[keys.matrix,JSON.stringify(p.matrix)],
    [keys.audioProfile,JSON.stringify(p.audioProfile)],[keys.reader,JSON.stringify(p.reader)],
    [keys.importedColors,'false'],
  ];
  try {
    if(p.layout!==null) writes.push([keys.layout,JSON.stringify({id:p.layout,imported:readPlayerStage().imported})]);
    if(verified.version===2) writes.push([keys.feed,JSON.stringify(verified.settings.feed)]);
    const previous=writes.map(([key])=>[key,localStorage.getItem(key)] as const);
    if (baseline && previous.some(([key, value]) => !baseline.has(key) || baseline.get(key) !== value)) {
      return 'stale';
    }
    let completed=0;
    try {
      for(const [key,value] of writes){
        localStorage.setItem(key,value);completed++;
        if(key===keys.feed&&localStorage.getItem(key)!==value)throw new Error('feed-write-unconfirmed');
      }
      if(verified.version===2)announceSourceFeedPreferencesChange();
      return 'applied';
    } catch {
      let failed=false;
      for(const [key,value] of previous.slice(0,completed).reverse()){
        try {
          if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);
          if(key===keys.feed&&localStorage.getItem(key)!==value)failed=true;
        }
        catch { failed=true; }
      }
      if(writes.slice(0,completed).some(([key])=>key===keys.feed))announceSourceFeedPreferencesChange();
      return failed?'rollback-failed':'unchanged';
    }
  } catch { return 'unchanged'; }
}
