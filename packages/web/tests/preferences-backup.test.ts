import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPreferencesBackup, capturePreferencesBackup, parsePreferencesBackup, preferenceRestoreBaseline, MAX_PREFERENCES_BACKUP_BYTES } from '../src/lib/backup/preferences';

const values=new Map<string,string>();
function fakeStorage(fail?:string) {
  vi.stubGlobal('localStorage',{
    getItem:(key:string)=>values.get(key)??null,
    setItem:(key:string,value:string)=>{if(key===fail)throw new Error('quota');values.set(key,value);},
    removeItem:(key:string)=>values.delete(key),
  });
}
beforeEach(()=>{values.clear();fakeStorage();});
afterEach(()=>vi.unstubAllGlobals());

describe('Tsugi preferences backup',()=>{
  it('exports only typed allowlisted preferences, never credentials, source URLs or imported JSON',()=>{
    values.set('jellyfin_credentials','fixture-secret');
    values.set('aiostreams-desktop-music-sources-v1','https://example.test/secret/manifest.json');
    values.set('tsugi-desktop-player-stage-v1',JSON.stringify({id:'default',imported:{secret:'fixture-secret'}}));
    values.set('tsugi-independent-playlists-v1','fixture-playlist');
    values.set('tsugi-global-accent-v1','"blue"');
    const file=capturePreferencesBackup(), encoded=JSON.stringify(file);
    expect(file.settings.accent).toBe('blue');
    expect(encoded).not.toMatch(/secret|example\.test|fixture-playlist|credentials/);
    expect(parsePreferencesBackup(encoded)).toEqual(file);
  });
  it('previews without writes and restores only the validated preference fields',()=>{
    const file=capturePreferencesBackup();
    file.settings.theme='mocha';file.settings.matrix='off';file.settings.reader.mode='spread';
    values.set('jellyfin_credentials','fixture-secret');
    values.set('tsugi-independent-playlists-v1','fixture-playlist');
    const before=[...values];
    const preview=parsePreferencesBackup(JSON.stringify(file));
    expect([...values]).toEqual(before);
    expect(applyPreferencesBackup(preview)).toBe('applied');
    expect(capturePreferencesBackup()).toEqual(file);
    expect(values.get('jellyfin_credentials')).toBe('fixture-secret');
    expect(values.get('tsugi-independent-playlists-v1')).toBe('fixture-playlist');
  });
  it('refuses a stale restore before writing, including changed local-only palette state',()=>{
    const file=capturePreferencesBackup();
    file.settings.theme='mocha';
    const review=preferenceRestoreBaseline(file);
    values.set('tsugi-global-import-colors-v1','true');
    const before=[...values];
    expect(applyPreferencesBackup(file,review)).toBe('stale');
    expect([...values]).toEqual(before);
    expect(applyPreferencesBackup(file,preferenceRestoreBaseline(file))).toBe('applied');
  });
  it('allows an unrelated layout change when the archive keeps the current layout',()=>{
    const file=capturePreferencesBackup();
    file.settings.layout=null;
    const review=preferenceRestoreBaseline(file);
    values.set('tsugi-desktop-player-stage-v1','{"id":"junction"}');
    expect(applyPreferencesBackup(file,review)).toBe('applied');
    expect(values.get('tsugi-desktop-player-stage-v1')).toBe('{"id":"junction"}');
  });
  it('rejects unknown fields, wrong version, malformed values and oversized files',()=>{
    const file=capturePreferencesBackup();
    for(const invalid of [{...file,version:2},{...file,token:'secret'},{...file,settings:{...file.settings,matrix:'unknown'}},
      {...file,settings:{...file.settings,reader:{...file.settings.reader,width:200}}}])
      expect(()=>parsePreferencesBackup(JSON.stringify(invalid))).toThrow();
    expect(()=>parsePreferencesBackup(' '.repeat(MAX_PREFERENCES_BACKUP_BYTES+1))).toThrow();
  });
  it('rolls back earlier writes if the storage backend rejects a later write',()=>{
    values.set('aiokai-desktop-player-theme-v1','"sumi"');
    const file=capturePreferencesBackup();file.settings.theme='mocha';
    const before=[...values];fakeStorage('tsugi-matrix-mode-v1');
    expect(applyPreferencesBackup(file)).toBe('unchanged');
    expect([...values]).toEqual(before);
  });
  it('reports blocked reads rather than exporting defaults as a backup',()=>{
    vi.stubGlobal('localStorage',{getItem:()=>{throw new Error('blocked');}});
    expect(()=>capturePreferencesBackup()).toThrow();
  });
});
