import { appBridge,ask } from './bridge';

export type TsugiRelease={
  latestTag:string;latestCommit:string;currentCommit:string|null;
  status:'same-build'|'different-build'|'unknown-build';packageBytes:number;sha256:string;notes:string;
};
const TAG=/^v(?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8})$/;
const SHA=/^[a-f\d]{40}$/;
const DIGEST=/^[a-f\d]{64}$/;
export function parseTsugiRelease(value:unknown):TsugiRelease{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('release-response');
  const row=value as Record<string,unknown>;
  const fields=['latestTag','latestCommit','currentCommit','status','packageBytes','sha256','notes'];
  if(Object.keys(row).length!==fields.length||fields.some(key=>!Object.prototype.hasOwnProperty.call(row,key)))throw Error('release-response');
  if(typeof row.latestTag!=='string'||!TAG.test(row.latestTag)||
    typeof row.latestCommit!=='string'||!SHA.test(row.latestCommit)||
    !(row.currentCommit===null||(typeof row.currentCommit==='string'&&SHA.test(row.currentCommit)))||
    row.status!==(row.currentCommit===null?'unknown-build':row.currentCommit===row.latestCommit?'same-build':'different-build')||
    typeof row.packageBytes!=='number'||!Number.isSafeInteger(row.packageBytes)||row.packageBytes<1||row.packageBytes>2*1024*1024*1024||
    typeof row.sha256!=='string'||!DIGEST.test(row.sha256)||typeof row.notes!=='string'||[...row.notes].length>12000)throw Error('release-response');
  return {latestTag:row.latestTag,latestCommit:row.latestCommit,currentCommit:row.currentCommit,status:row.status,packageBytes:row.packageBytes,sha256:row.sha256,notes:row.notes} as TsugiRelease;
}
export function supportsTsugiReleaseCheck(){return appBridge()?.platform==='windows'&&appBridge()?.tsugiReleaseCheck===true;}
let seq=0;
export async function checkTsugiRelease():Promise<TsugiRelease>{
  if(!supportsTsugiReleaseCheck())throw Error('unsupported');
  const request='tsugi-release-'+Date.now()+'-'+(++seq);
  const reply=await ask({type:'tsugi-release-check',request},'tsugi-release-result',{timeoutMs:60000,matches:message=>message.request===request});
  if(reply.error||!reply.data)throw Error('release-unavailable');
  return parseTsugiRelease(reply.data);
}
export function tsugiReleasePage(release:TsugiRelease){
  if(!TAG.test(release.latestTag))throw Error('release-tag');
  return 'https://github.com/G1NYU/TSUGI/releases/tag/'+release.latestTag;
}
