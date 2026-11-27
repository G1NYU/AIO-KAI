import React from 'react';
import { storage } from './storage';
import type { ResumeRow, ResumeTarget } from './up-next';

/** A desktop-only mode above the AIOStreams (Jellyfin) session boundary. */
export type DesktopArea = 'welcome' | 'video' | 'music' | 'read' | 'vault' | 'watch';

export type WatchEntryPane = 'addons' | 'anime' | 'stremio' | 'nuvio';

export type DesktopAreaActions = {
  openWelcome(): void;
  openMusic(): void;
  openVideo(): void;
  openWatchPane?: (pane: WatchEntryPane) => void;
  openSettings(): void;
  openRead?: () => void;
  openBooks?: () => void;
  openManga?: () => void;
  openVaultComic?: (jobId: string) => void;
  vaultComicTarget?: { jobId: string } | null;
  consumeVaultComic?: (target: { jobId: string }) => void;
  openVault?: () => void;
  openVaultMusic?: (track: { id: string; title: string }) => void;
  openLocalMusic?: () => void;
  openLocalAudio?: (file: File) => void;
  openVideoDownloads?: () => void;
  openResume?: (target: ResumeTarget) => void;
  resumeTarget?: ResumeTarget | null;
  consumeResume?: (target: ResumeTarget) => void;
  musicResumeRows?: ResumeRow[];
  readerReady?: boolean;
};

export const DesktopAreaContext =
  React.createContext<DesktopAreaActions | null>(null);

export function useDesktopArea(): DesktopAreaActions | null {
  return React.useContext(DesktopAreaContext);
}

export type StartupArea = Exclude<DesktopArea,'watch'> | 'auto';
const STARTUP_KEY = 'tsugi-startup-area-v1';
export function isStartupArea(value: unknown): value is StartupArea {
  return typeof value === 'string' && ['auto','welcome','video','music','read','vault'].includes(value);
}
export function readStartupArea(): StartupArea {
  const value = storage.get<unknown>(STARTUP_KEY);
  return isStartupArea(value) ? value : 'auto';
}
export function saveStartupArea(value: StartupArea): void {
  if (isStartupArea(value)) storage.set(STARTUP_KEY,value);
}

/** Existing users keep their familiar streaming startup unless explicitly changed. */
export function initialDesktopArea(
  isDesktop: boolean,
  hasSavedServer: boolean,
  hasReadSection = false,
  preference: StartupArea = 'auto',
): DesktopArea {
  if (!isDesktop) return 'video';
  if (preference !== 'auto' && isStartupArea(preference) && (preference !== 'read' || hasReadSection)) return preference;
  return hasSavedServer && !hasReadSection ? 'video' : 'welcome';
}

/** Music is intentionally exclusive with the native video environment. */
export function allowsMusicPlayback(area: DesktopArea): boolean {
  return area !== 'video' && area !== 'watch';
}
