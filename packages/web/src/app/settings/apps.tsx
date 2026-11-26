import { DiscordPresenceSettings } from '@/components/shell/discord-presence-settings';
import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { toast } from 'sonner';
import { Select } from '@aiostreams/ui/select';
import { Button } from '@aiostreams/ui/button';
import { copyToClipboard } from '@aiostreams/ui/utils/clipboard';
import {
  diagnosticsReport,
  SendReportDialog,
  withContext,
} from '@/components/send-report';
import { currentHost } from '@/lib/hosts';
import {
  openLogs,
  requestDiagnostics,
  applyLabel,
  applyUpdate,
  checkForUpdates,
  updateStatus,
  useUpdateState,
} from '@/lib/hosts/shell';
import { appBridge } from '@/lib/hosts/shell/bridge';
import {
  settings,
  useSetting,
} from '@/lib/settings';
import { useServerInfo } from '@/lib/jellyfin/server-info';
import { SettingsCard, SettingsRow } from './_components/settings-card';

function UpdatesCard() {
  const [setting, setSetting] = useSetting(settings.app.updateChannel);
  const update = useUpdateState();
  const channel =
    setting === 'installed' ? (update?.channel ?? 'stable') : setting;
  const busy = update?.state === 'checking' || update?.state === 'downloading';
  const button = 'w-full rounded-full sm:w-auto';
  return (
    <SettingsCard name="updates" title={t`Updates`} holds="local">
      <Select
        label={t`Channel`}
        help={t`Nightly builds come from every change, ahead of releases, and can break.`}
        options={[
          { value: 'stable', label: t`Stable` },
          { value: 'nightly', label: t`Nightly` },
        ]}
        value={channel}
        onValueChange={(v) => setSetting(v as 'stable' | 'nightly')}
      />
      <SettingsRow label={t`Status`} help={updateStatus(update)}>
        {update?.state === 'ready' ? (
          <Button intent="white" className={button} onClick={applyUpdate}>
            {applyLabel()}
          </Button>
        ) : (
          <Button
            intent="gray-outline"
            className={button}
            loading={busy}
            disabled={update?.state === 'off'}
            onClick={() => checkForUpdates(setting)}
          >
            <Trans>Check now</Trans>
          </Button>
        )}
      </SettingsRow>
    </SettingsCard>
  );
}

export function AppSection() {
  const app = currentHost().settings;
  return (
    <SettingsCard>
      <SettingsRow label={t`App settings`} help={app?.help}>
        <Button
          intent="gray-outline"
          className="w-full rounded-full sm:w-auto"
          onClick={app?.open}
        >
          <Trans>Open</Trans>
        </Button>
      </SettingsRow>
    </SettingsCard>
  );
}

export function DesktopSection() {
  return (
    <>
      <UpdatesCard />
      <DiscordPresenceSettings />
      <SettingsCard name="troubleshooting" title={t`Troubleshooting`}>
        <SettingsRow
          label={t`Logs`}
          help={t`What the app did each day, kept for a week.`}
        >
          <Button
            intent="gray-outline"
            className="w-full rounded-full sm:w-auto"
            onClick={openLogs}
          >
            <Trans>Open folder</Trans>
          </Button>
        </SettingsRow>
        <DiagnosticsRow />
      </SettingsCard>
    </>
  );
}

function DiagnosticsRow() {
  const server = useServerInfo();
  const [sending, setSending] = React.useState(false);
  // eslint-disable-next-line lingui/no-unlocalized-strings -- the report's own header
  const header = server.version && `AIOStreams ${server.version}`;
  const button = 'w-full rounded-full sm:w-auto';
  if (!server.reports && appBridge()?.tv) return null;
  return (
    <SettingsRow
      label={t`Report a problem`}
      help={
        server.reports
          ? t`Sends this device's details and the app's recent log to the server, with a code to give whoever looks into it.`
          : t`Versions and the recent log, to paste into a bug report.`
      }
    >
      <div className="flex w-full flex-wrap gap-2 sm:w-auto">
        {server.reports && (
          <Button
            intent="gray-outline"
            className={button}
            onClick={() => setSending(true)}
          >
            <Trans>Send report</Trans>
          </Button>
        )}
        {/* Nothing to paste into on a TV. */}
        {!appBridge()?.tv && (
          <Button
            intent="gray-outline"
            className={button}
            onClick={() =>
              requestDiagnostics(header)
                .then((text) =>
                  copyToClipboard(withContext(text), {
                    onSuccess: () => toast.success(t`Diagnostics copied`),
                    onError: () => toast.error(t`Could not copy them`),
                  })
                )
                .catch((e: Error) => toast.error(e.message))
            }
          >
            <Trans>Copy</Trans>
          </Button>
        )}
      </div>
      <SendReportDialog
        open={sending}
        content={() => diagnosticsReport(header)}
        onClose={() => setSending(false)}
      />
    </SettingsRow>
  );
}

export function AndroidSection() {
  return (
    <>
      <UpdatesCard />
      <SettingsCard name="troubleshooting" title={t`Troubleshooting`}>
        <DiagnosticsRow />
      </SettingsCard>
    </>
  );
}
