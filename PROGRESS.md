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

## Tsugi rebrand — desktop visuals implemented; release migration still pending
**Brand:** `Tsugi` — the user's chosen name, referring to connecting and patching together the separate addon ecosystems for Movies & TV and Music. Replace consumer-facing AIO-KAI/AIOStreams-branded shell elements with an original Tsugi identity. Do not remove upstream acknowledgments, licensing, or provider names.

**Sequence (updated by user):** complete Junction layout and music visual testing → finish Tsugi's cross-section brand/color cohesion and compatibility-safe identity migration → begin Refract integration → first public stable release. The visual identity pass is now in the code; remaining installer and update identifiers need separate migration tests.

**Implementation checklist:**
1. **Brand audit:** inventory current `AIO-KAI`, `AIOStreams`, AIO icon, title, logo, splash, onboarding, Windows title bar, About/settings, taskbar icon, installer/shortcut, README, metadata, CI artifacts, website and updater/feed references. Distinguish upstream/internal protocol identifiers from user-facing branding.
2. **Design identity:** design a distinctive Tsugi wordmark and app symbol communicating linked/joined media sources; original vector master; high contrast and legible at 16/24/32px; provide light/dark app assets and Windows `.ico` multi-resolution variants. Keep the darker flat near-black blue-purple aesthetic without reusing upstream brand graphics. An original Tsugi SVG and six-size Windows ICO are now embedded, with additional distribution asset review still outstanding.
3. **UI replace:** replace visible app logo/brand text in shell, navigation, welcome/configuration screens, title bar, player, settings/About, empty states and desktop notifications. Ensure the video and music modules feel like one Tsugi product; preserve working streams, routing, provider search, Refract, accessibility and performance.
4. **Packaging/distribution:** update product display name, executable/installer naming, Windows taskbar and shortcut resources, AppUserModelID, installer publisher/product metadata, update feed, build artifact labels and release notes. Keep the upstream provider's API names where technically necessary. Review licensing/attribution, update signing and the new repository/site naming before changing any public URLs.
5. **Compatibility and migration:** design migration/aliases for existing portable configuration, tokens, watchlists, opt-in saved music sources, Refract credentials and old update/install IDs. Do not silently strand old installs, discard user data, or switch an update endpoint without a tested migration path.
6. **Verification and launch:** icon scaling and contrast at 16–256px, window title/notification/shortcut audits, fresh and upgrade installs on Windows, uninstall behavior, no autoplay/provider regressions, stable CI build and dedicated release checklist. Check for third-party name/trademark collisions before public distribution.

**Completed in this branch:** Tsugi mark/wordmark, desktop welcome/music/sign-in, video navigation, Windows window/error title, resource ProductName and embedded ICO, and palette label. **Intentionally unchanged:** executable name (`aiostreams-desktop.exe`), native AppUserModelID, URL schemes, updater feed, WebView2/data directories, config/credential keys and repository name. This protects existing installs pending migration testing.

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

## Milestone 7 — Expanded Junction layout and first cohesive Tsugi branding (2026-11-23)
- Code build commit **`67c299c56c0800288389cff3489a8ad9ea7f0138`**, draft branch `feature/desktop-music-entry`. Main stays at `35f8e06bd7f34818d4e0f894dda26bb32fcddc60`.
- Expanded Eclipse Studio renderer now uses responsive viewport-aware 16:9 sizing: `min(94vw, calc((100dvh - 116px) * 1.777778))`, instead of nesting inside `max-w-[1500px]` and `max-w-[1740px]` caps. Container-relative text scales up, and omitted-layer details are accessible in a collapsed compatibility section. This should address user screenshot with much unused desktop space. A physical high-DPI Windows and narrow-screen layout check is still required.
- Original Tsugi linking-stroke vector mark and six-resolution ICO (16, 24, 32, 48, 64, 128px), generated without external raster assets. Code files: `packages/web/src/components/tsugi-brand.tsx`, `packages/desktop/app/icons/tsugi.svg`, `packages/desktop/app/icons/tsugi.ico`. The Windows ICO is embedded by `packages/desktop/app/build.rs`; native `ProductName` / error title / Tao window title now display Tsugi.
- Welcome page, Music page, desktop video navigation and desktop sign-in use a consistent flat deep-night palette, pale blue accents and the Tsugi identity. The player default still stores the legacy ID `aio-dark` for compatibility, but shows `Tsugi Dark` in the UI. Non-desktop web/TV branding and the actual AIOStreams provider configuration names remain unchanged intentionally.
- Source paths changed: `packages/web/src/app/music/player.tsx`, `packages/web/src/app/music/studio-player.tsx`, `packages/web/src/app/music/page.tsx`, `packages/web/src/app/desktop-landing/page.tsx`, `packages/web/src/app/sign-in/page.tsx`, `packages/web/src/app/servers/page.tsx`, `packages/web/src/components/shell/nav/common.tsx`, `packages/web/src/components/tsugi-brand.tsx`, `packages/web/src/lib/music/player-theme.ts`, `packages/web/src/styles.css`, `packages/desktop/app/build.rs`, `packages/desktop/app/src/shell/tao_shell.rs`, `packages/desktop/app/src/platform/windows.rs`, new SVG/ICO, generated en-GB/POT. No new dependency, deletion, user-data migration or actual media transport change.
- CI on exact code commit **`67c299c5`**:
  - Music Validation: https://github.com/G1NYU/AIO-KAI/actions/runs/45209261195 — success, **28/28 Vitest**, TypeScript, lint and standalone web assets.
  - Web Translations: https://github.com/G1NYU/AIO-KAI/actions/runs/45209261282 — success.
  - Build Addon: https://github.com/G1NYU/AIO-KAI/actions/runs/45209261157 — success.
  - Native Windows test ZIP: https://github.com/G1NYU/AIO-KAI/actions/runs/45209261160 — success, artifact ID `14835443453`, native Rust executable compiled with new Windows icon resource.
  - Desktop Check: https://github.com/G1NYU/AIO-KAI/actions/runs/45209261173 — Windows sub-job success; Linux/macOS jobs still pending when this handoff was written.
- Portable ZIP extracted from downloaded GitHub artifact: `/mnt/data/Tsugi-Desktop-Windows-x64.zip` (30,754,783 bytes, SHA-256 `5b914a00314a71f81bfa5e52995fb89a649a881fad911307bf61f74b2c41e121`). Checked nested ZIP CRC, 204 entries, 8 DLLs, valid MZ/PE executable `current/aiostreams-desktop.exe`, UTF-16 resource text `Tsugi`, `.portable`, bundled `current/web/index.html`, LICENSE.
- This is a **portable development build** using the old executable name and install identity so previous configuration and updater linkages are not broken. Live user Windows GUI appearance and install/update migration are **not yet verified**.

## Next tasks — layout acceptance and Tsugi release migration before Refract
1. Windows visual smoke test: extract the new portable ZIP into its own folder, open a real song, expand and test both built-in Junction and imported Eclipse Studio layout. Confirm that it fills the screen at 1280×760 and ultrawide/high-DPI, controls remain accessible, and queue/lyrics/volume still work.
2. Confirm Tsugi identity throughout welcome, sign-in, Music, video navigation and Windows taskbar/window title. Remove remaining user-visible AIO branding **except source/protocol names**; audit About/settings, splash, notifications and secondary dialogs. Preserve user-selected server-specific themes where appropriate.
3. Before changing `aiostreams-desktop.exe`, AppUserModelID, installer name, updater feed, URL scheme or data paths, implement and test a migration/alias strategy with fresh install, portable upgrade and in-place installed upgrade. Avoid forced sign-out, token loss or duplicate incompatible install identities.
4. Complete remaining Music Discover album covers/categories as documented, subject to reliable metadata mapping, copyright and provider terms. Keep recommendations separate from actual playback sources.
5. After Music/brand acceptance, resume native Refract integration (movie/episode identity, playback progress, queued diary sync, watchlist operations) with tests and no video playback regression.
6. Keep draft PR separate from `main`; no public release until installer/update migration, licensing and Windows GUI checks pass.

## Risks
- The Eclipse Studio export is schema-grounded and structurally validated locally but has not been opened in Eclipse Studio; some rarely used layer kinds may differ from the actual application schema.
- The AIO-KAI UI supports only the allowlisted subset, not arbitrary remote renderer code. Missing source features are skipped.
- Lyrics requests go to public LRCLIB when explicitly opened and share title/artist; unavailable/mismatched lyrics show a graceful fallback. Actual WebView2 network behavior is untested.
- Current favorites are local to the app and do not write to the Eclipse user account or addon library; casting/Connect/output switching remain unimplemented.
- Opt-in saved personalized addon URLs currently reside in unencrypted localStorage. Move to OS-protected storage before public release; do not log source tokens.
- Portable Windows build is unsigned test software; native GUI and live stream interactions have not been retested on user hardware. The compiled EXE still has its original filename/app identity/update feed; changing those without a migration could lose existing installed profile associations.
- `main` is unchanged and the PR remains a draft.

## Commit rules
Focused conventional commits, re-read each diff, no private secrets, no force push, no merging to main without tests and deployment-impact review.

## Tsugi unified palette and flat desktop UI (2026-11-23)
- Target: `G1NYU/AIO-KAI`, `feature/desktop-music-entry`. This work is scoped to the Windows/native-desktop UI and does not change addon protocols, video decode, data paths, updater identifiers, or app install IDs.
- The imported Studio v4 layout is now saved as validated declarative JSON; choosing the built-in player or another stage preserves it for later. The selected layout and the selected theme are independent and survive component remounts when local storage is available.
- Palette colors are applied to the embedded Studio stage, its transport sliders, typography, lines and overlay drawers. The stage no longer paints an independently themed rounded card.
- A square, joinery-inspired Tsugi navigation symbol and typography-led Watch/Listen entrance replace earlier rounded desktop chrome. The desktop top navigation/logo/title and source link now refer to Tsugi; non-desktop branding remains unchanged for upstream compatibility.
- Desktop-only scoped CSS flattens controls and music cards. The production media player, deep link schemes, install identity and source credentials are not modified.
- Verification to complete on resulting branch head: web TypeScript, lint, music Vitest suite, i18n/catalog checks, standalone web bundle, Windows portable test artifact, actual player/layout/palette switching on Windows, and visible brand audit.
- Outstanding migration: executable and installer names still use original upstream identifiers. Change only with a tested migration to protect stored profiles and updater continuity.

## Tsugi player persistence and flat desktop visual system — verified build (2026-11-23)
- Code/catalog commit: `9aa7436559858359683d6dc1388ae138c7bd7bfa` on `feature/desktop-music-entry`; no merge to `main`, no production release. The intervening fix `89340f31` corrected a Lingui lint issue in the desktop title, and the final catalog commit synchronized generated `en-GB.po` and `messages.pot` with exact CI artifact checksums.
- Changes: saved/validated imported Eclipse Studio v4 layout with independent selected layout; player palette applied to the embedded stage surface, controls, typography, and overlays; flat edge-to-edge Studio player; desktop-scoped angular Tsugi brand, top navigation, welcome screen and music cards. Native playback engine and addon configuration are unchanged.
- **Passed on exact code commit `9aa74365`:**
  - Desktop Music Validation: https://github.com/G1NYU/AIO-KAI/actions/runs/45215900758 — web TypeScript, lint, Vitest music suite, and standalone web assets.
  - Web App Translations: https://github.com/G1NYU/AIO-KAI/actions/runs/45215900468 — lint, source extraction and committed catalog comparison.
  - Build Addon: https://github.com/G1NYU/AIO-KAI/actions/runs/45215900416 — success.
  - AIO-KAI Windows Test Build: https://github.com/G1NYU/AIO-KAI/actions/runs/45215900368 — success; artifact ID `14837879047`.
  - Desktop Check: https://github.com/G1NYU/AIO-KAI/actions/runs/45215900427 — Windows native check passed; macOS/Linux were incomplete at this handoff.
- Downloaded and inspected Windows artifact. Nested portable ZIP was extracted as `Tsugi-Desktop-Windows-x64.zip` (30,757,108 bytes; SHA-256 `e8c7c2e12883b728b29217fba24d5498fe1aae40dfc64fff62ad6b5f71d512e9`). Outer/nested ZIP CRCs passed; nested ZIP contains 204 entries, 8 DLLs, valid MZ executable, embedded Tsugi product title, portable marker and bundled web assets. The executable file remains `current/aiostreams-desktop.exe` to preserve old install identity.
- **Not yet verified:** actual imported layouts and palettes in a running Windows WebView, visual spacing at high-DPI/narrow/ultrawide sizes, cold restart persistence with local storage permissions, actual streaming and lyrics/queue behavior. These must be checked before announcing the redesign as production-ready.
- **Remaining identity migration:** update installer/executable naming and internal identifiers only with explicit upgrade/rollback tests. Keep upstream attribution and licensing; do not bulk-rename credentials, custom scheme, storage paths or updater feed.

## Tsugi 2026 material and player refresh — staged, not pushed (2026-11-24)
- Candidate parent: `9cb41feecf9d5b54b8292fdc32406cdf62eed102`, current live branch `feature/desktop-music-entry`. This candidate lives as unreferenced Git objects until one explicit push approval after review.
- Design references: Apple's Human Interface Guidelines on material, alignment, adaptive layout and audio controls; Catppuccin's official Mocha palette; contemporary Dribbble/Behance desktop music-player studies. The work uses an original compositional and icon design, not copied imagery or vendor assets.
- Changes: new official-token Mocha theme and neutral matte-black theme, while all three pre-existing theme identifiers and the original persistence key remain supported; dynamic gateway theme selection; gentle glass title rail, landing cards and floating music dock; no global zero-radius override; revamped music header/track rows and collection surface; responsive Junction player with lyrics, queue, local favorite, volume, seek and transport. Imported Eclipse Studio layouts retain their own declarative geometry.
- Original calligraphic-inspired `つ` brand mark is staged as SVG and a multi-resolution Windows ICO (16, 24, 32, 48, 64, 128 and 256px). The current Windows build script already embeds `icons/tsugi.ico`; no app-ID/installer/updater change was required.
- Existing music player tests were updated for five palettes and an explicit text/background contrast check. Source Lingui catalogs were updated to include the new theme labels and Junction component references.
- **Validation completed:** inspected base branch/PR/head before staging; generated and structurally checked ICO entries; inspected icon silhouette at multiple sizes; inspected a focused GitHub comparison confirming changes in intended web/Windows icon files; checked CSS brace balance and existing UI translation references.
- **Not validated:** TypeScript compiler, ESLint/Lingui extraction equality, Vitest, Windows native build and visual playback smoke tests have not run against this staged candidate. No claim of passing tests or working Windows visuals until CI/build and actual GUI checks complete.
- **Next:** review staged candidate diff, receive one explicit approval to update `feature/desktop-music-entry` with fast-forward/lease, then run and inspect all PR CI checks; diagnose real failures before repush. Verify title chrome, responsive Junction alignment, imported Eclipse Studio layout, theme switching and cold restart on real Windows; keep PR draft and `main` unchanged until accepted.
- **Risks:** GPU blur surfaces may require performance adjustment on lower-end hardware; Windows ICO is new and needs actual taskbar/Explorer preview; other platform icons/installer labels are not migrated because their identity/updater impact requires a separate compatibility plan. The native video stack and stored addon credentials are unchanged.
