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
export function saveReaderPreferences(value: ReaderPreferences) {
  try { localStorage.setItem(READER_PREFERENCE_KEY, JSON.stringify(value)); } catch { /* optional browser storage */ }
}
