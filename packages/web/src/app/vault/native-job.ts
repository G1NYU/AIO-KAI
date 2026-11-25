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
export function youtubeVaultJob(input: string, id: string): HostJob {
  const track = youtubeVaultTrack(input);
  if (!/^vault-[a-zA-Z0-9_-]{1,58}$/.test(id)) throw new Error('Invalid Vault job.');
  const name = track + '.m4a';
  // eslint-disable-next-line lingui/no-unlocalized-strings -- provider URL and native path identifiers
  return { id, title: name, versionId: id, files: [{url: 'https://www.youtube.com/watch?v=' + track, path: ['Vault', id, name].join('/'), kind: 'vault'}], texts: [] };
}
