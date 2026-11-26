// Completed-job handoff against the real Vault UI and IndexedDB. The native
// queue/files are authored fixtures; no provider or download is started.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pdfFixture, epubFixture } from './ebook-fixtures.mjs';

function installVaultBookFixture({ pdfBytes, epubBytes }) {
  if (window.top !== window) return;
  localStorage.setItem('tsugi-onboarding-complete-v1', 'true');
  localStorage.setItem('tsugi-startup-area-v1', JSON.stringify('vault'));
  localStorage.setItem('tsugi.vault.intro', 'seen');
  const fixture = window.__vaultBookImportFixture = { mutations: [], abortNextWrite: false };
  const base = window.__readerFixture;
  base.installed = true;
  base.vaultJobs = [
    ['vault-book-one', 'Original Vault.pdf', pdfBytes],
    ['vault-book-failure', 'Recovered Vault.pdf', pdfBytes],
    ['vault-book-epub', 'Original Vault.epub', epubBytes],
    ['vault-book-copy', 'Original Vault.pdf', pdfBytes],
  ].map(([id, vault_title, bytes]) => ({ id, vault_title, bytes, total: bytes, state: 'done', error: null }));
  const host = window.aiostreamsApp, send = host.send.bind(host);
  host.send = message => {
    if (['download-add', 'download-control', 'download-remove'].includes(message.type)) fixture.mutations.push(message);
    return send(message);
  };
  const add = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = function (...args) {
    const result = add.apply(this, args);
    if (this.name === 'files' && fixture.abortNextWrite) {
      fixture.abortNextWrite = false;
      this.transaction.abort();
    }
    return result;
  };
}

async function library(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('tsugi-local-books-v1', 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      const tx = db.transaction(['books', 'files']);
      const read = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const [books, files] = await Promise.all([read(tx.objectStore('books').getAll()), read(tx.objectStore('files').count())]);
      return { books: books.map(({ id, vaultJobId, title, name, format, position, fraction }) => ({ id, vaultJobId, title, name, format, position, fraction })), files };
    } finally { db.close(); }
  });
}

export async function verifyVaultBookImportsBrowser({ browser, origin, installDesktopFixture, screenshotDir }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-GB', reducedMotion: 'reduce' });
  page.setDefaultTimeout(20_000);
  const errors = [], reads = new Map();
  let failRead = true;
  let holdRead = false, releaseRead, notifyRead;
  const heldRead = new Promise(resolve => { releaseRead = resolve; });
  const startedRead = new Promise(resolve => { notifyRead = resolve; });
  const pdf = pdfFixture(), epub = epubFixture();
  page.on('pageerror', error => errors.push(error.message));
  try {
    if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
    await page.addInitScript(installDesktopFixture);
    await page.addInitScript(installVaultBookFixture, { pdfBytes: pdf.length, epubBytes: epub.length });
    await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    await page.route('**/__tsugi_vault/file/*', async route => {
      assert.equal(route.request().headers()['x-tsugi-vault-import'], '1');
      const id = new URL(route.request().url()).pathname.split('/').at(-1);
      reads.set(id, (reads.get(id) || 0) + 1);
      if (id === 'vault-book-one' && holdRead) { notifyRead(); await heldRead; await route.abort().catch(() => {}); return; }
      if (id === 'vault-book-failure' && failRead) return route.fulfill({ status: 404, body: 'Original missing-file fixture' });
      assert.ok(['vault-book-one', 'vault-book-failure', 'vault-book-epub', 'vault-book-copy'].includes(id));
      return route.fulfill({ contentType: id === 'vault-book-epub' ? 'application/epub+zip' : 'application/pdf', body: id === 'vault-book-epub' ? epub : pdf });
    });
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    const vault = page.locator('[data-page="vault"]');
    const row = id => vault.locator(`[data-vault-job-id="${id}"]`);
    const review = page.getByRole('dialog', { name: 'Review book import', exact: true });
    const start = async (id, retry = false) => {
      await row(id).getByRole('button', { name: retry ? 'Retry import' : 'Import into Books', exact: true }).click();
      await review.waitFor();
      await review.getByText('Destination', { exact: true }).waitFor();
      await review.getByText('Books', { exact: true }).waitFor();
    };
    const confirm = async () => { await review.getByRole('button', { name: 'Confirm import', exact: true }).click(); };
    const imported = id => row(id).locator('[data-vault-import-state="imported"]').waitFor();
    const failed = id => row(id).locator('[data-vault-import-state="failed"]').waitFor();

    await start('vault-book-one');
    assert.equal(reads.size, 0, 'review loads metadata without reading or importing the completed file');
    assert.equal((await library(page)).books.length, 0);
    await page.keyboard.press('Escape');
    await review.waitFor({ state: 'hidden' });
    assert.equal(reads.size, 0, 'cancelling review performs no file transfer');
    holdRead = true;
    await start('vault-book-one'); await confirm(); await startedRead;
    await review.getByRole('button', { name: 'Cancel import', exact: true }).click();
    await review.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => [...document.querySelectorAll('[data-vault-job-id="vault-book-one"] button')].some(button => button.textContent.trim() === 'Import into Books' && !button.disabled));
    assert.equal((await library(page)).books.length, 0, 'cancelling an in-flight file read makes no book and releases the import worker');
    holdRead = false; releaseRead();
    await row('vault-book-one').getByRole('button', { name: 'Import into Books', exact: true }).focus();
    await page.keyboard.press('Enter');
    await review.waitFor(); await confirm(); await imported('vault-book-one');
    assert.equal(await vault.isVisible(), true, 'successful handoff leaves the per-job result visible');
    assert.equal((await library(page)).books.length, 1);

    await start('vault-book-failure'); await confirm(); await failed('vault-book-failure');
    await imported('vault-book-one');
    if (screenshotDir) await vault.locator('.tsugi-dashboard-list').last().screenshot({ path: join(screenshotDir, 'vault-book-import-failure.png'), animations: 'disabled' });
    assert.equal(reads.get('vault-book-failure'), 1);
    failRead = false;
    await start('vault-book-failure', true);
    assert.equal(reads.get('vault-book-failure'), 1, 'retry still reviews the target before reading');
    await confirm(); await imported('vault-book-failure');
    assert.equal(reads.get('vault-book-failure'), 2);
    assert.equal((await library(page)).books.filter(book => book.vaultJobId === 'vault-book-failure').length, 1);

    await page.evaluate(() => { window.__vaultBookImportFixture.abortNextWrite = true; });
    await start('vault-book-epub'); await confirm(); await failed('vault-book-epub');
    assert.deepEqual([(await library(page)).books.length, (await library(page)).files], [2, 2], 'failed storage transaction leaves no partial book or file');
    await imported('vault-book-one'); await imported('vault-book-failure');
    await start('vault-book-epub', true); await confirm(); await imported('vault-book-epub');
    assert.equal((await library(page)).books.find(book => book.vaultJobId === 'vault-book-epub').format, 'epub');

    await start('vault-book-copy');
    await review.getByRole('region', { name: 'Possible duplicate books', exact: true }).waitFor();
    assert.equal(await review.getByRole('button', { name: 'Confirm import', exact: true }).isEnabled(), false);
    assert.equal(reads.get('vault-book-copy'), undefined);
    await review.getByRole('button', { name: 'Cancel import', exact: true }).click();
    await start('vault-book-copy');
    await review.getByRole('checkbox', { name: 'Import another copy', exact: true }).check();
    // Simulate another library change while this review is open. Confirmation
    // must refresh the duplicate review before creating a further saved copy.
    await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => { const request = indexedDB.open('tsugi-local-books-v1', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(['books', 'files'], 'readwrite');
          tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error);
          const books = tx.objectStore('books'), files = tx.objectStore('files'), request = books.getAll();
          request.onsuccess = () => {
            const original = request.result.find(book => book.vaultJobId === 'vault-book-one');
            books.put({ ...original, position: 1, fraction: 0.4 });
            const saved = files.get(original.id);
            saved.onsuccess = () => {
              const { vaultJobId, ...manual } = original;
              books.add({ ...manual, id: 'manual-original-vault', title: 'Existing manual copy' });
              files.add(saved.result, 'manual-original-vault');
            };
          };
        });
      } finally { db.close(); }
    });
    await confirm();
    await review.getByText('Existing manual copy', { exact: false }).waitFor();
    assert.equal(await review.getByRole('checkbox', { name: 'Import another copy', exact: true }).isChecked(), false);
    assert.equal(reads.get('vault-book-copy'), undefined, 'changed duplicate review does not read or import');
    await review.getByRole('checkbox', { name: 'Import another copy', exact: true }).check();
    await confirm(); await imported('vault-book-copy');
    const saved = await library(page);
    assert.deepEqual([saved.books.length, saved.files], [5, 5]);
    assert.equal(saved.books.find(book => book.vaultJobId === 'vault-book-one').fraction, 0.4, 'duplicate import preserves original progress');
    assert.deepEqual(await page.evaluate(() => window.__vaultBookImportFixture.mutations), [], 'imports and retries never restart or alter downloads');

    const beforeReload = [...reads];
    await page.reload({ waitUntil: 'domcontentloaded' });
    for (const id of ['vault-book-one', 'vault-book-failure', 'vault-book-epub', 'vault-book-copy']) await row(id).locator('[data-vault-import-state="existing"]').waitFor();
    assert.deepEqual([...reads], beforeReload, 'existing vaultJobId records restore results without rereading files');
    await row('vault-book-failure').getByRole('button', { name: 'Open Books', exact: true }).click();
    const books = page.locator('[data-page="books"]');
    await books.locator('.tsugi-manga-card').filter({ hasText: 'Recovered Vault' }).click();
    await books.getByRole('button', { name: 'Remove from library', exact: true }).click();
    await books.getByRole('button', { name: 'Remove saved copy', exact: true }).click();
    await books.locator('.tsugi-manga-card').filter({ hasText: 'Recovered Vault' }).waitFor({ state: 'hidden' });
    await books.locator('[data-ui="tsugi-desktop-rail"]').getByRole('button', { name: 'Vault', exact: true }).click();
    await row('vault-book-one').locator('[data-vault-import-state="existing"]').waitFor();
    await row('vault-book-failure').getByRole('button', { name: 'Import into Books', exact: true }).waitFor();
    assert.equal(await row('vault-book-failure').locator('[data-vault-import-state="existing"]').count(), 0, 'removing the saved book removes the derived imported status');
    if (screenshotDir) { await mkdir(screenshotDir, { recursive: true }); await page.screenshot({ path: join(screenshotDir, 'vault-book-import-results.png'), animations: 'disabled' }); }
    await page.setViewportSize({ width: 440, height: 900 });
    await start('vault-book-failure');
    assert.equal(await review.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true, 'narrow import review does not overflow');
    if (screenshotDir) await page.screenshot({ path: join(screenshotDir, 'vault-book-import-narrow.png'), animations: 'disabled' });
    await review.getByRole('button', { name: 'Cancel import', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.__vaultBookImportFixture.mutations), []);
    assert.deepEqual(errors, []);
    console.log('PASS: reviewed Vault book handoff, cancellable file read, per-job import results, independent file/storage retry, duplicate re-review, persisted identity, removal reconciliation and narrow layout without restarting downloads.');
  } finally { releaseRead(); await page.close(); }
}
