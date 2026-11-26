export type ReaderSettingsSearchItem = { id: string; text: readonly string[] };

function normalized(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

/** Search only caller-provided, localized labels and hints. Every word must
 * match the same settings group; user text is never interpreted as a pattern. */
export function findReaderSettings(items: readonly ReaderSettingsSearchItem[], query: string): string[] {
  const words = normalized(query).trim().split(/\s+/u).filter(Boolean);
  return items.filter(item => {
    const text = normalized(item.text.join(' '));
    return words.every(word => text.includes(word));
  }).map(item => item.id);
}
