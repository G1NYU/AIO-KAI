/** Opt-in local copies of completed Vault audio. Original downloads are never
 * moved or removed. One file per content digest, with bounded job aliases. */
export const MAX_VAULT_AUDIO_BYTES = 128 * 1024 * 1024;
export const MAX_VAULT_AUDIO_LIBRARY_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_FILES = 250, MAX_ALIASES = 64;
export const VAULT_AUDIO_CHANGED = 'tsugi-vault-audio-changed';
export type VaultAudioEntry = {
  id: string; name: string; title: string; size: number; duration: number; addedAt: number; jobs: string[];
};
export type PreparedVaultAudio = { file: File; id: string; duration: number };
const idValid = (id: unknown): id is string => typeof id === 'string' && id.length === 76 && /^vault-audio:[a-f0-9]{64}$/.test(id);
export const vaultAudioJobId = (id: unknown): id is string => typeof id === 'string' && !/[\r\n]/.test(id) && /^vault-[A-Za-z0-9_-]{1,58}$/.test(id);
export function vaultAudioType(name: unknown): string | undefined {
  if (typeof name !== 'string' || !name.trim() || name.length > 240 || /[\\/\u0000-\u001f]/.test(name)) return undefined;
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase();
  switch (ext) {
    case 'mp3': return 'audio/mpeg';
    case 'm4a': return 'audio/mp4';
    case 'wav': return 'audio/wav';
    case 'flac': return 'audio/flac';
    case 'ogg': case 'opus': return 'audio/ogg';
    case 'aac': return 'audio/aac';
    default: return undefined;
  }
}
const validDuration = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 86400;
const validSize = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= MAX_VAULT_AUDIO_BYTES;
function validEntry(value: unknown): value is VaultAudioEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Partial<VaultAudioEntry>;
  return idValid(row.id) && !!vaultAudioType(row.name) && typeof row.title === 'string' &&
    row.title.length > 0 && row.title.length <= 240 && validSize(row.size) && validDuration(row.duration) &&
    typeof row.addedAt === 'number' && Number.isSafeInteger(row.addedAt) && row.addedAt > 0 &&
    Array.isArray(row.jobs) && row.jobs.length > 0 && row.jobs.length <= MAX_ALIASES &&
    row.jobs.every(vaultAudioJobId) && new Set(row.jobs).size === row.jobs.length;
}
export function vaultAudioImportPlan(rows: VaultAudioEntry[], job: string, prepared: {id:string;size:number}): {kind:'new'|'duplicate'|'existing'; entry?:VaultAudioEntry} {
  if (!Array.isArray(rows) || rows.length > MAX_FILES || !rows.every(validEntry) || !vaultAudioJobId(job) ||
      !idValid(prepared.id) || !validSize(prepared.size)) throw new Error('invalid-vault-audio-record');
  const aliases = rows.flatMap(row => row.jobs);
  if (new Set(rows.map(row=>row.id)).size !== rows.length || new Set(aliases).size !== aliases.length)
    throw new Error('invalid-vault-audio-index');
  const existing = rows.find(row => row.jobs.includes(job));
  if (existing) {
    if (existing.id !== prepared.id || existing.size !== prepared.size) throw new Error('vault-job-content-changed');
    return {kind:'existing',entry:existing};
  }
  const duplicate = rows.find(row=>row.id===prepared.id);
  if (duplicate) {
    if (duplicate.size !== prepared.size || duplicate.jobs.length >= MAX_ALIASES) throw new Error('vault-audio-alias-limit');
    return {kind:'duplicate',entry:duplicate};
  }
  if (rows.length >= MAX_FILES || rows.reduce((sum,row)=>sum+row.size,0)+prepared.size > MAX_VAULT_AUDIO_LIBRARY_BYTES)
    throw new Error('vault-audio-library-limit');
  return {kind:'new'};
}

function metadataDuration(file: File, signal: AbortSignal): Promise<number> {
  return new Promise((resolve,reject)=>{
    signal.throwIfAborted();
    const audio = document.createElement('audio');
    const url = URL.createObjectURL(file);
    let settled = false;
    const timer = window.setTimeout(()=>finish(undefined),15000);
    function finish(value?: number) {
      if (settled) return;
      settled=true;
      window.clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      audio.onloadedmetadata=null; audio.onerror=null;
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
      if (signal.aborted) reject(signal.reason ?? new DOMException('', 'AbortError'));
      else if (validDuration(value)) resolve(value);
      else reject(new Error('unsupported-vault-audio'));
    }
    const abort = ()=>finish();
    signal.addEventListener('abort',abort,{once:true});
    audio.preload='metadata';
    audio.onloadedmetadata=()=>finish(audio.duration);
    audio.onerror=()=>finish();
    audio.src=url;
  });
}
export async function prepareVaultAudio(file: File, signal: AbortSignal): Promise<PreparedVaultAudio> {
  const mime=vaultAudioType(file.name);
  if (!mime || !validSize(file.size)) throw new Error('invalid-vault-audio-file');
  signal.throwIfAborted();
  const normalized=new File([file],file.name,{type:mime});
  const duration=await metadataDuration(normalized,signal);
  signal.throwIfAborted();
  const digest=await crypto.subtle.digest('SHA-256',await normalized.arrayBuffer());
  signal.throwIfAborted();
  const id='vault-audio:'+Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
  return {file:normalized,id,duration};
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('tsugi-vault-audio-v1',1);
    let settled=false;
    request.onupgradeneeded=()=>{
      request.result.createObjectStore('tracks',{keyPath:'id'});
      request.result.createObjectStore('files');
    };
    request.onsuccess=()=>{
      const db=request.result;
      if(settled){db.close();return;}
      settled=true;db.onversionchange=()=>db.close();resolve(db);
    };
    request.onerror=()=>{settled=true;reject(request.error);};
    request.onblocked=()=>{settled=true;reject(new Error('vault-audio-storage-blocked'));};
  });
}
function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
}
export async function listVaultAudio(): Promise<VaultAudioEntry[]> {
  const db=await database();
  try {
    const rows:unknown=await result(db.transaction('tracks').objectStore('tracks').getAll());
    if(!Array.isArray(rows)||rows.length>MAX_FILES||!rows.every(validEntry))throw new Error('invalid-vault-audio-index');
    return rows.sort((a,b)=>b.addedAt-a.addedAt);
  } finally {db.close();}
}
export async function getVaultAudioFile(entry:VaultAudioEntry):Promise<File>{
  if(!validEntry(entry))throw new Error('invalid-vault-audio-record');
  const db=await database();
  try{
    const blob:unknown=await result(db.transaction('files').objectStore('files').get(entry.id));
    if(!(blob instanceof Blob)||blob.size!==entry.size)throw new Error('vault-audio-copy-missing');
    return new File([blob],entry.name,{type:vaultAudioType(entry.name)});
  }finally{db.close();}
}
export async function commitVaultAudio(job:string,prepared:PreparedVaultAudio,signal:AbortSignal,expected:'new'|'duplicate'):Promise<{entry:VaultAudioEntry;kind:'new'|'duplicate'|'existing'}>{
  if(!idValid(prepared.id)||!validDuration(prepared.duration)||!vaultAudioType(prepared.file.name)||!validSize(prepared.file.size))
    throw new Error('invalid-vault-audio-file');
  signal.throwIfAborted();
  const db=await database();
  try{
    signal.throwIfAborted();
    const committed=await new Promise<{entry:VaultAudioEntry;kind:'new'|'duplicate'|'existing'}>((resolve,reject)=>{
      const tx=db.transaction(['tracks','files'],'readwrite'), tracks=tx.objectStore('tracks'), files=tx.objectStore('files');
      let outcome:{entry:VaultAudioEntry;kind:'new'|'duplicate'|'existing'}|undefined;
      let failure:unknown;
      const abort=()=>{failure=signal.reason;try{tx.abort();}catch{/* transaction already completed */}};
      signal.addEventListener('abort',abort,{once:true});
      tx.oncomplete=()=>{signal.removeEventListener('abort',abort);if(outcome)resolve(outcome);else reject(new Error('vault-audio-write-failed'));};
      tx.onabort=()=>{signal.removeEventListener('abort',abort);reject(failure??tx.error??new Error('vault-audio-write-failed'));};
      const lookup=tracks.getAll();
      lookup.onsuccess=()=>{
        try{
          signal.throwIfAborted();
          const plan=vaultAudioImportPlan(lookup.result,job,{id:prepared.id,size:prepared.file.size});
          if(plan.kind!=='existing'&&plan.kind!==expected)throw new Error('vault-audio-review-changed');
          if(plan.kind==='new'){
            const entry:VaultAudioEntry={id:prepared.id,name:prepared.file.name,title:prepared.file.name.replace(/\.[^.]+$/,'')||prepared.file.name,
              duration:prepared.duration,size:prepared.file.size,addedAt:Date.now(),jobs:[job]};
            tracks.add(entry);files.add(prepared.file,entry.id);
            outcome={entry,kind:'new'};
          }else{
            const existing=plan.entry!;
            const file=files.get(existing.id);
            file.onsuccess=()=>{
              try{
                signal.throwIfAborted();
                if(!(file.result instanceof Blob)||file.result.size!==existing.size)throw new Error('vault-audio-copy-missing');
                const entry=plan.kind==='duplicate'?{...existing,jobs:[...existing.jobs,job]}:existing;
                if(plan.kind==='duplicate')tracks.put(entry);
                outcome={entry,kind:plan.kind==='duplicate'?'duplicate':'existing'};
              }catch(error){failure=error;tx.abort();}
            };
          }
        }catch(error){failure=error;tx.abort();}
      };
    });
    window.dispatchEvent(new Event(VAULT_AUDIO_CHANGED));
    return committed;
  }finally{db.close();}
}
export async function removeVaultAudio(id:string):Promise<void>{
  if(!idValid(id))throw new Error('invalid-vault-audio-record');
  const db=await database();
  try{
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction(['tracks','files'],'readwrite');
      tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error??new Error('vault-audio-remove-failed'));
      tx.objectStore('tracks').delete(id);tx.objectStore('files').delete(id);
    });
    window.dispatchEvent(new Event(VAULT_AUDIO_CHANGED));
  }finally{db.close();}
}
