# AIO-KAI development handoff

Updated: 2026-11-23

## Goal
Build a Windows desktop streaming application from AIOStreams Desktop while preserving its existing Stremio addon, AIOMetadata, debrid, and mpv playback flows. Add an independent, Eclipse-inspired music environment and port the previously tested Refract integration from HarborCommunity/Harbor.

## Repository state
- Fork: https://github.com/G1NYU/AIO-KAI
- Base: `main` at `35f8e06bd7f34818d4e0f894dda26bb32fcddc60` (matched Viren070/AIOStreams upstream).
- Development branch: `feature/desktop-music-entry`.
- Milestone 1 commit: `1816f8d5b799b4f1d1576f4c5c36f34efaab84d6`.
- Draft PR: https://github.com/G1NYU/AIO-KAI/pull/1
- `main` deliberately unchanged; do not merge until validated.

## Completed
The milestone 1 commit contains exactly six source files:
- Modified `packages/web/src/app.tsx` to allow desktop-only Music outside the AIOStreams video session.
- Modified `packages/web/src/components/shell/layout.tsx` to add video-sidebar Music navigation.
- Modified `packages/web/src/app/servers/page.tsx` to offer Music during server setup.
- Added `packages/web/src/lib/desktop-area.tsx` with independent media-area state.
- Added `packages/web/src/app/desktop-landing/page.tsx` with Movies & TV / Music selection.
- Added `packages/web/src/app/music/page.tsx` as a deliberately unconnected music interface shell.

The same standalone patch package passed five local tests (including three subtests) and syntax parsing of the new TSX files. Remote commit contents, exact six-source-file scope, PR head, and unchanged `main` were verified after pushing.

## Verification blocker
The fork currently reports **zero GitHub Actions workflow runs and zero check runs** for PR #1 and commit `1816f8d`. A full `pnpm` / React typecheck, lint, standalone web build, Rust desktop build and Windows GUI smoke test have **not** run. The available working container cannot resolve github.com to clone the full upstream repo. Do not equate the isolated patch tests with a verified application build.

## Release / deployment safety
`.github/workflows/desktop-nightly.yml`, `nightly.yml`, and `web-app-updates.yml` trigger on relevant changes to `main`. Work on the feature branch only. Do not manually dispatch release or Docker deployment workflows. No signing secrets, dependency changes, or workflow edits were introduced by milestone 1.

## Eclipse addon-store discovery (2026-11-23)
- Official public store manifest: https://eclipsemusic.app/addonstore/manifest.json
- Official public registry: https://eclipsemusic.app/addonstore/registry.json
- Registry verified to contain eight community entries: YouTube Music (one iOS-only and one cross-platform listing), SoundCloud (two variants), Tido, UltraMax, Internet Archive, and Unreleased Grid. They carry `setupUrl` or `manifestUrl`, not guaranteed immediately usable audio URLs.
- Eclipse protocol docs: https://eclipsemusic.app/docs — endpoints `/manifest.json`, `/search?q=`, `/stream/{id}` plus optional album/artist/playlist/catalog. Eclipse-only addons may require `X-Eclipse-Access` signed tokens that AIO-KAI cannot and must not forge.
- A local, **uncommitted** prototype now handles registry browsing, compatible manifest input, addon search, secure direct MP3/FLAC-style stream URL resolution and basic browser audio controls. Six isolated mocked protocol tests passed and the TypeScript service typechecked in isolation. Full web build, CORS and real Windows audio are unverified.
- Local source package: `AIO-KAI-eclipse-store-milestone2.zip` (conversation artifact). **Do not mark this implemented upstream until the full app builds and a real audio source is verified.**

## Next tasks
1. Establish usable CI on the feature branch or a complete trusted checkout and run:
   `pnpm install --frozen-lockfile`,
   `pnpm -F @aiostreams/web typecheck`,
   `pnpm -F @aiostreams/web lint`,
   `pnpm -F @aiostreams/web build:standalone`.
2. Run a Windows desktop smoke test: fresh welcome, Music without URL, existing video login, offline video server access, switching and video deep links.
3. Build an Eclipse-compatible music addon adapter according to https://eclipsemusic.app/docs. Verify actual playable audio from an authorized provider, not a placeholder.
4. Implement a persistent audio player and provider-aware music search/library after the first real playback test.
5. Port Refract client, ID mapping and queued synchronization from HarborCommunity/Harbor, adapting its event delivery to AIOStreams' watch_state protocol.
6. Only then polish the Music experience and assess release packaging.

## Known risks
- Switching between video and music currently unmounts the video session; intended stop/resume behavior needs Windows testing.
- Music currently has no actual streaming source, queue, library, lyrics, player or scrobbling.
- The AIOStreams upstream license is AGPL-3.0-only; preserve its source and attribution requirements.
- No CI check or Windows build has been verified as passing.

## Commit conventions
Use focused conventional commits. Do not modify or merge to `main` without validated tests and a reviewed workflow impact.
