import { describe,expect,it,vi } from 'vitest';
vi.mock('../src/lib/hosts/shell/bridge',()=>({appBridge:()=>undefined,ask:vi.fn()}));
import { parseManagedBackup,parseManagedBackupList,parseStorageUsage,STORAGE_KINDS } from '../src/lib/backup/managed-archive';
import { PORTABLE_ARCHIVE_LIMIT } from '../src/lib/backup/archive';
const row={name:'tsugi-backup-1760000000000-'+'a'.repeat(32)+'.json',createdMs:1760000000000,bytes:100,readable:true};
describe('managed backup response validation',()=>{
  it('accepts generated names and sorts copies newest first',()=>{
    const newer={...row,name:row.name.replace('1760000000000','1760000000001'),createdMs:1760000000001};
    expect(parseManagedBackupList({folder:'C:/Tsugi/data/backups',backups:[row,newer]}).backups).toEqual([newer,row]);
    const automatic={...newer,name:newer.name.replace('tsugi-backup-','tsugi-auto-backup-')};
    expect(parseManagedBackupList({folder:'C:/Tsugi/data/backups',backups:[row,automatic]}).backups).toEqual([automatic,row]);
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

describe('storage inventory response',()=>{
  const rows=STORAGE_KINDS.map(kind=>({kind,bytes:1024,files:1,skipped:0,complete:true}));
  it('accepts distinct categories and explicitly partial scans',()=>{
    expect(parseStorageUsage({rows:rows.slice(0,6)})).toEqual(rows.slice(0,6));
    expect(()=>parseStorageUsage({rows:[...rows.slice(0,5),rows[6]]})).toThrow();
    expect(parseStorageUsage({rows:[...rows].reverse()})).toEqual(rows);
    expect(parseStorageUsage({rows:rows.map((row,i)=>i===0?{...row,skipped:1,complete:false}:row)})[0].complete).toBe(false);
  });
  it('rejects unknown, duplicate, inconsistent and unsafe values',()=>{
    for(const invalid of [{...rows[0],kind:'arbitrary'},{...rows[0],kind:'reader'},{...rows[0],bytes:-1},{...rows[0],bytes:Infinity},{...rows[0],skipped:1},{...rows[0],path:'private'}])
      expect(()=>parseStorageUsage({rows:[invalid,...rows.slice(1)]})).toThrow();
    expect(()=>parseStorageUsage({rows:rows.slice(1)})).toThrow();
  });
});
