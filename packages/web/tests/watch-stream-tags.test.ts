import {describe,expect,it} from 'vitest';
import {reportedAddonStreamTags as tags} from '../src/lib/hosts/shell/watch-stream-tags';

describe('reported addon stream tags',()=>{
  it('never derives availability, audio or size from transport or resolution alone',()=>{
    expect(tags({name:'1080p direct HTTPS'})).toEqual({audio:[],sizeBytes:undefined,size:undefined,cache:undefined});
  });
  it('uses explicit multi-line provider audio, size and cache labels',()=>{
    expect(tags({name:'1080p HEVC',detail:'TrueHD Atmos\n8.5 GB | Cached'})).toEqual({audio:['Atmos','TrueHD'],sizeBytes:8500000000,size:'5-to-15',cache:'cached'});
    expect(tags({name:'720p AAC',detail:'700 MB | not cached'})).toEqual({audio:['AAC'],sizeBytes:700000000,size:'under-1',cache:'uncached'});
  });
  it('distinguishes audio families without duplicate parent codecs',()=>{
    expect(tags({name:'DTS-HD 5.1'}).audio).toEqual(['DTS-HD']);
    expect(tags({name:'DTS:X / E-AC-3'}).audio).toEqual(['DTS:X','E-AC-3']);
    expect(tags({name:'DD+ AC3'}).audio).toEqual(['E-AC-3','AC-3']);
  });
  it('normalizes byte units and keeps exact range boundaries',()=>{
    expect(tags({name:'1 GiB'}).sizeBytes).toBe(1073741824);
    expect(tags({name:'5 GB 5000 MB'}).size).toBe('5-to-15');
    expect(tags({name:'15 GB'}).size).toBe('15-plus');
    expect(tags({name:'1 GB'}).size).toBe('1-to-5');
  });
  it('does not guess when sizes conflict or are ambiguous bitrates',()=>{
    for(const name of ['1,024 MB','12 GB/s','12 Gb','1 GB / 2 GB','1080p 720p'])expect(tags({name}).sizeBytes,name).toBeUndefined();
  });
  it('does not convert negative or conflicting cache labels into a positive hit',()=>{
    expect(tags({name:'Uncached'}).cache).toBe('uncached');
    expect(tags({name:'Cached / not cached'}).cache).toBeUndefined();
    expect(tags({name:'not in cache'}).cache).toBe('uncached');
  });
});
