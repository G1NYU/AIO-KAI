/* eslint-disable lingui/no-unlocalized-strings -- native provider protocol */
import { appBridge } from './bridge';
import type { SoundCloudSearchRequest } from '../../music/soundcloud';

export function supportsSoundCloudMusic(): boolean {
  const bridge = typeof window !== 'undefined' ? appBridge() : undefined;
  return bridge?.platform === 'windows' && bridge.soundcloudMusic === true && bridge.nativeMusicAudio === true;
}

let sequence = 0;
export const requestSoundCloudSearch: SoundCloudSearchRequest = (query, signal, onTracks) => {
  const bridge = typeof window !== 'undefined' ? appBridge() : undefined;
  if (!bridge || !supportsSoundCloudMusic()) return Promise.reject(new Error('Native SoundCloud is unavailable in this build.'));
  if (signal?.aborted) return Promise.reject(new DOMException('', 'AbortError'));
  const request = 'soundcloud-' + ++sequence;
  return new Promise((resolve, reject) => {
    const rows: unknown[] = [];
    let finished = false;
    let unsubscribe = () => {};
    let timer: ReturnType<typeof setTimeout>;
    const finish = () => {
      if (finished) return false;
      finished = true;
      clearTimeout(timer);
      unsubscribe();
      signal?.removeEventListener('abort', abort);
      return true;
    };
    const fail = (error: Error, cancel = true) => {
      if (!finish()) return;
      if (cancel) {
        try { bridge.send({ type: 'soundcloud-cancel', request }); } catch { /* native timeout remains bounded */ }
      }
      reject(error);
    };
    const abort = () => fail(new DOMException('', 'AbortError'));
    timer = setTimeout(() => fail(new Error('SoundCloud search timed out.')), 75_000);
    unsubscribe = bridge.subscribe(message => {
      if (finished || message.type !== 'soundcloud-search-result' || message.request !== request) return;
      if (!Array.isArray(message.tracks) || rows.length + message.tracks.length > 20 || typeof message.complete !== 'boolean') {
        fail(new Error('Invalid SoundCloud search response.'));
        return;
      }
      if (message.error) {
        fail(new Error(typeof message.error === 'string' && message.error.length <= 300 ? message.error : 'SoundCloud search failed.'), !message.complete);
        return;
      }
      rows.push(...message.tracks);
      if (message.tracks.length) {
        try { onTracks?.([...rows]); } catch { fail(new Error('Invalid SoundCloud search response.')); return; }
      }
      if (message.complete && finish()) resolve(rows);
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    try { bridge.send({ type: 'soundcloud-search', request, query }); }
    catch { fail(new Error('Could not send SoundCloud search request.')); }
  });
};
