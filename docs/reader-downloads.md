# Reader chapter downloads

B3.1 adds selected chapter downloads and a Reader Downloads view using the existing pinned reading engine. The queue is separate from Vault's file/audio transfers.

## Select chapters

Open a manga's chapter list, select up to 100 chapters and choose **Download selected**. The request uses saved chapter identities; it does not run another catalogue search or add a whole title implicitly. The engine starts accepted downloads immediately. The title's chapter status is refreshed after the request.

Chapters already marked downloaded are skipped by the selection action. Already queued, unavailable-source and local-source chapters are not eligible for another enqueue; native validation refuses stale or ineligible requests. Invalid, duplicate or oversized selections are refused rather than silently truncated or split into background batches. Downloaded indicators reflect the engine's saved status.

## Manage the queue

Open **Downloads** in Reader to see the manga and chapter, queue state, progress and attempt count. The view reads the engine's current queue; it does not maintain a second persistent download database.

- **Pause** and **Resume** operate on the whole Reader queue.
- Select queue items to cancel them. Cancellation removes their jobs and does not delete completed or partial media files.
- Retry selected failed items without recreating successful downloads. Retry does not reset the engine's attempt counter.
- Refresh explicitly after a failed status request. Stale information is labelled and cannot be used as an actionable current queue.

The view allows at most 100 selected items and accepts at most 1,000 queue entries. A malformed or oversized native response is refused in full. Status polling is sequential and runs only while the queue view is visible and work is active. Opening unrelated media areas does not keep a hidden queue poller running.

**Paused queues resume when the reading engine starts again.** That behavior belongs to the pinned engine. Closing/restarting Reader is not a persistent pause preference. Automatic discovery/download-ahead is not enabled by this feature.

## Uncertain replies

A command can change the engine before its reply times out. The native broker attempts one read of the resulting queue and marks an uncertain acknowledgement explicitly. The web interface displays that state and refreshes status; it does not automatically submit the mutation again. If reconciliation also fails, refresh the queue before taking another action.

The native broker validates exact positive chapter IDs, queue membership and supported states independently of the interface. It uses fixed GraphQL operations, bounded response projections and static errors. Raw provider URLs and failure output are not exposed by the queue response.

## Preserve existing media and reading state

Extension installation, removal and update are refused while a Reader queue is pending, including paused and failed jobs. Source settings already require an idle queue. This prevents a queued download from unexpectedly restarting against changed executable source code.

Cancellation and retry do not clear read flags, bookmarks, categories or saved page position. Downloaded-file cleanup remains the separate reviewed storage action. Cancelled partial media may remain in the managed directory; this increment does not implement automatic partial-file eviction.

The upstream `isDownloaded` flag is not a verified offline guarantee. The current engine can fall back to a provider when a local page is missing. Strict local-only page reads, complete-page integrity checks, CBZ import, storage quotas/retention, download-ahead and opt-in automatic downloads remain later B3 increments.

## Verification

Local validation passed: 12 web parser/controller tests, full TypeScript, scoped lint, four executed exact-production native helper tests, Windows-target core/app test compilation and the focused actual-UI helper. Browser coverage includes chapter limits, completed-item skips, progress, failed-only resume refusal, explicit retry/cancel, visible-only polling, stale/uncertain recovery without replay, media/progress preservation and 440px layout. Screenshots were inspected. The authored Java fixture passed a local socket smoke, but that used API stubs and is not pinned-runtime verification.

The existing full browser gate is wired to the new helper and unit suite. A dedicated packaged-JVM case covers actual selected PNG downloads, global pause/resume, subset cancellation, deterministic HTTP503 failure/retry, stopped-pending extension refusal and automatic queue recovery after restart with saved reading state preserved. Integrated Windows and pinned-runtime execution are pending publication. No new Windows package or physical acceptance is implied by this development work.
