import { appBridge, ask } from './bridge';

export interface AddonExtra { name: string; required: boolean; options: string[]; optionsLimit: number | null }
export interface AddonCatalog { id: string; mediaType: string; name: string; extras: AddonExtra[] }
export interface AddonManifest {
  id: string; name: string; version: string; resources: string[]; catalogs: AddonCatalog[];
  configurable: boolean; configurationRequired: boolean; p2p: boolean; adult: boolean;
}
export interface AddonSource { sourceId: number; enabled: boolean; manifest: AddonManifest }
export interface AddonReview { reviewId: number; manifest: AddonManifest }
export interface CatalogPage {
  sourceId: number; mediaType: string; catalogId: string;
  items: { id: string; name: string; mediaType: string }[]; sourceCount: number; nextSkip: number | null;
}
export type Mutation = { kind: 'install'; reviewId: number } | { kind: 'set-enabled'; sourceId: number; enabled: boolean }
  | { kind: 'move'; sourceId: number; position: number } | { kind: 'remove'; sourceId: number };
export type CatalogAction = { kind: 'catalog'; sourceId: number; mediaType: string; catalogId: string; extras: Record<string,string> };
type Action = Mutation | CatalogAction | { kind: 'list' } | { kind: 'review'; url: string } | { kind: 'cancel-review'; reviewId: number };
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
const codes=new Set(['invalid-endpoint','invalid-manifest','manifest-limit','configuration-required','duplicate','source-limit','expired-review','unknown-source','disabled-source','unsupported-catalog','invalid-extras','required-extra','invalid-position','invalid-resource','invalid-catalog','catalog-limit','response-limit','network','request','auth','rate','busy','unsupported','invalid-response','profile-required','profile-changed','unknown-profile','invalid-profile-name','duplicate-profile','profile-limit','active-profile','profile-confirmation','profile-store','profile-store-limit']);
async function request(action: NativeAction): Promise<unknown> {
  if(!appBridge()?.stremioAddons)throw new AddonError('unsupported');
  const id=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
  const reply=await ask({type:'stremio-request',request:id,action},'stremio-result',{timeoutMs:85_000,matches:m=>m.request===id})
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
export async function reviewAddon(profileId:number,url:string):Promise<AddonReview>{
  const v=await scoped(profileId,{kind:'review',url});return {reviewId:integer(v.reviewId,1,0xffffffff),manifest:manifest(v.manifest)};
}
export async function mutateAddon(profileId:number,action:Mutation){return sources(await scoped(profileId,action));}
export async function cancelAddonReview(profileId:number,reviewId:number){await scoped(profileId,{kind:'cancel-review',reviewId});}
export async function loadAddonCatalog(profileId:number,action:CatalogAction):Promise<CatalogPage>{
  const v=await scoped(profileId,action);
  if(v.sourceId!==action.sourceId||v.catalogId!==action.catalogId||v.mediaType!==action.mediaType)return fail();
  const items=array(v.items,500,i=>{
    const row=obj(i);if(row.mediaType!==action.mediaType)return fail();
    return {id:str(row.id,512),name:str(row.name,512),mediaType:action.mediaType};
  });
  if(new Set(items.map(i=>i.id)).size!==items.length)return fail();
  const sourceCount=integer(v.sourceCount,items.length,500);
  const nextSkip=v.nextSkip===null?null:integer(v.nextSkip,1,100000);
  if(nextSkip!==null&&(!sourceCount||nextSkip!==Number(action.extras.skip??0)+sourceCount))return fail();
  return {sourceId:action.sourceId,mediaType:action.mediaType,catalogId:action.catalogId,items,sourceCount,nextSkip};
}
