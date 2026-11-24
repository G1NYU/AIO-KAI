import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUDIO_PROFILES, isAudioProfile, readAudioProfile, saveAudioProfile } from '../src/lib/music/audio-profiles';
const memory=new Map<string,string>();
beforeEach(()=>{memory.clear();vi.stubGlobal('localStorage',{
  getItem:(k:string)=>memory.get(k)??null,
  setItem:(k:string,v:string)=>{memory.set(k,v);},
  removeItem:(k:string)=>{memory.delete(k);},
});});
afterEach(() => vi.unstubAllGlobals());

describe('local audio equalizer profile settings',()=>{
  it('defaults to bypassed flat profile without existing preference',()=>{
    expect(readAudioProfile()).toBe('flat');
  });
  it('validates and remembers named sound profiles',()=>{
    saveAudioProfile('warm');
    expect(readAudioProfile()).toBe('warm');
    expect(isAudioProfile('bass')).toBe(true);
    expect(isAudioProfile('__proto__')).toBe(false);
  });
  it('keeps bounded, unambiguous three-band gain settings',()=>{
    for(const gains of Object.values(AUDIO_PROFILES)){
      expect(Object.keys(gains).sort()).toEqual(['high','low','mid']);
      expect(Object.values(gains).every(x=>Number.isFinite(x)&&Math.abs(x)<=6)).toBe(true);
    }
  });
});
