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
