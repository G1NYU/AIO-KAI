import { describe,expect,it } from 'vitest';
import { fingerprintBook,parseBookBackup,planBookRestore,BOOK_BACKUP_LIMIT,type BookBackup,type LocalBookFingerprint } from '../src/lib/backup/books';
const id='11111111111111111111111111111111';
const other='22222222222222222222222222222222';
const hash='a'.repeat(64);
const book={id,name:'Original.pdf',title:'Original title',format:'pdf' as const,size:100,sha256:hash,progress:{position:5,fraction:.5,lastReadAt:100}};
const backup:BookBackup={format:'tsugi-book-progress',version:1,books:[book]};
function local(overrides:Partial<LocalBookFingerprint['metadata']>={},sha256=hash):LocalBookFingerprint{
  return {metadata:{id:other,name:'Original.pdf',title:'Original',format:'pdf',size:100,addedAt:1,position:undefined,fraction:undefined,lastReadAt:undefined,...overrides},sha256};
}
describe('book progress backups',()=>{
  it('hashes file bytes, not names',async()=>{
    expect(await fingerprintBook(new Blob(['abc']))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await fingerprintBook(new Blob(['abcd']))).not.toBe(await fingerprintBook(new Blob(['abc'])));
  });
  it('matches reimported identical contents, restores position and default title',()=>{
    const result=planBookRestore(backup,[local()]);
    expect(result.rows[0].state).toBe('ready');
    expect(result.changes[0]).toMatchObject({expected:{id:other},title:'Original title',progress:book.progress});
    expect(planBookRestore(backup,[local({},'b'.repeat(64))]).rows[0].state).toBe('missing');
  });
  it('preserves newer progress and customized local title',()=>{
    const result=planBookRestore(backup,[local({title:'My title',position:6,fraction:.6,lastReadAt:200})]);
    expect(result.changes).toHaveLength(0);
    expect(result.rows[0]).toMatchObject({state:'newer',titleConflict:true});
  });
  it('does not guess between duplicate files or map two originals into one local copy',()=>{
    expect(planBookRestore(backup,[local(),local({id:'33333333333333333333333333333333'})]).rows[0].state).toBe('ambiguous');
    const duplicate={...backup,books:[book,{...book,id:'44444444444444444444444444444444'}]};
    expect(planBookRestore(duplicate,[local()]).rows.map(row=>row.state)).toEqual(['ambiguous','ambiguous']);
  });
  it('rejects invalid progress, credentials, duplicate IDs and oversized input',()=>{
    expect(parseBookBackup(JSON.stringify(backup))).toEqual(backup);
    for(const invalid of [{...backup,token:'secret'},{...backup,books:[book,book]},
      {...backup,books:[{...book,progress:{...book.progress,position:0}}]},
      {...backup,books:[{...book,name:'../Original.pdf'}]},
      {...backup,books:[{...book,format:'epub',name:'Original.epub',progress:{position:'epubcfi(https://private.test/token)',fraction:.5,lastReadAt:100}}]}])
      expect(()=>parseBookBackup(JSON.stringify(invalid))).toThrow();
    expect(()=>parseBookBackup(' '.repeat(BOOK_BACKUP_LIMIT+1))).toThrow();
  });
});
