import { describe, expect, it } from 'vitest';
import { adjacentWatchVideo, mergeAliasMetadata, titleIdentityRoutes, watchVideoRoutes } from '../src/lib/hosts/shell/watch-identities';
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
