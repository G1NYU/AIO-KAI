// Shared ReaderSettings behavior in the global and live chapter contexts.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { assertUnframedGroups } from './shared-layout-browser.mjs';

function installReaderSettingsSearchFixture() {
  if (window.top !== window) return;
  localStorage.setItem('tsugi-onboarding-complete-v1', 'true');
  localStorage.setItem('tsugi-startup-area-v1', JSON.stringify('read'));
  window.__readerFixture.titleSettingsFixture = true;
  if (localStorage.getItem('tsugi-reader-preferences') === null) localStorage.setItem('tsugi-reader-preferences', JSON.stringify({
    mode: 'single', width: 65, gap: true, rtl: false, fit: 'height',
    background: 'graphite', focus: false, autoNext: false, wheelZoom: true, resume: true,
  }));
  const fixture = window.__readerSettingsSearchFixture = { writes: 0 };
  const set = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (this === localStorage && key === 'tsugi-reader-preferences') fixture.writes++;
    return set.call(this, key, value);
  };
}

export async function verifyReaderSettingsSearchBrowser({ browser, origin, installDesktopFixture, screenshotDir }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-GB', reducedMotion: 'reduce' });
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const read = page.locator('[data-page="read"]');
  const rail = read.locator('.tsugi-reading-rail');
  const reader = page.locator('.tsugi-chapter-reader');
  const settings = page.locator('[data-ui="reader-settings"]');
  const search = () => settings.getByRole('searchbox', { name: 'Search reader settings', exact: true });
  const frames = () => page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
  const groups = async () => { await frames(); return settings.locator('[data-reader-setting]').evaluateAll(rows => rows.map(row => row.dataset.readerSetting)); };
  const preferences = () => page.evaluate(() => JSON.parse(localStorage.getItem('tsugi-reader-preferences')));
  const writes = () => page.evaluate(() => window.__readerSettingsSearchFixture.writes);
  const providerCalls = () => page.evaluate(() => window.__readerFixture.requests.filter(action => ['manga', 'catalogue', 'source-preferences', 'source-inventory', 'chapter'].includes(action.kind)));
  const section = name => settings.getByRole('navigation', { name: 'Reader settings sections', exact: true }).getByRole('button', { name, exact: true });
  const clear = async () => { await settings.getByRole('button', { name: 'Clear settings search', exact: true }).click(); await frames(); };
  const surfaces = async () => {
    assert.deepEqual(await groups(), ['size', 'wheel']);
    // The maintainer requires unboxed settings labels. Preserve the actual
    // checkbox, temporary hover/focus feedback, and all persistence checks.
    await assertUnframedGroups(settings.locator('.tsugi-reader-setting-group[data-reader-setting]'), 'Reader settings content groups');
    const borders = await settings.locator('[data-reader-setting]').evaluateAll(rows => rows.map(row => {
      const style = getComputedStyle(row);
      return [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth];
    }));
    assert.ok(borders.every(widths => widths.every(width => width === '0px')), 'settings groups and toggle rows have no separator rules');
    const toggle = settings.locator('label.tsugi-reader-setting-toggle[data-reader-setting="wheel"]');
    assert.equal(await toggle.getByRole('checkbox').count(), 1, 'the retained surface belongs to a single interactive setting');
    await page.mouse.move(1, 1);
    await search().focus();
    await frames();
    assert.ok(['transparent', 'rgba(0, 0, 0, 0)'].includes(await toggle.evaluate(node => getComputedStyle(node).backgroundColor)), 'the resting toggle label has no decorative row band');
    const categorySurfaces = await settings.locator('.tsugi-read-subnav > button').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor));
    assert.ok(categorySurfaces.length > 0 && categorySurfaces.every(color => ['transparent', 'rgba(0, 0, 0, 0)'].includes(color)), 'Reader settings categories have no boxed labels');
  };
  try {
    await page.addInitScript({ content: `(${installDesktopFixture.toString()})();(${installReaderSettingsSearchFixture.toString()})();` });
    await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAYCAIAAAB8wupbAAAAHUlEQVR4nGOsqF3FQApgIkn1qIZRDaMaRjWQrAEA4jkBz8UryC4AAAAASUVORK5CYII=', 'base64');
    await page.route('**/__tsugi_read/page/*', route => route.fulfill({ contentType: 'image/png', body: png }));
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await rail.getByRole('button', { name: 'Settings', exact: true }).click();
    await read.getByRole('button', { name: /Reader Set the default reading layout/ }).click();
    await settings.waitFor();
    await section('Appearance').click();
    const original = await preferences(), originalWrites = await writes(), originalCalls = await providerCalls();
    await search().fill('  ZOOM  ');
    assert.deepEqual(await groups(), ['size', 'wheel'], 'search matches Pages and Controls together');
    assert.equal(await settings.getByRole('slider', { name: 'Page width', exact: true }).inputValue(), '65');
    await search().fill('last saved');
    assert.deepEqual(await groups(), ['resume'], 'localized help text is searchable');
    await search().fill('appearance');
    assert.deepEqual(await groups(), ['background', 'focus'], 'translated section names find their settings');
    await search().fill('no-such-reader-setting');
    await settings.getByRole('status').getByText('No reader settings match this search.', { exact: true }).waitFor();
    assert.deepEqual(await groups(), []);
    await page.keyboard.press('Escape');
    assert.equal(await search().inputValue(), '');
    assert.equal(await section('Appearance').getAttribute('aria-current'), 'page');
    assert.deepEqual(await groups(), ['background', 'focus', 'reset']);
    assert.equal(await search().evaluate(element => document.activeElement === element), true);
    assert.deepEqual(await preferences(), original);
    assert.equal(await writes(), originalWrites, 'typing, clearing and no-results do not write preferences');
    assert.deepEqual(await providerCalls(), originalCalls, 'global settings search performs no provider requests');

    await search().fill('gap');
    assert.deepEqual(await groups(), ['spacing']);
    await settings.getByRole('checkbox', { name: /Page spacing/ }).uncheck();
    await clear();
    assert.deepEqual(await preferences(), { ...original, gap: false }, 'a matching control changes only its own setting');
    assert.equal(await section('Appearance').getAttribute('aria-current'), 'page');
    await search().fill('zoom');
    await surfaces();
    const wheelRow = settings.locator('label[data-reader-setting="wheel"]');
    const wheel = wheelRow.getByRole('checkbox');
    await page.mouse.move(1430, 5);
    const restingTone = await wheelRow.evaluate(node => getComputedStyle(node).backgroundColor);
    await wheelRow.hover();
    assert.notEqual(await wheelRow.evaluate(node => getComputedStyle(node).backgroundColor), restingTone, 'hover identifies the clickable setting row');
    await wheel.focus(); await page.mouse.move(1430, 5);
    assert.notEqual(await wheelRow.evaluate(node => getComputedStyle(node).backgroundColor), restingTone, 'keyboard focus keeps the setting row distinguishable');
    const beforeWheel = await preferences(), beforeWheelWrites = await writes();
    await page.keyboard.press('Space');
    assert.equal(await wheel.isChecked(), false);
    assert.deepEqual(await preferences(), { ...beforeWheel, wheelZoom: false }, 'keyboard activation changes only wheel zoom');
    await page.keyboard.press('Space');
    assert.equal(await wheel.isChecked(), true);
    assert.deepEqual(await preferences(), beforeWheel);
    assert.equal(await writes(), beforeWheelWrites + 2);
    assert.deepEqual(await providerCalls(), originalCalls, 'toggle interaction does not contact providers');
    await search().focus();
    if (screenshotDir) { await mkdir(screenshotDir, { recursive: true }); await page.screenshot({ path: join(screenshotDir, 'reader-settings-search-global.png'), animations: 'disabled' }); }
    await page.setViewportSize({ width: 440, height: 1000 }); await frames();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'global settings search fits a narrow window');
    if (screenshotDir) await page.screenshot({ path: join(screenshotDir, 'reader-settings-search-narrow.png'), animations: 'disabled' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await rail.getByRole('button', { name: 'Library', exact: true }).click();
    await read.locator('.tsugi-manga-card').filter({ hasText: 'Tsugi Original Fixture' }).click();
    await read.getByRole('button', { name: /Start or resume reading/ }).click();
    await reader.waitFor();
    await reader.locator('[data-reader-page="0"] img').waitFor();
    await reader.getByRole('button', { name: 'Reader settings', exact: true }).click();
    await search().waitFor();
    assert.equal(await search().inputValue(), '', 'search text is session-only and not carried into a new settings instance');
    await section('Controls').click(); await frames();
    const chapterPreferences = await preferences(), chapterWrites = await writes(), chapterCalls = await providerCalls();
    await search().fill('f'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('s');
    assert.equal(await settings.isVisible(), true, 'typing shortcut keys in search does not close the panel');
    assert.equal(await reader.locator('[data-reader-page="0"]').count(), 1, 'arrow keys in search do not turn the page');
    await search().fill('no-such-reader-setting');
    await page.keyboard.press('Escape'); await frames();
    assert.equal(await settings.isVisible(), true, 'Escape clears the search before the chapter panel handles it');
    assert.equal(await section('Controls').getAttribute('aria-current'), 'page');
    assert.deepEqual(await groups(), ['resume', 'continuous', 'wheel', 'shortcuts', 'reset']);
    assert.deepEqual(await preferences(), chapterPreferences);
    assert.equal(await writes(), chapterWrites);
    assert.deepEqual(await providerCalls(), chapterCalls);

    await search().fill('paper');
    assert.deepEqual(await groups(), ['background']);
    await settings.getByRole('button', { name: 'Paper', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.tsugi-chapter-reader')?.getAttribute('data-background') === 'paper');
    assert.deepEqual(await preferences(), { ...chapterPreferences, background: 'paper' });
    await clear();
    assert.equal(await section('Controls').getAttribute('aria-current'), 'page');
    await search().fill('zoom');
    await surfaces();
    if (screenshotDir) await page.screenshot({ path: join(screenshotDir, 'reader-settings-search-chapter.png'), animations: 'disabled' });
    await search().focus(); await page.keyboard.press('Escape');
    assert.equal(await settings.isVisible(), true);
    await page.keyboard.press('Escape');
    await settings.waitFor({ state: 'hidden' });
    assert.equal(await reader.isVisible(), true, 'the next Escape retains the existing close-settings behavior');

    // A source+title hash, not a database row ID, scopes a complete snapshot.
    const global = await preferences(), globalWrites = await writes();
    const key = 'tsugi-title-reader-preferences-v1';
    const scope = () => settings.getByRole('checkbox', { name: 'Use settings for this title', exact: true });
    const openSettings = async () => {
      await reader.getByRole('button',{name:'Reader settings',exact:true}).click();
      await settings.waitFor();
    };
    const closeReader = async () => {
      await reader.getByRole('button',{name:'Chapters',exact:true}).click();
      await reader.waitFor({state:'hidden'});
    };
    const titleStore = () => page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);
    await openSettings();
    await scope().check();
    await page.waitForFunction(()=>document.querySelector('.tsugi-chapter-reader')?.dataset.preferenceScope==='title');
    await section('Pages').click();
    await settings.getByRole('button',{name:'Spread Two pages',exact:true}).click();
    await section('Controls').click();
    await settings.getByRole('checkbox',{name:/Resume reading/}).uncheck();
    await page.waitForFunction(()=>document.querySelector('.tsugi-chapter-reader')?.dataset.mode==='spread');
    assert.deepEqual(await preferences(),global);
    assert.equal(await writes(),globalWrites);
    assert.deepEqual(await titleStore(),{version:1,titles:[{identity:'1'.padStart(64,'0'),preferences:{...global,mode:'spread',resume:false}}]});
    await closeReader();

    // A real page reload and another title must not inherit the first override.
    await page.reload({waitUntil:'domcontentloaded'});
    await rail.getByRole('button',{name:'Library',exact:true}).click();
    await read.locator('.tsugi-manga-card').filter({hasText:'Second reader fixture'}).click();
    await read.getByRole('button',{name:'Start or resume reading',exact:true}).click();
    await reader.waitFor();
    assert.equal(await reader.getAttribute('data-preference-scope'),'global');
    assert.equal(await reader.getAttribute('data-mode'),global.mode);
    await closeReader();

    // History opens through an async cached details lookup. It must apply the
    // selected title's resume policy rather than a previous React render.
    await rail.getByRole('button',{name:'History',exact:true}).click();
    const history=read.locator('.tsugi-reader-activity-row').filter({hasText:'Tsugi Original Fixture'});
    await history.click();
    await reader.waitFor();
    assert.equal(await reader.getAttribute('data-preference-scope'),'title');
    assert.equal(await reader.getAttribute('data-mode'),'spread');
    assert.equal(await reader.getByRole('slider',{name:'Jump to page',exact:true}).inputValue(),'0');
    await openSettings();
    assert.equal(await scope().isChecked(),true);
    await settings.getByRole('button',{name:'Reset to global settings',exact:true}).click();
    assert.equal(await scope().isChecked(),false);
    assert.equal(await titleStore(),null);
    assert.deepEqual(await preferences(),global);
    await closeReader();
    await rail.getByRole('button',{name:'History',exact:true}).click();
    await history.click();
    await reader.waitFor();
    assert.equal(await reader.getAttribute('data-preference-scope'),'global');
    assert.equal(await reader.getByRole('slider',{name:'Jump to page',exact:true}).inputValue(),'2');
    console.log('PASS: title-scoped reader settings persist across reload, isolate titles, use the History target resume policy and reset to global without global writes.');
    assert.deepEqual(errors, []);
    console.log('PASS: localized Reader settings search across groups, hint matching, preserved values/tabs, keyboard clear/no-results, tonal layout and live chapter editing without provider requests.');
  } finally { await page.close(); }
}
