# Watch recovery — live Windows acceptance

This checklist supplements [mandatory P0–P5](tsugi-recovery-roadmap.md), not the historical backup recovery checklist. Use a runnable **matching source revision** on Windows x64; never substitute an older stable release for the revision being accepted. Follow [local Watch acceptance before packaging](windows-development.md#local-watch-acceptance-before-packaging) and the roadmap's packaging gate. A debug or remote-web session cannot exercise the trusted native addon bridge. This is a procedure, not a report of completed live tests.

Record the source SHA, Windows version, portable/fresh/upgrade state, viewport and scaling, provider type, addon count, and whether the run is cold or warm. Keep private TMDB keys, account passwords, tokens, full configured manifest URLs, provider stream URLs, personal library data and raw sensitive logs on the device. Use only authorized content and provider accounts. Back up the working installation; test with a disposable profile or separate writable development copy. Never reset existing user data just to make an acceptance test pass.

## P0–P4 Windows journey

| Gate | Exercise | Required evidence |
| --- | --- | --- |
| P0.1 | Fresh start and previously unconfigured profile. Attempt to enter by Escape, skip, direct media navigation or a saved startup preference. Validate your personal TMDB v3 key and authenticate/import Stremio **or** Nuvio. Check an upgraded configured profile separately. | No required-setup bypass; valid connection and import allow entry; failures can retry; existing data is intact. |
| P0.2 | Open standalone Watch, then an existing AIOStreams/Jellyfin server route. Play an authorized movie, a series episode and an anime episode. | Correct title/episode, picture and audible audio; Back returns to the correct view; no regression to the proven player. |
| P1.2 | Use an authorized account with at least 35 configured addons, including a naturally slow or failing provider if available. Run import, then repeat with unchanged endpoints in the test profile. | Account order and enablement retained; successes and failures shown separately; retry works; unchanged sources reused; no catalogue/stream preload during import. Record stage durations below. If no slow/failing provider is observed, note that limitation, do not claim the live failure case passed. |
| P2.1–P2.2 | Search Family Guy as typed, then an anime title, using actual configured metadata. | Exact/relevant top match, Series before Movies, distinct sections with real posters/descriptions, no stale response overwriting the latest query or unrelated duplicate. |
| P3.1–P3.2 | Open a movie, then a multi-season series; favorite and queue it, select a particular episode. | Title-specific hero, actual metadata and episode still/synopsis/title, correct season/episode, persisted profile-scoped actions. |
| P1.1/P1.3/P1.4 | Open the exact episode's dedicated stream selector. Use the two timing passes below. Exercise available provider/quality filters and a failed provider retry. | Fast result playable before a slow response; title-bar remains clean and usable; source order preserved; correct video and selection; partial failure does not block other sources. |
| P0.2/P3.3 | Play, seek, switch to another valid stream, leave playback, restart and reopen Continue Watching. | Retained position and selected episode, working audio, real title/episode artwork and Resume; no stale grant or cross-profile state. |
| P4.1–P4.4 | Review first launch, personalization, returning Home, profile picker, Movies & TV, search, title details, episode list, selector, Anime Hub, Reader/Music/Vault rail and settings. At the actual desktop size and a narrow window, compare to supplied mockups and screenshot annotations. | Distinct welcome art, shared flat rail, consistent fonts, minimalist returning-home art, no overlap/clipping or duplicate brand; real poster coverage. Synthetic images cannot establish real provider coverage. |
| P4.5 | Search for authorized public SoundCloud media and select a complete public track. Listen for at least 30 seconds, pause/resume, seek and change tracks. Also exercise a naturally unavailable result if available. | Audible correct track, correct playback/time controls, graceful failure, no regression to other music sources. Record actual results and sanitized error text only. |

## Timing record

Use a stopwatch or a local screen recording with private information hidden. Record seconds to the nearest practical precision. Measure without disabling existing validation or extending timeouts. Do not fabricate a slow provider; if the naturally slow condition cannot be reproduced, leave that live criterion open.

| Measurement | Start | Stop | Cold (s) | Warm (s) |
| --- | --- | --- | --- | --- |
| Authentication/account list | Submit credentials | Account addon list appears | | |
| Import review | Start review/import of selected addons | Review/outcome available | | |
| Import persistence | Apply reviewed results | Installed stack is visible and usable | | |
| First playable stream | Open selector for a specified episode/movie | First enabled Play control visible | | |
| All providers complete | Same selector open, do not select yet | Pending provider count clears | | |
| Early playback | In separate pass, open same selector and select first available stream while others pending | First correct picture and audible audio | | |
| SoundCloud search | Submit authorized public query | First actual result appears | | |
| SoundCloud audio | Select public track | First audible audio | | |

For each import pass record total configured, already installed, newly imported, failed and retried counts. For each stream pass record compatible provider count, first result's provider (a public label or anonymous identifier), pending count when it first becomes playable, total supported results, and failed provider count. If selecting a stream cancels the remaining work, report that separately; the non-selecting pass provides total completion. Report a test as passed only after the expected observation occurs. Include the exact source SHA and the first failing user action for each failure.

## P5

Attach the exact source build's CI run, standalone production-build outcome, native test results, synthetic screenshot artifact, and sanitized live evidence. Keep fixture results separate from actual services. The roadmap's packaging condition is not relaxed by this checklist; a packaged artifact is not itself proof of live acceptance. Do not add a stable publication marker without an explicit release decision.
