import { appBridge } from './bridge';
import type { YouTubeMusicRequest } from '../../music/youtube-music';

export function supportsYouTubeMusic(): boolean {
  return typeof window !== 'undefined' && appBridge()?.youtubeMusic === true;
}

let sequence = 0;

export const requestYouTubeMusic: YouTubeMusicRequest = (operation, value, signal) => {
  const bridge = typeof window !== 'undefined' ? appBridge() : undefined;
  if (!bridge?.youtubeMusic) return Promise.reject(new Error('This desktop build does not support YouTube Music.'));
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  const request = 'music-' + ++sequence;
  return new Promise((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      unsubscribe();
      signal?.removeEventListener('abort', abort);
    };
    const abort = () => {
      finish();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      finish();
      reject(new Error('YouTube Music did not answer.'));
    }, 15_000);
    const unsubscribe = bridge.subscribe(message => {
      if (message.type !== 'youtube-music-result' || message.request !== request) return;
      finish();
      if (message.error || message.data == null) reject(new Error(message.error || 'YouTube Music returned no data.'));
      else resolve(message.data);
    });
    signal?.addEventListener('abort', abort, { once: true });
    try {
      bridge.send({ type: 'youtube-music-request', request, operation, value });
    } catch {
      finish();
      reject(new Error('Could not send YouTube Music request.'));
    }
  });
};
