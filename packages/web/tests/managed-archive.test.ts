import { describe,expect,it,vi } from 'vitest';
vi.mock('../src/lib/hosts/shell/bridge',()=>({appBridge:()=>undefined,ask:vi.fn()}));
import { parseManagedBackup,parseManagedBackupList } from '../src/lib/backup/managed-archive';
import { PORTABLE_ARCHIVE_LIMIT } from '../src/lib/backup/archive';
const row={name:'tsugi-backup-1760000000000-'+'a'.repeat(32)+'.json',createdMs:1760000000000,bytes:100,readable:true};
describe('managed backup response validation',()=>{
  it('accepts generated names and sorts copies newest first',()=>{
    const newer={...row,name:row.name.replace('1760000000000','1760000000001'),createdMs:1760000000001};
    expect(parseManagedBackupList({folder:'C:/Tsugi/data/backups',backups:[row,newer]}).backups).toEqual([newer,row]);
  });
  it('rejects arbitrary paths, inconsistent metadata and duplicates',()=>{
    for(const invalid of [{...row,name:'../private.json'},{...row,createdMs:0},{...row,bytes:-1},{...row,readable:false},{...row,token:'secret'}])
      expect(()=>parseManagedBackup(invalid)).toThrow();
    expect(()=>parseManagedBackupList({folder:'C:/Tsugi/data/backups',backups:[row,row]})).toThrow();
  });
  it('allows listing oversized copies but never marks them openable',()=>{
    expect(parseManagedBackup({...row,bytes:PORTABLE_ARCHIVE_LIMIT+1,readable:false}).readable).toBe(false);
    expect(()=>parseManagedBackup({...row,bytes:PORTABLE_ARCHIVE_LIMIT+1})).toThrow();
  });
});
