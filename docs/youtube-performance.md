# YouTube playback and download transport

YouTube playback and individual M4A exports share TSUGI's bundled yt-dlp and
JavaScript runtime. The public watch identity stays in TSUGI; signed media URLs
and browser cookies are not saved in the queue or exposed to the web interface.
See `PROGRESS.md` for the published revision and actual validation results.
The [YouTube session guide](youtube-playback.md) covers Firefox recovery,
progressive decoding, temporary data handling and the live-access limitation.

## The delays this change addresses

The previous Windows player collected the entire track in memory before opening
the native decoder. Its first-track startup therefore included the complete
audio download. The new player feeds arriving audio into the existing mpv stream
callback after validating its initial media header. Playback, seeks, failure and
cancellation still use the native player and the bounded transport.

The previous YouTube export first ran metadata extraction, then tried Aria2
through the strict range gateway. A CDN without a strong ETag could not use that
route, so the export launched yt-dlp again and collected a second full transfer
in memory before writing the file. Exports now start one yt-dlp M4A transfer and
write its stdout directly into the job's temporary file. The native worker owns
the output handle, byte limit, cancellation, configured bandwidth limit, format
validation and final publication. A refusal fails that transfer rather than
silently trying another session. Failed or cancelled output is not published.

Downloads through ordinary direct-file URLs continue to use the existing Aria2
backend and its native fallback. This change does not weaken their validator,
resume, destination or completed-file checks. A YouTube export remains a single
M4A audio file; it does not add transcoding, playlist exports or new dependencies.

## Why retain the bundled downloader

The development history includes a physical Windows test in which a direct CDN
URL served its first range but rejected a later range with HTTP 403. The user
subsequently verified yt-dlp stdout playback on multiple tracks. Progressive
buffering removes the full-file wait while retaining that proven transport. A
fresh rewrite of the direct-range resolver would repeat the earlier failed path.

An optional Firefox session uses yt-dlp's supported browser-cookie loader only
after explicit selection inside Music. The option applies to playback and track
exports for the current application session. It does not authorize new access or
guarantee that YouTube accepts a particular account, track or network. Live
verification is separate from controlled transport tests.

## Reference implementation review

The following projects were inspected at the revisions below. These are source
comparisons, not measured claims that one application is faster on every network.
No implementation code was copied into TSUGI.

| Project | Observed implementation | Relevant lesson |
| --- | --- | --- |
| [Rayburst](https://github.com/AnInsomniacy/rayburst/blob/0ae47d1a664e8dc8fd70edec52b59fc7cae43909/docs/DOWNLOADS.md) | Aria2 Next owns transfers, conflicts and recovery; native submission applies site-specific connection limits. Its media probe uses the engine's media API. | Reuse one extraction and transfer lifecycle; an engine name alone does not ensure a fast path. |
| [Pear Desktop](https://github.com/pear-devs/pear-desktop/blob/dbddad1e7fb1c6e307838d3378debbbbab8c504d/src/index.ts) | An Electron browser session hosts YouTube Music. Its [download plugin](https://github.com/pear-devs/pear-desktop/blob/dbddad1e7fb1c6e307838d3378debbbbab8c504d/src/plugins/downloader/main/index.ts) uses the window's session cookies and a separate Innertube client. | Its playback/session architecture differs from TSUGI's native audio transport; downloader performance is a separate comparison. |
| [limusic](https://github.com/SimoHypers/limusic/blob/d9f7dcf89510a2f6cb105bd8d9b2a5eed34eb2af/src-tauri/src/audioproxy.rs) | Streams bounded upstream ranges through a local proxy, retains discovered length/type, and documents the effect of open-ended request pacing in its own measurements. | Request shape, repeated probes and full-buffer waits can dominate latency. |
| [Meiro](https://github.com/elianiva/meiro/blob/47290c83d6bfb21adc53a078f8cb3fce6991c23c/stream.go) | Starts the player on a resolved source; caches asynchronously and preloads the next track near the current track's end. | Caching should improve playback without blocking the first audio. |
| [ytm-rs](https://github.com/grapedjuice/ytm-rs/blob/ab1df3155f664e9cb24641ad964714725a6f60c1/src/stream.rs) | Uses a smaller initial block, seek-aware parallel buffering and limited next-track prefetch. | Make initial audio available before completing a track; bound memory and cancel obsolete work. |

## Acceptance

Controlled tests must prove that audio becomes readable before transfer EOF,
forward seeks wait for bytes safely, a failed or cancelled transfer wakes readers,
and replacing a track cannot retain an obsolete session. Export checks cover one
transfer, streamed file writes, output bounds, bandwidth arguments, cancellation,
existing-file preservation, M4A validation and cleanup.

Windows validation must still exercise the packaged yt-dlp/Deno tools and real
mpv callback. Physical acceptance compares first audio, replay, next-track and
export behavior on the user's actual connection. Record extraction, first-byte,
first-audio and transfer-completion times separately; do not present a successful
metadata lookup or a synthetic fixture as an end-to-end speed measurement.
