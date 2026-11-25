import { t } from '@lingui/core/macro';

export type BookFormat = 'epub' | 'pdf';
export type BookPosition = string | number;
export type BookEntry = {
  id: string;
  name: string;
  title: string;
  format: BookFormat;
  size: number;
  addedAt: number;
  position?: BookPosition;
  fraction?: number;
};

export const MAX_BOOK_BYTES = 128 * 1024 * 1024;

export async function bookFormat(file: Pick<File, 'name' | 'size' | 'slice'>): Promise<BookFormat> {
  if (file.size <= 0 || file.size > MAX_BOOK_BYTES)
    throw new Error(t`Choose a nonempty EPUB or PDF of at most 128 MiB.`);
  const bytes = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  if (/\.pdf$/i.test(file.name) && bytes[0] === 37 && bytes[1] === 80 &&
      bytes[2] === 68 && bytes[3] === 70 && bytes[4] === 45) return 'pdf';
  if (/\.epub$/i.test(file.name) && bytes[0] === 80 && bytes[1] === 75 &&
      bytes[2] === 3 && bytes[3] === 4) return 'epub';
  throw new Error(t`The selected file does not have a supported EPUB or PDF signature.`);
}

export function validBookProgress(format: BookFormat, position: unknown, fraction: unknown):
  { position: BookPosition; fraction: number } | null {
  if (typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction < 0 || fraction > 1) return null;
  if (format === 'pdf' && typeof position === 'number' && Number.isSafeInteger(position) &&
      position >= 1 && position <= 20000) return { position, fraction };
  if (format === 'epub' && typeof position === 'string' && position.length <= 4000 &&
      position.startsWith('epubcfi(') && position.endsWith(')')) return { position, fraction };
  return null;
}

let connection: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  if (!connection) {
    connection = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('tsugi-local-books-v1', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('books', { keyPath: 'id' });
        request.result.createObjectStore('files');
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); connection = undefined; };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error(t`Local book storage is blocked.`));
    }).catch(error => { connection = undefined; throw error; });
  }
  return connection;
}
function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
}

export async function listBooks(): Promise<BookEntry[]> {
  const db = await database();
  const rows: BookEntry[] = await result(db.transaction('books').objectStore('books').getAll());
  return rows.sort((a, b) => b.addedAt - a.addedAt);
}

export async function importBook(file: File): Promise<BookEntry> {
  const format = await bookFormat(file);
  const db = await database();
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
  const entry: BookEntry = {
    id, name: file.name, title: file.name.replace(/\.(epub|pdf)$/i, ''),
    format, size: file.size, addedAt: Date.now(),
  };
  const tx = db.transaction(['books', 'files'], 'readwrite');
  const complete = finished(tx);
  tx.objectStore('books').add(entry);
  tx.objectStore('files').add(file, id);
  await complete;
  return entry;
}

export async function getBookFile(entry: BookEntry): Promise<File> {
  const db = await database();
  const stored: unknown = await result(db.transaction('files').objectStore('files').get(entry.id));
  if (!(stored instanceof Blob)) throw new Error(t`The saved book file is missing.`);
  return new File([stored], entry.name, { type: entry.format === 'pdf' ? 'application/pdf' : 'application/epub+zip' });
}

export async function updateBook(id: string, patch: { title?: string; position?: BookPosition; fraction?: number }): Promise<void> {
  const db = await database();
  const tx = db.transaction('books', 'readwrite');
  const complete = finished(tx);
  const store = tx.objectStore('books');
  const request = store.get(id);
  request.onsuccess = () => {
    const current = request.result as BookEntry | undefined;
    if (!current) { tx.abort(); return; }
    const next = { ...current };
    if (typeof patch.title === 'string' && patch.title.trim()) next.title = patch.title.slice(0, 1000);
    if (patch.position !== undefined || patch.fraction !== undefined) {
      const valid = validBookProgress(current.format, patch.position, patch.fraction);
      if (!valid) { tx.abort(); return; }
      Object.assign(next, valid);
    }
    store.put(next);
  };
  await complete;
}

export async function removeBook(id: string): Promise<void> {
  const db = await database();
  const tx = db.transaction(['books', 'files'], 'readwrite');
  const complete = finished(tx);
  tx.objectStore('books').delete(id);
  tx.objectStore('files').delete(id);
  await complete;
}
