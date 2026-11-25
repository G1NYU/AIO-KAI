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
| 10 | README: update project presentation and representative screenshots from user uploads; replace outdated visuals when final UI is stable | Accurate feature claims, inspect screenshots for private data, no bundled font files or misleading UI, verify image paths render | README updated; consolidated package requested; permanent screenshots pending |

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
