import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isReaderIdentity, parseTitleReaderPreferences, readEffectiveReaderPreferences,
  readTitleReaderPreferences, saveTitleReaderPreferences, saveReaderPreferences,
  READER_DEFAULTS, READER_PREFERENCE_KEY, TITLE_READER_PREFERENCE_KEY, MAX_TITLE_READER_PREFERENCES } from '../src/app/read/reader-preferences';

const values = new Map<string,string>();
const first = 'a'.repeat(64), second = 'b'.repeat(64);
function install(fail = false) {
  vi.stubGlobal('localStorage',{
    getItem: (key:string) => values.get(key) ?? null,
    setItem: (key:string,value:string) => { if(fail)throw Error('quota'); values.set(key,value); },
    removeItem: (key:string) => { if(fail)throw Error('quota'); values.delete(key); },
  });
}
beforeEach(()=>{values.clear();install();});
afterEach(()=>vi.unstubAllGlobals());
describe('title-scoped reader preferences',()=>{
  it('inherits current globals, isolates stable identities and resets without writing globals',()=>{
    const initial = {...READER_DEFAULTS, width:65};
    expect(saveReaderPreferences(initial)).toBe(true);
    expect(readEffectiveReaderPreferences(first)).toEqual(initial);
    const local = {...initial,mode:'spread' as const,resume:false};
    expect(saveTitleReaderPreferences(first,local)).toBe(true);
    expect(readTitleReaderPreferences(first)).toEqual(local);
    expect(readEffectiveReaderPreferences(second)).toEqual(initial);
    const nextGlobal = {...initial,background:'paper' as const};
    expect(saveReaderPreferences(nextGlobal)).toBe(true);
    expect(readEffectiveReaderPreferences(second)).toEqual(nextGlobal);
    expect(readEffectiveReaderPreferences(first)).toEqual(local);
    const other = {...nextGlobal,gap:true};
    expect(saveTitleReaderPreferences(second,other)).toBe(true);
    expect(saveTitleReaderPreferences(first,null)).toBe(true);
    expect(readEffectiveReaderPreferences(first)).toEqual(nextGlobal);
    expect(readEffectiveReaderPreferences(second)).toEqual(other);
    expect(values.get(READER_PREFERENCE_KEY)).toBe(JSON.stringify(nextGlobal));
    expect(saveTitleReaderPreferences(second,null)).toBe(true);
    expect(values.has(TITLE_READER_PREFERENCE_KEY)).toBe(false);
  });
  it('refuses arbitrary keys, duplicate records, unsafe values and unknown schemas',()=>{
    for(const identity of ['','__proto__','https://private.test/token','a'.repeat(63),'a'.repeat(64)+'\n','F'.repeat(64),'g'.repeat(64)]) {
      expect(isReaderIdentity(identity)).toBe(false);
      expect(saveTitleReaderPreferences(identity,READER_DEFAULTS)).toBe(false);
    }
    const row = {identity:first,preferences:READER_DEFAULTS};
    const root = (titles:unknown[],version=1)=>JSON.stringify({version,titles});
    for(const invalid of [root([row,row]),root([row],2),root([{...row,preferences:{...READER_DEFAULTS,width:101}}]),
      root([{...row,preferences:{...READER_DEFAULTS,privateUrl:'secret'}}]),root([{...row,identity:'constructor'}])]) {
      expect(()=>parseTitleReaderPreferences(invalid)).toThrow();
      values.set(TITLE_READER_PREFERENCE_KEY,invalid);
      expect(saveTitleReaderPreferences(second,READER_DEFAULTS)).toBe(false);
      expect(values.get(TITLE_READER_PREFERENCE_KEY)).toBe(invalid);
      expect(readTitleReaderPreferences(first)).toBeNull();
    }
  });
  it('does not evict existing records or claim success on storage failure',()=>{
    const titles=Array.from({length:MAX_TITLE_READER_PREFERENCES},(_,i)=>({identity:i.toString(16).padStart(64,'0'),preferences:READER_DEFAULTS}));
    const raw=JSON.stringify({version:1,titles});
    expect(parseTitleReaderPreferences(raw)).toHaveLength(MAX_TITLE_READER_PREFERENCES);
    values.set(TITLE_READER_PREFERENCE_KEY,raw);
    expect(saveTitleReaderPreferences(first,READER_DEFAULTS)).toBe(false);
    expect(values.get(TITLE_READER_PREFERENCE_KEY)).toBe(raw);
    expect(saveTitleReaderPreferences(titles[0].identity,{...READER_DEFAULTS,width:80})).toBe(true);
    const before=values.get(TITLE_READER_PREFERENCE_KEY);
    install(true);
    expect(saveTitleReaderPreferences(titles[0].identity,null)).toBe(false);
    expect(values.get(TITLE_READER_PREFERENCE_KEY)).toBe(before);
    expect(saveReaderPreferences(READER_DEFAULTS)).toBe(false);
  });
});
