import React from 'react';

/** A desktop-only mode above the AIOStreams (Jellyfin) session boundary. */
export type DesktopArea = 'welcome' | 'video' | 'music' | 'read' | 'vault';

export type DesktopAreaActions = {
  openWelcome(): void;
  openMusic(): void;
  openVideo(): void;
  openSettings(): void;
  openRead?: () => void;
  openBooks?: () => void;
  openManga?: () => void;
  openVault?: () => void;
  openLocalMusic?: () => void;
  openLocalAudio?: (file: File) => void;
  openVideoDownloads?: () => void;
};

export const DesktopAreaContext =
  React.createContext<DesktopAreaActions | null>(null);

export function useDesktopArea(): DesktopAreaActions | null {
  return React.useContext(DesktopAreaContext);
}

/** Existing users keep their familiar streaming startup; new desktop users choose. */
export function initialDesktopArea(
  isDesktop: boolean,
  hasSavedServer: boolean,
  hasReadSection = false,
): DesktopArea {
  return !isDesktop || (hasSavedServer && !hasReadSection) ? 'video' : 'welcome';
}

/** Music is intentionally exclusive with the native video environment. */
export function allowsMusicPlayback(area: DesktopArea): boolean {
  return area !== 'video';
}
