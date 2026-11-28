import { describe, expect, it } from 'vitest';
import { rankCatalogueSearch, searchAliasTargets } from '../src/lib/hosts/shell/watch-search';

import { chooseWatchFeatured,watchCountryFromLocales,watchResumePresentation } from '../src/lib/hosts/shell/watch-presentation';

describe('Watch presentation',()=>{
  const candidate=(id:number,mediaType:string,sourceId=1)=>({sourceId,target:sourceId,item:{id:'tt'+id,name:'Title '+id,mediaType,poster:'poster'}});
  it('reserves a real series slide, keeps canonical route, and limits the carousel',()=>{
    const movies=Array.from({length:10},(_,index)=>candidate(index+1,'movie'));
    const series=candidate(22,'series',2);
    const duplicate={...series,sourceId:3,target:3};
    const slides=chooseWatchFeatured([...movies,series,duplicate]);
    expect(slides).toHaveLength(8);
    expect(slides.filter(slide=>slide.kind==='series')).toHaveLength(1);
    expect(slides.find(slide=>slide.kind==='series')?.target).toBe(2);
    expect(slides[0].item.id).toBe('tt1');
    expect(chooseWatchFeatured([{...series,item:{...series.item,poster:undefined}}])).toEqual([]);
  });
  it('uses exact season/episode and clamps progress without inventing duration',()=>{
    const progress={mediaType:'series',itemId:'tt42',videoId:'tt42:2:7',title:'Series',episodeTitle:'Episode',positionMs:45000,durationMs:120000,completed:false};
    expect(watchResumePresentation(progress)).toEqual({numbers:{season:2,episode:7},percent:37.5,remainingMinutes:2});
    expect(watchResumePresentation({...progress,videoId:'opaque',durationMs:0})).toEqual({numbers:undefined,percent:undefined,remainingMinutes:undefined});
    expect(watchResumePresentation({...progress,mediaType:'movie',positionMs:130000})).toEqual({numbers:undefined,percent:100,remainingMinutes:undefined});
  });
  it('never guesses a country from a language alone',()=>{
    expect(watchCountryFromLocales(['fr','nl-BE'])).toBe('BE');
    expect(watchCountryFromLocales(['zh-Hant-TW'])).toBe('TW');
    expect(watchCountryFromLocales(['en','fr'])).toBe('');
  });
});

describe('Watch catalogue search',()=>{
  const item=(id:string,name:string,mediaType='movie',imdbId?:string,poster?:string)=>({id,name,mediaType,imdbId,poster});
  const candidate=(sourceId:number,row:ReturnType<typeof item>)=>({sourceId,target:sourceId,item:row});
  it('ranks exact and prefix titles, excluding unrelated matches',()=>{
    const rows=[candidate(1,item('local:1','Another film')),candidate(1,item('tt2','Example film sequel')),candidate(1,item('tt1','Éxample Film'))];
    expect(rankCatalogueSearch(rows,'example film').map(row=>row.item.id)).toEqual(['tt1','tt2']);
  });
  it('retains a public provider title match for alternate title queries without accepting unrelated addon items',()=>{
    const publicResult={...candidate(0,item('mal:42','Example English Name','series')),providerMatch:true};
    const exact=candidate(1,item('tt42','Example alternate name','series'));
    const unrelated=candidate(2,item('local:1','Another anime','series'));
    expect(rankCatalogueSearch([publicResult,unrelated,exact],'Example alternate name').map(row=>row.item.id)).toEqual(['tt42','mal:42']);
  });
  it('merges explicit IMDb matches while preserving the canonical provider route and artwork',()=>{
    const addonPoster='http://tsugi-addon-art.localhost/poster/0123456789abcdef0123456789abcdef';
    const rows=[candidate(2,{...item('tmdb:42','Example','movie','tt42','poster'),addonPoster}),candidate(3,item('tt42','Example'))];
    const result=rankCatalogueSearch(rows,'Example');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({sourceId:3,target:3,item:{id:'tt42',poster:'poster',addonPoster}});
  });
  it('does not merge provider-local IDs or different media types by name',()=>{
    const rows=[candidate(1,item('local:1','Example')),candidate(2,item('local:1','Example')),candidate(1,item('tt42','Example')),candidate(2,item('tt42','Example','series'))];
    expect(rankCatalogueSearch(rows,'Example')).toHaveLength(4);
  });
  it('requests explicit alias resolution only for same-kind overlapping titles',()=>{
    const movie=item('tmdb:movie:42','Family Guy','movie'),series=item('tmdb:tv:42','Family Guy','series');
    const matching=item('tt42','Family Guy','series'),other=item('tt43','Another movie','movie');
    expect(searchAliasTargets([movie,series],[matching,other])).toEqual([series]);
    expect(rankCatalogueSearch([candidate(0,series),candidate(1,matching)],'Family Guy')).toHaveLength(2);
    expect(rankCatalogueSearch([candidate(0,{...series,imdbId:'tt42'}),candidate(1,matching)],'Family Guy')).toHaveLength(1);
  });
  it('keeps raw IMDb identity ahead of conflicting aliases',()=>{
    const rows=[candidate(1,item('tt42','Example','movie','tt99')),candidate(2,item('tt99','Example'))];
    expect(rankCatalogueSearch(rows,'Example')).toHaveLength(2);
  });
});
