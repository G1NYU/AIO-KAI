import { describe, expect, it } from 'vitest';
import { LandscapeArtworkPool, localLandscapes, NEKOS_LANDSCAPE, type LandscapeArtwork } from '../src/components/landscape-artwork';

const pictures: LandscapeArtwork[] = ['one', 'two', 'three'].map(id => ({ url: `https://media.kitsu.io/${id}.jpg`, provider: 'kitsu' }));

describe('Shared landscape candidate lifetime', () => {
  it('shares a pending request and a successful pool across visible consumers', async () => {
    let finish!: (items: LandscapeArtwork[]) => void;
    let calls = 0;
    const pool = new LandscapeArtworkPool(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
    const first = pool.load(new AbortController().signal);
    const second = pool.load(new AbortController().signal);
    expect(calls).toBe(1);
    finish(pictures);
    expect(await first).toEqual(pictures);
    expect(await second).toEqual(pictures);
    expect(await pool.load(new AbortController().signal)).toEqual(pictures);
    expect(calls).toBe(1);
  });

  it('cancels only its departing consumer while another visible hero still needs the pool', async () => {
    let finish!: (items: LandscapeArtwork[]) => void;
    let requestSignal!: AbortSignal;
    const pool = new LandscapeArtworkPool(signal => {
      requestSignal = signal;
      return new Promise(resolve => { finish = resolve; });
    });
    const controller = new AbortController();
    const first = pool.load(controller.signal).catch(error => error);
    const second = pool.load(new AbortController().signal);
    controller.abort();
    expect((await first).name).toBe('AbortError');
    expect(requestSignal.aborted).toBe(false);
    finish(pictures);
    expect(await second).toEqual(pictures);
  });

  it('aborts the last consumer and never caches a late stale response', async () => {
    const requests: { signal: AbortSignal; finish: (items: LandscapeArtwork[]) => void }[] = [];
    const pool = new LandscapeArtworkPool(signal => new Promise(resolve => requests.push({ signal, finish: resolve })));
    const controller = new AbortController();
    const first = pool.load(controller.signal).catch(error => error);
    controller.abort();
    expect((await first).name).toBe('AbortError');
    expect(requests[0].signal.aborted).toBe(true);
    requests[0].finish(pictures);
    await Promise.resolve();
    const second = pool.load(new AbortController().signal);
    expect(requests).toHaveLength(2);
    requests[1].finish([pictures[1]]);
    expect(await second).toEqual([pictures[1]]);
    expect(await pool.load(new AbortController().signal)).toEqual([pictures[1]]);
  });

  it('bounds positive and failed-provider cache lifetime without polling', async () => {
    let now = 0, calls = 0;
    const pool = new LandscapeArtworkPool(async () => { calls++; return calls === 1 ? [NEKOS_LANDSCAPE] : pictures; }, () => now);
    await pool.load(new AbortController().signal);
    now = 59_999;
    await pool.load(new AbortController().signal);
    expect(calls).toBe(1);
    now = 60_000;
    await pool.load(new AbortController().signal);
    expect(calls).toBe(2);
    now += 15 * 60_000 - 1;
    await pool.load(new AbortController().signal);
    expect(calls).toBe(2);
    now++;
    await pool.load(new AbortController().signal);
    expect(calls).toBe(3);
  });
});

describe('Landscape diversity', () => {
  it('visits the complete pool before repeating and avoids a repeat at the cycle boundary', () => {
    const pool = new LandscapeArtworkPool(undefined, undefined, () => .999);
    const picked: string[] = [];
    for (let i = 0; i < 9; i++) picked.push(pool.next(pictures, picked.at(-1))!.url);
    for (let i = 0; i < 9; i += 3) expect(new Set(picked.slice(i, i + 3))).toEqual(new Set(pictures.map(item => item.url)));
    expect(picked.every((url, index) => !index || url !== picked[index - 1])).toBe(true);
  });

  it('shares the sequence across remounted heroes instead of restarting at the popular first cover', () => {
    const pool = new LandscapeArtworkPool(undefined, undefined, () => .999);
    expect(new Set([pool.next(pictures)!.url, pool.next(pictures)!.url, pool.next(pictures)!.url]).size).toBe(3);
  });

  it('remembers failed images for the pool lifetime and keeps bundled alternatives available', () => {
    const pool = new LandscapeArtworkPool(undefined, undefined, () => .999);
    const all = [...pictures, ...localLandscapes('/design/yomi/hero-torii.webp')];
    for (const item of pictures) pool.reject(item.url);
    expect(pool.available(all)).toHaveLength(3);
    expect(pool.next(all)?.provider).toBe('local');
    for (const item of pool.available(all)) pool.reject(item.url);
    expect(pool.next(all)).toBeUndefined();
  });

  it('deduplicates the area fallback and includes only bundled illustrations', () => {
    const local = localLandscapes('/design/kura/hero-kura.webp');
    expect(local).toHaveLength(4);
    expect(local.every(item => item.provider === 'local' && item.url.startsWith('/design/'))).toBe(true);
    expect(localLandscapes('/design/shared/hero-train.webp')).toHaveLength(3);
  });
});

import { selectAnimeCover } from '../src/components/shell/anime-cover';

describe('Anime Hub exact MAL cover lookup',()=>{
  const image='https://cdn.myanimelist.net/images/anime/1/601.jpg';
  const data={mal_id:601,rating:'PG-13 - Teens 13 or older',images:{jpg:{image_url:image}}};
  it('uses a safe-rated exact MAL identity and the existing image CDN',()=>{
    expect(selectAnimeCover({data},601)).toBe(image);
    expect(selectAnimeCover({data},602)).toBeUndefined();
    expect(selectAnimeCover({data:{...data,mal_id:'601'}},601)).toBeUndefined();
    expect(selectAnimeCover({data:{...data,rating:'Rx - Hentai'}},601)).toBeUndefined();
    expect(selectAnimeCover({data:{...data,rating:null}},601)).toBeUndefined();
  });
  it('rejects unexpected origins, credentialed URLs, query strings and non-anime paths',()=>{
    for(const url of ['http://cdn.myanimelist.net/images/anime/1/601.jpg',
      'https://cdn.myanimelist.net.evil.test/images/anime/1/601.jpg',
      'https://user:secret@cdn.myanimelist.net/images/anime/1/601.jpg',
      'https://cdn.myanimelist.net/images/anime/1/601.jpg?token=fixture',
      'https://cdn.myanimelist.net/images/manga/1/601.jpg',
      'https://cdn.myanimelist.net/images/anime/1/601.svg']){
      expect(selectAnimeCover({data:{...data,images:{jpg:{image_url:url}}}},601)).toBeUndefined();
    }
  });
  it('prefers the first valid image, not an invalid high-resolution candidate',()=>{
    expect(selectAnimeCover({data:{...data,images:{jpg:{large_image_url:'https://example.test/cover.jpg',image_url:image}}}},601)).toBe(image);
    expect(selectAnimeCover(null,601)).toBeUndefined();
    expect(selectAnimeCover({data:[]},601)).toBeUndefined();
  });
});
