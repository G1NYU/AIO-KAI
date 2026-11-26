import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';

const mock=vi.hoisted(()=>({capture:vi.fn(),save:vi.fn(),open:vi.fn(),managed:vi.fn(),reader:vi.fn()}));
vi.mock('../src/lib/backup/archive',async original=>({...await original<typeof import('../src/lib/backup/archive')>(),capturePortableArchive:mock.capture}));
vi.mock('../src/lib/backup/managed-archive',()=>({saveManagedArchive:mock.save,openManagedArchive:mock.open,supportsManagedBackups:mock.managed}));
vi.mock('../src/lib/hosts/shell/reading',()=>({supportsReading:mock.reader}));

import { createPortableArchive,type PortableArchive } from '../src/lib/backup/archive';
import type { PreferencesBackup } from '../src/lib/backup/preferences';
import type { MangaBackup } from '../src/lib/backup/manga';
import { RESTORE_SESSION_KEY,finishRestoreSession,parseRestoreSession,prepareMangaRestore,prepareRestoreSession,readRestoreSessionState,
  resumeRestoreSession,reviewRestoreRecovery,reviewRestoreSection,restoreSessionBusy,restoreSessionMatches,runRestoreSection,type RestoreSession } from '../src/lib/backup/restore-session';

const preferences:PreferencesBackup={format:'tsugi-preferences',version:1,settings:{theme:'mocha',accent:'blue',startup:'auto',matrix:'wave',layout:'default',audioProfile:'flat',reader:{mode:'scroll',width:55,gap:false,rtl:false,fit:'width',background:'black',focus:false,autoNext:false,wheelZoom:true,resume:true}}};
const manga:MangaBackup={format:'tsugi-manga-progress',version:2,manga:[],categories:['Reading']};
function make(includeManga=true,changed=false){
  return createPortableArchive({preferences:{...preferences,settings:{...preferences.settings,matrix:changed?'off':'wave'}},
    music:{format:'tsugi-music-library',version:1,playlists:[]},books:{format:'tsugi-book-progress',version:1,books:[]},
    ...(includeManga?{manga}:{})},'2026-01-01T00:00:00.000Z');
}
const values=new Map<string,string>(),copies=new Map<string,PortableArchive>();
let nextCopy=0,held=false;
let rejectWrite:(value:string)=>boolean=()=>false;
const storage={
  getItem:(key:string)=>values.get(key)??null,
  setItem:(key:string,value:string)=>{if(rejectWrite(value))throw Error('quota');values.set(key,value);},
  removeItem:(key:string)=>{values.delete(key);},
};
function ready(){
  const state=readRestoreSessionState();
  if(state.kind!=='ready')throw Error('expected-record');
  return state;
}
function payload(source:PortableArchive,kind='preferences'){return source.entries.find(entry=>entry.kind===kind)!.payload;}
function encode(session:RestoreSession){values.set(RESTORE_SESSION_KEY,JSON.stringify(session));}

beforeEach(()=>{
  vi.resetAllMocks();values.clear();copies.clear();nextCopy=0;held=false;rejectWrite=()=>false;
  vi.stubGlobal('localStorage',storage);
  vi.stubGlobal('navigator',{locks:{request:async(_name:string,_options:unknown,callback:(lock:object|null)=>Promise<unknown>)=>{
    if(held)return callback(null);
    held=true;
    try{return await callback({});}finally{held=false;}
  }}});
  mock.managed.mockReturnValue(true);mock.reader.mockReturnValue(true);
  mock.capture.mockImplementation(async(includeManga:boolean)=>make(includeManga));
  mock.save.mockImplementation(async(archive:PortableArchive)=>{
    const name='tsugi-backup-1760000000000-'+(++nextCopy).toString(16).padStart(32,'0')+'.json';
    copies.set(name,structuredClone(archive));
    return {name,createdMs:1760000000000,bytes:new TextEncoder().encode(JSON.stringify(archive)).length,readable:true};
  });
  mock.open.mockImplementation(async(name:string)=>{
    const copy=copies.get(name);if(!copy)throw Error('missing-copy');return structuredClone(copy);
  });
});
afterEach(()=>{vi.unstubAllGlobals();});

describe('verified portable restore session',()=>{
  it('stages and reopens both immutable copies before publishing an intent record or allowing writes',async()=>{
    const source=make(true,true),work=vi.fn(()=>true);
    expect(()=>reviewRestoreSection('preferences',payload(source))).toThrow('restore-prepare');
    const session=await prepareRestoreSession(source);
    expect(mock.capture).toHaveBeenCalledWith(true);
    expect(copies.get(session.recovery.name)).toEqual(make());
    expect(copies.get(session.source.name)).toEqual(source);
    expect(mock.open).toHaveBeenCalledTimes(2);
    expect(work).not.toHaveBeenCalled();
    expect(session.steps.map(step=>step.state)).toEqual(['pending','pending','pending','pending','pending']);
    expect(restoreSessionMatches(session,source)).toBe(true);
    expect(restoreSessionMatches(session,make())).toBe(false);
    expect(values.get(RESTORE_SESSION_KEY)).not.toMatch(/settings|playlists|categories.*Reading|sourceId|payload/);
    await runRestoreSection('preferences',payload(source),reviewRestoreSection('preferences',payload(source)),()=>{
      expect(ready().session.steps[0].state).toBe('running');
      expect(mock.open).toHaveBeenCalledTimes(4);
      return work();
    });
    expect(work).toHaveBeenCalledTimes(1);
    expect(ready().session.steps[0]).toMatchObject({state:'done',attempts:1});
    expect(restoreSessionBusy()).toBe(false);
  });

  it('leaves no executable record when a saved copy fails readback or the initial record cannot persist',async()=>{
    mock.open.mockRejectedValueOnce(Error('disk'));
    await expect(prepareRestoreSession(make())).rejects.toThrow('restore-copy');
    expect(readRestoreSessionState().kind).toBe('empty');
    expect(copies.size).toBe(1);
    mock.open.mockImplementation(async(name:string)=>structuredClone(copies.get(name)!));
    rejectWrite=()=>true;
    await expect(prepareRestoreSession(make())).rejects.toThrow('restore-write');
    expect(readRestoreSessionState().kind).toBe('empty');
    expect(copies.size).toBe(3);
  });

  it('rejects missing or altered saved copies before a mutation, even when another valid archive is substituted',async()=>{
    const source=make(true,true),session=await prepareRestoreSession(source),work=vi.fn();
    const review=reviewRestoreSection('preferences',payload(source));
    copies.set(session.recovery.name,source);
    await expect(runRestoreSection('preferences',payload(source),review,work)).rejects.toThrow('restore-copy');
    copies.set(session.recovery.name,make());copies.delete(session.source.name);
    await expect(runRestoreSection('preferences',payload(source),review,work)).rejects.toThrow('restore-copy');
    expect(work).not.toHaveBeenCalled();
    expect(ready().session.steps[0].state).toBe('pending');
  });

  it('requires a fresh review after another section changes the record or a different checkpoint is prepared',async()=>{
    const source=make(true,true);await prepareRestoreSession(source);
    const preferencesReview=reviewRestoreSection('preferences',payload(source));
    const musicReview=reviewRestoreSection('music',payload(source,'music')),work=vi.fn();
    await runRestoreSection('preferences',payload(source),preferencesReview,()=>true);
    await expect(runRestoreSection('music',payload(source,'music'),musicReview,work)).rejects.toThrow('restore-changed');
    await finishRestoreSession(ready().token);await prepareRestoreSession(source);
    await expect(runRestoreSection('preferences',payload(source),preferencesReview,work)).rejects.toThrow('restore-changed');
    await expect(runRestoreSection('preferences',payload(make()),reviewRestoreSection('preferences',payload(make())),work)).rejects.toThrow('restore-different');
    expect(work).not.toHaveBeenCalled();
  });

  it('rechecks the journal after asynchronous copy verification and refuses a concurrent record change',async()=>{
    const source=make();await prepareRestoreSession(source);
    const review=reviewRestoreSection('preferences',payload(source)),work=vi.fn();
    mock.open.mockImplementationOnce(async(name:string)=>{
      const session=ready().session;encode({...session,revision:session.revision+1});
      return structuredClone(copies.get(name)!);
    });
    await expect(runRestoreSection('preferences',payload(source),review,work)).rejects.toThrow('restore-changed');
    expect(work).not.toHaveBeenCalled();
  });

  it('never starts the domain write if the running intent cannot be written and read back',async()=>{
    const source=make();await prepareRestoreSession(source);
    const review=reviewRestoreSection('preferences',payload(source)),work=vi.fn();
    rejectWrite=value=>JSON.parse(value).steps.some((step:{state:string})=>step.state==='running');
    await expect(runRestoreSection('preferences',payload(source),review,work)).rejects.toThrow('restore-write');
    expect(work).not.toHaveBeenCalled();
    expect(ready().session.steps[0].state).toBe('pending');
  });

  it('records exceptions and partially confirmed domain results as stopped attempts, never as success',async()=>{
    const source=make();await prepareRestoreSession(source);
    await expect(runRestoreSection('manga',payload(source,'manga'),reviewRestoreSection('manga',payload(source,'manga')),
      ()=>{throw Error('partly-applied');})).rejects.toThrow('partly-applied');
    expect(ready().session.steps.find(step=>step.kind==='manga')).toMatchObject({state:'failed',attempts:1});
    const result=await runRestoreSection('categories',payload(source,'manga'),reviewRestoreSection('categories',payload(source,'manga')),
      ()=>({created:1,complete:false}),value=>value.complete);
    expect(result.created).toBe(1);
    expect(ready().session.steps.find(step=>step.kind==='categories')).toMatchObject({state:'failed',attempts:1});
  });

  it('preserves an unconfirmed running record after post-write storage failure and never retries automatically',async()=>{
    const source=make(),session=await prepareRestoreSession(source),work=vi.fn(()=>true);
    const review=reviewRestoreSection('preferences',payload(source));
    rejectWrite=value=>JSON.parse(value).steps.some((step:{state:string})=>step.state==='done');
    await expect(runRestoreSection('preferences',payload(source),review,work)).rejects.toThrow('restore-unconfirmed');
    expect(ready().session.steps[0].state).toBe('running');
    expect(restoreSessionBusy()).toBe(false);
    expect(()=>reviewRestoreSection('preferences',payload(source))).toThrow('restore-interrupted');
    expect(work).toHaveBeenCalledTimes(1);
    rejectWrite=()=>false;
    expect(await resumeRestoreSession(session.id)).toEqual(source);
    expect(ready().session.steps[0].state).toBe('failed');
    expect(work).toHaveBeenCalledTimes(1);
    await expect(runRestoreSection('preferences',payload(source),review,work)).rejects.toThrow('restore-changed');
    await runRestoreSection('preferences',payload(source),reviewRestoreSection('preferences',payload(source)),work);
    expect(ready().session.steps[0]).toMatchObject({state:'done',attempts:2});
  });

  it('serializes asynchronous work with prepare, resume, finish and standalone writes across the shared lock',async()=>{
    const source=make(),session=await prepareRestoreSession(source);
    let release!:()=>void;
    const action=runRestoreSection('books',payload(source,'books'),reviewRestoreSection('books',payload(source,'books')),
      ()=>new Promise<void>(resolve=>{release=resolve;}));
    await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
    expect(restoreSessionBusy()).toBe(true);
    await expect(resumeRestoreSession(session.id)).rejects.toThrow('restore-busy');
    await expect(finishRestoreSession(ready().token)).rejects.toThrow('restore-busy');
    await expect(runRestoreSection('music',undefined,undefined,()=>true)).rejects.toThrow('restore-busy');
    release();await action;
    expect(restoreSessionBusy()).toBe(false);
  });

  it('requires explicit completion of an existing record, then clears only that exact record and retains both copies',async()=>{
    values.set('credentials','fixture-private');
    await prepareRestoreSession(make());const state=ready();
    await expect(prepareRestoreSession(make())).rejects.toThrow('restore-different');
    await expect(runRestoreSection('music',undefined,undefined,()=>true)).rejects.toThrow('restore-different');
    await expect(finishRestoreSession('a'.repeat(64))).rejects.toThrow('restore-changed');
    expect(readRestoreSessionState()).toEqual(state);
    await finishRestoreSession(state.token);
    expect(readRestoreSessionState().kind).toBe('empty');expect(copies.size).toBe(2);
    expect(values.get('credentials')).toBe('fixture-private');
    expect(await runRestoreSection('music',undefined,undefined,()=>42)).toBe(42);
  });

  it('prepares earlier metadata for review in a new guarded session without applying it or deleting prior copies',async()=>{
    const source=make(true,true),first=await prepareRestoreSession(source);
    const staleReview=reviewRestoreSection('preferences',payload(source));
    mock.capture.mockResolvedValue(source);
    const previous=await reviewRestoreRecovery(first.id),next=ready().session;
    expect(previous).toEqual(make());expect(next.id).not.toBe(first.id);
    expect(copies.get(next.source.name)).toEqual(make());expect(copies.get(next.recovery.name)).toEqual(source);
    expect(copies.size).toBe(4);expect(next.steps.every(step=>step.state==='pending')).toBe(true);
    await expect(runRestoreSection('preferences',payload(previous),staleReview,()=>true)).rejects.toThrow('restore-changed');
  });

  it('keeps unsupported Reader sections unavailable and never silently captures default progress',async()=>{
    mock.reader.mockReturnValue(false);
    const source=make(),session=await prepareRestoreSession(source);
    expect(mock.capture).toHaveBeenCalledWith(false);
    expect(session.steps.filter(step=>step.state==='unavailable').map(step=>step.kind)).toEqual(['manga','categories']);
    expect(()=>reviewRestoreSection('manga',payload(source,'manga'))).toThrow('restore-reader');
    await finishRestoreSession(ready().token);
    await expect(prepareMangaRestore(JSON.stringify(manga))).rejects.toThrow('restore-reader');
  });

  it('uses the same guarded two-copy session for canonicalized Mihon payloads and restricts its actions to Reader metadata',async()=>{
    const text=JSON.stringify(manga,null,2),session=await prepareMangaRestore(text);
    expect(session.steps.map(step=>step.kind)).toEqual(['manga','categories']);
    expect(()=>reviewRestoreSection('preferences',payload(make()))).toThrow('restore-different');
    const work=vi.fn(()=>true);
    await runRestoreSection('manga',text,reviewRestoreSection('manga',text),work);
    expect(work).toHaveBeenCalledTimes(1);expect(copies.size).toBe(2);
  });

  it('rejects active readers before capture and again immediately before an archived mutation',async()=>{
    const source=make();
    vi.stubGlobal('document',{querySelector:()=>({})});
    await expect(prepareRestoreSession(source)).rejects.toThrow('restore-active-reader');
    expect(mock.capture).not.toHaveBeenCalled();
    vi.stubGlobal('document',{querySelector:()=>null});
    await prepareRestoreSession(source);
    const review=reviewRestoreSection('preferences',payload(source)),work=vi.fn();
    mock.open.mockImplementationOnce(async(name:string)=>{
      vi.stubGlobal('document',{querySelector:()=>({})});return structuredClone(copies.get(name)!);
    });
    await expect(runRestoreSection('preferences',payload(source),review,work)).rejects.toThrow('restore-active-reader');
    expect(work).not.toHaveBeenCalled();
  });

  it('fails closed on unavailable storage, unmanaged hosts and a missing cross-window lock service',async()=>{
    mock.managed.mockReturnValue(false);
    await expect(prepareRestoreSession(make())).rejects.toThrow('restore-unavailable');expect(mock.capture).not.toHaveBeenCalled();
    mock.managed.mockReturnValue(true);vi.stubGlobal('navigator',{});
    await expect(prepareRestoreSession(make())).rejects.toThrow('restore-unavailable');expect(copies.size).toBe(0);
    expect(await runRestoreSection('music',undefined,undefined,()=>true)).toBe(true);
    vi.stubGlobal('localStorage',{getItem:()=>{throw Error('blocked');}});
    expect(readRestoreSessionState().kind).toBe('unavailable');
    await expect(runRestoreSection('music',undefined,undefined,()=>true)).rejects.toThrow('restore-unavailable');
  });

  it('rejects malformed or extended journal schemas and preserves invalid records until explicitly cleared',async()=>{
    const session=await prepareRestoreSession(make());
    const invalid=[{...session,version:2},{...session,secret:'fixture-private'}, {...session,id:'invalid'},
      {...session,source:{...session.source,name:'../private.json'}},{...session,createdAt:'2026-02-31T00:00:00.000Z'},
      {...session,steps:[session.steps[0],session.steps[0]]},{...session,steps:[{kind:'preferences',state:'done',attempts:0}]},
      {...session,steps:[{kind:'preferences',state:'pending',attempts:1}]},
      {...session,steps:[{kind:'preferences',state:'running',attempts:1},{kind:'music',state:'running',attempts:1}]}];
    for(const value of invalid)expect(()=>parseRestoreSession(JSON.stringify(value))).toThrow();
    expect(()=>parseRestoreSession(' '.repeat(8193))).toThrow();
    values.set(RESTORE_SESSION_KEY,JSON.stringify(invalid[0]));
    const state=readRestoreSessionState();expect(state.kind).toBe('invalid');
    await expect(prepareRestoreSession(make())).rejects.toThrow('restore-invalid');
    await finishRestoreSession(state.token!);expect(readRestoreSessionState().kind).toBe('empty');expect(copies.size).toBe(2);
  });
});
