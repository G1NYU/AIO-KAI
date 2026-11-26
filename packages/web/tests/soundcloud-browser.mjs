// Real Music UI, synthetic native SoundCloud replies. No real provider calls or accounts.
import assert from 'node:assert/strict';

function installSoundCloudFixture() {
  if (window.top !== window) return;
  localStorage.setItem('tsugi-onboarding-complete-v1', 'true');
  localStorage.setItem('tsugi-startup-area-v1', JSON.stringify('music'));
  const host = window.aiostreamsApp;
  host.soundcloudMusic = true;
  const fixture = window.__soundcloudFixture = { requests: [], current: null };
  const listeners = new Set();
  const send = host.send.bind(host), subscribe = host.subscribe.bind(host);
  host.subscribe = listener => {
    listeners.add(listener);
    const remove = subscribe(listener);
    return () => { listeners.delete(listener); remove(); };
  };
  fixture.reply = (request, tracks, complete, error = null) => {
    for (const listener of listeners) listener({ type: 'soundcloud-search-result', request, tracks, complete, error });
  };
  host.send = message => {
    if (message.type !== 'soundcloud-search' && message.type !== 'soundcloud-cancel') return send(message);
    fixture.requests.push(message);
    if (message.type === 'soundcloud-search') {
      fixture.current = message.request;
      queueMicrotask(() => fixture.reply(message.request, [{ id: '123456789', title: 'SoundCloud fixture track', artist: 'Fixture artist', duration: 180 }], false));
    }
  };
}

export async function verifySoundCloudBrowser({ browser, origin, installDesktopFixture }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-GB', reducedMotion: 'reduce' });
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript({ content: '(' + installDesktopFixture.toString() + ')();(' + installSoundCloudFixture.toString() + ')();' });
    await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    const music = page.locator('[data-page="music"]');
    await music.getByRole('button', { name: 'Music sources', exact: true }).click();
    await music.getByRole('button', { name: 'Connect SoundCloud', exact: true }).click();
    const search = music.getByRole('textbox', { name: 'Search music' });
    await search.fill('fixture');
    await music.locator('form').filter({ has: search }).getByRole('button', { name: 'Search', exact: true }).click();
    const first = music.locator('[data-ui="music-track-row"]').filter({ hasText: 'SoundCloud fixture track' });
    await first.waitFor();
    const cancel = music.getByRole('button', { name: 'Cancel search', exact: true });
    await cancel.waitFor();
    const old = await page.evaluate(() => window.__soundcloudFixture.current);
    await cancel.click();
    await page.waitForFunction(id => window.__soundcloudFixture.requests.some(m => m.type === 'soundcloud-cancel' && m.request === id), old);
    await page.evaluate(id => window.__soundcloudFixture.reply(id, [{ id: '888', title: 'Stale search result', artist: 'Fixture' }], true), old);
    assert.equal(await music.getByText('Stale search result', { exact: true }).count(), 0);
    await search.fill('fixture second');
    await music.locator('form').filter({ has: search }).getByRole('button', { name: 'Search', exact: true }).click();
    await page.waitForFunction(id => window.__soundcloudFixture.current !== id, old);
    await first.waitFor();
    await page.evaluate(() => window.__soundcloudFixture.reply(window.__soundcloudFixture.current, [{ id: '456', title: 'Second public track', artist: 'Fixture' }], true));
    await music.getByText('Second public track', { exact: true }).waitFor();
    await cancel.waitFor({ state: 'hidden' });
    await first.click();
    await page.waitForFunction(() => window.__readerFixture.nativeMessages.some(m => m.type === 'music-audio-load' && m.url === 'https://api.soundcloud.com/tracks/123456789'));
    assert.equal(await music.getByRole('button', { name: 'Download track', exact: true }).count(), 0, 'SoundCloud does not enter the YouTube-only export path');
    assert.deepEqual(errors, []);
    console.log('PASS: native SoundCloud source, incremental results, cancellation, stale reply refusal, public target and export isolation.');
  } finally { await page.close(); }
}
