import { describe,expect,it } from 'vitest';
import { BETTER_POSTERS_PATTERN, POSTERS_PLUS_PATTERN, validatePosterPattern, customPosterUrl, watchPosterSources } from '../src/lib/watch-poster-pattern';

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
  it('rejects credentials, untrusted origins, static titles and unsupported placeholders',()=>{
    for(const pattern of [BETTER_POSTERS_PATTERN+'?token=secret',BETTER_POSTERS_PATTERN.replace('btttr.cc','evil.example'),BETTER_POSTERS_PATTERN.replace('https:','http:'),BETTER_POSTERS_PATTERN.replace('{imdb_id}','tt123'),POSTERS_PLUS_PATTERN+'&api_key=secret',POSTERS_PLUS_PATTERN.replace('{id}','{password}'),POSTERS_PLUS_PATTERN.replace('postersplus.cc','user@postersplus.cc')])expect(validatePosterPattern(pattern)).toBeUndefined();
    expect(validatePosterPattern(BETTER_POSTERS_PATTERN+'?lang=fr&rs=TM')).toBeDefined();
    expect(validatePosterPattern(POSTERS_PLUS_PATTERN+'&textless=false&bdm=7')).toBeDefined();
  });
  it('does not reuse a movie TMDB ID for a series',()=>{
    expect(customPosterUrl('https://postersplus.cc/poster?tmdb_id={tmdb_id}&type={type}',{id:'tmdb:movie:123',mediaType:'series'})).toBeUndefined();
  });
});
