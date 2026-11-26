# Reviewed Mihon library reconstruction

The complete importer is available in **App settings → Data & storage → Mihon backup import** after selecting a supported `.tachibk` file. It complements the existing exact-title portable-metadata merge.

## User flow

1. Choose the backup. Bounded local decoding has no native mutations.
2. Optionally enable eligible partial pages and **MyAnimeList and AniList title references**. Tracker references are off by default.
3. Choose **Review complete library import**. The native broker captures current cached state and reports new/merged/skipped titles, new chapters, imported history, tracker conflicts and partial positions left unchanged.
4. Apply the review and confirm the native Windows dialog. The broker saves a private recovery checkpoint, restores only the reviewed metadata through the pinned engine's public API, restarts the engine and verifies the result. Verification failure restores the checkpoint and verifies the previous state. An interrupted operation is recovered on next startup through the existing native recovery journal.
5. Review the result and download the report if needed. Read receives a local refresh notification after confirmed success. Missing extensions must be installed separately from a trusted repository before online reading.

The report contains safe title/source labels, counts, public tracker IDs and exclusion reasons. It contains no raw manga/chapter URLs, original file path, preferences, tracker account IDs or credentials. The source file is never modified.

## What is imported

| Data | Behavior |
| --- | --- |
| Missing remote titles and chapters | Reconstructed from exact signed source ID and exact public raw identifier, without source search or network catalogue requests. No extension is installed. |
| Existing manga metadata | Preserved from the current engine's own serialized export, including fields outside TSUGI's portable metadata format. |
| Completion, bookmarks, pages | Additive; older history cannot mark a more recently visited chapter complete. Partial pages require explicit opt-in, an exact cached chapter and an in-range known page count. Unknown page counts remain unknown. |
| Reading history | Latest exact chapter timestamps are restored to the engine's chapter history. Reading durations are not imported. |
| Categories | Created/reused and assigned through supported category mutations. Existing category metadata/order and unrelated memberships are retained. The upstream restore's destructive category replacement is disabled. |
| Tracker references | Optional, local MAL/AniList public title mappings only. Legacy Mihon `mediaIdInt` takes precedence over `mediaId`; account-local `libraryId` is discarded. Different existing mappings and ambiguous IDs are skipped/reported. Existing tracker records are not sent to the upstream restore, avoiding its account-ID and precision changes. No account authorization or remote progress sync occurs. |
| Missing local-source media | Explicitly skipped: a backup cannot reconstruct absent CBZ/page files. Existing exact local titles can still merge. |
| Existing cached, unfollowed titles | Explicitly skipped to preserve their cached metadata. Add the exact cached title to the library, then review again. |
| Private or unsupported identifiers | Excluded rather than stripped or normalized into a different identity. The exact-title hash-only merge remains available. |

Identifiers accepted for new records are credential-free relative paths or public HTTPS addresses. Userinfo, fragments, control/encoded-control characters, nonpublic hosts, credential-bearing path segments, and unsupported or credential query parameters are rejected independently by the web and native layers. Only bounded public query keys are accepted. Exclusions appear in the report without the raw values.

## Recovery and bounds

The native operation is serialized, requires a closed chapter, an empty stopped download queue, no running library update, and disabled automatic downloads/scheduled updates. Reviews last ten minutes and bind the runtime instance, current export, category snapshot, cached identities and page counts. Applying a review consumes it. Changed state requires another review.

The existing private native checkpoint includes the database, extensions, Android compatibility state, runtime config and source settings. It can contain private local credentials and never enters a portable export. Runtime ownership and private-storage checks remain in force. The importer does not call a provider, install source code, connect an account, or write directly to the database.

Input limits remain 16 MiB compressed and 32 MiB expanded, 1,000 followed titles, 100,000 chapters and 10,000 chapters per title. The combined destination state must also fit the 1,000-title/100,000-chapter/100-category limits. Current engine exports, generated payloads, wire fields, response bodies and native inputs are bounded. The existing 8 MiB portable projection limit still applies during initial decode.

The source format is Mihon v0.21.3. The destination integration is pinned to Suwayomi v2.4.2373, commit `9f8cc818b5df6d0e7e10e0de415903635d2c04de`. The implementation uses the supported `createBackup`, authenticated multipart `restoreBackup`, `restoreStatus`, category, and cached-library APIs. It does not rely on the restore status alone: the pinned upstream can report success after an individual title fails, so TSUGI compares the actual persisted library, chapters, metadata, history, page counts and tracker mappings after restart before committing recovery.

Primary implementation references:

- [Mihon backup models and stream writer, v0.21.3](https://github.com/mihonapp/mihon/tree/v0.21.3/app/src/main/java/eu/kanade/tachiyomi/data/backup)
- [Pinned backup GraphQL mutation](https://github.com/Suwayomi/Suwayomi-Server/blob/v2.4.2373/server/src/main/kotlin/suwayomi/tachidesk/graphql/mutations/BackupMutation.kt)
- [Pinned restore implementation](https://github.com/Suwayomi/Suwayomi-Server/blob/v2.4.2373/server/src/main/kotlin/suwayomi/tachidesk/manga/impl/backup/proto/ProtoBackupImport.kt)
- [Pinned manga/chapter/tracker restore semantics](https://github.com/Suwayomi/Suwayomi-Server/blob/v2.4.2373/server/src/main/kotlin/suwayomi/tachidesk/manga/impl/backup/proto/handlers/BackupMangaHandler.kt)

## Validation entry points

- `packages/web/tests/mihon-backup.test.ts`: decoding, exact identities, public tracker mapping, private-identity exclusion, and the existing exact merge.
- `packages/web/tests/mihon-reconstruction-browser.mjs`: actual UI/file decoding with a controlled native capability, explicit review/apply, opt-in references, cancellation, rollback and uncertain completion.
- `read_runtime::mihon_import::tests`: bounded wire/gzip handling, reconstruction, monotonic merge, private-identity rejection and tracker conflicts.
- `packaged_runtime_mihon_import_reconstructs_and_recovers`: real pinned Windows JVM restore with authored metadata, history/categories/tracker verification, duplicate reimport, stale review rejection and forced post-restore rollback across restart. No live provider or private user backup is used.

See `PROGRESS.md` for the exact published commit and executed CI evidence. Compiling Windows-target tests does not establish that the real Windows JVM test passed. A physical Windows import of a user-approved real backup remains separate acceptance.
