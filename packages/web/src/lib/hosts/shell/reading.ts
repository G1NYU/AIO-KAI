import { t } from '@lingui/core/macro';
import { appBridge, ask } from './bridge';

export type ReadAction =
  | { kind: 'status' | 'sources' | 'library' | 'stores' | 'refresh-extensions' }
  | { kind: 'add-store' | 'remove-store'; index: string }
  | { kind: 'extensions'; offset: number }
  | { kind: 'install-extension' | 'uninstall-extension'; package: string }
  | { kind: 'catalogue'; source: string; page: number; mode: 'popular' | 'latest' | 'search'; query?: string }
  | { kind: 'manga' | 'chapter'; id: number }
  | { kind: 'set-library'; id: number; inLibrary: boolean }
  | { kind: 'page'; chapterId: number; index: number }
  | { kind: 'progress'; chapterId: number; index: number; finished: boolean };

export function supportsReadingSection(): boolean {
  const bridge = appBridge();
  return bridge?.platform === 'windows' && (bridge.reading === true || bridge.readingSetup === true);
}

export function supportsReading(): boolean {
  const bridge = appBridge();
  return bridge?.platform === 'windows' && bridge.reading === true;
}

let sequence = 0;
export async function readRequest<T>(action: ReadAction): Promise<T> {
  if (!supportsReading()) throw new Error(t`Reading is not available in this app.`);
  const request = 'read-' + Date.now() + '-' + ++sequence;
  const response = await ask({ type: 'read-request', request, action }, 'read-result', {
    timeoutMs: 180_000, matches: (message) => message.request === request,
  });
  if (response.error || response.data == null) throw new Error(response.error || t`Reading request returned no data.`);
  return response.data as T;
}

export function isReaderPagePath(path: unknown): path is string {
  return typeof path === 'string' && /^\/__tsugi_read\/page\/\d+$/.test(path);
}
