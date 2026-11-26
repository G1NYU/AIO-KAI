import { describe,expect,it,vi } from 'vitest';
vi.mock('../src/lib/hosts/shell/bridge',()=>({appBridge:()=>undefined,ask:vi.fn()}));
import { parseTsugiRelease,tsugiReleasePage } from '../src/lib/hosts/shell/tsugi-release';
const row={latestTag:'v0.1.0',latestCommit:'a'.repeat(40),currentCommit:'a'.repeat(40),status:'same-build',packageBytes:1000,sha256:'b'.repeat(64),notes:'Official release'};
describe('Tsugi release discovery',()=>{
  it('accepts only canonical release pages and exact build identity',()=>{
    expect(tsugiReleasePage(parseTsugiRelease(row))).toBe('https://github.com/G1NYU/TSUGI/releases/tag/v0.1.0');
    expect(parseTsugiRelease({...row,currentCommit:null,status:'unknown-build'}).status).toBe('unknown-build');
    expect(parseTsugiRelease({...row,currentCommit:'c'.repeat(40),status:'different-build'}).status).toBe('different-build');
  });
  it('rejects invalid URLs, prerelease tags and inconsistent status',()=>{
    for(const invalid of [{...row,latestTag:'../evil'},{...row,latestTag:'v0.01.0'},{...row,latestTag:'v0.1.0-beta'},{...row,sha256:'bad'},{...row,packageBytes:-1},{...row,status:'different-build'},{...row,downloadUrl:'https://example.test/evil.zip'},{...row,notes:'x'.repeat(12001)}])
      expect(()=>parseTsugiRelease(invalid)).toThrow();
  });
});
