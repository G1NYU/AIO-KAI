// Real Movies routes, original fixture artwork and a synthetic Jellyfin session.
// No private server, account, external images or native playback are needed.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { installStremioFixture } from './stremio-addons-browser.mjs';

export async function verifyMoviesLayoutBrowser({ browser, origin, installDesktopFixture, screenshotDir }) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: 'en-GB', reducedMotion: 'reduce' });
  page.setDefaultTimeout(20_000);
  const failures = [];
  const unexpected = new Set();
  const requests = new Set();
  page.on('pageerror', error => failures.push(error.message));
  const basePath = '/__tsugi_movies_layout';
  const base = origin + basePath;
  const userId = '22222222222222222222222222222222';
  const user = { Id: userId, Name: 'Original movie viewer', Configuration: {}, Policy: { EnableUserPreferenceAccess: true } };
  const libraries = [{ Id: 'original-movies', Name: 'Original movies', CollectionType: 'movies' }];
  const movies = ['The Quiet Coast', 'A Winter Crossing', 'The Last Observatory', 'Letters from Home', 'The Paper Moon', 'A Small Departure'].map((Name, i) => ({
    Id: `original-movie-${i + 1}`, Name, Type: 'Movie', MediaType: 'Video',
    ProductionYear: 2024, RunTimeTicks: 54_000_000_000, CommunityRating: 8.1,
    Overview: 'An original story follows a small expedition along a remote coast, where an unexpected discovery changes the journey home.',
    Genres: ['Adventure'], People: [], Studios: [], MediaSources: [],
    ImageTags: { Primary: 'original-poster' }, BackdropImageTags: ['original-backdrop'],
    UserData: { Played: false, PlayCount: 0, IsFavorite: false },
  }));
  const nodes = Items => ({ Items, TotalRecordCount: Items.length, StartIndex: 0 });
  const originalArt = (poster, i) => `<svg xmlns="http://www.w3.org/2000/svg" width="${poster ? 480 : 1600}" height="${poster ? 720 : 900}" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice"><rect width="1600" height="900" fill="${['#45585c','#5c5047','#404e65'][i % 3]}"/><circle cx="1190" cy="200" r="100" fill="#e5d4ae"/><path d="M0 660L310 340L700 620L1080 330L1600 590V900H0Z" fill="#22383e"/><path d="M0 790L420 600L820 810L1220 570L1600 740V900H0Z" fill="#17292f"/></svg>`;
  const capture = async name => {
    if (!screenshotDir) return;
    await mkdir(screenshotDir, { recursive: true });
    await page.mouse.move(1590, 5);
    await page.screenshot({ path: join(screenshotDir, name + '.png'), animations: 'disabled', timeout: 10_000 });
  };
  const visibleShell = () => page.locator('.tsugi-video-shell:visible');
  const sidebar = () => visibleShell().locator('[data-ui="sidebar"]');
  const home = () => page.locator('[data-page="home"]:not([inert])');
  const settingsPage = () => page.locator('[data-page="settings"]:not([inert])');
  const noHorizontalOverflow = async label => {
    const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(dimensions.scroll <= dimensions.width + 1, `${label}: no horizontal document overflow (${JSON.stringify(dimensions)})`);
  };
  try {
    await page.addInitScript({content:`(${installDesktopFixture.toString()})();(${installStremioFixture.toString()})(false);`});
    await page.addInitScript(({ base, userId }) => {
      const put = (key, value) => localStorage.setItem(key, JSON.stringify(value));
      put('aiostreams-web-servers', [{ base, name: 'Original movie server', logo: null, lastUsed: 1 }]);
      put('aiostreams-web-server', base);
      put('jellyfin_credentials', { Servers: [{ Id: 'original-fixture-server', ManualAddress: base, AccessToken: 'original-test-only', UserId: userId, DateLastAccessed: 1, LastConnectionMode: 2 }] });
      put(`aiostreams-web-picked-user:${base}`, userId);
      put('tsugi-startup-area-v1', 'video');
      put('aiostreams-web-interface-desktop-navigation', 'sidebar');
    }, { base, userId });
    await page.routeWebSocket(url => url.pathname.startsWith(basePath + '/'), () => {});
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (!url.href.startsWith(base + '/')) {
        if (url.origin === origin) return route.continue();
        return route.abort();
      }
      const path = url.pathname.slice(basePath.length);
      requests.add(path);
      if (/^\/Items\/original-movie-\d+\/Images\//.test(path)) {
        const i = Number(path.match(/movie-(\d+)/)[1]) - 1;
        return route.fulfill({ contentType: 'image/svg+xml', body: originalArt(path.includes('/Primary'), i) });
      }
      let json;
      if (path === '/Users/Me') json = user;
      else if (path === '/System/Info/Public') json = { ServerName: 'Original movie server', Id: 'original-fixture-server', aiostreams: { features: {} } };
      else if (path === '/UserViews') json = nodes(libraries);
      else if (path === '/Items') json = nodes(url.searchParams.has('Ids') ? movies.filter(movie => movie.Id === url.searchParams.get('Ids')) : movies);
      else if (['/UserItems/Resume', '/Shows/NextUp', '/Shows/Upcoming', '/Genres'].includes(path) || path.endsWith('/Similar')) json = nodes([]);
      else if (path === '/Sessions') json = [];
      else if (path.startsWith('/DisplayPreferences/')) json = { CustomPrefs: {} };
      else if (path === '/Sessions/Capabilities/Full' || path === '/Users/Configuration') return route.fulfill({ status: 204 });
      else {
        unexpected.add(`${route.request().method()} ${path}`);
        return route.fulfill({ status: 404, json: { error: 'Unimplemented original fixture route' } });
      }
      return route.fulfill({ json, headers: { 'cache-control': 'no-store' } });
    });

    await page.goto(`${origin}/#/`);
    await home().locator('[data-slide="0"][data-details] [data-ui="hero-title"]').filter({ hasText: movies[0].Name }).waitFor();
    await home().locator('[data-ui="home-rows"]').getByText(movies[2].Name, { exact: true }).waitFor();
    assert.ok(requests.has('/Users/Me') && requests.has('/Items'), 'Home uses the real signed-in session and catalog query');
    assert.equal(await visibleShell().locator('.tsugi-desktop-rail').count(), 0, 'Movies uses its retained sidebar component');
    const menuNames = await sidebar().locator('[data-vertical-menu-item-button]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-name')));
    assert.deepEqual(menuNames.slice(0, 4), ['home', 'discover', 'search', 'favourites'], 'Original movie navigation order is preserved');
    assert.ok(!menuNames.some(name => ['music', 'read', 'vault', 'all-media'].includes(name)), 'Other media use the footer menu');
    for(const id of ['home','discover','search','favourites','anime-hub','watch-addons','stremio-import','nuvio-import','settings']) {
      const glyph=sidebar().locator(`[data-name="${id}"] [data-movie-glyph]`);
      assert.equal(await glyph.count(),1,`${id} has a filled vector glyph`);
      assert.equal(await glyph.getAttribute('fill'),'currentColor');assert.equal(await glyph.getAttribute('stroke'),'none');
    }
    const geometry = await page.evaluate(() => {
      const side = document.querySelector('.tsugi-video-shell [data-ui="sidebar"]');
      const hero = document.querySelector('[data-ui="hero-content"]');
      const rows = document.querySelector('[data-ui="home-rows"]');
      const sideRect = side.getBoundingClientRect();
      const heroRect = hero.getBoundingClientRect();
      const rowRect = rows.getBoundingClientRect();
      return {
        sidebar: { x: sideRect.x, y: sideRect.y, width: sideRect.width, height: sideRect.height },
        sidebarBackground: getComputedStyle(side).backgroundColor,
        logoTop: document.querySelector('[data-ui="sidebar-logo"]').getBoundingClientRect().top,
        heroStart: heroRect.x + parseFloat(getComputedStyle(hero).paddingLeft),
        rowsStart: rowRect.x + parseFloat(getComputedStyle(rows).paddingLeft),
      };
    });
    assert.equal(geometry.sidebar.y, 0, 'Movies sidebar backing reaches the top edge');
    assert.equal(geometry.sidebar.height, 1000, 'Movies sidebar backing fills the viewport');
    assert.equal(geometry.sidebar.width, 80, 'Original compact movie sidebar width is retained');
    assert.ok(geometry.logoTop >= 36, 'Sidebar controls clear the native drag strip');
    assert.ok(!['transparent', 'rgba(0, 0, 0, 0)'].includes(geometry.sidebarBackground), 'Sidebar remains legible over artwork');
    assert.ok(geometry.heroStart >= 104, 'Hero content has at least24px clearance from sidebar');
    assert.equal(geometry.heroStart, geometry.rowsStart, 'Hero and catalog content share an inset');
    const icons = await sidebar().locator('.UI-VerticalMenu__item').evaluateAll(nodes => nodes.map(node => {
      const s = getComputedStyle(node);
      return { background: s.backgroundColor, image: s.backgroundImage, shadow: s.boxShadow, current: node.getAttribute('data-current') };
    }));
    assert.ok(icons.length > 0 && icons.some(item => item.current === 'true'), 'Movies sidebar has a selected navigation icon');
    assert.ok(icons.every(item => ['transparent', 'rgba(0, 0, 0, 0)'].includes(item.background) && item.image === 'none' && item.shadow === 'none'), 'Movies sidebar icons have no grey rounded backgrounds');
    await sidebar().locator('[data-name="home"]').hover();
    assert.ok(['transparent', 'rgba(0, 0, 0, 0)'].includes(await sidebar().locator('[data-name="home"]').evaluate(el => getComputedStyle(el).backgroundColor)), 'Movie navigation hover stays unboxed');
    await noHorizontalOverflow('Connected Movies home');
    await capture('40-movies-home-restored-sidebar');
    console.log('PASS: connected Movies home restores the compact sidebar, original navigation order and aligned hero/catalog gutters.');

    await home().locator('[data-slide="0"][data-details] [data-ui="hero-action"][data-name="info"]').click();
    await page.locator('[data-ui="item-page"] [data-ui="item-title"]').filter({ hasText: movies[0].Name }).waitFor();
    assert.ok(page.url().includes(movies[0].Id), 'Hero More info preserves actual title navigation');
    await sidebar().locator('[data-name="home"]').click();
    await home().locator('[data-slide="0"][data-details] [data-ui="hero-title"]').waitFor();
    console.log('PASS: Movies hero opens the real title route and sidebar Home returns to the catalog.');

    await sidebar().locator('[data-name="settings"]').click();
    await settingsPage().locator('[data-ui="settings-layout"]').waitFor();
    await settingsPage().locator('[data-ui="settings-tab"][data-name="interface"]').click();
    await settingsPage().locator('[data-ui="settings-panel"][data-name="interface"]').getByText('Navigation', { exact: true }).waitFor();
    const settings = await page.evaluate(() => {
      const rect = selector => { const { x, y, width, right } = document.querySelector('[data-page="settings"]:not([inert]) ' + selector).getBoundingClientRect(); return { x, y, width, right }; };
      return { layout: rect('[data-ui="settings-layout"]'), index: rect('[data-ui="settings-index"]'), content: rect('[data-ui="settings-content"]'), title: rect('[data-ui="page-title"]') };
    });
    assert.ok(settings.title.x >= 104 && settings.title.y >= 60, 'Settings clears both sidebar and native titlebar');
    assert.ok(settings.layout.width <= 1280, 'Settings maintains a readable content measure');
    assert.equal(settings.index.width, 240, 'Settings retains its category index');
    assert.ok(settings.content.x - settings.index.right >= 24, 'Settings columns have visible separation');
    assert.ok(settings.content.width <= 1016, 'Settings labels and controls stay within a bounded panel');
    const settingsSurfaces = await settingsPage().evaluate(root => {
      const selectors = [
        '[data-ui="settings-tab-group"]',
        '[data-ui="settings-tab"]',
        '[data-ui="settings-card-body"]',
        '[data-ui="settings-card-item"]',
      ];
      return selectors.map(selector => {
        const element = root.querySelector(selector);
        if (!element) return { selector, missing: true };
        const s = getComputedStyle(element);
        return { selector, background: s.backgroundColor, image: s.backgroundImage, shadow: s.boxShadow, border: s.borderTopWidth };
      });
    });
    assert.ok(settingsSurfaces.every(item => !item.missing && ['transparent', 'rgba(0, 0, 0, 0)'].includes(item.background) && item.image === 'none' && item.shadow === 'none' && item.border === '0px'), 'Movies Settings categories, icons and descriptions sit on the page background: '+JSON.stringify(settingsSurfaces));
    const selectedSettings = settingsPage().locator('[data-ui="settings-tab"][data-name="interface"]');
    await selectedSettings.hover();
    assert.ok(['transparent', 'rgba(0, 0, 0, 0)'].includes(await selectedSettings.evaluate(el => getComputedStyle(el).backgroundColor)), 'Settings hover does not repaint a grey tile');
    await capture('41-movies-settings-bounded');
    console.log('PASS: real Movies settings retain a240px index, bounded detail column and native titlebar clearance.');
    const aboutTab = settingsPage().locator('[data-ui="settings-tab"][data-name="about"]');
    await aboutTab.scrollIntoViewIfNeeded();
    await aboutTab.click();
    assert.equal(await settingsPage().locator('[data-ui="settings-tab"] > span').count(), 0, 'settings scroll does not leave a sliding rounded marker over other categories');
    await settingsPage().locator('[data-ui="settings-tab"][data-name="about"][data-state="active"]').waitFor();
    await settingsPage().locator('[data-ui="settings-panel"][data-name="about"]:visible').waitFor();
    assert.equal(await aboutTab.getAttribute('data-state'), 'active', 'selected category stays attached to its own row');
    await settingsPage().locator('[data-ui="settings-tab"][data-name="theme"]').click();
    assert.equal(await settingsPage().locator('[data-ui="settings-tab"] > span').count(), 0, 'selection remains static after scrolling between categories');
    console.log('PASS: Movies Settings category selection remains stable during sidebar scrolling.');

    for (const [destination, surface] of [['music', '.tsugi-music-root'], ['read', '.tsugi-read-root'], ['vault', '.tsugi-vault-root']]) {
      await sidebar().locator('[data-ui="movie-media-switch"]').click();
      const menu = page.locator('[data-ui="movie-media-menu"]');
      await menu.locator(`[data-name="${destination}"]`).click();
      await page.locator(surface + ':visible').first().waitFor();
      // Reload the saved Movies preference to exercise each destination from a
      // genuine connected movie session, independently of other workspaces' UI.
      await page.reload();
      await settingsPage().locator('[data-ui="settings-layout"]').waitFor();
    }
    console.log('PASS: the labelled Movies footer menu reaches Music, Read and Vault through desktop routing.');

    await page.setViewportSize({ width: 1100, height: 620 });
    const switcher = sidebar().locator('[data-ui="movie-media-switch"]');
    await switcher.scrollIntoViewIfNeeded();
    await switcher.focus();
    await page.keyboard.press('Enter');
    await page.locator('[data-ui="movie-media-menu"]').waitFor();
    await page.keyboard.press('Escape');
    const bounds = await switcher.boundingBox();
    assert.ok(bounds.y >= 36 && bounds.y + bounds.height <= 620, 'Short windows can scroll to the footer below the drag strip');
    const accountControl = sidebar().locator('[data-name="account"]');
    await accountControl.scrollIntoViewIfNeeded();
    const accountBounds = await accountControl.boundingBox();
    assert.ok(accountBounds.y >= 36 && accountBounds.y + accountBounds.height <= 620, 'Short windows can also reach the account control');
    await noHorizontalOverflow('Short desktop settings');
    await capture('42-movies-settings-short');
    console.log('PASS: the restored sidebar scrolls in short windows and its media menu opens from the keyboard.');

    await page.setViewportSize({width:1600,height:1000});
    for(const [id,pane] of [['anime-hub','anime'],['watch-addons','addons'],['stremio-import','stremio'],['nuvio-import','nuvio']]){
      await sidebar().locator(`[data-name="${id}"]`).click();
      const watch=page.locator('[data-page="direct-watch"]');
      await watch.locator('[data-ui="watch-profile-picker"]').getByRole('button',{name:'Default 0 addons',exact:true}).click();
      await watch.locator(`[data-watch-pane="${pane}"]`).waitFor();
      assert.equal(await watch.locator('.tsugi-watch-nav button[aria-pressed="true"]').count(),1);
      await page.reload();await settingsPage().locator('[data-ui="settings-layout"]').waitFor();
    }
    console.log('PASS: filled Movies shortcuts retain profile selection and enter the exact Anime/addon/import pane.');
    await page.setViewportSize({ width: 700, height: 820 });
    await page.locator('[data-ui="mobile-nav"]:visible').waitFor();
    await noHorizontalOverflow('Narrow Movies settings');
    const narrowHeader = await settingsPage().locator('[data-ui="page-body"] > :first-child').boundingBox();
    assert.ok(narrowHeader.y >= 60, 'Narrow Movies settings clear the native drag strip');
    await capture('43-movies-settings-narrow');
    await page.locator('[data-ui="mobile-nav"] button[aria-label="Account"]').click();
    const account = page.locator('[data-ui="account-menu"]');
    await account.waitFor();
    for (const id of ['music', 'read', 'vault', 'all-media', 'anime-hub', 'watch-addons', 'stremio-import', 'nuvio-import']) assert.equal(await account.locator(`[data-name="${id}"]`).count(), 1, `Narrow Movies menu keeps ${id} accessible`);
    await account.locator('[data-name="music"]').click();
    await page.locator('.tsugi-music-root:visible').waitFor();
    console.log('PASS: narrow Movies navigation retains all media destinations and opens Music.');

    assert.deepEqual([...unexpected], [], 'All fixture server requests are deliberate');
    assert.deepEqual(failures, [], 'Connected Movie routes and media switches raise no browser errors');
  } catch (error) {
    await capture('movies-layout-failure');
    throw error;
  } finally {
    await page.close();
  }
}
