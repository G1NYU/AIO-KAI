# Portable data ownership — A1 initial audit and B1 research

Baseline: `bacd508` on feature/tsugi-read-runtime. Initial audit, not a claim that every dynamic store has been inventoried. All unclassified stores are excluded by default until reviewed.

| Domain | Verified persistence / owner | Backup decision |
|---|---|---|
| Built-in preferences | WebView localStorage via lib/storage.ts; player-theme.ts, player-layout.ts, audio-profiles.ts, desktop-area.tsx, reader-preferences.ts | A1.1 explicit typed projection; no arbitrary storage dump |
| Imported Studio layouts | tsugi-desktop-player-stage-v1 contains original imported JSON | Not exported in A1.1; later project only safe declarative data, no raw unknown fields |
| Music library | tsugi-independent-playlists-v1; lib/music/library.ts | Later validated playlist/collection metadata; artwork URL can carry secrets, omit unless independently proven safe |
| Music connections | aiostreams-desktop-music-sources-v1 / remember flag | Never copy raw manifest/URL; preserve stable non-secret identities, require reconnect for private sources |
| Music history | tsugi-recent-music-v1; metadata only but artworkURL and IDs need review | Later bounded projection; no resolved URLs |
| Music queue | lib/music/queue.ts transforms in-memory queue | Verify persistence before promising backup/resume |
| Local music | lib/music/remembered-folder.ts, IndexedDB file handles | Handles are device permissions, not portable files; reconnect folder on restore |
| Video | aiostreams-web-servers / aiostreams-web-server; server-owned history; synced settings cache in lib/settings/store.ts | No credential cache or server-owned watch progress. Review server base separately; never copy arbitrary logo or private URL |
| Video login | jellyfin_credentials and per-server signed-out state | Explicit exclusion |
| Books | IndexedDB tsugi-local-books-v1, books/files stores; book-library.ts | Metadata/position and file identity; books are Blob payloads, not merely external references. Optional book media export separate from settings; no orphan progress restore |
| Vault / downloads | lib/downloads/store.ts IndexedDB and native downloads.json; core downloads/vault_engine | Exclude raw jobs, signed URLs and file content from settings backup; later safe references/metadata only. Keep cleanup separate |
| Native app | app/src/main.rs portable data/ root, players.json, downloads.json, mpv config, logs, subtitles | Classify each; no whole-directory zip, no logs/subtitles/raw mpv config by default |
| Reader | app/src/reading.rs managed runtime, core reader bridge, separate runtime DB | Use supported consistent semantic export; do not copy live database. Need verify backup schema and credential exclusions |
| Trackers/TorBox | separate account connections and runtime secrets | Explicit exclusion; reconnect after restore |

A1.1 format is intentionally **tsugi-preferences / version 1**, JSON, 16 KiB limit, exact fields and closed enum/type validation. It is not the final multi-domain archive. Unknown fields/version rejected; import previews before writes. Ordinary storage failures roll back completed writes, but power loss and a blocked rollback remain limitations; durable journaling and native transactions are A1 follow-ups. Selecting built-in palette disables imported palette colors; imported layout selection is excluded (null = keep current layout). Existing validated imported template stays on device. No source URL, media, token, history or arbitrary string is serialized. Browser download initiation is not proof of disk persistence.

## B1 — Extension updates (read-only research)
- [Wotaku directory](https://wotaku.wiki/ext/) and [Mihon-specific page](https://wotaku.wiki/ext/mihon) list several independent extension repositories; use as documentation/discovery, not a built-in trusted allowlist.
- [Keiyoushi distribution](https://github.com/keiyoushi/extensions) documents an index.pb repository; [source project](https://github.com/keiyoushi/extensions-source) is separate. Use user-registered repositories and test with authorized fixtures, not a hardcoded single-provider updater.
- [Pinned runtime packaging script](../packages/desktop/scripts/fetch-read-tools.ps1) pins Suwayomi Server v2.4.2373.
- [Pinned ExtensionMutation.kt](https://github.com/Suwayomi/Suwayomi-Server/blob/v2.4.2373/server/src/main/kotlin/suwayomi/tachidesk/graphql/mutations/ExtensionMutation.kt) explicitly exposes UpdateExtensionInput(id, patch), UpdateExtensionsInput(ids, patch), and UpdateExtensionPatch(install, update, uninstall). Update is gated by hasUpdate and calls Extension.updateExtension; install is distinct. Context7 latest docs corroborate, but pinned source governs.
- Tsugi's current ReadAction/extension UI has refresh, filter, install, uninstall only. Add typed hasUpdate metadata and a distinct update operation after recovery safeguards. Verify package/repository identity, source IDs, data preservation, failed updates, and exact installed vs available version semantics against pinned runtime before live mutation. No APK fetching or installing in this research step.

Next: finish state inventory (including dynamic synced settings, native reader storage, book metadata/progress, source IDs), investigate semantic reader backup endpoints, extend the versioned format with validated library projections, durable recovery and secret exclusion tests. No automatic updater or extension mutation before those gates.

A1.2 music export uses `tsugi-music-library` v1 (4 MiB), strict typed projection, public native YouTube video/browse IDs only, and metadata-only fallback for all other tracks. No arbitrary addon identifiers, artwork URLs or credentials. Merge preview preserves existing list identity/order, retains intentional duplicates by multiplicity, blocks conflicting identities/capacity and stale previews, and uses a single storage write. No replace operation yet. Obvious URL/control-character metadata blocks export instead of silently dropping entries.

Pinned runtime [BackupMutation.kt](https://github.com/Suwayomi/Suwayomi-Server/blob/v2.4.2373/server/src/main/kotlin/suwayomi/tachidesk/graphql/mutations/BackupMutation.kt) and [BackupQuery.kt](https://github.com/Suwayomi/Suwayomi-Server/blob/v2.4.2373/server/src/main/kotlin/suwayomi/tachidesk/graphql/queries/BackupQuery.kt) expose createBackup, validateBackup, restoreBackup and restoreStatus; native temporary download URL and upload scalar require safe bounded adapters. Explicitly disable server settings, client data and tracking for credential-free backup pending audit; inspect nested chapter/source URL and manga metadata before exporting raw protobuf. Runtime validator reports missing sources/trackers, not a complete dry-run mapping; B2 needs additional review.

A1.3 book metadata: `tsugi-book-progress` v1 (2 MiB / 1000 entries), no ebook blobs or local paths. Streaming SHA-256 verifies immutable file contents; reimport original file first. Ambiguous duplicates are not guessed; newer progress and custom titles are retained. The final guarded IndexedDB transaction checks original metadata and file existence/size, and never modifies file/cover stores. Full book file transfer remains optional future work.

### Manga semantic recovery (A1.4)

Pinned Suwayomi v2.4.2373 upstream protobuf backups include raw manga/chapter/thumbnail URLs even with settings and tracking flags excluded (see `BackupMangaHandler.kt`, `BackupManga.kt`, `BackupChapter.kt`, `BackupHistory.kt` in the upstream backup proto implementation). Do not use the raw archive for a credential-excluding Tsugi backup. The native cached GraphQL projection hashes source ID + manga URL and parent digest + chapter URL using domain-separated, length-prefixed SHA-256. Only digests and typed reading metadata cross the bridge. Hashes are matching identifiers, not encryption or guaranteed anonymity; user-facing titles/category names remain in the file. Restore requires the original source and title already in the library, exact chapter identity, and matching expected state. It never writes unread/unbookmark flags or decreases partial positions. Partial positions require equal known page counts. Older positions are kept locally; bookmark additions merge independently. The upstream chapter mutation sets current history time when writing a position and can invoke its configured KOReader sync; it cannot set the original timestamp. Multiple mutation groups are not one transaction, so confirmed counts and retry-after-preview are explicit. Category names are informational at this stage. Limits: 8 MiB backup, 1,000 titles, 100,000 chapters total, 10,000 per title, 2,000 reviewed changes per title, plus the existing native response cap. Full recovery still requires category reconciliation, source restoration design, scheduling and durable archive/recovery work.

### Unified portable archive (A1.5)

`tsugi-portable` v1 is a single JSON file (24 MiB cap) containing a UTC creation timestamp and 3–4 fixed-name entries with the original validated domain JSON, UTF-8 byte count and SHA-256 digest. The mandatory entries are preferences, music and books; manga can be explicitly excluded or unavailable. Each nested schema is revalidated even if the hash matches. Unknown, duplicate, missing, oversized or damaged entries reject the entire archive before any restore UI is enabled. No file paths, extraction, executable data, arbitrary storage enumeration or media payloads. Digest checks detect corruption, not provenance/authenticity. Export reads the stores sequentially and initiates a browser download; it does not guarantee a consistent point-in-time database transaction or confirmed disk persistence. Restore uses the existing per-domain preview/confirmation independently, with the original guards; no global transaction or replacement. Users should export a current recovery copy first. Native durable backups and scheduling remain follow-ups.

### Manga category recovery (A1.6)

The manga payload now supports version 2 with a complete `categories` name array, including unassigned shelves; version 1 remains supported and derives the available names from assignments. Export rejects incomplete or inconsistent snapshots. The preview creates only missing valid names, reuses only exact unique names, and skips case/Unicode-normalized collisions, reserved names, duplicate local names and unresolved manga identities. Apply rechecks the full initial category inventory, validates exact manga identities and resolves category IDs against fresh local queries, verifies each mutation, and reports confirmed work if interrupted. Shelf ordering, existing local names, deletions, and original history times are not overwritten. New shelf capacity is capped at 99 non-default categories and 2,000 reviewed assignments. Upstream calls are independent, not one transaction.

### Managed Windows backup copies (A1.7)

The packaged Windows shell exposes a separate `backup-request` capability with only list, save and open operations. It uses a fixed `data/backups` directory and generated `tsugi-backup-<epoch ms>-<random>.json` names, never a renderer-supplied path. The Rust boundary checks bounded manifest, per-section lengths and SHA-256, known nested schema shapes and field allowlists; the WebView also validates scalar semantics before capture and after opening. Writes stage exclusively, flush the file, publish by same-directory rename, and verify exact readback. The native worker allows one operation at a time; the UI reports verified saves and a bounded history (500 files, 10,000 directory entries). Reparse/symlink entries are rejected; unknown files and temp remnants are not listed or deleted. These are local private metadata backups, not encrypted or authenticated, and do not protect against disk loss. No retention deletion or background scheduling in this slice. Native IPC transfer at maximum archive size and packaged Windows UI remain physical acceptance items.

### Automatic backup policy (A1.8)

The local `tsugi-backup-schedule-v1` policy is excluded from archive restoration: a copied archive must never enable automatic work or deletion on another installation. Default is off, no manga, keep all. Users may choose daily/weekly, optional manga and retention of 3/7/14/30 **verified automatic** copies. A scheduled save uses `tsugi-auto-backup-<epoch ms>-<random>.json`; retention runs only after a successful write/readback, never removes manual, damaged or unrelated files, reports incomplete retention, and does not bypass the 500-file cap. Schedule checks run in the active desktop WebView every 30 seconds or on focus/visibility change. Open reader/settings, hidden app and any unfinished or unreadable restore checkpoint defer work. Scheduled capture and native save/retention share the restore session's origin-wide Web Lock, including before a restore journal exists; a busy or unavailable lock defers the due attempt without changing its deadline. The journal and current policy are rechecked after capture and before native save. A due attempt is reserved durably only after acquiring the lock, errors/interruption retry after an hour, and success schedules the next interval. No background service, no backup while closed, no guaranteed execution during suspension, and no atomic multi-store snapshot. If Reader is selected but unavailable, the attempt fails rather than silently dropping manga. Actual packaged WebView scheduling/IPC still needs physical acceptance.

### Read-only storage inventory (A1.9a)

The native storage operation reports logical bytes and file counts inside the existing trusted app-data root only: backups, Reader runtime data, WebView2 data, logs, internal downloads and other app data. It does not create the backup directory, read file contents, accept paths, follow reparse points, or delete files. A per-bucket 50,000-entry limit, 32-level depth limit and 10,000 root-entry limit bound scanning. Inaccessible or redirected entries and exceeded bounds mark the corresponding counts partial; sizes are not filesystem allocation totals and can change during scanning. Reader chapters and local books/cache remain included in their owning directories, not double counted. Installed application/runtime binaries and user-selected external folders are outside this first scan. No generic cache cleanup is enabled.

### Release identity discovery (A2.1)

Portable Tsugi packages report inherited native engine version separately from the Tsugi release tag. `BUILD-INFO.json` provides source commit identity. The manual check queries only the official G1NYU/TSUGI stable release and its lightweight tag reference, validates exact Windows x64 package/checksum asset names and GitHub URLs and requires the published SHA-256 digest. It compares current and stable source revisions for equality, not version ordering; a differing build is not necessarily older. Release notes are plain text. No executable is downloaded or applied; published digest is metadata, not verified downloaded bytes or independent publisher authentication. No upstream updater is enabled for portable packages. Full portable version identity, staged updates, backup-before-apply and rollback remain future work.

### Detailed read-only storage inventory (A1.9b)

Settings requests a detailed scan of the same app-data root. Older requests retain the six aggregate rows. The three additional rows are disjoint logical byte counts.

| Row | Directory relative to app data | Boundary |
|---|---|---|
| Downloaded manga chapters | `reading/downloads/mangas` | Default chapter download tree from pinned Suwayomi v2.4.2373. Thumbnails, local-source manga and custom external download paths are excluded from this row. |
| Reader browser data | `reading/cache` | Browser/session data inside the managed Reader data root; not a disposable image-cache estimate. System temporary storage is outside this scan. |
| WebView disk cache | `WebView2/EBWebView/Default/Cache` | Recognized default-profile HTTP cache directory. Other layouts, IndexedDB book blobs, site storage and unrecognized cache directories stay in the WebView total. |

The native worker shares the original traversal budgets across subcategories. A skipped parent can make subsidiary counts partial. Directory names classify measured files for display only. They do not establish that files are disposable, unmodified, idle, or safe to remove. Installed binaries and external folders remain unmeasured.

### Cleanup ownership review

| Candidate | Owner and verified scope | Requirement before offering cleanup |
|---|---|---|
| Reader browser data | Pinned Suwayomi uses `reading/cache/kcef` as an embedded browser profile. Its WebviewMutation clears cookies along with cache. | Preserve source sessions. The aggregate Reader browser-data size cannot be offered as reclaimable space. |
| Cached chapter pages and thumbnails | Pinned ImageMutation calls `ImageResponse.clearImages`, which recursively removes a directory under the JVM temporary Tachidesk root. Upstream defaults to a shared temporary root. Tsugi now passes a private per-installation JVM temp directory to its managed launcher. | Measure only the two image subdirectories beneath the isolated root. Coordinate with the running reader, reject redirects and revalidate before deletion. |
| Downloaded chapters | The offline chapter directory contains persistent media. | Use the owning runtime's per-chapter removal contract after verifying identity, pin state, in-use readers, and current transfer state. |
| WebView disk cache | WebView2 distinguishes DiskCache from IndexedDB, cookies and other profile data. Its API operates on a profile, while A1.9b measures one recognized directory. | Verify the active profile/category and preservation across cleanup/restart. The API does not satisfy an exact-file/byte review; keep cleanup unavailable until its scope and accounting contract is established. Observed directory sizes are not verified removed-byte counts. |

The storage inventory alone authorizes no cleanup. Test deletion on disposable Windows profiles, including a changed target between review and apply, before exposing a destructive action.

The managed Reader now opens and verifies an owner-only runtime-temp directory inside its locked data root. Existing installations acquire this directory on next launch. The legacy system temp folder is neither migrated nor cleaned. The native ACL fixture checks two independent profiles and reopening the first.

The global storage panel offers a bounded review of up to 500 persisted Movies & TV artwork cache rows. This database is `aiostreams-web-cache`; the logical payload is already part of the WebView total. The review discloses count and logical bytes. Apply checks the artwork index inside the same read/write transaction used to remove the reviewed metadata/body pairs. New writes carry a per-write revision, including equal-size replacements. The browser fixture covers cancellation, changed preview, confirmed deletion, empty cache and preservation of a query body. Artwork may load again online. Other cache categories, IndexedDB books, Reader storage, external media and account state are outside the operation.

### Reviewed temporary Reader images (A1 follow-up)

The [temporary Reader image cleanup](reader-image-cache-cleanup.md) implements the next ownership-review item: exact regular-file reviews beneath private `reading/runtime-temp/Tachidesk/manga-cache` and `thumbnails`. It keeps downloaded chapters and permanent covers, `reading/cache/kcef` browser/session storage, source settings, database metadata and unrelated temp files. The renderer receives only logical totals and an opaque review ID. A native confirmation, stopped JVM, retained private storage lock, complete fingerprint recheck and pinned Windows handles bound removal to the reviewed files. Partial or unknown results and failed restarts remain explicit.

These temporary image bytes remain in the aggregate Reader runtime row. The detailed `reading/cache` row is labelled **Reader browser data**, because it can contain source sessions and is not disposable image storage. No storage schema or generic cache deletion was added. The exact image review has independent bounds and never cleans legacy shared system temp. Windows-runtime verification and remaining physical acceptance are recorded in [HANDOFF.md](../HANDOFF.md).

### Next WebView disk-cache verification

A read-only audit of the pinned `wry 0.57.0` and `webview2-com 0.39.1` bindings confirms that a selective operation needs no new dependency. WebView2's [browsing-data kinds](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/webview2-idl#corewebview2_browsing_data_kinds) separate `DISK_CACHE` from cookies, IndexedDB, localStorage and service workers. Do not use wry's all-browsing-data convenience method for this feature.

The [profile cleanup API](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2profile2) reports asynchronous completion, not an exact reviewed-file set or reclaimed-byte total. The current `Default/Cache` scan is only an observation and cannot authorize directory deletion or prove that it matches the active profile's whole disk-cache category. Validate the actual environment and profile paths: WebView2 configuration can override the requested user-data directory. Execute COM calls and completion handling on the [UI event loop](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/threading-model), not the backup worker thread.

Next implementation gate: an actual disposable Windows WebView2 profile containing original cached HTTP assets, ebook Blob/cover/progress data, preferences, IndexedDB records and synthetic cookies. Verify only `DISK_CACHE` is requested, wait for the real completion callback, then prove cache refetch and preservation immediately and after restart. Cover unsupported interfaces, changed profiles, cancellation and interrupted close. Any eventual UI must distinguish category-wide completion from observed size changes; it must not inherit Reader's exact-file removal claim. This audit adds no cleanup command or user-data mutation.

### Public SoundCloud identity follow-up

Music metadata backups now admit the fixed built-in SoundCloud source ID
`f9cf487e-67c9-4e29-a626-6db1cd1e1ec2` only with a canonical positive decimal
track ID within the unsigned 64-bit range. Identity matching is scoped by the
provider ID; arbitrary addon IDs, private track tokens, stream URLs and
artwork URLs remain excluded. No audio bytes or account credentials are
captured. Existing archives remain supported; older application builds that
do not recognize this added public identity reject archives containing it.
Native SoundCloud playback/search use a separate temporary owner-only
directory outside portable data, and are not included in managed backups.
