import {describe,expect,it} from 'vitest';
import {parseTvmaze,tvmazeFeedPath} from '../src/lib/hosts/shell/tvmaze';

describe('TVmaze discovery',()=>{
  const image='https://static.tvmaze.com/uploads/images/medium_portrait/1/123.jpg';
  const show={id:123,name:'Example series',type:'Scripted',genres:['Drama'],externals:{imdb:'tt123'},image:{medium:image},premiered:'2024-03-01'};
  it('handles schedules, web schedules and search without inventing playback identities',()=>{
    expect(parseTvmaze([{show},{_embedded:{show}},{score:1,show}])).toEqual([{id:'tt123',imdbId:'tt123',mediaType:'series',name:'Example series',poster:image,releaseInfo:'2024-03-01'}]);
    expect(parseTvmaze([{show:{...show,externals:{imdb:null}}},{show:{...show,externals:{imdb:'tvmaze:123'}}},{show:{...show,genres:['Anime']}},{show:{...show,type:'Reality'}}])).toEqual([]);
  });
  it('rejects private or decorated image routes and malformed payloads',()=>{
    for(const medium of ['https://localhost/a.jpg',image+'?token=test','https://u@static.tvmaze.com/uploads/images/medium_portrait/1/123.jpg']){
      expect(parseTvmaze([{show:{...show,image:{medium}}}])[0].poster).toBeUndefined();
    }
    expect(()=>parseTvmaze({show})).toThrow('tvmaze-response');
  });
  it('uses fixed schedule endpoints and crosses dates correctly',()=>{
    const date=new Date(2024,11,31,12);
    expect(tvmazeFeedPath('streaming-today',date)).toBe('/schedule/web?date=2024-12-31');
    expect(tvmazeFeedPath('streaming-tomorrow',date)).toBe('/schedule/web?date=2025-01-01');
    expect(tvmazeFeedPath('broadcast-gb',date)).toBe('/schedule?country=GB&date=2024-12-31');
    expect(tvmazeFeedPath('broadcast-us',date)).toBe('/schedule?country=US&date=2024-12-31');
  });
});
