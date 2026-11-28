// Original preference labels and opaque capability IDs against the real UI.
// No provider requests, raw preference keys, credentials or actual settings files.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

function installSourceSettingsFixture() {
  if (window.top !== window) return;
  localStorage.setItem('tsugi-onboarding-complete-v1', 'true');
  localStorage.setItem('tsugi-startup-area-v1', JSON.stringify('read'));
  const host = window.aiostreamsApp, base = window.__readerFixture;
  base.installed = true;
  const sourceId = '9007199254740993';
  const sourceName = 'Original configurable source';
  const sources = [
    { id: sourceId, name: sourceName, lang: 'en', supportsLatest: true, contentWarning: 'SAFE', isConfigurable: true },
    { id: '12345', name: 'Original fixed source', lang: 'en', supportsLatest: true, contentWarning: 'MIXED', isConfigurable: false },
  ];
  const fixture = window.__sourceSettingsFixture = {
    calls: [], serial: 0, snapshot: null, nextOutcome: 'applied', failLoad: false,
    values: { switch: false, checkbox: true, select: 1 }, mutations: [],
  };
  const token = value => value.toString(16).padStart(32, '0');
  const send = host.send.bind(host), subscribe = host.subscribe.bind(host), listeners = new Set();
  host.subscribe = listener => { listeners.add(listener); const remove = subscribe(listener); return () => { listeners.delete(listener); remove(); }; };
  const emit = (request, data, error = null) => queueMicrotask(() => {
    for (const listener of listeners) listener({ type: 'read-result', request, data, error });
  });
  host.send = message => {
    if (message.type !== 'read-request') return send(message);
    const action = message.action;
    fixture.calls.push(action);
    if (action.kind === 'source-inventory') return emit(message.request, { nodes: sources, totalCount: sources.length, complete: true });
    if (action.kind === 'source-preferences') {
      fixture.snapshot = null;
      if (fixture.failLoad) return emit(message.request, null, 'The original source settings could not be verified.');
      if (action.source !== sourceId) return emit(message.request, null, 'This original source has no supported settings.');
      const serial = ++fixture.serial;
      const id = index => token(serial * 16 + index);
      fixture.snapshot = {
        reviewId: token(serial), sourceId, sourceName, extensionName: 'Original settings bundle', versionName: '1.6.4',
        controls: [
          { id: id(1), title: 'Enable original feature', kind: 'switch', enabled: true, value: fixture.values.switch },
          { id: id(2), title: 'Confirm original option', kind: 'checkbox', enabled: true, value: fixture.values.checkbox },
          { id: id(3), title: 'Image quality', kind: 'select', enabled: true, value: fixture.values.select, options: ['Standard', 'High', 'Original'] },
          { id: id(4), title: 'Text entry unavailable', kind: 'unsupported', enabled: false, reason: 'unsupported-type' },
          { id: id(5), title: 'Disabled original option', kind: 'checkbox', enabled: false, value: false, reason: 'disabled' },
        ],
      };
      return emit(message.request, fixture.snapshot);
    }
    if (action.kind === 'apply-source-preference') {
      const snapshot = fixture.snapshot;
      const control = snapshot?.controls.find(control => control.id === action.controlId);
      fixture.snapshot = null;
      if (!snapshot || snapshot.reviewId !== action.reviewId || !control?.enabled ||
          !['switch', 'checkbox', 'select'].includes(control.kind) ||
          Object.keys(action).sort().join(',') !== 'controlId,kind,reviewId,value' ||
          (control.kind === 'select' ? !Number.isInteger(action.value) || action.value < 0 || action.value >= control.options.length : typeof action.value !== 'boolean')) {
        return emit(message.request, null, 'The original source settings review is invalid.');
      }
      const outcome = fixture.nextOutcome; fixture.nextOutcome = 'applied';
      if (outcome === 'stale') return emit(message.request, null, 'The source settings review expired or changed. Load settings again.');
      if (outcome === 'error') return emit(message.request, null, 'The original source settings change could not be confirmed.');
      if (outcome === 'applied') {
        fixture.values[control.kind] = action.value;
        fixture.mutations.push({ controlId: control.id, kind: control.kind, value: action.value });
      }
      return emit(message.request, { reviewId: action.reviewId, controlId: action.controlId, status: outcome,
        ...(outcome === 'cancelled' ? {} : { checkpointId: token(0x100000 + fixture.serial) }),
        ...(outcome === 'rolled-back' ? { error: 'The setting was not saved. The previous Reader state was restored.' } : {}),
      });
    }
    if (action.kind === 'cancel-source-preferences') {
      const cancelled = fixture.snapshot?.reviewId === action.reviewId;
      if (cancelled) fixture.snapshot = null;
      return emit(message.request, { reviewId: action.reviewId, cancelled });
    }
    return send(message);
  };
}

export async function verifySourceSettingsBrowser({ browser, origin, installDesktopFixture, screenshotDir }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-GB', reducedMotion: 'reduce' });
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const read = page.locator('[data-page="read"]');
  const rail = read.locator('.tsugi-reading-rail');
  const sources = page.locator('[data-ui="source-browser"]');
  const settings = page.locator('[data-ui="source-settings"]');
  const calls = kind => page.evaluate(kind => window.__sourceSettingsFixture.calls.filter(action => action.kind === kind), kind);
  const frames = () => page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
  const control = title => settings.getByLabel(title, { exact: true });
  const reload = async () => {
    const before = (await calls('source-preferences')).length;
    await settings.getByRole('button', { name: 'Reload settings', exact: true }).click();
    await page.waitForFunction(before => window.__sourceSettingsFixture.calls.filter(action => action.kind === 'source-preferences').length === before + 1, before);
    await control('Image quality').waitFor(); await frames();
  };
  const review = async () => { await settings.getByRole('button', { name: 'Review change', exact: true }).click(); await settings.getByRole('button', { name: 'Apply change', exact: true }).waitFor(); };
  const apply = async (status = 'applied') => {
    const loads = (await calls('source-preferences')).length;
    await settings.getByRole('button', { name: 'Apply change', exact: true }).click();
    await settings.locator(`[data-source-settings-status="${status}"]`).waitFor(); await frames();
    assert.equal((await calls('source-preferences')).length, loads, 'applying never reopens extension preference code without explicit Reload');
  };
  try {
    await page.addInitScript({ content: `(${installDesktopFixture.toString()})();(${installSourceSettingsFixture.toString()})();` });
    await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAYCAIAAAB8wupbAAAAHUlEQVR4nGOsqF3FQApgIkn1qIZRDaMaRjWQrAEA4jkBz8UryC4AAAAASUVORK5CYII=', 'base64');
    await page.route('**/__tsugi_read/page/*', route => route.fulfill({ contentType: 'image/png', body: png }));
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await rail.getByRole('button', { name: 'Browse', exact: true }).click();
    await sources.locator('[data-source-id="9007199254740993"]').waitFor();
    assert.deepEqual(await calls('source-preferences'), [], 'browsing never evaluates extension preference screens');
    assert.equal(await sources.getByRole('button', { name: 'Settings for Original fixed source', exact: true }).count(), 0);
    await sources.getByRole('combobox', { name: 'Source content', exact: true }).selectOption('SAFE');
    await sources.getByRole('combobox', { name: 'Source content', exact: true }).selectOption('');
    await rail.getByRole('button', { name: 'Feed', exact: true }).click();
    await page.locator('[data-ui="source-feed"]').waitFor();
    await rail.getByRole('button', { name: 'Browse', exact: true }).click();
    await sources.getByRole('button', { name: 'Settings for Original configurable source', exact: true }).waitFor();
    assert.deepEqual(await calls('source-preferences'), [], 'filtering and opening Feed do not evaluate source settings');
    const open = sources.getByRole('button', { name: 'Settings for Original configurable source', exact: true });
    await open.focus(); await page.keyboard.press('Enter');
    await page.getByRole('dialog', { name: 'Source settings', exact: true }).waitFor();
    await control('Image quality').waitFor(); await frames();
    assert.deepEqual(await calls('source-preferences'), [{ kind: 'source-preferences', source: '9007199254740993' }]);
    assert.deepEqual(await calls('catalogue'), [], 'the sibling Settings button never opens a catalogue');
    assert.equal(await control('Enable original feature').isChecked(), false);
    assert.equal(await control('Confirm original option').isChecked(), true);
    assert.equal(await control('Image quality').inputValue(), '1');
    assert.equal(await control('Disabled original option').isDisabled(), true);
    await page.mouse.move(1, 1);
    await settings.getByRole('button', { name: 'Close', exact: true }).focus();
    await frames();
    const controlSurfaces = await settings.locator('[data-control-id]').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor));
    assert.ok(controlSurfaces.length >= 5 && controlSurfaces.every(color => ['transparent', 'rgba(0, 0, 0, 0)'].includes(color)), 'source setting controls have no permanent alternating row bands');
    const choiceStyle=await control('Image quality').evaluate(node=>{const s=getComputedStyle(node),dialog=getComputedStyle(node.closest('dialog'));return {appearance:s.appearance,border:parseFloat(s.borderTopWidth),background:s.backgroundColor,dialog:dialog.backgroundColor,height:node.getBoundingClientRect().height,font:s.fontFamily};});
    assert.ok(choiceStyle.appearance==='auto'&&choiceStyle.border>=1&&choiceStyle.background!==choiceStyle.dialog&&choiceStyle.height>=42&&/^Interface(?:,|$)/.test(choiceStyle.font),'flat source settings preserve a recognizable native choice field and shared type: '+JSON.stringify(choiceStyle));
    const unsupported = settings.locator('[data-control-id]').filter({ hasText: 'Text entry unavailable' });
    await unsupported.waitFor();
    assert.equal(await unsupported.locator('input,select,textarea').count(), 0, 'unsupported text settings cannot expose an editable credential field');
    assert.equal(await settings.getByRole('textbox').count(), 0);
    assert.equal(await settings.getByRole('button', { name: /reset/i }).count(), 0, 'this supported subset makes no reset promise');

    await control('Enable original feature').check(); await review();
    assert.deepEqual(await calls('apply-source-preference'), [], 'Review is local and does not save');
    await settings.getByRole('button', { name: 'Cancel change', exact: true }).click(); await frames();
    assert.equal(await control('Enable original feature').isChecked(), false);
    assert.deepEqual(await calls('apply-source-preference'), [], 'cancelling a draft performs no setting mutation');
    assert.equal((await calls('source-preferences')).length, 1);

    await control('Enable original feature').check(); await review(); await apply(); await reload();
    assert.equal(await control('Enable original feature').isChecked(), true);
    assert.equal(await control('Confirm original option').isChecked(), true, 'saving one switch preserves the other field');
    await control('Confirm original option').uncheck(); await review(); await apply(); await reload();
    assert.equal(await control('Confirm original option').isChecked(), false);
    await control('Image quality').focus(); await page.keyboard.press('ArrowDown');
    assert.equal(await control('Image quality').inputValue(), '2');
    await review(); await apply(); await reload();
    assert.equal(await control('Image quality').inputValue(), '2');
    assert.deepEqual(await page.evaluate(() => window.__sourceSettingsFixture.mutations.map(({ kind, value }) => ({ kind, value }))), [
      { kind: 'switch', value: true }, { kind: 'checkbox', value: false }, { kind: 'select', value: 2 },
    ], 'each explicit apply changes exactly one supported value');

    for (const outcome of ['cancelled', 'rolled-back']) {
      await page.evaluate(outcome => { window.__sourceSettingsFixture.nextOutcome = outcome; }, outcome);
      await control('Image quality').selectOption('0'); await review(); await apply(outcome); await reload();
      assert.equal(await control('Image quality').inputValue(), '2', `${outcome} retains the verified prior value`);
    }
    for (const outcome of ['stale', 'error']) {
      await page.evaluate(outcome => { window.__sourceSettingsFixture.nextOutcome = outcome; }, outcome);
      await control('Image quality').selectOption('0'); await review();
      const loads = (await calls('source-preferences')).length;
      await settings.getByRole('button', { name: 'Apply change', exact: true }).click();
      await settings.getByRole('alert').waitFor(); await frames();
      assert.equal((await calls('source-preferences')).length, loads);
      assert.equal(await settings.getByRole('button', { name: 'Apply change', exact: true }).count(), 0, 'failed apply cannot reuse the consumed review');
      await reload();
      assert.equal(await control('Image quality').inputValue(), '2');
      assert.equal(await settings.getByRole('alert').count(), 0);
    }
    assert.equal(await page.evaluate(() => window.__sourceSettingsFixture.mutations.length), 3, 'cancelled, rolled-back and failed applies never claim a saved mutation');
    for (const action of await calls('apply-source-preference')) {
      assert.deepEqual(Object.keys(action).sort(), ['controlId', 'kind', 'reviewId', 'value']);
      assert.match(action.reviewId, /^[a-f0-9]{32}$/); assert.match(action.controlId, /^[a-f0-9]{32}$/);
      assert.ok(typeof action.value === 'boolean' || Number.isInteger(action.value), 'only booleans and choice indexes cross the preference bridge');
    }
    await page.evaluate(() => { window.__sourceSettingsFixture.failLoad = true; });
    await settings.getByRole('button', { name: 'Reload settings', exact: true }).click();
    await settings.getByRole('alert').waitFor();
    assert.equal(await settings.locator('[data-control-id]').count(), 0, 'a failed reload cannot leave stale controls editable');
    await page.evaluate(() => { window.__sourceSettingsFixture.failLoad = false; });
    await reload();
    assert.equal(await settings.getByRole('alert').count(), 0);
    assert.deepEqual(await calls('catalogue'), []);
    if (screenshotDir) { await mkdir(screenshotDir, { recursive: true }); await page.screenshot({ path: join(screenshotDir, 'source-settings-supported.png'), animations: 'disabled' }); }
    await page.setViewportSize({ width: 440, height: 1000 }); await frames();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'source settings fit a narrow window');
    if (screenshotDir) await page.screenshot({ path: join(screenshotDir, 'source-settings-narrow.png'), animations: 'disabled' });
    const closingReviewId = await page.evaluate(() => window.__sourceSettingsFixture.snapshot.reviewId);
    const applies = (await calls('apply-source-preference')).length;
    await settings.getByRole('button', { name: 'Close', exact: true }).click();
    await settings.waitFor({ state: 'hidden' }); await frames();
    assert.ok((await calls('cancel-source-preferences')).some(action => action.reviewId === closingReviewId), 'closing invalidates the displayed native capability');
    assert.equal((await calls('apply-source-preference')).length, applies, 'closing never saves a draft');
    assert.deepEqual(errors, [], 'supported source settings have no uncaught browser errors');
    console.log('PASS: explicit source settings, supported boolean/list edits, local cancellation, opaque one-field apply, explicit reload, stale review, rollback and error recovery.');
  } finally { await page.close(); }
}
