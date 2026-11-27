/* eslint-disable lingui/no-unlocalized-strings -- Provider-reported technical tags, not UI prose. */
export const addonAudioTags=['Atmos','TrueHD','DTS:X','DTS-HD','DTS','E-AC-3','AC-3','AAC','FLAC','Opus','MP3'] as const;
export type AddonAudioTag=(typeof addonAudioTags)[number];
export type AddonSizeBucket='under-1'|'1-to-5'|'5-to-15'|'15-plus';
export type AddonCacheStatus='cached'|'uncached';

const byteUnits:Record<string,number>={KB:1e3,MB:1e6,GB:1e9,TB:1e12,KiB:1024,MiB:1024**2,GiB:1024**3,TiB:1024**4};

/** Only use explicit provider labels. No URL, transport or resolution implies
 * a byte size, audio codec, cache hit or successful playback. */
export function reportedAddonStreamTags(row:{name:string;detail?:string}){
  const label=row.name+' '+(row.detail??'');
  const audio:AddonAudioTag[]=[];
  if(/\batmos\b/i.test(label))audio.push('Atmos');
  if(/\btrue[ ._-]?hd\b/i.test(label))audio.push('TrueHD');
  if(/\bdts[ :._-]?x\b/i.test(label))audio.push('DTS:X');
  if(/\bdts[ ._-]?hd\b/i.test(label))audio.push('DTS-HD');
  if(/\bdts\b(?![ :._-]?(?:x|hd)\b)/i.test(label))audio.push('DTS');
  if(/\b(?:e[ ._-]?ac[ ._-]?3|ddp)\b|\bdd\+/i.test(label))audio.push('E-AC-3');
  if(/\bac[ ._-]?3\b/i.test(label.replace(/\be[ ._-]?ac[ ._-]?3\b/gi,'')))audio.push('AC-3');
  if(/\baac\b/i.test(label))audio.push('AAC');
  if(/\bflac\b/i.test(label))audio.push('FLAC');
  if(/\bopus\b/i.test(label))audio.push('Opus');
  if(/\bmp3\b/i.test(label))audio.push('MP3');

  // Require byte units (uppercase B), not bitrates or ambiguous decimal commas.
  const sizes=new Set<number>();
  for(const match of label.matchAll(/(?<![\w.,])(\d{1,8}(?:\.\d{1,3})?)\s*(KiB|MiB|GiB|TiB|KB|MB|GB|TB)\b(?!\s*(?:\/\s*(?:s|sec|second|min|minute|h|hr|hour)\b|ps\b))/g)){
    const bytes=Math.round(Number(match[1])*byteUnits[match[2]]);
    if(Number.isSafeInteger(bytes)&&bytes>0)sizes.add(bytes);
  }
  const sizeBytes=sizes.size===1?[...sizes][0]:undefined;
  const size:AddonSizeBucket|undefined=sizeBytes===undefined?undefined:sizeBytes<1e9?'under-1':sizeBytes<5e9?'1-to-5':sizeBytes<15e9?'5-to-15':'15-plus';
  const negative=/\b(?:uncached|not[ -]+cached|not[ -]+in[ -]+cache)\b/gi;
  const uncached=Array.from(label.matchAll(negative)).length>0;
  const cached=/\bcached\b/i.test(label.replace(negative,''));
  const cache:AddonCacheStatus|undefined=cached===uncached?undefined:cached?'cached':'uncached';
  return {audio,sizeBytes,size,cache};
}
