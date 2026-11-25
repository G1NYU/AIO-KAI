// Prepare a pinned, restricted Readest/Foliate build for the desktop reader.
// Upstream install scripts are never executed.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const revision = 'de8c86324b51c231bbbdfa9faf18e84175f563cc';
const destination = join(root, 'public', 'tsugi-books', 'engine');
const stamp = createHash('sha256').update(revision).update(readFileSync(fileURLToPath(import.meta.url))).digest('hex');
const marker = join(destination, '.prepared');
if (existsSync(marker) && readFileSync(marker, 'utf8') === stamp &&
    ['view.js', 'epub.js', 'paginator.js', 'vendor/pdfjs/pdf.mjs', 'vendor/pdfjs/pdf.worker.mjs'].every(file => existsSync(join(destination, file)))) {
  console.log('Pinned ebook engine already prepared.');
  process.exit(0);
}
const temporary = mkdtempSync(join(tmpdir(), 'tsugi-ebook-'));
const source = join(temporary, 'source');
const prepared = join(temporary, 'engine');
const git = (...args) => execFileSync('git', args, {
  cwd: source, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], timeout: 180_000,
}).trim();

function patch(file, before, after, expected = 1) {
  const path = join(prepared, file);
  const content = readFileSync(path, 'utf8');
  if (content.split(before).length - 1 !== expected)
    throw new Error('Unexpected pinned engine hardening target: ' + file);
  writeFileSync(path, content.replaceAll(before, after));
}

try {
  mkdirSync(source);
  git('init', '--quiet');
  git('fetch', '--quiet', '--depth=1', 'https://github.com/readest/foliate-js.git', revision);
  git('checkout', '--quiet', '--detach', 'FETCH_HEAD');
  if (git('rev-parse', 'HEAD') !== revision) throw new Error('Ebook source revision mismatch.');
  mkdirSync(join(prepared, 'vendor', 'pdfjs'), { recursive: true });
  for (const file of ['LICENSE', 'view.js', 'epub.js', 'epubcfi.js', 'paginator.js', 'fixed-layout.js', 'progress.js', 'overlayer.js', 'text-walker.js', 'section-chunks.js', 'search.js', 'footnotes.js', 'tts.js']) {
    cpSync(join(source, file), join(prepared, file));
  }
  for (const file of ['zip.js', 'fflate.js']) cpSync(join(source, 'vendor', file), join(prepared, 'vendor', file));
  for (const file of ['pdf.mjs', 'pdf.worker.mjs', 'cmaps', 'standard_fonts'])
    cpSync(join(source, 'vendor', 'pdfjs', file), join(prepared, 'vendor', 'pdfjs', file), { recursive: true });
  cpSync(join(root, 'ebook-frame', 'PDFJS-LICENSE'), join(prepared, 'vendor', 'pdfjs', 'LICENSE'));

  // Chromium does not need Foliate's script-enabled WebKit iframe workaround.
  patch('paginator.js', "'allow-same-origin allow-scripts'", "'allow-same-origin'");
  patch('fixed-layout.js', "'allow-same-origin allow-scripts'", "'allow-same-origin'", 2);
  patch('fixed-layout.js', "import 'construct-style-sheets-polyfill'", '// Chromium provides constructable stylesheets.');
  patch('epub.js', 'const isScript = MIME.JS.test(item.mediaType)', 'const isScript = MIME.JS.test(item.mediaType)\n        if (isScript) return null');
  patch('epub.js', 'if (isExternal(href)) return href', 'if (isExternal(href)) return /^data:image\\/(png|jpeg|gif|webp);base64,/i.test(href) ? href : ""');
  patch('epub.js', 'const doc = parsed.doc', 'const doc = parsed.doc\n            for (const node of doc.querySelectorAll("script,iframe,frame,object,embed,form,base,meta[http-equiv],foreignObject,portal")) node.remove()\n            for (const node of doc.querySelectorAll("*")) for (const attr of [...node.attributes]) if (/^on/i.test(attr.localName)) node.removeAttributeNode(attr)\n            for (const node of [...doc.childNodes]) if (node.nodeType === 7) node.remove()');
  patch('view.js', 'const entries = await reader.getEntries()', 'const entries = await reader.getEntries()\n    if (entries.length > 5000 || entries.some(entry => entry.encrypted || !Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize > 64 * 1024 * 1024) || entries.reduce((sum, entry) => sum + entry.uncompressedSize, 0) > 512 * 1024 * 1024) throw new Error("Unsupported ebook archive size or encryption")');

  // Only EPUB is loaded through Foliate. The parent-facing adapter will use
  // PDF.js directly, and other file types and remote URLs are not supported.
  for (const file of ['view.js','epub.js','paginator.js','fixed-layout.js'])
    execFileSync(process.execPath, ['--check', join(prepared, file)], { stdio: 'inherit' });
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  cpSync(prepared, destination, { recursive: true });
  writeFileSync(marker, stamp);
  console.log('Prepared restricted ebook engine at ' + revision);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
