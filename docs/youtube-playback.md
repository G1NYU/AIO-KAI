# YouTube playback and session recovery

## Windows recovery

YouTube access starts anonymously each time Tsugi launches. If a track asks for
sign-in or verification:

1. Open **Music → Music sources → YouTube session**.
2. Open the same track in a regular Firefox window. Complete YouTube's sign-in or
   verification there and confirm that Firefox can play it.
3. Choose **Use Firefox for this session** in Tsugi, then retry the track or Vault
   export. Tsugi uses the most recently used Firefox profile's normal session.
4. Choose **Stop using Firefox session** to return to anonymous access. Closing
   Tsugi also resets the choice.

Private windows and Firefox containers are excluded. Chromium-based browsers are
not offered because their Windows cookie encryption and locked database handling
introduce different failure modes. The selected mode confirms a local choice;
it does not assert that YouTube accepted the account. YouTube can still refuse
playback because of network, account, age, region or video restrictions. Never
send cookies, a browser database, or sign-in details in a bug report.

The session applies to both native YouTube playback and Vault audio exports.
Changing it invalidates pending transfers and clears native playback/replay and
prefetch state. Existing completed files remain ordinary user-owned exports.

## What changed in the transport

Tsugi previously waited for the complete yt-dlp audio download before opening
mpv. It now hands mpv a bounded, seekable spool after the first validated
64 KiB are available. yt-dlp continues supplying the remainder through the same
stdout transfer while mpv decodes it; the container and incoming bytes determine
when audio actually starts. This preserves the transport that had
already worked on the user's Windows connection; signed CDN URLs are not handed
to a different HTTP client.

WebM can start without a total length. MP4/M4A demuxing also needs to inspect the
end of an atom, so Tsugi consumes yt-dlp's exact `progress.total_bytes` from a
dedicated numeric stderr progress line. An early seek to that exact end returns
EOF immediately; a seek to an unavailable position inside the file waits for the
producer. Estimates are not used. Conflicting, oversized and truncated totals
fail the transfer. This length is also available to Vault's one-pass file export
for real byte/percentage progress without another extraction.

The spool remains limited to 64 MiB. A pending read fails after eight seconds
without new audio bytes; a forward seek keeps waiting while bytes arrive.
Length metadata and empty notifications do not extend that stall timeout.
The full transfer has a two-minute limit. Stop, track replacement, session
changes and decoder failures cancel the matching transfer and wake waiting
reads. Windows contains yt-dlp and its JavaScript children in a kill-on-close
job. Cancellable pipe reads avoid waiting indefinitely for an inherited pipe.
File exports write directly to the exclusive staging file and finish only after
the file writer has flushed/synced/closed, both output readers have completed,
the child has exited successfully, and the exact byte total matches when known.
The caller then validates and publishes the file.

mpv reaching its current stream end is not sufficient for success: a native
session reports completion only after the producer succeeds. Transfer failures
therefore cannot turn truncated audio into a successful end-of-track event.
Prefetch now waits until the final twenty seconds of the current track, leaving
startup bandwidth for the track the user selected.

## Session data handling

Only `status`, `anonymous`, or `firefox` crosses the web-to-native session API.
Only the resulting mode is returned. Cookie values and profile paths are not
stored in React state, local storage, app settings or portable backups. Session
selection is process-local and is not restored on launch.

The bundled yt-dlp uses its supported `--cookies-from-browser firefox::none`
loader. Firefox's database is read locally; yt-dlp copies the database into
temporary storage while reading it. For opted-in transfers, Tsugi creates a
random private Windows temporary directory restricted to the current user and
directs the tool's temporary files there. Normal completion and
cancellation attempt to remove it after terminating the child processes.
Abrupt system/process termination, locked files or disk faults can leave private
temporary files until normal OS/user cleanup. The source Firefox profile is not
modified. No persistent exported cookie file is created by Tsugi.

Provider diagnostics remain bounded. Only the dedicated numeric byte-total
field and static error categories are consumed; raw diagnostics are never surfaced.
No provider stderr, signed media URL, cookie value or browser path is displayed
or logged by these changes.

## Verification and limits

The checked-in audio fixtures are original generated tones. The native decoder
test supplies only the first 64 KiB to real mpv, withholds the remaining bytes and
EOF, and requires decoded playback. It then seeks forward while a producer
supplies only part of the remaining file and still withholds EOF. Both WebM with
unknown initial length and M4A with exact initial length are covered. Linux mpv
0.40.0 decoded the first audio approximately 66–118 ms after the initial buffer
was supplied; these are controlled fixture timings, not YouTube startup or
Windows speaker measurements. Windows CI runs the same test with the repository's
pinned mpv DLL. The Unix variant is opt-in:

```sh
TSUGI_MPV_TEST_LIBRARY=/path/to/libmpv.so.2 \
  cargo test --locked -p aiostreams-desktop-core --lib local_progressive_audio -- --ignored --nocapture
```

Resolver tests exercise explicit session choices, argument isolation, stream
bounds, exact-size/EOF handling, late transfer failure, waiting-reader
cancellation, a file growing before producer EOF, and file-handle release on
completion and cancellation. `youtube-session.test.ts` covers the web/native
contract and prefetch timing. `youtube-session-browser.mjs` exercises the actual
Music settings UI with a synthetic native bridge, including explicit opt-in,
revoke, error/recheck, no storage of private reply fields, and narrow layout.

A public-video metadata probe using the pinned yt-dlp 2026.11.23 succeeded from
the Linux test environment. A subsequent audio transfer reported an access
restriction with zero media bytes. The sanitized probe grouped HTTP 403 and bot
verification together, so it does not distinguish those two cases. This is not evidence of repaired
live playback. Windows playback, real Firefox verification recovery, actual
download speed and physical audio output still require testing on the user's
connection. Bundled yt-dlp and Deno pins are unchanged; both were already current
when investigated.

The same pinned yt-dlp emitted an exact total of 245,402 bytes for the original
local M4A fixture using the production progress-template options, and its stdout
matched the fixture byte for byte. That verifies the progress contract and media
output separation independently of provider access.

## Upstream references

- [yt-dlp YouTube extractor guidance](https://github.com/yt-dlp/yt-dlp/wiki/Extractors#youtube)
- [yt-dlp cookies FAQ](https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp)
- [yt-dlp browser cookies and progress options](https://github.com/yt-dlp/yt-dlp/tree/2026.11.23#usage-and-options)
- [yt-dlp JavaScript runtime guidance](https://github.com/yt-dlp/yt-dlp/wiki/EJS)
- [Pinned Firefox cookie loader](https://github.com/yt-dlp/yt-dlp/blob/2026.11.23/yt_dlp/cookies.py)
