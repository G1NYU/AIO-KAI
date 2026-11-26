import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseMihonBackup } from '../src/lib/backup/mihon';

const bytes = readFileSync(new URL('./fixtures/mihon-writer/mihon-v0.21.3.tachibk', import.meta.url));
const provenance = JSON.parse(readFileSync(new URL('./fixtures/mihon-writer/provenance.json', import.meta.url), 'utf8'));

describe('Mihon v0.21.3 upstream writer compatibility', () => {
  it('checks the exact upstream-writer fixture identity', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(provenance.gzipSha256);
    const raw = gunzipSync(bytes);
    expect(createHash('sha256').update(raw).digest('hex')).toBe(provenance.rawSha256);
    expect(provenance.revision).toBe('feadad5e1e2bf638be6e2ca317d11657b09d4596');
    expect(provenance.writerBlob).toBe('bb1b8c3d7449fc2c11429b26e8e8d5cacb40f322');
  });

  it('imports upstream defaults, signed identities, categories and reading state', async () => {
    const parsed = await parseMihonBackup(bytes);
    expect(parsed.compression).toBe('gzip');
    expect(parsed.report).toMatchObject({ titles: 2, nonLibraryTitles: 1, chapters: 3,
      categories: 3, sources: 2, partialPositions: 1, historyRecords: 2, trackingRecords: 2 });
    const first = parsed.backup.manga.find(manga => manga.sourceId === '9007199254740993');
    expect(first).toMatchObject({ title: 'Writer fixture — 継ぎ', categories: ['Reading', 'Later'] });
    expect(first?.chapters.map(chapter => ({ read: chapter.isRead, bookmark: chapter.isBookmarked,
      page: chapter.lastPageRead, at: chapter.lastReadAt }))).toEqual([
      { read: true, bookmark: false, page: 19, at: '1700000000' },
      { read: false, bookmark: true, page: 0, at: '0' },
      { read: false, bookmark: false, page: 7, at: '1700000001' },
    ]);
    expect(parsed.backup.manga.find(manga => manga.sourceId === '-9007199254740993'))
      .toMatchObject({ title: 'Missing source fixture', chapters: [] });
    expect(parsed.backup.version === 2 && parsed.backup.categories).toContain('Empty shelf');
  });

  it('excludes source settings, app settings and raw identities from portable serialization', async () => {
    const parsed = await parseMihonBackup(bytes);
    expect(parsed.report).toMatchObject({ appPreferences: 1, sourcePreferences: 1, extensionStores: 1 });
    const exported = JSON.stringify(parsed);
    for (const marker of ['must-not-survive', 'example.invalid', '/writer-fixture/', 'fixture-private-setting']) {
      expect(exported).not.toContain(marker);
    }
    expect((await parseMihonBackup(gunzipSync(bytes))).backup).toEqual(parsed.backup);
  });
});
