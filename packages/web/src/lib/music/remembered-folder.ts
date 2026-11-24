/** Read-only directory handles, persisted via IndexedDB, never raw filesystem paths.
 * No network requests or audio bytes are read during scanning. */
export type MusicFileHandle = {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
};
export type MusicFolderHandle = {
  kind: 'directory';
  name: string;
  values(): AsyncIterableIterator<MusicFileHandle | MusicFolderHandle>;
  queryPermission(options: { mode: 'read' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'read' }): Promise<PermissionState>;
};
export type FolderAudio = { id: string; path: string; file: MusicFileHandle };
type FolderPickerWindow = Window & {
  showDirectoryPicker?(options: { mode: 'read' }): Promise<MusicFolderHandle>;
};

const DATABASE = 'tsugi-local-music-v1';
const STORE = 'directories';
const KEY = 'music';
export const MAX_FOLDER_TRACKS = 1000;
const MAX_ENTRIES = 20000;

export function folderAccessSupported(): boolean {
  // Restrict persistent directory access to the bundled Windows app origin.
  return typeof window !== 'undefined' && window.isSecureContext &&
    window.location.origin === 'http://aiostreams.localhost' &&
    typeof (window as FolderPickerWindow).showDirectoryPicker === 'function' &&
    typeof window.indexedDB !== 'undefined';
}

export async function chooseMusicFolder(): Promise<MusicFolderHandle> {
  const picker = window as FolderPickerWindow;
  if (!folderAccessSupported() || !picker.showDirectoryPicker)
    throw new Error('Directory picker unavailable');
  return picker.showDirectoryPicker({ mode: 'read' });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Music folder storage is blocked'));
  });
}

async function folderTransaction(
  mode: IDBTransactionMode, update: boolean, handle?: MusicFolderHandle,
): Promise<unknown> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const store = transaction.objectStore(STORE);
      const request = update
        ? (handle ? store.put(handle, KEY) : store.delete(KEY))
        : store.get(KEY);
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error ?? request.error);
      transaction.onerror = () => reject(transaction.error ?? request.error);
    });
  } finally {
    db.close();
  }
}

export async function readMusicFolder(): Promise<MusicFolderHandle | null> {
  const handle = await folderTransaction('readonly', false) as Partial<MusicFolderHandle> | undefined;
  return handle?.kind === 'directory' && typeof handle.name === 'string' &&
    typeof handle.values === 'function' && typeof handle.queryPermission === 'function' &&
    typeof handle.requestPermission === 'function' ? handle as MusicFolderHandle : null;
}

export async function rememberMusicFolder(handle: MusicFolderHandle | null): Promise<void> {
  await folderTransaction('readwrite', true, handle ?? undefined);
}

/** Bound both traversal and rendered rows; ignore non-audio entries. */
export async function scanMusicFolder(root: MusicFolderHandle, max = MAX_FOLDER_TRACKS):
Promise<{ entries: FolderAudio[]; truncated: boolean }> {
  const entries: FolderAudio[] = [];
  let visited = 0;
  let truncated = false;
  const limit = Number.isFinite(max) ? Math.max(1, Math.min(MAX_FOLDER_TRACKS, Math.floor(max))) : MAX_FOLDER_TRACKS;
  async function visit(directory: MusicFolderHandle, prefix: string, depth: number): Promise<void> {
    if (depth > 32) {
      truncated = true;
      return;
    }
    for await (const child of directory.values()) {
      if (++visited > MAX_ENTRIES || entries.length >= limit) {
        truncated = true;
        return;
      }
      const path = prefix ? prefix + '/' + child.name : child.name;
      if (child.kind === 'directory') await visit(child, path, depth + 1);
      else if (/\.(mp3|m4a|flac|wav|ogg|opus|aac|webm)$/i.test(child.name)) {
        entries.push({ id: 'folder:' + path, path, file: child });
      }
      if (visited > MAX_ENTRIES || entries.length >= limit) {
        // Report the cap conservatively even if the last entry was the final file.
        truncated = true;
        return;
      }
    }
  }
  await visit(root, '', 0);
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return { entries, truncated };
}
