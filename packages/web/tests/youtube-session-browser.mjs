// Real Music settings UI with an in-process native-session fixture. No browser
// profile, provider cookie, live account, or external YouTube request is used.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

function installYouTubeSessionFixture() {
  if (window.top !== window) return;
  localStorage.setItem('tsugi-onboarding-complete-v1', 'true');
  localStorage.setItem('tsugi-startup-area-v1', JSON.stringify('music'));
  const fixture = window.__youtubeSessionFixture = { mode: 'anonymous', requests: [], failNext: false };
  const host = window.aiostreamsApp, listeners = new Set();
  const send = host.send.bind(host), subscribe = host.subscribe.bind(host);
  host.subscribe = listener => {
    listeners.add(listener);
    const remove = subscribe(listener);
    return () => { listeners.delete(listener); remove(); };
  };
  host.send = message => {
    if (message.type !== 'youtube-music-request' || message.operation !== 'session') return send(message);
    fixture.requests.push({ operation: message.operation, value: message.value });
    let error = null;
    if (fixture.failNext) { error = 'Fixture native session unavailable'; fixture.failNext = false; }
    else if (message.value === 'anonymous' || message.value === 'firefox') fixture.mode = message.value;
    else if (message.value !== 'status') throw Error('Unexpected native session choice');
    queueMicrotask(() => { for (const listener of listeners) listener({ type: 'youtube-music-result', request: message.request, error,
      data: error ? null : { mode: fixture.mode, cookie: 'SYNTHETIC_PRIVATE_SENTINEL' } }); });
  };
}

export async function verifyYouTubeSessionBrowser({ browser, origin, installDesktopFixture, screenshotDir }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-GB', reducedMotion: 'reduce' });
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript({ content: `(${installDesktopFixture.toString()})();(${installYouTubeSessionFixture.toString()})();` });
    await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    const music = page.locator('[data-page="music"]');
    await music.waitFor();
    const requests = () => page.evaluate(() => window.__youtubeSessionFixture.requests);
    assert.deepEqual(await requests(), [], 'opening Music never reads a browser session');
    const settings = music.getByRole('dialog', { name: 'Music sources', exact: true });
    const open = async () => {
      await music.getByRole('button', { name: 'Music sources', exact: true }).click();
      await settings.getByRole('heading', { name: 'YouTube session', exact: true }).waitFor();
    };
    const anonymous = () => settings.getByText('Anonymous access. No browser session is used.', { exact: true });
    const selected = () => settings.getByText('Firefox session selected for this app session.', { exact: true });
    const useFirefox = () => settings.getByRole('button', { name: 'Use Firefox for this session', exact: true });
    const stopFirefox = () => settings.getByRole('button', { name: 'Stop using Firefox session', exact: true });

    await open();
    await anonymous().waitFor();
    assert.ok((await requests()).length > 0);
    assert.ok((await requests()).every(request => request.operation === 'session' && request.value === 'status'), 'opening settings asks only for the native mode, including React development remounts');
    assert.equal(await settings.getByRole('link', { name: 'Open YouTube', exact: true }).getAttribute('href'), 'https://www.youtube.com/');
    await useFirefox().focus(); await page.keyboard.press('Enter');
    await selected().waitFor();
    assert.equal((await requests()).at(-1).value, 'firefox');
    assert.equal((await requests()).filter(request => request.value !== 'status').length, 1);
    assert.equal((await settings.innerText()).includes('SYNTHETIC_PRIVATE_SENTINEL'), false);
    await settings.getByRole('button', { name: 'Close', exact: true }).click();
    await open(); await selected().waitFor();
    assert.equal((await requests()).at(-1).value, 'status', 'reopening reads the native choice without re-enabling access');

    await page.evaluate(() => { window.__youtubeSessionFixture.failNext = true; });
    await stopFirefox().click();
    await settings.getByRole('alert').getByText('Could not change the YouTube session. Check its status before retrying playback.', { exact: true }).waitFor();
    await selected().waitFor();
    await settings.getByRole('button', { name: 'Check session again', exact: true }).click();
    await selected().waitFor();
    assert.equal(await settings.getByRole('alert').count(), 0);
    await stopFirefox().click(); await anonymous().waitFor();

    await page.setViewportSize({ width: 390, height: 844 });
    await useFirefox().scrollIntoViewIfNeeded();
    assert.equal(await settings.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, 'the session controls fit the narrow sources sheet');
    if (screenshotDir) {
      await mkdir(screenshotDir, { recursive: true });
      await page.screenshot({ path: join(screenshotDir, 'youtube-session-mobile.png'), animations: 'disabled' });
    }
    await useFirefox().click(); await selected().waitFor();
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
    assert.equal(/firefox|SYNTHETIC_PRIVATE_SENTINEL|youtube.session/i.test(stored), false, 'native session selection and private reply fields are not persisted in browser storage');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await music.waitFor(); await open(); await anonymous().waitFor();
    assert.ok((await requests()).length > 0);
    assert.ok((await requests()).every(request => request.value === 'status'), 'a fresh native-process fixture defaults to anonymous even with prior app storage');
    assert.deepEqual(errors, []);
    console.log('PASS: YouTube session requires explicit opt-in, supports revoke/recheck, excludes private replies from storage, and fits narrow screens');
  } finally { await page.close(); }
}
