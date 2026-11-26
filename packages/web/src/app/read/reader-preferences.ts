import type { ReaderMode } from './reader-utils';

export type ReaderPreferences = {
  mode: ReaderMode;
  width: number;
  gap: boolean;
  rtl: boolean;
  fit: 'width' | 'height' | 'original';
  background: 'black' | 'graphite' | 'paper';
  focus: boolean;
  autoNext: boolean;
  wheelZoom: boolean;
  resume: boolean;
};

export const READER_DEFAULTS: ReaderPreferences = {
  mode: 'scroll', width: 55, gap: false, rtl: false, fit: 'width',
  background: 'black', focus: false, autoNext: false, wheelZoom: true, resume: true,
};
export const READER_PREFERENCE_KEY = 'tsugi-reader-preferences';
export function normalizeReaderPreferences(value: unknown): ReaderPreferences {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    mode: v.mode === 'single' || v.mode === 'spread' ? v.mode : 'scroll',
    width: typeof v.width === 'number' && Number.isFinite(v.width) ? Math.min(100, Math.max(25, v.width)) : READER_DEFAULTS.width,
    gap: v.gap === true, rtl: v.rtl === true,
    fit: v.fit === 'height' || v.fit === 'original' ? v.fit : 'width',
    background: v.background === 'paper' || v.background === 'graphite' ? v.background : 'black',
    focus: v.focus === true, autoNext: v.autoNext === true,
    wheelZoom: v.wheelZoom !== false, resume: v.resume !== false,
  };
}
export function readReaderPreferences(): ReaderPreferences {
  try { return normalizeReaderPreferences(JSON.parse(localStorage.getItem(READER_PREFERENCE_KEY) || 'null')); }
  catch { return READER_DEFAULTS; }
}
export function saveReaderPreferences(value: ReaderPreferences): boolean {
  try {
    const raw = JSON.stringify(normalizeReaderPreferences(value));
    localStorage.setItem(READER_PREFERENCE_KEY, raw);
    return localStorage.getItem(READER_PREFERENCE_KEY) === raw;
  } catch { return false; }
}

// Native source+URL hash, shared with the manga backup identity. Never key by
// mutable title text, runtime row number, or a raw extension URL.
export const TITLE_READER_PREFERENCE_KEY = 'tsugi-title-reader-preferences-v1';
export const MAX_TITLE_READER_PREFERENCES = 512;
const MAX_TITLE_BYTES = 128 * 1024;
type TitlePreferences = { identity: string; preferences: ReaderPreferences };
export function isReaderIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/.test(value);
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function strictPreferences(value: unknown): ReaderPreferences {
  const normalized = normalizeReaderPreferences(value);
  if (!object(value) || Object.keys(value).length !== Object.keys(normalized).length ||
      Object.entries(normalized).some(([key, expected]) => !Object.prototype.hasOwnProperty.call(value,key) || value[key] !== expected)) throw new Error('invalid title preferences');
  return normalized;
}
export function parseTitleReaderPreferences(raw: string | null): TitlePreferences[] {
  if (raw === null) return [];
  if (raw.length > MAX_TITLE_BYTES || new TextEncoder().encode(raw).length > MAX_TITLE_BYTES) throw new Error('title preferences size');
  const root: unknown = JSON.parse(raw);
  if (!object(root) || Object.keys(root).length !== 2 || root.version !== 1 ||
      !Array.isArray(root.titles) || root.titles.length > MAX_TITLE_READER_PREFERENCES) throw new Error('invalid title preferences');
  const used = new Set<string>();
  return root.titles.map((row: unknown) => {
    if (!object(row) || Object.keys(row).length !== 2 || !isReaderIdentity(row.identity) || used.has(row.identity))
      throw new Error('invalid title identity');
    used.add(row.identity);
    return { identity: row.identity, preferences: strictPreferences(row.preferences) };
  });
}
export function readTitleReaderPreferences(identity: unknown): ReaderPreferences | null {
  if (!isReaderIdentity(identity)) return null;
  try {
    return parseTitleReaderPreferences(localStorage.getItem(TITLE_READER_PREFERENCE_KEY))
      .find(row => row.identity === identity)?.preferences ?? null;
  } catch { return null; }
}
export function readEffectiveReaderPreferences(identity: unknown): ReaderPreferences {
  return readTitleReaderPreferences(identity) ?? readReaderPreferences();
}
export function saveTitleReaderPreferences(identity: unknown, preferences: ReaderPreferences | null): boolean {
  if (!isReaderIdentity(identity)) return false;
  try {
    const current = parseTitleReaderPreferences(localStorage.getItem(TITLE_READER_PREFERENCE_KEY));
    const titles = current.filter(row => row.identity !== identity);
    if (preferences) titles.push({ identity, preferences: strictPreferences(preferences) });
    // No silent eviction and no replacement of an unreadable store.
    if (titles.length > MAX_TITLE_READER_PREFERENCES) return false;
    if (!titles.length) {
      localStorage.removeItem(TITLE_READER_PREFERENCE_KEY);
      return localStorage.getItem(TITLE_READER_PREFERENCE_KEY) === null;
    }
    const raw = JSON.stringify({ version: 1, titles });
    parseTitleReaderPreferences(raw);
    localStorage.setItem(TITLE_READER_PREFERENCE_KEY, raw);
    return localStorage.getItem(TITLE_READER_PREFERENCE_KEY) === raw;
  } catch { return false; }
}
