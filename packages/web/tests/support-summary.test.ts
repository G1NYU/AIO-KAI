import { describe, expect, it } from 'vitest';
import { buildSupportSummary, supportSummaryText } from '../src/lib/support-summary';

const input = {
  webBuild: 'abcdef01 (2026-11-26)', webVersion: '0.1.0', infoStatus: 'available' as const,
  bridge: { platform: 'windows', protocol: 1, version: '0.1.0', nativeMusicAudio: true, reading: false, readingSetup: true, torbox: true },
  nativeInfo: { app: '0.1.0', mpv: 'mpv 0.40.0-311-gaa12345', ffmpeg: 'ffmpeg version 7.1.1' },
};
describe('safe support summary', () => {
  it('reports bounded build/version numbers and explicit declared capabilities', () => {
    const summary = buildSupportSummary(input);
    expect(summary.web).toEqual({ build: input.webBuild, version: '0.1.0' });
    expect(summary.native).toEqual({ present: true, platform: 'windows', bridgeProtocol: 1, bridgeVersion: '0.1.0', details: 'available', appVersion: '0.1.0', mpvVersion: '0.40.0', ffmpegVersion: '7.1.1' });
    expect(summary.capabilities).toEqual({ nativeMusic: 'available', youtubeCatalogue: 'not-reported', readerRuntime: 'unavailable', readerSetup: 'available', torboxBroker: 'available', managedBackups: 'not-reported', releaseDiscovery: 'not-reported' });
  });
  it('never copies account/device/settings/log/provider fields or arbitrary version suffixes', () => {
    const secret = 'SYNTHETIC_PRIVATE_SENTINEL';
    const text = supportSummaryText({ ...input,
      bridge: { ...input.bridge, device: secret, deviceId: secret, token: secret, url: `https://example.invalid/?token=${secret}`, settings: { password: secret } },
      nativeInfo: { ...input.nativeInfo, mpv: `0.40.0-${secret}`, ffmpeg: `C:\\Users\\${secret}\\ffmpeg.exe`, logs: secret, lastPlayed: secret },
    });
    expect(text).not.toContain(secret);
    expect(text).not.toContain('https:'); expect(text).not.toContain('Users');
    const summary = JSON.parse(text);
    expect(summary.native.mpvVersion).toBe('0.40.0'); expect(summary.native.ffmpegVersion).toBeNull();
    expect(text.length).toBeLessThan(2000);
  });
  it('refuses unknown build/platform and malformed or oversized metadata', () => {
    const summary = buildSupportSummary({ ...input, webBuild: 'https://private.invalid/abcdef01', webVersion: 'secret', bridge: { platform: 'private-device', protocol: 1.5, version: 'x'.repeat(1000), reading: 'true' }, nativeInfo: { app: { token: 'private' }, mpv: 'https://private.invalid/0.4.0', ffmpeg: 'x'.repeat(1000) } });
    expect(summary.web).toEqual({ build: null, version: null });
    expect(summary.native.platform).toBeNull(); expect(summary.native.bridgeProtocol).toBeNull(); expect(summary.native.bridgeVersion).toBeNull();
    expect(summary.native.appVersion).toBeNull(); expect(summary.native.mpvVersion).toBeNull(); expect(summary.native.ffmpegVersion).toBeNull();
    expect(summary.capabilities.readerRuntime).toBe('not-reported');
  });
  it('does not reuse stale native versions after failure or without a bridge', () => {
    for (const infoStatus of ['failed', 'unavailable'] as const) {
      const summary = buildSupportSummary({ ...input, infoStatus });
      expect(summary.native.details).toBe(infoStatus); expect(summary.native.appVersion).toBeNull(); expect(summary.native.mpvVersion).toBeNull();
    }
    const browser = buildSupportSummary({ ...input, bridge: undefined });
    expect(browser.native.present).toBe(false); expect(browser.native.details).toBe('unavailable'); expect(browser.native.appVersion).toBeNull();
  });
  it('keeps known prerelease version numbers without arbitrary descriptions', () => {
    const summary = buildSupportSummary({ ...input, webVersion: 'v0.2.0-rc.2', nativeInfo: { app: '0.2.0-dev.4 private-build-label' } });
    expect(summary.web.version).toBe('0.2.0-rc.2'); expect(summary.native.appVersion).toBe('0.2.0-dev.4');
  });
});
