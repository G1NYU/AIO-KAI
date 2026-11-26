export type ContentWarning = 'SAFE' | 'MIXED' | 'NSFW';
export type ContentFilter = '' | ContentWarning;

export type SourceExtensionMetadata = {
  name: string; pkgName: string; versionName: string; versionCodeLong?: string;
  storeIndexUrl?: string | null; isInstalled: boolean; hasUpdate: boolean; isObsolete: boolean;
};

export type SourceMetadata = {
  id: string; name: string; lang: string; displayName?: string; supportsLatest: boolean;
  contentWarning?: string | null; isConfigurable?: boolean; extension?: SourceExtensionMetadata | null;
};

export function normalizedContentWarning(value: unknown): ContentWarning | 'UNKNOWN' {
  return value === 'SAFE' || value === 'MIXED' || value === 'NSFW' ? value : 'UNKNOWN';
}

// The engine's SAFE value includes extensions that did not declare a warning.
// It is presented as "Not flagged", never as a content-safety guarantee.
export function sourceMatchesFilters(source: SourceMetadata, query: string, language: string, content: ContentFilter): boolean {
  if (language && source.lang !== language) return false;
  if (content && normalizedContentWarning(source.contentWarning) !== content) return false;
  const term = query.trim().toLocaleLowerCase();
  return !term || [source.id, source.name, source.displayName, source.lang, source.extension?.name, source.extension?.pkgName]
    .filter(Boolean).join(' ').toLocaleLowerCase().includes(term);
}

export function sourceLanguages(sources: ReadonlyArray<Pick<SourceMetadata, 'lang'>>): string[] {
  return [...new Set(sources.map(source => source.lang).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
