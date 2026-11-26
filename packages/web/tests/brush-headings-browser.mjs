// Real Read/Books screens with original titles and an authored PDF fixture.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pdfFixture } from './ebook-fixtures.mjs';

export async function assertBrushHeadingSpacing(page, selector, { labelGap = 12, followingGap = 6 } = {}) {
  await page.locator(selector).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(selector => {
    const title = document.querySelector(selector);
    if (!title) return false;
    const style = getComputedStyle(title), context = document.createElement('canvas').getContext('2d');
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const ink = context.measureText(title.textContent);
    return parseFloat(style.lineHeight) - ink.actualBoundingBoxAscent - ink.actualBoundingBoxDescent >= parseFloat(style.fontSize) * .07;
  }, selector);
  const ink = await page.locator(selector).evaluate(node => {
    const style = getComputedStyle(node), range = document.createRange();
    range.selectNodeContents(node);
    const lines = [...range.getClientRects()];
    const context = document.createElement('canvas').getContext('2d');
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const metrics = context.measureText(node.textContent), bounds = node.getBoundingClientRect();
    const top = lines[0].top + metrics.fontBoundingBoxAscent - metrics.actualBoundingBoxAscent;
    const bottom = lines.at(-1).top + metrics.fontBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    return {
      label: top - node.previousElementSibling.getBoundingClientRect().bottom,
      following: node.nextElementSibling.getBoundingClientRect().top - bottom,
      leading: parseFloat(style.lineHeight) - metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent,
      size: parseFloat(style.fontSize), lines: lines.length, left: bounds.left, right: bounds.right,
    };
  });
  assert.ok(ink.label >= labelGap, `${selector}: ink clears its label: ${JSON.stringify(ink)}`);
  assert.ok(ink.following >= followingGap, `${selector}: ink clears following content: ${JSON.stringify(ink)}`);
  assert.ok(ink.leading >= ink.size * .07, `${selector}: wrapped glyphs do not overlap: ${JSON.stringify(ink)}`);
  assert.ok(ink.left >= 0 && ink.right <= page.viewportSize().width, `${selector}: title stays within the viewport`);
  return ink;
}

function installOriginalHeadingFixture(title) {
  localStorage.setItem('tsugi-onboarding-complete-v1', 'true');
  localStorage.setItem('tsugi-startup-area-v1', JSON.stringify('read'));
  window.__readerFixture.heroFeatured = true;
  const host = window.aiostreamsApp, subscribe = host.subscribe.bind(host);
  const rename = value => {
    if (Array.isArray(value)) return value.map(rename);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, key === 'title' && entry === 'Tsugi Original Fixture' ? title : rename(entry)]));
  };
  host.subscribe = listener => subscribe(message => listener(message.type === 'read-result' ? { ...message, data: rename(message.data) } : message));
}

export async function verifyBrushHeadingsBrowser({ browser, origin, installDesktopFixture, screenshotDir }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-GB', reducedMotion: 'reduce' });
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const title = 'Following the Evening Light Across the Valley';
  const category = 'Evening journeys through changing worlds';
  const read = page.locator('[data-page="read"]'), rail = read.locator('.tsugi-reading-rail');
  const capture = async name => {
    if (!screenshotDir) return;
    await mkdir(screenshotDir, { recursive: true });
    await page.screenshot({ path: join(screenshotDir, name + '.png'), animations: 'disabled', timeout: 10_000 });
  };
  const check = async selector => {
    const ink = await assertBrushHeadingSpacing(page, selector);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Reading page has no horizontal overflow');
    return ink;
  };
  try {
    await page.addInitScript(installDesktopFixture);
    await page.addInitScript(installOriginalHeadingFixture, title);
    await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAYCAIAAAB8wupbAAAAHUlEQVR4nGOsqF3FQApgIkn1qIZRDaMaRjWQrAEA4jkBz8UryC4AAAAASUVORK5CYII=', 'base64');
    await page.route('**/__tsugi_read/page/*', route => route.fulfill({ contentType: 'image/png', body: png }));
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await read.getByRole('heading', { name: title, exact: true }).waitFor();
    assert.ok((await check('[data-page="read"] .tsugi-spotlight-copy h2')).lines >= 2, 'Read spotlight uses a long original title');
    await capture('61-read-brush-title-desktop');
    await page.setViewportSize({ width: 440, height: 900 });
    await check('[data-page="read"] .tsugi-spotlight-copy h2');
    await capture('62-read-brush-title-narrow');

    await page.setViewportSize({ width: 1440, height: 900 });
    await read.locator('.tsugi-manga-card').filter({ hasText: title }).click();
    await check('[data-page="read"] .yomi-series-hero h2');
    await capture('63-series-brush-title-desktop');
    await page.setViewportSize({ width: 440, height: 900 });
    await check('[data-page="read"] .yomi-series-hero h2');
    await capture('64-series-brush-title-narrow');

    await page.setViewportSize({ width: 1440, height: 900 });
    await rail.getByRole('button', { name: 'Categories', exact: true }).click();
    await check('[data-page="read"] .yomi-banner h2');
    await read.getByRole('textbox', { name: 'New category', exact: true }).fill(category);
    await read.getByRole('button', { name: 'Create category', exact: true }).click();
    await read.locator('.yomi-category-copy strong').filter({ hasText: category }).waitFor();
    await check('[data-page="read"] .yomi-category-copy strong');
    await page.setViewportSize({ width: 440, height: 900 });
    await check('[data-page="read"] .yomi-banner h2');
    await check('[data-page="read"] .yomi-category-copy strong');
    await capture('65-category-brush-title-narrow');

    await page.setViewportSize({ width: 1440, height: 900 });
    await rail.getByRole('button', { name: 'Books', exact: true }).click();
    const books = page.locator('[data-page="books"]');
    await check('[data-page="books"] .tsugi-spotlight-copy h2');
    await books.getByLabel('Choose ebook files').setInputFiles({ name: title + '.pdf', mimeType: 'application/pdf', buffer: pdfFixture() });
    await books.locator('.tsugi-manga-card').filter({ hasText: title }).click();
    await check('[data-page="books"] .yomi-series-hero h2');
    await capture('66-books-brush-title-desktop');
    await page.setViewportSize({ width: 440, height: 900 });
    await check('[data-page="books"] .yomi-series-hero h2');
    await capture('67-books-brush-title-narrow');

    await page.goto(origin + '/?readerSetup=1', { waitUntil: 'domcontentloaded' });
    await check('[data-page="read-setup"] .yomi-banner h2');
    await capture('68-read-setup-brush-title-narrow');
    await page.setViewportSize({ width: 1440, height: 900 });
    await check('[data-page="read-setup"] .yomi-banner h2');
    assert.deepEqual(errors, [], 'Font measurement and reading navigation produce no browser errors');
    console.log('PASS: loaded brush glyphs clear labels, wrapped lines and following content in Read/Books spotlights, long series/book titles, category cards and setup at desktop and narrow sizes.');
  } catch (error) {
    await capture('brush-headings-failure').catch(() => {});
    throw error;
  } finally { await page.close(); }
}
