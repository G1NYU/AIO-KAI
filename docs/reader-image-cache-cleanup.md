# Reviewed temporary Reader image cleanup

This A1 storage feature reviews and removes temporary manga page images and thumbnails created by TSUGI's managed reading engine. Downloaded chapters, permanent library covers, local media, database records and browser session storage are outside its deletion scope.

## Using it

Open **App settings → Data & storage → Storage management → Temporary Reader images**. Reader must be set up on Windows. Close any book or manga chapter, including a chapter retained while switching media spaces. Finish Reader downloads and library updates, and disable automatic downloads and scheduled library updates before reviewing the cache.

1. Choose **Review temporary Reader images**. The review shows separate counts and logical byte totals for temporary chapter images and thumbnails. An empty review offers cancellation without a removal action.
2. Choose **Remove reviewed temporary images**. A Windows confirmation identifies the exact reviewed scope and explains that Reader briefly restarts. Cancelling either review stage removes no images.
3. Read the result. Only files confirmed absent contribute to removed counts and bytes. A partial, unknown or failed-restart result is shown explicitly; it never triggers an automatic replay. Review the current cache again before another attempt.

Images can require an internet connection when next opened. This is intentional removal of disposable images; no media backup is created, and a portable metadata backup cannot restore removed image bytes. Downloaded chapters remain available through their existing provider.

## Ownership boundary

The pinned [Suwayomi v2.4.2373 directory contract](https://github.com/Suwayomi/Suwayomi-Server/blob/v2.4.2373/server/src/main/kotlin/suwayomi/tachidesk/server/ServerSetup.kt) puts the disposable image roots beneath `java.io.tmpdir/Tachidesk`. TSUGI supplies its private `reading/runtime-temp` directory as the JVM temp location.

| Data relative to TSUGI app data | Cleanup behavior |
| --- | --- |
| `reading/runtime-temp/Tachidesk/manga-cache` | Only reviewed regular files are eligible |
| `reading/runtime-temp/Tachidesk/thumbnails` | Only reviewed regular files are eligible |
| `reading/downloads`, including manga chapters and permanent library covers | Preserved |
| `reading/cache/kcef` and other browser/session data | Preserved |
| Reader database, extensions, source settings and recovery checkpoints | Preserved |
| Other contents of `reading/runtime-temp` | Preserved |
| Legacy shared system temp, external folders, Vault media and books | Never traversed by this operation |

The existing detailed storage scan's Reader browser-data row measures `reading/cache`, which can contain source sessions. It is not a reclaimable image estimate. Temporary image bytes remain part of the Reader runtime total; this separate review measures the two exact disposable roots without double-counting them in the storage inventory.

The upstream [image mutation](https://github.com/Suwayomi/Suwayomi-Server/blob/v2.4.2373/server/src/main/kotlin/suwayomi/tachidesk/graphql/mutations/ImageMutation.kt) distinguishes cached pages, cached thumbnails and downloaded thumbnails. Its recursive deletion does not provide TSUGI's reviewed-file boundary, so TSUGI does not invoke that broad mutation. The native implementation removes only individually verified files while its managed JVM is stopped. Empty directories are left in place.

## Review and apply guarantees

- The serialized native Reader worker owns a random, one-use review capability bound to the runtime process, port and data root. The renderer sends only that review ID. No private path, source URL or file hash is exposed.
- Reviews expire after ten minutes. The scan permits at most 20,000 entries, sixteen nested levels within an image root, 512 MiB per file, 2 GiB overall and sixty seconds of inventory work. A limit, inaccessible file, redirected path or unverified ACL refuses the review instead of presenting an incomplete deletion target.
- Active or hidden reader sessions, pending chapter release, downloads, library jobs, automatic schedules and unfinished restore records block the operation. Web operations use the existing shared restore/cleanup lock. Native confirmation rechecks the active chapter and current operation state.
- After confirmation, Reader stops while its private storage lock remains held. Every reviewed ancestor is pinned against replacement. Every file is opened without write/delete sharing, its content and timestamps are checked against the review, and the complete bounded inventory must still match before the first deletion.
- Windows removes each exact verified file handle, then TSUGI checks that its path is absent. Deletion stops on the first unconfirmed removal. Only confirmed logical file bytes are reported; filesystem allocation and free-disk changes can differ.
- After the shutdown attempt, TSUGI attempts to restart Reader even if verification or removal cannot proceed. Refusals before shutdown leave the running Reader alone. Successful deletion with a failed restart reports both facts. A lost or malformed response is an unknown outcome, not proof that nothing changed. Neither the web client nor native worker replays the consumed review.

The operation is not an atomic rollback. A crash or a failure after a confirmed deletion can leave part of the reviewed cache removed. Those files are disposable, but reloading still depends on the source being available. Source sessions are preserved by exclusion of their storage; this does not guarantee that an external provider will accept an existing login indefinitely.

## Verification entry points

- `packages/desktop/core/src/read_image_cache.rs`: bounded inventory, private storage checks, fingerprints, pinned handles, individual removal and result accounting; focused filesystem/response tests.
- `packages/desktop/core/src/read_image_cache_cleanup_tests.rs`: actual pinned Windows JVM using an original comic and cover served by an isolated loopback fixture. It covers changed-cache and locked-file refusals, real removal, downloaded-page and permanent-cover retention, metadata preservation, cache regeneration and restart. Session-storage preservation uses explicit synthetic sentinels, not a live account.
- `packages/desktop/scripts/read-runtime/fixture/CacheFixtureSource.java`: the original thumbnail extension, compiled against the pinned runtime in Reader CI. Existing extension and download fixture artifacts remain separate.
- `packages/desktop/app/src/reading.rs` and `core/src/bridge.rs`: review lifetime, exact cancellation, chapter-session exclusion and Windows confirmation.
- `packages/web/src/lib/backup/reader-cache-cleanup.ts` and `components/shell/reader-cache-cleanup-settings.tsx`: strict count/result validation, restore coordination, review/cancel/apply feedback and storage invalidation.
- `packages/web/tests/reader-cache-cleanup.test.ts` and `reader-cache-cleanup-browser.mjs`: response/accounting boundaries and controlled settings interactions, integrated with the full Reader browser harness.

Current verification and publication evidence belongs in [HANDOFF.md](../HANDOFF.md). These authored checks do not replace physical Windows/WebView confirmation with the user's installation, and this feature alone does not close A1's wider recovery and storage acceptance.
