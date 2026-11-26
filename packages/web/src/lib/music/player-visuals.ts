import { storage } from '../storage';

export type MascotMode = 'off' | 'builtin' | 'custom';
export type PlayerVisuals = { seekMotion: boolean; mascot: MascotMode };
export const PLAYER_VISUALS_KEY = 'tsugi-player-visuals-v1';
export function parsePlayerVisuals(value: unknown): PlayerVisuals {
  const item = value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<PlayerVisuals> : {};
  return { seekMotion: item.seekMotion !== false,
    mascot: item.mascot === 'builtin' || item.mascot === 'custom' ? item.mascot : 'off' };
}
export function readPlayerVisuals(): PlayerVisuals { return parsePlayerVisuals(storage.get(PLAYER_VISUALS_KEY)); }
export function savePlayerVisuals(value: PlayerVisuals): boolean {
  storage.set(PLAYER_VISUALS_KEY, parsePlayerVisuals(value));
  const saved = readPlayerVisuals();
  return saved.seekMotion === value.seekMotion && saved.mascot === value.mascot;
}

export const MAX_MASCOT_BYTES = 4 * 1024 * 1024;
export const MAX_MASCOT_EDGE = 1024;
const POSTER_EDGE = 256;
export type MascotImageInfo = { type: 'image/png' | 'image/webp' | 'image/gif'; width: number; height: number };
export type MascotRecord = { image: Blob; poster: Blob };
const ascii = (bytes: Uint8Array, at: number, value: string) =>
  at >= 0 && at + value.length <= bytes.length && [...value].every((char, i) => bytes[at+i] === char.charCodeAt(0));
/** Inspect bounded raster dimensions before invoking a browser decoder. The
 * decoder still has to validate the full image; extensions/MIME are not trust. */
export function mascotImageInfo(bytes: Uint8Array): MascotImageInfo | null {
  if (bytes.length < 10 || bytes.length > MAX_MASCOT_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let result: MascotImageInfo | null = null;
  if (bytes.length >= 33 && bytes[0] === 137 && ascii(bytes,1,'PNG') &&
      bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10 &&
      view.getUint32(8) === 13 && ascii(bytes,12,'IHDR')) {
    result = { type:'image/png', width:view.getUint32(16), height:view.getUint32(20) };
  // eslint-disable-next-line lingui/no-unlocalized-strings -- binary GIF signatures, not display text
  } else if (ascii(bytes,0,'GIF87a') || ascii(bytes,0,'GIF89a')) {
    result = { type:'image/gif', width:view.getUint16(6,true), height:view.getUint16(8,true) };
  } else if (bytes.length >= 25 && ascii(bytes,0,'RIFF') && ascii(bytes,8,'WEBP') &&
      view.getUint32(4,true) + 8 === bytes.length) {
    const chunk = view.getUint32(16,true);
    if (chunk + 20 > bytes.length) return null;
    if (ascii(bytes,12,'VP8X') && chunk === 10) {
      const size24 = (at: number) => 1 + bytes[at] + 256*bytes[at+1] + 65536*bytes[at+2];
      result = { type:'image/webp', width:size24(24), height:size24(27) };
    } else if (ascii(bytes,12,'VP8L') && chunk >= 5 && bytes[20] === 0x2f) {
      const bits = view.getUint32(21,true);
      result = { type:'image/webp', width:(bits & 0x3fff)+1, height:((bits >>> 14) & 0x3fff)+1 };
    } else if (ascii(bytes,12,'VP8 ') && chunk >= 10 && bytes[23] === 0x9d &&
        bytes[24] === 1 && bytes[25] === 0x2a) {
      result = { type:'image/webp', width:view.getUint16(26,true) & 0x3fff, height:view.getUint16(28,true) & 0x3fff };
    }
  }
  return result && result.width > 0 && result.height > 0 &&
    result.width <= MAX_MASCOT_EDGE && result.height <= MAX_MASCOT_EDGE ? result : null;
}

async function imageInfo(blob: Blob): Promise<MascotImageInfo> {
  if (!(blob instanceof Blob) || blob.size < 10 || blob.size > MAX_MASCOT_BYTES) throw new Error('invalid mascot size');
  const info = mascotImageInfo(new Uint8Array(await blob.arrayBuffer()));
  if (!info) throw new Error('invalid mascot image');
  return info;
}
export async function prepareMascot(file: Blob): Promise<MascotRecord> {
  const info = await imageInfo(file);
  const image = new Blob([file], {type:info.type});
  const bitmap = await createImageBitmap(image);
  try {
    if (bitmap.width !== info.width || bitmap.height !== info.height) throw new Error('invalid decoded dimensions');
    const scale = Math.min(1, POSTER_EDGE/bitmap.width, POSTER_EDGE/bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1,Math.round(bitmap.width*scale));
    canvas.height = Math.max(1,Math.round(bitmap.height*scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('image rendering unavailable');
    context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const poster = await new Promise<Blob>((resolve,reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('poster unavailable')), 'image/png'));
    await imageInfo(poster);
    return {image, poster};
  } finally { bitmap.close(); }
}

const DB = 'tsugi-player-mascot-v1';
function openMascot(): Promise<IDBDatabase> {
  return new Promise((resolve,reject) => {
    const request = indexedDB.open(DB,1);
    request.onupgradeneeded = () => request.result.createObjectStore('assets');
    request.onerror = () => reject(request.error);
    let blocked = false;
    request.onblocked = () => { blocked = true; reject(new Error('mascot database blocked')); };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) { db.close(); return; }
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}
export async function readMascot(): Promise<MascotRecord | null> {
  const db = await openMascot();
  try {
    const record = await new Promise<unknown>((resolve,reject) => {
      const tx = db.transaction('assets','readonly');
      const req = tx.objectStore('assets').get('custom');
      tx.oncomplete = () => resolve(req.result);
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
    if (record == null) return null;
    const {image,poster} = record as Partial<MascotRecord>;
    if (!(image instanceof Blob) || !(poster instanceof Blob)) throw new Error('invalid mascot record');
    const [a,b] = await Promise.all([imageInfo(image),imageInfo(poster)]);
    if (image.type !== a.type || poster.type !== 'image/png' || b.type !== 'image/png' || b.width > POSTER_EDGE || b.height > POSTER_EDGE)
      throw new Error('invalid mascot record');
    return {image,poster};
  } finally { db.close(); }
}
export async function writeMascot(value: MascotRecord | null): Promise<void> {
  if (value) {
    const [a,b] = await Promise.all([imageInfo(value.image),imageInfo(value.poster)]);
    if (a.type !== value.image.type || value.poster.type !== 'image/png' || b.type !== 'image/png' || b.width > POSTER_EDGE || b.height > POSTER_EDGE)
      throw new Error('invalid mascot record');
  }
  const db = await openMascot();
  try {
    await new Promise<void>((resolve,reject) => {
      const tx = db.transaction('assets','readwrite');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
      const store = tx.objectStore('assets');
      if (value) store.put(value,'custom');
      else store.delete('custom');
    });
  } finally { db.close(); }
}

export type NativeMotionSample = {level:number;at:number};
export function nativeMotionLevel(sample: NativeMotionSample | null | undefined, now: number): number {
  if (!sample || !Number.isFinite(sample.level) || !Number.isFinite(sample.at) ||
      !Number.isFinite(now) || now < sample.at || now-sample.at >= 650) return 0;
  return Math.min(1,Math.max(0,sample.level));
}
export function pcmMotionLevel(samples: Uint8Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (const sample of samples) sum += ((sample-128)/128)**2;
  return Math.min(1,Math.sqrt(sum/samples.length));
}
