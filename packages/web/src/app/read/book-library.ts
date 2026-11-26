import { t } from '@lingui/core/macro';

import { bookFormat, validBookProgress, validBookCover, type BookEntry, type BookPosition } from './book-guards';
export type { BookEntry, BookFormat, BookPosition } from './book-guards';
export { MAX_BOOK_BYTES, validBookProgress } from './book-guards';

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

export async function importBook(file: File, vaultJobId?: string): Promise<BookEntry> {
  const format = await bookFormat(file);
  if (vaultJobId) {
    const existing=(await listBooks()).find(book=>book.vaultJobId===vaultJobId);
    if(existing)return existing;
  }
  const db = await database();
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
  const entry: BookEntry = {
    id, name: file.name, title: file.name.replace(/\.(epub|pdf)$/i, ''),
    format, size: file.size, addedAt: Date.now(), vaultJobId,
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

export async function updateBook(id: string, patch: { title?: string; position?: BookPosition; fraction?: number; cover?: Blob }): Promise<void> {
  if (patch.cover && !await validBookCover(patch.cover)) throw new Error(t`Invalid book cover.`);
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
    if (patch.cover) next.cover = patch.cover;
    if (patch.position !== undefined || patch.fraction !== undefined) {
      const valid = validBookProgress(current.format, patch.position, patch.fraction);
      if (!valid) { tx.abort(); return; }
      Object.assign(next, valid, { lastReadAt: Date.now() });
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

/** Book file blobs are immutable for an ID: import allocates a new ID and
 * removal deletes both stores. Capture only metadata needed for a guarded
 * restore; never replace the underlying file, cover or Vault identity. */
export function bookMetadataSnapshot(book:BookEntry) {
  const {id,name,title,format,size,addedAt,position,fraction,lastReadAt}=book;
  return {id,name,title,format,size,addedAt,position,fraction,lastReadAt};
}
export type BookMetadataSnapshot=ReturnType<typeof bookMetadataSnapshot>;
export type BookMetadataChange={
  expected:BookMetadataSnapshot;
  title?:string;
  progress?:{position:BookPosition;fraction:number;lastReadAt:number};
};

/** All reviewed metadata changes commit in one transaction. Reject a stale
 * reading position or missing file before committing any change. */
export async function restoreBookMetadata(changes:BookMetadataChange[]):Promise<void> {
  if(!changes.length)return;
  if(changes.length>1000||new Set(changes.map(c=>c.expected.id)).size!==changes.length)throw new Error('restore-count');
  for(const change of changes){
    if(change.title!==undefined&&(!change.title.trim()||change.title.length>1000))throw new Error('restore-title');
    if(change.progress&&(!validBookProgress(change.expected.format,change.progress.position,change.progress.fraction)||
      !Number.isSafeInteger(change.progress.lastReadAt)||change.progress.lastReadAt<0))throw new Error('restore-progress');
  }
  const db=await database();
  const tx=db.transaction(['books','files'],'readwrite');
  const complete=finished(tx);
  const books=tx.objectStore('books'),files=tx.objectStore('files');
  for(const change of changes){
    const request=books.get(change.expected.id);
    request.onsuccess=()=>{
      const current=request.result as BookEntry|undefined;
      if(!current||JSON.stringify(bookMetadataSnapshot(current))!==JSON.stringify(change.expected)){tx.abort();return;}
      const file=files.get(current.id);
      file.onsuccess=()=>{
        if(!(file.result instanceof Blob)||file.result.size!==current.size){tx.abort();return;}
        books.put({...current,...(change.title!==undefined?{title:change.title}:{}),...(change.progress??{})});
      };
    };
  }
  await complete;
}
