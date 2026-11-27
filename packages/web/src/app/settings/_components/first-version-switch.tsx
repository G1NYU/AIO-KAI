import { t } from '@lingui/core/macro';
import { Switch } from '@aiostreams/ui/switch';
import { appBridge } from '@/lib/hosts/shell/bridge';
import { settings, useSetting, useSettingsLayer } from '@/lib/settings';

/** Server-profile editors keep their own account setting, not this device's. */
export function useDeviceFirstVersion() {
  const layer = useSettingsLayer();
  return !layer && !!appBridge()?.stremioAddons;
}

export function FirstVersionSwitch({ disabled = false }: { disabled?: boolean }) {
  const [autoPlay, setAutoPlay] = useSetting(settings.playback.autoPlayFirst);
  const device = useDeviceFirstVersion();
  return <Switch
    side="right"
    label={t`Auto-play the first version`}
    help={device
      ? autoPlay
        ? t`Automatically start the first compatible version in source order. Applies to AIOStreams, Movies & TV and Anime on this device.`
        : t`Choose a stream from your enabled compatible sources before playing. Applies to AIOStreams, Movies & TV and Anime on this device.`
      : autoPlay
        ? t`Play starts the first version, and resuming goes back to the version you were watching. Hold Play to choose instead.`
        : t`Play lists the versions to choose from, but resuming goes back to the version you were watching. Hold Play to do the other: start the first version, or list them when resuming.`}
    value={autoPlay}
    onValueChange={setAutoPlay}
    disabled={disabled}
  />;
}
