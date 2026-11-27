# Native public SoundCloud (Windows)

This integration reconstructs the missing native SoundCloud work against the
current TSUGI development branch. It uses the existing pinned
[yt-dlp 2026.11.23 SoundCloud extractor](https://github.com/yt-dlp/yt-dlp/blob/2026.11.23/yt_dlp/extractor/soundcloud.py)
and its [native HLS downloader](https://github.com/yt-dlp/yt-dlp/blob/2026.11.23/yt_dlp/downloader/hls.py).
No new executable or dependency is introduced.

## Behavior and boundaries

Open Music sources, choose Connect SoundCloud, then search. Native flat
`scsearch20:` uses at most twenty public entries; the bridge delivers sanitized
track rows incrementally, with explicit completion, cancellation and a
60-second native deadline. The renderer only displays known metadata and
canonical public track identity; stale replies cannot replace current results.
The search worker owns a single subprocess, and requests are bounded.
Remembering connections is opt-in; the fixed provider is reconstructed rather
than accepting a saved arbitrary endpoint.

Playback uses a canonical `https://api.soundcloud.com/tracks/<decimal-id>`
target. The native worker prefers complete public AAC/M4A, then complete Opus or MP3, preferring HTTP before native HLS within each format. It excludes preview, premium and download formats, refuses missing fragments, bounds the progressive audio spool to 64 MiB, and uses the existing independent mpv engine for decode, seek, volume and playback state. Native HLS writes intermediate fragments even for
stdout media, so the tool uses an owner-only temporary directory and contained
process. Browser session credentials are not passed to SoundCloud. No preview,
DRM bypass, private-token URL, premium login, SoundCloud download/export,
collections or account features are claimed. YouTube-only export and prefetch
remain isolated; public SoundCloud playback does not require an Eclipse addon.

## Acceptance

The original generated fragmented-MP4 AAC fixture decodes with local FFmpeg.
Tests cover native bounded search parsing, canonical targets, command options,
exact fragmented media bytes, web metadata and portable identity, and real
Music components with a simulated native bridge. Full Windows Rust and browser
CI, real libmpv decoding of live public SoundCloud formats, and provider
latency/availability on the affected desktop remain separate gates. A
successful synthetic browser fixture does not prove live streaming. No
comparison with the interrupted worktree's recorded timing is claimed.

## Published verification checkpoints

The corrected native SoundCloud integrated browser fixture passed in [Unified run 45897205036](https://github.com/G1NYU/TSUGI/actions/runs/45897205036): native source, incremental results, cancellation, stale reply refusal, public target and export isolation. Web typecheck, lint, regression tests (36 test files) and combined browser smoke passed. Actual live SoundCloud playback and speed remain unverified. [Vault run 45896416797](https://github.com/G1NYU/TSUGI/actions/runs/45896416797) and [Reader run 45896416839](https://github.com/G1NYU/TSUGI/actions/runs/45896416839) passed.
