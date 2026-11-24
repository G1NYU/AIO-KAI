import { describe, expect, it } from 'vitest';
import { chapterGroups, neighboringChapter, readerWindow, cleanSynopsis, type ReadingChapter } from '../src/app/read/reader-utils';
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
