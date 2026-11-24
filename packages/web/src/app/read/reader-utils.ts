export type ReaderMode = 'scroll' | 'single' | 'spread';

export type ReadingChapter = {
  id: number;
  name: string;
  chapterNumber?: number;
  sourceOrder?: number;
  scanlator?: string | null;
  isRead: boolean;
  lastPageRead: number;
  pageCount: number;
};

export function chapterGroups(chapters: ReadingChapter[]) {
  // Same chapter number can have multiple translations. Keep each version
  // independently selectable rather than deleting records or their progress.
  const groups = new Map<string, ReadingChapter[]>();
  for (const chapter of chapters) {
    const number = chapter.chapterNumber;
    const key = typeof number === 'number' && Number.isFinite(number) && number >= 0
      ? 'number:' + number + (number === 0 ? ':' + chapter.name.trim().toLowerCase() : '') : 'name:' + chapter.name.trim().toLowerCase();
    const group = groups.get(key);
    if (group) group.push(chapter);
    else groups.set(key, [chapter]);
  }
  const result = [...groups.values()];
  // Numeric chapter lists can be returned newest-first by a source.
  if (result.every((group) => typeof group[0].chapterNumber === 'number' && group[0].chapterNumber! >= 0))
    result.sort((a, b) => a[0].chapterNumber! - b[0].chapterNumber!);
  return result;
}

export function neighboringChapter(chapters: ReadingChapter[], current: ReadingChapter, delta: number) {
  const groups = chapterGroups(chapters);
  const position = groups.findIndex((group) => group.some((chapter) => chapter.id === current.id));
  const group = position >= 0 ? groups[position + delta] : undefined;
  return group?.find((chapter) => current.scanlator && chapter.scanlator === current.scanlator) || group?.[0];
}

export function readerWindow(index: number, count: number, mode: ReaderMode): number[] {
  const candidates = mode === 'spread' ? [index, index + 1, index + 2, index + 3, index - 1, index - 2]
    : [index, index + 1, index + 2, index - 1, index - 2];
  return [...new Set(candidates.filter((page) => page >= 0 && page < count))];
}

export function cleanSynopsis(text: string): string {
  return text.replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n').trim();
}
