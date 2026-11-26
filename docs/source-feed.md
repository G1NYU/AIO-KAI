# Reader source Feed

Feed is an opt-in discovery view under **Reader → Browse → Feed**. Choose up to eight installed sources and request their Popular or Latest catalogues when needed. Existing library chapter updates remain in **Updates**.

## Using Feed

1. Open Feed and wait for the installed-source list. This reads local runtime metadata; it does not request provider catalogues. If needed, install a trusted source through **Extensions**, then choose **Reload installed sources**.
2. Choose a source and select **Add to Feed**. Set its mode to **Popular** or **Latest**. Latest is available only when the source reports support. Adding, removing or changing a choice does not fetch a catalogue.
3. Choose **Refresh feed** to request page 1 from each eligible selection, in saved order. Feed dispatches one catalogue request at a time. An unavailable source or unsupported Latest selection is skipped without silently substituting another source or mode.
4. Use **Refresh this source**, **Previous page**, **Next page**, or **Retry this source** for that row. Retry repeats the failed page. Each source has its own page and error state; a failed request keeps its previous successful page available and does not prevent other selected sources from finishing.
5. Choose **Stop after current source** to clear the remaining queue. The current request finishes and its result or error is accepted. Leaving Feed, opening a title, or changing the selection instead invalidates the outstanding reply and clears queued work. Returning does not restart it automatically.

A request already sent to the native engine cannot be aborted by the Feed controls. Other Reader actions can wait for that work to finish. Visible manga cards use the existing native cover loader, which can use or populate the artwork cache; the manual-fetch rule applies to catalogue discovery, not to all artwork traffic.

Feed accepts at most **200 titles in one catalogue page**, with pages numbered **1–1,000** per source. An oversized or malformed page produces an error for that source; it is not silently truncated. Next page is available only when the provider reports another page and the page limit has not been reached. There is no automatic next-page prefetch.

## Saved choices and unavailable sources

Only the ordered source IDs and their Popular/Latest modes are saved. Source IDs remain exact signed 64-bit decimal strings, including values that JavaScript cannot represent as numbers. The local-files source is excluded from Feed selection.

An unavailable saved source remains selected and is labelled with its ID until it becomes available or you remove it. Reloading installed sources does not install extensions, discard unavailable choices, or fetch catalogues. A saved Latest choice also remains intact if the source stops supporting Latest; choose Popular explicitly to use that source again.

Feed's rendered result pages and per-source page state stay in memory. They can remain while navigating within the mounted Reader view, but are not written to Feed preferences or backups and are lost on reload. The engine's separate metadata cache is described below. Selecting a card opens the normal manga detail view; Feed itself does not add titles to the library, follow them, download chapters, or change chapter progress.

Unreadable or malformed saved choices are reported. Feed blocks refresh until the choices can be reloaded or the user explicitly resets them; it does not overwrite damaged choices with an empty successful save.

## Backup compatibility

New preference exports use `tsugi-preferences` **version 2**, with a required `feed` section containing the version-1 selection schema. Manual portable archives, scheduled backups, restore recovery copies and chapter-cleanup safety copies include this section through the shared capture path. The outer `tsugi-portable` archive format remains **version 1**.

Applying an older **preferences v1** section preserves current Feed choices and does not read or write their storage key. Preparing a separate recovery copy still captures the current settings. Applying v2 restores the reviewed selection, including an explicitly empty selection, and detects choices changed after the restore preview. Restoring choices does not install extensions or request provider catalogues; refresh Feed explicitly afterwards.

New v2 preference files, and portable archives containing them, are **not compatible with older TSUGI builds that accept only preferences v1**. Keeping the outer archive version at 1 does not change that nested-format requirement. Current builds continue to accept older v1 preference files.

## Native inventory and catalogue contract

The adapter targets [Suwayomi Server v2.4.2373](https://github.com/Suwayomi/Suwayomi-Server/tree/v2.4.2373), pinned at `9f8cc818b5df6d0e7e10e0de415903635d2c04de`. The new fixed `source-inventory` action returns loaded source metadata in `nodes` (`id`, `name`, `lang`, optional `displayName`, and `supportsLatest`), a raw `totalCount`, and `complete: true` only after the bounded scan succeeds. The existing `sources` action is unchanged.

The inventory scans **at most 1,000 raw database rows**, using 100-row pages at fixed offsets and ascending signed source IDs. Upstream counts and paginates database rows before omitting sources it cannot load. Consequently, a short or empty visible page is not the end, and the number of returned sources can be smaller than `totalCount`. The native response includes local source `0`; Feed filters it out.

Every raw page is scanned twice. The adapter requires stable totals and identical projected source metadata across both passes, and rejects invalid bounds, duplicate or nonascending IDs, or changed results. `complete` means all bounded raw pages were scanned with matching observed results. The upstream API supplies no transaction token across those requests, so this is **not a transactional snapshot** or proof that every database source loaded.

Catalogue requests use the existing fixed `fetchSourceManga` mutation with the selected source, mode and page. The engine inserts or updates cached catalogue metadata, and may cache artwork through subsequent cover requests. Feed therefore does **not** promise zero database writes. Its 200-title response limit does not undo metadata the engine already cached before returning an oversized page. Library membership, categories, bookmarks and chapter progress are outside Feed's requested changes.

## Verification and remaining scope

The original Feed fixture installs 101 sources, including ID `9007199254740993`, and supplies distinct Popular and Latest pages. Its packaged runtime test checks inventory across the page boundary and restart, plus unchanged saved library membership, categories, bookmarks and page progress. It uses a separate fixture JAR and disposable data directory, with original PNGs served by its own loopback listener.

Unit coverage exercises empty visible pages followed by later sources, exact IDs, bounds, changing inventories, sequential catalogue dispatch, per-source retry/paging, stop versus reply invalidation, and preference compatibility. The browser helper exercises the real Feed UI against a synthetic native bridge. **Execution of the new fixture against the actual packaged Windows runtime remains pending at this documentation checkpoint.** Local helper tests and cross-compilation do not replace that gate or physical Windows acceptance.

Implementation and test entry points:

- `packages/web/src/app/read/source-feed.tsx`, `source-feed-state.ts`, and `source-feed-preferences.ts`: UI, request coordination and saved choices.
- `packages/web/src/lib/backup/preferences.ts` and `packages/desktop/core/src/backup_store.rs`: preference versions and managed archive validation.
- `packages/desktop/core/src/read_runtime.rs` and `read_feed_tests.rs`: complete source inventory and packaged runtime coverage.
- `packages/desktop/scripts/read-runtime/fixture/FeedFixtureFactory.java`, `FeedFixtureSource.java`, and `AndroidManifest-feed.xml`: authored source fixture.
- `packages/web/tests/source-feed.test.ts`, `source-feed-preferences.test.ts`, and `source-feed-browser.mjs`: state, storage and browser regression coverage.

This slice does not complete the wider B1 roadmap. Source icons, extension-provided source preferences and adult-content filtering remain separate work.
