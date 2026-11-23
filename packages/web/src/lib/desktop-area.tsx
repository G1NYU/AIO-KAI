import React from 'react';

/** A desktop-only mode above the AIOStreams (Jellyfin) session boundary. */
export type DesktopArea = 'welcome' | 'video' | 'music';

export type DesktopAreaActions = {
  openMusic(): void;
  openVideo(): void;
};

export const DesktopAreaContext =
  React.createContext<DesktopAreaActions | null>(null);

export function useDesktopArea(): DesktopAreaActions | null {
  return React.useContext(DesktopAreaContext);
}

/** Existing users keep their familiar streaming startup; new desktop users choose. */
export function initialDesktopArea(
  isDesktop: boolean,
  hasSavedServer: boolean
): DesktopArea {
  return !isDesktop || hasSavedServer ? 'video' : 'welcome';
}
