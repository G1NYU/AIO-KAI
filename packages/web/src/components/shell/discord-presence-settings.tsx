import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { appBridge } from '@/lib/hosts/shell/bridge';
import { checkDiscord, useDiscordStatus } from '@/lib/hosts/shell/desktop';
import { savePresencePreferences, usePresencePreferences } from '@/lib/rich-presence';
import { DISCORD_EVENTS, settings, useSetting, type DiscordEvent } from '@/lib/settings';
import { PRESENCE_MEDIA, validApplicationId, type PresencePreferences } from '@/lib/presence-model';

function BrowsingChoice({ event }: { event: Exclude<DiscordEvent, 'playing'> }) {
  const [value, setValue] = useSetting(settings.app.discord[event]);
  const labels = { titles: t`Title pages`, home: t`Home`, discover: t`Discover`, search: t`Searching`,
    calendar: t`Calendar`, favourites: t`Favourites`, activity: t`Activity` };
  return <label className="!flex !flex-row items-center gap-3"><input type="checkbox" checked={value} onChange={event => setValue(event.target.checked)}/>{labels[event]}</label>;
}

export function DiscordPresenceSettings() {
  const heading = React.useId();
  const preferences = usePresencePreferences();
  const status = useDiscordStatus();
  const [applicationId, setApplicationId] = React.useState(preferences.applicationId);
  const [error, setError] = React.useState('');
  const bridge = appBridge();
  const validId = validApplicationId(preferences.applicationId);
  const statusText = !preferences.enabled ? t`Off. No activity is shared.`
    : preferences.privateMode ? t`Private mode. Activity is cleared and sharing is paused.`
    : !validId ? t`Add a Discord application ID to finish setup.`
    : status?.state === 'connected' ? t`Connected to the Discord desktop app.`
    : status?.state === 'not-found' ? t`The Discord desktop app is not running.`
    : status?.state === 'refused' ? t`Discord rejected the application or activity. Check the application ID.`
    : status?.state === 'failed' ? t`Discord did not respond. Check that its desktop app is running, then retry.`
    : t`Ready to share the media you choose.`;
  function save(next: PresencePreferences) {
    const saved = savePresencePreferences(next);
    setError(saved ? '' : t`Could not save this setting. Sharing is off for this session; check it again after restarting.`);
  }
  return <section className="tsugi-app-general" aria-labelledby={heading} data-ui="discord-presence-settings">
    <h3 id={heading}><Trans>Discord Rich Presence</Trans></h3>
    <p><Trans>Share your current title and progress with Discord. Off by default. Source links, artwork URLs, local paths and account credentials are excluded.</Trans></p>
    <label className="!flex !flex-row items-center gap-3"><input type="checkbox" checked={preferences.enabled} disabled={!bridge || !validId}
      onChange={event => save({ ...preferences, enabled: event.target.checked })}/><Trans>Enable Rich Presence</Trans></label>
    <label className="!flex !flex-row items-center gap-3"><input type="checkbox" checked={preferences.privateMode} disabled={!bridge}
      onChange={event => save({ ...preferences, privateMode: event.target.checked })}/><Trans>Private mode</Trans></label>
    <p role="status" data-ui="discord-presence-status">{statusText}</p>
    <fieldset disabled={!bridge} className="flex flex-wrap gap-x-6 gap-y-3">
      <legend><Trans>Share these media</Trans></legend>
      {PRESENCE_MEDIA.map(media => <label key={media} className="!flex !flex-row items-center gap-3">
        <input type="checkbox" checked={preferences.media[media]} onChange={event => save({ ...preferences, media: { ...preferences.media, [media]: event.target.checked } })}/>
        {({ video: t`Movies & TV`, music: t`Music`, manga: t`Manga`, books: t`Books` })[media]}
      </label>)}
    </fieldset>
    <p><Trans>Visible manga or books take priority over background music. Video playback takes priority while watching.</Trans></p>
    <div className="flex flex-wrap gap-3">
      <button type="button" className="tsugi-read-action" disabled={!bridge || !preferences.enabled || preferences.privateMode || !validId} onClick={checkDiscord}><Trans>Check connection</Trans></button>
      <button type="button" className="tsugi-read-action" disabled={!bridge} onClick={() => save({ ...preferences, privateMode: true })}><Trans>Clear and pause sharing</Trans></button>
    </div>
    <details>
      <summary><Trans>Optional video browsing</Trans></summary>
      <p><Trans>These page choices also require Movies &amp; TV sharing. Search shares only that you are searching, never the query.</Trans></p>
      {DISCORD_EVENTS.filter((event): event is Exclude<DiscordEvent, 'playing'> => event !== 'playing').map(event => <BrowsingChoice key={event} event={event}/>)}
    </details>
    <details open={!validId}>
      <summary><Trans>Discord application setup</Trans></summary>
      <p><Trans>Create an application named TSUGI in the Discord Developer Portal, then copy its Application ID here. Keep the Discord desktop app running. No bot, account authorization, client secret or token is needed.</Trans></p>
      <p><a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer"><Trans>Open Discord Developer Portal</Trans></a></p>
      <label><Trans>Application ID</Trans><input className="tsugi-read-input" inputMode="numeric" autoComplete="off" maxLength={20} value={applicationId} onChange={event => setApplicationId(event.target.value.trim())}/></label>
      <button type="button" className="tsugi-read-action" disabled={!bridge || !validApplicationId(applicationId)} onClick={() => save({ ...preferences, applicationId, enabled: false })}><Trans>Save application ID</Trans></button>
      <p><Trans>Saving a different application ID turns sharing off until you enable it again. This setting stays on this device and is not included in portable backups.</Trans></p>
    </details>
    {!bridge && <p><Trans>Rich Presence requires the TSUGI desktop app.</Trans></p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
