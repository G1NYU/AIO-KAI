# Optional Discord Rich Presence

TSUGI shares activity only after explicit opt-in in **App settings → Discord Rich Presence**. A new installation starts off, including installations with inherited AIOStreams Discord settings. Enabling this feature does not link accounts or request a Discord token.

## Setup

The maintainer registered TSUGI's public Discord Application ID `1575822403211362365` on 2026-11-27. New installations and previously unset IDs use this identity automatically, but sharing remains off until explicitly enabled. Existing custom IDs, media choices and privacy settings are retained. Open **Settings → Desktop app → Discord Rich Presence** (or **App settings → Discord Rich Presence** without a media server), enable sharing, and use **Check connection** with the Discord desktop app running. Also enable Discord's own activity sharing if you want others to see it. No bot, client secret, token or account linking is needed. An advanced custom ID remains available; saving it turns sharing off until explicitly enabled again. The registered application's live acceptance and any artwork uploaded in the Developer Portal have not been verified.

The application ID is a public identifier. It and these opt-in preferences remain device-local and are excluded from the existing portable-backup allowlist. Physical Discord acceptance requires a valid registered application and the running desktop client; mocked IPC and browser fixtures do not establish that live result.

## Visibility and lifecycle

- Separate choices cover Movies & TV, Music, Manga and Books. The master switch is off by default; individual media choices are prepared as on for the eventual explicit enable action.
- Video playback keeps priority. A visible manga or book reader takes priority over background music. Closing/hiding the reader returns to eligible playing music; paused music appears only while Music is visible.
- Movies & TV sends title, optional episode information, paused/playback timing and a validated public IMDb ID. Music sends title, artist and timing. Manga sends title, chapter and page. Books send title and page or percentage only after the renderer confirms opening.
- Existing optional video-browsing choices remain available under their own disclosure. They require master opt-in and video visibility; searching never sends the search query.
- **Private mode** and **Clear and pause sharing** clear activity and pause sharing until private mode is explicitly turned off. Private mode persists across restarts. Disabling sharing clears activity and cancels reconnect work.
- Clear commands bypass the normal four-second update spacing. An outstanding Windows IPC read notices a privacy-policy change at its next bounded pipe poll; closing the connection also releases the activity. The client/server IPC result still depends on the Discord desktop client.
- Webview exit disables the current native session. Reopening requires the saved policy to be loaded again; native startup itself is always disabled. A failed preference write fails closed for the current session and shows a persistence warning.

Only a closed public-metadata shape is sent. No provider URLs, local paths, credentials, account IDs or arbitrary remote artwork are accepted in presence. URL/path-like titles become a fixed private-title placeholder. The only link buttons are the public TSUGI repository and a syntactically validated IMDb title for video. Native status messages are fixed states; raw Discord responses, account details and socket paths are not shown or logged.

## Integration

The implementation reuses the existing local IPC transport, with no new dependencies. It requires a validated `DISPATCH/READY` handshake, matches activity response nonces, bounds frames to 64 KiB, handles ping/pong control frames and reports unavailable/refused/failed states. Eligible activity reconnects at thirty-second intervals; private/off states do not connect. Incoming preferences are also enforced natively rather than relying only on disabled UI controls.

Discord's official [RPC documentation](https://github.com/discord/discord-api-docs/blob/main/developers/topics/rpc.mdx) documents `SET_ACTIVITY` and supported Playing/Listening/Watching activity types. Manga and books use Playing with an explicit Reading state because RPC has no Reading activity type. The [Rich Presence setup guide](https://github.com/discord/discord-api-docs/blob/main/developers/discord-social-sdk/development-guides/setting-rich-presence.mdx) documents local desktop Rich Presence without account authentication and the requirement for a valid registered Application ID. These were checked on 2026-11-26.

## Verification

- `packages/web/tests/presence.test.ts`: default-off/legacy separation, ID validation, independent per-media and private policies, reader/music priority, closed metadata projection, safe timing and text bounds.
- `packages/desktop/core/src/discord.rs`: policy/payload/ID/frame/nonce tests plus the actual worker driven by a deterministic transport, including clearing a queued title during the update gap and cancelling unavailable-client retries.
- `packages/web/tests/discord-presence-browser.mjs`: actual settings, explicit setup, status feedback, local WAV playback, visible/hidden manga-reader priority, per-media choice, clear/private mode, restart persistence and failed writes.

Implementation files: `discord.rs`, `now_playing.rs`, `presence-model.ts`, `rich-presence.ts`, and `discord-presence-settings.tsx`; small lifecycle hooks sit in the existing video/music/manga/book components. No runtime download, workflow, stable release or public deployment is changed by this feature.
