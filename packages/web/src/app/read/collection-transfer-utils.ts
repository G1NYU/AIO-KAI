import type { ReadingChapter } from './reader-utils';

export function titleKey(value: string) {
  return value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

function csvColumns(line: string): string[] {
  const result: string[] = [];
  let field = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { result.push(field.trim()); field = ''; }
    else field += char;
  }
  if (quoted) throw new Error('Unclosed CSV quote. Use one record per line.');
  result.push(field.trim());
  return result;
}

// Adapted from the title/CSV/Mihon entry points in G1NYU/mihon-to-anymex (MIT).
// Only titles are imported: external progress is not a source chapter ID.
export function batchTitles(input: string, format: 'titles' | 'csv' | 'mihon'): string[] {
  if (input.length > 2_000_000) throw new Error('Import exceeds 2 MB.');
  let titles: string[];
  if (format === 'mihon') {
    const value = JSON.parse(input);
    if (!Array.isArray(value?.backupManga)) throw new Error('Expected a converted Mihon JSON backup with backupManga.');
    titles = value.backupManga.map((entry: { title?: unknown }) => typeof entry?.title === 'string' ? entry.title : '');
  } else {
    const lines = input.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
    if (format === 'titles') titles = lines;
    else {
      const rows = lines.map(csvColumns);
      const column = rows[0]?.findIndex(cell => titleKey(cell) === 'title') ?? -1;
      titles = (column >= 0 ? rows.slice(1) : rows).map(row => row[column >= 0 ? column : 0] || '');
    }
  }
  const seen = new Set<string>();
  return titles.map(title => title.trim()).filter(title => {
    const key = titleKey(title);
    if (!key || seen.has(key)) return false;
    if (title.length > 200) throw new Error('A title exceeds the 200-character source search limit.');
    seen.add(key); return true;
  });
}

function chapterKey(chapter: ReadingChapter) {
  return typeof chapter.chapterNumber === 'number' && Number.isFinite(chapter.chapterNumber) && chapter.chapterNumber > 0
    ? 'number:' + chapter.chapterNumber
    : 'name:' + titleKey(chapter.name);
}

type MigrationPage = { originalId: number; targetId: number; originalName: string; targetName: string; scanlator: string; page: number; pageCount: number };
type PageSnapshot = { chapters: { id: number; identity: string; name: string; isRead: boolean; isBookmarked: boolean; lastPageRead: number; pageCount: number; lastReadAt: string }[] };

export function migrationPlan(original: ReadingChapter[], replacement: ReadingChapter[]) {
  const groups = (chapters: ReadingChapter[]) => {
    const result = new Map<string, ReadingChapter[]>();
    for (const chapter of chapters) {
      const key = chapterKey(chapter);
      result.set(key, [...(result.get(key) || []), chapter]);
    }
    return result;
  };
  const from = groups(original), to = groups(replacement);
  const read: number[] = [], bookmarked: number[] = [], unmatched: string[] = [], partial: string[] = [];
  const pages: MigrationPage[] = [];
  let matched = 0;
  for (const chapter of original) {
    if (!chapter.isRead && !chapter.isBookmarked && !chapter.lastPageRead) continue;
    const key = chapterKey(chapter), candidates = to.get(key) || [];
    if (from.get(key)?.length !== 1 || candidates.length !== 1 || key === 'name:') {
      unmatched.push(chapter.name); continue;
    }
    const target = candidates[0];
    matched++;
    if (chapter.isRead && !target.isRead) read.push(target.id);
    if (chapter.isBookmarked && !target.isBookmarked) bookmarked.push(target.id);
    // Page indexes are edition-dependent. Require a unique chapter, an
    // exact normalized name/scanlation label and known equal page counts.
    // This is only an opt-in candidate, not proof of identical page content.
    if (!chapter.isRead && chapter.lastPageRead > 0 && !target.isRead) {
      const scanlator = titleKey(chapter.scanlator || '');
      if (scanlator && scanlator === titleKey(target.scanlator || '') &&
          titleKey(chapter.name) === titleKey(target.name) &&
          Number.isInteger(chapter.lastPageRead) && Number.isInteger(chapter.pageCount) &&
          chapter.lastPageRead < chapter.pageCount && target.pageCount === chapter.pageCount &&
          target.lastPageRead === 0) {
        pages.push({ originalId: chapter.id, targetId: target.id, originalName: chapter.name,
          targetName: target.name, scanlator: chapter.scanlator || '', page: chapter.lastPageRead, pageCount: chapter.pageCount });
      } else partial.push(chapter.name);
    }
  }
  return { matched, read, bookmarked, unmatched, partial, pages };
}

/** Build additive patches from validated native snapshots; never transfer
 * page offsets into a previously visited target, even if its position is 0. */
export function migrationPagePatches(pages: MigrationPage[], original: PageSnapshot, replacement: PageSnapshot) {
  if (pages.length > 2000 || new Set(pages.map(page => page.targetId)).size !== pages.length)
    throw Error('migration-page-limit');
  const from = new Map(original.chapters.map(chapter => [chapter.id, chapter]));
  const to = new Map(replacement.chapters.map(chapter => [chapter.id, chapter]));
  return pages.map(page => {
    const old = from.get(page.originalId), target = to.get(page.targetId);
    if (!old || !target || old.isRead || target.isRead || old.name !== page.originalName ||
        target.name !== page.targetName || old.lastPageRead !== page.page ||
        old.pageCount !== page.pageCount || target.pageCount !== page.pageCount ||
        target.lastPageRead !== 0 || target.lastReadAt !== '0' ||
        !Number.isInteger(page.page) || page.page <= 0 || page.page >= page.pageCount)
      throw Error('migration-page-changed');
    return { identity: target.identity, expectedRead: target.isRead, expectedBookmarked: target.isBookmarked,
      expectedLastPage: target.lastPageRead, expectedPageCount: target.pageCount,
      expectedLastReadAt: target.lastReadAt, markRead: false, bookmark: false, page: page.page };
  });
}
