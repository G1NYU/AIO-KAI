# TSUGI Watch recovery — mandatory P0–P5

Accepted 2026-11-27. Applies to every new test/release candidate. Supersedes earlier optional setup and automated-only acceptance statuses in the historical Watch journey audit. Baseline: c712cbb8b35772978b4bfcef639ce523a101d950. Maintainer confirms real playback and audio work; do not replace working playback. Maintainer observed 734 returned streams after a long delay, not a universal absence of streams. Preserve existing media server (AIOStreams/Jellyfin) routes, profiles, imported order, history, grants, and other media worlds. No stable release or prematurely advertised EXE.

Status convention: [ ] open; [x] verified with specific evidence. Code authored or fixture-only success is not full acceptance. Record implementation, automated checks and live Windows evidence separately. Work in order; independent repairs can proceed while CI runs.

## P0 — Mandatory setup and working baseline
- [ ] P0.1 Validated personal TMDB v3 API key and successful Stremio OR Nuvio sign-in/import are required before entering the app on first launch or an unconfigured Watch profile. No bypass by skip, Escape, direct navigation, startup preference or existing-install migration. Keep credentials native/protected; never persist account passwords or expose private keys in logs. Existing settings, profiles and imported sources are preserved.
- [ ] P0.2 Retain the proven server-backed Movies & TV home/search/details/episodes/version selector and existing native player; preserve direct addon and anime entry. Verify working movie, series and anime playback/audio. No destructive migration.
- [ ] P0.3 Read the actual Harbor, Stremio native core and Nuvio implementations and map reusable functions to TSUGI. Preserve license notices and existing security boundaries. Use supplied original TSUGI HTML mockups/design system, not new generic layouts.

## P1 — Streaming and import performance
- [ ] P1.1 Replace all-or-nothing stream batches with independently published compatible provider responses; do not wait for slow addons before showing or selecting fast results. Bounded concurrency/timeouts, request cancellation and stale-response guards. Preserve exact review IDs, grants and provider order. No redundant stream calls for catalogue-only addons. Verify fast provider visible and playable while a slow one is pending; measure time to first result and total completion.
- [ ] P1.2 Fast Stremio/Nuvio account import. Read the account list once; reuse already installed manifests for unchanged configured endpoints; preserve order and enablement. Do not fetch all catalogues or streams during login/import. Avoid barriers between batches; independent outcomes, bounded concurrency and failures/retry. Assess reuse of manifest payloads returned by the account service with native validation. Measure import duration with 35+ addons including one slow/failing provider. Do not weaken URL/manifest validation.
- [ ] P1.3 Manifest and ID compatibility against Stremio/Nuvio; respect types, idPrefixes, resources, extras, configured AIOMetadata/AIOStreams. Keep diagnostics in addon settings rather than title/home/search. Stream selector remains usable under partial failure. Preserve exact movie and episode IDs, anime aliases, existing transport behavior; explicitly document unverified transports.
- [ ] P1.4 Dedicated Harbor-style stream page, not the narrow right drawer. Full-width title/episode-specific backdrop, back/refresh, ordered providers with icons and progressive counts, formatted multiline stream labels, resolution/source/codec/audio/size/availability filters when data is available, clear play controls. No redundant quality labels or huge unresponsive lists; preserve valid selection index. Reuse shared version/player components.

## P2 — Search

Presentation acceptance clarified by maintainer: while typing Family Guy, show a polished top match and distinct Series (first) and Movies (second) sections, with images, related-title ranking and descriptions; no flat mixed grid. Use Harbor's visual structure, not its branding.
- [ ] P2.1 Actual TMDB metadata search/enrichment and AIOMetadata configured search support; metadata-capable search catalogues only. No arbitrary stream-only addon catalogues or non-search shelves. Respect addon and catalogue order. Separate Movies, Series and Anime; debounce and cancel obsolete queries; deterministic top match. Reconcile explicit aliases, avoid merging conflicting titles; preserve provider routes.
- [ ] P2.2 Harbor-style centered search overlay, top match, clean media-type sections, poster/metadata rows, useful provider filters. No flattened random grid, blank poster floods, raw failures, catalogue pagination clutter or duplicate entries. Test Family Guy and anime queries against configured metadata.

## P3 — Metadata and artwork
- [ ] P3.1 TMDB posters, title logos, cinematic backdrops and ratings/details, using correct IDs and authorized configured addon artwork/fallbacks. Never substitute unrelated illustration for a title. Full-width hero behind title details and home, no empty rectangle with isolated portrait.
- [ ] P3.1a Title actions: real, persistent favorite and play-queue actions beside Play/Resume; reuse existing server controls and implement standalone actions against the selected profile, not inert buttons.
- [ ] P3.2 Episode selector with correct season/episode stills (TMDB or addon), titles, synopsis, runtime, ratings when available, watched state. No per-addon Details buttons in the consumer title view. Keep provider troubleshooting in settings.
- [ ] P3.3 Continue Watching uses actual episode still or title backdrop/poster and progress. Persist/recover artwork identity across restart; no unnecessary blank cards. Include anime-specific Tenrai/MAL/Kitsu fallback where exact artwork matches.

## P4 — Visual fidelity and consistency
- [ ] P4.1 Movies & TV, Anime and returning Home share the existing Music/Read/Vault sidebar component, brand, typography, navigation and spacing. Preserve flat icons and media switching; no generic boxed sidebar or inappropriate Times New Roman/Georgia fallback. Use brush type only in intentional branded headings.
- [ ] P4.2 Profile picker: custom user picture or distinct minimalist profile artwork, matching TSUGI palette, composed across the full viewport; no reused busy hero illustration as profile image. Preserve existing profiles.
- [ ] P4.3 Anime Hub matches supplied HTML and artwork style; actual title hero art, correct spacing between hero poster/navigation and first shelf; consistent row/carousel typography, no overlap.
- [ ] P4.4 Returning Home uses distinct minimalist world-card art, consistent sidebar; remove crossed-out hero heading, bottom sidebar slogans and footer tagline marked in screenshot. Preserve illustrated welcome and personalization; distinct artwork, no duplications, no invented content. Follow approved design language.
- [ ] P4.5 Investigate SoundCloud search result that plays no audio and reports public media request failure. Reproduce with permitted media, fix native/public resolution as appropriate without breaking other music sources. Verify real audio and playback/error handling.

## P5 — Acceptance and packaging
- [ ] P5.1 Source/build/lint/typecheck/native/browser regressions, screenshot comparison at realistic desktop window sizes, fresh/upgrade setup and profile isolation. Verify actual user journey: mandatory setup, fast import, search, details, episode selection, first stream while slow provider pending, playback/audio, source switching, continue watching, anime and SoundCloud. Use permitted test media; preserve user data. Review every screenshot annotation and original streaming-flow HTML. Harbor functional/presentation reference, TSUGI design specification.
- [ ] P5.2 Only after P0–P4 and P5.1 pass: package Windows EXE, inspect artifact identity/content/checksum, verify native runtime on Windows with actual configured services and capture visual evidence. No production/stable release without explicit release decision. Distinguish CI package from accepted build.

## Source references
- RE-Harbor beta branch: TMDB onboarding, search context, addon search, stream pipeline/IDs; reviewed reference 02593b5572595970cc9420582a9e13c607c64e52.
- Stremio/stremio-core native manifest, catalogue and resource request handling: 9d3dee7f58f5a8931039d220a27c4590769231c8.
- NuvioMedia/NuvioDesktop ordered search and independent stream repository: 1ece6d7ae5dbda29d0ab05952375692a56d81078.
- Maintainer's annotated screenshots, tsugi-streaming-flow.html, TSUGI-First-Launch.html and Anime Hub HTML; preserve original design files.
- Historical audit: [watch-journey-audit.md](watch-journey-audit.md).

## Evidence log
- Implementation checkpoint: configured-server entry restored; valid account-supplied Stremio manifests reused and missing manifests reviewed in a bounded work-conserving pool. Added routing and native import tests. CI and live import timing remain pending; P0/P1 not complete.
- Baseline: maintainer reports successful real playback and sound, but slow import and source loading, missing artwork and unacceptable UI. Stream screenshot shows 734 results eventually. Remaining stages open until verified.
- Source investigation: registry.rs review_all_streams waits on chunks of eight and then returns a single result; accounts.rs review_import_candidates also waits at chunk boundaries. watch-catalogue-board.tsx renders a flat search grid and image={null} for Continue Watching. These are confirmed source-level defects. Do not confuse playback success with selector latency or claim a runtime timing measurement.
