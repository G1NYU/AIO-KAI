# Reader imports and extension update recovery

Development branch: `feature/tsugi-read-runtime`. This document describes the recovery and import implementation added after `5f865e2`. Check `PROGRESS.md` for the published revision and CI evidence. The older `8d6b25b` Windows test ZIP does not contain these features. Packaging and physical acceptance are deferred until the larger roadmap batch is ready.

## Portable metadata restore

Open a Tsugi portable archive in **App settings → Data & storage**, then select **Prepare restore checkpoint**. Preparation saves and reopens two verified manual managed files: the incoming archive and a sanitized snapshot of the current metadata. Neither is subject to automatic-backup retention. No domain changes are applied by opening the file or preparing the checkpoint.

Review and apply each section separately. Beginning another restore action invalidates earlier section reviews. The current domain's conflict checks still apply: newer progress is preserved, exact book/chapter identity is required, and music/category merges remain additive.

A small local restore record stores the copy names, integrity digests and each section's attempt state. Web Locks serialize restore operations across windows. If the app closes after a write begins but before its completion can be recorded, the next settings visit labels that step **Interrupted or unconfirmed**. It never replays the write automatically.

- **Resume saved restore** verifies both copies and reopens the incoming archive. Review the current state before retrying a section.
- **Review recovery copy** prepares a new checkpoint from the earlier portable metadata. This allows explicit reviewed recovery; it does not erase additions made by additive merges or force older reading progress over newer progress.
- **Finish restore record** requires acknowledgement of the current state. It removes only the local journal and retains the managed files and library data.

Standalone section imports cannot write while an unfinished portable restore is open. Missing or damaged copies, invalid journals, unavailable storage and changed reviews block mutations. A checkpoint created without Reader coverage cannot later be used to restore manga data.

This is guarded recovery across separate metadata stores, not one atomic transaction spanning native storage, local storage and IndexedDB. The journal is in the WebView profile; the validated copies are in the native managed backup folder. Disk loss, external file deletion and sudden power failure are outside the process-interruption guarantee. Export another copy to a separate drive for disk-loss protection.

## Mihon `.tachibk` import

Use **Mihon backup import** in Data & storage. The importer decodes gzip-compressed or raw protobuf locally using the maintained Mihon v0.21.3 schema. Compatible older backups with the same field representation are supported; unknown fields are skipped without interpreting their private contents. Schema references and upstream blob identities are recorded in `packages/web/src/lib/backup/mihon.ts`.

The current slice imports only exact matches to titles and chapters already available in Read:

| Data | Behavior |
|---|---|
| Source, manga and chapter identity | Signed 64-bit source IDs remain decimal strings. Native length-prefixed SHA-256 identities bind the exact source and raw manga/chapter identifier. |
| Read flags and bookmarks | Reviewed additive merge with current-state checks. |
| Categories | Match the backup's category order, create/reuse unambiguous names, preserve unrelated memberships and empty shelves. |
| Partial pages | Off by default. Opt-in permits a forward position only for an exact cached local chapter with a known page count, an in-range position and no newer local progress. |
| History | Timestamps help compare progress. The history timeline and reading durations are not imported. |
| Missing titles/chapters | Remain unresolved and appear in a downloadable report. No automatic source install or title search. |
| Trackers and source preferences | Tracker payloads, account connections, preferences, possible credentials and repository addresses are discarded. |

Mihon backups do not supply page counts. The import does not invent them or fetch chapter pages to create a match. The final native apply checks the reviewed chapter state again.

After decoding and choosing partial-page behavior, **Prepare Mihon import checkpoint** saves both incoming converted metadata and current metadata using the shared restore mechanism. Review and apply progress and categories separately. Finish the record before starting another import. Reimporting already merged state is idempotent.

### Import limits

- 16 MiB input, 32 MiB expanded protobuf.
- 1,000 manga, 100,000 chapters overall and 10,000 chapters per title.
- 100 categories, 1,000 source labels and 100,000 history records.
- Additional per-message, string, wire-field and message-count bounds.
- The converted manga section must also fit the existing 8 MiB portable review limit.

Malformed wire data, duplicate identities, invalid UTF-8, invalid numeric values and excessive expansion reject the entire parse before mutation. Ambiguous category assignments are skipped and counted instead of guessed.

Automated fixtures are synthetic, authored against maintained schema definitions, and include real gzip/protobuf bytes. They are not represented as exports from a physical Android installation. A sanitized exporter-produced backup and a user-approved physical import remain acceptance gates.

## Extension updates

Browse → Extensions supports an individual update or a selected batch. Selection is scoped to the visible page. Each extension receives its own native review; batches run serially and stop at the first failed, cancelled or rolled-back update. **Stop after current update** lets the in-flight operation finish its recovery boundary before stopping. Results remain visible for review and retries.

The native broker verifies the package, numeric version, supported extension library version, registered repository, installed artifact and exact candidate bytes. It does not compare display versions lexicographically. Review includes the candidate SHA-256 and explicitly identifies unknown installed-repository provenance. Repository signing metadata is displayed; this does not claim independent package-signature verification.

Only credential-free HTTPS artifact URLs are accepted. Redirects require another supported download location instead of being followed silently. Artifacts have a 32 MiB limit. Metadata is inspected in a separate bounded Java helper without loading extension classes. The upload uses the reviewed bytes, a content-addressed generated basename and the pinned runtime's supported external-extension update operation. Existing target collisions are rejected. JAR updates also verify the installed JAR digest against the reviewed file; APK updates explain the runtime's conversion to JAR.

Before applying, the broker stops Java while retaining the exclusive private-storage lock and snapshots these fixed paths:

- `database.mv.db`
- `extensions`
- `android-compat`, including preferences used for deferred extension-file deletion
- `server.conf`, if present
- `settings`, including the pinned engine's actual `source_<id>.xml` preference files

New private checkpoints use manifest **version 2**, adding the real `settings` directory to the original four roots. Version 1 checkpoints remain recoverable using only their recorded roots; their uncaptured live `settings` directory is left untouched. A legacy copy cannot reconstruct source preferences it never saved. Unknown versions, omitted required roots and unrecorded snapshot roots are refused.

This is backward recovery compatibility, not downgrade support. Older checkpoint-aware builds that accept only v1 reject retained v2 checkpoints, even accepted ones. Do not reuse newer Reader data with an older application build expecting it to understand the newer recovery record. This private format is separate from the portable archive and preferences-export versions.

The private checkpoint stays under the Reader data directory's `extension-recovery` folder. It can contain credentials from the managed runtime. It is never included in portable archives or uploaded, and Windows ownership/DACL checks cover both the protected root and inherited private descendants. Symlinks and reparse points are refused. The copy has a bounded manifest, per-file hashes, a 20,000-entry limit, 512 MiB per file and 2 GiB total.

After upload, the broker cleanly stops and restarts Java, then checks runtime health, installed version/artifact, complete source identity and saved manga/library/category/chapter state before accepting the checkpoint. A failed check stops Java and restores the previous recorded database, extensions, settings and configuration before restarting. The selected live roots pass private-permission checks before hashing or replacement; v2 also removes settings files created after its checkpoint. A pending checkpoint is recovered under the storage lock before the next startup validates `server.conf` or launches Java, including an interruption between configuration-file replacement steps.

The snapshot remains immutable through recovery. Restoring it first builds and verifies a separate replacement, then replaces fixed roots; an interruption during replacement retries from the same snapshot. A successful update retains its private copy until the next update. If copy integrity or private permissions cannot be verified, Reader stays stopped with an explicit recovery error.

This recovery does not sandbox trusted executable extensions or protect against arbitrary actions by code running with the same Windows account. The guarantee covers the managed Reader state and tested process interruptions, not power-loss filesystem ordering. App updates and library-wide storage cleanup remain separate roadmap items.

## Verification entry points

- Web: selected Vitest workflow suite, including `restore-session.test.ts` and `mihon-backup.test.ts`.
- Browser: `reader-browser-smoke.mjs`, which invokes restore-session, matched Mihon import and extension-update helpers alongside existing playback, book, Movie, Vault and visual regressions.
- Native: `read_checkpoint::tests`, `read_runtime` storage/ACL tests and extension-review tests.
- Pinned runtime: original v1.6.1 → v1.6.2 fixture update, then an incompatible v1.6.3 source-ID change that must restore the previous executable source and library/progress/category state. The configurable fixture seeds a synthetic value through the actual preference API, verifies XML persistence and JVM restart, then has the rejected version change existing settings and create a new file. Displaced files prove those writes occurred; exact restored hashes, removal of the new file and another restart verify recovery.

Settings recovery was verified at [ef31b33](https://github.com/G1NYU/TSUGI/commit/ef31b33ae71426762279796fd92ab4ee767d689e): [Unified Windows](https://github.com/G1NYU/TSUGI/actions/runs/45787250134) passed 94 native and 277 web tests plus the full browser harness; [Reader runtime](https://github.com/G1NYU/TSUGI/actions/runs/45787250257) passed 31 focused and all seven packaged-runtime tests. The actual JVM test proved both rejected settings writes, exact restoration of the latest accepted files/artifact, removal of the candidate-only file and persistence after restart.

The development workflows validate source and publish synthetic UI screenshots. Normal development commits do not build a new Windows test ZIP or publish a release.
