> **Superseded acceptance policy:** [Mandatory P0–P5 recovery roadmap](tsugi-recovery-roadmap.md). Prior automated-only checks are historical; sign-in is no longer deferred. Playback/audio confirmed by maintainer; import/selector latency and visual quality remain release blockers.

# Desktop Watch journey audit · 27 November 2026

Audited revision `5d512b1715530a81b95901b01d1b803e228a65ed` on `feature/tsugi-read-runtime`. Findings apply to the standalone Movies & TV and Anime paths. The AIO server path and shared player provide the comparison. This review combines source tracing, the completed web and Windows CI jobs, and credential-free public HTTP requests. Physical Windows, signed-in imports and real media playback still require acceptance.

## Living acceptance tracker (2026-11-27)

Baseline `f21bf13`: [cumulative web and Windows CI 46022564530](https://github.com/G1NYU/TSUGI/actions/runs/46022564530) passed. The original audit below is preserved as historical evidence. Green means the correction passed automated checks; a yellow entry still has a material acceptance gap, including physical Windows or live-provider testing. Account sign-in is explicitly deferred; no stable release publication.

| # | Stage | State | Evidence / remaining gate |
| ---: | --- | --- | --- |
| 01 | Launch | 🟨 Partial | Default maximized and saved placement; fresh/restore/resize/restart on physical Windows open. |
| 02 | Introduction | 🟩 Verified | Browser destination-first and optional setup assertions. |
| 03 | Profiles | 🟩 Verified | Browser profile handoff, profile isolation and native snapshot tests. |
| 04 | Account login | ⏸️ Deferred | User excluded sign-in; actual signed-in import acceptance remains separate. |
| 05 | Import | 🟩 Verified | One explicit selected import, individual outcome reporting; account fixtures. |
| 06 | Capacity | 🟨 Partial | 128-source limit; full native snapshot and web 128-source boundary tests added in next change; CI and real import pending. |
| 07 | Manifest compatibility | 🟨 Pending CI | Native/bridge 512-catalogue bound, modern and documented legacy extras, fixed schema diagnostic codes; actual configured AIOMetadata acceptance open. |
| 08 | Import order | 🟩 Verified | Native ordered merge, stable source IDs and enabled states, order-only restore. |
| 09 | Addon refresh | 🟩 Verified | Native and browser failed-manifest recovery without reconnecting, cumulative CI. |
| 10 | Hub navigation | 🟩 Verified | Browser explicit hub destinations, zero-addon content, settings-only imports. |
| 11 | Catalogue artwork | 🟨 Partial | Public-CDN allowlist, safe proxy fallback and IMDb fallback tests; live provider art and physical display open. |
| 12 | Catalogue loading | 🟩 Verified | Native independent bounded pool, browser concurrent shelves and failure isolation. |
| 13 | Search | 🟩 Verified | Ranked exact-title and identity-based dedupe tests, combined browser grid. |
| 14 | Title identity | 🟨 Partial | Verified explicit aliases and exact returned episode matches; bounded multi-compatible-route fallback authored (CI pending), ambiguous anime numbering open. |
| 15 | Title details | 🟩 Verified | Native metadata fields and browser details/partial-result coverage. |
| 16 | Seasons | 🟩 Verified | Browser numbered seasons, specials and unnumbered choices. |
| 17 | Episodes | 🟩 Verified | Native name fallback and browser preserved metadata/episode selection on failure. |
| 18 | Play action | 🟩 Verified | Browser details-first and explicit Play/episode selection. |
| 19 | Stream aggregation | 🟨 Partial | Native compatible source and alias selection, disabled isolation; bounded empty-response fallback across exact compatible aliases authored (CI pending). |
| 20 | Stream presentation | 🟩 Verified | Native safe quality/detail fields, browser quality filtering, exact option index. |
| 21 | Source dropdown | 🟩 Verified | Title and player provider filters/counts in browser. |
| 22 | Source failures | 🟩 Verified | Native distinct outcomes and targeted retry preserving sibling grants; browser recovery. |
| 23 | Autoplay | 🟨 Partial | Shared persisted preference and fixture manual/auto/grant failure; real-provider acceptance open. |
| 24 | Playback | 🟨 Partial | Shared player with fixture track/subtitle/seek controls; permitted real media on Windows open. |
| 25 | Source switching | 🟨 Partial | Browser 45-second fresh-grant and exact episode test; actual media clock open. |
| 26 | Returning | 🟩 Verified | Browser title/episode restoration and browsing continuity; physical WebView2 acceptance remains release gate. |
| 27 | Anime discovery | 🟩 Verified | Tenrai v1 replaced Jikan; prior live feed/MAL artwork checks and browser fixture. |
| 28 | Anime playback | 🟨 Partial | Verified MAL/Kitsu routes and episode progression; live multi-namespace specials and regular episodes open. |
| 29 | Connections | 🟨 Partial | MAL XML and Refract shortcuts verified; MyAnimeList XML entry added alongside profile services in Watch Settings, with cross-hub collection test pending CI. No OAuth implied. |
| 30 | Release testing | ⬜ Outstanding | Prior beta cfa9aa6 is superseded by corrections; refresh package and verify artifact; physical Windows acceptance open. |

Additional design acceptance: shared Interface sans-serif (Inter fallback), semibold catalogue headings, no standalone serif hero override. Font-load and computed-weight browser tests passed at `f21bf13`.

## From launch to hub

| Stage | Evidence at this revision | Acceptance criterion |
| --- | --- | --- |
| Launch | Native placement defaults to maximized and loads saved placement. | On Windows, open with fresh settings, restore, resize, quit and reopen at the chosen geometry. |
| Introduction | Addon-capable hosts initialize the first-boot dialog on addon setup. It overlays the media destination chooser. | From a fresh profile enter any media destination before choosing whether to configure streaming. |
| Profiles | Setup and Watch mount separate instances of StremioAddonSettings. Each initializes entered to false. | Carry the chosen local profile into Watch once. Keep explicit profile switching available. |
| Account login | Stremio connects, then reads candidates. Nuvio can select a remote profile using the connected flow. An expired or consumed flow can require starting again. A second network login on every successful import was not established. | Test one login per successful import, including a non-default Nuvio profile and recoverable manifest failures. |
| Import | Candidate selection, consent, Review selected addons and Import reviewed addons are separate interactions. | One explicit import after selecting sources. Show outcomes for each selection. |
| Capacity | Native and web source caps are now 128. This build passed web and Windows checks. | Import more than 16 mixed sources from a test account, restart, verify count and order, and exercise the 128 boundary. |
| Manifest compatibility | Dotted types are accepted. Deserialization, required fields, resources, catalogs and extras can all produce invalid-manifest. | Show a safe field or category for rejection. Cover real optional fields, declaration forms and configured manifests. |
| Import order | Existing candidates cannot be selected. Apply appends successful new entries. For local B and remote A,B,C, this yields B,A,C. | Match remote relative order, retain existing local identities/history, and define placement of local-only entries. Repeat import to verify stability. |
| Addon refresh | Review returns individual rejections. The saved review keeps successful rows only. | Retry a failed selection after transient failure without reauthenticating or reinstalling successes. |
| Hub navigation | Watch offers AIOStreams, Movies & TV, and Anime. Standalone home already renders media rows and a featured title. First boot still leads into configuration. | Verify both empty and populated profiles land on content and can reach account management deliberately. |

Source entry points: packages/web/src/app/desktop-landing/first-boot-appearance.tsx, packages/web/src/components/shell/stremio-account-import.tsx, packages/desktop/core/src/stremio/registry/accounts.rs and packages/desktop/app/src/placement.rs.

## From browsing to streams

| Stage | Evidence at this revision | Acceptance criterion |
| --- | --- | --- |
| Catalogue artwork | The parser accepts bounded public CDN paths, recognizes a public fallback embedded in some proxy URLs and supplies an IMDb poster URL where possible. | Exercise real provider art, failed image downloads and missing IMDb IDs. Keep private configuration out of renderer-visible URLs. |
| Catalogue loading | History runs first, then one absent shelf is scheduled after 180 ms through a shared busy gate. The featured area takes posters from loaded rows. | A slow shelf must allow other shelves and navigation to finish independently. Publish a successful first row immediately. |
| Search | The board renders per-catalog shelves. Per-page ID deduplication does not combine results across providers. | Rank exact title matches first, distinguish remakes and media types, retain provider provenance behind merged matches. |
| Title identity | Metadata lookup tries the exact ID, with a conditional MAL-to-Kitsu mapping. There is no general IMDb/TMDB reconciliation here. | Resolve verified identity pairs and preserve original IDs for provider requests. Leave ambiguous matches separate. |
| Title details | Native metadata exposes name, description and videos. The UI uses a catalogue poster. A live Cinemeta movie response included background, rating, cast and director. | Show validated available detail fields and usable partial details when a provider omits them. |
| Seasons | Native video records retain season and episode. The UI repeats a flat select and an ungrouped card grid. | Select a season, including season zero, with an accessible choice for unnumbered videos. |
| Episodes | readMetadata clears details and video ID before awaiting the provider. A failure or empty list can erase a successful selection. The parser only reads episode title from the title field. | Retain good metadata on failure or partial response, accept name as a fallback, and preserve exact episode identity. |
| Play action | Opening a content title with one chosen video immediately fetches streams. Selecting an episode fetches its streams. There is no separate movie Play step in the detail hero. | Opening details stays on details. Movie Play or explicit episode selection initiates the configured selection mode. |
| Stream aggregation | Native registry queries every enabled source declaring support for the supplied type and exact video ID in batches of eight. An equivalent ID in another namespace can be missed. | Exercise resource-specific prefixes and multiple IDs with ordered results and no requests to disabled sources. |
| Stream presentation | Shared VersionFrame renders addon name, option label, transport and Play/Resume. Native summary chooses name before title, which can hide quality when supplied separately. | Preserve safe quality text separately and retain a working Play action on each supported card. |
| Source dropdown | AddonVersionList renders every group with a heading. No source filter or count is exposed. | All sources and per-addon counts work in title and in-player selectors. Filtering must preserve native option indices. |
| Source failures | The selector distinguishes empty groups, provider failures and unsupported transport. Ineligible providers disappear before rendering. Refresh repeats the whole lookup. | Distinguish incompatible ID, empty, failed and playable. Retry one provider without invalidating choices from other providers. |

Source entry points: packages/web/src/components/shell/watch-catalogue-board.tsx, packages/web/src/components/shell/stremio-addon-settings.tsx, packages/web/src/features/versions/addon-versions.tsx, packages/desktop/core/src/stremio/items.rs and packages/desktop/core/src/stremio/registry.rs.

## Playback, Anime and release

| Stage | Evidence at this revision | Acceptance criterion |
| --- | --- | --- |
| Autoplay | The shared autoPlayFirst setting chooses the first supported result in source order. Failed grant preparation leaves manual selection. | Exercise on/off and grant failure with real providers. |
| Playback | Standalone reuses the shared player and native grant adapter. Supported stream transport here is direct HTTPS. | On Windows play a permitted real stream, seek, switch tracks/subtitles, use fullscreen and verify controls against actual media capabilities. |
| Source switching | Browser fixture checks a new grant at 45 seconds. Same-video switches retain the viewing ID. | Switch sources during playback, verify actual media clock and the exact episode after the switch. |
| Returning | Watch keeps the browsing subtree mounted and inert during playback. Closing clears viewing state. Changed episodes, scroll and keyboard focus need verification. | From a scrolled shelf, play an episode, move to the next episode, exit and inspect title, selected episode, scroll and focus. |
| Anime discovery | Public discovery and imported-title cover lookup still call api.jikan.moe. The maintainer discontinued the public API on 1 October. A top-anime request returned HTTP 503 during this audit. | Replace both paths, verify seasonal and search results live and handle unavailable artwork. |
| Anime playback | Conditional title-level MAL-to-Kitsu lookup requires compatible metadata and exact returned video IDs. Other provider namespaces and episode correspondence remain open. | Test a special and a regular episode against providers using different namespaces. Avoid inferring episode identity from display position. |
| Connections | Anime exposes MAL XML import, while onboarding points users through profile setup. XML import and an authenticated account connection are distinct capabilities. | Surface supported anime imports and connections alongside other profile services and label their actual behavior. |
| Release testing | Current web and windows-check jobs succeeded. Package job skipped. Existing browser assertions cover mock grants and narrow-screen geometry. | Use realistic mixed-provider fixtures plus account and Windows runs. Record application SHA, provider outcome, observed controls and return state before acceptance. |

## Live observations and release priorities

- Cinemeta's public manifest and movie metadata for tt0133093 returned HTTP 200. Series metadata for tt0944947 returned 128 video records. All 128 used name, season and episode. None provided title. The current parser therefore substitutes season/episode labels even though the provider supplied names.
- The public Kitsu addon manifest and metadata requests and the Cinemeta top movie catalogue request returned HTTP 403 from this environment. Those responses establish no provider-wide outage. The successful metadata reads exercise the upstream payload only.
- **P0 for public anime discovery:** replace the discontinued service and verify the resulting feeds. **P1 for episode selection:** preserve previous successful metadata and test both live-shaped episode names and partial/error responses.
- **P1 for onboarding/import:** destination first, retain profile, one explicit import, ordered merge and retry of failures. **P1 for source selection:** verified identities, distinct outcomes and selectable providers. **P2 for browsing:** concurrent shelves, merged search and richer title presentation.
- The UI uses named controls, a labeled native first-boot dialog, shared theme tokens and an inert background during playback. The shared busy flag disables search and unrelated controls during shelf reads. Up to 2,048 videos can appear twice in the detail DOM. Inspect keyboard focus on return, zoomed layouts and long-season navigation in Windows WebView2 before assigning visual or accessibility sign-off.

[Windows CI run](https://github.com/G1NYU/TSUGI/actions/runs/46002993854) · [Stremio protocol](https://stremio.github.io/stremio-addon-sdk/protocol.html) · [RE-Harbor](https://github.com/G1NYU/RE-Harbor) · [NuvioDesktop](https://github.com/NuvioMedia/NuvioDesktop) · [Jikan discontinuation](https://github.com/jikan-me/jikan-rest/issues/613)
