// Shared desktop geometry through real navigation and controlled native data.
// This checks rendered browser behavior, not native Windows dragging/resizing.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { assertBrushHeadingSpacing } from './brush-headings-browser.mjs';

export async function assertUnframedGroups(groups, label, minimum = 1) {
  const sample = await groups.evaluateAll(nodes => nodes.map(node => {
    const style = getComputedStyle(node);
    return { background: style.backgroundColor, image: style.backgroundImage, height: node.getBoundingClientRect().height };
  }));
  assert.ok(sample.length >= minimum && sample.every(row => row.height > 0), `${label}: real content groups are rendered`);
  assert.ok(sample.every(row => ['transparent', 'rgba(0, 0, 0, 0)'].includes(row.background) && row.image === 'none'), `${label}: no broad background panel surrounds the content: ${JSON.stringify(sample)}`);
}

async function assertFitsViewport(page, label) {
  const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(size.scroll <= size.width + 1, `${label}: document does not overflow horizontally: ${JSON.stringify(size)}`);
}

async function assertVaultHeading(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => {
    const heading = document.querySelector('.kura-hero h2');
    if (!heading) return false;
    const style = getComputedStyle(heading), context = document.createElement('canvas').getContext('2d');
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const ink = context.measureText(heading.textContent);
    return parseFloat(style.lineHeight) >= ink.actualBoundingBoxAscent + ink.actualBoundingBoxDescent + parseFloat(style.fontSize) * .09;
  });
  const geometry = await page.locator('.kura-hero').evaluate(hero => {
    const heading = hero.querySelector('h2'), label = hero.querySelector('.kura-eyebrow'), description = hero.querySelector('.kura-hero-description');
    const style = getComputedStyle(heading), box = heading.getBoundingClientRect();
    const context = document.createElement('canvas').getContext('2d');
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const metric = context.measureText(heading.textContent);
    const leading = parseFloat(style.lineHeight), fontSize = parseFloat(style.fontSize);
    const baseline = (leading - metric.fontBoundingBoxAscent - metric.fontBoundingBoxDescent) / 2 + metric.fontBoundingBoxAscent;
    const lines = Math.round(box.height / leading);
    const inkTop = box.top + baseline - metric.actualBoundingBoxAscent;
    const inkBottom = box.top + (lines - 1) * leading + baseline + metric.actualBoundingBoxDescent;
    return { width: innerWidth, fontSize, leading, lines, inkHeight: metric.actualBoundingBoxAscent + metric.actualBoundingBoxDescent,
      labelGap: inkTop - label.getBoundingClientRect().bottom, descriptionGap: description.getBoundingClientRect().top - inkBottom,
      heroTop: hero.getBoundingClientRect().top, heroBottom: hero.getBoundingClientRect().bottom, inkTop, inkBottom };
  });
  assert.ok(geometry.labelGap >= 12, `Vault label clears brush strokes: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.descriptionGap >= 10, `Vault description clears deep descenders: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.leading >= geometry.inkHeight + geometry.fontSize * .09, `Vault title lines have visible ink separation: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.inkTop > geometry.heroTop && geometry.inkBottom < geometry.heroBottom, 'Vault brush strokes stay inside their hero');
  await assertFitsViewport(page, 'Vault heading');
}

async function assertRailGeometry(page, scope, area) {
  const rail = scope.locator('[data-ui="tsugi-desktop-rail"]');
  await rail.waitFor({ state: 'visible' });
  await page.waitForFunction(node => !node.disabled, await rail.locator('.tsugi-rail-brand').elementHandle());
  const geometry = await rail.evaluate(node => {
    const box = node.getBoundingClientRect();
    const brand = node.querySelector('.tsugi-rail-brand').getBoundingClientRect();
    const atTop = document.elementFromPoint(box.left + box.width / 2, 8);
    return {
      top: box.top, left: box.left, right: box.right, bottom: box.bottom,
      brandTop: brand.top, brandBottom: brand.bottom,
      background: getComputedStyle(node).backgroundColor,
      canvas: getComputedStyle(document.documentElement).backgroundColor,
      coversTop: !!atTop && node.contains(atTop), height: innerHeight,
    };
  });
  assert.ok(Math.abs(geometry.top) <= 1 && Math.abs(geometry.left) <= 1 && geometry.coversTop, `${area}: the painted rail reaches the window's top edge: ${JSON.stringify(geometry)}`);
  assert.ok(!['transparent', 'rgba(0, 0, 0, 0)', geometry.canvas].includes(geometry.background), `${area}: rail retains its own tonal surface`);
  assert.ok(geometry.brandTop >= 40 && geometry.brandBottom <= geometry.bottom, `${area}: the interactive brand stays below the window drag strip`);
  assert.ok(geometry.bottom <= geometry.height + 1, `${area}: rail remains within the viewport`);

  const local = rail.locator('.tsugi-rail-local > button:visible,.tsugi-rail-footer > button:visible');
  assert.ok(await local.evaluateAll(nodes=>nodes.length>0&&nodes.every(node=>{
    const s=getComputedStyle(node);
    return ['transparent','rgba(0, 0, 0, 0)'].includes(s.backgroundColor)&&s.backgroundImage==='none'&&s.boxShadow==='none';
  })),`${area}: local rail labels and icons remain unboxed, including the active destination`);
  const media = rail.locator('.tsugi-rail-media');
  const buttons = media.getByRole('button');
  assert.equal(await media.locator('[aria-current="page"]').getAttribute('aria-label'), area, `${area}: current media remains clear`);
  for (const button of await buttons.all()) {
    await button.hover();
    const state = await button.evaluate(node => {
      const parent = node.parentElement.getBoundingClientRect(), box = node.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return {
        name: node.getAttribute('aria-label'),
        insets: [box.left - parent.left, parent.right - box.right, box.top - parent.top, parent.bottom - box.bottom],
        background: getComputedStyle(node).backgroundColor, parentBackground: getComputedStyle(node.parentElement).backgroundColor,
        hit: !!hit && node.contains(hit),
      };
    });
    assert.ok(state.insets.every(inset => inset >= 3), `${area}/${state.name}: active and hovered controls stay inset on every side: ${JSON.stringify(state)}`);
    assert.ok(state.hit, `${area}/${state.name}: media controls are not covered by another surface`);
    assert.ok(!['transparent', 'rgba(0, 0, 0, 0)', state.parentBackground].includes(state.background), `${area}/${state.name}: hover or selection remains visible`);
  }
  await assertFitsViewport(page, area);
  return rail;
}

async function assertWindowStrip(page, label) {
  await page.locator('[data-ui="window-controls"]').waitFor({ state: 'visible' });
  const before = await page.evaluate(() => window.__sharedLayoutWindowMessages.length);
  await page.mouse.click(20, 20);
  await page.mouse.dblclick(20, 20);
  await page.mouse.click(20, 2);
  const messages = await page.evaluate(before => window.__sharedLayoutWindowMessages.slice(before), before);
  assert.deepEqual(messages.map(message => message.type), ['window-drag', 'window-drag', 'window-maximize', 'window-resize'], `${label}: the painted rail preserves drag, double-click maximize and top-edge resize bridge actions`);
  assert.equal(messages.at(-1).edge, 'n', `${label}: the top edge requests north resizing`);
}

async function assertMasthead(page, navigation, label) {
  await navigation.waitFor({ state: 'visible' });
  const controls = await navigation.locator('.tsugi-category-link').evaluateAll(nodes => nodes.map(node => {
    const box = node.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return { name: node.getAttribute('aria-label'), left: box.left, right: box.right, top: box.top, bottom: box.bottom, height: box.height, hit: !!hit && node.contains(hit) };
  }));
  assert.deepEqual(controls.map(row => row.name).sort(), ['All media', 'App settings', 'Movies & TV', 'Music', 'Read', 'Vault'].sort(), `${label}: all media and settings remain available`);
  assert.ok(controls.every(row => Math.abs(row.height - 48) <= 1), `${label}: brand, destinations and settings have equal control heights: ${JSON.stringify(controls)}`);
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  assert.ok(controls.every(row => row.left >= 0 && row.right <= width + 1 && row.top >= 40 && row.hit), `${label}: every control fits, stays below the drag strip and can be hit`);
  for (let index = 0; index < controls.length; index++) {
    for (const other of controls.slice(index + 1)) {
      const row = controls[index];
      const overlapX = Math.min(row.right, other.right) - Math.max(row.left, other.left);
      const overlapY = Math.min(row.bottom, other.bottom) - Math.max(row.top, other.top);
      assert.ok(overlapX <= 1 || overlapY <= 1, `${label}: navigation controls do not overlap`);
    }
  }
  await assertFitsViewport(page, label);
}

export async function verifySharedLayoutBrowser({ browser, origin, installDesktopFixture, screenshotDir }) {
  if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-GB', reducedMotion: 'reduce' });
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript({ content: `(${installDesktopFixture.toString()})();
      localStorage.setItem('tsugi-onboarding-complete-v1', 'true');
      localStorage.setItem('tsugi-startup-area-v1', JSON.stringify('welcome'));
      localStorage.setItem('tsugi.landscape.local-only', 'true');
      const host = window.aiostreamsApp, send = host.send.bind(host);
      window.__sharedLayoutWindowMessages = [];
      host.send = message => {
        if (['window-drag', 'window-maximize', 'window-resize'].includes(message.type)) window.__sharedLayoutWindowMessages.push({ type: message.type, ...(message.edge ? { edge: message.edge } : {}) });
        return send(message);
      };` });
    await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    const landing = page.locator('[data-page="desktop-landing"]');
    await landing.locator('.tsugi-world-card[data-world="read"]').click();
    const read = page.locator('[data-page="read"]');
    let rail = await assertRailGeometry(page, read, 'Read');
    await assertWindowStrip(page, 'Wide rail');
    await assertUnframedGroups(read.locator('.tsugi-reading-list-header:visible,.yomi-section-heading:visible'), 'Reader library headings');
    await rail.getByRole('button', { name: 'Books', exact: true }).click();
    const books = page.locator('[data-page="books"]');
    await books.locator('.tsugi-reading-list-header').waitFor();
    await assertUnframedGroups(books.locator('.tsugi-reading-list-header'), 'Books library controls');
    await books.getByRole('button', { name: 'Manga', exact: true }).click();
    await read.waitFor({ state: 'visible' });
    await rail.getByRole('button', { name: 'App settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'App settings', exact: true });
    await assertUnframedGroups(settings.locator(':scope > :is(.tsugi-app-general,.tsugi-global-appearance,.tsugi-app-about)'), 'App settings section wrappers', 3);
    const selectStyles=await settings.locator('.tsugi-app-general select:not([multiple],[size])').evaluateAll(nodes=>nodes.map(node=>{const s=getComputedStyle(node);return {appearance:s.appearance,border:parseFloat(s.borderTopWidth),height:node.getBoundingClientRect().height,font:s.fontFamily};}));
    assert.ok(selectStyles.length>=3&&selectStyles.every(s=>s.appearance==='auto'&&s.border>=1&&s.height>=42&&/^Interface(?:,|$)/.test(s.font)),'global settings selects retain the same native field treatment as local settings: '+JSON.stringify(selectStyles));
    if (screenshotDir) await page.screenshot({ path: join(screenshotDir, '44-app-settings-unframed.png'), animations: 'disabled' });
    await settings.getByRole('button', { name: 'Close', exact: true }).click();
    await rail.getByRole('button', { name: 'Music', exact: true }).click();
    const music = page.locator('[data-page="music"]');
    rail = await assertRailGeometry(page, music, 'Music');

    // Real collection content makes the formerly broad shelf/header backgrounds
    // observable while preserving the row-level reading and interaction cues.
    await music.getByRole('button', { name: 'Music sources', exact: true }).click();
    await assertUnframedGroups(music.getByRole('dialog', { name: 'Music sources', exact: true }).locator('.tsugi-source-section'), 'Music source section wrappers');
    await music.getByRole('dialog', { name: 'Music sources', exact: true }).getByRole('button', { name: 'Connect YouTube Music', exact: true }).click();
    await music.getByRole('button', { name: 'Discover', exact: true }).click();
    const shelf = music.locator('.tsugi-catalog-lane').filter({ hasText: 'Fixture recommendations' });
    await shelf.waitFor();
    await assertUnframedGroups(shelf, 'Music catalogue shelf');
    await assertBrushHeadingSpacing(page, '.oto-feature h2');
    await music.getByRole('navigation', { name: 'Music sections', exact: true }).getByRole('button', { name: 'Search', exact: true }).click();
    await music.getByRole('textbox', { name: 'Search music', exact: true }).fill('Native fixture track');
    await music.getByRole('button', { name: 'Search', exact: true }).last().click();
    await music.getByRole('button', { name: /Fixture playlist/ }).click();
    const collection = page.getByRole('dialog', { name: 'Music collection', exact: true });
    await collection.getByRole('heading', { name: 'Fixture playlist', exact: true }).waitFor();
    await assertUnframedGroups(collection.locator('.tsugi-music-detail-hero'), 'Collection artwork header');
    const rows = collection.locator('.tsugi-music-detail-track');
    await rows.nth(2).waitFor();
    await assertUnframedGroups(collection.locator('.tsugi-library-section-head'), 'Collection Tracks heading');
    await page.mouse.move(1430, 8);
    const tones = await rows.evaluateAll(nodes => nodes.slice(0, 3).map(node => getComputedStyle(node).backgroundColor));
    assert.notEqual(tones[0], tones[1], 'Track rows retain alternating reading surfaces');
    assert.equal(tones[0], tones[2], 'Track row tones remain consistent');
    await collection.getByRole('textbox', { name: 'Find collection tracks', exact: true }).fill('Collection track 12');
    await rows.nth(1).waitFor({ state: 'detached' });
    assert.equal(await rows.count(), 1, 'Unframed Tracks search still filters its actual collection');
    await collection.getByRole('button', { name: 'Back to music', exact: true }).click();
    await rail.getByRole('button', { name: 'Library', exact: true }).click();
    const overview = music.locator('.tsugi-library-overview');
    await overview.waitFor();
    await assertBrushHeadingSpacing(page, '.tsugi-library-intro h2');
    await assertUnframedGroups(overview.locator('.tsugi-library-section-head'), 'Library Playlists and Recently played headings', 2);
    await assertUnframedGroups(overview.locator('.tsugi-library-card-grid'), 'Library artwork shelves');
    if (screenshotDir) await page.screenshot({ path: join(screenshotDir, '45-library-overview-unframed.png'), animations: 'disabled' });

    await rail.getByRole('button', { name: 'Vault', exact: true }).click();
    const vault = page.locator('[data-page="vault"]');
    rail = await assertRailGeometry(page, vault, 'Vault');
    for (const [width, height] of [[2048, 1124], [1440, 900], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await assertVaultHeading(page);
      if (screenshotDir) await page.screenshot({ path: join(screenshotDir, `46-vault-heading-${width}.png`), animations: 'disabled' });
    }
    console.log('PASS: Vault brush title clears its label, adjacent line ink and description at 2048, 1440 and 390px.');
    rail = await assertRailGeometry(page, vault, 'Vault');
    await assertWindowStrip(page, 'Narrow rail');
    await rail.getByRole('button', { name: 'Read', exact: true }).click();
    rail = await assertRailGeometry(page, read, 'Read');
    await rail.getByRole('button', { name: 'Music', exact: true }).click();
    rail = await assertRailGeometry(page, music, 'Music');
    await assertBrushHeadingSpacing(page, '.tsugi-library-intro h2');
    await rail.getByRole('button', { name: 'All media', exact: true }).click();
    await landing.waitFor({ state: 'visible' });
    await landing.locator('.tsugi-world-card[data-world="video"]').click();
    await page.locator('.tsugi-video-entry').getByRole('textbox', { name: /Server address/ }).waitFor();
    const entryNavigation = page.locator('.tsugi-entry-media-nav');
    await assertMasthead(page, entryNavigation, 'Narrow Movies entry');
    await page.setViewportSize({ width: 1440, height: 900 });
    await assertMasthead(page, entryNavigation, 'Movies entry');
    await entryNavigation.getByRole('button', { name: 'App settings', exact: true }).click();
    await settings.getByRole('button', { name: 'Close', exact: true }).click();

    // The same masthead also serves Read before its optional native setup.
    await page.goto(`${origin}/?readerSetup=1`, { waitUntil: 'domcontentloaded' });
    await landing.locator('.tsugi-world-card[data-world="read"]').click();
    const setup = page.locator('[data-page="read-setup"]');
    const setupNavigation = setup.getByRole('navigation', { name: 'Media sections', exact: true });
    await assertMasthead(page, setupNavigation, 'Read setup');
    await page.setViewportSize({ width: 390, height: 844 });
    await assertMasthead(page, setupNavigation, 'Narrow Read setup');
    await setupNavigation.getByRole('button', { name: 'Music', exact: true }).click();
    await music.waitFor({ state: 'visible' });
    assert.deepEqual(errors, [], 'Shared layout transitions have no runtime errors');
    console.log('PASS: shared rails reach the top edge, preserve window drag/maximize/resize bridge actions and inset media states; masthead controls align at wide/narrow widths; Music, Read, Books and App settings headings and artwork groups have no broad background panels.');
  } catch (error) {
    if (screenshotDir) {
      await mkdir(screenshotDir, { recursive: true });
      await page.screenshot({ path: join(screenshotDir, 'shared-layout-failure.png'), animations: 'disabled' }).catch(() => {});
    }
    throw error;
  } finally { await page.close(); }
}
