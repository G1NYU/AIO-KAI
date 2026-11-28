// Actual Music player, original SVG cover and an original PCM tone. All source
// and lyric responses are synthetic; no account or remote music is accessed.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

function originalTone() {
  const rate = 8000, samples = rate * 120;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * 220 * i / rate)), 44 + i * 2);
  return wav;
}

export async function verifyMusicPlayerLayoutBrowser({ browser, origin, installDesktopFixture, screenshotDir }) {
  const page = await browser.newPage({ viewport: { width: 2048, height: 1124 }, locale: 'en-GB' });
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const source = 'https://original-player.example';
  const mediaOrigin = 'https://original-player-media.example';
  const art = `${mediaOrigin}/cover.svg`;
  const tracks = [
    { id: 'horizon', title: 'Where Is The Horizon', artist: 'Original Artist', album: 'Original Album', duration: 120, artworkURL: art },
    { id: 'without', title: 'Without Me', artist: 'Original Artist', duration: 120, artworkURL: art },
    { id: 'next', title: 'Following The Evening Light Beyond the Distant Horizon (Album Version)', artist: 'Original Artist', duration: 120, artworkURL: art },
  ];
  const wav = originalTone();
  const cover = '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#4b5968"/><circle cx="740" cy="254" r="135" fill="#e9b68c"/><path d="M0 700L310 340L650 760L1024 430V1024H0Z" fill="#243d48"/><path d="M0 860L460 610L1024 900V1024H0Z" fill="#152b34"/></svg>';
  const capture = async name => {
    if (!screenshotDir) return;
    await mkdir(screenshotDir, { recursive: true });
    await page.screenshot({ path: join(screenshotDir, name + '.png'), animations: 'disabled', timeout: 10_000 });
  };
  try {
    await page.addInitScript(installDesktopFixture);
    await page.addInitScript(() => {
      const put = (key, value) => localStorage.setItem(key, JSON.stringify(value));
      put('tsugi-startup-area-v1', 'music');
      put('tsugi-onboarding-complete-v1', true);
      put('tsugi-matrix-mode-v1', 'wave');
      put('tsugi-desktop-player-stage-v1', { id: 'default', imported: null });
      window.__playerLayoutAnalysers = [];
      const original = AudioContext.prototype.createAnalyser;
      AudioContext.prototype.createAnalyser = function (...args) {
        const analyser = original.apply(this, args);
        window.__playerLayoutAnalysers.push(analyser);
        return analyser;
      };
    });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      const headers = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
      if (url.origin === source) {
        if (url.pathname === '/manifest.json') return route.fulfill({ headers, json: { id: 'original.player-layout', name: 'Original music source', version: '1', resources: ['search', 'stream'] } });
        if (url.pathname === '/search') return route.fulfill({ headers, json: { tracks } });
        if (url.pathname.startsWith('/stream/')) return route.fulfill({ headers, json: { url: `${mediaOrigin}/tone.wav`, format: 'WAV' } });
        return route.fulfill({ status: 404, headers });
      }
      if (url.href === art) return route.fulfill({ contentType: 'image/svg+xml', body: cover });
      if (url.origin === mediaOrigin && url.pathname === '/tone.wav') return route.fulfill({ headers, contentType: 'audio/wav', body: wav });
      if (url.hostname === 'lrclib.net') {
        const lyricHeaders = { ...headers, 'access-control-allow-headers': 'Lrclib-Client', 'access-control-allow-methods': 'GET, OPTIONS' };
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: lyricHeaders });
        const track = tracks.find(item => item.title === url.searchParams.get('track_name')) || tracks[0];
        const row = { id: tracks.indexOf(track) + 1, trackName: track.title, artistName: track.artist, albumName: track.album || '', duration: 120, syncedLyrics: '[00:00.00]An original line for layout testing\n[00:12.00]A second original line\n[00:24.00]A third original line' };
        return route.fulfill({ headers: lyricHeaders, json: url.pathname === '/api/get' ? row : [row] });
      }
      if (url.origin === origin) return route.continue();
      return route.abort();
    });
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    const music = page.locator('[data-page="music"]');
    await music.getByRole('button', { name: 'Music sources', exact: true }).click();
    const sources = music.getByRole('dialog', { name: 'Music sources', exact: true });
    await sources.getByRole('textbox', { name: 'Eclipse addon manifest URL' }).fill(source + '/manifest.json');
    await sources.getByRole('button', { name: 'Connect', exact: true }).click();
    await sources.waitFor({ state: 'hidden' });
    await music.getByRole('textbox', { name: 'Search music', exact: true }).fill('original');
    await music.locator('.tsugi-music-search form').getByRole('button', { name: 'Search', exact: true }).click();
    await music.locator('[data-ui="music-track-row"]').filter({ hasText: tracks[0].title }).click();
    await page.waitForFunction(() => { const media = document.querySelector('[data-ui="tsugi-audio-engine"]'); return media && !media.paused && media.currentTime > .1 && !media.error; });
    await music.getByRole('button', { name: 'Expand player', exact: true }).click();
    const expanded = music.getByRole('dialog', { name: 'Now playing', exact: true });
    const stage = expanded.locator('[data-ui="tsugi-junction"]');
    await expanded.getByText('Audio-reactive dot wave', { exact: true }).waitFor();
    await page.waitForFunction(() => window.__playerLayoutAnalysers.some(analyser => { const samples = new Uint8Array(analyser.fftSize); analyser.getByteTimeDomainData(samples); return analyser.context.state === 'running' && samples.some(value => Math.abs(value - 128) > 3); }));
    await page.evaluate(() => document.fonts.ready);
    const geometry = () => expanded.evaluate(node => {
      const rect = selector => { const r = node.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
      return { art: rect('.tsugi-junction-art'), content: rect('.tsugi-junction-content'), hud: rect('.tsugi-player-hud'), transport: rect('.oto-transport'), timeline: rect('.oto-timeline'), actions: rect('.tsugi-stage-actions'), next: rect('.oto-up-next'), width: innerWidth, height: innerHeight, scrollWidth: node.scrollWidth, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight };
    });
    const titleSpacing = async (selector = '.tsugi-track-title') => {
      await page.waitForFunction(selector => {
        const title = document.querySelector('.oto-player ' + selector);
        if (!title) return false;
        const style = getComputedStyle(title), ctx = document.createElement('canvas').getContext('2d');
        ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const ink = ctx.measureText(title.textContent);
        return parseFloat(style.lineHeight) - ink.actualBoundingBoxAscent - ink.actualBoundingBoxDescent >= parseFloat(style.fontSize) * .07;
      }, selector);
      const ink = await stage.locator(selector).evaluate(node => {
        const style = getComputedStyle(node), range = document.createRange();
        range.selectNodeContents(node);
        const lines = [...range.getClientRects()];
        const ctx = document.createElement('canvas').getContext('2d');
        ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const metrics = ctx.measureText(node.textContent);
        const inkTop = lines[0].top + metrics.fontBoundingBoxAscent - metrics.actualBoundingBoxAscent;
        const label = node.previousElementSibling.getBoundingClientRect();
        const artist = node.nextElementSibling.getBoundingClientRect();
        const inkBottom = lines.at(-1).top + metrics.fontBoundingBoxAscent + metrics.actualBoundingBoxDescent;
        return { gap: inkTop - label.bottom, artistGap: artist.top - inkBottom, lineGap: parseFloat(style.lineHeight) - metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent, size: parseFloat(style.fontSize), family: style.fontFamily, weight: Number(style.fontWeight), lines: lines.length };
      });
      assert.match(ink.family,/^Interface(?:,|$)/,'track titles use the shared sans-serif face');
      assert.ok(ink.size<=44&&ink.weight>=600&&ink.weight<=750,'track title stays compact and semibold');
      assert.ok(ink.gap >= 12, `Track title ink clears its label by at least 12px: ${JSON.stringify(ink)}`);
      assert.ok(ink.artistGap >= 6, `Track title ink clears the artist below: ${JSON.stringify(ink)}`);
      assert.ok(ink.lineGap >= ink.size * .07, `Track title leading separates the glyphs: ${JSON.stringify(ink)}`);
      return ink;
    };
    const chooseLayout = async layout => {
      await expanded.getByRole('button', { name: 'Player settings', exact: true }).click();
      const settings = expanded.getByRole('dialog', { name: 'Player settings' });
      await settings.getByRole('combobox', { name: 'Player layout' }).selectOption(layout);
      await settings.getByRole('button', { name: 'Close', exact: true }).click();
      await stage.locator('.tsugi-junction-art').waitFor();
      await page.waitForFunction(layout => document.querySelector('.oto-player [data-ui="tsugi-junction"]')?.dataset.layout === layout, layout);
    };
    for (const layout of ['default', 'junction', 'nocturne']) {
      await chooseLayout(layout);
      const box = await geometry();
      const title = await titleSpacing();
      const paint = await stage.locator('.tsugi-junction-content').evaluate(node => {
        const style = getComputedStyle(node);
        return { background: style.backgroundColor, image: style.backgroundImage };
      });
      assert.deepEqual(paint, { background: 'rgba(0, 0, 0, 0)', image: 'none' }, `${layout}: metadata and controls have no broad decorative panel`);
      await capture(`50-player-${layout}-2048`);
      console.log('PLAYER GEOMETRY', layout, JSON.stringify({ ...box, title }));
      assert.ok(box.content.width <= 680, `${layout}: listening controls have a bounded measure`);
      assert.ok(box.content.x - box.art.right >= 24 && box.content.x - box.art.right <= 96, `${layout}: art and controls stay grouped at wide widths`);
      assert.ok(Math.min(box.art.y, box.content.y) - box.hud.bottom <= 80, `${layout}: composition follows the header without an excessive void`);
      assert.ok(Math.abs(box.art.width - box.art.height) < 1, `${layout}: artwork stays square`);
      assert.ok(box.scrollWidth <= box.width + 1 && box.scrollHeight <= box.clientHeight + 1, `${layout}: normal desktop controls fit without scrolling`);
      assert.ok(Math.abs((box.transport.x + box.transport.width / 2) - (box.timeline.x + box.timeline.width / 2)) <= 1, `${layout}: transport and timeline share a center`);
      assert.ok(box.actions.y - box.transport.bottom <= 28 && box.next.y - box.actions.bottom <= 28, `${layout}: related controls keep a consistent rhythm`);
    }
    console.log('PASS: all three built-in players keep artwork, title and controls unframed, bounded and aligned at 2048×1124.');
    await chooseLayout('default');
    await page.setViewportSize({ width: 1440, height: 900 });
    const desktop = await geometry();
    await titleSpacing();
    assert.ok(desktop.content.width <= 680 && desktop.scrollHeight <= desktop.clientHeight + 1, '1440px desktop composition fits without vertical scrolling');
    await capture('51-player-default-1440');
    await page.setViewportSize({ width: 1440, height: 680 });
    const short = await geometry();
    await titleSpacing();
    await capture('52-player-short');
    console.log('PLAYER GEOMETRY short', JSON.stringify(short));
    assert.ok(short.next.bottom <= short.height - 12 && short.transport.bottom <= short.height, 'Short desktop retains the transport, utilities and Up next in the viewport');
    assert.ok(short.scrollWidth <= short.width + 1, 'Short desktop has no horizontal overflow');
    console.log('PASS: 1440×900 and 1440×680 keep the listening controls together and visible.');
    await page.setViewportSize({ width: 440, height: 900 });
    assert.equal(await stage.evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length), 1, 'Narrow player stacks artwork and controls');
    assert.ok((await geometry()).scrollWidth <= 441, 'Narrow player has no horizontal overflow');
    await titleSpacing();
    await capture('53-player-narrow');
    await stage.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-ui="tsugi-audio-engine"]').paused);
    await stage.getByRole('button', { name: 'Play', exact: true }).click();
    await stage.getByRole('button', { name: 'Queue', exact: true }).click();
    const queue = stage.getByRole('region', { name: 'Playback queue', exact: true });
    await queue.waitFor();
    const queueBounds = await queue.boundingBox();
    assert.ok(queueBounds.x >= 0 && queueBounds.x + queueBounds.width <= 440 && queueBounds.y >= 36 && queueBounds.y + queueBounds.height <= 900, 'Narrow queue remains inside the viewport');
    await queue.getByRole('button', { name: 'Close queue', exact: true }).click();
    await stage.getByRole('button', { name: 'Lyrics', exact: true }).click();
    await stage.getByRole('button', { name: /An original line/ }).waitFor();
    for (const [width, height, name] of [[2048, 1124, '56-lyrics-title-desktop'], [1440, 680, '57-lyrics-title-short'], [440, 900, '58-lyrics-title-narrow']]) {
      await page.setViewportSize({ width, height });
      const ink = await titleSpacing('.oto-lyrics-track h2');
      const bounds = await stage.locator('.oto-lyrics-track').boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, 'Lyrics title stays inside the viewport');
      assert.ok(await expanded.evaluate(node => node.scrollWidth <= innerWidth + 1), 'Lyrics mode has no horizontal overflow');
      if (width > 760) assert.ok(bounds.y + bounds.height <= height, 'Desktop lyrics title and artist remain visible');
      await capture(name);
      console.log('LYRICS TITLE', width, height, JSON.stringify(ink));
    }
    await stage.getByRole('button', { name: /A second original line/ }).click();
    await page.waitForFunction(() => document.querySelector('[data-ui="tsugi-audio-engine"]').currentTime >= 12);
    await stage.getByRole('button', { name: 'Lyrics', exact: true }).click();
    await page.setViewportSize({ width: 2048, height: 1124 });
    await stage.getByRole('button', { name: 'Next track', exact: true }).click();
    await stage.getByRole('heading', { name: tracks[1].title, exact: true }).waitFor();
    const shortTitle = await titleSpacing();
    assert.equal(shortTitle.lines, 1, 'Short sans-serif title remains one line');
    await capture('54-player-single-line-title');
    await stage.getByRole('button', { name: 'Lyrics', exact: true }).click();
    await stage.getByRole('button', { name: /An original line/ }).waitFor();
    await titleSpacing('.oto-lyrics-track h2');
    await capture('59-lyrics-title-single-line');
    const lyricTitle = stage.locator('.oto-lyrics-track h2');
    // The normal heading must remain readable when title text changes.
    await lyricTitle.evaluate((node,title) => { node.firstChild.textContent = title; }, tracks[2].title);
    const translated = await titleSpacing('.oto-lyrics-track h2');
    assert.ok(translated.lines > 1, 'Long changed title wraps rather than overflowing');
    await lyricTitle.evaluate((node, title) => { node.firstChild.textContent = title; }, tracks[1].title);
    await titleSpacing('.oto-lyrics-track h2');
    await stage.getByRole('button', { name: 'Lyrics', exact: true }).click();
    await stage.getByRole('button', { name: 'Next track', exact: true }).click();
    await stage.getByRole('heading', { name: tracks[2].title, exact: true }).waitFor();
    const deepTitle = await titleSpacing();
    assert.ok(deepTitle.lines >= 2, 'Deep-descender fixture exercises multiple title lines');
    await capture('55-player-deep-descender-title');
    await stage.getByRole('button', { name: 'Lyrics', exact: true }).click();
    await stage.getByRole('button', { name: /An original line/ }).waitFor();
    await titleSpacing('.oto-lyrics-track h2');
    await capture('60-lyrics-title-deep-descender');
    await stage.getByRole('button', { name: 'Lyrics', exact: true }).click();
    console.log('PASS: lyrics title ink clears its source and artist on desktop, short and narrow windows; long and changed titles use the shared Interface font.');
    await expanded.getByRole('button', { name: 'Minimise player', exact: true }).click();
    await music.getByRole('region', { name: 'Music player', exact: true }).waitFor();
    assert.deepEqual(errors, [], 'Player layout changes raise no browser errors');
    console.log('PASS: narrow player scrolls safely; audio waveform, pause/play, queue, lyric seeking and minimise remain functional.');
  } catch (error) {
    await capture('player-layout-failure').catch(() => {});
    throw error;
  } finally { await page.close(); }
}
