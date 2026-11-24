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
    for (const path of ['page.tsx', 'chapter-reader.tsx', 'reader-settings.tsx']) {
      const source = readFileSync(new URL('../src/app/read/' + path, import.meta.url), 'utf8');
      expect(source).not.toMatch(/\bt\x60|<Trans>/);
      expect(source).toContain('id=');
    }
    const landing = readFileSync(new URL('../src/app/desktop-landing/page.tsx', import.meta.url), 'utf8');
    expect(landing).toContain("id: 'Read', message: 'Read'");
    const bridge = readFileSync(new URL('../src/lib/hosts/shell/reading.ts', import.meta.url), 'utf8');
    expect(bridge).not.toMatch(/\bt\x60/);
  });
});
