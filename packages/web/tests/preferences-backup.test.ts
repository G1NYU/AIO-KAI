import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPreferencesBackup, capturePreferencesBackup, parsePreferencesBackup, preferenceRestoreBaseline, MAX_PREFERENCES_BACKUP_BYTES } from '../src/lib/backup/preferences';
import { readSourceFeedPreferences, SOURCE_FEED_PREFERENCE_EVENT, SOURCE_FEED_PREFERENCE_KEY, type SourceFeedPreferences } from '../src/app/read/source-feed-preferences';

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
    for(const invalid of [{...file,version:3},{...file,token:'secret'},{...file,settings:{...file.settings,matrix:'unknown'}},
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

  it('captures v2 Feed choices with exact IDs and never contacts sources on capture or restore',()=>{
    const feed:SourceFeedPreferences={version:1,sources:[{sourceId:'9007199254740993',mode:'latest'},{sourceId:'-9223372036854775808',mode:'popular'}]};
    values.set(SOURCE_FEED_PREFERENCE_KEY,JSON.stringify(feed));
    const network=vi.fn(),notify=vi.fn();vi.stubGlobal('fetch',network);vi.stubGlobal('window',{dispatchEvent:notify});
    const file=capturePreferencesBackup();
    expect(file.version).toBe(2);expect(file.settings.feed).toEqual(feed);
    values.delete(SOURCE_FEED_PREFERENCE_KEY);
    expect(applyPreferencesBackup(parsePreferencesBackup(JSON.stringify(file)))).toBe('applied');
    expect(readSourceFeedPreferences()).toEqual(feed);
    expect(notify).toHaveBeenCalledOnce();expect(notify.mock.calls[0][0].type).toBe(SOURCE_FEED_PREFERENCE_EVENT);
    expect(network).not.toHaveBeenCalled();
  });

  it('keeps the exact v1 schema and preserves Feed choices even if they change after an old-file preview',()=>{
    const {feed:omitted,...settings}=capturePreferencesBackup().settings;
    const legacy={format:'tsugi-preferences' as const,version:1 as const,settings};
    expect(parsePreferencesBackup(JSON.stringify(legacy))).toEqual(legacy);
    expect(()=>parsePreferencesBackup(JSON.stringify({...legacy,settings:{...settings,feed:omitted}}))).toThrow();
    expect(()=>parsePreferencesBackup(JSON.stringify({...legacy,version:2}))).toThrow();
    values.set(SOURCE_FEED_PREFERENCE_KEY,'old malformed value is outside a v1 restore');
    const baseline=preferenceRestoreBaseline(legacy);
    expect(baseline.has(SOURCE_FEED_PREFERENCE_KEY)).toBe(false);
    const changed='{"version":1,"sources":[{"sourceId":"12345","mode":"popular"}]}';
    values.set(SOURCE_FEED_PREFERENCE_KEY,changed);
    const notify=vi.fn();vi.stubGlobal('window',{dispatchEvent:notify});
    expect(applyPreferencesBackup(legacy,baseline)).toBe('applied');
    expect(values.get(SOURCE_FEED_PREFERENCE_KEY)).toBe(changed);expect(notify).not.toHaveBeenCalled();
  });

  it('does not access the Feed storage key during a legacy preferences restore',()=>{
    const {feed:_feed,...settings}=capturePreferencesBackup().settings;
    const legacy={format:'tsugi-preferences' as const,version:1 as const,settings};
    vi.stubGlobal('localStorage',{getItem:(key:string)=>{if(key===SOURCE_FEED_PREFERENCE_KEY)throw Error('Feed read blocked');return values.get(key)??null;},
      setItem:(key:string,value:string)=>{if(key===SOURCE_FEED_PREFERENCE_KEY)throw Error('Feed write forbidden');values.set(key,value);},removeItem:(key:string)=>values.delete(key)});
    expect(applyPreferencesBackup(legacy,preferenceRestoreBaseline(legacy))).toBe('applied');
  });

  it('rejects altered v2 Feed choices as a stale restore before writing other preferences',()=>{
    const file=capturePreferencesBackup(),baseline=preferenceRestoreBaseline(file);
    values.set(SOURCE_FEED_PREFERENCE_KEY,JSON.stringify({version:1,sources:[{sourceId:'12345',mode:'latest'}]}));
    const before=[...values];
    expect(applyPreferencesBackup(file,baseline)).toBe('stale');expect([...values]).toEqual(before);
  });

  it('refuses unsupported Feed payloads and corrupt stored choices rather than exporting defaults',()=>{
    const file=capturePreferencesBackup();
    for(const feed of [null,{version:1,sources:[{sourceId:'0',mode:'popular'}]},
      {version:1,sources:[{sourceId:'12345',mode:'popular',token:'fixture-secret'}]},
      {version:1,sources:[{sourceId:'9223372036854775808',mode:'latest'}]},
      {version:1,sources:[{sourceId:'1',mode:'popular'},{sourceId:'1',mode:'latest'}]}])
      expect(()=>parsePreferencesBackup(JSON.stringify({...file,settings:{...file.settings,feed}}))).toThrow();
    values.set(SOURCE_FEED_PREFERENCE_KEY,'{"secret":"fixture-secret"}');
    expect(()=>capturePreferencesBackup()).toThrow('source-feed-invalid');
    expect(values.get(SOURCE_FEED_PREFERENCE_KEY)).toBe('{"secret":"fixture-secret"}');
  });

  it('rolls back all earlier preference writes when the final Feed write fails',()=>{
    values.set('aiokai-desktop-player-theme-v1','"sumi"');
    const file=capturePreferencesBackup();file.settings.theme='carbon';file.settings.feed.sources=[{sourceId:'12345',mode:'latest'}];
    const before=[...values];fakeStorage(SOURCE_FEED_PREFERENCE_KEY);
    expect(applyPreferencesBackup(file)).toBe('unchanged');expect([...values]).toEqual(before);
  });

  it.each([false,true])('checks Feed readback and reports whether aggregate rollback could be verified: %s',failRollback=>{
    const previous=JSON.stringify({version:1,sources:[]});values.set(SOURCE_FEED_PREFERENCE_KEY,previous);
    const file=capturePreferencesBackup();file.settings.feed.sources=[{sourceId:'12345',mode:'latest'}];file.settings.theme='carbon';
    const before=[...values],notify=vi.fn();vi.stubGlobal('window',{dispatchEvent:notify});
    let first=true;
    vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{
      if(key===SOURCE_FEED_PREFERENCE_KEY){if(first){first=false;values.set(key,'unexpected');return;}if(failRollback)throw Error('rollback blocked');}
      values.set(key,value);
    },removeItem:(key:string)=>values.delete(key)});
    expect(applyPreferencesBackup(file)).toBe(failRollback?'rollback-failed':'unchanged');
    if(!failRollback)expect([...values]).toEqual(before);else expect(values.get(SOURCE_FEED_PREFERENCE_KEY)).toBe('unexpected');
    expect(notify).toHaveBeenCalledOnce();expect(notify.mock.calls[0][0].type).toBe(SOURCE_FEED_PREFERENCE_EVENT);
  });
});
