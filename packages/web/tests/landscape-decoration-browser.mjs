// Real browser visibility and native-fixture navigation, with controlled decorative
// provider responses. No live provider or catalogue artwork is used.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

function installLandscapeFixture() {
  if (window.top !== window) return;
  localStorage.setItem('tsugi-onboarding-complete-v1', 'true');
  localStorage.setItem('tsugi-startup-area-v1', JSON.stringify('read'));
  localStorage.setItem('tsugi.landscape.local-only', 'true');
  Math.random = () => .999; // Keep the test deck deterministic without changing its rotation logic.
}

export async function verifyLandscapeDecorationBrowser({ browser, origin, installDesktopFixture, screenshotDir }) {
  for (const mode of ['inactive', 'offscreen']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-GB', reducedMotion: 'reduce' });
    page.setDefaultTimeout(20_000);
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    const read = page.locator('[data-page="read"]');
    const hero = read.locator('.yomi-series-hero');
    const decoration = hero.locator('[data-ui="landscape-decoration"]');
    const pendingUrl = `https://media.kitsu.io/manga/cover_images/tsugi-${mode}-pending/large.jpg`;
    const readyUrl = `https://media.kitsu.io/manga/cover_images/tsugi-${mode}-ready/large.jpg`;
    let releaseFailure, started, finished, pendingAttempts = 0;
    const pendingStarted = new Promise(resolve => { started = resolve; });
    const pendingFinished = new Promise(resolve => { finished = resolve; });
    const failureReleased = new Promise(resolve => { releaseFailure = resolve; });
    const frames = () => page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
    const outside = async () => {
      await decoration.evaluate(node => new Promise((resolve, reject) => {
        const observer = new IntersectionObserver(entries => {
          if (entries.some(entry => !entry.isIntersecting)) { clearTimeout(timer); observer.disconnect(); resolve(); }
        });
        const timer = setTimeout(() => { observer.disconnect(); reject(new Error('The landscape did not leave the viewport')); }, 10_000);
        observer.observe(node);
      }));
      await frames();
    };
    const hide = async () => {
      if (mode === 'inactive') {
        await read.locator('[data-ui="tsugi-desktop-rail"]').getByRole('button', { name: 'All media', exact: true }).click();
        await page.locator('[data-page="desktop-landing"]').waitFor();
        assert.equal(await hero.count(), 1, 'the inactive Read detail remains mounted');
        assert.equal(await hero.isVisible(), false);
      } else {
        // Supply scroll room without replacing IntersectionObserver or the real
        // hero. This exercises the browser's actual clipping/scroll visibility.
        await read.locator('.tsugi-reading-content').evaluate(node => {
          if (!node.querySelector('[data-landscape-test-spacer]')) {
            const spacer = document.createElement('div');
            spacer.dataset.landscapeTestSpacer = '';
            spacer.style.height = '1600px';
            node.appendChild(spacer);
          }
          node.scrollTo(0, node.scrollHeight);
        });
      }
      await outside();
    };
    const show = async () => {
      if (mode === 'inactive') {
        await page.locator('[data-page="desktop-landing"] .tsugi-world-card[data-world="read"]').click();
      } else {
        await read.locator('.tsugi-reading-content').evaluate(node => node.scrollTo(0, 0));
      }
      await hero.waitFor({ state: 'visible' });
      await frames();
    };
    try {
      await page.addInitScript({ content: `(${installDesktopFixture.toString()})();(${installLandscapeFixture.toString()})();` });
      await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.fallback() : route.abort());
      await page.route('https://kitsu.io/api/edge/manga?*', async route => {
        requests.push('candidates');
        await route.fulfill({ json: { data: [pendingUrl, readyUrl].map(url => ({ attributes: { adult: false, ageRating: 'PG', coverImage: { large: url } } })) }, headers: { 'access-control-allow-origin': '*' } });
      });
      await page.route(pendingUrl, async route => {
        requests.push('pending');
        if (++pendingAttempts === 1) {
          started();
          await failureReleased;
        }
        try { if (!page.isClosed()) await route.fulfill({ status: 404, headers: { 'cache-control': 'no-store' } }); }
        finally { finished(); }
      });
      await page.route(readyUrl, async route => {
        requests.push('ready');
        await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="600"><rect width="1600" height="600" fill="#37495b"/></svg>' });
      });
      await page.route('https://api.nekosapi.com/v4/images/random/file?*', async route => {
        requests.push('nekos');
        await route.abort();
      });
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      await read.locator('.tsugi-manga-card').filter({ hasText: 'Tsugi Original Fixture' }).click();
      const bundled = decoration.locator('img.tsugi-design-illustration');
      await bundled.waitFor();
      assert.equal(await bundled.evaluate(node => getComputedStyle(node).filter), 'blur(2px)', 'bundled Reader illustration is softened');
      await hero.getByRole('button', { name: 'Enable external illustration', exact: true }).click();
      await decoration.locator('[data-artwork-provider="kitsu"]').waitFor();
      assert.equal(await decoration.locator('[data-artwork-provider="kitsu"]').evaluate(node => getComputedStyle(node).filter), 'none', 'external artwork is not given the brand illustration effect');
      await pendingStarted;
      await hide();
      const hiddenRequests = [...requests];
      if (mode === 'offscreen') {
        // Exceed the real six-second image timeout while the response is held.
        await page.waitForTimeout(6500);
        assert.deepEqual(requests, hiddenRequests, 'an offscreen image timeout must not request another candidate');
      }
      releaseFailure();
      await pendingFinished;
      await page.waitForTimeout(250);
      await frames();
      assert.deepEqual(requests, hiddenRequests, `${mode} image failure must not request another candidate`);

      await show();
      await page.waitForFunction(url => {
        const img = document.querySelector('.yomi-series-hero [data-artwork-provider="kitsu"]');
        return img?.currentSrc === url && img.complete && img.naturalWidth === 1600 && getComputedStyle(img).opacity === '1';
      }, readyUrl);
      await hero.getByText('Kitsu', { exact: true }).waitFor();
      assert.equal(requests.filter(item => item === 'candidates').length, 1, 'visibility restores the existing candidate list');
      assert.equal(requests.filter(item => item === 'ready').length, 1, 'a visible hero recovers to the next valid artwork');
      const loaded = await decoration.locator('[data-artwork-provider="kitsu"]').elementHandle();
      const loadedRequests = [...requests];
      await hide();
      assert.equal(await loaded.evaluate(node => node.isConnected && node.complete && node.naturalWidth === 1600), true, 'already loaded artwork remains mounted while inactive');
      await show();
      assert.equal(await loaded.evaluate(node => node === document.querySelector('.yomi-series-hero [data-artwork-provider="kitsu"]') && getComputedStyle(node).opacity === '1'), true, 'returning preserves the decoded artwork');
      assert.deepEqual(requests, loadedRequests, 'loaded artwork hide/show does not start a fresh remote request');
      assert.deepEqual(errors, []);
    } finally {
      releaseFailure();
      await page.close();
    }
  }
  await verifyLandscapeRotation({ browser, origin, installDesktopFixture });
  await verifyMusicArtworkContext({ browser, origin, installDesktopFixture, screenshotDir });
  console.log('PASS: pending decorative image failures and timeouts pause while Read is inactive/offscreen, resume only when visible, and preserve already loaded artwork without fresh requests.');
}

const artworkSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="600"><rect width="1600" height="600" fill="#37495b"/><circle cx="1200" cy="230" r="170" fill="#abbea6"/></svg>';

async function verifyLandscapeRotation({ browser, origin, installDesktopFixture }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-GB', reducedMotion: 'no-preference' });
  page.setDefaultTimeout(20_000);
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  const urls = [1, 2, 3].map(index => `https://media.kitsu.io/tsugi-rotation-${index}.jpg`);
  try {
    await page.addInitScript({ content: `(${installDesktopFixture.toString()})();(${installLandscapeFixture.toString()})();` });
    await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    await page.route('https://kitsu.io/api/edge/manga?*', route => {
      requests.push('candidates');
      return route.fulfill({ json: { data: urls.map(url => ({ attributes: { adult: false, ageRating: 'PG', coverImage: { large: url } } })) }, headers: { 'access-control-allow-origin': '*' } });
    });
    await page.route(/https:\/\/(?:media\.kitsu\.io\/tsugi-rotation-|api\.nekosapi\.com\/)/, route => {
      requests.push(route.request().url());
      return route.fulfill({ contentType: 'image/svg+xml', body: artworkSvg });
    });
    await page.clock.install();
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.bringToFront();
    await page.locator('[data-page="read"] [data-ui="tsugi-desktop-rail"]').getByRole('button', { name: 'Books', exact: true }).click();
    const books = page.locator('[data-page="books"]');
    const hero = books.locator('[data-ui="landscape-spotlight"]');
    const decoded = async () => {
      await hero.locator('[data-artwork-provider]').evaluate(image => new Promise((resolve, reject) => {
        if (image.complete && image.naturalWidth) return resolve();
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', reject, { once: true });
      }));
      await page.waitForFunction(() => {
        const image = document.querySelector('[data-page="books"] [data-artwork-provider]');
        return image?.complete && image.naturalWidth > 0 && getComputedStyle(image).opacity === '1';
      });
      return hero.locator('[data-artwork-provider]').getAttribute('src');
    };
    await hero.getByRole('button', { name: 'Enable external illustration', exact: true }).click();
    const first = await decoded();
    await hero.getByRole('button', { name: 'Next illustration', exact: true }).click();
    const second = await decoded();
    assert.notEqual(second, first, 'manual rotation leaves the first cover');
    await page.clock.runFor(12_100);
    const third = await decoded();
    assert.notEqual(third, second, 'visible Books artwork advances after twelve seconds');
    assert.equal(requests.filter(value => value === 'candidates').length, 1, 'rotating does not refetch the catalogue');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.clock.runFor(24_100);
    assert.equal(await decoded(), third, 'reduced motion disables automatic artwork changes');
    await hero.getByRole('button', { name: 'Next illustration', exact: true }).click();
    assert.notEqual(await decoded(), third, 'manual rotation still works with reduced motion');

    await books.locator('[data-ui="tsugi-desktop-rail"]').getByRole('button', { name: 'Manga', exact: true }).click();
    const readHero = page.locator('[data-page="read"] [data-ui="landscape-spotlight"]');
    await readHero.getByRole('button', { name: 'Next illustration', exact: true }).waitFor();
    assert.equal(requests.filter(value => value === 'candidates').length, 1, 'another reading hero reuses the shared candidate pool');
    const remounted = await readHero.locator('[data-artwork-provider]').getAttribute('src');
    assert.notEqual(remounted, first, 'new heroes continue the sequence instead of restarting at the popular first cover');
    await readHero.getByRole('button', { name: 'Use local artwork', exact: true }).click();
    const localRequests = [...requests];
    await page.clock.runFor(24_100);
    assert.equal(await readHero.locator('[data-artwork-provider]').count(), 0);
    assert.deepEqual(requests, localRequests, 'opting out stops external artwork rotation and requests');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
  console.log('PASS: Books rotates every twelve visible seconds, shares a non-repeating candidate pool across heroes, respects reduced motion and keeps the shared local-artwork opt-out.');
}

function installMusicContextFixture(connected) {
  if (window.top !== window) return;
  localStorage.setItem('tsugi-onboarding-complete-v1', 'true');
  localStorage.setItem('tsugi-startup-area-v1', JSON.stringify('music'));
  localStorage.setItem('tsugi.landscape.local-only', 'false');
  if (!connected) return;
  localStorage.setItem('aiostreams-desktop-music-remember-v1', 'true');
  const sourceId = 'eeaa2cb3-5735-43ad-bff6-f1f9f23acdb9';
  localStorage.setItem('aiostreams-desktop-music-sources-v1', JSON.stringify([{ id: sourceId, kind: 'youtube-music', url: 'https://music.youtube.com/' }]));
  localStorage.setItem('tsugi-recent-music-v1', JSON.stringify([{ sourceId, track: { id: 'context-song', title: 'Context song', artist: 'Original fixture', artworkURL: 'https://music-artwork.test/recent.svg' } }]));
  localStorage.setItem('tsugi-independent-playlists-v1', JSON.stringify([{ id: 'context-playlist', name: 'Context playlist', tracks: [{ id: 'saved-song', title: 'Saved song', artist: 'Original fixture', sourceId, artworkURL: 'https://music-artwork.test/saved.svg' }] }]));
}

async function verifyMusicArtworkContext({ browser, origin, installDesktopFixture, screenshotDir }) {
  for (const connected of [true, false]) {
    const page = await browser.newPage({ viewport: { width: connected ? 1440 : 390, height: connected ? 900 : 844 }, locale: 'en-GB', reducedMotion: 'reduce' });
    page.setDefaultTimeout(20_000);
    const errors = [], animeRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/kitsu|nekosapi|hero-yuna/.test(request.url())) animeRequests.push(request.url()); });
    try {
      await page.addInitScript({ content: `(${installDesktopFixture.toString()})();(${installMusicContextFixture.toString()})(${connected});` });
      await page.route('**/*', route => {
        const url = route.request().url();
        if (url.startsWith(origin + '/')) return route.continue();
        if (url.startsWith('https://lh3.googleusercontent.com/tsugi-fixture=') || url.startsWith('https://music-artwork.test/')) return route.fulfill({ contentType: 'image/svg+xml', body: artworkSvg });
        return route.abort();
      });
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      const music = page.locator('[data-page="music"]');
      const hero = music.locator('.oto-feature');
      await hero.waitFor();
      if (connected) {
        await hero.getByRole('heading', { name: 'Native fixture track', exact: true }).waitFor();
        await hero.locator('img.oto-feature-backdrop').waitFor();
        assert.match(await hero.locator('img.oto-feature-backdrop').getAttribute('src'), /\/tsugi-fixture=w\d+-h\d+$/);
        assert.match(await hero.locator('.oto-feature-cover img').getAttribute('src'), /\/tsugi-fixture=w\d+-h\d+$/);
      } else assert.equal(await hero.locator('img').count(), 0, 'unconnected Music uses a restrained neutral backdrop');
      if (screenshotDir) {
        await mkdir(screenshotDir, { recursive: true });
        await page.screenshot({ path: join(screenshotDir, `music-context-${connected ? 'connected' : 'empty'}-discover.png`), animations: 'disabled' });
      }
      await music.getByRole('navigation', { name: 'Music sections' }).getByRole('button', { name: 'Library', exact: true }).click();
      const intro = music.locator('.tsugi-library-intro');
      await intro.waitFor();
      if (connected) assert.equal(await intro.locator('img.oto-library-backdrop').getAttribute('src'), 'https://music-artwork.test/recent.svg', 'Library uses recent music artwork before older saved artwork');
      else assert.equal(await intro.locator('img').count(), 0, 'empty Library does not substitute unrelated illustrations');
      const geometry = await intro.evaluate(node => {
        const h = node.querySelector('h2'), style = getComputedStyle(h), bounds = node.getBoundingClientRect();
        return { lineHeight: parseFloat(style.lineHeight), fontSize: parseFloat(style.fontSize), right: bounds.right, width: innerWidth, scroll: document.documentElement.scrollWidth };
      });
      assert.ok(geometry.lineHeight >= geometry.fontSize * 1.27, 'brush headline has room for descenders');
      assert.ok(geometry.right <= geometry.width + 1 && geometry.scroll <= geometry.width + 1, 'the Music introduction fits the viewport');
      assert.equal(await music.locator('[data-ui="landscape-artwork-controls"],[data-ui="landscape-decoration"]').count(), 0, 'Music has no anime provider or shared illustration preference controls');
      if (screenshotDir) await page.screenshot({ path: join(screenshotDir, `music-context-${connected ? 'connected' : 'empty'}-library.png`), animations: 'disabled' });
      assert.deepEqual(animeRequests, [], 'Music never contacts anime providers or loads the anime fallback');
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }
  console.log('PASS: Music Discover and Library use actual music artwork or neutral fallbacks, make no anime-artwork requests and retain readable brush headings at desktop and narrow widths.');
}
