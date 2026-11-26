import React from 'react';
import { appBridge } from './hosts/shell/bridge';
import {
  defaultPresencePreferences, parsePresencePreferences, PRESENCE_KEY, selectMediaPresence,
  type MediaPresence, type PresencePreferences,
} from './presence-model';

const listeners = new Set<() => void>();
const candidates = new Map<symbol, MediaPresence>();
let preferences: PresencePreferences | undefined;
let running = false;
let lastPresence: string | undefined;

export function readPresencePreferences(): PresencePreferences {
  if (preferences) return preferences;
  try { preferences = parsePresencePreferences(JSON.parse(localStorage.getItem(PRESENCE_KEY) ?? 'null')); }
  catch { preferences = defaultPresencePreferences(); }
  return preferences;
}
function publish(force = false) {
  if (!running) return;
  const presence = selectMediaPresence(readPresencePreferences(), candidates.values());
  const key = JSON.stringify(presence);
  if (!force && key === lastPresence) return;
  lastPresence = key;
  appBridge()?.send({ type: 'presence', presence });
}
function configure() {
  if (!running) return;
  appBridge()?.send({ type: 'discord-configure', config: readPresencePreferences() });
  publish(true);
}
/** Apply privacy immediately even if the device cannot save its preference. */
export function savePresencePreferences(next: PresencePreferences): boolean {
  preferences = parsePresencePreferences(next);
  let saved = false;
  try {
    const encoded = JSON.stringify(preferences);
    localStorage.setItem(PRESENCE_KEY, encoded);
    saved = localStorage.getItem(PRESENCE_KEY) === encoded;
  } catch { /* Report persistence failure; current-session privacy still applies. */ }
  // Never enable sharing on a failed preference write; disabling and privacy remain effective.
  if (!saved) preferences = { ...preferences, enabled: false, privateMode: true };
  configure();
  for (const listener of listeners) listener();
  return saved;
}
export function usePresencePreferences() {
  return React.useSyncExternalStore(
    React.useCallback(listener => { listeners.add(listener); return () => listeners.delete(listener); }, []),
    readPresencePreferences,
  );
}
export function setMediaPresence(owner: symbol, presence: MediaPresence | null): void {
  if (presence) candidates.set(owner, presence); else candidates.delete(owner);
  publish();
}
export function useMediaPresence(presence: MediaPresence | null) {
  const owner = React.useRef(Symbol('media-presence'));
  const key = JSON.stringify(presence);
  React.useEffect(() => {
    setMediaPresence(owner.current, JSON.parse(key) as MediaPresence | null);
  }, [key]);
  React.useEffect(() => {
    const id = owner.current;
    return () => setMediaPresence(id, null);
  }, []);
}
/** Mount once above all media spaces, including before a video server is connected. */
export function RichPresenceSession() {
  React.useEffect(() => {
    running = true;
    configure();
    const changed = (event: StorageEvent) => {
      if (event.key !== PRESENCE_KEY && event.key !== null) return;
      preferences = undefined;
      configure();
      for (const listener of listeners) listener();
    };
    const clear = () => {
      appBridge()?.send({ type: 'discord-configure', config: { ...readPresencePreferences(), enabled: false } });
    };
    window.addEventListener('storage', changed);
    window.addEventListener('pagehide', clear);
    return () => {
      clear();
      running = false;
      lastPresence = undefined;
      window.removeEventListener('storage', changed);
      window.removeEventListener('pagehide', clear);
    };
  }, []);
  return null;
}
