import React from 'react';
import {
  chooseMusicFolder, folderAccessSupported, readMusicFolder,
  rememberMusicFolder, scanMusicFolder, type FolderAudio, type MusicFolderHandle,
} from '@/lib/music/remembered-folder';

type FolderStatus = 'empty' | 'ready' | 'permission' | 'error' | 'unsupported';
type FolderState = {
  handle: MusicFolderHandle | null;
  entries: FolderAudio[];
  truncated: boolean;
  status: FolderStatus;
};
const empty = (status: FolderStatus = 'empty', handle: MusicFolderHandle | null = null): FolderState =>
  ({ handle, entries: [], truncated: false, status });

async function loadFolder(handle: MusicFolderHandle, interactive = false): Promise<FolderState> {
  try {
    const permission = interactive
      ? await handle.requestPermission({ mode: 'read' })
      : await handle.queryPermission({ mode: 'read' });
    if (permission !== 'granted') return empty('permission', handle);
    const result = await scanMusicFolder(handle);
    return { handle, ...result, status: 'ready' };
  } catch {
    return empty('error', handle);
  }
}

/** Restore only previously granted read access; prompts require a user gesture. */
export function useRememberedMusicFolder() {
  const [supported] = React.useState(folderAccessSupported);
  const [state, setState] = React.useState<FolderState>(() => empty(supported ? 'empty' : 'unsupported'));
  const [busy, setBusy] = React.useState(supported);
  const alive = React.useRef(false);
  const running = React.useRef(false);

  React.useEffect(() => {
    alive.current = true;
    if (!supported) return () => { alive.current = false; };
    let current = true;
    running.current = true;
    void (async () => {
      try {
        const handle = await readMusicFolder();
        const restored = handle ? await loadFolder(handle) : empty();
        if (current) setState(restored);
      } catch {
        if (current) setState(empty('error'));
      } finally {
        if (current) {
          running.current = false;
          setBusy(false);
        }
      }
    })();
    return () => { current = false; alive.current = false; };
  }, [supported]);

  function begin(): boolean {
    if (!supported || running.current) return false;
    running.current = true;
    setBusy(true);
    return true;
  }
  function finish() {
    running.current = false;
    if (alive.current) setBusy(false);
  }
  async function choose() {
    if (!begin()) return;
    try {
      // Invoke the picker before any other asynchronous work.
      const handle = await chooseMusicFolder();
      if (!alive.current) return;
      await rememberMusicFolder(handle);
      const restored = await loadFolder(handle);
      if (alive.current) setState(restored);
    } catch (reason) {
      if (alive.current && !(reason instanceof DOMException && reason.name === 'AbortError'))
        setState(previous => ({ ...previous, status: 'error' }));
    } finally {
      finish();
    }
  }
  async function rescan() {
    if (!state.handle || !begin()) return;
    try {
      const restored = await loadFolder(state.handle, true);
      if (alive.current) setState(restored);
    } finally {
      finish();
    }
  }
  async function forget() {
    if (!begin()) return;
    try {
      await rememberMusicFolder(null);
      if (alive.current) setState(empty());
    } catch {
      if (alive.current) setState(previous => ({ ...previous, status: 'error' }));
    } finally {
      finish();
    }
  }
  return { ...state, supported, busy, choose, rescan, forget };
}
