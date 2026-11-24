import { storage } from '../storage';
import { manifestUrlFor, parseManifest, type EclipseManifest } from './eclipse';

/** Explicit routing discriminator; legacy saved connections omit it. */
export type MusicProviderKind = 'eclipse';

/** User-installed music addons; their URLs often contain bearer-like secrets. */
export type MusicConnection = {
  kind?: MusicProviderKind;
  id: string;
  url: string;
  manifest: EclipseManifest;
};

const SOURCES_KEY = 'aiostreams-desktop-music-sources-v1';
const REMEMBER_KEY = 'aiostreams-desktop-music-remember-v1';

export function remembersMusicSources(): boolean {
  return storage.get<boolean>(REMEMBER_KEY) === true;
}

export function readMusicSources(): MusicConnection[] {
  if (!remembersMusicSources()) return [];
  const saved = storage.get<unknown>(SOURCES_KEY);
  if (!Array.isArray(saved)) return [];
  const urls = new Set<string>();
  const entries: MusicConnection[] = [];
  for (const raw of saved.slice(0, 30)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const candidate = raw as Record<string, unknown>;
    if (typeof candidate.id !== 'string' || typeof candidate.url !== 'string') continue;
    if (candidate.kind !== undefined && candidate.kind !== 'eclipse') continue;
    try {
      const url = manifestUrlFor(candidate.url);
      const manifest = parseManifest(candidate.manifest);
      if (urls.has(url)) continue;
      urls.add(url);
      entries.push({ id: candidate.id, url, manifest, ...(candidate.kind === 'eclipse' ? { kind: 'eclipse' as const } : {}) });
    } catch {
      // Ignore damaged data; never reveal a private URL in an error.
    }
  }
  return entries;
}

/**
 * Explicit opt-in only. localStorage is NOT encrypted at rest; do not make this
 * the default for personalized addon URLs.
 */
export function saveMusicSources(remember: boolean, sources: MusicConnection[]): void {
  if (remember) {
    storage.set(REMEMBER_KEY, true);
    storage.set(SOURCES_KEY, sources.map(({ id, url, manifest, kind }) => ({
      id, url, manifest, kind,
    })));
  } else {
    storage.remove(REMEMBER_KEY);
    storage.remove(SOURCES_KEY);
  }
}
