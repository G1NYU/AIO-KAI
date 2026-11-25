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
    throw new Error('book-size');
  const bytes = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  if (/\.pdf$/i.test(file.name) && bytes[0] === 37 && bytes[1] === 80 &&
      bytes[2] === 68 && bytes[3] === 70 && bytes[4] === 45) return 'pdf';
  if (/\.epub$/i.test(file.name) && bytes[0] === 80 && bytes[1] === 75 &&
      bytes[2] === 3 && bytes[3] === 4) return 'epub';
  throw new Error('book-format');
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

