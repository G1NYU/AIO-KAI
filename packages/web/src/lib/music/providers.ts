import type { MusicConnection, MusicProviderKind } from './connections';
import {
  loadAddon, loadCatalog, loadDetail, resolveTrack, searchAddonAll,
  type EclipseCatalogDefinition, type EclipseCatalogItem, type EclipseDetail,
  type EclipseSearchResults, type EclipseStream, type EclipseTrack,
} from './eclipse';

/** Shared metadata and resolved-audio contract. The UI never constructs a provider's
 * search, catalog, collection or stream URL. A native provider can supply a
 * different transport while keeping its track IDs and credentials isolated. */
export interface MusicProvider {
  readonly kind: MusicProviderKind;
  search(query: string, signal?: AbortSignal): Promise<EclipseSearchResults>;
  catalogs(signal?: AbortSignal): Promise<EclipseCatalogDefinition[]>;
  catalog(definition: EclipseCatalogDefinition, skip?: number, signal?: AbortSignal): Promise<EclipseCatalogItem[]>;
  detail(item: EclipseCatalogItem, signal?: AbortSignal): Promise<EclipseDetail>;
  resolve(track: EclipseTrack, signal?: AbortSignal): Promise<EclipseStream>;
}

type ProviderFactory = (connection: MusicConnection) => MusicProvider;

const eclipseProvider: ProviderFactory = ({ url }) => ({
  kind: 'eclipse',
  search: (query, signal) => searchAddonAll(url, query, signal),
  async catalogs(signal) {
    const manifest = await loadAddon(url, signal);
    return manifest.resources.includes('catalog') ? manifest.catalogs ?? [] : [];
  },
  catalog: (definition, skip = 0, signal) => loadCatalog(url, definition, skip, signal),
  detail: (item, signal) => loadDetail(url, item, signal),
  resolve: (track, signal) => resolveTrack(url, track, signal),
});

const factories: Record<MusicProviderKind, ProviderFactory> = {
  eclipse: eclipseProvider,
};

/** Missing kind means an existing Eclipse connection, not a guessed provider.
 * Unrecognized kinds must never be treated as Eclipse or sent to its endpoints. */
export function providerFor(connection: MusicConnection): MusicProvider {
  const kind = connection.kind ?? 'eclipse';
  if (!Object.hasOwn(factories, kind)) throw new Error('Unsupported music provider.');
  return factories[kind](connection);
}
