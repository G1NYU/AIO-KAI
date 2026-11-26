import { describe, expect, it } from 'vitest';
import { bookResumeRows, mangaResumeRows, musicResumeRows, orderedResumeRows, resumeKey } from '../src/lib/up-next';

describe('Cross-media resume projections', () => {
  it('uses only unfinished, valid book positions and does not copy file metadata', () => {
    const first = {id:'a'.repeat(32),title:'Original PDF',format:'pdf',position:1,fraction:.5,lastReadAt:1760000000000,path:'private-file',cover:'private-cover'};
    const result = bookResumeRows([first,{...first,id:'b'.repeat(32),title:'Completed',fraction:1},{...first,id:'invalid'},
      {...first,id:'c'.repeat(32),format:'epub',position:'invalid'},{...first,id:'d'.repeat(32),position:0},null]);
    expect(result).toEqual([{target:{kind:'book',id:first.id},title:first.title,subtitle:'',format:'pdf',at:1760000000000,progress:.5,available:true}]);
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it('validates reader-local chapter identities, preserves page progress and excludes finished or malformed chapters', () => {
    const chapter = {id:11,name:'Chapter one',lastReadAt:'1760000000',lastPageRead:2,pageCount:4,isRead:false,manga:{id:'1',title:'Original manga',url:'private-source'}};
    const result = mangaResumeRows({nodes:[chapter,chapter,{...chapter,id:12,isRead:true},{...chapter,id:13,lastPageRead:4},
      {...chapter,id:'https://invalid.test'}, {...chapter,manga:{id:0,title:'Bad'}},null]});
    expect(result).toEqual([{target:{kind:'manga',mangaId:1,chapterId:11,title:'Original manga',chapter:'Chapter one'},
      title:'Original manga',subtitle:'Chapter one',page:3,progress:.5,at:1760000000000,available:true}]);
    expect(JSON.stringify(result)).not.toContain('private-source');
  });
  it('keeps source-scoped music identities, disconnected rows and the current queue shortcut distinct', () => {
    const track={id:'same',title:'Original track',artist:'Original artist',artworkURL:'https://private.test/art',streamURL:'https://private.test/stream'};
    const result=musicResumeRows([{sourceId:'a',track,playedAt:1760000000000},{sourceId:'b',track,playedAt:1760000000001},
      {sourceId:'a',track,playedAt:1760000000002}],['a'],{sourceId:'a',track});
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({target:{kind:'music',sourceId:'a',trackId:'same'},current:true,available:true});
    expect(result[1]).toMatchObject({target:{kind:'music',sourceId:'b',trackId:'same'},current:false,available:false});
    expect(JSON.stringify(result)).not.toContain('https://');
    expect(resumeKey({kind:'music',sourceId:'a,b',trackId:'c'})).not.toBe(resumeKey({kind:'music',sourceId:'a',trackId:'b,c'}));
  });
  it('combines media in recency order, deduplicates and caps shortcuts',()=>{
    const books=bookResumeRows(Array.from({length:30},(_,i)=>({id:i.toString(16).padStart(32,'0'),title:'Book '+i,
      format:'pdf',position:1,fraction:.5,lastReadAt:1760000000000+i})));
    expect(books).toHaveLength(12);
    expect(books[0].title).toBe('Book 29');
    expect(orderedResumeRows([...books,...books],4).map(x=>x.title)).toEqual(['Book 29','Book 28','Book 27','Book 26']);
  });
});
