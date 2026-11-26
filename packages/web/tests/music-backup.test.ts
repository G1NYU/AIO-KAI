import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { captureMusicBackup,parseMusicBackup,previewMusicMerge,applyMusicMerge,planMusicMerge,MUSIC_BACKUP_LIMIT } from '../src/lib/backup/music';
import { YOUTUBE_MUSIC_ID } from '../src/lib/music/connections';
const KEY='tsugi-independent-playlists-v1';
const id='11111111-2222-4333-8444-555555555555';
const values=new Map<string,string>();
const list={id,name:'Mix',tracks:[
  {id:'abcdefghijk',sourceId:YOUTUBE_MUSIC_ID,title:'Native',artist:'Artist',artworkURL:'https://private.test/token'},
  {id:'https://private.test/secret',sourceId:'22222222-3333-4444-8555-666666666666',title:'Remote',artist:'Artist',streamURL:'https://private.test/stream'},
  {id:'other',title:'Remote',artist:'Artist'},
]};
beforeEach(()=>{
  values.clear();
  vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)});
});
afterEach(()=>vi.unstubAllGlobals());
describe('credential-free music backup',()=>{
  it('projects native identities and ordered metadata without raw provider URLs or IDs',()=>{
    values.set(KEY,JSON.stringify([list]));values.set('jellyfin_credentials','fixture-secret');
    const backup=captureMusicBackup(), encoded=JSON.stringify(backup);
    expect(encoded).not.toMatch(/private\.test|fixture-secret|22222222-3333-4444-8555-666666666666|streamURL|artworkURL/);
    expect(backup.playlists[0].tracks.map(t=>t.title)).toEqual(['Native','Remote','Remote']);
    expect(backup.playlists[0].tracks[0].sourceId).toBe(YOUTUBE_MUSIC_ID);
    expect(backup.playlists[0].tracks[1].sourceId).toBeUndefined();
    expect(parseMusicBackup(encoded)).toEqual(backup);
  });
  it('merges into a fresh library and reimport preserves duplicates and order',()=>{
    values.set(KEY,JSON.stringify([list]));
    const backup=captureMusicBackup();values.delete(KEY);
    const plan=previewMusicMerge(backup);
    expect(values.has(KEY)).toBe(false);expect(plan.addedTracks).toBe(3);
    expect(applyMusicMerge(backup,plan.baseline)).toBe('applied');
    const repeated=previewMusicMerge(backup);
    expect(repeated.addedTracks).toBe(0);expect(repeated.duplicates).toBe(3);
    expect(repeated.next[0].tracks.map(t=>t.title)).toEqual(['Native','Remote','Remote']);
  });
  it('preserves current private playback data and rejects a stale preview',()=>{
    values.set(KEY,JSON.stringify([list]));
    const backup=captureMusicBackup();
    const plan=previewMusicMerge(backup);
    expect(plan.addedTracks).toBe(0);
    expect(plan.next[0].tracks[0].artworkURL).toContain('private.test');
    values.set(KEY,JSON.stringify([{...list,name:'Renamed'}]));
    expect(applyMusicMerge(backup,plan.baseline)).toBe('stale');
    expect(JSON.parse(values.get(KEY)!)[0].name).toBe('Renamed');
  });
  it('rejects unknown fields, non-native opaque identities and oversized backups',()=>{
    values.set(KEY,JSON.stringify([list]));
    const backup=captureMusicBackup();
    const invalid={...backup,playlists:[{...backup.playlists[0],tracks:[{...backup.playlists[0].tracks[0],artworkURL:'https://secret.test/'}]}]};
    expect(()=>parseMusicBackup(JSON.stringify(invalid))).toThrow();
    expect(()=>parseMusicBackup(' '.repeat(MUSIC_BACKUP_LIMIT+1))).toThrow();
    expect(()=>parseMusicBackup(JSON.stringify({...backup,version:2}))).toThrow();
  });
  it('does not silently drop malformed local metadata',()=>{
    values.set(KEY,JSON.stringify([{...list,tracks:[{id:'a',title:'https://private.test/token',artist:'Artist'}]}]));
    expect(()=>captureMusicBackup()).toThrow();
  });
  it('blocks capacity overflow and preserves existing values on write failure',()=>{
    values.set(KEY,JSON.stringify([list]));const backup=captureMusicBackup();
    const current=Array.from({length:100},(_,i)=>({id:'00000000-0000-0000-0000-'+String(i).padStart(12,'0'),name:'Existing',tracks:[]}));
    expect(planMusicMerge(backup,current).blocked).toBe(true);
    const before=values.get(KEY)!;vi.stubGlobal('localStorage',{getItem:()=>before,setItem:()=>{throw new Error('quota');}});
    expect(applyMusicMerge(backup,before)).toBe('blocked');
    expect(values.get(KEY)).toBe(before);
  });
});
