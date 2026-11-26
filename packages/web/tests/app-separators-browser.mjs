// Real signed-in Movie components with an isolated, synthetic Jellyfin server.
// No real credentials, user data, external services or native Windows app are used.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { assertUnframedGroups, verifySharedLayoutBrowser } from './shared-layout-browser.mjs';

async function assertBands(rows, label, { offset = 0 } = {}) {
  const sample = await rows.evaluateAll((nodes, start) => nodes.slice(start, start + 3).map(node => {
    const style = getComputedStyle(node);
    return {
      background: style.backgroundColor,
      borders: [style.borderTopWidth, style.borderBottomWidth],
      height: node.getBoundingClientRect().height,
    };
  }), offset);
  assert.equal(sample.length, 3, `${label}: three real content rows are present`);
  assert.ok(sample.every(row => row.height > 0), `${label}: rows are rendered`);
  assert.ok(sample.every(row => !['transparent', 'rgba(0, 0, 0, 0)'].includes(row.background)), `${label}: rows have tonal surfaces`);
  assert.notEqual(sample[0].background, sample[1].background, `${label}: adjacent rows are distinguishable without rules`);
  assert.equal(sample[0].background, sample[2].background, `${label}: alternate rows share their tone`);
  assert.ok(sample.every(row => row.borders.every(width => parseFloat(width) === 0)), `${label}: row boundaries have no separator borders`);
}

async function assertUnboxed(rows, label) {
  const sample = await rows.evaluateAll(nodes => nodes.slice(0, 3).map(node => {
    const s = getComputedStyle(node);
    return { background: s.backgroundColor, image: s.backgroundImage, shadow: s.boxShadow,
      borders: [s.borderTopWidth, s.borderBottomWidth], height: node.getBoundingClientRect().height };
  }));
  assert.equal(sample.length, 3, `${label}: three real content rows are present`);
  assert.ok(sample.every(row => row.height > 0), `${label}: rows remain visible`);
  assert.ok(sample.every(row => ['transparent', 'rgba(0, 0, 0, 0)'].includes(row.background)
    && row.image === 'none' && row.shadow === 'none' && row.borders.every(value => parseFloat(value) === 0)),
  `${label}: labels and icons have no grey boxed backgrounds: ${JSON.stringify(sample)}`);
}

async function assertNoVisibleSeparators(container, label) {
  const painted = await container.locator('[role="separator"], .UI-DropdownMenu__separator, .UI-ContextMenu__separator, .tsugi-pixel-rule').evaluateAll(nodes => nodes.filter(node => {
    const style = getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden' && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0;
  }).map(node => node.className));
  assert.deepEqual(painted, [], `${label}: separator primitives are not displayed`);
}

export async function verifyAppSeparatorsBrowser({ browser, origin, installDesktopFixture, screenshotDir }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-GB', reducedMotion: 'reduce' });
  page.setDefaultTimeout(20_000);
  const failures = [];
  const unexpected = new Set();
  page.on('pageerror', error => failures.push(error.message));
  const base = `${origin}/__tsugi_movie_fixture`;
  const userId = '11111111111111111111111111111111';
  const user = { Id: userId, Name: 'Tsugi fixture profile', Configuration: {}, Policy: { EnableUserPreferenceAccess: true } };
  const library = [
    { Id: 'fixture-movies', Name: 'Original fixture movies', CollectionType: 'movies' },
    { Id: 'fixture-shows', Name: 'Original fixture shows', CollectionType: 'tvshows' },
  ];
  const movies = Array.from({ length: 3 }, (_, i) => ({
    Id: `fixture-movie-${i + 1}`, Name: `Original fixture movie ${i + 1}`, Type: 'Movie',
    MediaType: 'Video', ProductionYear: 2024, RunTimeTicks: 54_000_000_000,
    Overview: 'Original synthetic media for interface acceptance.',
    UserData: { Played: true, PlayCount: 1, IsFavorite: false },
  }));
  const series = { Id: 'fixture-series', Name: 'Original fixture series', Type: 'Series', UserData: {} };
  const at = Date.now() - 60_000;
  const history = movies.map((item, i) => ({
    userId, itemKey: item.Id, kind: 'movie', played: true, playCount: 1,
    positionMs: 0, durationMs: 5_400_000, favorite: false,
    lastPlayedAt: at - i * 60_000, sortAt: at - i * 60_000, origin: 'local', tracker: null, item,
  }));
  const nodes = Items => ({ Items, TotalRecordCount: Items.length, StartIndex: 0 });
  const requests = new Set();
  const capture = async name => {
    if (!screenshotDir) return;
    await mkdir(screenshotDir, { recursive: true });
    await page.screenshot({ path: join(screenshotDir, name + '.png'), animations: 'disabled', timeout: 10_000 });
  };
  const clearInteraction = async () => {
    await page.mouse.move(1430, 5);
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  };
  try {
    await page.addInitScript(installDesktopFixture);
    await page.addInitScript(({ base, userId }) => {
      const put = (key, value) => localStorage.setItem(key, JSON.stringify(value));
      put('aiostreams-web-servers', [{ base, name: 'Synthetic acceptance server', logo: null, lastUsed: 1 }]);
      put('aiostreams-web-server', base);
      put('jellyfin_credentials', { Servers: [{ Id: 'fixture-server', ManualAddress: base, AccessToken: 'tsugi-test-only', UserId: userId, DateLastAccessed: 1, LastConnectionMode: 2 }] });
      put(`aiostreams-web-picked-user:${base}`, userId);
      put('tsugi-startup-area-v1', 'video');
    }, { base, userId });
    // Keep the server event socket synthetic as well as its HTTP API.
    await page.routeWebSocket(url => url.pathname.startsWith('/__tsugi_movie_fixture/'), () => {});
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (!url.href.startsWith(base + '/')) {
        if (url.origin === origin) return route.continue();
        return route.abort();
      }
      const path = url.pathname.slice('/__tsugi_movie_fixture'.length);
      requests.add(path);
      let json;
      if (path === '/Users/Me') json = user;
      else if (path === '/System/Info/Public') json = { ServerName: 'Synthetic acceptance server', Id: 'fixture-server', aiostreams: { features: { history: 1, users: 1 } } };
      else if (path === '/AIOStreams/Users') json = [{ user, avatar: null, needs: null }];
      else if (path === '/AIOStreams/Activity') json = { users: [{ user, avatar: null, hidden: false, locked: false, historyOf: userId, counts: { played: 3, movies: 3, episodes: 0, inProgress: 0, favorites: 0, lastAt: at } }], sessions: [] };
      else if (path === '/AIOStreams/History') json = { items: history, cursor: null };
      else if (path === '/UserViews') json = nodes(library);
      else if (path === '/Items') json = nodes(url.searchParams.get('ParentId') === 'fixture-shows' ? [series] : movies);
      else if (['/UserItems/Resume', '/Shows/NextUp', '/Shows/Upcoming', '/Genres'].includes(path)) json = nodes([]);
      else if (path === '/Sessions') json = [];
      else if (path.startsWith('/DisplayPreferences/')) json = { CustomPrefs: {} };
      else if (path === '/Sessions/Capabilities/Full' || path === '/Users/Configuration') return route.fulfill({ status: 204 });
      else {
        unexpected.add(`${route.request().method()} ${path}`);
        return route.fulfill({ status: 404, json: { error: 'Unimplemented synthetic movie route' } });
      }
      return route.fulfill({ json, headers: { 'cache-control': 'no-store' } });
    });

    await page.goto(`${origin}/#/settings?tab=interface`);
    const panel = page.locator('[data-ui="settings-panel"][data-name="interface"]');
    await panel.getByText('Navigation', { exact: true }).waitFor();
    assert.equal(await page.locator('html').getAttribute('data-host'), 'desktop');
    assert.ok(requests.has('/Users/Me'), 'Movie checks use a validated synthetic signed-in session');
    assert.equal(await page.locator('.tsugi-video-entry').count(), 0, 'Movie checks are beyond server onboarding');
    await clearInteraction();
    await assertUnboxed(page.locator('[data-ui="settings-tab-group"][data-name="watching"] > [data-ui="settings-tab"]'), 'Movie setting categories');
    await assertUnboxed(panel.locator('[data-ui="settings-card"][data-name="navigation"] [data-ui="settings-card-item"]'), 'Movie navigation settings');
    await assertNoVisibleSeparators(page.locator('[data-ui="shell"]'), 'Movie navigation');
    await capture('20-movie-settings-unboxed');
    console.log('PASS: authenticated Movie settings category and detail labels are unboxed without grey rows.');

    const startSelect = panel.locator('[data-ui="settings-card-item"]')
      .filter({ has: page.locator('label').filter({ hasText: /^Start on$/ }) }).getByRole('combobox');
    const restingBorder = await startSelect.evaluate(node => getComputedStyle(node).borderTopColor);
    await startSelect.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await page.waitForFunction(({ node, restingBorder }) => {
      const style = getComputedStyle(node);
      return document.activeElement === node && node.matches(':focus-visible') &&
        ((parseFloat(style.outlineWidth) > 0 && style.outlineStyle !== 'none') ||
          (parseFloat(style.borderTopWidth) > 0 && style.borderTopColor !== restingBorder));
    }, { node: await startSelect.elementHandle(), restingBorder });
    const control = await startSelect.evaluate(node => {
      const style = getComputedStyle(node);
      return { focused: document.activeElement === node, focusVisible: node.matches(':focus-visible'), outline: parseFloat(style.outlineWidth), outlineStyle: style.outlineStyle, border: parseFloat(style.borderTopWidth), borderColor: style.borderTopColor };
    });
    const focusMark = (control.outline > 0 && control.outlineStyle !== 'none') || (control.border > 0 && control.borderColor !== restingBorder);
    assert.ok(control.focused && control.focusVisible && focusMark, `Movie select retains a visible keyboard focus boundary: ${JSON.stringify(control)}`);
    assert.ok(control.border > 0, 'Movie select retains its control boundary');
    await startSelect.click();
    const choices = page.getByRole('listbox');
    await choices.waitFor();
    await clearInteraction();
    await assertBands(choices.locator('[role="option"]'), 'Movie select menu', { offset: 1 });
    const selectedChoice = choices.locator('[role="option"][data-state="checked"]');
    const selectedTone = await selectedChoice.evaluate(node => getComputedStyle(node).backgroundColor);
    await selectedChoice.hover();
    assert.equal(await selectedChoice.evaluate(node => getComputedStyle(node).backgroundColor), selectedTone, 'Selected menu choice keeps its active state when hovered');
    const unselectedChoice = choices.locator('[role="option"]').nth(1);
    const restingTone = await unselectedChoice.evaluate(node => getComputedStyle(node).backgroundColor);
    await unselectedChoice.hover();
    assert.notEqual(await unselectedChoice.evaluate(node => getComputedStyle(node).backgroundColor), restingTone, 'Menu hover remains visible over the row bands');
    await page.keyboard.press('Escape');
    console.log('PASS: Movie select menu preserves control borders, visible keyboard focus and selected/hover states.');

    await clearInteraction();
    await page.keyboard.press('?');
    const shortcuts = page.locator('[data-ui="shortcuts-help"]');
    await shortcuts.waitFor();
    await clearInteraction();
    await assertBands(shortcuts.locator('section[data-name="navigation"] > div'), 'Keyboard shortcut help');
    await capture('21-shortcut-help-tonal');
    await page.keyboard.press('Escape');

    await page.goto(`${origin}/#/history`);
    await page.getByRole('button', { name: 'Table', exact: true }).click();
    const table = page.locator('[data-ui="history-table"]');
    await table.getByText(movies[2].Name, { exact: true }).waitFor();
    await clearInteraction();
    await assertBands(table.locator('tbody > tr'), 'Movie watch history');
    await capture('22-movie-history-tonal');

    // A narrow desktop window uses the real account menu with group separators.
    await page.setViewportSize({ width: 900, height: 900 });
    await page.getByRole('button', { name: 'Account', exact: true }).click();
    const menu = page.locator('[data-ui="account-menu"]');
    await menu.waitFor();
    assert.ok(await menu.locator('.UI-DropdownMenu__separator').count() > 0, 'Account fixture exercises actual grouped menu separators');
    await assertNoVisibleSeparators(menu, 'Movie account menu');
    await clearInteraction();
    await assertBands(menu.locator('[role="menuitem"]'), 'Movie account menu');
    const accountGroups = await menu.getByRole('menuitem').evaluateAll(nodes => nodes.map(node => ({
      name: node.textContent.trim(), top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom,
    })));
    const settingsAt = accountGroups.findIndex(row => row.name === 'Settings');
    assert.ok(settingsAt > 0 && accountGroups[settingsAt].top - accountGroups[settingsAt - 1].bottom >= 6, 'Account action group keeps visible spacing after its separator is removed');
    await capture('23-movie-account-menu-tonal');
    await page.keyboard.press('Escape');

    await page.goto(`${origin}/#/settings`);
    const categories = page.locator('[data-ui="settings-tab-group"][data-name="watching"]');
    await categories.getByRole('button', { name: /Playback/ }).waitFor();
    await clearInteraction();
    await assertUnboxed(categories.locator('[data-ui="settings-tab"]'), 'Narrow Movie setting categories');

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${origin}/#/`);
    const homeRows = page.locator('[data-ui="home-rows"] [data-ui="media-row"][data-row^="view:"]');
    await homeRows.locator('[href="#/item/fixture-series"]').waitFor();
    await assertUnframedGroups(homeRows, 'Movie catalogue shelves', 2);
    await capture('24-movie-catalogue-categories');

    assert.deepEqual([...unexpected], [], 'Every synthetic Movie API request has an intentional fixture');
    assert.deepEqual(failures, [], 'No Movie component runtime errors');
    console.log('PASS: authenticated synthetic Movies settings, history, shortcut help and account/select menus retain row separation; catalogue shelves remain unframed, and control borders and keyboard focus stay visible.');
  } catch (error) {
    await capture('app-separators-failure').catch(() => {});
    if (unexpected.size || failures.length) {
      error.message += `\nSynthetic Movie diagnostics: ${JSON.stringify({ unexpected: [...unexpected], failures })}`;
    }
    throw error;
  } finally {
    await page.close();
  }
  await verifySharedLayoutBrowser({ browser, origin, installDesktopFixture, screenshotDir });
}
