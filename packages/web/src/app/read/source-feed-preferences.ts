export type SourceFeedMode = 'popular' | 'latest';
export type SourceFeedPreferences = { version: 1; sources: { sourceId: string; mode: SourceFeedMode }[] };
export const MAX_FEED_SOURCES = 8;
export const SOURCE_FEED_PREFERENCE_KEY = 'tsugi-reader-feed-v1';
export const SOURCE_FEED_PREFERENCE_EVENT = 'tsugi-source-feed-preferences-change';
const STORAGE_LIMIT = 2048;
type SourceFeedPreferencesErrorCode = 'invalid' | 'read' | 'write' | 'rollback-failed';
export class SourceFeedPreferencesError extends Error {
  constructor(readonly code: SourceFeedPreferencesErrorCode) { super('source-feed-' + code); this.name = 'SourceFeedPreferencesError'; }
}
function invalid(): never { throw new SourceFeedPreferencesError('invalid'); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(value, key))) invalid();
}
/** Selection metadata only: unknown fields are rejected, never copied or
 * normalized into a provider URL, credential, query, or executable action. */
export function parseSourceFeedPreferences(value: unknown): SourceFeedPreferences {
  const root = object(value); exact(root, ['version', 'sources']);
  if (root.version !== 1 || !Array.isArray(root.sources) || root.sources.length > MAX_FEED_SOURCES) return invalid();
  const seen = new Set<string>();
  const sources = root.sources.map((value): SourceFeedPreferences['sources'][number] => {
    const row = object(value); exact(row, ['sourceId', 'mode']);
    if (typeof row.sourceId !== 'string' || !/^-?[1-9]\d{0,18}$/.test(row.sourceId) || seen.has(row.sourceId) ||
      (row.mode !== 'popular' && row.mode !== 'latest')) return invalid();
    const id = BigInt(row.sourceId);
    if (id < -9223372036854775808n || id > 9223372036854775807n) return invalid();
    seen.add(row.sourceId);
    return { sourceId: row.sourceId, mode: row.mode };
  });
  return { version: 1, sources };
}
export function readSourceFeedPreferences(): SourceFeedPreferences {
  let raw: string | null;
  try { raw = localStorage.getItem(SOURCE_FEED_PREFERENCE_KEY); }
  catch { throw new SourceFeedPreferencesError('read'); }
  if (raw === null) return { version: 1, sources: [] };
  try {
    if (new TextEncoder().encode(raw).length > STORAGE_LIMIT) return invalid();
    return parseSourceFeedPreferences(JSON.parse(raw));
  } catch { throw new SourceFeedPreferencesError('invalid'); }
}
/** Notification only. Consumers must never fetch providers on this event. */
export function announceSourceFeedPreferencesChange() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SOURCE_FEED_PREFERENCE_EVENT));
}
export function saveSourceFeedPreferences(value: SourceFeedPreferences): SourceFeedPreferences {
  const preferences = parseSourceFeedPreferences(value), encoded = JSON.stringify(preferences);
  let previous: string | null;
  try { previous = localStorage.getItem(SOURCE_FEED_PREFERENCE_KEY); }
  catch { throw new SourceFeedPreferencesError('read'); }
  if (previous === encoded) return preferences;
  try {
    localStorage.setItem(SOURCE_FEED_PREFERENCE_KEY, encoded);
    if (localStorage.getItem(SOURCE_FEED_PREFERENCE_KEY) !== encoded) throw new SourceFeedPreferencesError('write');
  } catch {
    let recovered = false;
    try {
      if (localStorage.getItem(SOURCE_FEED_PREFERENCE_KEY) !== previous) {
        if (previous === null) localStorage.removeItem(SOURCE_FEED_PREFERENCE_KEY);
        else localStorage.setItem(SOURCE_FEED_PREFERENCE_KEY, previous);
      }
      recovered = localStorage.getItem(SOURCE_FEED_PREFERENCE_KEY) === previous;
    } catch { /* The caller must surface an unconfirmed rollback. */ }
    if (!recovered) {
      announceSourceFeedPreferencesChange();
      throw new SourceFeedPreferencesError('rollback-failed');
    }
    throw new SourceFeedPreferencesError('write');
  }
  announceSourceFeedPreferencesChange();
  return preferences;
}
