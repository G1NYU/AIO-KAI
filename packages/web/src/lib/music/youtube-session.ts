import type { YouTubeMusicRequest } from './youtube-music';

export type YouTubeSessionMode = 'anonymous' | 'firefox';
export type YouTubeSessionAction = YouTubeSessionMode | 'status';

/** Only a native mode name crosses the bridge. Cookie values and profile paths
 * never enter React state, localStorage, diagnostics, or portable backups. */
export async function youtubeSession(
  request: YouTubeMusicRequest,
  action: YouTubeSessionAction,
  signal?: AbortSignal,
): Promise<YouTubeSessionMode> {
  if (!['status', 'anonymous', 'firefox'].includes(action)) throw new Error('Invalid YouTube session choice.');
  const result = await request('session', action, signal);
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('YouTube session controls are unavailable in this build.');
  const mode = (result as Record<string, unknown>).mode;
  if (mode !== 'anonymous' && mode !== 'firefox') throw new Error('YouTube session controls are unavailable in this build.');
  return mode;
}
