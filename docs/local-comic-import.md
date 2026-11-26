# Local CBZ import

Development branch: `feature/tsugi-read-runtime`. This is the B3.2 local-comic increment. It uses the existing native Reader and its local source; it does not add a second reading engine. Check `PROGRESS.md` for the published revision and verification results.

## Import and read

Open **Read → Library → Import CBZ**, then select one `.cbz` file in the native Windows file picker. TSUGI validates a private copy before showing the import review. The review identifies the title, page count, archive size and whether the same archive has already been imported. It does not add a library entry merely because a file was selected.

Confirm the reviewed import to add the comic to the local library. Open the imported title in the existing Reader, which already supports scrolling, single pages, spreads, right-to-left reading, saved position and chapter bookmarks.

The source archive remains unchanged. Imported media is a separate local copy, so it needs additional disk space. One archive becomes one title with one chapter. Image filenames determine natural page order: `1`, `2`, `10` are read in that order. Archive folders are used only when sorting and validating names; they are never extracted as filesystem paths.

## Duplicate identity and recovery

The archive's SHA-256 identifies its local title. Selecting the same bytes again reuses the existing title and chapter, even if the archive was renamed. The original imported title is retained, and reimport does not reset reading progress, bookmarks or categories. Repacking or modifying an archive changes its identity and can create a separate title.

Local-source browsing preserves imported titles instead of exposing generated storage folder names. Local search also matches the readable titles of already registered imports, case insensitively. This reuses the existing catalogue and cached metadata; it does not fetch chapter pages. A local catalogue is limited to 200 results, cached import discovery to 1,000 records and inspected metadata to 16 MiB. Narrow the search or open the title from Library when these bounds are exceeded.

Validation and review happen in unpublished staging. Cancelling or replacing a review removes only that review's owned staging data. Publication uses a generated destination and does not overwrite an existing book. The imported page bytes are checked again before publication or duplicate reuse.

If the media has been published but library registration cannot finish, TSUGI reports that partial result. Select the same archive again for a fresh review and registration attempt. Published media is retained; an uncertain response is not automatically replayed. Unexpected files, unsafe filesystem links or changed imported media block reuse instead of being overwritten or silently repaired.

## Supported archives and limits

This increment accepts unencrypted `.cbz` files containing PNG or JPEG pages, with stored or deflated ZIP entries. It validates the actual decompressed data and image decoding, not just filenames. A root `ComicInfo.xml` file up to 64 KiB may be ignored; its XML is never parsed or copied into the local title. Unsupported page formats and unrelated payload files are rejected. ZIP64, split archives, encryption and alternate Unicode-path ZIP extra fields are not supported.

The importer limits input archives to 256 MiB, expanded archive contents to 512 MiB, pages to 2,000 and each page to 24 MiB. Each image is limited to 32 million decoded pixels and 100,000 pixels per dimension. The ZIP directory allows at most 4,000 entries, with bounded names and metadata. Helper execution is time limited. Truncated archives, mismatched entry metadata, corrupt CRCs, traversal paths, absolute paths, duplicate names and case collisions are rejected before publication.

Generated sequential filenames and private Windows storage keep archive entry names away from destination paths. The selected file must be locally available on a normal drive; network shares and paths through filesystem links or reparse points are refused. Import currently requires the default private local-manga folder.

The archive validator uses the bundled Java runtime without loading source extensions. It prefers the current application's bundled helper when an older Reader runtime is already prepared, so it does not need to overwrite a running runtime's classes. Import and local reading do not need a manga provider.

## Backup and remaining B3 work

Portable backups and native recovery checkpoints contain metadata, not these imported page files. Keep the original CBZ and a separate copy of important media. Importing a comic does not add full-media backup coverage.

This feature does not close B3. Strict local-only verification for provider-downloaded chapters, storage quotas and retention, configurable download location, optional download-ahead and automatic downloads remain separate increments. Vault-to-Read CBZ handoff is also separate from selecting a file here.
