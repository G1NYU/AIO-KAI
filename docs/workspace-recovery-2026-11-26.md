# Workspace interruption and exact recovery state

Recorded on 26 November 2026. Repository: G1NYU/TSUGI. Development branch: feature/tsugi-read-runtime.

## Publication status verified after the interruption

The execution environment became unavailable during preparation of the next repair batch. Command execution returns "No usable execution environment is available". The previous GitHub tree-creation cell belongs to a stale execution generation, and its in-memory publication state is no longer available.

GitHub independently confirmed that the branch still points to ae07661555ba7377ca516a53370949c30d8d149f, tree 43275ed24c64f8ea81a1ea6a15e1df8a1a8bca6b. The intended new source tree 9fa538c204e38a9042da78e4b56e75dfdf9cf0c2 and the local review commit 638c8aa82066e6878cf42730ad131507b288c7a8 both return Not Found from the GitHub Git Data API. No branch update was issued for that batch.

This documentation checkpoint changes no application source, dependencies, configuration or workflows. It does not produce a new build. The last verified portable candidate remains 60fc65f810f311eddab5cd8493ef26bf15698109; stable v0.1.0 is unchanged. The outstanding work below is not available in that candidate.

## Main repair batch, locally verified before interruption

Recovery location: /workspace/scratch/1c8e6dd30104/tsugi, branch work/tsugi-roadmap-continuation. Local commit 638c8aa82066e6878cf42730ad131507b288c7a8, intended tree 9fa538c204e38a9042da78e4b56e75dfdf9cf0c2, parent ae07661555ba7377ca516a53370949c30d8d149f. The recorded diff contains 46 files.

Implemented changes:

- Waiting and History vector icons, matching Reader setup/hero widths, Reader heading spacing, stable Movies Settings selection, and removal of broad grey Settings description/tab fills while preserving control states.
- A real Batch Add file picker for CSV, converted Mihon JSON and text. Bounded UTF-8 parsing preserves the previous input on invalid, cancelled or stale selection. Searching, review and addition remain explicit.
- Four identified broken or iOS-only Eclipse recommendations are hidden from the public recommendations. Installed, manually configured and private addons remain intact.
- Direct Windows SoundCloud public-track search and native playback, bounded incremental search results, cancellation, public identity persistence, and private transfer-directory ownership.
- Progressive fragmented MP4/AAC decoding before transfer completion, with forward/backward seeking and clean end-of-file handling.
- A focused Windows feedback record and updated roadmap references, including Harbor's later stream-selector reference.

Verification completed on the final local source before interruption:

| Check | Recorded result |
| --- | --- |
| Web unit tests | 441 passed across 39 files |
| Whole-web TypeScript and ESLint | Passed |
| Linux native core | 70 passed; 3 intentionally ignored |
| Original media fixtures through real local libmpv | WebM/Opus, M4A/AAC, ADTS/AAC and fragmented MP4 playback, seek and EOF checks passed |
| Pinned ebook preparation, localization extraction and standalone production build | Passed |
| Integrated browser checks | 61 passed |
| Independent source review and resulting screenshots | Reviewed |

The evidence files were recorded under /workspace/scratch/1c8e6dd30104/qa. They cannot currently be reread because execution access is unavailable. These are completed local results, not Windows CI results for a published revision.

Provider speed is still open. Actual cold SoundCloud observations included approximately 19.6 seconds to the first incremental search result and 34.9 seconds to the first 128 KiB in one transfer probe. Fixture decoder timings do not establish live-provider startup performance. YouTube access reliability and startup/download latency are not marked fixed.

## Completed isolated changes awaiting integration

All three worktrees are based on earlier local review commit 8e5970b7a036895a11acad53dcf3196131ab3dcc. They were intentionally left uncommitted for root integration. That base was later amended into the main repair commit above; do not attempt a blind merge based solely on commit IDs.

### Unread Chapter updates indicator

Worktree: /workspace/scratch/1c8e6dd30104/worktrees/reader-workflow; branch work/reader-workflow.

Six files comprise the Read page/CSS, reader-unread-state.ts, reader-unread.test.ts, reader-unread-browser.mjs and docs/reader-unread-indicator.md. The indicator uses the authoritative full unread count, retains it on error, guards stale replies and reconciles confirmed reading/library mutations. Visiting the view does not clear it. Hidden Read sections and open chapters stop background scheduling; polling follows only a known explicitly started updater.

Recorded checks: 24 focused tests across two files, full web typecheck, scoped lint, controlled real-browser transitions and 1440/390px captures passed. Independent review found no concrete P1/P2 issues.

Integration: add the new unit file to the explicit gate and call verifyReaderUnreadBrowser from the combined browser harness; then rerun combined validation.

### Reactive seek bar and custom mascot

Worktree: /workspace/scratch/1c8e6dd30104/worktrees/music-reactivity; branch work/music-reactivity.

The seek ribbon and original optional listening spirit share measured native RMS or the existing Web Audio analyser at up to 24 fps. Custom PNG/WebP/GIF import stores the image and a still poster in a dedicated bounded IndexedDB record. Seek motion defaults on; the mascot defaults off. Paused, loading, hidden/inactive, reduced-motion, stale-meter and direct-only playback states remain still. Existing audio routing and imported Studio layouts are preserved. Opaque non-CORS Eclipse streams remain audible but cannot safely provide Web Audio analysis.

Recorded checks: 17 focused tests across two files, full web typecheck, scoped lint and both real-browser checkpoints passed. Browser coverage includes actual amplitude-changing PCM, native meter ownership, image import/reload, still GIF posters, storage/decode failures, delayed import cancellation and responsive layouts. Independent source review found no concrete P1/P2 issues.

Integration: add music-reactivity.test.ts and verifyMusicReactivityBrowser to the explicit gates. In the older music-audio-browser.mjs fixture, seed tsugi-player-visuals-v1 with seekMotion false and mascot off so its intentional first-graph-on-expand case remains meaningful. Extract localization strings and rerun the combined production gate.

### Selective WebView2 cache-preservation fixture

Worktree: /workspace/scratch/1c8e6dd30104/worktrees/webview-cache; branch work/webview-cache.

The gated desktop example and PowerShell runner exercise an owned disposable profile, real DISK_CACHE completion, normal browser process exit/restart, preserved ebook bytes/cover/progress and six other protected checks, and a distinct interrupted/unknown outcome. No production cleanup control or profile deletion was added.

Recorded checks: Windows GNU cross-compilation, formatting, JavaScript syntax, independent review, and the exact Rust HTTP server plus original page logic in persistent Chromium passed. Actual WebView2 execution remains unverified.

Integration: add the explicit Windows step:
pwsh -File packages/desktop/scripts/verify-webview-cache.ps1

Require the cold/warm/clear-restart request counts 1/1/2, preserved data and the separate interrupted-close exit 2 outcome. A user-facing cleanup action remains blocked on exact scope/accounting: category completion alone does not identify reviewed files or reclaimed bytes.

## Partial updater work: not a completed feature

Worktree: /workspace/scratch/1c8e6dd30104/worktrees/portable-updates; branch work/portable-updates.

Only a first portable_update/package.rs archive-validation module and explicit ZIP dependencies were drafted. The module was not registered, compiled, tested or reviewed. No updater UI, apply helper, recovery journal or rollback was implemented. It must not be published as a completed updater.

Known corrections before further implementation: bound hash and BUILD-INFO reads, validate identities and the complete required inventory, reject reparse ancestors before opening staged files, establish private staging ownership, and test hostile archives, cancellation, tampering and recovery. Subsequent apply logic needs closed-process coordination, a consistent private data snapshot, durable rollback, health acknowledgment and real Windows interruption tests.

## Recovery sequence

1. Restore execution access to the original environment and check the repository and all four worktrees. Their survival is not assumed.
2. Verify the main local commit/tree and actual working diffs against the recorded identities. Preserve any recovered source before modifying it.
3. Preserve this newer documentation checkpoint. Do not force-push an older local branch over it. Integrate reviewed source against the current remote head, resolving only the documentation overlap, and repeat relevant gates for the resulting tree.
4. Publish the complete reviewed repair batch through an expected-head, non-forced branch update. Verify the exact resulting tree, inspect actual Windows logs, produce the portable package and verify its downloaded identity/integrity.
5. Review and integrate the three isolated completed changes, including their explicit combined gates, then continue the remaining roadmap.
6. If the original source cannot be recovered, reconstruct and validate changes from repository evidence in a usable environment. Do not recreate large files from conversation summaries or present a partial upload as the tested tree.

The user authorized continued roadmap implementation and task-related pushes. No additional routine permission is pending. The active blocker is unavailable execution and source access, not approval.

## Remaining roadmap

No top-level Cycle II milestone is closed by this interruption checkpoint. Remaining work includes strict offline manga reads/storage policies, per-title reading preferences and other B4 controls, tracker synchronization, cross-media continuation, remaining import/support functions, safe portable update application, the curated YouTube story catalogue, TorBox music discovery, anime introduction, independent Stremio addons, and Refract/MDBList. Physical/account-dependent acceptance remains separate. See ROADMAP.md for the established scope and prerequisites.
