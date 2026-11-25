/** Same-origin import of a completed native Vault job; no arbitrary file paths. */
export async function readCompletedVaultFile(id: string, name: string, signal: AbortSignal): Promise<File> {
  if (!/^vault-[A-Za-z0-9_-]{1,58}$/.test(id) || !/\.(pdf|epub|m4a|mp3|flac|wav|ogg|opus|aac)$/i.test(name))
    throw new Error('invalid-vault-import');
  const url = new URL(['/__tsugi_vault/file', id].join('/'), location.origin);
  const response = await fetch(url, { signal, headers: { 'X-Tsugi-Vault-Import': '1' }, credentials: 'omit', cache: 'no-store', redirect: 'error' });
  if (!response.ok) throw new Error('vault-file-unavailable');
  const blob = await response.blob();
  signal.throwIfAborted();
  if (!blob.size || blob.size > 128 * 1024 * 1024) throw new Error('vault-import-limit');
  return new File([blob], name, { type: blob.type });
}
