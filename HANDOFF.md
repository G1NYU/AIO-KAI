# TSUGI current development handoff

## 2026-11-26 — Restored measured seek motion and custom mascot; archive API correction

Native SoundCloud and disposable WebView2 preservation remain verified at `18ef6ed` ([combined CI](https://github.com/G1NYU/TSUGI/actions/runs/45897205036)). The read-only A2 verifier landed at `9583d2a`, but the [first native build](https://github.com/G1NYU/TSUGI/actions/runs/45898094868/job/140176884281) rejected the comparison between the pinned ZIP 8.6 `Option<u64>` data offset and a raw offset. This change requires `Some(entry.data)` and retains the strict offset identity check. The next cumulative CI reruns the exact stable ZIP probe and native tests; archive acceptance is not yet verified.

Recovered the interrupted music visual feature in source: a shared 24 fps measured PCM/native-RMS sampler drives the seek ribbon and optional listening spirit without altering seek hitboxes or creating another audio graph. Removes the previous timed, non-reactive dot-flow. Motion is off for paused/loading/error, hidden/inactive, reduced-motion, stale native meter and direct-only playback. Built-in spirit is opt-in; custom PNG/WebP/GIF import is bounded to 4 MiB/1024 px dimensions, decoded, stores original and still poster in one dedicated local IndexedDB record, and is removable. The original animation is displayed only during measured sound. Imported Studio layout remains unchanged. Existing audio tests retain their intentionally opt-in first graph; new unit/browser fixtures exercise PCM and native motion, GIF import/reload/removal, reduced motion, stale samples and Read background playback. New tests and integrated CI are pending; no live provider timing claim. See [music reactivity](docs/music-player-reactivity.md).

Next: inspect actual cumulative CI, then continue A1/A2 recovery, Reader workflow and all B–D milestones. Stable v0.1.0 and last verified portable package remain unchanged. No packaging/release marker is included.

## 2026-11-26 — Portable archive verification and actual WebView2 acceptance

The disposable WebView2 fixture at `18ef6ed` passed the actual Windows runtime in [job 140173949511](https://github.com/G1NYU/TSUGI/actions/runs/45897205036/job/140173949511), including cold/warm/restart HTTP request counts 1/1/2, protected data checks and interrupted/unknown exit 2 followed by a preservation check. The same job passed all 164 native core tests, with 18 intentionally ignored. Production cleanup and physical mixed-media recovery remain open.

The corrected native SoundCloud integrated browser fixture passed in [Unified run 45897205036](https://github.com/G1NYU/TSUGI/actions/runs/45897205036): native source, incremental results, cancellation, stale reply refusal, public target and export isolation. Web typecheck, lint, regression tests (36 test files) and combined browser smoke passed. Actual live SoundCloud playback and speed remain unverified. [Vault run 45896416797](https://github.com/G1NYU/TSUGI/actions/runs/45896416797) and [Reader run 45896416839](https://github.com/G1NYU/TSUGI/actions/runs/45896416839) passed.

A2 adds a read-only portable archive verifier, a diagnostic CLI example, six bounded synthetic archive tests and an opt-in Windows CI probe of the immutable published v0.1.0 ZIP. It checks selected release size/SHA-256/source identity, bounded single-disk ZIP directory and local headers, Windows path aliases, traversal, link/special-file metadata, CRC and decompressed size, required companion files, x64 PE headers and build metadata. Future package metadata declares format 1 and Windows x64. The exact legacy stable tuple is eligible for verification only. No extraction, application staging, execution, update apply, downgrade or rollback is enabled. Windows compilation, tests and the immutable ZIP probe remain pending at this checkpoint. See [portable archive verification](docs/portable-update-verification.md).

Stable v0.1.0 and the previous verified package are unchanged. No package or release marker is included. Live provider/physical acceptance, reactive seek/custom mascot, full A1/A2 and unfinished B–D work remain open. Next: complete archive verification, continue safe staging and recovery/remaining roadmap work.

## 2026-11-26 — Disposable WebView2 cache-preservation gate and SoundCloud test correction

Native SoundCloud source is published at [`8f3c53c`](https://github.com/G1NYU/TSUGI/commit/8f3c53c9d9a993e6c38ed0b6c9b216db80b1bcdb). The [first Unified run 45896416782](https://github.com/G1NYU/TSUGI/actions/runs/45896416782) passed Windows native compilation and **164 core tests** (18 intentionally ignored), web typecheck, lint, ebook preparation and the web regression suite. Browser smoke failed in the new SoundCloud fixture at its submit locator: the nested `has` query incorrectly required the enclosing Music page inside the search form. The focused correction uses the existing accessible search field and Enter, preserving the incremental search, cancellation, stale-response, playback and export-isolation assertions. [Vault run 45896416797](https://github.com/G1NYU/TSUGI/actions/runs/45896416797) passed; Reader runtime validation [45896416839](https://github.com/G1NYU/TSUGI/actions/runs/45896416839) remained in progress at this checkpoint. Full cumulative CI and actual public SoundCloud playback remain pending.

A1 now includes a reconstructed disposable WebView2 example and a Windows-only CI step. The probe verifies the actual COM environment and default profile paths before loading the synthetic page, refuses WebView2 environment overrides and reparse-point fixture paths, and invokes only `ICoreWebView2Profile2::ClearBrowsingData(DISK_CACHE)`. Five bounded child-process phases cover original book/cover bytes, reading progress, preferences, synthetic cookie/source state and CacheStorage, warm/cold/restart HTTP request counts 1/1/2, an active tab check after callback, and a distinct interrupted/unknown exit 2 followed by protected-state verification. It never accepts an application profile path, never clears site data, and adds no production cleanup command. The only recursive deletion is the newly created owned disposable fixture after all checks pass. The staged HTML passed JavaScript syntax and exact blob-hash checks; the local Chromium attempt was blocked by browser administrator policy, not counted as a pass. The native example requires Windows compile and WebView2 runtime validation. See [the fixture guide](docs/webview-cache-preservation.md).

No package or release marker is present; the previous verified portable candidate and stable release are unchanged. A1 remains open until recovery/physical checks and exact production cleanup scope/accounting are addressed. A2 application replacement/recovery, reactive seek/custom mascot and every outstanding B–D milestone remain open. Continue without additional routine push approval.

## 2026-11-26 — Native SoundCloud integration and recovery verification

The A1 scheduled-backup/restore coordination fix [`c72ea12`](https://github.com/G1NYU/TSUGI/commit/c72ea12ec5b41833c5b2caa01828e75e6fae8b5e) passed [Unified Windows CI 45895007463](https://github.com/G1NYU/TSUGI/actions/runs/45895007463): native Windows check/tests, web typecheck/lint, regression suite and integrated browser smoke all passed; packaging and stable release publication were intentionally skipped. A1 remains open for the wider recovery and physical Windows acceptance gates.

The user explicitly confirmed that the endpoint is **all of A1–D5**, not D5 alone, with native SoundCloud and the interrupted repair work also required. No additional approval is pending. The latest native SoundCloud implementation is a fresh, bounded Windows integration rather than a recovered copy of the missing worktree:

- Fixed independent public provider identity, explicit Connect SoundCloud action, opt-in remembered connections, no Eclipse addon or YouTube account required.
- One native search subprocess at a time, at most 20 results, bounded JSON lines and total output, incremental validated metadata, cancellation/replacement and stale-reply refusal. No raw extractor output, signed URLs, private token, or browser cookie reaches the web application.
- Canonical numeric public-track target, existing pinned yt-dlp and independent mpv audio engine, public full AAC formats only (no preview/DRM bypass), native HLS download with private per-transfer fragment directory and bounded progressive spool. YouTube's export/prefetch and session selection remain separate. No SoundCloud export, private tracks, premium access, collection discovery or account integration claimed.
- Public numeric track identities survive local saving and portable metadata backup; private/invalid identities become metadata-only. Old archives remain readable by the new parser; older builds that do not recognize the new public identity reject such backups rather than silently accepting them.
- Added native target/command/parser/fragmented-MP4 stream tests, web provider/backup tests, and real-component synthetic browser search/cancel/playback/export-isolation coverage. The original generated fragmented AAC fixture decoded with local FFmpeg; native Rust compilation, libmpv behavior, full web build/tests and browser tests for this new revision require CI. No live-provider playback or speed claim.

The original workspace and direct Git clone remain unavailable in this session; source inspection and publication use the connected GitHub API. No package/release marker is included. The last verified downloadable candidate remains `60fc65f`; stable `v0.1.0` is unchanged. Next: verify the exact SoundCloud source in CI, repair any actual failures, then continue the WebView2 cache-preservation fixture, remaining A1/A2 recovery work, reactive seek/custom mascot and every outstanding B–D milestone. Live SoundCloud and YouTube access/performance and physical acceptance remain open.

Earlier entries below are historical checkpoints.

## 2026-11-26 continuation — recovery coordination and verified feedback fixes

Resumed on `feature/tsugi-read-runtime` from [`4a983f4`](https://github.com/G1NYU/TSUGI/commit/4a983f44be00c506d12cbaff647946ff97001ab2). The interrupted workspace's original worktrees remain unavailable. The branch has advanced: [`be03edc`](https://github.com/G1NYU/TSUGI/commit/be03edcea91cab218297beff407d517a61eece7f) adds reviewed Batch Add files from disk; [`c1a6530`](https://github.com/G1NYU/TSUGI/commit/c1a65307447d80e91dcbc560925f34487337a921) aligns Reader setup width; [`c35a130`](https://github.com/G1NYU/TSUGI/commit/c35a130cd095cab91296821c2d2a02420f0644a8) stabilizes Movies settings selection; [`304fc5a`](https://github.com/G1NYU/TSUGI/commit/304fc5ad740de1565a1ee0e731e17c50550c8b0e) removes the Movies sidebar and Settings tile backgrounds; [`fe9829b`](https://github.com/G1NYU/TSUGI/commit/fe9829bd501e8fbb3ca8671257c8a4a61d9fc7e3) updates the obsolete regression expectation and checks keyboard focus; and `4a983f4` filters four incompatible Eclipse recommendations without touching manually installed sources. [Combined CI 45893495309](https://github.com/G1NYU/TSUGI/actions/runs/45893495309) passed web typecheck, lint, regression/browser smoke and native Windows checks at that exact base commit. Packaging and live-provider probes were skipped.

**A1 remains active.** A scheduled backup could previously capture partially restored metadata and rotate older verified automatic copies while an unresolved restore checkpoint existed. The new guard shares the existing origin-wide restore Web Lock for capture and native save/retention, refuses open/invalid/unreadable checkpoints, and defers rather than advancing a due schedule when the lock is busy or unavailable. The journal and current policy are rechecked before writing. No new deletion authority, native dependency, release marker or packaging change. The exact revised runner and unchanged scheduling module passed strict isolated TypeScript compilation and five Node harness tests using mocked archive, bridge and lock/storage services. Five new integration-oriented cases in the existing restore-session Vitest suite cover the real shared coordination path; full repository validation is pending CI. Actual WebView2/physical Windows behavior remains an acceptance gate.

Next: verify CI on the new source, then reconstruct the disposable WebView2 cache-preservation fixture or continue another bounded recovery task. A2 archive/application replacement and rollback, native SoundCloud and reactive seek/custom mascot, live YouTube speed, the remaining screenshot acceptance, and subsequent roadmap milestones remain open. The latest verified portable artifact is still the earlier `60fc65f` candidate; stable `v0.1.0` is unchanged. Earlier entries below are historical checkpoints.

## 2026-11-26 continuation: unread Chapter updates indicator

The active original roadmap milestone remains **A1** (backup, recovery and storage). A2's actual updater is unfinished, B1-B5/C1-C3 remain partial or planned, and D1-D5 remain later scope.

After the earlier workspace interruption, the first separately recoverable UI request was implemented on branch `feature/tsugi-read-runtime` in commit `da9da6882eff41d0f0a24b792eeaaa5ce4880fbb`: Read's Chapter updates entry shows a subtle notification dot and accessible unread count when the reader service confirms unread updates. Active Read views refresh on relevant state changes; errors preserve the last known count, and viewing updates does not clear it. The first browser gate caught an accessible-navigation name regression, and the next lint run caught an untranslated description. Both were fixed without weakening the checks. The verified final implementation is [`b9dbe51`](https://github.com/G1NYU/TSUGI/commit/b9dbe51a7a378f33f751a2963f4b2c98f03e0d2f). [Unified Windows CI 45887753235](https://github.com/G1NYU/TSUGI/actions/runs/45887753235) passed on that exact source: 407 web tests in 36 files, web typecheck and lint, integrated browser smoke, and 159 Windows native tests with 18 intentionally ignored. Packaging was intentionally skipped. A real-library unread indicator acceptance check remains.

The earlier 46-file SoundCloud/UI/Batch Add repair batch and the isolated reactive seek/mascot and WebView2 preservation work **remain unpublished** after the execution workspace disappeared. The original worktrees are not mounted in the resumed container; their local test results cannot be transferred into a claim of validated source. Preserve and reconstruct those changes against the current remote head, perform complete checks, and do not overwrite the recovery checkpoint. The last verified portable candidate remains `60fc65f`; stable `v0.1.0` is unchanged.


## Execution interruption — unpublished follow-up

The execution workspace became unavailable while preparing the next repair batch for publication. GitHub was rechecked: application source remains at `ae07661555ba7377ca516a53370949c30d8d149f`; the locally verified 46-file repair batch has **not** reached the branch or a new Windows package. The unread indicator, reactive seek/custom mascot and WebView2 preservation fixture are also awaiting integration. [Exact recovery state](docs/workspace-recovery-2026-11-26.md) records local commit/tree identities, completed verification, isolated worktrees, incomplete updater work and the recovery sequence. Do not interpret the local results as published Windows validation. Execution/source access must be restored before implementation can safely continue.


Updated: 2026-11-26. Repository: [G1NYU/TSUGI](https://github.com/G1NYU/TSUGI). Development branch: `feature/tsugi-read-runtime`. Stable `v0.1.0` is unchanged.

This focused handoff records the current candidate. The existing `PROGRESS.md` remains the published historical record; this update leaves that history unchanged.

## Development while the Windows candidate is under review

The user is testing the verified `60fc65f` candidate below and authorized continuation of the existing roadmap. The final requested feature additions are now recorded as D3 (anime introduction), D4 (direct Stremio addons without requiring AIOStreams) and D5 (Refract/MDBList). They join the previously approved D1/D2 later work; no further speculative feature expansion is planned. The Refract reference is the user's `RE-Harbor` branch `feature/refract-upstream` at `1b72d2887ffa08520ac5b11a78ec5a56beabd890`. [ROADMAP.md](ROADMAP.md) records the inspected implementation and official API references, initial scopes and acceptance boundaries.

The next implemented A1 slice is [reviewed temporary Reader image cleanup](docs/reader-image-cache-cleanup.md), published at [`da3ba9d`](https://github.com/G1NYU/TSUGI/commit/da3ba9d312c2f43163641ff8e575a23dfa1f7611), tree `41cb7310fbbb062e5c78a741f8f0f1d81f9ebed0`. It inventories only the managed JVM's two temporary page/thumbnail roots, keeps the storage lock across shutdown and restart, revalidates the complete review and removes individually pinned files. Saved downloads, permanent covers, reading metadata and browser/session storage are excluded. The Settings review uses plain count rows, explicit cancellation/confirmation, exact accounting and separate partial/unknown/restart-failure feedback. The older session-bearing cache row is now labelled **Reader browser data**.

Local verification: **407 web tests across 36 files**, full web typecheck and ESLint, pinned ebook preparation, localization extraction and standalone production build passed. The new focused browser helper passed cancellation, stale/expired/partial/uncertain outcomes, lock/reader/restore guards, restart failure, singular/plural labels and desktop/390px geometry; both screenshots were visually reviewed. Seven production-module filesystem tests passed on Linux; Windows-target core, core tests and desktop application compilation passed. Independent native and web reviews are clean after stale-cancellation and partial-accounting corrections.

[Unified Windows run 45853314588](https://github.com/G1NYU/TSUGI/actions/runs/45853314588), attempt 1, passed for the exact published `da3ba9d` commit: **159 native core tests passed, 0 failed, 18 intentionally ignored**, plus **407 web tests across 36 files and 58 integrated browser checkpoints**. The eight new Windows filesystem cases passed, including sharing/locked-file, ACL/ownership and junction protection. Web typecheck, lint, pinned ebook preparation, native workspace compilation and synthetic UI preview upload passed. The workflow intentionally skipped production packaging and release publication; the separate local production build passed as recorded above.

The separate [Reader runtime run 45853314740](https://github.com/G1NYU/TSUGI/actions/runs/45853314740), attempt 1, also passed for `da3ba9d`: **68 broker tests passed, 0 failed, one subprocess helper ignored; 42 bounded CBZ cases passed; all 13 actual packaged-JVM cases passed, with none failed or ignored**. The new image-cache case proves changed-cache and locked-file refusal, real cache removal, preserved downloaded pages/permanent covers and reading metadata, restart and subsequent image regeneration. Browser/session preservation uses synthetic sentinels, not a live account. Existing Mihon reconstruction, source-update/settings recovery, download and local-import cases passed again.

This continuation intentionally carries no package or release marker: the downloadable candidate remains `60fc65f`, and stable `v0.1.0` remains unchanged. A1 still needs physical mixed-media round-trip acceptance and the remaining recovery/storage work; live-provider and user-backup acceptance remain open.

Next A1 work: a disposable Windows WebView2 cache-preservation fixture. The existing dependencies expose selective `DISK_CACHE` cleanup, but the supported API reports asynchronous category completion, not exact reviewed files or reclaimed bytes. Validate the actual profile path and preserve ebook Blob/cover/progress, preferences, IndexedDB state and synthetic cookies across cleanup/restart before exposing a control. [Storage ownership notes](docs/portable-data-inventory.md#next-webview-disk-cache-verification) record the inspected API/threading boundary. No generic profile clearing or directory deletion is enabled.

## Source and publication

The candidate is a development portable ZIP. Stable release publication remains outside this candidate; its commit carries only the package marker.

- Full reviewed UI/YouTube/Mihon/Discord implementation: [`75d85da`](https://github.com/G1NYU/TSUGI/commit/75d85da5775784c3a2132edc26e86a4c2d649e9f), exact reviewed tree `42417bb9ab7a15e836008a2f94b33c25a0b84a49`.
- Windows repair: [`a0729e9`](https://github.com/G1NYU/TSUGI/commit/a0729e99bb5d3f263437ea67d57e9cfd8e476908), tree `9c855fba1245888d697b2448423c4850b5936443`.
- Final visual cleanup: [`60fc65f`](https://github.com/G1NYU/TSUGI/commit/60fc65f810f311eddab5cd8493ef26bf15698109), tree `3ade4c729a9d462b915ebf872b0b780a3f51b875`. It removes four broad Junction/Nocturne control-wrapper fills and verifies their transparency. The non-forced publication has the same source tree as local reviewed commit `7ec43e7`; native source and historical `PROGRESS.md` are byte-identical to `a0729e9`.

The Git CLI has no configured write credentials. Publication uses the connected GitHub Git Data API: upload complete intended files, verify the resulting tree against the local reviewed tree, create a commit with the checked remote parent, and update the branch non-forcibly with an expected-head lease. Fetch again and confirm tree equality. API-created and local review commit IDs may differ; their verified source trees must be identical.

## Screenshot and written feedback scope

All sixteen uploaded filenames and the written feedback are mapped in [Windows UI acceptance](docs/windows-ui-review.md). Implemented corrections cover:

- Continuous sidebar tone to the window top, equal header controls, inset media selections and desktop Vault column alignment.
- Unframed artwork shelves and section headings throughout Music, Movies, Read, Books and Settings, including the final alternate-player wrapper cleanup.
- Restored Movies sidebar, All media navigation, aligned hero/catalogue content, bounded Settings and centred server setup.
- Genuine larger variants of the same music artwork with fallback; bounded player composition and measured brush-title clearance, including lyrics mode.
- Music-specific artwork or neutral fallbacks; no anime decoration/provider calls in Music. Read/Books and Vault use a shared shuffled sequence advancing every twelve visible seconds, respecting local-only, reduced-motion and inactive/offscreen behavior.
- Recording-aware lyrics selection using actual decoder duration and album information, unconfirmed video timing, and explicit per-recording line alignment with consistent highlighting/seek offsets.

Controlled browser results are not physical Windows acceptance. Exact-recording acoustic lyric alignment and every live provider image remain separate checks.

## Actual verification completed

| Check | Evidence |
| --- | --- |
| Full web suite, typecheck, lint, pinned ebooks and production build | [Final Unified web job at 60fc65f](https://github.com/G1NYU/TSUGI/actions/runs/45846178709/job/140000327760): **376 tests in 35 files**, **57 browser checkpoints**, all successful, including the new unframed-player assertion. |
| Actual Windows native core | [Final Windows job at 60fc65f](https://github.com/G1NYU/TSUGI/actions/runs/45846178709/job/140002040685): **150 passed, 0 failed, 17 intentionally ignored**. |
| Native media tools and executable | Same Windows job: bundled-media fixture explicitly invoked (**1 passed**), optimized application compilation, staging and upload all passed. |
| Actual pinned Reader runtime | [Reader run 45844069787](https://github.com/G1NYU/TSUGI/actions/runs/45844069787): **60 broker tests passed**, one helper ignored; **42 CBZ checks passed**; **12 packaged JVM cases passed**, none failed or ignored. |
| Vault engine | [Vault run 45844069930](https://github.com/G1NYU/TSUGI/actions/runs/45844069930): all nine scenario/probe checks plus aggregate success, no failed assertions. |
| Final player cleanup | Four focused real-component checkpoints passed: all three layouts, normal/short/narrow geometry, brush/lyrics clearance and actual original PCM waveform/playback/queue/seek/minimise. Junction and Nocturne captures visually inspected. Declared ebook preparation, Lingui extraction and standalone bundling passed through installed Node CLI entry points; the pnpm wrapper refuses the existing symlinked dependency directory. Generated locale changes were restored. |
| Assembled portable application | [Final package job](https://github.com/G1NYU/TSUGI/actions/runs/45846178709/job/140004560732): actual executable probes, first/repeated Reader setup, pinned server authentication and loopback checks, staging and upload all passed. |
| Independently downloaded portable ZIP | **450 entries passed CRC validation**; exact build identity, pinned tools and corresponding source checksums, required notices, five illustrations and five fonts verified. |

The first Windows run exposed two new audio fixture failures. Their repair canonicalizes the pinned DLL path and uses a bounded, byte-preserving native subprocess producer with an explicit readiness handshake and cleanup guards. Tests still require exact file bytes before EOF, cancellation before producer shutdown, size limits and closed file handles. Both failures are cleared on actual Windows. No per-format Windows decode timings were printed on success; do not invent them.

The first Reader run exposed a real integration defect: pinned Suwayomi uses `pageCount=-1` for unknown chapters. The repair accepts only integer `-1..=i32::MAX`, maps the unknown sentinel to portable 0, and preserves the exact signed value inside native review/staleness/post-restore checks. Unknown counts cannot authorize partial-page restoration. The Windows Mihon case now verifies reconstruction, exact source identity, chapters/history/categories/local tracker references, repeat-import idempotence, stale review rejection and forced rollback across restart. The eleven previous runtime cases also pass.

Final web-only changes leave all desktop source identical to a0729e9. Reader and Vault path-filtered workflows therefore do not need another run solely for the CSS/test changes. The final Unified run independently passed its web/native/build/assembled-package gates on 60fc65f, attempt 1, without a retry.

## Verified Windows download

Download [Tsugi-Windows-x64-test](https://github.com/G1NYU/TSUGI/actions/runs/45846178709/artifacts/15131768541), built by [Unified run 45846178709](https://github.com/G1NYU/TSUGI/actions/runs/45846178709), attempt 1. The workflow completed successfully for `60fc65f810f311eddab5cd8493ef26bf15698109`; release publication was skipped. The Actions artifact expires on 3 December 2026.

The actual downloaded artifact archive matches GitHub's SHA-256. Its inner portable ZIP was then checked separately: all 450 entries passed CRC validation, the exact repository/commit/run/attempt/ref in `BUILD-INFO.json` matched, and required paths, tool/source hashes, source notices, all five illustrations and all five fonts passed. No legacy launcher or bundled `read-tools` directory remains.

| Downloaded item | Bytes | SHA-256 |
| --- | ---: | --- |
| GitHub artifact wrapper | 176,792,432 | `d272ffe73048181669eadf96d148fb8c44584f7a45388d4d73fdd540ee7b71e8` |
| Inner `Tsugi-windows-x64-test.zip` | 176,932,132 | `000ee15b535826b1678a3ce59f01eb71ef83f6d96dfc598d12659cd321bbb695` |
| Packaged `current/Tsugi.exe` | — | `883f6feedc17f04392d4f7a8ee563124cffd241f8ca930a8c459688a0aa41596` |

The assembled executable returned 0 for `--check-vault-engine` and `--check-media-tools`. Reader returned the expected 2 before setup, then 0 for preparation, the post-setup check and repeated preparation. The prepared pinned v2.4.2373 server passed authenticated GraphQL, missing/invalid credential rejection and loopback binding checks. The temporary test-installed Reader tools were removed before ZIP creation, retaining normal first-run setup.

Extract the complete inner ZIP into a new writable folder, retain the working installation and open `current/Tsugi.exe`. Keep the `.portable` marker. Choose Read → Set up reading on first use; the pinned runtime is downloaded and verified once.

## Remaining acceptance and next work

**YouTube is not marked fixed.** Controlled decoding proves progressive playback can start before complete transfer; one-pass export removes duplicated extraction/transfer work. Live access, first-audio/download timing, seeking, rapid switching/replay and optional Firefox recovery still need the affected Windows connection. No comparative speed claim against the reference projects is established.

Mihon supports the documented reconstruction fields; it does not import account credentials, source preferences, extension code, absent local media or reading durations. A user-approved physical backup import remains pending. Discord presence is implemented, default off and scoped by media/privacy settings; live acceptance requires a registered public TSUGI Application ID and a running Discord client.

Continue the reliability/recovery roadmap while the user tests the candidate; see [ROADMAP.md](ROADMAP.md). D1 (Books/Manga YouTube AI-story catalogue), D2 (TorBox cached music discovery exposed through an Eclipse JSON source), D3 (anime introduction), D4 (direct Stremio addons) and D5 (Refract/MDBList) remain later work, not implemented features. Their investigation notes, scope and API limitations remain in the roadmap.
