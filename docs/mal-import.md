# MyAnimeList collections

TSUGI imports **local MyAnimeList XML exports** as source-independent collection snapshots. This is not MAL OAuth, live synchronization, an official MAL client or an automatic match to a playback/reading provider.

## Reader → Library → MyAnimeList

1. Export your manga list from MyAnimeList and choose its .xml or .xml.gz file with Import MAL list. Review the new/existing counts before saving.
2. Titles are visible immediately, including those with no installed reading source. The original MAL ID, title, reading status, score, read/total chapter counts and read/total volumes are retained.
3. Select an imported title, choose an installed source from your Mihon/Tachiyomi-compatible extension repositories, edit the search if needed, and review an exact candidate. Install extensions separately using the existing trusted repository flow.
4. Save source and open manga adds the reviewed native title to the Reader library, verifies its stable source identity and stores the assignment. Open saved source rechecks the identity and membership before opening. You can choose another source; the previous native title is not removed automatically.

Imported chapter counts do not imply any specific local chapter IDs, editions or page offsets. They are displayed separately; no chapter is marked read and no tracker is linked or updated merely by importing or matching. Existing manual MAL/AniList tracker controls are unchanged.

## Movies & TV → Watch profile → Anime

Select the Anime section after entering a Watch profile. The Anime Hub uses the supplied illustrated hero and manual carousel, responsive collection shelves, actual matched Continue Watching and History, My List, Anime films and Discover navigation. Import your anime export using the same review flow. Filter movies, series/specials and MAL watch statuses. The original ID, type, watched/total episodes, status and score are retained.

Choose an imported title, a compatible enabled addon catalogue with a declared free-text search extra, and review one returned title. Save and open matched anime persists the confirmed source, media type, actual provider identity and returned title in the active native profile, then opens the existing Watch details and stream selection. The native registry accepts only an exact result from the current, unexpired reviewed catalogue page; switching profiles or changing sources invalidates that review. Open saved anime source reopens the reviewed identity when the source is enabled. Forget anime source removes only the assignment. Removing an addon removes its assignments, not the MAL entries or existing watch history. No guessed IMDb/TMDB/Kitsu mapping, automatic media selection, playback or account write is performed. Discover exposes actual enabled anime/movie/series catalogues and their declared filters; generic movie/series catalogues may include non-anime titles. Weekly/romance/seasonal rankings and per-title artwork are not fabricated: provider-specific shelves depend on actual available metadata. Episode-to-MAL mapping and ongoing anime tracking remain follow-ups.

Anime metadata and reviewed source assignments are stored with the active Watch profile in the existing Windows-user protected native profile snapshot. Other profiles cannot read or mutate it. Deleting a profile deletes its anime collection and assignments. Removing a list entry only removes the imported metadata, never provider history or media. Empty anime collections do not add a new serialized field; after importing anime, older builds that do not recognize the new snapshot field may reject the protected store. Do not downgrade or reset the store to work around that.

### Connections and first launch

The Anime Hub keeps MyAnimeList and Refract shortcuts visible in every view. MyAnimeList opens the local reviewed anime export import; Refract opens the existing profile-scoped personal API key form and completed movie/episode tracking controls. This is not live MyAnimeList anime account synchronization. Refract accepts supported movie/series identities; unsupported anime identifiers remain local unless a supported mapping is established.

The first-launch Watch profile picker includes Anime and Refract setup without playback. The Appearance/Introduction screen introduces Anime Hub and offers an Anime setup shortcut that opens the Anime pane after choosing a profile. It also offers reviewed manga-list import on Reader-capable desktop builds without starting the reading engine. Assign Reader sources and tracker accounts after setup. All connections are optional and the existing skip/revisit flow is retained.

Anime heroes reuse the existing shared landscape decoration component (Kitsu and Nekos API, the existing local-only preference, cancellation, validation, and reduced-motion behavior). The four supplied illustrations remain available as manual bundled fallbacks. Optional per-title MAL covers use the already-used Jikan public metadata API and the existing approved MyAnimeList CDN, by exact imported anime ID only. The separate opt-in is off by default, excludes onboarding/playback, sends no profile credentials, progress, scores or title queries, and only requests visible entries, with shared bounded in-memory caching and paced cancellable requests. Unknown/mismatched/unsafe-rated metadata and non-approved image URLs fall back to text-only titles. Generic addon catalogue results have no fabricated covers or automatic MAL mapping.

## Bounds and privacy

- Each file may contain up to 3,000 entries and 8 MiB of decoded UTF-8 XML (also bounded before gzip expansion). Each normalized list is capped at 2 MiB; anime entries plus assignments must fit that same native bound. Reader's local store has an additional 3 MiB bound for source assignments. Invalid files, DTD/entity declarations, contradictory duplicate IDs, wrong list kinds and invalid fields are rejected without applying the preview.
- Identical duplicate rows collapse by MAL ID, and reimport adds new IDs only. Existing progress/status and reviewed Reader assignments are preserved. Updating an existing entry from a newer export requires a future explicit conflict-review flow.
- Account metadata, credentials, personal notes, comments, tags and raw XML are not retained. No remote request is made by the import itself. Search requests happen only on the user's selected source.
- Portable backups that include Reader data capture the imported manga catalogue and reviewed source assignments. In Data & storage, open the archive, prepare a restore checkpoint, and review the MyAnimeList manga collection. Restore adds missing entries and nonconflicting assignments. Opening a restored assignment checks the installed source and exact title identity again. If the local manga ID changed, choose the source again.
- MAL metadata imported by either surface is a snapshot; it does not become actual local reading/watching history and does not enqueue Refract or tracker writes. No automatic MAL sync or account-based list fetch is claimed.

## Anime Hub visual assets

The four WebP illustrations in packages/web/public/design/anime/ are exact artwork from the user-supplied TSUGI Anime Hub Complete Pack (27 November 2026). The prototype's fictional title images, ratings, episode metadata, demo profiles, browser-only history and simulated player are not used as real catalogue data. Existing global theme and accessibility settings remain authoritative. Shared Kitsu/Nekos artwork and opt-in exact MAL/Jikan cover lookup augment the bundled art; no new artwork dependency or developer registration.

## Acceptance

Synthetic browser fixtures cover XML/gzip, malformed/wrong-kind files, duplicate handling, progress preservation, reviewed extension search and saved source reopening, anime movie/series filters, profile switching and explicit addon search. Native tests cover list validation, profile scope, snapshot recovery, additive import and removal. The implementation requires cumulative CI and a physical Windows review. Keep real provider and real-user export acceptance distinct from fixture tests.
