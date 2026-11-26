# TSUGI desktop design integration

The supplied design packs shape TSUGI's existing **Read**, **Books**, **Music** and **Vault** spaces. They share one application and navigation rail. Their illustrations and editorial layouts sit over the existing readers, audio engines and download manager.

**YOMI, OTO and KURA are placeholder names for the reference packs, not product or section names.** YOMI supplies the Read/Books reference, OTO the Music reference, and KURA the Vault reference. The application brand remains **TSUGI**; user-facing navigation keeps **Read**, **Books**, **Music** and **Vault**. Internal CSS, asset and filename labels may retain the pack names without displaying them.

The **Windows x64 portable test ZIP is available** at [`0c277fc`](https://github.com/G1NYU/TSUGI/actions/runs/45813841951/artifacts/15114279276). Its [Windows build](https://github.com/G1NYU/TSUGI/actions/runs/45813841951), assembled-package checks and downloaded-archive verification passed. Exact checksums and verification results are recorded in [PROGRESS.md](../PROGRESS.md). The package records its source revision in `BUILD-INFO.json`; physical Windows acceptance is separate from automated verification.

## Design and data

The shared stylesheet and bundled design assets are derived from the user-provided reference packs. **Interface** is the everyday UI font; **Amanojaku** is reserved for feature headlines. The established TSUGI signature and mark remain the application brand. Japanese lettering uses the supplied Japanese font. Ordinary headings, controls and operational information remain readable sans-serif text. Navigation and controls use the established Brush/Tsugi vector icon system rather than icon images copied from a prototype.

The default Sumi palette uses graphite surfaces, warm white text and coral (`#F17960`). Existing saved palette and accent choices remain respected. Spacing, surface tones and rounded groups separate content without decorative divider lines. Focus outlines, progress bars and transfer charts remain functional indicators.

In the current local follow-up, Music Discover uses its actual featured item's artwork, and the Library selects current, recent, saved or local music artwork. Both use a neutral background when no image is available. Music no longer mounts `LandscapeDecoration`, requests anime artwork or offers illustration controls.

Read/Books library, series and editorial banners and the Vault hero retain `LandscapeDecoration` with the existing Kitsu landscape catalogue, Nekos safe landscape image API and bundled illustrations. External illustrations remain enabled by default and the saved global local-only opt-out is respected. A shared shuffled pool avoids immediate repeats across navigation; rotation advances every twelve visible seconds. Candidate fetching and pending image fallback run only for active, visible decorations. Already decoded artwork is retained across navigation and scrolling; rotation pauses offscreen, in hidden documents and for reduced motion. These changes are not yet in the published ZIP linked above.

Covers, titles, source results, progress, transfer statistics and file metadata come from actual application data. Missing covers use neutral fallbacks. Decorative artwork remains separate from a title's actual cover and does not imply a catalogue entry. The mockups' fictional catalogues, ratings, activity totals and notes are not production data. Controlled-provider browser checks passed for image recovery, shared local-only choice, rotation and visibility lifecycle; these checks do not verify live artwork API availability.

## Supported spaces

| Space | Existing flows presented by the redesign |
| --- | --- |
| **Read and Books** | Manga library and continuation shelves; categories; installed sources, extension management and global search; manually refreshed source Feed; series metadata and chapter catalogues; reading history and chapter updates; download queue and recovery feedback; source, reader and tracker settings. The manga reader keeps its scroll/single/spread modes, direction, focus controls, bookmarks and saved page progress. Reviewed local CBZ import keeps its validation, duplicate handling and explicit apply step. **Books** imports local EPUB/PDF files, offers format and sort controls, and opens the existing isolated ebook renderer with its supported reading controls. |
| **Music** | Discover and source search; library, saved tracks, recently played items and playlists; local files and remembered folders; connected music sources; existing playback, queue and player settings. The redesigned sound-profile presentation reflects the existing three-band profiles and their engine availability. Music controls remain available during manga reading. |
| **Vault** | Single-link and batch intake into the Windows download queue; active, waiting and completed views; audio/book filters; supported queue actions, concurrency, rate limits and destination controls; completed audio handoff to Music and reviewed EPUB/PDF import into Books. TorBox connection and explicit submissions retain their separate cloud status. The optional custom-location direct-file saver keeps its existing browser-access and format limits. |

Controls retain their loading, empty, unavailable, partial and error states. A source or service connection is required where the underlying flow requires one; artwork does not imply that a catalogue, transfer or account is available.

### Windows screenshot corrections

The user's 2026-11-26 Windows review supersedes the broad tonal shelf treatment. Artwork shelves and section headings sit on the page canvas; tonal striping remains on actual data rows and interactive controls. Music, Read and Vault share a sidebar whose background reaches the top window edge, while its controls retain drag-strip clearance. The bottom media switch has an inset on every side. Horizontal navigation uses equal-height controls, including the TSUGI identity.

Movies restores its established expandable sidebar and movie destination order. A labeled All media menu exposes Music, Read, Vault and global settings. Home, hero copy and page content use a consistent gutter; Settings has a bounded content column. The disconnected server form is centered without a sideways offset or oversized decorative wordmark. Vault's final service panel stretches to the main Downloads panel's bottom at desktop widths and returns to natural height when stacked. These corrections are a local follow-up to the published package above, not a newly delivered Windows build.

The expanded Music player uses bounded artwork and control columns with shared insets. Its ordinary and lyrics-mode titles, the Music heroes, Vault headline and Read/Books feature headings use measured brush-font bounds, including after cold desktop initialization and translated text changes. Responsive artwork selects a genuine larger image for the same track with decoded-image validation and fallback. Reader repositories use unframed rows and responsive form actions. The screenshot review also covers Library headings, collection headers, source/search/Feed groups and outer settings sections throughout the app.

The Reader's Sources introduction uses a smaller headline and compact copy spacing so source choices remain visible in a desktop window. It preserves measured glyph clearance and natural narrow-window wrapping; the Library's featured/resume layout retains its separate presentation.

[Windows screenshot acceptance](windows-ui-review.md) maps every supplied annotation and the written feedback to the implementation and its checks. [Lyrics timing](music-lyrics.md) documents the separate recording-selection and alignment repair: the display's catalogue duration cannot confirm synchronization, uncertain recordings start with plain lyrics, and explicit adjustments apply only to that recording during the app session.

Prototype-only notes/highlights workspaces, radio, a seven-band equalizer and cloud automation are outside this integration. Existing migration tools retain their documented scope; the visual changes do not provide complete Mihon migration or establish a YouTube playback/download repair.

## Start the portable Windows candidate

Download the [candidate artifact](https://github.com/G1NYU/TSUGI/actions/runs/45813841951/artifacts/15114279276), which contains `Tsugi-windows-x64-test.zip`:

1. Extract the **complete ZIP into a new writable folder**. Keep an existing working installation and its data separate.
2. Keep the `.portable` marker and all companion files in their extracted locations.
3. Run `current/Tsugi.exe` directly. This is a portable application, not an installer.
4. On the first manga visit, choose **Read → Set up reading**. TSUGI downloads and verifies the pinned reading runtime from upstream. This setup needs internet access; no separate Java installation or CMD launcher is required.
5. Open Books for local EPUB/PDF import, Music for source or local-audio setup, and Vault for supported Windows transfers.

Portable data lives beside `current/`. Keep original media files separately: the existing metadata backup flows do not turn the redesigned libraries into full-media backups.

## Implementation locations

| Responsibility | Files |
| --- | --- |
| Shared typography, rail and landscape decoration | `packages/web/src/design-system.css`, `packages/web/src/components/shell/tsugi-rail.tsx`, `packages/web/src/components/landscape-decoration.tsx`, `landscape-decoration.css`, `landscape-spotlight.tsx` |
| Saved palette and accent behavior | `packages/web/src/lib/music/player-theme.ts`, `packages/web/src/components/shell/global-settings.tsx` |
| Read and Books presentation | `packages/web/src/app/read/yomi.css`, `yomi-banner.tsx`, and the existing Read/Books components in that directory |
| Music presentation | `packages/web/src/app/music/oto.css` and the existing Music components in that directory |
| Vault presentation | `packages/web/src/app/vault/kura.css` and the existing Vault components in that directory |
| Bundled illustrations and fonts | `packages/web/public/design/`, `packages/web/src/assets/design/` |
| Portable assembly and startup instructions | `.github/workflows/tsugi-unified-windows.yml` |
