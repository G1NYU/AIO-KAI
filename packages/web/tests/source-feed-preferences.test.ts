import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_FEED_SOURCES, parseSourceFeedPreferences, readSourceFeedPreferences, saveSourceFeedPreferences,
  SOURCE_FEED_PREFERENCE_EVENT, SOURCE_FEED_PREFERENCE_KEY, SourceFeedPreferencesError, type SourceFeedPreferences,
} from '../src/app/read/source-feed-preferences';

const values = new Map<string, string>();
const notify = vi.fn(), network = vi.fn();
const selected: SourceFeedPreferences = { version: 1, sources: [{ sourceId: '9007199254740993', mode: 'latest' }, { sourceId: '-9223372036854775808', mode: 'popular' }] };
function storage() {
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
beforeEach(() => { values.clear(); notify.mockClear(); network.mockClear(); vi.stubGlobal('localStorage', storage()); vi.stubGlobal('window', { dispatchEvent: notify }); vi.stubGlobal('fetch', network); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('source Feed selection preferences', () => {
  it('defaults to a fresh empty selection only when no choice was saved', () => {
    const first = readSourceFeedPreferences();
    expect(first).toEqual({ version: 1, sources: [] });
    first.sources.push({ sourceId: '1', mode: 'popular' });
    expect(readSourceFeedPreferences().sources).toEqual([]);
    expect(values.size).toBe(0); expect(notify).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
  });

  it('preserves order, mode and exact signed 64-bit IDs without retaining input object references', () => {
    const input: SourceFeedPreferences = { version: 1, sources: ['1', '-1', '9007199254740993', '-9007199254740993', '9223372036854775807', '-9223372036854775808'].map(sourceId => ({ sourceId, mode: 'latest' })) };
    const parsed = parseSourceFeedPreferences(input);
    expect(parsed).toEqual(input); expect(parsed).not.toBe(input); expect(parsed.sources[0]).not.toBe(input.sources[0]);
    input.sources[0].mode = 'popular'; expect(parsed.sources[0].mode).toBe('latest');
  });

  it.each(['0', '-0', '+1', '01', '-01', ' 1', '1 ', '1.0', '1e3', '１２', '9223372036854775808', '-9223372036854775809', '1'.repeat(1000), 'https://example.test/private'])('rejects noncanonical or unsafe source ID %s', sourceId => {
    expect(() => parseSourceFeedPreferences({ version: 1, sources: [{ sourceId, mode: 'popular' }] })).toThrow('source-feed-invalid');
  });

  it('enforces exact closed shapes, distinct sources, modes and the eight-source limit', () => {
    for (const invalid of [null, [], {}, { ...selected, version: 2 }, { ...selected, query: 'fixture-private' }, { ...selected, sources: {} },
      { version: 1, sources: [{ sourceId: 12345, mode: 'popular' }] }, { version: 1, sources: [{ sourceId: '1', mode: 'search' }] },
      { version: 1, sources: [{ sourceId: '1', mode: 'popular', url: 'https://private.example' }] },
      { version: 1, sources: [{ sourceId: '1', mode: 'popular' }, { sourceId: '1', mode: 'latest' }] },
      { version: 1, sources: Array.from({ length: MAX_FEED_SOURCES + 1 }, (_, index) => ({ sourceId: String(index + 1), mode: 'popular' })) }])
      expect(() => parseSourceFeedPreferences(invalid)).toThrow('source-feed-invalid');
    expect(parseSourceFeedPreferences({ version: 1, sources: Array.from({ length: MAX_FEED_SOURCES }, (_, index) => ({ sourceId: String(index + 1), mode: 'popular' })) }).sources).toHaveLength(8);
  });

  it('saves only validated choices, verifies readback and announces changes without contacting providers', () => {
    values.set('fixture-provider-key', 'fixture-secret');
    const saved = saveSourceFeedPreferences(selected);
    expect(saved).toEqual(selected); expect(saved).not.toBe(selected);
    expect(values.get(SOURCE_FEED_PREFERENCE_KEY)).toBe(JSON.stringify(selected));
    expect(readSourceFeedPreferences()).toEqual(selected);
    expect(values.get('fixture-provider-key')).toBe('fixture-secret');
    expect(notify).toHaveBeenCalledOnce(); expect(notify.mock.calls[0][0].type).toBe(SOURCE_FEED_PREFERENCE_EVENT);
    saveSourceFeedPreferences(selected);
    expect(notify).toHaveBeenCalledOnce(); expect(network).not.toHaveBeenCalled();
  });

  it('reports corrupt or oversized stored choices without silently replacing them', () => {
    for (const raw of ['', '{broken', JSON.stringify({ ...selected, secret: 'fixture-private-value' }), ' '.repeat(2049)]) {
      values.set(SOURCE_FEED_PREFERENCE_KEY, raw);
      expect(() => readSourceFeedPreferences()).toThrow('source-feed-invalid');
      expect(values.get(SOURCE_FEED_PREFERENCE_KEY)).toBe(raw);
    }
    expect(notify).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
  });

  it('does not mask blocked storage reads or leak their exception details', () => {
    vi.stubGlobal('localStorage', { ...storage(), getItem: () => { throw Error('fixture-private-value'); } });
    for (const work of [readSourceFeedPreferences, () => saveSourceFeedPreferences(selected)]) {
      expect(work).toThrow('source-feed-read');
      try { work(); } catch (reason) { expect(reason).toBeInstanceOf(SourceFeedPreferencesError); expect(String(reason)).not.toContain('fixture-private-value'); }
    }
    expect(values.size).toBe(0); expect(notify).not.toHaveBeenCalled();
  });

  it('validates before touching storage and reports rejected writes without claiming a save', () => {
    const getItem = vi.fn(), setItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem, setItem });
    expect(() => saveSourceFeedPreferences({ version: 1, sources: [{ sourceId: '0', mode: 'popular' }] })).toThrow('source-feed-invalid');
    expect(getItem).not.toHaveBeenCalled(); expect(setItem).not.toHaveBeenCalled();
    vi.stubGlobal('localStorage', { ...storage(), setItem: () => { throw Error('quota'); } });
    expect(() => saveSourceFeedPreferences(selected)).toThrow('source-feed-write');
    expect(values.has(SOURCE_FEED_PREFERENCE_KEY)).toBe(false); expect(notify).not.toHaveBeenCalled();
  });

  it.each([null, '{"version":1,"sources":[]}'])('restores the exact previous value after a mismatched readback: %s', previous => {
    if (previous !== null) values.set(SOURCE_FEED_PREFERENCE_KEY, previous);
    let first = true;
    vi.stubGlobal('localStorage', { ...storage(), setItem: (key: string, value: string) => { values.set(key, first ? 'unexpected value' : value); first = false; } });
    expect(() => saveSourceFeedPreferences(selected)).toThrow('source-feed-write');
    expect(values.get(SOURCE_FEED_PREFERENCE_KEY) ?? null).toBe(previous);
    expect(notify).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
  });

  it('reports and announces an unconfirmed rollback instead of claiming the old selection remains', () => {
    const previous = '{"version":1,"sources":[]}'; values.set(SOURCE_FEED_PREFERENCE_KEY, previous);
    vi.stubGlobal('localStorage', { ...storage(), setItem: (key: string, value: string) => { if (value === previous) throw Error('blocked rollback'); values.set(key, 'unexpected value'); } });
    expect(() => saveSourceFeedPreferences(selected)).toThrow('source-feed-rollback-failed');
    expect(values.get(SOURCE_FEED_PREFERENCE_KEY)).toBe('unexpected value');
    expect(notify).toHaveBeenCalledOnce(); expect(notify.mock.calls[0][0].type).toBe(SOURCE_FEED_PREFERENCE_EVENT);
    expect(network).not.toHaveBeenCalled();
  });
});
