import { describe, expect, it } from 'vitest';
import { normalizedContentWarning, sourceLanguages, sourceMatchesFilters, type ContentFilter, type SourceMetadata } from '../src/app/read/source-metadata';

const source: SourceMetadata = {
  id: '9007199254740993', name: 'Original catalogue', displayName: '星 Original catalogue',
  lang: 'en', supportsLatest: true, contentWarning: 'MIXED', isConfigurable: true,
  extension: { name: 'Original bundle', pkgName: 'org.tsugi.original', versionName: '1.6.4',
    versionCodeLong: '4', isInstalled: true, hasUpdate: true, isObsolete: false },
};

describe('declared source content metadata', () => {
  it('recognizes only the three pinned flags and never treats missing or new metadata as Not flagged', () => {
    for (const value of ['SAFE', 'MIXED', 'NSFW'] as const) expect(normalizedContentWarning(value)).toBe(value);
    for (const value of [undefined, null, '', 'safe', 'UNKNOWN', 'ADULT', false, 0, {}, []]) {
      expect(normalizedContentWarning(value)).toBe('UNKNOWN');
    }
  });

  it('retains unclassified sources under All and excludes them from every explicit content filter', () => {
    for (const contentWarning of [undefined, null, 'FUTURE_CLASSIFICATION']) {
      const unknown = { ...source, contentWarning };
      expect(sourceMatchesFilters(unknown, '', '', '')).toBe(true);
      for (const filter of ['SAFE', 'MIXED', 'NSFW'] as ContentFilter[]) {
        expect(sourceMatchesFilters(unknown, '', '', filter)).toBe(false);
      }
    }
  });

  it('matches declared flags exactly instead of combining Mixed and adult with Not flagged', () => {
    for (const warning of ['SAFE', 'MIXED', 'NSFW'] as const) {
      const row = { ...source, contentWarning: warning };
      expect(sourceMatchesFilters(row, '', '', '')).toBe(true);
      for (const filter of ['SAFE', 'MIXED', 'NSFW'] as const) {
        expect(sourceMatchesFilters(row, '', '', filter)).toBe(warning === filter);
      }
    }
  });
});

describe('installed-source local filters', () => {
  it('intersects text, exact language and content, with multilingual remaining an ordinary language code', () => {
    expect(sourceMatchesFilters(source, 'original', 'en', 'MIXED')).toBe(true);
    expect(sourceMatchesFilters(source, 'missing', 'en', 'MIXED')).toBe(false);
    expect(sourceMatchesFilters(source, 'original', 'ja', 'MIXED')).toBe(false);
    expect(sourceMatchesFilters(source, 'original', 'en', 'SAFE')).toBe(false);
    expect(sourceMatchesFilters(source, '', 'all', '')).toBe(false);
    expect(sourceMatchesFilters({ ...source, lang: 'all' }, '', 'all', 'MIXED')).toBe(true);
    expect(sourceMatchesFilters({ ...source, lang: 'en-US' }, '', 'en', '')).toBe(false);
    expect(sourceMatchesFilters({ ...source, lang: '' }, '', '', '')).toBe(true);
  });

  it('finds original titles, bundle identity and exact signed64 IDs without a numeric conversion', () => {
    for (const query of ['  ORIGINAL CATALOGUE  ', '星', 'Original bundle', 'org.tsugi.original', '9007199254740993']) {
      expect(sourceMatchesFilters(source, query, '', '')).toBe(true);
    }
    expect(sourceMatchesFilters(source, '9007199254740992', '', '')).toBe(false);
    expect(sourceMatchesFilters({ ...source, id: '-9223372036854775808' }, '-9223372036854775808', '', '')).toBe(true);
    expect(sourceMatchesFilters({ ...source, extension: undefined, displayName: undefined }, 'original catalogue', '', '')).toBe(true);
    expect(sourceMatchesFilters({ ...source, extension: undefined }, 'Original bundle', '', '')).toBe(false);
  });

  it('derives complete language choices without mutating the inventory or discarding an unfamiliar code', () => {
    const rows = Object.freeze([{ lang: 'ja' }, { lang: 'en' }, { lang: 'all' }, { lang: '' }, { lang: 'en' }, { lang: 'legacy_custom' }]);
    expect(sourceLanguages(rows)).toEqual(['all', 'en', 'ja', 'legacy_custom']);
    expect(rows.map(row => row.lang)).toEqual(['ja', 'en', 'all', '', 'en', 'legacy_custom']);
    expect(sourceLanguages([])).toEqual([]);
  });
});
