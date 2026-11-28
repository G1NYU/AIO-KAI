import { describe, expect, it } from 'vitest';
import { adjacentWatchVideo, mergeAliasMetadata, titleIdentityRoutes, watchVideoRoutes } from '../src/lib/hosts/shell/watch-identities';
import { BETTER_POSTERS_PATTERN, POSTERS_PLUS_PATTERN, validatePosterPattern, customPosterUrl, watchPosterSources } from '../src/lib/watch-poster-pattern';
import type { AddonMetadata, AddonVideo } from '../src/lib/hosts/shell/stremio';

const video=(id:string,season:number|null,episode:number|null):AddonVideo=>({id,name:id,season,episode});
const metadata=(id:string,mediaType:string,videos:AddonVideo[]):AddonMetadata=>({id,mediaType,name:'Fixture',description:null,videos});
describe('Exact Watch identities',()=>{
  it('uses explicit IMDb aliases and rejects conflicting same-namespace identifiers',()=>{
    const item={id:'tmdb:42',mediaType:'movie',name:'Fixture',imdbId:'tt42',identities:['tt99','tmdb:movie:42','tmdb:99']};
    expect(titleIdentityRoutes(item)).toEqual([{mediaType:'movie',videoId:'tt42'},{mediaType:'movie',videoId:'tmdb:movie:42'}]);
    expect(watchVideoRoutes(item,'tmdb:42',null)).toEqual(titleIdentityRoutes(item));
  });
  it('merges only unique numbered episode routes from verified metadata responses',()=>{
    const base=metadata('tt42','series',[video('tt42:1:1',1,1),video('tt42:1:2',1,2),video('unknown',null,null)]);
    const alt=metadata('tmdb:42','series',[video('custom:one',1,1),video('custom:two',1,2),video('custom:two-b',1,2),video('custom:extra',null,null)]);
    const merged=mergeAliasMetadata(base,alt);
    expect(merged.videos[0].routes).toEqual([{mediaType:'series',videoId:'custom:one'}]);
    expect(merged.videos[1].routes).toBeUndefined();
    expect(merged.videos[2].routes).toBeUndefined();
    expect(watchVideoRoutes({id:base.id,mediaType:base.mediaType,name:base.name},'tt42:1:1',merged)).toEqual([{mediaType:'series',videoId:'custom:one'}]);
  });
  it('does not create series video aliases from a title ID alone',()=>{
    expect(watchVideoRoutes({id:'tmdb:42',mediaType:'series',name:'Fixture',imdbId:'tt42'},'tmdb:42:1:2',null)).toEqual([]);
  });
  it('continues across regular seasons without selecting intervening specials',()=>{
    const rows=[video('s2',2,1),video('s1e2',1,2),video('special',0,1),video('s1e1',1,1),video('extra',null,null)];
    expect(adjacentWatchVideo(rows,'s1e2',1)?.id).toBe('s2');
    expect(adjacentWatchVideo(rows,'s2',-1)?.id).toBe('s1e2');
    expect(adjacentWatchVideo(rows,'special',1)).toBeUndefined();
    expect(adjacentWatchVideo(rows,'extra',1)).toBeUndefined();
    expect(adjacentWatchVideo([...rows,video('s2-copy',2,1)],'s1e2',1)).toBeUndefined();
  });
});

describe('public Watch poster patterns',()=>{
  const film={id:'tt1234567',mediaType:'movie',poster:'https://image.tmdb.org/t/p/w500/film.jpg'};
  it('resolves exact IDs and retains the catalogue fallback',()=>{
    expect(watchPosterSources(film,BETTER_POSTERS_PATTERN)).toEqual(['https://btttr.cc/poster/imdb/poster-default/tt1234567.jpg',film.poster]);
    const plus=new URL(customPosterUrl(POSTERS_PLUS_PATTERN,film)!);
    expect(plus.searchParams.get('imdb_id')).toBe(film.id);
    expect(plus.searchParams.has('tmdb_id')).toBe(false);
    expect(plus.searchParams.get('shape')).toBe('poster');
    expect(customPosterUrl(BETTER_POSTERS_PATTERN,{id:'mal:123',mediaType:'series'})).toBeUndefined();
    expect(watchPosterSources({...film,id:'private-id'},BETTER_POSTERS_PATTERN)).toEqual([film.poster]);
  });
  it('prefers an addon artwork capability by default and retains it as the optional override fallback',()=>{
    const addonPoster='http://tsugi-addon-art.localhost/poster/'+'a'.repeat(32);
    const item={...film,addonPoster};
    expect(watchPosterSources(item)).toEqual([addonPoster,film.poster]);
    expect(watchPosterSources(item,BETTER_POSTERS_PATTERN)).toEqual(['https://btttr.cc/poster/imdb/poster-default/tt1234567.jpg',addonPoster,film.poster]);
    expect(watchPosterSources(item,undefined,'https://image.tmdb.org/t/p/w500/enriched.jpg')).toEqual([addonPoster,film.poster,'https://image.tmdb.org/t/p/w500/enriched.jpg']);
  });
  it('rejects credentials, untrusted origins, static titles and unsupported placeholders',()=>{
    for(const pattern of [BETTER_POSTERS_PATTERN+'?token=secret',BETTER_POSTERS_PATTERN.replace('btttr.cc','evil.example'),BETTER_POSTERS_PATTERN.replace('https:','http:'),BETTER_POSTERS_PATTERN.replace('{imdb_id}','tt123'),POSTERS_PLUS_PATTERN+'&api_key=secret',POSTERS_PLUS_PATTERN.replace('{id}','{password}'),POSTERS_PLUS_PATTERN.replace('postersplus.cc','user@postersplus.cc')])expect(validatePosterPattern(pattern)).toBeUndefined();
    expect(validatePosterPattern(BETTER_POSTERS_PATTERN+'?lang=fr&rs=TM')).toBeDefined();
    expect(validatePosterPattern(POSTERS_PLUS_PATTERN+'&textless=false&bdm=7')).toBeDefined();
  });
  it('does not reuse a movie TMDB ID for a series',()=>{
    expect(customPosterUrl('https://postersplus.cc/poster?tmdb_id={tmdb_id}&type={type}',{id:'tmdb:movie:123',mediaType:'series'})).toBeUndefined();
  });
});
