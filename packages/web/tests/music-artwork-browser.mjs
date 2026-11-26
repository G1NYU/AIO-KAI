// Original SVG fixtures through the real Music provider/parser/player path.
// No live media, account, browser profile or external artwork is used.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

function installArtworkFixture() {
  if (window.top !== window) return;
  localStorage.setItem('tsugi-onboarding-complete-v1', 'true');
  localStorage.setItem('tsugi-startup-area-v1', JSON.stringify('music'));
  localStorage.setItem('tsugi.landscape.local-only', 'true');
  localStorage.setItem('aiostreams-desktop-music-remember-v1', 'true');
  localStorage.setItem('aiostreams-desktop-music-sources-v1', JSON.stringify([
    { id: 'eeaa2cb3-5735-43ad-bff6-f1f9f23acdb9', kind: 'youtube-music', url: 'https://music.youtube.com/' },
  ]));
  const tracks = [
    ['artvideo001', 'Video artwork fixture', 'https://i.ytimg.com/vi/artvideo001/hqdefault.jpg?sqp=synthetic_resize&rs=synthetic_signature', 400, 225],
    ['artgoogle01', 'Density artwork fixture', 'https://yt3.googleusercontent.com/tsugi-art-density=w120-h120-l90-rj', 120, 120],
    ['artretry001', 'Retry artwork fixture', 'https://lh3.googleusercontent.com/tsugi-art-retry=w120-h120', 120, 120],
    ['artbest0001', 'Best decode fixture', 'https://lh3.googleusercontent.com/tsugi-art-best=w120-h120', 120, 120],
    ['artfail0001', 'Unavailable artwork fixture', 'https://lh3.googleusercontent.com/tsugi-art-fail=w120-h120', 120, 120],
  ];
  const host = window.aiostreamsApp, listeners = new Set();
  const send = host.send.bind(host), subscribe = host.subscribe.bind(host);
  host.subscribe = listener => {
    listeners.add(listener);
    const remove = subscribe(listener);
    return () => { listeners.delete(listener); remove(); };
  };
  host.send = message => {
    if (message.type !== 'youtube-music-request' || !['home', 'search'].includes(message.operation)) return send(message);
    const data = message.operation === 'home' ? [] : tracks.map(([id, title, url, width, height]) => ({ musicResponsiveListItemRenderer: {
      playlistItemData: { videoId: id },
      flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: title }] } } }],
      thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url, width, height }] } } },
    } }));
    queueMicrotask(() => { for (const listener of listeners) listener({ type: 'youtube-music-result', request: message.request, data, error: null }); });
  };
}

function originalArtwork(width, height) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 512 512"><defs><pattern id="lines" width="16" height="16" patternUnits="userSpaceOnUse"><path d="M0 0H16V16" fill="none" stroke="#d3b6a0" stroke-width="1"/></pattern></defs><rect width="512" height="512" fill="#173d45"/><circle cx="352" cy="148" r="96" fill="#e9ccb1"/><path d="M0 350 Q150 160 300 350 T512 330 V512H0" fill="#cf705c"/><rect y="375" width="512" height="137" fill="url(#lines)"/></svg>`;
}

export async function verifyMusicArtworkBrowser({ browser, origin, installDesktopFixture, screenshotDir }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'en-GB', reducedMotion: 'reduce' });
  page.setDefaultTimeout(20_000);
  const errors = [], requests = [];
  let retryAvailable = false, videoAvailable = true;
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript({ content: `(${installDesktopFixture.toString()})();(${installArtworkFixture.toString()})();` });
    await page.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(origin + '/')) return route.continue();
      const image = (width, height = width) => route.fulfill({ status: 200, contentType: 'image/svg+xml', headers: { 'cache-control': 'no-store' }, body: originalArtwork(width, height) });
      if (url.startsWith('https://i.ytimg.com/vi/artvideo001/')) {
        requests.push(url);
        if (url.includes('?sqp=')) return image(400, 225);
        if (!videoAvailable) return route.fulfill({ status: 404 });
        return url.endsWith('/maxresdefault.jpg') ? image(1280, 720) : image(480, 360);
      }
      if (/^https:\/\/(?:lh3|yt3)\.googleusercontent\.com\/tsugi-art-/.test(url)) {
        requests.push(url);
        const size = Number(/=w(\d+)-h/.exec(url)?.[1] ?? 120);
        if (url.includes('tsugi-art-fail')) return route.fulfill({ status: 404 });
        if (url.includes('tsugi-art-retry') && !retryAvailable && size > 120) return route.fulfill({ status: 404 });
        if (url.includes('tsugi-art-best') && size > 120) return size === 544 ? route.fulfill({ status: 404 }) : image(256);
        return image(size);
      }
      return route.abort();
    });
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    const music = page.locator('[data-page="music"]');
    await music.getByRole('navigation', { name: 'Music sections' }).getByRole('button', { name: 'Search', exact: true }).click();
    await music.getByRole('textbox', { name: 'Search music', exact: true }).fill('Artwork fixtures');
    await music.getByRole('button', { name: 'Search', exact: true }).last().click();
    const expanded = music.getByRole('dialog', { name: 'Now playing', exact: true });
    const play = async title => {
      await music.locator('[data-ui="music-track-row"]').filter({ hasText: title }).click();
      await music.getByRole('button', { name: 'Expand player', exact: true }).click();
      await expanded.waitFor();
    };
    const close = () => expanded.getByRole('button', { name: 'Minimise player', exact: true }).click();
    const decoded = (width, height) => page.waitForFunction(({ width, height }) => {
      const image = document.querySelector('.tsugi-player-dialog img.tsugi-junction-art');
      return image?.complete && image.naturalWidth === width && image.naturalHeight === height;
    }, { width, height });

    await play('Video artwork fixture');
    await decoded(1280, 720);
    assert.ok(requests.includes('https://i.ytimg.com/vi/artvideo001/maxresdefault.jpg'), 'queried provider thumbnail gets a larger same-video decode');
    await close();

    await play('Density artwork fixture');
    await page.setViewportSize({ width: 2048, height: 1124 });
    await page.waitForFunction(() => {
      const image = document.querySelector('.tsugi-player-dialog img.tsugi-junction-art');
      return image?.complete && image.naturalWidth >= Math.min(2048, Math.ceil(image.getBoundingClientRect().width * devicePixelRatio));
    });
    const density = await expanded.locator('img.tsugi-junction-art').evaluate(image => ({ width: image.getBoundingClientRect().width, decoded: image.naturalWidth, dpr: devicePixelRatio }));
    assert.equal(density.dpr, 2);
    assert.ok(density.decoded > 1024, 'large player requests more than its old fixed1024px cap on a dense display');
    const beforeShrink = requests.length;
    await page.setViewportSize({ width: 390, height: 844 });
    await decoded(density.decoded, density.decoded);
    assert.equal(requests.length, beforeShrink, 'shrinking keeps the sharper decoded source');
    await page.setViewportSize({ width: 1440, height: 900 });
    if (screenshotDir) {
      await mkdir(screenshotDir, { recursive: true });
      await page.screenshot({ path: join(screenshotDir, 'music-artwork-density.png'), animations: 'disabled' });
    }
    await close();

    await play('Retry artwork fixture');
    await decoded(120, 120);
    await close();
    retryAvailable = true;
    await music.getByRole('button', { name: 'Expand player', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.tsugi-player-dialog img.tsugi-junction-art')?.naturalWidth >= 1024);
    assert.ok(requests.filter(url => url.includes('tsugi-art-retry=w1024')).length >= 2, 'reopening retries full artwork instead of promoting the last small fallback');
    await close();

    const originalBest = page.waitForResponse(response => response.url() === 'https://lh3.googleusercontent.com/tsugi-art-best=w120-h120');
    await play('Best decode fixture');
    await (await originalBest).finished();
    await decoded(256, 256);
    assert.doesNotMatch(await expanded.locator('img.tsugi-junction-art').getAttribute('src'), /=w120-h120$/);
    assert.ok(requests.some(url => url.includes('tsugi-art-best=w544')), 'undersized HTTP200 continues through fallback candidates');
    await close();

    videoAvailable = false;
    await play('Video artwork fixture');
    const originalVideo = 'https://i.ytimg.com/vi/artvideo001/hqdefault.jpg?sqp=synthetic_resize&rs=synthetic_signature';
    // Decoding a wide fallback can increase the crop-aware pixel target and
    // replace the image once more. Capture one decoded image, not dimensions
    // from one node followed by a later node's pending candidate URL.
    const fallback = await page.waitForFunction(original => {
      const selector = '.tsugi-player-dialog img.tsugi-junction-art';
      const image = document.querySelector(selector);
      const ready = () => image?.complete && image.naturalWidth === 400 && image.naturalHeight === 225
        && image.getAttribute('src') === original && image.currentSrc === original;
      if (!ready()) return false;
      return { src: image.getAttribute('src'), currentSrc: image.currentSrc,
        width: image.naturalWidth, height: image.naturalHeight, complete: image.complete };
    }, originalVideo);
    const recovered = await fallback.jsonValue();
    await fallback.dispose();
    assert.deepEqual(recovered, { src: originalVideo, currentSrc: originalVideo, width: 400, height: 225, complete: true },
      'unavailable larger variants recover to the exact provider fallback');
    await close();
    await play('Unavailable artwork fixture');
    await expanded.locator('span.tsugi-junction-art').waitFor();
    assert.equal(await expanded.locator('img.tsugi-junction-art').count(), 0, 'failed images end in the existing artwork placeholder');
    assert.deepEqual(errors, []);
    console.log('PASS: Music artwork upgrades queried same-video thumbnails, sizes for crop/DPR, retries degraded cached choices, retains best decodes and recovers from failed images');
  } finally { await page.close(); }
}
