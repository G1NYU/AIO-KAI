# MyAnimeList collections

TSUGI imports **local MyAnimeList XML exports** as source-independent collection snapshots. This is not MAL OAuth, live synchronization, an official MAL client or an automatic match to a playback/reading provider.

## Reader → Library → MyAnimeList

1. Export your manga list from MyAnimeList and choose its .xml or .xml.gz file with Import MAL list. Review the new/existing counts before saving.
2. Titles are visible immediately, including those with no installed reading source. The original MAL ID, title, reading status, score, read/total chapter counts and read/total volumes are retained.
3. Select an imported title, choose an installed source from your Mihon/Tachiyomi-compatible extension repositories, edit the search if needed, and review an exact candidate. Install extensions separately using the existing trusted repository flow.
4. Save source and open manga adds the reviewed native title to the Reader library, verifies its stable source identity and stores the assignment. Open saved source rechecks the identity and membership before opening. You can choose another source; the previous native title is not removed automatically.

Imported chapter counts do not imply any specific local chapter IDs, editions or page offsets. They are displayed separately; no chapter is marked read and no tracker is linked or updated merely by importing or matching. Existing manual MAL/AniList tracker controls are unchanged.

## Movies & TV → Watch profile → Anime

Select the Anime section after entering a Watch profile. Import your anime export using the same review flow. Filter movies, series/specials and MAL watch statuses. The original ID, type, watched/total episodes, status and score are retained.

Choose an imported title, a compatible enabled addon catalogue with a declared free-text search extra, and review one returned title. Open matched anime opens the existing Watch details and stream selection. No guessed IMDb/TMDB/Kitsu mapping, automatic media selection, playback or account write is performed. A catalogue requiring additional filters must be used through Your addons. Anime-specific source assignments are not persisted in this first slice; episode-to-MAL mapping and ongoing anime tracking are separate follow-ups.

Anime metadata is stored with the active Watch profile in the existing Windows-user protected native profile snapshot. Other profiles cannot read or mutate it. Deleting a profile deletes its anime collection. Removing a list entry only removes the imported metadata, never provider history or media. Empty anime collections do not add a new serialized field; after importing anime, older builds that do not recognize the new snapshot field may reject the protected store. Do not downgrade or reset the store to work around that.

## Bounds and privacy

- Each file may contain up to 3,000 entries and 8 MiB of decoded UTF-8 XML (also bounded before gzip expansion). Each normalized list is capped at 2 MiB; Reader's local store has an additional 3 MiB bound for source assignments. Invalid files, DTD/entity declarations, contradictory duplicate IDs, wrong list kinds and invalid fields are rejected without applying the preview.
- Identical duplicate rows collapse by MAL ID, and reimport adds new IDs only. Existing progress/status and reviewed Reader assignments are preserved. Updating an existing entry from a newer export requires a future explicit conflict-review flow.
- Account metadata, credentials, personal notes, comments, tags and raw XML are not retained. No remote request is made by the import itself. Search requests happen only on the user's selected source.
- Reader's imported catalogue and source assignments live in dedicated local WebView storage. They are not currently included in the managed portable metadata archive. Keep the original MAL export; clearing WebView app data can remove this catalogue and its assignments. The native manga library and chapters remain separate.
- MAL metadata imported by either surface is a snapshot; it does not become actual local reading/watching history and does not enqueue Refract or tracker writes. No automatic MAL sync or account-based list fetch is claimed.

## Acceptance

Synthetic browser fixtures cover XML/gzip, malformed/wrong-kind files, duplicate handling, progress preservation, reviewed extension search and saved source reopening, anime movie/series filters, profile switching and explicit addon search. Native tests cover list validation, profile scope, snapshot recovery, additive import and removal. The implementation requires cumulative CI and a physical Windows review. Keep real provider and real-user export acceptance distinct from fixture tests.
