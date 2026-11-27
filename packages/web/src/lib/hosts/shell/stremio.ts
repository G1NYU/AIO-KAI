import { appBridge, ask } from './bridge';
import { validateMalEntries, type MalEntry } from '../../mal-collection';

export interface AddonExtra { name: string; required: boolean; options: string[]; optionsLimit: number | null }
export interface AddonCatalog { id: string; mediaType: string; name: string; extras: AddonExtra[] }
export interface AddonManifest {
  id: string; name: string; version: string; resources: string[]; catalogs: AddonCatalog[];
  configurable: boolean; configurationRequired: boolean; p2p: boolean; adult: boolean;
}
export interface AddonSource { sourceId: number; enabled: boolean; manifest: AddonManifest }
/** Virtual public catalogue, never installed, mutated or used for streams. */
// The protocol manifest descriptor is not localized; catalogue headings are translated at render time.
/* eslint-disable lingui/no-unlocalized-strings */
export const publicCinemeta:AddonSource={
  sourceId:0,enabled:true,manifest:{
    id:'com.linvo.cinemeta',name:'Cinemeta',version:'3.0.14',resources:['catalog','meta'],
    configurable:false,configurationRequired:false,p2p:false,adult:false,
    catalogs:['movie','series'].flatMap(mediaType=>['top','imdbRating'].map(id=>({
      id,mediaType,name:id==='top'?(mediaType==='movie'?'Popular movies':'Popular series'):(mediaType==='movie'?'Featured movies':'Featured series'),
      extras:(id==='top'?['search','skip']:['skip']).map(name=>({name,required:false,options:[],optionsLimit:null}))
    })))
  }
};
/* eslint-enable lingui/no-unlocalized-strings */
export interface AddonReview { reviewId: number; manifest: AddonManifest }
export interface CatalogPage {
  sourceId: number; mediaType: string; catalogId: string;
  items: { id: string; name: string; mediaType: string; poster?: string; description?: string }[]; sourceCount: number; nextSkip: number | null;
}
export type Mutation = { kind: 'install'; reviewId: number } | { kind: 'set-enabled'; sourceId: number; enabled: boolean }
  | { kind: 'move'; sourceId: number; position: number } | { kind: 'remove'; sourceId: number };
export type CatalogAction = { kind: 'catalog'; sourceId: number; mediaType: string; catalogId: string; extras: Record<string,string> };
export type ImportProvider='stremio'|'nuvio';
type ImportAction = {kind:'import-connect';provider:ImportProvider;email:string;password:string}
  | {kind:'import-nuvio-profile';importId:number;remoteProfile:number}
  | {kind:'import-review';importId:number;selected:number[]}
  | {kind:'import-apply';importId:number} | {kind:'import-cancel';importId:number};
type ItemAction = {kind:'metadata';sourceId:number;mediaType:string;itemId:string} | {kind:'item-options';sourceId:number;mediaType:string;videoId:string;subtitles:boolean} | {kind:'all-stream-options';mediaType:string;videoId:string} | {kind:'prepare-media';reviewId:number;optionIndex:number;startMs:number};
type MdblistAction={kind:'mdblist-status'}|{kind:'mdblist-connect';key:string}|{kind:'mdblist-disconnect'}|{kind:'mdblist-lists'}|{kind:'mdblist-page';listId:number;offset:number};
export type WatchProgress={mediaType:string;itemId:string;videoId:string;title:string;episodeTitle:string|null;positionMs:number;durationMs:number;completed:boolean};
export type WatchHistoryEntry={progress:WatchProgress;updatedAt:number};
type WatchHistoryAction={kind:'watch-history'}|{kind:'watch-record';progress:WatchProgress;viewingId?:string}|({kind:'watch-remove'}&Pick<WatchProgress,'mediaType'|'itemId'|'videoId'>);
type RefractAction={kind:'refract-threshold';percent:number|null}|{kind:'watch-complete';mediaType:string;itemId:string;videoId:string;updatedAt:number}|{kind:'refract-status'}|{kind:'refract-connect';key:string}|{kind:'refract-enable';enabled:boolean}|{kind:'refract-disconnect';discardPending:boolean}|{kind:'refract-sync'}|{kind:'refract-watchlist';mediaType:string;itemId:string;add:boolean};
type MalAnimeAction={kind:'mal-anime-list'}|{kind:'mal-anime-import';entries:MalEntry[]}|{kind:'mal-anime-remove';malId:number}|{kind:'mal-anime-match';malId:number;sourceId:number;mediaType:string;itemId:string}|{kind:'mal-anime-unmatch';malId:number};
type Action = Mutation | CatalogAction | ImportAction | ItemAction | MdblistAction | WatchHistoryAction | RefractAction | MalAnimeAction | { kind: 'list' } | { kind: 'review'; url: string } | { kind: 'cancel-review'; reviewId: number };
export type RemoteAddonProfile={profileIndex:number;name:string;usesPrimaryAddons:boolean;locked:boolean};
export type ImportCandidate={candidateId:number;name:string;host:string;enabled:boolean;alreadyInstalled:boolean};
type ImportBase={importId:number;provider:ImportProvider};
export type ImportProfiles=ImportBase&{phase:'profiles';remoteProfiles:RemoteAddonProfile[]};
export type ImportCandidates=ImportBase&{phase:'candidates';candidates:ImportCandidate[];availableSlots:number;skipped:number;remoteProfile?:number;effectiveProfile?:number};
export type ImportReview=ImportBase&{phase:'review';ready:(Omit<ImportCandidate,'alreadyInstalled'>&{manifest:AddonManifest})[];rejected:{candidateId:number;name:string;reason:string}[]};
export type AccountImport=ImportProfiles|ImportCandidates|ImportReview;
export type AddonProfile = { profileId:number; name:string; sourceCount:number };
export type ProfileState = { activeProfileId:number; profiles:AddonProfile[] };
export type ProfileMutation = {kind:'profile-create';name:string} | {kind:'profile-rename';profileId:number;name:string}
  | {kind:'profile-switch';profileId:number} | {kind:'profile-remove';profileId:number;confirmedName:string};
type NativeAction = ProfileMutation | {kind:'profile-list'} | {kind:'profile-request';profileId:number;action:Action};

export class AddonError extends Error {
  constructor(readonly code: string) { super('addon-request'); }
}
const fail = (): never => { throw new AddonError('invalid-response'); };
function obj(v: unknown): Record<string,unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return fail();
  return v as Record<string,unknown>;
}
function str(v: unknown, limit: number): string {
  if (typeof v !== 'string' || !v.trim() || v.length > limit || /[\u0000-\u001f\u007f]/u.test(v)) return fail();
  return v;
}
function integer(v: unknown, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) return fail();
  return v;
}
function bool(v: unknown): boolean { return typeof v === 'boolean' ? v : fail(); }
function array<T>(v: unknown, max: number, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(v) || v.length > max) return fail();
  return v.map(parse);
}
function manifest(v: unknown): AddonManifest {
  const m = obj(v);
  return {
    id: str(m.id,512), name: str(m.name,256), version: str(m.version,64),
    resources: array(m.resources,4,r=>{const name=str(r,32);return ['catalog','meta','stream','subtitles'].includes(name)?name:fail();}),
    catalogs: array(m.catalogs,128,c=>{
      const row=obj(c);
      return {id:str(row.id,512),mediaType:str(row.mediaType,32),name:str(row.name,256),
        extras:array(row.extras,16,e=>{
          const extra=obj(e);
          return {name:str(extra.name,32),required:bool(extra.required),options:array(extra.options,256,o=>str(o,512)),
            optionsLimit:extra.optionsLimit===null?null:integer(extra.optionsLimit,1,0xffffffff)};
        })};
    }),
    configurable:bool(m.configurable),configurationRequired:bool(m.configurationRequired),p2p:bool(m.p2p),adult:bool(m.adult),
  };
}
function sources(v: unknown): AddonSource[] {
  const rows=array(obj(v).sources,16,item=>{
    const s=obj(item);return {sourceId:integer(s.sourceId,1,0xffffffff),enabled:bool(s.enabled),manifest:manifest(s.manifest)};
  });
  if(new Set(rows.map(s=>s.sourceId)).size!==rows.length)return fail();
  return rows;
}
const codes=new Set(['invalid-endpoint','invalid-manifest','manifest-limit','configuration-required','duplicate','source-limit','expired-review','unknown-source','disabled-source','unsupported-catalog','invalid-extras','required-extra','invalid-position','invalid-resource','invalid-catalog','catalog-limit','response-limit','network','request','auth','rate','busy','unsupported','invalid-response','profile-required','profile-changed','unknown-profile','invalid-profile-name','duplicate-profile','profile-limit','active-profile','profile-confirmation','profile-store','profile-store-limit','account-auth','account-request','account-response','import-limit','import-selection','unknown-remote-profile','locked-remote-profile','unsupported-resource','invalid-item','item-limit','invalid-media-selection','mdblist-response','mdblist-auth','mdblist-network','mdblist-request','mdblist-not-found','mdblist-rate','mdblist-disconnected','invalid-watch-progress','refract-auth','refract-scope','refract-rate','refract-network','refract-request','refract-response','refract-rejected','refract-conflict','refract-unmatched','refract-queue-full','refract-clock','refract-protected','refract-account-changed','refract-disconnected','refract-paused','refract-pending','mal-invalid','mal-limit']);
async function request(action: NativeAction): Promise<unknown> {
  if(!appBridge()?.stremioAddons)throw new AddonError('unsupported');
  const id=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
  const reply=await ask({type:'stremio-request',request:id,action},'stremio-result',{timeoutMs:action.kind==='profile-request'&&['import-review','all-stream-options'].includes(action.action.kind)?120_000:action.kind==='profile-request'&&action.action.kind.startsWith('watch-')?12_000:85_000,matches:m=>m.request===id})
    .catch(()=>{throw new AddonError('network');});
  if(reply.error!==null)throw new AddonError(codes.has(reply.error)?reply.error:'request');
  return reply.data;
}
function profileState(v:unknown):ProfileState{
  const data=obj(v);
  const activeProfileId=integer(data.activeProfileId,1,0xffffffff);
  const profiles=array(data.profiles,6,p=>{
    const row=obj(p);return {profileId:integer(row.profileId,1,0xffffffff),name:str(row.name,256),sourceCount:integer(row.sourceCount,0,16)};
  });
  if(!profiles.some(p=>p.profileId===activeProfileId)||new Set(profiles.map(p=>p.profileId)).size!==profiles.length)return fail();
  return {activeProfileId,profiles};
}
export async function listAddonProfiles(){return profileState(await request({kind:'profile-list'}));}
export async function mutateAddonProfile(action:ProfileMutation){return profileState(await request(action));}
async function scoped(profileId:number,action:Action){
  const v=obj(await request({kind:'profile-request',profileId,action}));
  if(v.profileId!==profileId)return fail();
  return v;
}
export async function listAddons(profileId:number){return sources(await scoped(profileId,{kind:'list'}));}
export type MalAnimeMatch={malId:number;sourceId:number;mediaType:string;itemId:string;name:string};
export type MalAnimeCollection={entries:MalEntry[];matches:MalAnimeMatch[]};
function malAnimeCollection(value:unknown):MalAnimeCollection{
  try{
    const raw=obj(value),entries=validateMalEntries(raw.entries,'anime');
    const byId=new Map(entries.map(entry=>[entry.malId,entry]));
    const matches=array(raw.matches,entries.length,row=>{
      const m=obj(row),malId=integer(m.malId,1,2147483647),entry=byId.get(malId);
      const mediaType=str(m.mediaType,32),itemId=str(m.itemId,512);
      if(!entry||!['anime',entry.format.toLowerCase()==='movie'?'movie':'series'].includes(mediaType)||
        itemId==='.'||itemId==='..'||/[/\\]/.test(itemId))return fail();
      return {malId,sourceId:integer(m.sourceId,1,0xffffffff),mediaType,itemId,name:str(m.name,512)};
    });
    if(new Set(matches.map(m=>m.malId)).size!==matches.length||
        new Set(matches.map(m=>JSON.stringify([m.mediaType,m.itemId]))).size!==matches.length)return fail();
    return {entries,matches};
  }catch{return fail();}
}
export async function listMalAnime(profileId:number){return malAnimeCollection(await scoped(profileId,{kind:'mal-anime-list'}));}
export async function importMalAnime(profileId:number,entries:MalEntry[]){return malAnimeCollection(await scoped(profileId,{kind:'mal-anime-import',entries:validateMalEntries(entries,'anime')}));}
export async function removeMalAnime(profileId:number,malId:number){return malAnimeCollection(await scoped(profileId,{kind:'mal-anime-remove',malId:integer(malId,1,2147483647)}));}
export async function matchMalAnime(profileId:number,malId:number,sourceId:number,item:CatalogPage['items'][number]){
  const collection=malAnimeCollection(await scoped(profileId,{kind:'mal-anime-match',malId:integer(malId,1,2147483647),sourceId:integer(sourceId,1,0xffffffff),mediaType:item.mediaType,itemId:item.id}));
  const saved=collection.matches.find(row=>row.malId===malId);
  if(!saved||saved.sourceId!==sourceId||saved.mediaType!==item.mediaType||saved.itemId!==item.id||saved.name!==item.name)return fail();
  return collection;
}
export async function unmatchMalAnime(profileId:number,malId:number){
  const collection=malAnimeCollection(await scoped(profileId,{kind:'mal-anime-unmatch',malId:integer(malId,1,2147483647)}));
  if(collection.matches.some(row=>row.malId===malId))return fail();
  return collection;
}
export async function reviewAddon(profileId:number,url:string):Promise<AddonReview>{
  const v=await scoped(profileId,{kind:'review',url});return {reviewId:integer(v.reviewId,1,0xffffffff),manifest:manifest(v.manifest)};
}
export async function mutateAddon(profileId:number,action:Mutation){return sources(await scoped(profileId,action));}
export async function cancelAddonReview(profileId:number,reviewId:number){await scoped(profileId,{kind:'cancel-review',reviewId});}
/** Match the native public-artwork allowlist again before rendering. */
export function publicAddonPoster(value:unknown):string|undefined{
  if(typeof value!=='string'||value.length>512||/[\s\\]/u.test(value))return undefined;
  try{
    const url=new URL(value);
    if(url.protocol!=='https:'||url.port||url.username||url.password||url.search||url.hash)return undefined;
    const path=url.pathname;
    const file='[A-Za-z0-9_-]{1,80}\\.(?:jpg|jpeg|png|webp)';
    const valid=url.hostname==='image.tmdb.org'&&new RegExp('^/t/p/(?:w92|w154|w185|w342|w500|w780|w600_and_h900_bestv2|original)/'+file+'$').test(path)||
      url.hostname==='images.metahub.space'&&/^\/poster\/(?:small|medium|large)\/tt[0-9]{1,12}\/img$/.test(path)||
      url.hostname==='cdn.myanimelist.net'&&new RegExp('^/images/anime/[0-9]{1,12}/'+file+'$').test(path)||
      url.hostname==='media.kitsu.io'&&new RegExp('^/anime/poster_images/[0-9]{1,12}/'+file+'$').test(path);
    return valid?url.href:undefined;
  }catch{return undefined;}
}
export async function loadAddonCatalog(profileId:number,action:CatalogAction):Promise<CatalogPage>{
  const v=await scoped(profileId,action);
  if(v.sourceId!==action.sourceId||v.catalogId!==action.catalogId||v.mediaType!==action.mediaType)return fail();
  const items=array(v.items,500,i=>{
    const row=obj(i);if(row.mediaType!==action.mediaType)return fail();
    const poster=publicAddonPoster(row.poster);
    return {id:str(row.id,512),name:str(row.name,512),mediaType:action.mediaType,...(poster?{poster}:{})};
  });
  if(new Set(items.map(i=>i.id)).size!==items.length)return fail();
  const sourceCount=integer(v.sourceCount,items.length,500);
  const nextSkip=v.nextSkip===null?null:integer(v.nextSkip,1,100000);
  if(nextSkip!==null&&(!sourceCount||nextSkip!==Number(action.extras.skip??0)+sourceCount))return fail();
  return {sourceId:action.sourceId,mediaType:action.mediaType,catalogId:action.catalogId,items,sourceCount,nextSkip};
}

function parseAccountImport(v:unknown):AccountImport{
  const data=obj(v);
  if(data.provider!=='stremio'&&data.provider!=='nuvio')return fail();
  const provider:ImportProvider=data.provider,importId=integer(data.importId,1,0xffffffff);
  const identity={provider,importId};
  const unique=(ids:number[])=>{if(new Set(ids).size!==ids.length)fail();};
  if(data.phase==='profiles'&&provider==='nuvio'){
    const remoteProfiles=array(data.remoteProfiles,6,item=>{
      const p=obj(item);return {profileIndex:integer(p.profileIndex,1,6),name:str(p.name,256),usesPrimaryAddons:bool(p.usesPrimaryAddons),locked:bool(p.locked)};
    });
    unique(remoteProfiles.map(p=>p.profileIndex));
    return {...identity,phase:'profiles',remoteProfiles};
  }
  const candidate=(item:unknown)=>{
    const c=obj(item);return {candidateId:integer(c.candidateId,1,128),name:str(c.name,256),host:str(c.host,253),enabled:bool(c.enabled)};
  };
  if(data.phase==='candidates'){
    const candidates=array(data.candidates,128,item=>({...candidate(item),alreadyInstalled:bool(obj(item).alreadyInstalled)}));
    unique(candidates.map(c=>c.candidateId));
    const skipped=integer(data.skipped,0,128);
    if(skipped+candidates.length>128)return fail();
    const result:ImportCandidates={...identity,phase:'candidates',candidates,availableSlots:integer(data.availableSlots,0,16),skipped};
    if(data.remoteProfile!==undefined||data.effectiveProfile!==undefined){
      if(provider!=='nuvio')return fail();
      result.remoteProfile=integer(data.remoteProfile,1,6);result.effectiveProfile=integer(data.effectiveProfile,1,6);
    }
    return result;
  }
  if(data.phase==='review'){
    const ready=array(data.ready,16,item=>({...candidate(item),manifest:manifest(obj(item).manifest)}));
    const rejected=array(data.rejected,16,item=>{
      const row=obj(item);return {candidateId:integer(row.candidateId,1,128),name:str(row.name,256),reason:typeof row.reason==='string'&&codes.has(row.reason)?row.reason:'request'};
    });
    if(ready.length+rejected.length>16)return fail();
    unique([...ready,...rejected].map(c=>c.candidateId));
    return {...identity,phase:'review',ready,rejected};
  }
  return fail();
}
export async function connectAddonImport(profileId:number,provider:ImportProvider,email:string,password:string):Promise<ImportProfiles|ImportCandidates>{
  const v=parseAccountImport(await scoped(profileId,{kind:'import-connect',provider,email,password}));
  if(v.provider!==provider||v.phase==='review'||(provider==='stremio'&&v.phase!=='candidates')||(provider==='nuvio'&&v.phase!=='profiles'))return fail();
  return v;
}
export async function chooseNuvioImportProfile(profileId:number,importId:number,remoteProfile:number):Promise<ImportCandidates>{
  const v=parseAccountImport(await scoped(profileId,{kind:'import-nuvio-profile',importId,remoteProfile}));
  if(v.provider!=='nuvio'||v.importId!==importId||v.phase!=='candidates'||v.remoteProfile!==remoteProfile)return fail();
  return v;
}
export async function reviewAddonImport(profileId:number,importId:number,provider:ImportProvider,selected:number[]):Promise<ImportReview>{
  const v=parseAccountImport(await scoped(profileId,{kind:'import-review',importId,selected}));
  if(v.provider!==provider||v.importId!==importId||v.phase!=='review')return fail();
  const returned=[...v.ready,...v.rejected].map(c=>c.candidateId);
  if(returned.length!==selected.length||returned.some(id=>!selected.includes(id)))return fail();
  return v;
}
export async function applyAddonImport(profileId:number,importId:number){return sources(await scoped(profileId,{kind:'import-apply',importId}));}
export async function cancelAddonImport(profileId:number,importId:number){await scoped(profileId,{kind:'import-cancel',importId});}

export type AddonVideo={id:string;name:string;season:number|null;episode:number|null};
export type AddonMetadata={id:string;mediaType:string;name:string;description:string|null;videos:AddonVideo[]};
export type AddonOption={name:string;supported:boolean;reason:'direct-https'|'unsupported-transport'|'invalid-media-url'|'proxy-headers';language:string|null};
export async function loadAddonMetadata(profileId:number,sourceId:number,mediaType:string,itemId:string):Promise<AddonMetadata>{
  const v=await scoped(profileId,{kind:'metadata',sourceId,mediaType,itemId});
  if(v.sourceId!==sourceId)return fail();
  const m=obj(v.metadata);
  if(m.id!==itemId||m.mediaType!==mediaType)return fail();
  const videos=array(m.videos,2048,value=>{
    const row=obj(value);return {id:str(row.id,512),name:str(row.name,512),season:row.season===null?null:integer(row.season,0,0xffffffff),episode:row.episode===null?null:integer(row.episode,0,0xffffffff)};
  });
  if(new Set(videos.map(video=>video.id)).size!==videos.length)return fail();
  return {id:itemId,mediaType,name:str(m.name,512),description:m.description===null?null:str(m.description,4096),videos};
}
export type AddonOptions={reviewId:number;rows:AddonOption[]};
export async function loadAddonOptions(profileId:number,sourceId:number,mediaType:string,videoId:string,subtitles:boolean):Promise<AddonOptions>{
  const v=await scoped(profileId,{kind:'item-options',sourceId,mediaType,videoId,subtitles});
  if(v.sourceId!==sourceId||v.mediaType!==mediaType||v.videoId!==videoId||v.subtitles!==subtitles)return fail();
  return {reviewId:integer(v.reviewId,1,0xffffffff),rows:parseOptions(v.options)};
}
function parseOptions(options:unknown):AddonOption[]{
  return array<AddonOption>(options,256,value=>{
    const row=obj(value);
    const reason=row.reason;
    if(reason!=='direct-https'&&reason!=='unsupported-transport'&&reason!=='invalid-media-url'&&reason!=='proxy-headers')return fail();
    const supported=bool(row.supported);
    if(supported!==(reason==='direct-https'))return fail();
    return {name:str(row.name,256),supported,reason,language:row.language===null?null:str(row.language,32)};
  });
}

export type AddonStreamGroup={sourceId:number;options:AddonOptions|null};
export async function loadAllAddonStreams(profileId:number,mediaType:string,videoId:string):Promise<AddonStreamGroup[]>{
  const v=await scoped(profileId,{kind:'all-stream-options',mediaType,videoId});
  if(v.mediaType!==mediaType||v.videoId!==videoId)return fail();
  const groups=array<AddonStreamGroup>(v.groups,16,value=>{
    const row=obj(value),sourceId=integer(row.sourceId,1,0xffffffff);
    const rows=parseOptions(row.options);
    if(row.error!==null){
      if(typeof row.error!=='string'||row.reviewId!==null||rows.length)return fail();
      return {sourceId,options:null};
    }
    return {sourceId,options:{reviewId:integer(row.reviewId,1,0xffffffff),rows}};
  });
  if(new Set(groups.map(g=>g.sourceId)).size!==groups.length||
    new Set(groups.flatMap(g=>g.options?[g.options.reviewId]:[])).size!==groups.filter(g=>g.options).length)return fail();
  return groups;
}

function watchHistory(v:unknown):WatchHistoryEntry[]{
  const rows=array(obj(v).history,100,value=>{
    const row=obj(value),p=obj(row.progress),durationMs=integer(p.durationMs,1,604800000),positionMs=integer(p.positionMs,0,durationMs),completed=bool(p.completed);
    if(completed&&positionMs!==durationMs)return fail();
    return {progress:{mediaType:str(p.mediaType,32),itemId:str(p.itemId,512),videoId:str(p.videoId,512),title:str(p.title,512),episodeTitle:p.episodeTitle===null?null:str(p.episodeTitle,512),positionMs,durationMs,completed},updatedAt:integer(row.updatedAt,1,253402300799999)};
  });
  if(new Set(rows.map(({progress:p})=>JSON.stringify([p.mediaType,p.itemId,p.videoId]))).size!==rows.length)return fail();
  return rows;
}
export async function listWatchHistory(profileId:number){return watchHistory(await scoped(profileId,{kind:'watch-history'}));}
export async function saveWatchProgress(profileId:number,progress:WatchProgress,viewingId?:string){
  if((await scoped(profileId,{kind:'watch-record',progress,viewingId})).saved!==true)return fail();
}
export async function removeWatchHistory(profileId:number,progress:Pick<WatchProgress,'mediaType'|'itemId'|'videoId'>){
  return watchHistory(await scoped(profileId,{kind:'watch-remove',mediaType:progress.mediaType,itemId:progress.itemId,videoId:progress.videoId}));
}

export type WatchPlayback={
  profileId:number;mediaType:string;itemId:string;videoId:string;title:string;episodeTitle:string|null;
  startMs:number;videos:AddonVideo[];streamSources:{sourceId:number;name:string}[];
  subtitleSources:{sourceId:number;name:string}[];
} & ({grantId:number;selection?:never}|{grantId?:never;selection:{reviewId:number;optionIndex:number}});
export async function prepareAddonMedia(profileId:number,reviewId:number,optionIndex:number,subtitles:boolean,startMs=0){
  const v=await scoped(profileId,{kind:'prepare-media',reviewId,optionIndex,startMs});
  if(v.subtitles!==subtitles)return fail();
  return integer(v.grantId,1,0xffffffff);
}
export async function consumeAddonMedia(grantId:number,subtitles:boolean){
  const requestId=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
  const reply=await ask({type:'stremio-consume-grant',request:requestId,grantId},'stremio-result',{timeoutMs:10_000,matches:m=>m.request===requestId});
  if(reply.error!==null)throw new AddonError(codes.has(reply.error)?reply.error:'request');
  const v=obj(reply.data);
  if(v.grantId!==grantId||v.accepted!==true||v.subtitles!==subtitles)return fail();
}

export type MdblistItem={id:string;mediaType:string;name:string;ratings:Record<string,number>};
export async function mdblistStatus(profileId:number){return bool((await scoped(profileId,{kind:'mdblist-status'})).connected);}
export async function mdblistConnect(profileId:number,key:string){return bool((await scoped(profileId,{kind:'mdblist-connect',key})).connected);}
export async function mdblistDisconnect(profileId:number){return bool((await scoped(profileId,{kind:'mdblist-disconnect'})).connected);}
export async function mdblistLists(profileId:number){
  const v=await scoped(profileId,{kind:'mdblist-lists'});
  return array(v.lists,1000,value=>{const row=obj(value);return {id:integer(row.id,1,0xffffffff),name:str(row.name,512),count:integer(row.count,0,0xffffffff)};});
}
export async function mdblistPage(profileId:number,listId:number,offset:number){
  const v=await scoped(profileId,{kind:'mdblist-page',listId,offset});
  const items=array<MdblistItem>(v.items,100,value=>{
    const row=obj(value),mediaType=str(row.mediaType,32),id=str(row.id,512);
    if(!['movie','series'].includes(mediaType)||(!/^tt\d{1,12}$/.test(id)&&!(mediaType==='movie'?/^tmdb:movie:[1-9]\d*$/:/^tmdb:tv:[1-9]\d*$/).test(id)))return fail();
    const ratings=Object.fromEntries(Object.entries(obj(row.ratings)).filter(([k,v])=>['imdb','tmdb','mdblist','trakt','letterboxd','tomatoes','metacritic'].includes(k)&&typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=100)) as Record<string,number>;
    return {id,mediaType,name:str(row.name,512),ratings};
  });
  return {items,nextOffset:v.nextOffset===null?null:integer(v.nextOffset,offset+1,100000)};
}

export type RefractStatus={threshold:number|null;connected:boolean;username:string|null;enabled:boolean;pending:number;sent:number;skipped:number;retryAt:number;lastError:string|null};
const refractErrors=new Set(['refract-auth','refract-scope','refract-rate','refract-network','refract-request','refract-response','refract-rejected','refract-conflict','refract-unmatched','refract-queue-full','refract-clock','refract-protected','unsupported']);
export function refractState(v:unknown):RefractStatus{
  const row=obj(v),connected=bool(row.connected),enabled=bool(row.enabled);
  const username=row.username===null?null:str(row.username,256);
  const pending=integer(row.pending,0,256),sent=integer(row.sent,0,0xffffffff),skipped=integer(row.skipped,0,0xffffffff),retryAt=integer(row.retryAt,0,253402300799999);
  const lastError=row.lastError===null?null:str(row.lastError,64);
  if(connected!==(username!==null)||(!connected&&(enabled||pending||sent||skipped||retryAt||lastError))||(lastError!==null&&!refractErrors.has(lastError)))return fail();
  const threshold=row.threshold==null?null:integer(row.threshold,50,90);
  if(threshold!==null&&![50,70,80,90].includes(threshold))return fail();
  return {threshold,connected,username,enabled,pending,sent,skipped,retryAt,lastError};
}
export async function refractStatus(profileId:number){return refractState(await scoped(profileId,{kind:'refract-status'}));}
export async function refractConnect(profileId:number,key:string){return refractState(await scoped(profileId,{kind:'refract-connect',key}));}
export async function setRefractThreshold(profileId:number,percent:number|null){return refractState(await scoped(profileId,{kind:'refract-threshold',percent}));}
export async function completeWatch(profileId:number,row:WatchHistoryEntry){
  const {mediaType,itemId,videoId}=row.progress;
  return watchHistory(await scoped(profileId,{kind:'watch-complete',mediaType,itemId,videoId,updatedAt:row.updatedAt}));
}
export async function refractEnable(profileId:number,enabled:boolean){return refractState(await scoped(profileId,{kind:'refract-enable',enabled}));}
export async function refractDisconnect(profileId:number,discardPending:boolean){return refractState(await scoped(profileId,{kind:'refract-disconnect',discardPending}));}
export async function refractSync(profileId:number){return refractState(await scoped(profileId,{kind:'refract-sync'}));}
export async function refractWatchlist(profileId:number,mediaType:string,itemId:string,add:boolean):Promise<'updated'|'protected'|'queued'>{
  const row=await scoped(profileId,{kind:'refract-watchlist',mediaType,itemId,add});
  if(row.result==='failed'){
    if(typeof row.error!=='string'||!refractErrors.has(row.error))return fail();
    throw new AddonError(row.error);
  }
  if(row.result!=='updated'&&row.result!=='protected'&&row.result!=='queued')return fail();
  return row.result;
}
