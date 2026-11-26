// Real browser audio and Web Audio samples from an original WAV. All provider
// responses are fixtures; no account, remote music, or signed URL is involved.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';

function toneFixture() {
  const sampleRate = 8000, samples = sampleRate * 120;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const envelope = .65 + .3 * Math.sin(2 * Math.PI * i / sampleRate);
    wav.writeInt16LE(Math.round(8000 * envelope * Math.sin(2 * Math.PI * 220 * i / sampleRate)), 44 + i * 2);
  }
  return wav;
}

function inspectAudioGraphs() {
  if (window.top !== window) return;
  const state = window.__musicAudioFixture = { graphs: [], analysers: [], elements: [], rejectNextResume: false, resumeRejections: 0 };
  const createAnalyser = AudioContext.prototype.createAnalyser;
  AudioContext.prototype.createAnalyser = function (...args) {
    const node = createAnalyser.apply(this, args);
    state.analysers.push(node);
    return node;
  };
  const createSource = AudioContext.prototype.createMediaElementSource;
  AudioContext.prototype.createMediaElementSource = function (element) {
    const source = createSource.call(this, element);
    const graph = { context: this, element, mode: element.dataset.audioMode, request: element.dataset.audioRequest, disconnected: false };
    state.graphs.push(graph);
    const disconnect = source.disconnect;
    source.disconnect = function (...args) { graph.disconnected = true; return disconnect.apply(this, args); };
    if (state.rejectNextResume) {
      state.rejectNextResume = false;
      // Exercise a device/context failure after the real element is attached.
      // Successful cases use the native methods and native PCM data unchanged.
      Object.defineProperty(this, 'state', { configurable: true, get: () => 'suspended' });
      this.resume = () => {
        delete this.state;
        state.resumeRejections++;
        return Promise.reject(new DOMException('Fixture resume rejection', 'NotAllowedError'));
      };
    }
    return source;
  };
  new MutationObserver(records => {
    for (const record of records) for (const added of record.addedNodes) {
      if (!(added instanceof Element)) continue;
      const elements = added.matches('[data-ui="tsugi-audio-engine"]') ? [added] : added.querySelectorAll('[data-ui="tsugi-audio-engine"]');
      for (const element of elements) state.elements.push({ element, mode: element.dataset.audioMode, request: element.dataset.audioRequest });
    }
  }).observe(document, { childList: true, subtree: true });
  localStorage.setItem('tsugi-startup-area-v1', JSON.stringify('music'));
  localStorage.setItem('tsugi-onboarding-complete-v1', JSON.stringify(true));
  localStorage.setItem('tsugi-matrix-mode-v1', JSON.stringify('wave'));
}

export async function verifyMusicAudioBrowser({ browser, origin, installDesktopFixture, screenshotDir }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' });
  page.setDefaultTimeout(20_000);
  const errors = [], mediaRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  const wav = toneFixture();
  const addonOrigin = 'https://tsugi-addon.example';
  const mediaOrigin = 'https://tsugi-audio.example';
  // DevTools-fulfilled media responses can bypass the browser's CORS response
  // check. Redirect fixture URLs to real loopback responses to exercise it.
  const mediaServer = createServer((request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    mediaRequests.push({ path, cors: !!request.headers.origin });
    const headers = { 'content-type': 'audio/wav', 'cache-control': 'no-store',
      'accept-ranges': 'bytes', ...(path === '/cors.wav' ? { 'access-control-allow-origin': '*' } : {}) };
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '');
    if (range) {
      const start = Number(range[1]), end = Math.min(wav.length - 1, range[2] ? Number(range[2]) : wav.length - 1);
      if (start > end) { response.writeHead(416, { ...headers, 'content-range': 'bytes */' + wav.length }); response.end(); return; }
      response.writeHead(206, { ...headers, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${wav.length}` });
      response.end(wav.subarray(start, end + 1));
      return;
    }
    response.writeHead(200, { ...headers, 'content-length': wav.length });
    response.end(wav);
  });
  const tracks = [
    { id: 'cors', title: 'CORS audio fixture', artist: 'Tsugi', duration: 120 },
    { id: 'opaque', title: 'Direct audio fixture', artist: 'Tsugi', duration: 120 },
  ];
  try {
    await new Promise((resolve, reject) => { mediaServer.once('error', reject); mediaServer.listen(0, '127.0.0.1', resolve); });
    const mediaLoopback = 'http://127.0.0.1:' + mediaServer.address().port;
    await page.addInitScript(installDesktopFixture);
    await page.addInitScript(inspectAudioGraphs);
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === origin || url.origin === mediaLoopback) return route.continue();
      if (url.origin === addonOrigin) {
        const headers = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
        if (url.pathname === '/manifest.json') return route.fulfill({ headers, json: { id: 'tsugi.audio-fixture', name: 'Tsugi audio fixture', version: '1', resources: ['search', 'stream'] } });
        if (url.pathname === '/search') return route.fulfill({ headers, json: { tracks } });
        if (url.pathname === '/stream/cors' || url.pathname === '/stream/opaque') return route.fulfill({ headers, json: { url: mediaOrigin + '/' + url.pathname.split('/').at(-1) + '.wav', format: 'WAV' } });
        return route.fulfill({ status: 404, headers });
      }
      if (url.origin === mediaOrigin) {
        return route.fulfill({ status: 302, headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store', location: mediaLoopback + url.pathname } });
      }
      return route.abort();
    });
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    const music = page.locator('[data-page="music"]');
    await music.waitFor({ state: 'visible' });
    const sourceSettings = music.getByRole('dialog', { name: 'Music sources', exact: true });
    await sourceSettings.getByRole('textbox', { name: 'Eclipse addon manifest URL' }).fill(addonOrigin + '/manifest.json');
    await sourceSettings.getByRole('button', { name: 'Connect', exact: true }).click();
    await sourceSettings.waitFor({ state: 'hidden' });
    await music.getByRole('textbox', { name: 'Search music', exact: true }).fill('fixture');
    await music.locator('.tsugi-music-search form').getByRole('button', { name: 'Search', exact: true }).click();
    await music.locator('[data-ui="music-track-row"]').first().waitFor();
    const audio = page.locator('[data-ui="tsugi-audio-engine"]');
    const expanded = music.getByRole('dialog', { name: 'Now playing', exact: true });
    const minimise = async () => { if (await expanded.isVisible()) await expanded.getByRole('button', { name: 'Minimise player', exact: true }).click(); };
    const play = async title => {
      await minimise();
      const previous = await audio.count() ? await audio.getAttribute('data-audio-request') : null;
      await music.locator('[data-ui="music-track-row"]').filter({ hasText: title }).click();
      await page.waitForFunction(previous => {
        const media = document.querySelector('[data-ui="tsugi-audio-engine"]');
        return media && media.dataset.audioRequest !== previous && !media.paused && media.currentTime > .1 && !media.error;
      }, previous);
      return audio.getAttribute('data-audio-request');
    };
    const expand = async () => { await music.getByRole('button', { name: 'Expand player', exact: true }).click(); await expanded.waitFor(); };
    const signal = async () => page.waitForFunction(() => window.__musicAudioFixture.analysers.some(analyser => {
      if (analyser.context.state !== 'running') return false;
      const values = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(values);
      return values.some(value => Math.abs(value - 128) > 3);
    }));
    const seek = async seconds => expanded.getByRole('slider', { name: 'Seek position', exact: true }).evaluate((input, at) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(at));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, seconds);

    const firstRequest = await play('CORS audio fixture');
    assert.equal(await audio.getAttribute('crossorigin'), 'anonymous');
    await expand();
    await expanded.getByText('Audio-reactive dot wave', { exact: true }).waitFor();
    await signal();
    assert.equal(await page.evaluate(() => window.__musicAudioFixture.graphs.length), 1);
    await expanded.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-ui="tsugi-audio-engine"]').paused);
    await seek(12);
    await page.waitForFunction(() => Math.abs(document.querySelector('[data-ui="tsugi-audio-engine"]').currentTime - 12) < .1);
    await expanded.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-ui="tsugi-audio-engine"]').currentTime > 12.2);
    await signal();
    if (screenshotDir) {
      await mkdir(screenshotDir, { recursive: true });
      await page.screenshot({ path: join(screenshotDir, '09-eclipse-audio-wave.png') });
    }

    // Explicitly selecting the same URL must create a fresh element/graph.
    const repeatedRequest = await play('CORS audio fixture');
    assert.notEqual(repeatedRequest, firstRequest);
    await expand();
    await signal();
    await page.waitForFunction(() => window.__musicAudioFixture.graphs[0].context.state === 'closed');
    assert.equal(await page.evaluate(() => window.__musicAudioFixture.graphs[0].disconnected), true);
    assert.equal(await page.evaluate(() => window.__musicAudioFixture.graphs.length), 2);

    const directRequest = await play('Direct audio fixture');
    assert.equal(await audio.getAttribute('data-audio-mode'), 'direct');
    assert.equal(await audio.getAttribute('crossorigin'), null);
    await expand();
    await expanded.getByText('Audio visualization unavailable for this stream', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(request => window.__musicAudioFixture.elements.filter(item => item.request === request).map(item => item.mode), directRequest), ['cors', 'direct'], 'one application fallback creates a fresh media element');
    assert.equal(await page.evaluate(request => window.__musicAudioFixture.graphs.filter(item => item.request === request).length, directRequest), 0, 'opaque playback is never attached to a Web Audio graph');
    await page.waitForFunction(() => window.__musicAudioFixture.graphs.every(item => item.context.state === 'closed' && item.disconnected));
    assert.equal(await audio.evaluate(media => media.volume > 0 && !media.muted), true);
    const opaqueRequests = mediaRequests.filter(request => request.path === '/opaque.wav');
    assert.ok(opaqueRequests.some(request => request.cors) && opaqueRequests.some(request => !request.cors), 'fixture exercises both browser CORS rejection and ordinary media playback');
    const directAt = await audio.evaluate(media => media.currentTime);
    await page.waitForFunction(at => document.querySelector('[data-ui="tsugi-audio-engine"]').currentTime > at + .2, directAt);
    if (screenshotDir) await page.screenshot({ path: join(screenshotDir, '09-eclipse-direct-fallback.png') });

    // Reject graph resumption only after a successful CORS load, while paused
    // and seeked. Fallback must not lose the user's pause or saved position.
    const failureRequest = await play('CORS audio fixture');
    await music.getByRole('region', { name: 'Music player', exact: true }).getByRole('button', { name: 'Pause', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-ui="tsugi-audio-engine"]').paused);
    await page.evaluate(() => { window.__musicAudioFixture.rejectNextResume = true; });
    // Set the current playback position before opening the visualizer.
    await audio.evaluate(media => { media.currentTime = 18; });
    await expand();
    await page.waitForFunction(() => document.querySelector('[data-ui="tsugi-audio-engine"]').dataset.audioMode === 'direct');
    await expanded.getByText('Audio visualization unavailable for this stream', { exact: true }).waitFor();
    await page.waitForFunction(() => {
      const media = document.querySelector('[data-ui="tsugi-audio-engine"]');
      return media.readyState >= 2 && media.paused && Math.abs(media.currentTime - 18) < .1;
    });
    assert.equal(await page.evaluate(() => window.__musicAudioFixture.resumeRejections), 1);
    assert.deepEqual(await page.evaluate(request => window.__musicAudioFixture.elements.filter(item => item.request === request).map(item => item.mode), failureRequest), ['cors', 'direct']);
    assert.equal(await page.evaluate(() => window.__musicAudioFixture.graphs.some(item => item.mode === 'direct')), false);
    await expanded.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-ui="tsugi-audio-engine"]').currentTime > 18.2);

    // An old graph/fallback must not taint the next supported source or pause
    // playback when changing workspace.
    await play('CORS audio fixture');
    await expand();
    await signal();
    await expanded.getByText('Audio-reactive dot wave', { exact: true }).waitFor();
    await minimise();
    const finalRequest = await audio.getAttribute('data-audio-request');
    const beforeRead = await audio.evaluate(media => media.currentTime);
    await music.getByRole('button', { name: 'Read', exact: true }).click();
    await page.locator('[data-page="read"]').waitFor({ state: 'visible' });
    await page.waitForFunction(at => {
      const media = document.querySelector('[data-ui="tsugi-audio-engine"]');
      return !media.paused && media.currentTime > at + .2;
    }, beforeRead);
    assert.equal(await audio.getAttribute('data-audio-request'), finalRequest);
    assert.deepEqual(errors, []);
    console.log('PASS: real Eclipse CORS audio drives PCM waveform; same-URL replay, pause/seek, one direct fallback, rejected graph resume and Read continuity preserve playback.');
  } catch (error) {
    const mediaState = await page.evaluate(() => {
      const media = document.querySelector('[data-ui="tsugi-audio-engine"]');
      return media ? { mode: media.dataset.audioMode, request: media.dataset.audioRequest,
        ready: media.readyState, network: media.networkState, paused: media.paused,
        position: media.currentTime, error: media.error?.code } : null;
    }).catch(() => null);
    console.error('Eclipse browser audio fixture failed', { mediaState, errors, mediaRequests });
    if (screenshotDir) {
      await mkdir(screenshotDir, { recursive: true });
      await page.screenshot({ path: join(screenshotDir, '09-eclipse-audio-failure.png') }).catch(() => {});
    }
    throw error;
  } finally {
    try { await page.close(); } finally {
      mediaServer.closeAllConnections();
      await new Promise(resolve => mediaServer.close(resolve));
    }
  }
}
