import { describe, expect, it } from 'vitest';
import { vaultAudioImportPlan, vaultAudioType, MAX_VAULT_AUDIO_BYTES, type VaultAudioEntry } from '../src/lib/music/vault-audio';

const digest=(n:number)=>'vault-audio:'+n.toString(16).padStart(64,'0');
const row=(n:number,size=100):VaultAudioEntry=>({id:digest(n),name:'Track.wav',title:'Track',size,duration:4,addedAt:1,jobs:['vault-job-'+n]});

describe('Vault audio import identity and limits',()=>{
  it('distinguishes new, duplicate content and an existing job',()=>{
    const saved=row(1);
    expect(vaultAudioImportPlan([saved],'vault-job-2',{id:digest(2),size:100})).toEqual({kind:'new'});
    expect(vaultAudioImportPlan([saved],'vault-job-2',saved)).toEqual({kind:'duplicate',entry:saved});
    expect(vaultAudioImportPlan([saved],'vault-job-1',saved)).toEqual({kind:'existing',entry:saved});
    expect(saved.jobs).toEqual(['vault-job-1']);
    expect(()=>vaultAudioImportPlan([saved],'vault-job-1',row(2))).toThrow('vault-job-content-changed');
    expect(()=>vaultAudioImportPlan([saved],'vault-job-2',{...saved,size:101})).toThrow();
  });
  it('rejects malformed or ambiguous records and unsupported filenames',()=>{
    expect(vaultAudioType('Original.WAV')).toBe('audio/wav');
    for(const name of ['mp3','file.exe','../file.wav','file.wav\n','file.wav/',''])expect(vaultAudioType(name)).toBeUndefined();
    expect(()=>vaultAudioImportPlan([],'bad',row(1))).toThrow();
    expect(()=>vaultAudioImportPlan([],'vault-job-1\n',row(1))).toThrow();
    expect(()=>vaultAudioImportPlan([],'vault-job-1',{...row(1),id:digest(1)+'\n'})).toThrow();
    expect(()=>vaultAudioImportPlan([row(1),row(1)],'vault-job-2',row(2))).toThrow('invalid-vault-audio-index');
    expect(()=>vaultAudioImportPlan([row(1),{...row(2),jobs:['vault-job-1']}],'vault-job-3',row(3))).toThrow('invalid-vault-audio-index');
  });
  it('enforces file, library and alias caps before a new write',()=>{
    expect(()=>vaultAudioImportPlan([],'vault-job-1',row(1,MAX_VAULT_AUDIO_BYTES+1))).toThrow();
    const full=Array.from({length:16},(_,n)=>row(n,MAX_VAULT_AUDIO_BYTES));
    expect(()=>vaultAudioImportPlan(full,'vault-job-99',row(99))).toThrow('vault-audio-library-limit');
    expect(vaultAudioImportPlan(full,'vault-job-99',full[0]).kind).toBe('duplicate');
    const many=Array.from({length:250},(_,n)=>row(n));
    expect(()=>vaultAudioImportPlan(many,'vault-job-999',row(999))).toThrow('vault-audio-library-limit');
    const aliases={...row(1),jobs:Array.from({length:64},(_,n)=>'vault-alias-'+n)};
    expect(()=>vaultAudioImportPlan([aliases],'vault-job-2',aliases)).toThrow('vault-audio-alias-limit');
  });
});
