import { describe, expect, it } from 'vitest';
import { vaultTarget, vaultResponseAllowed } from '../src/app/vault/transfer';
describe('Vault direct file validation',()=>{
  it('accepts direct HTTPS book and audio links',()=>{
    expect(vaultTarget('https://example.org/a%20book.epub').name).toBe('a book.epub');
    expect(vaultTarget('https://example.org/track.mp3?key=example').extension).toBe('mp3');
  });
  it('rejects non-HTTPS, credentials, unsupported formats and reserved Windows names',()=>{
    for(const url of ['http://example.org/a.pdf','https://a:b@example.org/a.pdf','https://example.org/file.exe','https://example.org/CON.pdf','https://example.org/']) expect(()=>vaultTarget(url)).toThrow();
  });
  it('rejects HTML and mismatched content types',()=>{
    expect(vaultResponseAllowed('pdf','application/pdf')).toBe(true);
    expect(vaultResponseAllowed('epub','text/html')).toBe(false);
    expect(vaultResponseAllowed('mp3','application/pdf')).toBe(false);
  });
});
