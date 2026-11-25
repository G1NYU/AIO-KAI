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

import { kitsuLandscapes } from '../src/components/landscape-artwork';
describe('Landscape artwork provider guards',()=>{
  const item=(url:string,ageRating='PG',adult=false)=>({attributes:{ageRating,adult,coverImage:{large:url}}});
  it('accepts at most two distinct safe-rated Kitsu CDN landscape candidates',()=>{
    const a='https://media.kitsu.io/manga/cover_images/1/large.jpg';
    const b='https://media.kitsu.app/manga/cover_images/2/large.jpg';
    expect(kitsuLandscapes({data:[null,item('http://media.kitsu.io/a'),item('https://untrusted.invalid/a'),item(a,'R'),item(a,'PG',true),item(a),item(a),item(b),item('https://media.kitsu.io/c')]})).toEqual([{url:a,provider:'kitsu'},{url:b,provider:'kitsu'}]);
  });
  it('rejects malformed or untrusted input without throwing',()=>{
    expect(kitsuLandscapes(null)).toEqual([]);
    expect(kitsuLandscapes({data:[{},item('https://user:pass@media.kitsu.io/a'),item('https://media.kitsu.io:8080/a')]})).toEqual([]);
  });
});

import { listTorBox, submitTorBox, torboxItems, torboxLink } from '../src/app/vault/torbox';
describe('Vault TorBox cloud provider', () => {
  it('accepts only HTTPS links without embedded credentials or fragments', () => {
    expect(torboxLink(' https://example.org/book.epub ')).toBe('https://example.org/book.epub');
    for (const url of ['http://example.org/file', 'file:///book.epub', 'https://user:secret@example.org/file', 'https://example.org/file#private']) expect(() => torboxLink(url)).toThrow();
  });
  it('parses and deduplicates only valid account download rows', () => {
    expect(torboxItems([{id: 1, name: 'Book', download_finished: true}, {id: 1}, {id: 'bad'}, null])).toEqual([{id: 1, name: 'Book', state: '', finished: true}]);
    expect(() => torboxItems({})).toThrow();
  });
  it('sends credentials only in the Authorization header to fixed TorBox endpoints', async () => {
    const calls: {url: string; init?: RequestInit}[] = [];
    const fake: typeof fetch = async (url, init) => {
      calls.push({url: String(url), init});
      return new Response(JSON.stringify({success: true, data: []}), {status: 200});
    };
    const signal = new AbortController().signal;
    await listTorBox('fixture-key', signal, fake);
    await submitTorBox('fixture-key', 'https://example.org/book.epub', signal, fake);
    expect(calls.map(c => c.url)).toEqual(['https://api.torbox.app/v1/api/webdl/mylist?limit=100&files=false','https://api.torbox.app/v1/api/webdl/createwebdownload']);
    expect(calls.every(c => c.init?.redirect === 'error' && c.init.credentials === 'omit' && new Headers(c.init.headers).get('Authorization') === 'Bearer fixture-key')).toBe(true);
    expect(String(calls[1].init?.body)).toBe('link=https%3A%2F%2Fexample.org%2Fbook.epub');
  });
  it('does not expose provider error details or treat a rejected submission as success', async () => {
    const signal = new AbortController().signal;
    const fake: typeof fetch = async () => new Response(JSON.stringify({success:false, detail:'sensitive-response'}), {status:200});
    await expect(submitTorBox('fixture-key','https://example.org/book.epub',signal,fake)).rejects.toMatchObject({kind:'request',message:'request'});
  });
});
