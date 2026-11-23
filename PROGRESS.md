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

## Next tasks
1. Windows smoke test for milestone 3: connect YouTube Music / UltraMax / Tido in Music, switch to Movies & TV and back, confirm source stays selected and music remains paused; test restart with and without the opt-in remember setting.
2. Test the new mini/fullscreen player: real streaming, seek, volume, play/pause, next/previous, shuffle/repeat, queue selection, short and long songs, and keyboard/window controls at 1280x760.
3. Add source-driven catalog shelves using Eclipse's documented manifest catalogs and GET /catalog/{id}, plus album/artist/playlist detail endpoints, with source-correct track IDs.
4. Inspect a real Eclipse custom player/skin export before implementing JSON design import; the source-addon HTTP protocol is separate from Eclipse's custom UI/skin and audio-profile formats. Do not execute arbitrary remote skin code.
5. Port Refract client, identity mapping, queued diary/watchlist sync and playback event thresholds from HarborCommunity/Harbor; test against AIOStreams' playback identity and progress.
6. Finalize Windows installer identity, independent update feed, privacy/secret storage, licensing and release QA before any merge or stable release.

## Risks
- Durable "remember" explicitly saves tokenized provider URLs in localStorage without encryption. Defaults off; session-only sources remain in memory when switching sections. Native secure secret storage is desirable before broader distribution.
- The player uses browser HTML audio for direct HTTPS audio; HLS/DASH, DRM, dedicated native audio, Last.fm and native EQ/audio profile support remain unimplemented.
- Switching to Movies & TV pauses Music, but the video session itself is still recreated when navigating sections; video stop/resume behavior needs Windows testing.
- The expanded-player UI and source persistence are verified by web tests and compiled Windows CI, **not yet by a physical Windows run of the latest artifact**.
- AIOStreams desktop's default updater feed references upstream; portable ZIP is not a Velopack installer or public release.
- The project remains on a draft feature branch; main is unchanged.

## Commit rules
Focused conventional commits, re-read each diff, no private secrets, no force push, no merging to main without tests and deployment-impact review.
