# Refract personal-key tracking (development)

This feature is under validation, not part of the existing stable release.

## Connect
1. In Refract, open Integrations → Access and connected apps and create a personal API key. Grant profile:read, library:write and history:write. API eligibility depends on your account.
2. In TSUGI Movies & TV, select your Watch profile, open Refract, paste the key and select Verify and connect. Never share or commit the key.
3. Enable Track completed movies and episodes to queue future completions. It is disabled by default. Select Sync next watch to send one queued event; old local history is not uploaded automatically.
4. Replace an expired or revoked key for the same account without discarding queued watches. Disconnect with confirmation before changing accounts. Disconnect deletes the local key and queue, not existing local/remote history. Revoke old keys in Refract.

[Authentication](https://getrefract.app/developers/authentication.html): personal keys are intended for members' own code; Refract recommends OAuth for apps serving other members. This is local user-managed mode, not registered OAuth.

## Privacy and scope
- Native Windows DPAPI-protected profile storage holds the key and queue; the renderer receives only the username and bounded status. No credential in portable exports or logs.
- Only exact IMDb, canonical TMDB movie/show and TVDB show identities qualify. Episodes require matching show-prefixed season and episode IDs. No guessed titles or anime numbering. Unmatched items are counted.
- A completed local playback transition queues a timestamped event. Up to 256 pending events per profile; close duplicate observations coalesce. Movie POST carries a stable Idempotency-Key; episode first-watch PUT is state-setting. Inbound sync, episode rewatch append, historical import and autonomous delivery are not implemented in this first batch. Local history and the outbound queue are independent.
- Network failures retain pending events for retry; backoff and rate limits are surfaced. A full queue or unmatched identity does not interrupt local history.
- Expand Refract watchlist on a movie/show detail to explicitly add or remove membership. The service protects other tracked library data; no whole-library deletion or automatic watchlist writes. Avoid enabling a second tracker for the same viewing.

[Lookup](https://getrefract.app/developers/search.html) · [Writes](https://getrefract.app/developers/writing.html) · [Rate limits](https://getrefract.app/developers/rate-limits).

## Validation
Synthetic native and browser fixtures are not live-provider acceptance. Verify real key eligibility, movie and episode writes, membership protection, profile isolation and physical Windows playback before packaging. See HANDOFF.md.
