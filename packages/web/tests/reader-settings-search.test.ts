import { describe, expect, it } from 'vitest';
import { findReaderSettings } from '../src/app/read/reader-settings-search';

describe('localized reader settings search', () => {
  const items = Object.freeze([
    { id: 'size', text: ['Pages', 'Page size', 'Fit width', 'Zoom in'] },
    { id: 'wheel', text: ['Controls', 'Ctrl + scroll to zoom', 'Adjust page width without opening settings.'] },
    { id: 'background', text: ['Apparence', 'Arrière-plan', 'Papier crème'] },
    { id: 'direction', text: ['表示', '右から左', '読む方向'] },
  ]);

  it('finds labels and hints across sections, requiring all words within one group', () => {
    expect(findReaderSettings(items, '  ZOOM  ')).toEqual(['size', 'wheel']);
    expect(findReaderSettings(items, 'zoom\twidth')).toEqual(['size', 'wheel']);
    expect(findReaderSettings(items, 'controls width')).toEqual(['wheel']);
    expect(findReaderSettings(items, 'pages controls')).toEqual([]);
  });

  it('matches translated and composed text without requiring English keywords', () => {
    expect(findReaderSettings(items, 'arriere CREME')).toEqual(['background']);
    expect(findReaderSettings(items, 'arrie\u0300re')).toEqual(['background']);
    expect(findReaderSettings(items, '右から左')).toEqual(['direction']);
    expect(findReaderSettings(items, 'background')).toEqual([]);
  });

  it('uses literal text rather than interpreting search input as a regular expression', () => {
    expect(findReaderSettings(items, '.*')).toEqual([]);
    expect(findReaderSettings(items, '[')).toEqual([]);
    expect(findReaderSettings(items, 'Ctrl +')).toEqual(['wheel']);
  });

  it('returns all original IDs in order for an empty search without mutating the index', () => {
    const before = JSON.stringify(items);
    expect(findReaderSettings(items, '')).toEqual(['size', 'wheel', 'background', 'direction']);
    expect(findReaderSettings(items, ' \n\t ')).toEqual(['size', 'wheel', 'background', 'direction']);
    expect(findReaderSettings([], 'zoom')).toEqual([]);
    expect(JSON.stringify(items)).toBe(before);
  });
});
