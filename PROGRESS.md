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
- Provider URLs are session-only. Never print, log, commit, persist or share the user's personalized YouTube Music, UltraMax/Deezer and Tido/Tidal URL tokens.
- Provider adapter preserves URL query-parameter configuration, rejects unsupported HLS/DASH playback in the HTML player and sanitizes network error messages.
- Basic Vitest protocol coverage in packages/web/tests/eclipse.test.ts.
- No new application dependencies or modified video player, release, signing or deploy code.

## Verified CI (2026-11-23)
- Build Addon passed: run 45164419320, repeated run 45163980917. Builds the existing application modules, including the web app.
- Desktop Music Validation passed: run 45164419657 (Node 24, pnpm frozen install, shared core build, web typecheck, lint, Vitest adapter test and standalone desktop web-assets build).
- Web App Translations passed on commit 7c50b9f: run 45165964623.
- Exact generated localization source files en-GB.po and messages.pot were committed by CI as f14d3918a0a9857afccfe8181f11daa31e06b6cc; each gained 123 lines. The temporary, privileged catalog-sync workflow was removed in 7c50b9fe923649686915e8f6d2542f04c5d1772f.
- On commit 7f7c1cf89581ce5a91b437879b7891914a848923, all four checks passed: Build Addon 45166759373; Web App Translations 45166759021; Desktop Music Validation 45166759006; Windows Test Build 45166759361.
- Current code is not yet demonstrated to play real music on Windows, so the feature is not release-ready.

## Windows portable test workflow (CI passed)
- .github/workflows/desktop-music-windows-test.yml builds an x64 ZIP in CI on a PR; read-only contents permission; no releases, installer, deployment or auto-update feed changes.
- Packages current/aiostreams-desktop.exe, its web/ files, pinned libmpv runtime DLLs, the license and a .portable marker one level above current/; validates required ZIP entries.
- Windows x64 CI completed successfully: https://github.com/G1NYU/AIO-KAI/actions/runs/45166759361 (artifact ID 14815875819, name AIO-KAI-Windows-x64-test; expires under CI retention policy). Source commit: 7f7c1cf89581ce5a91b437879b7891914a848923.
- The artifact ZIP was downloaded and independently verified: AIO-KAI-Windows-x64-test.zip, 30,730,860 bytes compressed, 204 entries, 8 DLLs, valid MZ Windows executable, .portable, current/web/index.html and LICENSE present; full ZIP integrity check passed.
- SHA-256: 7fe2c9dfb76566c2746870db66042753bf3c3c870e3347c4aeb8a3919f8a7c5c.
- This confirms a real native Windows build and package, NOT that the app launches, plays media or accepts private addons on a physical Windows machine. User needs a hands-on smoke test.
- AIOStreams is AGPL-3.0-only; preserve its source and attribution obligations.

## Next tasks
1. Smoke-test the validated Windows x64 ZIP from run 45166759361 on a physical Windows PC (extract entire archive; run current/aiostreams-desktop.exe).
2. Check no-server launch, Music without AIOStreams URL, saved video login, switching, offline behavior, deep links and WebView2 playback.
3. Enter each private addon manifest only in the running app and test direct playable songs; verify CORS and provider behavior. Do not copy URLs into tests or logs.
4. Only after a real playback test, integrate reliable native audio for supported formats, queue continuity and a full Eclipse-inspired player.
5. Port Refract client, ID mapping and queued watch/watchlist updates from HarborCommunity/Harbor and add automated playback tests.
6. Review installer identity, independent update feed, license notices and final QA before any release.

## Risks
- Current Music playback is direct HTTPS HTML audio only; HLS/DASH, DRM, queue persistence, Last.fm and native audio are not integrated.
- Switching between video and music currently unmounts the video session; exact stop/resume behavior needs Windows testing.
- AIOStreams desktop's default updater feed references upstream; the raw development ZIP is not packed by Velopack and must not be mistaken for a release installer.
- Browser CORS or private addon authentication may prevent actual streaming, even though provider manifests and protocol tests pass.
- Source is a development branch; main stays unchanged until validated.

## Commit rules
Focused conventional commits, re-read each diff, no private secrets, no force push, no merging to main without tests and deployment-impact review.
