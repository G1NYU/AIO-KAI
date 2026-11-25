import { describe, expect, it } from 'vitest';
import { initialDesktopArea, allowsMusicPlayback } from '../src/lib/desktop-area';

describe('unified Tsugi launcher', () => {
  it('starts on the media index whether a video server is saved or not', () => {
    expect(initialDesktopArea(true, false, true)).toBe('welcome');
    expect(initialDesktopArea(true, true, true)).toBe('welcome');
  });
  it('preserves older desktop and browser behavior outside the unified package', () => {
    expect(initialDesktopArea(true, true)).toBe('video');
    expect(initialDesktopArea(true, false)).toBe('welcome');
    expect(initialDesktopArea(false, true, true)).toBe('video');
  });
});

describe('cross-media audio policy', () => {
  it('keeps music running while reading or in the launcher, but not during video', () => {
    expect(allowsMusicPlayback('music')).toBe(true);
    expect(allowsMusicPlayback('read')).toBe(true);
    expect(allowsMusicPlayback('welcome')).toBe(true);
    expect(allowsMusicPlayback('vault')).toBe(true);
    expect(allowsMusicPlayback('video')).toBe(false);
  });
});

import { moveUpcoming,removeUpcoming,clearUpcoming } from '../src/lib/music/queue';
import { vaultTarget,vaultResponseAllowed } from '../src/app/vault/transfer';
describe('Music upcoming queue',()=>{
  const queue=['past','active','next','last'];
  it('keeps the active track and history unchanged while moving upcoming tracks',()=>{
    expect(moveUpcoming(queue,1,3,-1)).toEqual(['past','active','last','next']);
    expect(moveUpcoming(queue,1,2,-1)).toBe(queue);
    expect(moveUpcoming(queue,1,1,1)).toBe(queue);
    expect(removeUpcoming(queue,1,3)).toEqual(['past','active','next']);
    expect(removeUpcoming(queue,1,1)).toBe(queue);
    expect(clearUpcoming(queue,1)).toEqual(['past','active']);
    expect(clearUpcoming(queue,-1)).toBe(queue);
  });
});
describe('Vault transfer guards',()=>{
  it('requires supported direct HTTPS files and matching media types',()=>{
    expect(vaultTarget('https://example.org/my%20book.epub').name).toBe('my book.epub');
    expect(()=>vaultTarget('http://example.org/file.pdf')).toThrow();
    expect(()=>vaultTarget('https://example.org/CON.pdf')).toThrow();
    expect(()=>vaultTarget('https://example.org/file.exe')).toThrow();
    expect(vaultResponseAllowed('mp3','text/html')).toBe(false);
    expect(vaultResponseAllowed('pdf','application/pdf')).toBe(true);
  });
});
