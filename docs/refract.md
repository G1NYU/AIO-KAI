# Refract personal-key tracking (development)

This feature is under validation, not part of the existing stable release.

## Connect
1. In Refract, open Integrations → Access and connected apps and create a personal API key. Grant profile:read, library:write and history:write. API eligibility depends on your account.
2. In TSUGI Movies & TV, select your Watch profile, open Refract, paste the key and select Verify and connect. Never share or commit the key.
3. Enable Track completed movies and episodes to queue future completions. It is disabled by default. Due queued watches sync automatically while TSUGI is open and this Watch profile is active. Sync next watch checks the queue without bypassing the saved retry cooldown; old local history is not uploaded automatically.
4. Replace an expired or revoked key for the same account without discarding queued watches. Disconnect with confirmation before changing accounts. Disconnect deletes the local key and queue, not existing local/remote history. Revoke old keys in Refract.

[Authentication](https://getrefract.app/developers/authentication.html): personal keys are intended for members' own code; Refract recommends OAuth for apps serving other members. This is local user-managed mode, not registered OAuth.

## Privacy and scope
- Native Windows DPAPI-protected profile storage holds the key and queue; the renderer receives only the username and bounded status. No credential in portable exports or logs.
- Only exact IMDb, canonical TMDB movie/show and TVDB show identities qualify. Episodes require matching show-prefixed season and episode IDs. No guessed titles or anime numbering. Unmatched items are counted.
- A completed local movie or individual episode queues a timestamped event, not an entire series. Up to 256 pending events per profile. Movie POST uses a per-viewing stable Idempotency-Key; distinct rewatches remain distinct even if close together, and repeat checkpoints of one viewing are deduplicated. Episode first-watch PUT is state-setting. Inbound sync, episode rewatch append and historical import are not implemented in this batch. Local history and the outbound queue are independent.
- Network failures, including HTTP 408 request timeouts, retain pending events for retry with the original timestamp and movie idempotency key; backoff and rate limits are surfaced. Successful 2xx writes are acknowledged even without a response body. Permanent rejected or unmatched history events are counted and removed from the queue instead of blocking later events. A full queue or unmatched identity does not interrupt local history. Only one outbound network flight runs at a time, off the main registry worker. A profile switch cancels lookup before writing; an already authorized write may finish for its original profile. Account-sensitive changes can temporarily return busy during an active write. If committing an acknowledgment to disk fails, the result is retained and disk persistence is retried without sending again. An exclusive Windows file lock prevents concurrent desktop processes from writing the same profile store.
- Expand Refract watchlist on a movie/show detail to explicitly add or remove membership. The service protects other tracked library data; no whole-library deletion or automatic watchlist writes. Avoid enabling a second tracker for the same viewing.

[Lookup](https://getrefract.app/developers/search.html) · [Writes](https://getrefract.app/developers/writing.html) · [Rate limits](https://getrefract.app/developers/rate-limits).

## Validation
Synthetic native and browser fixtures are not live-provider acceptance. Verify real key eligibility, movie and episode writes, membership protection, profile isolation and physical Windows playback before packaging. See HANDOFF.md.

## Harbor reference behavior

[Upstream tracker](https://github.com/G1NYU/RE-Harbor/tree/1b72d2887ffa08520ac5b11a78ec5a56beabd890) separates local playback completion from configurable early logging (default 70%). [Review completion](https://github.com/G1NYU/RE-Harbor/tree/8f808b14eb7a3069160064cf75cd83c5f4c68f5e) preserves distinct viewings and guards concurrent queues. [Watchlist retry fixes](https://github.com/G1NYU/RE-Harbor/tree/00d264dd31bb65a6b6267c3947b8d225bab13e23) serialize retries with account guards. [Native two-way branch](https://github.com/G1NYU/RE-Harbor/tree/47d10b2e9742a65ba2bbdd06b2b8d7683e463d2f) demonstrates non-destructive cursor-based inbound history. TSUGI retains completion-only capture for now and adapts tested wire shapes, acknowledgment/error semantics, viewing identity and automatic outbound delivery to its protected native profiles; independent thresholds, inbound synchronization and automatic watchlist writes remain separate features.
