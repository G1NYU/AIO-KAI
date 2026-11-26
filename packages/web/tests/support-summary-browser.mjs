// Real diagnostics UI with original, deliberately tainted metadata. The test
// captures the clipboard call; no logs, accounts or real clipboard are read.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

function installSupportSummaryFixture() {
  if (window.top !== window) return;
  localStorage.setItem('tsugi-onboarding-complete-v1', 'true');
  localStorage.setItem('tsugi-startup-area-v1', JSON.stringify('welcome'));
  const secret = 'SYNTHETIC_PRIVATE_SENTINEL';
  const host = window.aiostreamsApp;
  Object.assign(host, {
    version: `0.28.0-${secret}`, device: secret, deviceId: secret,
    token: secret, settings: { password: secret }, endpoint: `https://private.invalid/?token=${secret}`,
    nativeMusicAudio: false, youtubeMusic: true,
  });
  const fixture = window.__supportSummaryFixture = {
    messages: [], clipboard: [], mode: 'respond', bridge: host,
    info: {
      type: 'app-info', app: `0.28.0 ${secret}`, platform: `private-${secret}`,
      mpv: `mpv 0.40.0-rc.1 ${secret}`, ffmpeg: `ffmpeg version 7.1.1-${secret}`,
      logPath: `C:\\Users\\${secret}\\log.txt`, logs: secret, token: secret,
      server: `https://private.invalid/${secret}`, lastPlayed: secret,
    },
  };
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: async text => { fixture.clipboard.push(text); },
  } });
  const send = host.send.bind(host), subscribe = host.subscribe.bind(host), listeners = new Set();
  host.subscribe = listener => { listeners.add(listener); const remove = subscribe(listener); return () => { listeners.delete(listener); remove(); }; };
  host.send = message => {
    fixture.messages.push(message);
    if (message.type === 'app-info') {
      if (fixture.mode === 'respond') queueMicrotask(() => { for (const listener of listeners) listener(fixture.info); });
      return;
    }
    return send(message);
  };
}

export async function verifySupportSummaryBrowser({ browser, origin, installDesktopFixture, screenshotDir }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-GB', reducedMotion: 'reduce' });
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const summary = page.locator('[data-ui="support-summary"]');
  const preview = () => summary.getByRole('textbox', { name: 'Support summary preview', exact: true });
  const refresh = () => summary.getByRole('button', { name: 'Refresh support summary', exact: true });
  const frames = () => page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
  const messages = () => page.evaluate(() => window.__supportSummaryFixture.messages);
  const infoCalls = async () => (await messages()).filter(message => message.type === 'app-info');
  const assertPrivate = text => {
    for (const forbidden of ['SYNTHETIC_PRIVATE_SENTINEL', 'private.invalid', 'Users', 'logPath', 'lastPlayed', 'deviceId', 'token', 'password', 'settings']) {
      assert.equal(text.includes(forbidden), false, `support summary excludes ${forbidden}`);
    }
    assert.ok(text.length < 2000, 'the allowlisted report remains bounded');
  };
  const copy = async text => {
    const before = await page.evaluate(() => window.__supportSummaryFixture.clipboard.length);
    await summary.getByRole('button', { name: 'Copy support summary', exact: true }).focus();
    await page.keyboard.press('Enter');
    await summary.getByText('Support summary copied.', { exact: true }).waitFor();
    const copied = await page.evaluate(() => window.__supportSummaryFixture.clipboard);
    assert.equal(copied.length, before + 1);
    assert.equal(copied.at(-1), text, 'only the exact visible preview is passed to the project clipboard helper');
  };
  try {
    await page.addInitScript({ content: `(${installDesktopFixture.toString()})();(${installSupportSummaryFixture.toString()})();` });
    await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    const landing = page.locator('[data-page="desktop-landing"]');
    await landing.getByRole('button', { name: 'App settings', exact: true }).waitFor(); await frames();
    const beforeOpen = (await infoCalls()).length;
    assert.equal(beforeOpen, 0, 'startup never requests native version details for the support summary');
    await landing.getByRole('button', { name: 'App settings', exact: true }).click();
    await summary.getByRole('button', { name: 'Create support summary', exact: true }).waitFor(); await frames();
    assert.equal((await infoCalls()).length, beforeOpen, 'opening App settings never creates a support summary');
    assert.equal(await preview().count(), 0);
    assert.equal(await summary.getByRole('button', { name: 'Copy support summary', exact: true }).count(), 0);
    const beforeCreate = (await messages()).length;
    await summary.getByRole('button', { name: 'Create support summary', exact: true }).focus();
    await page.keyboard.press('Enter');
    await preview().waitFor(); await frames();
    assert.deepEqual((await messages()).slice(beforeCreate), [{ type: 'app-info' }], 'explicit creation asks only for native version metadata');
    const first = await preview().inputValue(), firstData = JSON.parse(first);
    assertPrivate(first);
    assert.equal(await preview().evaluate(element => element.readOnly), true);
    assert.deepEqual(Object.keys(firstData), ['format', 'version', 'web', 'native', 'capabilities']);
    assert.deepEqual(firstData.native, {
      present: true, platform: 'windows', bridgeProtocol: 2, bridgeVersion: '0.28.0',
      details: 'available', appVersion: '0.28.0', mpvVersion: '0.40.0-rc.1', ffmpegVersion: '7.1.1',
    });
    assert.equal(firstData.capabilities.nativeMusic, 'unavailable');
    assert.equal(firstData.capabilities.youtubeCatalogue, 'available');
    await copy(first);

    await page.evaluate(() => { const fixture = window.__supportSummaryFixture; fixture.info.app = '0.29.1-rc.2'; fixture.info.mpv = null; fixture.info.ffmpeg = 'unknown-private-value'; });
    const beforeRefresh = (await infoCalls()).length;
    await refresh().click(); await preview().waitFor(); await frames();
    const updated = await preview().inputValue(), updatedData = JSON.parse(updated);
    assert.equal((await infoCalls()).length, beforeRefresh + 1);
    assertPrivate(updated);
    assert.equal(updatedData.native.appVersion, '0.29.1-rc.2');
    assert.equal(updatedData.native.mpvVersion, null);
    assert.equal(updatedData.native.ffmpegVersion, null);
    assert.notEqual(updated, first, 'refresh replaces the prior snapshot');
    await copy(updated);

    await page.evaluate(() => { window.__supportSummaryFixture.mode = 'no-response'; });
    await refresh().click();
    await summary.getByText('Reading native version details…', { exact: true }).waitFor();
    assert.equal(await preview().count(), 0, 'refresh clears stale versions while waiting');
    assert.equal(await summary.getByRole('button', { name: 'Copy support summary', exact: true }).count(), 0);
    await summary.getByText('Native version details did not respond. Available build and capability fields are still included.', { exact: true }).waitFor();
    const failed = await preview().inputValue(), failedData = JSON.parse(failed);
    assertPrivate(failed);
    assert.equal(failedData.native.details, 'failed');
    assert.equal(failedData.native.appVersion, null);
    assert.equal(failedData.native.mpvVersion, null);
    assert.equal(failedData.native.ffmpegVersion, null);
    await copy(failed);

    const beforeUnavailable = (await infoCalls()).length;
    await page.evaluate(() => { window.aiostreamsApp = undefined; });
    await refresh().click();
    await summary.getByText('Native engine details are unavailable in this environment.', { exact: true }).waitFor();
    const unavailable = await preview().inputValue(), unavailableData = JSON.parse(unavailable);
    assertPrivate(unavailable);
    assert.equal(unavailableData.native.present, false);
    assert.equal(unavailableData.native.details, 'unavailable');
    assert.equal(unavailableData.native.bridgeVersion, null);
    assert.equal(unavailableData.native.appVersion, null);
    assert.ok(Object.values(unavailableData.capabilities).every(value => value === 'not-reported'));
    assert.equal((await infoCalls()).length, beforeUnavailable, 'missing bridge does not send a native request');
    await copy(unavailable);
    await page.evaluate(() => { window.aiostreamsApp = window.__supportSummaryFixture.bridge; });
    const forbidden = (await messages()).filter(message => ['diagnostics', 'download-list', 'open-logs', 'crash-report'].includes(message.type));
    assert.deepEqual(forbidden, [], 'the support-summary flow never collects logs, downloads or crash contents');
    await summary.scrollIntoViewIfNeeded();
    if (screenshotDir) { await mkdir(screenshotDir, { recursive: true }); await page.screenshot({ path: join(screenshotDir, 'support-summary-wide.png'), animations: 'disabled' }); }
    await page.setViewportSize({ width: 440, height: 1000 }); await summary.scrollIntoViewIfNeeded(); await frames();
    assert.equal(await summary.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, 'the report fits its narrow settings panel');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    if (screenshotDir) await page.screenshot({ path: join(screenshotDir, 'support-summary-narrow.png'), animations: 'disabled' });
    assert.deepEqual(errors, []);
    console.log('PASS: explicit safe support summary, tainted-field exclusion, exact preview copy, refreshed versions, timeout/unavailable recovery, keyboard actions and narrow layout.');
  } finally { await page.close(); }
}
