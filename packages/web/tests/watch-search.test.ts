import { describe, expect, it } from 'vitest';
import { rankCatalogueSearch } from '../src/lib/hosts/shell/watch-search';

describe('Watch catalogue search',()=>{
  const item=(id:string,name:string,mediaType='movie',imdbId?:string,poster?:string)=>({id,name,mediaType,imdbId,poster});
  const candidate=(sourceId:number,row:ReturnType<typeof item>)=>({sourceId,target:sourceId,item:row});
  it('ranks exact and prefix titles, excluding unrelated matches',()=>{
    const rows=[candidate(1,item('local:1','Another film')),candidate(1,item('tt2','Example film sequel')),candidate(1,item('tt1','Éxample Film'))];
    expect(rankCatalogueSearch(rows,'example film').map(row=>row.item.id)).toEqual(['tt1','tt2']);
  });
  it('merges explicit IMDb matches while preserving the canonical provider route and artwork',()=>{
    const rows=[candidate(2,item('tmdb:42','Example','movie','tt42','poster')),candidate(3,item('tt42','Example'))];
    const result=rankCatalogueSearch(rows,'Example');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({sourceId:3,target:3,item:{id:'tt42',poster:'poster'}});
  });
  it('does not merge provider-local IDs or different media types by name',()=>{
    const rows=[candidate(1,item('local:1','Example')),candidate(2,item('local:1','Example')),candidate(1,item('tt42','Example')),candidate(2,item('tt42','Example','series'))];
    expect(rankCatalogueSearch(rows,'Example')).toHaveLength(4);
  });
  it('keeps raw IMDb identity ahead of conflicting aliases',()=>{
    const rows=[candidate(1,item('tt42','Example','movie','tt99')),candidate(2,item('tt99','Example'))];
    expect(rankCatalogueSearch(rows,'Example')).toHaveLength(2);
  });
});
