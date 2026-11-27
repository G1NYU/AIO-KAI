import { describe, expect, it } from 'vitest';
import { chapterGroups, neighboringChapter, readerWindow, cleanSynopsis, nextPageIndex, visibleReadingPage, type ReadingChapter } from '../src/app/read/reader-utils';
import { normalizeReaderPreferences, READER_DEFAULTS } from '../src/app/read/reader-preferences';
import { readFileSync } from 'node:fs';
const chapter = (id: number, number: number, scanlator: string): ReadingChapter => ({ id, name: 'Chapter ' + number, chapterNumber: number, scanlator, isRead: false, lastPageRead: 0, pageCount: 10 });
describe('reader navigation', () => {
  it('groups versions without losing identifiers, sorts numeric chapters, prefers the same translator', () => {
    const chapters = [chapter(4, 2, 'A'), chapter(5, 2, 'B'), chapter(1, 1, 'B'), chapter(2, 1, 'A')];
    expect(chapterGroups(chapters).map((group) => group.map((item) => item.id))).toEqual([[1, 2], [4, 5]]);
    expect(neighboringChapter(chapters, chapters[2], 1)?.id).toBe(5);
    expect(neighboringChapter(chapters, chapters[0], 1)).toBeUndefined();
  });
  it('bounds prefetches at chapter boundaries and prioritizes visible pages', () => {
    expect(readerWindow(0, 2, 'scroll')).toEqual([0, 1]);
    expect(readerWindow(9, 10, 'scroll')).toEqual([9, 8, 7]);
    expect(readerWindow(4, 20, 'spread')).toEqual([4, 5, 6, 7, 3, 2]);
  });
  it('displays source markdown as safe readable text', () => {
    expect(cleanSynopsis('**Year:** 2018\n---\n[Title](https://example.test/a)')).toBe('Year: 2018\n\nTitle');
  });
});

describe('reader experience regression guards', () => {
  it('migrates existing reader preferences and rejects malformed values', () => {
    expect(normalizeReaderPreferences(null)).toEqual(READER_DEFAULTS);
    expect(normalizeReaderPreferences({ mode: 'spread', width: 999, gap: true, background: 'paper', autoNext: true })).toMatchObject({ mode: 'spread', width: 100, gap: true, background: 'paper', autoNext: true, resume: true });
    expect(normalizeReaderPreferences({ mode: 'broken', width: NaN, fit: 'bad' })).toMatchObject({ mode: 'scroll', width: 55, fit: 'width' });
  });
  it('clamps page turning and selects the nearest visible page even in gaps', () => {
    expect(nextPageIndex(0, 3, 'spread', -1)).toBe(0);
    expect(nextPageIndex(1, 3, 'spread', 1)).toBe(2);
    expect(nextPageIndex(3, 10, 'scroll', 1)).toBe(4);
    expect(visibleReadingPage([{ index: 4, top: 0, bottom: 100 }, { index: 5, top: 115, bottom: 500 }], 110)).toBe(5);
    expect(visibleReadingPage([{ index: 4, top: 0, bottom: 100 }, { index: 5, top: 115, bottom: 500 }], 50)).toBe(4);
  });
  it('keeps human-readable translation IDs throughout reader surfaces', () => {
    for (const path of ['page.tsx', 'chapter-reader.tsx', 'reader-settings.tsx', 'mal-manga-library.tsx']) {
      const source = readFileSync(new URL('../src/app/read/' + path, import.meta.url), 'utf8');
      expect(source).not.toMatch(/\bt\x60|<Trans>/);
      expect(source).toContain('id=');
    }
    const malPanel = readFileSync(new URL('../src/components/shell/mal-collection-panel.tsx', import.meta.url), 'utf8');
    expect(malPanel).not.toMatch(/\bt\x60|<Trans>/);
    expect(malPanel).toContain('id=');
    const landing = readFileSync(new URL('../src/app/desktop-landing/page.tsx', import.meta.url), 'utf8');
    expect(landing).toContain("id: 'Read', message: 'Read'");
    const bridge = readFileSync(new URL('../src/lib/hosts/shell/reading.ts', import.meta.url), 'utf8');
    expect(bridge).not.toMatch(/\bt\x60/);
  });
});

import { mayLookUpCover, selectFallbackCover } from '../src/app/read/cover-fallback';

describe('missing library cover fallback', () => {
  const item = { mal_id: 42, title: 'Original Story', titles: [{ title: 'Alternate Story' }], authors: [{ name: 'Doe, Jane' }], images: { jpg: { large_image_url: 'https://cdn.myanimelist.net/images/manga/1/2.jpg' } } };
  it('only permits enabled, saved, missing covers', () => {
    for (const enabled of [false, true]) for (const saved of [false, true]) for (const missing of [false, true])
      expect(mayLookUpCover(enabled, saved, missing)).toBe(enabled && saved && missing);
  });
  it('requires an exact unique title and matching known author', () => {
    const good = { data: [item] };
    expect(selectFallbackCover(good, 'Alternate Story', 'Jane Doe')).toBe(item.images.jpg.large_image_url);
    expect(selectFallbackCover(good, 'Original', 'Jane Doe')).toBeUndefined();
    expect(selectFallbackCover(good, 'Original Story', 'Someone Else')).toBeUndefined();
    expect(selectFallbackCover({ data: [item, { ...item, mal_id: 43 }] }, 'Original Story')).toBeUndefined();
    expect(selectFallbackCover({ data: [{ ...item, images: { jpg: { large_image_url: 'https://elsewhere.test/cover.jpg' } } }] }, 'Original Story')).toBeUndefined();
  });
});

import { batchTitles, migrationPlan, migrationPagePatches } from '../src/app/read/collection-transfer-utils';

describe('collection transfer', () => {
  it('deduplicates normalized titles, preserves commas and accepts converted Mihon JSON', () => {
    expect(batchTitles('  Original Story\noriginal story\nAnother Story\n', 'titles')).toEqual(['Original Story', 'Another Story']);
    expect(batchTitles('title,status,chaptersRead\n"Story, Two",CURRENT,4\n"Story ""Quoted""",PLANNING,0', 'csv')).toEqual(['Story, Two', 'Story "Quoted"']);
    expect(batchTitles('{"backupManga":[{"title":"Original Story","lastChapterRead":42}]}', 'mihon')).toEqual(['Original Story']);
    expect(() => batchTitles('{"mangaLibrary":[]}', 'mihon')).toThrow();
    expect(() => batchTitles('"broken', 'csv')).toThrow();
  });
  it('copies only unambiguous positive flags and retains unmatched and unfinished progress', () => {
    const old = [{ ...chapter(1, 1, 'A'), isRead: true, isBookmarked: true }, { ...chapter(2, 2, 'A'), lastPageRead: 4 }, { ...chapter(3, 3, 'A'), isRead: true }, { ...chapter(4, 4, 'A'), isRead: true }];
    const next = [chapter(11, 1, 'B'), chapter(12, 2, 'B'), chapter(13, 3, 'B'), chapter(14, 3, 'C')];
    expect(migrationPlan(old, next)).toEqual({ matched: 2, read: [11], bookmarked: [11], partial: ['Chapter 2'], unmatched: ['Chapter 3', 'Chapter 4'], pages: [] });
    expect(migrationPlan(old, [{ ...next[0], isRead: true, isBookmarked: true }, ...next.slice(1)]).read).toEqual([]);
    expect(migrationPlan([{ ...old[0] }, { ...old[0], id: 22 }], [next[0]]).read).toEqual([]);
  });
});

describe('reviewed migration page positions', () => {
  const original = { ...chapter(1, 1, 'A'), lastPageRead: 4 };
  const replacement = chapter(11, 1, 'A');
  const snapshot = (row: ReadingChapter, lastReadAt = '0') => ({
    chapters: [{ ...row, identity: String(row.id).padStart(64, '0'), isBookmarked: !!row.isBookmarked, lastReadAt }],
  });
  it('requires a unique, same-label, equal-size unread match with no target progress', () => {
    const plan = migrationPlan([original], [replacement]);
    expect(plan.pages).toEqual([{ originalId: 1, targetId: 11, originalName: 'Chapter 1', targetName: 'Chapter 1', scanlator: 'A', page: 4, pageCount: 10 }]);
    for (const row of [{ ...replacement, scanlator: 'B' }, { ...replacement, scanlator: '' },
      { ...replacement, name: 'Other chapter' }, { ...replacement, pageCount: 0 },
      { ...replacement, pageCount: 11 }, { ...replacement, isRead: true }, { ...replacement, lastPageRead: 2 }])
      expect(migrationPlan([original], [row]).pages).toEqual([]);
    expect(migrationPlan([original], [replacement, { ...replacement, id: 12 }]).pages).toEqual([]);
    expect(migrationPlan([{ ...original, lastPageRead: 10 }], [replacement]).pages).toEqual([]);
  });
  it('builds only guarded additive native patches and refuses prior visits or stale snapshots', () => {
    const pages = migrationPlan([original], [replacement]).pages;
    expect(migrationPagePatches(pages, snapshot(original), snapshot(replacement))).toEqual([{
      identity: '11'.padStart(64, '0'), expectedRead: false, expectedBookmarked: false, expectedLastPage: 0,
      expectedPageCount: 10, expectedLastReadAt: '0', markRead: false, bookmark: false, page: 4,
    }]);
    expect(() => migrationPagePatches(pages, snapshot(original), snapshot(replacement, '1'))).toThrow();
    expect(() => migrationPagePatches(pages, snapshot({ ...original, lastPageRead: 5 }), snapshot(replacement))).toThrow();
    expect(() => migrationPagePatches(pages, snapshot(original), snapshot({ ...replacement, lastPageRead: 1 }))).toThrow();
    expect(() => migrationPagePatches([...pages, ...pages], snapshot(original), snapshot(replacement))).toThrow();
  });
});

describe('shared Tsugi desktop identity', () => {
  it('uses the shared rail in Music, Read and Vault and one brush outline family', () => {
    // Movies deliberately restores its established Sidebar; actual routing and
    // access to the other spaces are covered by movies-layout-browser.mjs.
    for (const path of ['app/music/page.tsx', 'app/read/page.tsx', 'app/vault/native-queue.tsx']) {
      const source = readFileSync(new URL('../src/' + path, import.meta.url), 'utf8');
      expect(source).toContain('<TsugiRail area=');
    }
    const brand = readFileSync(new URL('../src/components/tsugi-brand.tsx', import.meta.url), 'utf8');
    const icon = readFileSync(new URL('../src/components/tsugi-icons.tsx', import.meta.url), 'utf8');
    expect(brand).toContain('fillRule="evenodd"');
    expect(icon).toContain('viewBox="0 0 24 24"');
  });
});
