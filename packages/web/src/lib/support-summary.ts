type InfoStatus = 'available' | 'unavailable' | 'failed';
type Capability = 'available' | 'unavailable' | 'not-reported';
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const capability = (value: unknown): Capability => value === true ? 'available' : value === false ? 'unavailable' : 'not-reported';
const platform = (value: unknown) => typeof value === 'string' && ['windows', 'macos', 'linux', 'android'].includes(value) ? value : null;

// Return only a numeric version and known prerelease label. Native build
// descriptions can contain paths or arbitrary text; they never enter reports.
function versionNumber(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 160) return null;
  const text = value.trim().replace(/^(?:mpv|ffmpeg)(?: version)?\s+/i, '');
  const match = /^v?(\d{1,4}\.\d{1,4}(?:\.\d{1,6})?(?:-(?:alpha|beta|rc|dev)(?:[.-]?\d{1,6})?)?)(?=$|[^\d.])/i.exec(text);
  return match?.[1] || null;
}
function buildIdentity(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) return null;
  const text = value.trim();
  return /^[a-f0-9]{7,40}(?: \(\d{4}-\d{2}-\d{2}\))?$/i.test(text) ? text : null;
}

/** An explicit allowlist, not a redaction pass over logs or app settings. */
export function buildSupportSummary(input: { webBuild: unknown; webVersion: unknown; bridge?: unknown; nativeInfo?: unknown; infoStatus: InfoStatus }) {
  const bridge = record(input.bridge), info = record(input.nativeInfo);
  const present = input.bridge != null && typeof input.bridge === 'object' && !Array.isArray(input.bridge);
  const infoAvailable = present && input.infoStatus === 'available';
  return {
    format: 'tsugi-support-summary', version: 1,
    web: { build: buildIdentity(input.webBuild), version: versionNumber(input.webVersion) },
    native: {
      present, platform: platform(bridge.platform),
      bridgeProtocol: typeof bridge.protocol === 'number' && Number.isInteger(bridge.protocol) && bridge.protocol > 0 && bridge.protocol <= 100 ? bridge.protocol : null,
      bridgeVersion: versionNumber(bridge.version),
      details: present ? input.infoStatus : 'unavailable',
      appVersion: infoAvailable ? versionNumber(info.app) : null,
      mpvVersion: infoAvailable ? versionNumber(info.mpv) : null,
      ffmpegVersion: infoAvailable ? versionNumber(info.ffmpeg) : null,
    },
    capabilities: {
      nativeMusic: capability(bridge.nativeMusicAudio),
      youtubeCatalogue: capability(bridge.youtubeMusic),
      readerRuntime: capability(bridge.reading),
      readerSetup: capability(bridge.readingSetup),
      torboxBroker: capability(bridge.torbox),
      managedBackups: capability(bridge.backupStore),
      releaseDiscovery: capability(bridge.tsugiReleaseCheck),
    },
  };
}
export function supportSummaryText(input: Parameters<typeof buildSupportSummary>[0]): string {
  return JSON.stringify(buildSupportSummary(input), null, 2);
}
