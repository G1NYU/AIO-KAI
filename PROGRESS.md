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

## Next tasks
1. Windows smoke test this artifact in its own extracted portable folder. Connect a music addon that advertises `catalog`, browse Discover shelves, open album/artist/playlist and play from collections; check queue and existing direct audio remain stable. Sources without catalog should show a clear fallback.
2. With a song playing, expand the player and import the user-provided `NullBeat Monolith Desktop.eclipseplayer`; validate layout, layers, transport buttons, seek and fallback to default. Check scaling at 1280×760 and ultrawide.
3. Investigate Eclipse official skin export format and audio profiles (e.g. AutoEQ); they are separate to `.eclipseplayer` and remain unsupported. Any EQ requires a real native/WEB Audio signal-processing chain and performance tests.
4. Research DebridVault's current official integration/API and documented authentication; do not treat its root URL as a provider manifest or commit user tokens.
5. Port Refract watch progress, offline-queue and watchlist client/identity logic from HarborCommunity/Harbor, with test coverage.
6. Review encrypted or OS-backed secret storage for private addon URLs, installer identity, independent update feed, licensing and release QA before any merge to `main`.

## Risks
- Private configured addon URLs can contain access tokens. Persistence is opt-in and currently plain localStorage, not OS encrypted. The repo and CI fixtures contain only synthetic URLs.
- Catalogs are only available if the connected addon actually provides them; not all support album/artist/playlist detail endpoints. No automatic Apple Music fallback has been implemented.
- Imported Eclipse player layouts are an allowlisted v4 subset, not pixel-perfect parity with Eclipse Studio, and do not provide live lyrics, output-device switching, favorites or audio processing.
- Music still relies on direct HTTPS HTML Audio; HLS/DASH and DRM remain unsupported. Existing streaming playback stays untouched.
- No native debrid-vault integration; only an official external settings link is included in Music.
- AIOStreams' updater is upstream-bound; this is a portable **development build**, not a signed stable installer or official release.
- No verification of new Windows GUI interactions yet; earlier user playback success applies to a previous compiled version.
- Keep the draft feature branch separate from `main`.

## Commit rules
Focused conventional commits, re-read each diff, no private secrets, no force push, no merging to main without tests and deployment-impact review.
