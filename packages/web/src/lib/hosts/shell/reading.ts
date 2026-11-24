import { t } from '@lingui/core/macro';
import { appBridge, ask } from './bridge';

export type ReadAction =
  | { kind: 'prepare' | 'status' | 'sources' | 'library' | 'stores' | 'refresh-extensions' }
  | { kind: 'add-store' | 'remove-store'; index: string }
  | { kind: 'extensions'; offset: number; query?: string; store?: string; language?: string; installed?: boolean }
  | { kind: 'install-extension' | 'uninstall-extension'; package: string }
  | { kind: 'catalogue'; source: string; page: number; mode: 'popular' | 'latest' | 'search'; query?: string }
  | { kind: 'manga' | 'chapter' | 'cover'; id: number }
  | { kind: 'set-library'; id: number; inLibrary: boolean }
  | { kind: 'page'; chapterId: number; index: number }
  | { kind: 'progress'; chapterId: number; index: number; finished: boolean };

export function supportsReadingSection(): boolean {
  const bridge = appBridge();
  return bridge?.platform === 'windows' && (bridge.reading === true || bridge.readingSetup === true);
}

let preparedInSession = false;

export function supportsReading(): boolean {
  const bridge = appBridge();
  return bridge?.platform === 'windows' && (bridge.reading === true || preparedInSession);
}

let sequence = 0;
export async function readRequest<T>(action: ReadAction): Promise<T> {
  if (action.kind === 'prepare' ? !supportsReadingSection() : !supportsReading()) throw new Error(t({ id: "Reading is not available in this app.", message: "Reading is not available in this app." }));
  const request = 'read-' + Date.now() + '-' + ++sequence;
  const response = await ask({ type: 'read-request', request, action }, 'read-result', {
    timeoutMs: action.kind === 'prepare' ? 20 * 60_000 : 180_000, matches: (message) => message.request === request,
  });
  if (response.error || response.data == null) throw new Error(response.error || t({ id: "Reading request returned no data.", message: "Reading request returned no data." }));
  return response.data as T;
}

export async function prepareReading(): Promise<void> {
  const result = await readRequest<{ ready: boolean }>({ kind: 'prepare' });
  if (result.ready !== true) throw new Error(t({ id: "Reading setup did not complete.", message: "Reading setup did not complete." }));
  preparedInSession = true;
}

export function isReaderPagePath(path: unknown): path is string {
  return typeof path === 'string' && /^\/__tsugi_read\/page\/\d+$/.test(path);
}

// The native image capability is a single-slot cache. Transfer each image
// completely into a local blob before issuing the next image operation.
// Both covers and chapter pages use this queue; no remote image URLs enter
// the webview and queued covers can be abandoned when their card unmounts.
let imageTail: Promise<void> = Promise.resolve();
export function readImage(
  action: Extract<ReadAction, { kind: 'page' }> | { kind: 'cover'; id: number },
  signal?: AbortSignal,
): Promise<string> {
  const operation = imageTail.then(async () => {
    signal?.throwIfAborted();
    const result = await readRequest<{ path: string; index?: number }>(action);
    signal?.throwIfAborted();
    if (!isReaderPagePath(result.path) || (action.kind === 'page' && result.index !== action.index))
      throw new Error(t({ id: "Invalid reading image.", message: "Invalid reading image." }));
    const response = await fetch(result.path, { cache: 'no-store', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(t({ id: "Could not load reading image.", message: "Could not load reading image." }));
    const blob = await response.blob();
    signal?.throwIfAborted();
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(blob.type) || blob.size === 0 || blob.size > 24 * 1024 * 1024)
      throw new Error(t({ id: "Invalid reading image.", message: "Invalid reading image." }));
    return URL.createObjectURL(blob);
  });
  imageTail = operation.then(() => undefined, () => undefined);
  return operation;
}
