// Local MyAnimeList export snapshots. A MAL ID is never a Reader chapter
// ID or a Stremio video ID; resolution is always a separate reviewed action.
export type MalKind = 'manga' | 'anime';
export type MalStatus = 'active' | 'completed' | 'on-hold' | 'dropped' | 'planned';
export type MalEntry = {
  malId: number; title: string; status: MalStatus; progress: number; total: number;
  score: number; format: string; volumesRead: number; volumesTotal: number;
};
export const MAX_MAL_ENTRIES = 3000;
export const MAX_MAL_STORE_BYTES = 2 * 1024 * 1024;
const MAX_XML_BYTES = 8 * 1024 * 1024;
const statuses = new Set<MalStatus>(['active','completed','on-hold','dropped','planned']);

function invalid(): never { throw Error('mal-invalid'); }
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}
function label(value: unknown, max: number, allowEmpty = false): value is string {
  return typeof value === 'string' && (allowEmpty || !!value) && value === value.trim() &&
    value.length <= max && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}
function validEntry(value: unknown, kind: MalKind): value is MalEntry {
  if (!record(value) || Object.keys(value).length !== 9 ||
      !['malId','title','status','progress','total','score','format','volumesRead','volumesTotal'].every(k=>Object.prototype.hasOwnProperty.call(value,k))) return false;
  return integer(value.malId,1,2147483647) && label(value.title,512) &&
    typeof value.status === 'string' && statuses.has(value.status as MalStatus) &&
    integer(value.progress,0,10000000) && integer(value.total,0,10000000) &&
    integer(value.score,0,10) && label(value.format,32,kind === 'manga') &&
    integer(value.volumesRead,0,10000000) && integer(value.volumesTotal,0,10000000) &&
    (kind === 'manga' || (value.volumesRead === 0 && value.volumesTotal === 0));
}
export function validateMalEntries(value: unknown, kind: MalKind): MalEntry[] {
  if (!Array.isArray(value) || value.length > MAX_MAL_ENTRIES) return invalid();
  const ids = new Set<number>(), result: MalEntry[] = [];
  for (const row of value) {
    if (!validEntry(row,kind) || ids.has(row.malId)) return invalid();
    ids.add(row.malId);result.push(row);
  }
  if (new TextEncoder().encode(JSON.stringify(result)).length > MAX_MAL_STORE_BYTES) return invalid();
  return result;
}
function field(row: Element, name: string, optional = false): string {
  const fields = Array.from(row.children).filter(child => child.tagName === name);
  if (!fields.length && optional) return '';
  if (fields.length !== 1 || fields[0].namespaceURI || fields[0].children.length) return invalid();
  return (fields[0].textContent ?? '').trim();
}
function numberField(row: Element, name: string, min: number, max: number, optional = false): number {
  const value = field(row,name,optional);
  if (optional && !value) return 0;
  if (!/^[0-9]{1,10}$/.test(value)) return invalid();
  const n = Number(value);
  return integer(n,min,max) ? n : invalid();
}
function status(value: string, kind: MalKind): MalStatus {
  switch (value.toLowerCase()) {
    case 'reading': if (kind === 'manga') return 'active'; break;
    case 'watching': if (kind === 'anime') return 'active'; break;
    case 'completed': return 'completed';
    case 'on-hold': case 'on hold': return 'on-hold';
    case 'dropped': return 'dropped';
    case 'plan to read': if (kind === 'manga') return 'planned'; break;
    case 'plan to watch': if (kind === 'anime') return 'planned'; break;
  }
  return invalid();
}
export function parseMalXml(xml: string, kind: MalKind): MalEntry[] {
  // Reject entity declarations before invoking the browser XML parser. No
  // external references, account metadata, comments, notes or URLs are needed.
  if (xml.length > MAX_XML_BYTES || new TextEncoder().encode(xml).length > MAX_XML_BYTES ||
      /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) return invalid();
  const doc = new DOMParser().parseFromString(xml,'application/xml');
  const root = doc.documentElement;
  if (doc.querySelector('parsererror') || root?.tagName !== 'myanimelist' || root.namespaceURI) return invalid();
  const children = Array.from(root.children);
  if (children.some(child => child.namespaceURI || !['myinfo',kind].includes(child.tagName))) return invalid();
  const rows = children.filter(child => child.tagName === kind);
  if (!rows.length || rows.length > MAX_MAL_ENTRIES) return invalid();
  const entries = new Map<number,MalEntry>();
  const manga = kind === 'manga';
  for (const row of rows) {
    const entry: MalEntry = {
      malId: numberField(row,manga?'manga_mangadb_id':'series_animedb_id',1,2147483647),
      title: field(row,manga?'manga_title':'series_title').replace(/\s+/g,' '),
      status: status(field(row,'my_status'),kind),
      progress: numberField(row,manga?'my_read_chapters':'my_watched_episodes',0,10000000),
      total: numberField(row,manga?'manga_chapters':'series_episodes',0,10000000,true),
      score: numberField(row,'my_score',0,10,true),
      format: field(row,manga?'manga_type':'series_type',manga),
      volumesRead: manga?numberField(row,'my_read_volumes',0,10000000,true):0,
      volumesTotal: manga?numberField(row,'manga_volumes',0,10000000,true):0,
    };
    if (!validEntry(entry,kind)) return invalid();
    const prior=entries.get(entry.malId);
    if (prior && JSON.stringify(prior)!==JSON.stringify(entry)) return invalid();
    entries.set(entry.malId,entry);
  }
  return validateMalEntries([...entries.values()],kind);
}
export async function readMalFile(file: File, kind: MalKind): Promise<MalEntry[]> {
  if (!/\.xml(?:\.gz)?$/i.test(file.name) || !file.size || file.size > MAX_XML_BYTES) return invalid();
  const bytes=new Uint8Array(await file.arrayBuffer());
  let expanded=bytes;
  if (bytes[0]===0x1f && bytes[1]===0x8b) {
    if (typeof DecompressionStream==='undefined') return invalid();
    const reader=new Blob([Uint8Array.from(bytes)]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const chunks: Uint8Array[]=[];
    let total=0;
    try {
      for (;;) {
        const next=await reader.read();
        if (next.done) break;
        total+=next.value.length;
        if (total>MAX_XML_BYTES) return invalid();
        chunks.push(next.value);
      }
    } finally {
      await reader.cancel().catch(()=>{});
      reader.releaseLock();
    }
    expanded=new Uint8Array(total);
    let offset=0;
    for (const chunk of chunks) {expanded.set(chunk,offset);offset+=chunk.length;}
  } else if (/\.gz$/i.test(file.name)) return invalid();
  return parseMalXml(new TextDecoder('utf-8',{fatal:true}).decode(expanded),kind);
}
export function mergeMalEntries(current: MalEntry[], incoming: MalEntry[], kind: MalKind) {
  const entries=new Map(validateMalEntries(current,kind).map(entry=>[entry.malId,entry]));
  for (const entry of validateMalEntries(incoming,kind)) if (!entries.has(entry.malId)) entries.set(entry.malId,entry);
  return validateMalEntries([...entries.values()],kind);
}
