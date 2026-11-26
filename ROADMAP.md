# Tsugi — Music and application polish roadmap

Baseline: consolidated Windows x64 build [68b75f1](https://github.com/G1NYU/TSUGI/commit/68b75f1772eba86b9e3ac8973086d177df0d650d), [successful packaging run 45620044358](https://github.com/G1NYU/TSUGI/actions/runs/45620044358). User confirmed core functionality on the physical desktop; the new priorities are performance and visual polish. Work in the order below, validate each milestone, and preserve the existing working providers, reading runtime, video playback and download paths.

## Permanent application design rules

- All five surfaces (Music, Movies & TV, Read, Vault, Settings): no decorative dotted separators. List cells use alternating, subtly contrasting theme-owned surface colors, not visible dividing lines. Major structural divisions may use a clean solid border. Active/hover/focus states must remain distinguishable and keyboard accessible.
- Use shared Tsugi palette and font tokens; avoid fixed blue/purple backgrounds that clash with other themes. Panel colors must be derived consistently from the selected palette.
- Preserve existing controls and navigation. Use the real content/artwork, never invented data or fake controls.
- No new package on every small change; validate each step and package a coherent, tested milestone.

## Sequential milestones

| # | Scope | Acceptance gate | State |
|---|---|---|---|
| 1 | Faster playback: measure resolve/transfer/decode stages; eliminate redundant bridge work; reuse bounded audio in memory; evaluate resolver caching and one upcoming queued track prefetch; investigate progressive startup without changing audio quality or breaking seeks | Compare cold first-track, warm replay and next-track timings on a physical Windows connection; test rapid switching, cancellation, pause, seek, repeat and category continuity; no extra provider traffic without a bound | Implemented; CI passed; cold-start/progressive acceptance open |
| 2 | Artwork: select highest genuine resolution, prefer large provider originals for expanded player, size-aware cache and safe same-track fallbacks | Inspect actual decoded image dimensions; verify no low-res thumbnail is stretched unnecessarily, no unrelated cover substituted, no playback blocking | Implemented; CI passed; real-provider art review open |
| 3 | App-wide row/menu/list design: audit every dotted separator; implement tonal alternating rows, consistent hover/selected/playing states, clean structural borders | Render Music, Movies & TV, Read, Vault and Settings across palettes and widths; no decorative dotted rules; keep pixel visualizer distinct from separators | Implemented; CI passed; full palette review open |
| 4 | Expanded player: scale up primary art and transport composition, fill viewport intentionally, responsive metadata and lyrics/queue affordances | Check long titles, wide and smaller windows, all active controls and playback continuity | Implemented; CI passed; physical UI review open |
| 5 | Pixel-matrix visualizer: subtle moving background, minimal and immersive modes, optional off, reduced-motion support | Actual audio-reactive data where available; clearly separate ambient animation from audio-reactive mode; no fake spectrum; stable frame budget and no playback regression | Implemented; CI passed; native streams ambient only |
| 6 | Nocturne: rework entire skin so artwork, metadata and transport form a balanced composition; avoid separated tiny art and distant controls | Inspect all viewport sizes, artwork scaling, real controls, lyrics and queue | Implemented; CI passed; physical UI review open |
| 7 | Surface palette: coherent theme-derived canvas/raised/alternate/hover states in library and all app sections | Contrast and visual review of all supported palettes; avoid clashing panels and preserve selected accent | Implemented; CI passed; full palette review open |
| 8 | Playback queue: readable track names/art, clear current/up-next distinction, compact reorder/remove actions, sensible scrolling | Reordering, removing, clearing and playing queue entries verified; keyboard access | Implemented; CI passed; multi-item interaction review open |
| 9 | Sources drawer: distinguish active/installed sources and connection actions from optional addon store; compact readable controls | Verify connect/disconnect, source selection and store error/loading states; avoid displaying secrets | Implemented; CI passed; live provider review open |
| 10 | README: update project presentation and representative screenshots from user uploads; replace outdated visuals when final UI is stable | Accurate feature claims, inspect screenshots for private data, no bundled font files or misleading UI, verify image paths render | README updated; consolidated package #96 succeeded; sidebar follow-up package requested; permanent screenshots pending |

## Milestone 1 — first implementation slice

- Confirmed Windows yt-dlp currently completes the entire bounded audio transfer before mpv starts. Native audio operation only returns a canonical public watch URL; remove that redundant bridge round trip on Windows. Keep non-Windows provider resolution unchanged.
- Reuse one completed, decoder-confirmed audio buffer in memory for a matching public track for up to 120 seconds; clear on global stop, failure, expiry or unrelated load. No persisted signed URLs or extra network traffic.
- Log bounded timing measurements for resolver+transfer and decoder readiness without track identifiers, signed URLs or raw provider output. Unit tests cover exact target admission, TTL and allocation reuse.
- Bounded queue prefetch was implemented and passed validation #91. Progressive startup is not implemented; the whole-track transfer remains the baseline. Real Windows measurements remain required before claiming a cold-start improvement.

## Validation checkpoints

- [#91](https://github.com/G1NYU/TSUGI/actions/runs/45637445498): playback prefetch.
- [#92](https://github.com/G1NYU/TSUGI/actions/runs/45638045308): artwork variants and fallback.
- [#93](https://github.com/G1NYU/TSUGI/actions/runs/45638654539): tonal separators.
- [#94](https://github.com/G1NYU/TSUGI/actions/runs/45639079920): fullscreen stages and matrix.
- [#95](https://github.com/G1NYU/TSUGI/actions/runs/45639525522): palette, queue and sources; [fixture previews](https://github.com/G1NYU/TSUGI/actions/runs/45639525522/artifacts/15035545390) expire after seven days.
- Consolidated Windows packaging requested with additional narrow-window and matrix-mode browser assertions. Do not mark packaging or physical acceptance complete until verified.

- [Consolidated packaging run 45641571177](https://github.com/G1NYU/TSUGI/actions/runs/45641571177) succeeded. Follow-up fixes the user-reported lighter workspace sidebar backing in both Music and Vault; computed-color browser assertions added. Fresh package requested.

---

# Tsugi — post-v0.1.0 roadmap: ownership, reading and continuity

Baseline: [official v0.1.0](https://github.com/G1NYU/TSUGI/releases/tag/v0.1.0); Reader artwork follow-up at `6de0441`. All items below are planned unless explicitly identified as existing foundations. Prior music/polish history above is retained. The goal is Mihon-grade day-to-day usability on Windows without turning Tsugi into four disconnected applications.

## Priorities and execution order

| ID | Priority | Milestone | Initial state |
|---|---|---|---|
| A1 | P0 | Portable backup, restore, storage management | Planned |
| A2 | P0 | Safe Tsugi-native application updates | Planned |
| B1 | P1 | Extension updates and source management | Partial; first Reader priority |
| B2 | P1 | Native Mihon backup and CSV migration/import | Partial; existing title-only batch import |
| B3 | P1 | Offline manga, CBZ and storage policy | Planned |
| B4 | P1 | Daily reading workflow and per-title controls | Partial |
| B5 | P1 | Tracker sync and source migration | Partial |
| C1 | P2 | Cross-media Up Next | Planned |
| C2 | P2 | Vault-to-library handoff | Partial; existing manual handoff |
| C3 | P2 | Connections, privacy and diagnostics | Partial; existing About/version |

A1 → A2 → B1 → B2 → B3 → B4 → B5 → C1 → C2 → C3. B1 discovery of the pinned runtime's update capabilities can run alongside A1 design, but do not perform live extension mutations before recovery safeguards exist. Keep v0.1.0 intact; publish incremental validated releases rather than one giant feature dump. Version numbers beyond the next patch are not commitments.

## A1 — Portable backup, restore and storage (P0)

- Inventory TSUGI-owned persisted state across native data, WebView storage and managed Reader runtime; assign ownership, schema, stable identifiers and migration rules. Include appearance, settings, source/repository URLs, source selections, manga library/categories/bookmarks/history/page progress, book positions, saved tracks, albums, playlists and queue/resume metadata where supported. Preserve references to local files; do not copy media by default. Server-owned video progress remains server-owned.
- Manual export to a chosen location and opt-in scheduled backups while Tsugi is running; retention, last result, next run, missed-run handling and an optional backup before upgrades. No claim of scheduling while the app is closed unless a separately approved Windows task exists.
- Versioned portable archive with manifest, bounded entries, integrity checks, atomic writes and compatibility checks. Use consistent snapshots of managed runtime state, not an unsafe copy of a live database. Never export tokens, cookies, passwords, API keys, tracker sessions, TorBox keys, signed URLs or embedded credentials. Preserve only credential-free source URLs; omit sensitive URLs and explicitly list reconnect-required sources. Treat backups as private library metadata even without credentials.
- Restore preview with counts, conflicts, duplicates, unknown schemas, missing local paths, reconnect-required sources, merge/replace choices and explicit confirmation. Make recovery snapshot first; stage/validate changes, roll back on failure, report partial/unmatched items, and verify round-trip. Reject traversal, oversized/corrupt archives and unsafe paths.
- Separate Settings → Data & storage into Backups, Restore and Storage management. Show application/runtime, cache, downloaded manga, Vault files, local book/audio references and backup sizes independently. Cache cleanup must not remove reading state; deleting downloads must not remove library/progress; do not delete arbitrary referenced files. Show exact scope and size before destructive cleanup.

Acceptance: fresh portable copy round-trip, mixed media and non-ASCII paths, interrupted export/restore, corrupted/older archive, conflict handling and secret-scanning fixtures. No destructive operation without preview/confirmation.

## A2 — Application updates (P0)

- Existing portable mode disables the inherited upstream Velopack updater; implement a TSUGI-owned stable-release check against G1NYU/TSUGI. Separate optional prerelease channel, show current/latest build, release notes, download size/status and manual check. Never follow upstream AIOStreams executable feeds.
- Verify expected architecture, release identity, archive manifest, checksums and trusted provenance (checksum from the same feed detects corruption, not independent publisher authentication). Reject unsafe archive paths. Explicit approval before applying; stage alongside current binary/runtime, keep user-data paths separate, coordinate running playback/reading/downloads, snapshot before update, restart and verify launch; rollback if incomplete. No overwrite of active data or old release tags.
- Support manual update instructions as a safe fallback; package-only tests before enabling automatic apply. Preserve configuration and user data across versions; avoid mixing incompatible runtime data migrations.

Acceptance: old-to-new portable upgrade retains library, playlists, source settings and progress; interruption, bad checksum, insufficient storage and rollback tested on Windows. Do not silently downgrade or erase data.

## B1 — Sources, Feed, Extensions, Migrate (P1; first Reader milestone)

- **Extension updates are mandatory**, not just refresh/install/uninstall. Inspect pinned Suwayomi GraphQL schema and runtime behavior for installed/available versions, update flags, icons, source preferences and native update action before implementing. Refresh repositories, show pending update count in Browse/Extensions, separate installed/updates/available/obsolete, update one or selected/all compatible extensions with per-item results, progress and retries. Do not treat lexicographic version comparison as authoritative. Confirm repository/package identity and trust; never silently switch repositories or uninstall on update failure.
- Preserve installed source and associated library mappings; verify after update. Show obsolete/unavailable/incompatible state distinctly. If runtime requires reinstall or exposes no supported update operation, report limitation and design a safe tested adapter; never blindly install over existing data.
- Browse navigation: Sources, Feed, Extensions, Migrate (keep existing library rail and global search). Use real source icons where available, safe fallback icons, source/extension names, language, repository name, installed/available version, 18+ metadata, update badge. Screenshot reference: Mihon-style compact tonal rows with separate install/update/configure actions. Keep user-supplied repositories; no bundled source list. Configure only supported source preferences, with secret-safe storage and clear unsupported state.
- Language and adult-content visibility filters with predictable defaults and unknown-rating handling; do not infer safety from missing metadata. Show update counts consistently with filter semantics.
- Feed: opt-in selected-source latest/popular discovery, pagination, bounded concurrency and explicit refresh/errors. Distinct from Updates, which only shows chapters of followed library titles. Do not run uncontrolled scraping or prefetch.

Acceptance: fixture simulates installed older version, available update, no update, obsolete and failed update; update one/all, verify source and library IDs/progress unchanged, real update on a trusted test repository, icons/filter/keyboard checks and no credentials in logs.

## B2 — Real Mihon backup, CSV and migration import (P1)

- Existing Batch Add handles title lists/CSV/converted JSON only, not a genuine backup or chapter progress. Add native file import for actual supported Mihon backup format(s), including compressed protobuf variants after verifying format/version against maintained upstream fixtures; safe decompression and bounded decoding. Keep CSV import/export with documented columns and explicit title-only limitations; support legacy converted JSON without breaking it.
- Dry run: parse metadata/categories/source IDs/titles, chapters, read flags, bookmarks, last-page progress, history and tracker references where present. Never import credentials; distinguish missing extensions/sources and unresolved tracker mappings. Match stable source identity + manga/chapter identifiers first; exact metadata fallback only when unambiguous. Let users choose source and review conflicts; never silently map different editions or chapters.
- Preview matched/ambiguous/unmatched/duplicate counts and proposed merges; import categories, bookmarks, progress and history only when resolvable. Do not overwrite newer progress silently; transactional/batched apply, checkpoint, retry and report downloadable unmatched entries. Source installation is a separate trusted explicit operation.
- Keep external Mihon backup import separate from TSUGI backup restore (A1) and moving an existing title to another source (B5). CBZ import belongs to B3 and is exposed through the same clear file-import entry point.

Acceptance: sanitized real backup fixtures from supported versions, dry-run no mutations, imported categories/bookmarks/read/page progress verified, duplicate reimport idempotent, invalid/unsupported backup safe, partial import reported. Physical test with a user-approved real backup.

## B3 — Offline manga, CBZ and downloads (P1)

- Import local CBZ into Read, safe ZIP parsing, supported image formats, natural page order, local library identity, reading position, bookmarks and existing vertical/single/double reading modes. Validate archive bounds/path traversal and malformed entries; no extracted script execution.
- Per-title and per-chapter download actions with selection, queue, progress, pause/resume/cancel/retry, optional download-ahead and opt-in auto-download of newly detected chapters. Prefer supported runtime download capabilities; isolate native reader jobs from generic Vault transfers but share resource limits where practical. Respect source access and rate limits. No network request when reading a verified offline chapter.
- Set global storage limit, optional per-title cap/retention, download location and background policy; show storage usage, offline indicators and failed/missing pages. Remove downloaded chapters only (progress/bookmarks/categories preserved), protect in-use pages and do not silently evict user-pinned files. Explicit cleanup policy and separate cache controls.
- Preserve partial downloads across restart and verify completeness before marking offline; define offline behavior when an extension is removed or updated.

Acceptance: CBZ fixtures including hostile/malformed archive, complete download then offline restart/read exact page, interrupted download resume, quota, cancellation, automatic-download opt-in and deletion with progress retained.

## B4 — Daily reading workflow (P1)

- Already present: Library, Updates, History, Browse, category CRUD/filter, global chapter check, chapter read/bookmark actions and global reader preferences. Audit and improve these, do not replace them.
- Library categories/shelves, multi-select/bulk operations where useful, global and per-category/title refresh with progress and error state; Updates lists new library chapters, History resumes exact chapter and page and supports sensible clearing without deleting library/progress.
- Translate phone swipe actions into configurable keyboard shortcuts and separate accessible row actions: mark read/unread, bookmark/unbookmark, download/remove offline, resume, multi-selection. Avoid shortcut conflicts with search and reading navigation.
- Searchable reader settings grouped into Reading mode, Display, Navigation and Downloads; add per-title overrides with inherit/reset-to-global. Preserve scroll, fit, zoom, gap, direction, double-page, focus, resume and auto-next behavior. Verify persistence across restart and all palettes.

Acceptance: refresh/history resume exact page in all modes; shortcut/row-action parity, per-title overrides don't affect other titles, filters and batch operations retain state.

## B5 — Tracker sync and source migration (P1)

- Existing manual MAL/AniList binding/sync and replacement preview must remain. Add opt-in one-way outbound progress sync after confirmed local changes, match preview, account/title mapping, coalesced jobs, bounded retry/backoff, visible pending/failed/synced state and manual retry. Never roll back local reading on remote failure, never leak credentials; separate authorization.
- Enhanced/inbound sync is a later separately enabled sub-step: fetch remote changes, preview conflicts and selected incoming changes before applying; no silent two-way overwrites. Validate chapter numbering and monotonic progress; allow explicit resets only.
- Browse → Migrate: choose saved original and replacement source, show chapter mapping and unmatched/ambiguous entries; transfer bookmarks, read flags, categories and page progress only when mapping/page counts are safe. Existing migration retains original and does not copy partial page progress; improve that explicitly. Keep original untouched until verification and separate explicit removal. Distinguish from external backup import.

Acceptance: tracker offline, expired authorization, conflict/retry and no local rollback; migration matching across source versions, partial pages, unmatched chapters, retry/idempotency and original retained. Live MAL/AniList test accounts only with user permission.

## C1 — Cross-media Up Next (P2)

- One compact resume workspace for episode/movie, manga chapter/page, EPUB/PDF position and Music queue/track. Reuse existing state and provider identities; video server is authoritative (Jellyfin/AIOStreams), no duplicate writeback or global discovery feed.
- Clear media badges, source availability, timestamp and resume action; handle unavailable files/disconnected providers gracefully, hide/dismiss entries without deleting progress. Respect exclusive video playback and music continuity policies.

Acceptance: all four media types resume correctly across restarts; disconnected sources visible without broken actions; no duplicate watch-state writes.

## C2 — Vault-to-library handoff (P2)

- Opt-in import after verified completion into chosen library/collection. Start EPUB/PDF and audio; add CBZ after B3. Preview duplicates and target, use stable content/path identifiers and idempotent import; no silent file moves, overwrites or deletions.
- Separate download succeeded/import failed states; retry import without redownloading, report unsupported/corrupt files and missing destination, preserve manual import.

Acceptance: successful book/audio/CBZ handoff, duplicate, interrupted import, invalid file, missing path and independent retry.

## C3 — Connections, privacy and diagnostics (P2)

- Optional Discord Rich Presence with per-media visibility and disable/clear controls; default off, private mode clears activity and no credentials or private source links in presence. Verify supported integration, no unsolicited account linking.
- App lock (local UI access control, not encryption) with safe credential storage, relock rules and clearly defined limits. Windows privacy/capture mode uses supported platform protections; clearly explain capture limits (external cameras, privileged processes, unsupported capture tools); don't promise total screenshot prevention.
- Advanced → Diagnostics: redacted crash/log export preview, build/runtime version, capability/status of reader, music, video and transfer engines; strip tokens, private URLs, sensitive paths, user content and account IDs by default; no automatic upload.
- Desktop background settings replace Android battery concepts: refresh cadence, background downloads, limits, pause on metered networks where supported, sleep/exit behavior, explicit launch-on-startup option if implemented. About already shows bridge version; extend with actual release tag/build commit and runtime health.

Acceptance: presence disabled/cleared, lock recovery, capture limitation documented, diagnostic secret fixtures, correct runtime version/status, Windows sleep/resume and background policies.

## Permanent constraints and release gates

- Keep the video-first AIOStreams/Stremio/Jellyfin experience, shared palettes/accents and tonal rows, accessible keyboard interactions, and existing playback engines. No unapproved backend redesign or new dependency where native APIs suffice.
- Never export credentials, expose private URLs, run untrusted extensions silently, or blur the boundary between cached assets/downloads and valuable user state. No destructive automatic migration.
- Each milestone: inspect actual pinned capabilities, implement smallest complete feature slice, unit/bridge/browser regression checks, Windows runtime/package validation where relevant, physical acceptance for live providers and upgrade/restore; update PROGRESS.md with commit, evidence, remaining risks. Existing stable release must stay available. No unsupported claim of feature completion.
- First action: A1 inventory of state and ownership, archive schema and secret exclusions; concurrently map B1 extension-update schema read-only. Do not start automatic downloads, sync or updater writes until their recovery/storage prerequisites are validated.
