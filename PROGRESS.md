# AIO-KAI development handoff

Updated: 2026-11-23

## Goal
Build a premium Windows streaming app on AIOStreams Desktop while preserving AIOStreams and AIOMetadata video search, addons, debrid and playback. Music is a separate Eclipse-inspired space with independent addon connections. Reuse Refract watch-state and watchlist logic from HarborCommunity/Harbor later.

## Repository
- Fork: https://github.com/G1NYU/AIO-KAI
- Main: 35f8e06bd7f34818d4e0f894dda26bb32fcddc60 (kept identical to upstream at project start)
- Development branch: feature/desktop-music-entry
- Draft PR, DO NOT MERGE before Windows validation: https://github.com/G1NYU/AIO-KAI/pull/1
- Original milestone 1 commit: 1816f8d5b799b4f1d1576f4c5c36f34efaab84d6

## Implemented
- Desktop-only Movies & TV / Music entry, without weakening AIOStreams video-session authentication.
- Music navigation in the video sidebar and server setup.
- An independent Music area: Eclipse public addon-store registry, connect a user-provided addon manifest, validate capabilities, search tracks and resolve direct HTTPS audio for an HTML audio player.
- Provider URLs are held in memory by default, not logged or committed. Optional explicit opt-in stores connected sources in localStorage (unencrypted); the UI discloses this and allows removal. Never embed personalized URLs in repo source, fixtures or logs.
- Provider adapter preserves URL query-parameter configuration, rejects unsupported HLS/DASH playback in the HTML player and sanitizes network error messages.
- Multiple provider connections, provider switching and optional local restore after app restart; switching to Movies & TV no longer unmounts the Music component. Music pauses when the video section opens.
- Full first-party Music player with album artwork, seek bar, play/pause, volume, previous/next, shuffle/repeat, persistent in-memory search-result queue, and expanded Now Playing view.
- 9 protocol and 3 saved-source Vitest tests in packages/web/tests/eclipse.test.ts and packages/web/tests/music-connections.test.ts.
- No new application dependencies or modified video player, release, signing or deploy code.

## Milestone 3 commits
- 09f5f59604015a40c52ea0e578ef5e9c0d020b71 — persist component state across media sections, multiple sources and opt-in local save.
- ed4ce4018ee8e3f57b6f2562c43479bc71aeb84c — custom mini/full-screen music player and functional queue.
- 504c44cb113d8f0a1a7898350c7921a80065db75 — regenerate the exact Lingui source catalogs.
- c57cf962e033b317f0e64b311b527417fdd59bb6 — include saved-source tests, remove temporary write-enabled workflow.
- 80493762cdceb244359b830847f38a2c357a384a — fix Vitest-only module-resolution mismatch.

## Verified CI (2026-11-23)
- Build Addon passed: run 45164419320, repeated run 45163980917. Builds the existing application modules, including the web app.
- Desktop Music Validation passed: run 45164419657 (Node 24, pnpm frozen install, shared core build, web typecheck, lint, Vitest adapter test and standalone desktop web-assets build).
- Web App Translations passed on commit 7c50b9f: run 45165964623.
- Exact generated localization source files en-GB.po and messages.pot were committed by CI as f14d3918a0a9857afccfe8181f11daa31e06b6cc; each gained 123 lines. The temporary, privileged catalog-sync workflow was removed in 7c50b9fe923649686915e8f6d2542f04c5d1772f.
- On commit 7f7c1cf89581ce5a91b437879b7891914a848923, all four checks passed: Build Addon 45166759373; Web App Translations 45166759021; Desktop Music Validation 45166759006; Windows Test Build 45166759361.
- **User verified on physical Windows** in the preceding portable build: UltraMax connected, Drake music search returned songs, and at least two tracks played with audible sound. Screenshots supplied 2026-11-23. This validates baseline live provider music playback, not the new controls.
- **Latest commit 80493762:** all four workflows passed: Web App Translations 45173994932, Desktop Music Validation 45173994906 (9 protocol + 3 persistence tests, web TypeScript, lint and standalone build), Build Addon 45173994821, and AIO-KAI Windows Test Build 45173994900. The expanded player and persisted sources still need physical Windows interaction tests.

## Windows portable test workflow (CI passed)
- .github/workflows/desktop-music-windows-test.yml builds an x64 ZIP in CI on a PR; read-only contents permission; no releases, installer, deployment or auto-update feed changes.
- Packages current/aiostreams-desktop.exe, its web/ files, pinned libmpv runtime DLLs, the license and a .portable marker one level above current/; validates required ZIP entries.
- Windows x64 CI completed successfully: https://github.com/G1NYU/AIO-KAI/actions/runs/45166759361 (artifact ID 14815875819, name AIO-KAI-Windows-x64-test; expires under CI retention policy). Source commit: 7f7c1cf89581ce5a91b437879b7891914a848923.
- The artifact ZIP was downloaded and independently verified: AIO-KAI-Windows-x64-test.zip, 30,730,860 bytes compressed, 204 entries, 8 DLLs, valid MZ Windows executable, .portable, current/web/index.html and LICENSE present; full ZIP integrity check passed.
- SHA-256: 7fe2c9dfb76566c2746870db66042753bf3c3c870e3347c4aeb8a3919f8a7c5c.
- Milestone 3 latest Windows build: https://github.com/G1NYU/AIO-KAI/actions/runs/45173994900 (artifact ID 14818641551, commit 80493762cdceb244359b830847f38a2c357a384a). Downloaded as AIO-KAI-Music-Player-Windows-x64.zip and independently verified: 30,738,356 bytes, 204 entries, 8 DLLs, valid MZ executable, .portable, bundled web/index.html, root LICENSE, and full nested ZIP integrity checks passed.
- Latest ZIP SHA-256: 147d71f1a6b82f480ef8b03a9aed14cea234e9c39933bbe579f9519fbd75f24c.
- This verifies a genuine Windows build and package. Baseline audio playback was user-tested on the prior build, but the latest source-persistence and custom-player interactions still require a physical Windows smoke test.
- AIOStreams is AGPL-3.0-only; preserve its source and attribution obligations.

## Milestone 4 — Eclipse catalogs, browsable media and Studio player import (2026-11-23)
- Code build commit: `9015af8ec17287ec9b7ef6df3d9c8ff770ca2d9f`, on `feature/desktop-music-entry`; draft PR #1 unchanged; `main` not touched.
- Eclipse manifest now supports optional `catalogs`; if an addon advertises `catalog`, Discover loads real addon-owned named shelves through `GET /catalog/{id}?skip=0`. Tracks use the original provider's id and playback URL, and convert catalog `durationMs` into seconds.
- Search now includes albums, artists and playlists in addition to tracks; opened items use `GET /album/{id}`, `/artist/{id}` and `/playlist/{id}`, with clickable artwork and queue playback through the original addon. Missing catalog support is shown as unsupported rather than fabricated.
- Music navigation now separates Discover, Search and Sources, including active-source switching and a direct external DebridVault settings link. DebridVault is a distinct Real-Debrid/TorBox library website: its root URL is **not** an Eclipse manifest, and native API/addon connectivity is not yet verified.
- First-pass import of **local Eclipse Studio schema-v4 desktop `.eclipseplayer`** JSON. Whitelisted, declarative layers are mapped to actual player actions; external scripts, foreign actions, remote code, and unrecognized layers are not executed/rendered. Maximum input file size 1 MB. Default player remains available.
- User-supplied NullBeat Monolith Desktop template contained 20 layers. 12 recognized kinds have supported renderers: artwork, title, artist, seek, time, play/pause, previous, next, quality, up next, close; 8 unsupported controls are skipped. The uploaded template is **not committed** to the repo.
- Source code changes this milestone: `packages/web/src/lib/music/eclipse.ts`, `packages/web/tests/eclipse.test.ts`, `packages/web/src/app/music/browse.tsx`, `packages/web/src/app/music/page.tsx`, `packages/web/src/lib/music/player-template.ts`, `packages/web/src/app/music/studio-player.tsx`, `packages/web/src/app/music/player.tsx`, `packages/web/tests/player-template.test.ts`, CI test command, generated en-GB / POT catalogs. No changes to the video player, dependencies, installer identity or release flows. The temporary translation-write workflow was removed before final code build.
- CI on exact code commit `9015af8e` ALL GREEN:
  - Desktop Music Validation: https://github.com/G1NYU/AIO-KAI/actions/runs/45184552777 — typecheck, lint, 18/18 Vitest tests (12 Eclipse adapter/catalog, 3 saved sources, 3 Studio template), standalone web bundle passed.
  - Web App Translations: https://github.com/G1NYU/AIO-KAI/actions/runs/45184553003 — passed.
  - Build Addon: https://github.com/G1NYU/AIO-KAI/actions/runs/45184552826 — passed.
  - Native AIO-KAI Windows Test Build: https://github.com/G1NYU/AIO-KAI/actions/runs/45184552649 — passed, including ZIP upload and package assembly.
- Final Windows artifact: id `14822918453`, `AIO-KAI-Windows-x64-test`. Downloaded nested archive and independently checked: ZIP test clean, 30,757,940 bytes compressed, 204 entries, 8 DLLs, valid Windows PE MZ executable, `.portable`, `current/web/index.html`, `LICENSE`.
- SHA-256 of extracted portable ZIP `de4104806ecb9939632d15395fce62bb7f03a4014752b292623f4b4c067a1077`.
- **Windows interaction testing of milestone 4 remains outstanding**. User previously confirmed real audio and a debrid-capable addon worked on an earlier build; new catalogs and Studio import were only tested in CI/synthetic templates, not demonstrated on a physical Windows machine.

## Milestone 5 — AIO Dark player theme feature pack and independent discovery (2026-11-23)
- Code build commit: `d092a6ed9a2b7eb30eb6876c4cce75191144cdca`, branch `feature/desktop-music-entry`, draft PR #1. `main` unchanged.
- Complete-width compact music bar uses three grid columns with **equal left and right regions** and a fixed centered player column on desktop, with responsive two-row layout on narrower windows. Long titles do not shift the playback transport controls. The bar is flat, has subtle dark AIO-style borders and no costly glass blur or gradients.
- Player palette choices: **AIO Dark** (default), Nightfall (very dark purple), Carbon (cool near-black). Save only the validated palette identifier in local storage; all styling comes from whitelisted internal palette definitions. Existing Eclipse Studio `.eclipseplayer` imports still work.
- Bundled **Nocturne Stage** fullscreen layout (12 declarative layers) is selectable directly in Now Playing, alongside the original default layout and imported Eclipse player templates. The original source playback, queue, audio element and Movies & TV engine remain unchanged.
- Added independent **ListenBrainz public weekly recordings** shelf to Music → Discover, even when the selected Eclipse addon declares no catalog shelves. Public API: `GET https://api.listenbrainz.org/1/stats/sitewide/recordings?range=week&count=30`. Only public title/artist/chart metadata is retrieved, without addon credentials, cookies or source URLs. Items are deduplicated and text-validated. Clicking a chart entry switches to Search, searches the selected provider and **requires the listener to select the correct result**. Never automatically resolves titles to possibly incorrect editions or falsely promises playback. If ListenBrainz is unreachable or blocked by CORS, show a non-disruptive error and keep existing source search available.
- Music main content widened from `max-w-6xl` to `max-w-[1440px]` for less unused screen space on large desktop windows.
- Code files: `packages/web/src/lib/music/player-theme.ts`, `packages/web/src/lib/music/discovery.ts`, `packages/web/src/lib/music/nocturne-stage.ts`, `packages/web/src/app/music/player.tsx`, `packages/web/src/app/music/charts.tsx`, `packages/web/src/app/music/browse.tsx`, `packages/web/src/app/music/page.tsx`, `packages/web/tests/music-feature-pack.test.ts`, focused music validation workflow update and generated Lingui catalog files. No third-party dependencies, production deployment, updater or video engine changes.
- A temporary PR-only, branch-scoped translation sync workflow was used to generate only `en-GB.po` and `messages.pot`, and then **deleted**. No privileged workflow remains.
- CI on exact code commit `d092a6ed`: all four GitHub Actions successful.
  - Desktop Music Validation: https://github.com/G1NYU/AIO-KAI/actions/runs/45192494091 — TypeScript, lint, **23/23 Vitest tests** (12 Eclipse adapter/catalog, 3 saved sources, 3 Eclipse Studio parser, 5 feature pack/discovery), standalone web bundle passed.
  - Web App Translations: https://github.com/G1NYU/AIO-KAI/actions/runs/45192494385 — passed.
  - Build Addon: https://github.com/G1NYU/AIO-KAI/actions/runs/45192494093 — passed.
  - AIO-KAI Windows Test Build: https://github.com/G1NYU/AIO-KAI/actions/runs/45192494118 — passed, including Rust native Windows executable, libmpv, ZIP packaging and GitHub artifact upload.
- Artifact ID `14825014227`, `AIO-KAI-Windows-x64-test`, downloaded and extracted to `AIO-KAI-Nocturne-Windows-x64.zip` (30,766,460 bytes). Verified with ZIP CRC check and full extraction listing: 204 entries, 8 DLLs, valid `MZ` Windows EXE, `.portable` marker, `current/web/index.html`, `LICENSE`.
- Portable ZIP SHA-256: `95841fa4bee262f67032489be9e5ed790f8779f5aa6baf02d72b7b1d4b87999c`.
- **Windows GUI testing of new default palette, truly-centered bar, Nocturne stage and ListenBrainz API/CORS remains outstanding.** User previously confirmed real music playback, provider switching and Studio template imports on an older build.

## Standalone Eclipse Studio player file (2026-11-23)
- Created **Tsugi — Nocturne Desktop.eclipseplayer** as a real standalone JSON export using the user-supplied `NullBeat Monolith Desktop.eclipseplayer` source shape, not merely an internal AIO-KAI preset.
- Matches the original's `schemaVersion: 4`, `formFactor: desktop`, `templateRevision: 2` and `requiredCapabilities.desktopStage` fields. Uses a new template ID, 12 supported functional player layer kinds, native layer transforms/appearance fields, a flat near-black purple background and muted blue-violet detail, with no imported preview URL or personalized addon tokens.
- The standalone file was delivered as `Tsugi-Nocturne-Desktop.eclipseplayer` in the conversation. JSON round-trip, layer ID uniqueness, supported-kind set and normalized coordinates checked against the exact original upload. **Actual import into the Eclipse website/desktop Studio and visual appearance remain to be tested by the user.** This file has not yet been committed to the repo and does not change AIO-KAI's code.

## Planned project rebrand — Tsugi (not yet implemented)
**Brand:** `Tsugi` — the user's chosen name, referring to connecting and patching together the separate addon ecosystems for Movies & TV and Music. Replace consumer-facing AIO-KAI/AIOStreams-branded shell elements with an original Tsugi identity. Do not remove upstream acknowledgments, licensing, or provider names.

**Sequence:** complete current music-player smoke tests → implement/verify native Refract → launch the Tsugi rebrand **before the first public stable release**. Treat this as a release identity migration with regression checks, not a bulk text replacement.

**Implementation checklist:**
1. **Brand audit:** inventory current `AIO-KAI`, `AIOStreams`, AIO icon, title, logo, splash, onboarding, Windows title bar, About/settings, taskbar icon, installer/shortcut, README, metadata, CI artifacts, website and updater/feed references. Distinguish upstream/internal protocol identifiers from user-facing branding.
2. **Design identity:** design a distinctive Tsugi wordmark and app symbol communicating linked/joined media sources; original vector master; high contrast and legible at 16/24/32px; provide light/dark app assets and Windows `.ico` multi-resolution variants. Maintain AIO Dark/Nocturne aesthetic without reusing upstream brand graphics. No new visual assets have been approved or produced yet.
3. **UI replace:** replace visible app logo/brand text in shell, navigation, welcome/configuration screens, title bar, player, settings/About, empty states and desktop notifications. Ensure the video and music modules feel like one Tsugi product; preserve working streams, routing, provider search, Refract, accessibility and performance.
4. **Packaging/distribution:** update product display name, executable/installer naming, Windows taskbar and shortcut resources, AppUserModelID, installer publisher/product metadata, update feed, build artifact labels and release notes. Keep the upstream provider's API names where technically necessary. Review licensing/attribution, update signing and the new repository/site naming before changing any public URLs.
5. **Compatibility and migration:** design migration/aliases for existing portable configuration, tokens, watchlists, opt-in saved music sources, Refract credentials and old update/install IDs. Do not silently strand old installs, discard user data, or switch an update endpoint without a tested migration path.
6. **Verification and launch:** icon scaling and contrast at 16–256px, window title/notification/shortcut audits, fresh and upgrade installs on Windows, uninstall behavior, no autoplay/provider regressions, stable CI build and dedicated release checklist. Check for third-party name/trademark collisions before public distribution.

**Non-goals for this roadmap-only update:** no code/product/installer IDs changed yet; no live app rename, GitHub repository rename, icon replacement or distribution migration performed. Keep the current draft branch stable until those changes are implemented and tested.

## Milestone 6 — Premium Tsugi Junction player (2026-11-23)
- User supplied Eclipse Studio screenshots with its controls/layers sidebar (queue, playlist/library, cast/Connect, lyrics, shuffle/repeat, output device, volume, up next, artwork, static text/shapes). Inspected the user's original `NullBeat Monolith Desktop.eclipseplayer` v4/desktop export as the schema reference.
- Created a **standalone** `Tsugi-Junction-Premium-Desktop.eclipseplayer` (30,400 bytes), 32 declarative Studio layers, flat near-black background, icy blue accents, artwork / song / album metadata, lyrics, interactive seek, transport, shuffle/repeat, queue, favorite, playlist/library, Eclipse Connect, output chooser and other informational elements. Validated JSON roundtrip, schema v4, desktopStage=1, unique layer IDs, normalized positions and no remote personal URLs. Delivered as a conversation artifact, **not committed to GitHub**. Import and fidelity in the official Eclipse Studio have not yet been verified.
- Expanded `packages/web/src/lib/music/player-template.ts` from 12 to **27 supported layer instances in this particular exported layout**, via safe static parser kinds. Unknown controls are skipped without dynamic script execution. Five of the 32 exported layers cannot yet be rendered functionally in AIO-KAI: add-to-playlist, add-to-library, Connect/casting, output-device switching and sleep-timer countdown. Eclipse may provide those functionalities inside its own native app; not verified.
- `packages/web/src/app/music/studio-player.tsx` now renders actual queue drawer, shuffle, repeat, seek, volume, locally persisted favorites (not a cross-provider library sync), custom text/lines and richer album/provider metadata. Clicking the lyrics control makes an **opt-in** public LRCLIB lookup using only song title and artist (no addon secrets), with strict title/artist/duration matching and synchronized lines when available. `packages/web/src/lib/music/lyrics.ts` has parsing, timing and HTTP error handling.
- Bundled `packages/web/src/lib/music/junction-stage.ts` as a selectable **Junction layout** in Now Playing; the previous Nocturne remains selectable with updated types. The existing audio transport and Movies & TV code were not changed. Imported `.eclipseplayer` can still be chosen independently.
- CI tests added/updated in `packages/web/tests/player-template.test.ts`, `packages/web/tests/music-lyrics.test.ts`, `packages/web/tests/music-feature-pack.test.ts`; `.github/workflows/desktop-music-check.yml` runs all five test files. All generated Lingui catalog changes were committed via a scoped one-time workflow, then the write-enabled workflow was deleted.
- **Verified code build commit:** `aef640b8831e0d43217f2d708f4ee7de1f48184b` on draft `feature/desktop-music-entry`. Four CI successes:
  - Music Validation: https://github.com/G1NYU/AIO-KAI/actions/runs/45201281821 — **28/28 Vitest**, TypeScript, lint and standalone web assets.
  - Web Translations: https://github.com/G1NYU/AIO-KAI/actions/runs/45201281959 — passed.
  - Full Build Addon: https://github.com/G1NYU/AIO-KAI/actions/runs/45201281659 — passed.
  - Windows portable build: https://github.com/G1NYU/AIO-KAI/actions/runs/45201281667 — passed, including native Rust EXE, libmpv, ZIP artifact upload.
- **Verified portable artifact:** ID `14831083175`, extracted `Tsugi-Junction-Windows-x64.zip` (30,775,759 bytes), nested ZIP CRC/integrity passed, 204 entries, 8 DLLs, valid `MZ` Windows EXE `current/aiostreams-desktop.exe`, `.portable`, `current/web/index.html`, `LICENSE`.
- Portable SHA-256: `1b35f58378fa035496658901851174cc2e36dcfdbbc737e03b6123138395bbf8`.
- **Windows visual QA remains outstanding:** built-in Junction, imported standalone 32-layer file, queue drawer, timed lyrics, volume and local favorites require actual mouse/keyboard playback tests. Do not equate green CI with functioning cast or Eclipse Studio compatibility.

## Next tasks — premium music before Refract
1. Test new portable Windows ZIP in its own extracted folder. Play through UltraMax / NullBeat / a working provider, expand Now Playing, select Junction layout, verify all implemented buttons, seek/volume/queue, favorites, timed lyrics and return to Nocturne/default.
2. Import `Tsugi-Junction-Premium-Desktop.eclipseplayer` into Eclipse's native Studio; check all 32 layers and report any export parser warnings or layout overlaps. Import into AIO-KAI separately and verify 27 supported layers; unsupported actions should not appear as fake controls.
3. Improve the Discover page with real genre/category rails and licensed/attributed album/artist artwork where source terms support it; ListenBrainz chart-only fallback still lacks covers and genre shelves.
4. Implement *real* device output selection/casting only when a verified Windows backend and permissions exist; no nonfunctional Chromecast or Eclipse Connect icons. Later consider native library/playlist actions and Eclipse app-wide skins/AutoEQ with their actual schemas.
5. Keep **Refract integration deferred** until the premium Music player and Discover experience pass user acceptance. Preserve existing Refract architecture/identity mapping plan for movies/episodes.
6. Continue the **Tsugi** app-wide identity plan after music and Refract, before the first stable release. Protect existing addon tokens/configurations and saved data during product/install migration.

## Risks
- The Eclipse Studio export is schema-grounded and structurally validated locally but has not been opened in Eclipse Studio; some rarely used layer kinds may differ from the actual application schema.
- The AIO-KAI UI supports only the allowlisted subset, not arbitrary remote renderer code. Missing source features are skipped.
- Lyrics requests go to public LRCLIB when explicitly opened and share title/artist; unavailable/mismatched lyrics show a graceful fallback. Actual WebView2 network behavior is untested.
- Current favorites are local to the app and do not write to the Eclipse user account or addon library; casting/Connect/output switching remain unimplemented.
- Portable Windows build is unsigned test software; native GUI and live stream interactions have not been retested on user hardware.
- `main` is unchanged and the PR remains a draft.

## Next tasks
1. Windows smoke test this Milestone 5 portable build in a **new folder**. Open UltraMax (no native shelves), verify ListenBrainz charts appear and a chart selection launches a provider search, then choose a correct track to play. Confirm NullBeat's native catalogs still display too. If charts do not load, inspect browser/WebView CORS and API response before changing code.
2. With a song playing, verify left/right-centered bottom bar at 1280×760 and ultrawide. Test the default AIO Dark, Nightfall and Carbon palettes; expand and select Nocturne Stage; seek, skip, volume and queue. Return to default and confirm imported `.eclipseplayer` still renders.
3. Only after user accepts the music player experience, start native **Refract integration**: port identity mapping, queued API writes, watchlist add/remove and early playback-progress logging from the Harbor implementation. Wire to AIOStreams' real media identity and playback events, not music metadata. Write tests and preserve video behavior.
4. **Tsugi rebrand:** follow the detailed roadmap above to replace all user-facing AIO branding, logos, icons, app/installer/release identity and documentation, with compatibility-safe saved-settings and update migration. Do this before the first stable public release, after music and Refract are validated.
5. App-wide Eclipse skins and Eclipse Audio/AutoEQ profile imports are separate from fullscreen player templates. Their real export schemas and processing requirements remain unimplemented; do not claim compatibility or execute untrusted theme code. Consider after Refract unless user reprioritizes.
6. Native secure storage for personalized addon URLs, stable installer/updater identity, accessibility and performance QA, and licensing before any public stable release.

## Risks
- ListenBrainz is external public chart metadata, not a streaming source. Its availability, browser CORS, changing chart rankings and selected-provider search quality may affect discovery; there is no automatic recording match or Apple Music catalog mirroring.
- Theme palettes are internal choices, not general Eclipse application skin import support. Built-in Nocturne is a safe declarative 12-layer player layout, not a complete custom Eclipse skin/equalizer implementation.
- Music still relies on direct HTTPS HTML Audio; HLS/DASH, DRM, native EQ, music scrobbling and full audio profiles remain unsupported. Existing streaming playback stays untouched.
- Private provider URLs may contain credentials, and opt-in saved source links remain unencrypted in localStorage. Native OS-protected storage should precede public release.
- The portable Windows ZIP is a **development build**, not a signed installer or proof that GUI behavior on a physical Windows machine is correct.
- Keep the draft feature branch separate from `main`.

## Commit rules
Focused conventional commits, re-read each diff, no private secrets, no force push, no merging to main without tests and deployment-impact review.
