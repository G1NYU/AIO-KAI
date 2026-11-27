/** Public metadata only. Source IDs, artwork URLs, files and accounts stay elsewhere. */
export const PRESENCE_MEDIA = ['video', 'music', 'manga', 'books'] as const;
export type PresenceMedia = (typeof PRESENCE_MEDIA)[number];
export type PresencePreferences = {
  enabled: boolean;
  applicationId: string;
  privateMode: boolean;
  media: Record<PresenceMedia, boolean>;
};
export type MediaPresence = {
  media: PresenceMedia;
  title: string;
  subtitle: string | null;
  imdb: string | null;
  position: number;
  duration: number | null;
  paused: boolean;
  browsing: boolean;
};
export const PRESENCE_KEY = 'tsugi-discord-presence-v1';
/** Public application identity registered for TSUGI; never a token or secret. */
export const TSUGI_DISCORD_APPLICATION_ID = '1575822403211362365';
export function defaultPresencePreferences(): PresencePreferences {
  return { enabled: false, applicationId: TSUGI_DISCORD_APPLICATION_ID, privateMode: false,
    media: { video: true, music: true, manga: true, books: true } };
}
export function validApplicationId(value: string): boolean {
  return /^[1-9][0-9]{16,19}$/.test(value) && BigInt(value) <= 18446744073709551615n;
}
export function parsePresencePreferences(value: unknown): PresencePreferences {
  const defaults = defaultPresencePreferences();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
  const v = value as Partial<PresencePreferences>;
  if (typeof v.enabled !== 'boolean' || typeof v.privateMode !== 'boolean'
    || typeof v.applicationId !== 'string' || (v.applicationId !== '' && !validApplicationId(v.applicationId))
    || !v.media || PRESENCE_MEDIA.some(media => typeof v.media?.[media] !== 'boolean')) return defaults;
  // Upgrade an unset identity without enabling sharing, changing privacy or
  // replacing a user's explicitly configured application.
  return { enabled: v.enabled && v.applicationId !== '', privateMode: v.privateMode, applicationId: v.applicationId || defaults.applicationId,
    media: Object.fromEntries(PRESENCE_MEDIA.map(media => [media, v.media![media]])) as PresencePreferences['media'] };
}
export function sharesPresence(preferences: PresencePreferences, media: PresenceMedia): boolean {
  return preferences.enabled && !preferences.privateMode && validApplicationId(preferences.applicationId) && preferences.media[media];
}
export function publicPresenceText(value: string): string {
  const text = Array.from(value).filter(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join('').trim();
  // Fixed protocol fallback; no user text or translated private content crosses the boundary.
  // eslint-disable-next-line lingui/no-unlocalized-strings
  if (/(:\/\/|\\\\|:\\|[a-z]:\/|^[\\/]|token=|password=)/i.test(text)) return 'Private title';
  return Array.from(text).slice(0, 128).join('');
}
export function publicPresence(input: MediaPresence): MediaPresence {
  const duration = typeof input.duration === 'number' && Number.isFinite(input.duration)
    && input.duration > 0 && input.duration <= 604800000 ? Math.floor(input.duration) : null;
  const position = Number.isFinite(input.position) ? Math.floor(Math.max(0, input.position)) : 0;
  return { media: input.media, title: publicPresenceText(input.title) || 'TSUGI',
    subtitle: input.subtitle ? publicPresenceText(input.subtitle) : null,
    imdb: input.media === 'video' && /^tt[0-9]{1,10}$/.test(input.imdb ?? '') ? input.imdb : null,
    position: Math.min(position, duration ?? Number.MAX_SAFE_INTEGER), duration,
    paused: input.paused === true, browsing: input.browsing === true };
}
/** Watching outranks background playback; browsing never hides active media. */
export function selectMediaPresence(preferences: PresencePreferences, candidates: Iterable<MediaPresence>): MediaPresence | null {
  const priority = (p: MediaPresence) => p.browsing ? 1 : p.media === 'video' ? 4 : p.media === 'music' ? 2 : 3;
  let selected: MediaPresence | null = null;
  for (const candidate of candidates) {
    if (sharesPresence(preferences, candidate.media) && (!selected || priority(candidate) > priority(selected))) selected = candidate;
  }
  return selected ? publicPresence(selected) : null;
}
