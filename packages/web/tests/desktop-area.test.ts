import { describe, expect, it } from 'vitest';
import { initialDesktopArea, allowsMusicPlayback, moviesEntryArea } from '../src/lib/desktop-area';

describe('unified Tsugi launcher', () => {
  it('retains configured server browsing and independent addon hubs',()=>{
    expect(moviesEntryArea(true,true)).toBe('video');
    expect(moviesEntryArea(true,false)).toBe('video');
    expect(moviesEntryArea(false,true)).toBe('watch');
    expect(moviesEntryArea(false,false)).toBe('video');
  });
  it('starts on the media index whether a video server is saved or not', () => {
    expect(initialDesktopArea(true, false, true)).toBe('welcome');
    expect(initialDesktopArea(true, true, true)).toBe('welcome');
  });
  it('honors explicit supported startup preferences without changing web startup', () => {
    expect(initialDesktopArea(true,false,true,'music')).toBe('music');
    expect(initialDesktopArea(true,true,true,'vault')).toBe('vault');
    expect(initialDesktopArea(true,false,true,'read')).toBe('read');
    expect(initialDesktopArea(true,false,false,'read')).toBe('welcome');
    expect(initialDesktopArea(false,true,true,'music')).toBe('video');
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
  it('accepts at most eight distinct safe-rated Kitsu CDN landscape candidates',()=>{
    const a='https://media.kitsu.io/manga/cover_images/1/large.jpg';
    const b='https://media.kitsu.app/manga/cover_images/2/large.jpg';
    expect(kitsuLandscapes({data:[null,item('http://media.kitsu.io/a'),item('https://untrusted.invalid/a'),item(a,'R'),item(a,'PG',true),item(a),item(a),item(b),...Array.from({length:10},(_,i)=>item('https://media.kitsu.io/extra/'+i))]})).toEqual([a,b,...Array.from({length:6},(_,i)=>'https://media.kitsu.io/extra/'+i)].map(url=>({url,provider:'kitsu'})));
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

import { vaultJob } from '../src/app/vault/native-job';
describe('Persistent Vault job',()=>{
  it('separates local Vault jobs from video and rejects credential-bearing URLs',()=>{
    const job=vaultJob('https://example.org/my%20book.epub','vault-test');
    expect(job.files).toEqual([{url:'https://example.org/my%20book.epub',path:'Vault/vault-test/my book.epub',kind:'vault'}]);
    expect(()=>vaultJob('https://example.org/book.epub?token=secret','vault-test')).toThrow();
    expect(()=>vaultJob('https://example.org/book.epub','../bad')).toThrow();
  });
});

import { bookFormat, validBookProgress, MAX_BOOK_BYTES } from '../src/app/read/book-guards';
describe('Local book file and progress guards', () => {
  it('checks size, extension and signature before importing', async () => {
    expect(await bookFormat(new File(['%PDF-1.7'], 'book.pdf'))).toBe('pdf');
    expect(await bookFormat(new File([new Uint8Array([80, 75, 3, 4, 0])], 'book.epub'))).toBe('epub');
    await expect(bookFormat(new File(['<html>'], 'book.pdf'))).rejects.toThrow();
    await expect(bookFormat(new File(['%PDF-1.7'], 'book.exe'))).rejects.toThrow();
    await expect(bookFormat(new File([], 'empty.epub'))).rejects.toThrow();
    await expect(bookFormat({ name: 'huge.pdf', size: MAX_BOOK_BYTES + 1, slice: () => new Blob() })).rejects.toThrow();
  });
  it('validates format-specific positions and bounded progress', () => {
    expect(validBookProgress('pdf', 2, .5)).toEqual({ position: 2, fraction: .5 });
    expect(validBookProgress('epub', 'epubcfi(/6/2)', .2)).toEqual({ position: 'epubcfi(/6/2)', fraction: .2 });
    expect(validBookProgress('pdf', '2', .5)).toBeNull();
    expect(validBookProgress('pdf', 0, .5)).toBeNull();
    expect(validBookProgress('epub', 'epubcfi(/6/2', .5)).toBeNull();
    expect(validBookProgress('pdf', 1, NaN)).toBeNull();
  });
});

import { youtubeVaultTrack, youtubeVaultJob } from '../src/app/vault/native-job';
describe('Authorized YouTube Vault export',()=>{
  it('normalizes single public track links and discards shared URL parameters',()=>{
    expect(youtubeVaultTrack('https://music.youtube.com/watch?v=abcdefghijk&si=fixture')).toBe('abcdefghijk');
    expect(youtubeVaultTrack('https://youtu.be/abcdefghijk')).toBe('abcdefghijk');
    expect(youtubeVaultJob('https://www.youtube.com/watch?v=abcdefghijk','vault-test').files).toEqual([{url:'https://www.youtube.com/watch?v=abcdefghijk',path:'Vault/vault-test/abcdefghijk.m4a',kind:'vault'}]);
    expect(youtubeVaultJob('https://youtu.be/abcdefghijk','vault-test','Artist: Track').title).toBe('Artist_ Track - abcdefghijk.m4a');
    for(const bad of ['https://youtube.example/watch?v=abcdefghijk','https://youtube.com/playlist?list=abc','https://youtu.be/abc','https://user:pass@youtube.com/watch?v=abcdefghijk','https://youtube.com:8080/watch?v=abcdefghijk'])
      expect(()=>youtubeVaultTrack(bad)).toThrow();
  });
});

import { validBookCover } from '../src/app/read/book-guards';
describe('Embedded book cover guard',()=>{
  it('allows only bounded PNG blobs with a raster signature',async()=>{
    const magic=new Uint8Array([137,80,78,71,13,10,26,10]);
    expect(await validBookCover(new Blob([magic],{type:'image/png'}))).toBe(true);
    expect(await validBookCover(new Blob(['<svg/>'],{type:'image/png'}))).toBe(false);
    expect(await validBookCover(new Blob([magic],{type:'image/svg+xml'}))).toBe(false);
    expect(await validBookCover(new Blob([new Uint8Array(512*1024+1)],{type:'image/png'}))).toBe(false);
  });
});

import { detectVaultSource } from '../src/app/vault/native-job';
describe('Vault source detection',()=>{
  it('detects a track link pasted with radio and playlist parameters',()=>{
    expect(detectVaultSource('https://www.youtube.com/watch?v=abcdefghijk&list=RDabcdefghijk&start_radio=1')).toBe('youtube');
    expect(youtubeVaultTrack('https://www.youtube.com/watch?v=abcdefghijk&list=RDabcdefghijk&start_radio=1')).toBe('abcdefghijk');
    expect(detectVaultSource('https://example.org/book.epub')).toBe('file');
    expect(detectVaultSource('https://youtube.com.example.org/watch?v=abcdefghijk')).toBe('file');
  });
});

import { vaultBatch } from '../src/app/vault/native-job';
import { vaultEta, reconcileVaultRows } from '../src/app/vault/queue-model';
describe('Vault multi-download intake and progress',()=>{
  it('validates a mixed batch and deduplicates canonical track URLs',()=>{
    let n=0;const id=()=>`vault-test-${++n}`;
    const jobs=vaultBatch('https://example.org/book.epub\nhttps://youtu.be/abcdefghijk\nhttps://www.youtube.com/watch?v=abcdefghijk&list=radio\nhttps://example.org/audio.mp3',id);
    expect(jobs.map(job=>job.files[0].url)).toEqual(['https://example.org/book.epub','https://www.youtube.com/watch?v=abcdefghijk','https://example.org/audio.mp3']);
    expect(new Set(jobs.map(job=>job.id)).size).toBe(3);
    expect(()=>vaultBatch('https://example.org/book.epub\ninvalid',id)).toThrow();
    expect(()=>vaultBatch(Array(21).fill('https://example.org/book.epub').join('\n'),id)).toThrow();
  });
  it('does not fabricate ETA and retains stable row identity and live speed',()=>{
    expect(vaultEta(10,100,10)).toBe(9);
    expect(vaultEta(10,null,10)).toBeNull();
    expect(vaultEta(10,100,0)).toBeNull();
    const row={id:'vault-fixture',state:'downloading' as const,bytes:10,total:100,error:null,speed:10};
    expect(reconcileVaultRows([row],[row])[0]).toBe(row);
    expect(reconcileVaultRows([row],[{...row,state:'paused'}])[0].speed).toBe(0);
  });
});
