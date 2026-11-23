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
- Some later overlapping workflows were cancelled by concurrency; inspect specific run IDs before claiming latest checks are green.
- Current code is not yet demonstrated to play real music on Windows, so the feature is not release-ready.

## Windows portable test workflow (new)
- .github/workflows/desktop-music-windows-test.yml builds an x64 ZIP in CI on a PR; read-only contents permission; no releases, installer, deployment or auto-update feed changes.
- Packages current/aiostreams-desktop.exe, its web/ files, pinned libmpv runtime DLLs, the license and a .portable marker one level above current/; validates required ZIP entries.
- This is a test artifact, not proof the app launches or plays tracks. If the Windows build fails, diagnose its actual job logs, then fix and rerun.
- AIOStreams is AGPL-3.0-only; preserve its source and attribution obligations.

## Next tasks
1. Get the independent Windows x64 test workflow green and inspect its ZIP artifact contents.
2. Smoke-test on Windows: no-server launch, music without video URL, existing video session, switching, offline server, deep links, and Windows WebView2.
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
