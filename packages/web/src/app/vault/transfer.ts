export const MAX_VAULT_BYTES = 256 * 1024 * 1024;
const formats: Record<string,string[]> = {
  pdf:['application/pdf'],epub:['application/epub+zip'],mp3:['audio/mpeg','audio/mp3'],flac:['audio/flac','audio/x-flac'],m4a:['audio/mp4','audio/x-m4a'],wav:['audio/wav','audio/x-wav','audio/wave'],ogg:['audio/ogg','application/ogg'],opus:['audio/ogg','audio/opus'],aac:['audio/aac']
};
export function vaultTarget(input:string) {
  const url = new URL(input.trim());
  if(url.protocol!=='https:'||url.username||url.password)throw new Error('Use a direct HTTPS file URL.');
  const name = decodeURIComponent(url.pathname.split('/').pop()||'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'');
  const extension = name.split('.').pop()?.toLowerCase()||'';
  if(!name.includes('.')||!Object.hasOwn(formats,extension)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))throw new Error('Choose a PDF, EPUB or supported audio file.');
  return {url:url.href,name,extension};
}
export function vaultResponseAllowed(extension:string,contentType:string) {
  const mime=contentType.split(';')[0].trim().toLowerCase();
  return mime==='application/octet-stream'||(formats[extension]||[]).includes(mime);
}
export type VaultWriter={write:(data:Uint8Array)=>Promise<void>;close:()=>Promise<void>;abort:()=>Promise<void>};
export type VaultPicker= (options:{suggestedName:string})=>Promise<{createWritable:()=>Promise<VaultWriter>}>;
export function vaultPicker():VaultPicker|undefined {
  const picker=(window as Window&{showSaveFilePicker?:VaultPicker}).showSaveFilePicker;
  return picker?.bind(window);
}
export async function saveVaultFile(target:ReturnType<typeof vaultTarget>,picker:VaultPicker,signal:AbortSignal,onProgress:(bytes:number,total:number|null)=>void) {
  const handle=await picker({suggestedName:target.name});
  const response=await fetch(target.url,{signal,credentials:'omit',referrerPolicy:'no-referrer',redirect:'error'});
  if(!response.ok||!response.body)throw new Error('File could not be retrieved.');
  if(!vaultResponseAllowed(target.extension,response.headers.get('content-type')||''))throw new Error('The URL did not return a supported file type.');
  const length=Number(response.headers.get('content-length')||0);
  const total=Number.isFinite(length)&&length>0?length:null;
  if(total&&total>MAX_VAULT_BYTES)throw new Error('File exceeds the 256 MiB limit.');
  const writer=await handle.createWritable();
  const reader=response.body.getReader();
  let bytes=0;
  try {
    for(;;){signal.throwIfAborted();const result=await reader.read();if(result.done)break;
      bytes+=result.value.byteLength;
      if(bytes>MAX_VAULT_BYTES)throw new Error('File exceeds the 256 MiB limit.');
      await writer.write(result.value);onProgress(bytes,total);
    }
    signal.throwIfAborted();
    if(!bytes||total!==null&&bytes!==total)throw new Error('File transfer was incomplete.');
    await writer.close();return bytes;
  }catch(error){await reader.cancel().catch(()=>{});await writer.abort().catch(()=>{});throw error;}
  finally{reader.releaseLock();}
}
