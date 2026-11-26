// Real browser visibility and native-fixture navigation, with controlled decorative
// provider responses. No live provider or catalogue artwork is used.
import assert from 'node:assert/strict';

function installLandscapeFixture() {
  if (window.top !== window) return;
  localStorage.setItem('tsugi-onboarding-complete-v1', 'true');
  localStorage.setItem('tsugi-startup-area-v1', JSON.stringify('read'));
  localStorage.setItem('tsugi.landscape.local-only', 'true');
}

export async function verifyLandscapeDecorationBrowser({ browser, origin, installDesktopFixture }) {
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
        await page.locator('[data-page="desktop-landing"]').getByRole('button', { name: 'Read', exact: true }).click();
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
      await hero.getByRole('button', { name: 'Enable external illustration', exact: true }).click();
      await decoration.locator('[data-artwork-provider="kitsu"]').waitFor();
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
  console.log('PASS: pending decorative image failures and timeouts pause while Read is inactive/offscreen, resume only when visible, and preserve already loaded artwork without fresh requests.');
}
