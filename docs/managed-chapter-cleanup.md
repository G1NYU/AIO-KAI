# Reviewed chapter download cleanup

This A1 storage feature removes selected, completed chapter downloads through the managed Reader runtime. It preserves library membership, chapter records, read progress, bookmarks and category assignments. It does not implement automatic eviction or a general file cleaner.

## Using the review

Open **Settings → Data & storage → Storage management → Downloaded chapter cleanup**. Close any open book or manga chapter first, including a chapter left open while switching to Music. Finish or clear the download queue and wait for any library update to stop. Automatic chapter downloads and scheduled library updates must be disabled while cleanup runs.

1. Choose **Find eligible chapter downloads**. The list includes read, unbookmarked chapters belonging to library titles with an installed source. Only complete downloads in TSUGI's default private Reader folder are eligible.
2. Select up to 50 chapters from the current page, then choose **Review selected downloads**. The review shows each title, chapter, source, format, file count and logical byte total. Changing pages clears the selection. A review can contain at most 2 GiB and expires after ten minutes.
3. Choose **Remove reviewed chapter downloads**. TSUGI first saves and reopens a complete portable metadata backup, verifies its contents and confirms that it covers every selected chapter. A Windows confirmation dialog then asks whether to remove the reviewed downloads.
4. Read the individual results. The batch stops at its first failure. Only chapters whose files are confirmed absent and whose protected reading metadata is confirmed unchanged contribute to the removed count and byte total. Refresh storage to measure the current state before another cleanup.

Cancelling the web review does not save a backup or remove media. Cancelling the Windows dialog keeps the already verified metadata backup and removes no media. The backup's generated filename remains visible in the cleanup result and in managed backups.

**The metadata backup does not contain downloaded pages.** Intentional media removal cannot be undone from that backup. Downloading the chapters again depends on the source remaining available. A failed or interrupted operation can have partial effects; keep the backup and review current storage and library state before retrying.

## Supported scope and limits

| Item | Behavior |
| --- | --- |
| Managed chapter folders and CBZ files | Supported when their contents, identity and ownership can be verified against the pinned runtime |
| Unread or bookmarked chapters | Kept |
| Titles outside the library | Kept; still included in ownership collision checks |
| Local-source books, external download folders and Vault files | Excluded |
| Incomplete, redirected, inaccessible or ambiguous files | Cleanup refuses the inventory or review; no guessed ownership |
| Open Reader sessions | Block removal; Music keeps a hidden chapter session active |
| Active downloads or library updates | Block cleanup |
| Unfinished or damaged portable restore record | Block cleanup until the record is resolved |
| Page size | 100 candidates; at most 50 selected from one page |
| Complete ownership inventory | At most 1,000 sources, 5,000 titles, 10,000 chapters and 16 MiB of metadata; exceeding a bound refuses cleanup |
| Chapter size | At most 2,000 pages and 512 MiB per download; at most 2 GiB per review |
| Freed space | Confirmed logical file bytes, not filesystem allocation or a promise of identical free-disk growth |

Unavailable sources and colliding source/title/chapter names can prevent a complete ownership inventory even when the affected title was not selected. TSUGI does not silently treat an incomplete scan as permission to delete another title's files. The existing portable backup limits also apply to the safety copy.

## Native contract and verification

The adapter targets [Suwayomi Server v2.4.2373](https://github.com/Suwayomi/Suwayomi-Server/tree/v2.4.2373). It uses the supported `deleteDownloadedChapters` mutation for one reviewed chapter at a time. The upstream implementation can clear `isDownloaded` even when its file provider fails to delete a Windows-locked file. TSUGI therefore verifies the files independently and never uses that flag alone as evidence of removal. A failed folder deletion can leave partially removed media and a cleared download flag. The batch stops and reports zero confirmed reclaimed bytes for that chapter; it does not promise atomic media rollback or automatic repair of the indicator.

The renderer sends chapter IDs and an opaque review ID, never file paths. The native worker holds the one-use review, binds it to the current runtime process, port and data directory, requires a closed chapter session and owns the Windows confirmation. Chapter releases carry an exact per-open session identifier, so a delayed close from an older Reader cannot close a newer session. A failed close keeps the Reader visible for retry; an unmount release is retried before cleanup inventory, review or apply.

The native adapter checks the complete source, title and chapter namespace, including non-library titles. It reproduces the pinned filename normalization, uses Windows ordinal case-insensitive comparisons, rejects folder/CBZ ownership collisions and short-name aliases, verifies private ACLs and refuses reparse points. Completed folders must contain exactly the expected numbered page files and `ComicInfo.xml`; CBZ directories must describe the same bounded flat contents. Selected file hashes and metadata are rechecked before removal. Each mutation is followed by a fresh protected-state comparison and an independent check that both possible media paths are absent.

The web operation shares the portable restore Web Lock and requires an empty restore journal. It captures all four sanitized archive sections, writes a manual managed copy and verifies its canonical SHA-256 after reopening. Selected manga and chapter identities must be covered by that copy. No restore journal is created for intentional media deletion. A dispatched operation with an unknown result discards its review and invalidates displayed storage totals.

Implementation and regression entry points:

- `packages/desktop/core/src/read_download_cleanup.rs`: native review, namespace and filesystem checks, deletion and result verification.
- `packages/desktop/core/src/read_download_cleanup_tests.rs`: original real-download fixtures for folders, CBZ, restart, protected metadata, stale files/state, external roots, busy queues, junctions and Windows locks.
- `packages/desktop/scripts/read-runtime/fixture/DownloadFixtureSource.java`: isolated fixture source serving only original PNG pages from its JVM's loopback listener.
- `packages/desktop/app/src/reading.rs` and the typed bridge: native review lifetime, confirmation and exact Reader-session release.
- `packages/web/src/lib/backup/download-cleanup.ts` and `components/shell/download-cleanup-settings.tsx`: strict response validation, metadata safety copy and tonal selection/review/results UI.
- `packages/web/tests/download-cleanup.test.ts`, `download-cleanup-browser.mjs` and `reader-browser-smoke.mjs`: backup/lock/result guards and actual web interaction with a synthetic native bridge.

The fixture JAR is separate from the existing extension update fixtures. CI compiles it against the actual pinned runtime and downloads original images through the real download queue before deletion tests. Local helper and browser tests do not substitute for that Windows runtime gate. Physical WebView/native-dialog acceptance is also separate; this feature does not close all A1 acceptance criteria.

At code checkpoint `8d613655063d8c73dd724ba72fcf13a1381e9555`, [Unified Windows](https://github.com/G1NYU/TSUGI/actions/runs/45782377949) and [Reader runtime smoke](https://github.com/G1NYU/TSUGI/actions/runs/45782378001) passed. All six packaged-runtime cases passed, including successful cleanup after actually reading a CBZ and the distinct locked-page failure case. The full browser harness passed the verified-copy, open-reader, cancellation, stale-review and late-session-release checks. This is automated evidence using original fixtures; physical acceptance with the user's installation remains separate.
