// Real settings/media lifecycle; deterministic local bridge, no Discord account.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

function installPresenceFixture() {
  if (window.top !== window) return;
  localStorage.setItem('tsugi-onboarding-complete-v1', 'true');
  localStorage.setItem('tsugi-startup-area-v1', JSON.stringify('welcome'));
  localStorage.setItem('aiostreams-web-app-discord-playing', 'true');
  const host = window.aiostreamsApp, send = host.send.bind(host), subscribe = host.subscribe.bind(host);
  const fixture = window.__presenceFixture = { messages: [], rejectSave: false };
  const listeners = new Set();
  host.subscribe = listener => { listeners.add(listener); const stop = subscribe(listener); return () => { listeners.delete(listener); stop(); }; };
  host.send = message => {
    if (['discord-configure', 'discord-check', 'presence', 'now-playing'].includes(message.type)) fixture.messages.push(message);
    if (message.type === 'discord-check') {
      queueMicrotask(() => { for (const listener of listeners) listener({ type: 'discord-status', state: 'not-found', message: null }); });
      return;
    }
    return send(message);
  };
  const original = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (fixture.rejectSave && key === 'tsugi-discord-presence-v1') throw new DOMException('Fixture quota', 'QuotaExceededError');
    return original.call(this, key, value);
  };
}

export async function verifyDiscordPresenceBrowser({ browser, origin, installDesktopFixture, screenshotDir }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-GB', reducedMotion: 'reduce' });
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const settings = page.locator('[data-ui="discord-presence-settings"]');
  const dialog = page.getByRole('dialog', { name: 'App settings', exact: true });
  const frames = () => page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
  const messages = () => page.evaluate(() => window.__presenceFixture.messages);
  const latest = type => page.evaluate(type => window.__presenceFixture.messages.filter(message => message.type === type).at(-1), type);
  const waitMedia = media => page.waitForFunction(media => window.__presenceFixture.messages.filter(message => message.type === 'presence').at(-1)?.presence?.media === media, media);
  const openSettings = async scope => { await scope.getByRole('button', { name: 'App settings', exact: true }).click(); await settings.waitFor(); };
  try {
    await page.addInitScript({ content: `(${installDesktopFixture.toString()})();(${installPresenceFixture.toString()})();` });
    await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAYCAIAAAB8wupbAAAAHUlEQVR4nGOsqF3FQApgIkn1qIZRDaMaRjWQrAEA4jkBz8UryC4AAAAASUVORK5CYII=', 'base64');
    await page.route('**/__tsugi_read/page/*', route => route.fulfill({ contentType: 'image/png', body: png }));
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    const landing = page.locator('[data-page="desktop-landing"]');
    await openSettings(landing); await frames();
    assert.equal((await latest('discord-configure')).config.enabled, false);
    assert.equal((await messages()).some(message => message.type === 'discord-check'), false);
    assert.equal((await latest('discord-configure')).config.applicationId, '1575822403211362365');
    assert.equal(await settings.getByRole('checkbox', { name: 'Enable Rich Presence', exact: true }).isEnabled(), true);
    assert.equal(await settings.getByRole('checkbox', { name: 'Enable Rich Presence', exact: true }).isChecked(), false);
    await settings.getByText('Discord application setup', { exact: true }).click();
    assert.equal(await settings.getByRole('textbox', { name: 'Application ID', exact: true }).inputValue(), '1575822403211362365');
    await settings.getByRole('textbox', { name: 'Application ID', exact: true }).fill('123');
    assert.equal(await settings.getByRole('button', { name: 'Save application ID', exact: true }).isEnabled(), false);
    await settings.getByRole('textbox', { name: 'Application ID', exact: true }).fill('123456789012345678');
    await settings.getByRole('button', { name: 'Save application ID', exact: true }).click();
    assert.equal((await latest('discord-configure')).config.enabled, false);
    await settings.getByRole('checkbox', { name: 'Enable Rich Presence', exact: true }).check();
    await settings.getByRole('button', { name: 'Check connection', exact: true }).click();
    await settings.getByText('The Discord desktop app is not running.', { exact: true }).waitFor();
    await settings.getByRole('checkbox', { name: 'Private mode', exact: true }).check();
    assert.equal((await latest('discord-configure')).config.privateMode, true);
    assert.equal((await latest('presence')).presence, null);
    await settings.getByRole('checkbox', { name: 'Private mode', exact: true }).uncheck();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await landing.getByRole('button', { name: /Music/ }).first().click();
    const music = page.locator('[data-page="music"]');
    await music.waitFor({ state: 'visible' });
    const sources = music.getByRole('dialog', { name: 'Music sources' });
    if (await sources.isVisible()) await sources.getByRole('button', { name: 'Close', exact: true }).click();
    await music.getByRole('navigation', { name: 'Music sections' }).getByRole('button', { name: 'Library', exact: true }).click();
    await music.getByRole('navigation', { name: 'Music collection' }).getByRole('button', { name: /Local music/ }).click();
    const samples = 8000 * 60, wav = Buffer.alloc(44 + samples * 2);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
    for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(1000 * Math.sin(2 * Math.PI * 220 * i / 8000)), 44 + i * 2);
    await music.locator('input[aria-label="Open local audio"]').setInputFiles({ name: 'Presence audio fixture.wav', mimeType: 'audio/wav', buffer: wav });
    await music.getByRole('button', { name: /Presence audio fixture/ }).click();
    await page.waitForFunction(() => { const audio = document.querySelector('[data-ui="tsugi-audio-engine"]'); return audio && !audio.paused && audio.currentTime > 0.1; });
    await waitMedia('music');
    const song = (await latest('presence')).presence;
    assert.equal(song.title, 'Presence audio fixture');
    assert.equal(song.imdb, null); assert.equal(song.paused, false); assert.equal(song.duration, 60000);
    assert.deepEqual(Object.keys(song).sort(), ['media','title','subtitle','imdb','position','duration','paused','browsing'].sort());
    await music.getByRole('button', { name: 'Read', exact: true }).click();
    const read = page.locator('[data-page="read"]');
    await read.getByRole('button', { name: /Tsugi Original Fixture/ }).first().click();
    await read.getByRole('button', { name: /Start or resume reading/ }).click();
    const reader = page.locator('.tsugi-chapter-reader');
    await reader.waitFor(); await waitMedia('manga');
    assert.match((await latest('presence')).presence.subtitle, /Reading.*Page/);
    await reader.getByRole('button', { name: 'Music', exact: true }).click();
    await music.waitFor({ state: 'visible' }); await waitMedia('music');
    await openSettings(music);
    await settings.getByRole('checkbox', { name: 'Music', exact: true }).uncheck(); await frames();
    assert.equal((await latest('presence')).presence, null);
    await settings.getByRole('checkbox', { name: 'Music', exact: true }).check(); await waitMedia('music');
    await settings.getByRole('button', { name: 'Clear and pause sharing', exact: true }).click();
    assert.equal((await latest('presence')).presence, null);
    assert.equal((await latest('discord-configure')).config.privateMode, true);
    if (screenshotDir) { await mkdir(screenshotDir, { recursive: true }); await page.screenshot({ path: join(screenshotDir, 'discord-presence-settings.png'), animations: 'disabled' }); }
    await page.evaluate(() => { window.__presenceFixture.rejectSave = true; });
    await settings.getByRole('checkbox', { name: 'Private mode', exact: true }).click();
    await settings.getByRole('alert').filter({ hasText: 'Could not save this setting.' }).waitFor();
    assert.equal((await latest('discord-configure')).config.enabled, false);
    assert.equal((await latest('presence')).presence, null);
    await page.evaluate(() => { window.__presenceFixture.rejectSave = false; });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openSettings(page.locator('[data-page="desktop-landing"]'));
    assert.equal(await settings.getByRole('checkbox', { name: 'Private mode', exact: true }).isChecked(), true);
    assert.equal((await latest('presence')).presence, null);
    assert.deepEqual(errors, []);
    console.log('PASS: Discord opt-in, application setup, local status, real music and manga priority, hidden Reader clearing, per-media controls, privacy, restart and failed preference writes.');
  } finally { await page.close(); }
}
