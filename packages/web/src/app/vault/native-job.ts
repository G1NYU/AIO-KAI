import type { HostJob } from '@/lib/downloads/types';
import { vaultTarget } from './transfer';

export function vaultJob(input: string, id: string): HostJob {
  const target = vaultTarget(input);
  const url = new URL(target.url);
  if (url.search || url.hash || !/^vault-[a-zA-Z0-9_-]{1,58}$/.test(id) || target.name.length > 200)
    throw new Error('Vault queue requires a public direct link without query parameters or fragments.');
  // eslint-disable-next-line lingui/no-unlocalized-strings -- native on-disk path and wire-format identifiers, not displayed copy
  return { id, title: target.name, versionId: id, files: [{url: target.url, path: ['Vault', id, target.name].join('/'), kind: 'vault'}], texts: [] };
}

/** Normalize user-selected YouTube links to a single track, not a playlist. */
export function youtubeVaultTrack(input: string): string {
  const url = new URL(input.trim());
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash)
    throw new Error('Invalid YouTube Music link.');
  const id = url.hostname === 'youtu.be' ? url.pathname.slice(1) :
    ['www.youtube.com', 'youtube.com', 'music.youtube.com'].includes(url.hostname) && url.pathname === '/watch'
      ? url.searchParams.get('v') || '' : '';
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) throw new Error('Choose a single YouTube Music track.');
  return id;
}
export function youtubeVaultJob(input: string, id: string, title = ''): HostJob {
  const track = youtubeVaultTrack(input);
  if (!/^vault-[a-zA-Z0-9_-]{1,58}$/.test(id)) throw new Error('Invalid Vault job.');
  const cleaned=title.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').trim();
  const label=Array.from(cleaned).slice(0,90).join('');
  const safeLabel=new TextEncoder().encode(label).length<=150?label:'';
  const stem=safeLabel?[safeLabel,track].join(' - '):track;
  const name = [stem, 'm4a'].join('.');
  // eslint-disable-next-line lingui/no-unlocalized-strings -- provider URL and native path identifiers
  return { id, title: name, versionId: id, files: [{url: 'https://www.youtube.com/watch?v=' + track, path: ['Vault', id, name].join('/'), kind: 'vault'}], texts: [] };
}

export function detectVaultSource(input:string):'youtube'|'file' {
  try {
    const url=new URL(input.trim());
    return ['youtube.com','www.youtube.com','music.youtube.com','youtu.be'].includes(url.hostname)?'youtube':'file';
  } catch { return 'file'; }
}

export const MAX_VAULT_BATCH = 20;
/** Validate the entire batch before handing any job to the persistent queue. */
export function vaultBatch(input: string, makeId: () => string): HostJob[] {
  const links = input.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!links.length || links.length > MAX_VAULT_BATCH) throw new Error('batch-size');
  const unique = new Map<string, HostJob>();
  for (const link of links) {
    const id = makeId();
    const job = detectVaultSource(link) === 'youtube' ? youtubeVaultJob(link, id) : vaultJob(link, id);
    unique.set(job.files[0].url, unique.get(job.files[0].url) || job);
  }
  return [...unique.values()];
}
