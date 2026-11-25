import type { DownloadsHost } from '@/lib/downloads/types';
import { appBridge } from './bridge';

function send(message: { type: string; [key: string]: unknown }) {
  appBridge()?.send(message);
}

/** The apps' download queue, which keeps going while the page reloads. */
export const shellDownloads: DownloadsHost = {
  add: (jobs) => send({ type: 'download-add', jobs }),
  control: (id, action) => send({ type: 'download-control', id, action }),
  remove: (id, files) => send({ type: 'download-remove', id, files }),
  list: () => send({ type: 'download-list' }),
  headers: true,
  folder: { choose: () => send({ type: 'download-folder' }), open: id => send({ type: 'download-open', id }) },
  configure: ({ concurrent, wifiOnly }) =>
    send({ type: 'download-config', concurrent, wifiOnly }),
  subscribe: (listener) =>
    appBridge()?.subscribe((m) => {
      if (m.type === 'download-state')
        listener({ type: 'state', folder: m.folder, jobs: m.jobs, vault_rate_mib: m.vault_rate_mib, aria2_available: m.aria2_available, aria2_enabled: m.aria2_enabled });
      else if (m.type === 'download-progress')
        listener({
          type: 'progress',
          id: m.id,
          bytes: m.bytes,
          total: m.total,
          speed: m.speed,
        });
    }) ?? (() => {}),
};
