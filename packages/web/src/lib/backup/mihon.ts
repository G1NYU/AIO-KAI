import { sha256 } from '@noble/hashes/sha2.js';
import { parseMangaBackup, type BackupChapter, type BackupManga, type LocalManga, type MangaBackup } from './manga';

/**
 * Field numbers and defaults are pinned to Mihon v0.21.3, not inferred from a
 * sample or a filename. BackupStream writes the same protobuf as older backups.
 * https://github.com/mihonapp/mihon/tree/v0.21.3/app/src/main/java/eu/kanade/tachiyomi/data/backup
 * Backup.kt: 0c021d34a8426dc0bd5844b4e00f9c13767610bf
 * BackupManga.kt: 74a27fa017dfc84e2826470c37e8102fe92a782d
 * BackupChapter.kt: 9b026ca30faae1ad334ab7fcccebaa667515ed77
 * BackupHistory.kt: aed3f24a29abd781e6913af9b02b5a44e3203436
 * BackupCategory.kt: 2600e22a45ca8c693f99860d378672c57347a1fb
 * BackupSource.kt: 92ee2dca94bb8005ba8b2aec1d90464f28fbf806
 * MangaBackupCreator / MangaRestorer use category ORDER, including when an id
 * is present. History is milliseconds; Suwayomi v2.4.2373 uses epoch seconds.
 */
export const MIHON_BACKUP_LIMIT = 16 * 1024 * 1024;
export const MIHON_EXPANDED_LIMIT = 32 * 1024 * 1024;
const MESSAGE_LIMIT = 8 * 1024 * 1024;
const MAX_TITLES = 1000, MAX_CHAPTERS = 100000, MAX_TITLE_CHAPTERS = 10000;
const MAX_HISTORY = 100000, MAX_FIELDS = 2000000, MAX_MESSAGES = 250000;
const MAX_URL_BYTES = 16384, MAX_LABEL_BYTES = 8192;
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();

export type MihonReport = {
  titles: number; chapters: number; categories: number; sources: number;
  nonLibraryTitles: number; partialPositions: number; labelsReplaced: number;
  historyRecords: number; historyMatched: number; historyUnmatched: number;
  trackingRecords: number; appPreferences: number; sourcePreferences: number;
  extensionStores: number; metadataFieldsOmitted: number;
  categoriesSkipped: number; categoryAssignmentsSkipped: number;
};
export type MihonImport = {
  format: 'mihon-tachibk'; compression: 'gzip' | 'none'; backup: MangaBackup;
  sources: { id: string; name: string }[]; report: MihonReport;
  /** Operation-local identities. Never serialize this into a portable archive or diagnostic. */
  reconstruction: MihonReconstruction;
  reconstructionSkipped: { title: string; sourceId: string; titleSkipped: boolean; chaptersSkipped: number }[];
};
export type MihonReconstruction = {
  manga: { sourceId: string; url: string; title: string; categories: string[];
    chapters: { url: string; name: string; read: boolean; bookmark: boolean; page: number; chapterNumber: number; sourceOrder: number; lastReadAt: string }[];
    trackers: { trackerId: number; remoteId: string }[] }[];
  categories: string[];
};
export type MihonLabels = { manga: string; chapter: string; source: string };
export type MihonPageReview = {
  requested: number; eligible: number; disabled: number; unmatched: number;
  newerOrComplete: number; unavailableOrOutOfRange: number; alreadyAhead: number;
};

type Budget = { fields: number; messages: number; chapters: number; history: number };

/** A deliberately small protobuf reader: no groups, recursion or object keys
 * supplied by the file. Lengths and varints are bounded before conversion to JS
 * numbers. Unknown fields are skipped without decoding their private contents.
 */
class WireReader {
  private position = 0;
  constructor(private readonly data: Uint8Array, private readonly budget: Budget) {
    if (++budget.messages > MAX_MESSAGES) throw Error('mihon-message-limit');
  }
  get done() { return this.position === this.data.length; }
  varint(): bigint {
    let value = 0n;
    for (let index = 0; index < 10; index++) {
      if (this.position >= this.data.length) throw Error('mihon-truncated');
      const byte = this.data[this.position++];
      if (index === 9 && byte > 1) throw Error('mihon-varint-overflow');
      value |= BigInt(byte & 127) << BigInt(index * 7);
      if (byte < 128) {
        if (index > 0 && byte === 0) throw Error('mihon-varint-overlong');
        return value;
      }
    }
    throw Error('mihon-varint-overflow');
  }
  tag(): { field: number; wire: number } {
    if (++this.budget.fields > MAX_FIELDS) throw Error('mihon-field-limit');
    const tag = this.varint();
    if (tag > 0xffffffffn || tag < 8n) throw Error('mihon-field-number');
    const wire = Number(tag & 7n);
    if (![0, 1, 2, 5].includes(wire)) throw Error('mihon-wire-type');
    return { field: Number(tag >> 3n), wire };
  }
  require(wire: number, expected: number) {
    if (wire !== expected) throw Error('mihon-field-type');
  }
  bytes(wire: number, max = MIHON_EXPANDED_LIMIT): Uint8Array {
    this.require(wire, 2);
    const size = this.varint();
    if (size > BigInt(max) || size > BigInt(this.data.length - this.position)) throw Error('mihon-field-size');
    const end = this.position + Number(size);
    const bytes = this.data.subarray(this.position, end);
    this.position = end;
    return bytes;
  }
  message(wire: number, max = MESSAGE_LIMIT): WireReader {
    return new WireReader(this.bytes(wire, max), this.budget);
  }
  string(wire: number, max = MAX_LABEL_BYTES): string { return decoder.decode(this.bytes(wire, max)); }
  long(wire: number): bigint { this.require(wire, 0); return BigInt.asIntN(64, this.varint()); }
  boolean(wire: number): boolean {
    this.require(wire, 0);
    const value = this.varint();
    if (value > 1n) throw Error('mihon-boolean');
    return value === 1n;
  }
  float(wire: number): number {
    this.require(wire, 5);
    if (this.data.length - this.position < 4) throw Error('mihon-truncated');
    const value = new DataView(this.data.buffer, this.data.byteOffset + this.position, 4).getFloat32(0, true);
    this.position += 4;
    if (!Number.isFinite(value) || value < -1 || value > 1000000000) throw Error('mihon-chapter-number');
    return value;
  }
  skip(wire: number) {
    if (wire === 0) { this.varint(); return; }
    if (wire === 2) { this.bytes(wire); return; }
    const size = wire === 1 ? 8 : wire === 5 ? 4 : 0;
    if (!size || this.data.length - this.position < size) throw Error('mihon-truncated');
    this.position += size;
  }
}

function once(fields: Set<number>, field: number) {
  if (fields.has(field)) throw Error('mihon-duplicate-field');
  fields.add(field);
}
function validLabel(value: string, limit: number): boolean {
  return !!value.trim() && [...value].length <= limit && !/[\x00-\x1f\x7f-\x9f]|:\/\//.test(value);
}
function label(value: string, fallback: string, report: MihonReport): string {
  if (validLabel(value, 500)) return value;
  report.labelsReplaced++;
  return fallback;
}
function url(value: string): string {
  if (!value || encoder.encode(value).length > MAX_URL_BYTES) throw Error('mihon-missing-identity');
  return value;
}
function identity(domain: string, first: string, second: string): string {
  const hash = sha256.create();
  for (const text of [domain, first, second]) {
    const bytes = encoder.encode(text), size = new Uint8Array(8);
    new DataView(size.buffer).setBigUint64(0, BigInt(bytes.length), false);
    hash.update(size).update(bytes);
  }
  return Array.from(hash.digest(), value => value.toString(16).padStart(2, '0')).join('');
}

/** Only public identity strings may become new persisted runtime records.
 * Do not strip credentials and then silently match a different identity. */
export function canReconstructMihonIdentity(value: string): boolean {
  if (!value || value.trim() !== value || value.length > MAX_URL_BYTES || /[\x00-\x1f\x7f-\x9f\\]|%0[0-9a-f]|%1[0-9a-f]|%7f/i.test(value) || value.startsWith('//')) return false;
  try {
    const parsed = new URL(value, 'https://tsugi-import.invalid/');
    const absolute = /^[a-z][a-z0-9+.-]*:/i.test(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash || value.includes('#')) return false;
    if (absolute) {
      const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
      if (!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':')
          || /(?:^|\.)(?:localhost|local|internal|invalid|test)$/.test(host) || host.endsWith('.localdomain')) return false;
    }
    const allowed = new Set(['id', 'manga', 'chapter', 'title', 'page', 'volume', 'lang', 'language', 'slug']);
    for (const [name, value] of parsed.searchParams) {
      if (!allowed.has(name.toLowerCase()) || !/^[a-z0-9_.~-]{1,200}$/i.test(value)) return false;
    }
    if (/(?:^|\/)(?:auth|token|secret|api[-_]?key|password|credentials?|sessions?|signed)(?:\/|$)/i.test(decodeURIComponent(parsed.pathname))) return false;
    return true;
  } catch { return false; }
}

type RawChapter = { url: string; name: string; read: boolean; bookmark: boolean; page: number; chapterNumber: number; sourceOrder: number };
type RawManga = { source: string; url: string; title: string; favorite: boolean; categories: string[]; chapters: RawChapter[]; history: Map<string, bigint>; trackers: { trackerId: number; remoteId: string }[] };
type RawCategory = { name: string; order: string };

function readChapter(reader: WireReader, report: MihonReport, fallback: string): RawChapter {
  const fields = new Set<number>();
  const chapter: RawChapter = { url: '', name: '', read: false, bookmark: false, page: 0, chapterNumber: 0, sourceOrder: 0 };
  while (!reader.done) {
    const { field, wire } = reader.tag();
    if ([1, 2, 4, 5, 6, 9, 10].includes(field)) once(fields, field);
    switch (field) {
      case 1: chapter.url = url(reader.string(wire, MAX_URL_BYTES)); break;
      case 2: chapter.name = reader.string(wire); break;
      case 4: chapter.read = reader.boolean(wire); break;
      case 5: chapter.bookmark = reader.boolean(wire); break;
      case 6: {
        const page = reader.long(wire);
        if (page < 0n || page > 2147483647n) throw Error('mihon-page-limit');
        chapter.page = Number(page); break;
      }
      case 9: chapter.chapterNumber = reader.float(wire); break;
      case 10: {
        const order = reader.long(wire);
        if (order < 0n || order > 2147483647n) throw Error('mihon-source-order');
        chapter.sourceOrder = Number(order); break;
      }
      default: report.metadataFieldsOmitted++; reader.skip(wire);
    }
  }
  url(chapter.url);
  chapter.name = label(chapter.name, fallback, report);
  return chapter;
}

function readHistory(reader: WireReader, report: MihonReport): { url: string; at: bigint } {
  const fields = new Set<number>();
  let chapterUrl = '', at = 0n;
  while (!reader.done) {
    const { field, wire } = reader.tag();
    if (field === 1 || field === 2) once(fields, field);
    if (field === 1) chapterUrl = url(reader.string(wire, MAX_URL_BYTES));
    else if (field === 2) { at = reader.long(wire); if (at < 0n) throw Error('mihon-history-time'); }
    else { report.metadataFieldsOmitted++; reader.skip(wire); } // No history duration or fork settings import.
  }
  return { url: url(chapterUrl), at: at / 1000n };
}

function readManga(reader: WireReader, budget: Budget, report: MihonReport, labels: MihonLabels): RawManga {
  const fields = new Set<number>();
  const manga: RawManga = { source: '0', url: '', title: '', favorite: true, categories: [], chapters: [], history: new Map(), trackers: [] };
  while (!reader.done) {
    const { field, wire } = reader.tag();
    if ([1, 2, 3, 100].includes(field)) once(fields, field);
    switch (field) {
      case 1: manga.source = reader.long(wire).toString(); break;
      case 2: manga.url = url(reader.string(wire, MAX_URL_BYTES)); break;
      case 3: manga.title = reader.string(wire); break;
      case 16:
        if (++budget.chapters > MAX_CHAPTERS || manga.chapters.length >= MAX_TITLE_CHAPTERS) throw Error('mihon-chapter-limit');
        manga.chapters.push(readChapter(reader.message(wire), report, labels.chapter)); break;
      case 17: {
        // Kotlin's protobuf decoder accepts packed and unpacked repeated Longs.
        const packed = wire === 2 ? reader.message(wire, 1000) : null;
        while (!packed || !packed.done) {
          if (manga.categories.length >= 100) throw Error('mihon-category-limit');
          manga.categories.push((packed ? packed.long(0) : reader.long(wire)).toString());
          if (!packed) break;
        }
        break;
      }
      case 18: {
        if (++report.trackingRecords > 20000) throw Error('mihon-tracker-limit');
        const tracker = readTracker(reader.message(wire));
        if (tracker) manga.trackers.push(tracker);
        break;
      }
      case 100: manga.favorite = reader.boolean(wire); break;
      case 104: {
        if (++budget.history > MAX_HISTORY) throw Error('mihon-history-limit');
        report.historyRecords++;
        const history = readHistory(reader.message(wire), report);
        manga.history.set(history.url, history.at > (manga.history.get(history.url) ?? 0n) ? history.at : manga.history.get(history.url) ?? 0n);
        break;
      }
      default: report.metadataFieldsOmitted++; reader.skip(wire);
    }
  }
  url(manga.url);
  manga.title = label(manga.title, labels.manga, report);
  if (new Set(manga.chapters.map(chapter => chapter.url)).size !== manga.chapters.length) throw Error('mihon-duplicate-chapter');
  return manga;
}

// Mihon v0.21.3 BackupTracking.getTrackImpl prefers legacy mediaIdInt (3)
// when nonzero, otherwise mediaId (100). libraryId (2) is account-local and
// must never be mistaken for the public manga ID or carried across accounts.
function readTracker(reader: WireReader): { trackerId: number; remoteId: string } | null {
  const fields = new Set<number>();
  let tracker = 0n, legacy = 0n, current = 0n;
  while (!reader.done) {
    const { field, wire } = reader.tag();
    if ([1, 3, 100].includes(field)) {
      once(fields, field);
      const value = reader.long(wire);
      if (field === 1) tracker = value;
      else if (field === 3) legacy = value;
      else current = value;
    } else reader.skip(wire);
  }
  const id = legacy !== 0n ? legacy : current;
  return (tracker === 1n || tracker === 2n) && id > 0n
    ? { trackerId: Number(tracker), remoteId: id.toString() } : null;
}

function readCategory(reader: WireReader, report: MihonReport): RawCategory {
  const fields = new Set<number>();
  let name = '', order = '0';
  while (!reader.done) {
    const { field, wire } = reader.tag();
    if (field === 1 || field === 2) once(fields, field);
    if (field === 1) name = reader.string(wire);
    else if (field === 2) order = reader.long(wire).toString();
    else { report.metadataFieldsOmitted++; reader.skip(wire); }
  }
  return { name, order };
}

function readSource(reader: WireReader, report: MihonReport, fallback: string): { id: string; name: string } {
  const fields = new Set<number>();
  let name = '', id = '0';
  while (!reader.done) {
    const { field, wire } = reader.tag();
    if (field === 1 || field === 2) once(fields, field);
    if (field === 1) name = reader.string(wire);
    else if (field === 2) id = reader.long(wire).toString();
    else { report.metadataFieldsOmitted++; reader.skip(wire); }
  }
  return { id, name: label(name, fallback, report) };
}

async function expand(bytes: Uint8Array): Promise<{ bytes: Uint8Array; compression: 'gzip' | 'none' }> {
  if (!bytes.length || bytes.byteLength > MIHON_BACKUP_LIMIT) throw Error('mihon-size');
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return { bytes, compression: 'none' };
  if (typeof DecompressionStream === 'undefined') throw Error('mihon-gzip-unavailable');
  // Read bounded output instead of Response.arrayBuffer(), which could inflate
  // an arbitrarily large gzip before the caller gets a chance to reject it.
  const reader = new Blob([Uint8Array.from(bytes)]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MIHON_EXPANDED_LIMIT) throw Error('mihon-expanded-size');
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return { bytes: output, compression: 'gzip' };
}

/** Parse locally. The portable projection omits raw identities. Operation-local
 * reconstruction identities are non-enumerable and never written to reports. */
export async function parseMihonBackup(input: Uint8Array, labels: MihonLabels = { manga: 'untitled-manga', chapter: 'unnamed-chapter', source: 'unnamed-source' }): Promise<MihonImport> {
  if (Object.values(labels).some(value => !validLabel(value, 500))) throw Error('mihon-invalid-fallback');
  const expanded = await expand(input);
  const report: MihonReport = {
    titles: 0, chapters: 0, categories: 0, sources: 0, nonLibraryTitles: 0, partialPositions: 0,
    labelsReplaced: 0, historyRecords: 0, historyMatched: 0, historyUnmatched: 0,
    trackingRecords: 0, appPreferences: 0, sourcePreferences: 0, extensionStores: 0,
    metadataFieldsOmitted: 0, categoriesSkipped: 0, categoryAssignmentsSkipped: 0,
  };
  const budget: Budget = { fields: 0, messages: 0, chapters: 0, history: 0 };
  const reader = new WireReader(expanded.bytes, budget);
  const entries: RawManga[] = [], categories: RawCategory[] = [], sources: MihonImport['sources'] = [];
  while (!reader.done) {
    const { field, wire } = reader.tag();
    switch (field) {
      case 1:
        if (entries.length >= MAX_TITLES) throw Error('mihon-title-limit');
        entries.push(readManga(reader.message(wire), budget, report, labels)); break;
      case 2:
        if (categories.length >= 100) throw Error('mihon-category-limit');
        categories.push(readCategory(reader.message(wire), report)); break;
      case 101:
        if (sources.length >= 1000) throw Error('mihon-source-limit');
        sources.push(readSource(reader.message(wire), report, labels.source)); break;
      case 104: report.appPreferences++; reader.bytes(wire); break;
      case 105: report.sourcePreferences++; reader.bytes(wire); break;
      case 106: report.extensionStores++; reader.bytes(wire); break;
      default: report.metadataFieldsOmitted++; reader.skip(wire);
    }
  }
  if (!entries.length && !categories.length) throw Error('mihon-empty-or-unsupported');
  if (new Set(sources.map(source => source.id)).size !== sources.length) throw Error('mihon-duplicate-source');
  // Repeated orders or names cannot safely map membership to a shelf. Keep all
  // unaffected shelves, but never guess which of the colliding rows was meant.
  const orderCounts = new Map<string, number>(), nameCounts = new Map<string, number>();
  for (const category of categories) {
    orderCounts.set(category.order, (orderCounts.get(category.order) ?? 0) + 1);
    nameCounts.set(category.name, (nameCounts.get(category.name) ?? 0) + 1);
  }
  const shelves = new Map(categories.filter(category => {
    const valid = validLabel(category.name, 80) && category.name.trim().toLowerCase() !== 'default'
      && BigInt(category.order) >= 0n && orderCounts.get(category.order) === 1 && nameCounts.get(category.name) === 1;
    if (!valid) report.categoriesSkipped++;
    return valid;
  }).map(category => [category.order, category.name]));
  const seen = new Set<string>();
  const manga: BackupManga[] = [];
  const reconstruction: MihonReconstruction = { manga: [], categories: [...shelves.values()] };
  const reconstructionSkipped: MihonImport['reconstructionSkipped'] = [];
  for (const row of entries) {
    const mangaIdentity = identity('tsugi-manga-v1', row.source, row.url);
    if (seen.has(mangaIdentity)) throw Error('mihon-duplicate-manga');
    seen.add(mangaIdentity);
    if (!row.favorite) { report.nonLibraryTitles++; continue; }
    const categoryNames: string[] = [];
    for (const order of new Set(row.categories)) {
      const name = shelves.get(order);
      if (name) categoryNames.push(name); else report.categoryAssignmentsSkipped++;
    }
    const chapterUrls = new Set(row.chapters.map(chapter => chapter.url));
    for (const historyUrl of row.history.keys()) {
      if (chapterUrls.has(historyUrl)) report.historyMatched++; else report.historyUnmatched++;
    }
    const chapters: BackupChapter[] = row.chapters.map(chapter => {
      if (!chapter.read && chapter.page > 0) report.partialPositions++;
      return {
        identity: identity('tsugi-chapter-v1', mangaIdentity, chapter.url), name: chapter.name,
        isRead: chapter.read, isBookmarked: chapter.bookmark, lastPageRead: chapter.page,
        // The official format has no pageCount. Zero never invents one; an
        // explicitly enabled, exact local binding can be made before review.
        pageCount: 0, lastReadAt: (row.history.get(chapter.url) ?? 0n).toString(),
      };
    });
    manga.push({ identity: mangaIdentity, sourceId: row.source, title: row.title, categories: categoryNames, chapters });
    const titleSkipped = !canReconstructMihonIdentity(row.url);
    const safeChapters = row.chapters.filter(chapter => canReconstructMihonIdentity(chapter.url));
    const chaptersSkipped = titleSkipped ? row.chapters.length : row.chapters.length - safeChapters.length;
    if (titleSkipped || chaptersSkipped) reconstructionSkipped.push({ title: row.title, sourceId: row.source, titleSkipped, chaptersSkipped });
    if (!titleSkipped) reconstruction.manga.push({ sourceId: row.source, url: row.url, title: row.title, categories: categoryNames,
      chapters: safeChapters.map(chapter => ({ ...chapter, lastReadAt: (row.history.get(chapter.url) ?? 0n).toString() })),
      trackers: row.trackers });
  }
  const backup = parseMangaBackup(JSON.stringify({ format: 'tsugi-manga-progress', version: 2, manga, categories: [...shelves.values()] }));
  report.titles = manga.length;
  report.chapters = manga.reduce((count, row) => count + row.chapters.length, 0);
  report.categories = shelves.size;
  report.sources = sources.length;
  const parsed = { format: 'mihon-tachibk' as const, compression: expanded.compression, backup, sources, report, reconstructionSkipped } as MihonImport;
  Object.defineProperty(parsed, 'reconstruction', { value: reconstruction, enumerable: false });
  return parsed;
}

/** Page counts are absent from Mihon backups. A user may explicitly bind an
 * in-range forward position to the EXACT cached local chapter. This never
 * fetches chapters or assumes two editions share a page count. The shared
 * preview/native apply checks this count and all current progress again. */
export function prepareMihonProgress(parsed: MihonImport, local: LocalManga[], includePartialPages = false): { backup: MangaBackup; pages: MihonPageReview } {
  const backup = parseMangaBackup(JSON.stringify(parsed.backup));
  const targets = new Map(local.map(row => [row.identity, row]));
  if (targets.size !== local.length) throw Error('mihon-duplicate-local-manga');
  const pages: MihonPageReview = { requested: 0, eligible: 0, disabled: 0, unmatched: 0, newerOrComplete: 0, unavailableOrOutOfRange: 0, alreadyAhead: 0 };
  for (const row of backup.manga) {
    const target = targets.get(row.identity);
    const exact = target?.sourceId === row.sourceId ? target : undefined;
    const chapters = new Map<string, LocalManga['chapters'][number]>(exact ? exact.chapters.map(chapter => [chapter.identity, chapter]) : []);
    if (exact && chapters.size !== exact.chapters.length) throw Error('mihon-duplicate-local-chapter');
    for (const chapter of row.chapters) {
      chapter.pageCount = 0;
      if (chapter.isRead || chapter.lastPageRead === 0) continue;
      pages.requested++;
      if (!includePartialPages) { pages.disabled++; continue; }
      const now = chapters.get(chapter.identity);
      if (!now) { pages.unmatched++; continue; }
      if (now.isRead || BigInt(chapter.lastReadAt) < BigInt(now.lastReadAt)) { pages.newerOrComplete++; continue; }
      if (chapter.lastPageRead <= now.lastPageRead) { pages.alreadyAhead++; continue; }
      if (!Number.isInteger(now.pageCount) || now.pageCount <= 0 || now.pageCount > 2147483647 || chapter.lastPageRead >= now.pageCount) {
        pages.unavailableOrOutOfRange++; continue;
      }
      chapter.pageCount = now.pageCount;
      pages.eligible++;
    }
  }
  return { backup, pages };
}
