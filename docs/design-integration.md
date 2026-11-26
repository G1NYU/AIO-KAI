# TSUGI desktop design integration

The supplied design packs shape TSUGI's existing **Read**, **Books**, **Music** and **Vault** spaces. They share one application and navigation rail. Their illustrations and editorial layouts sit over the existing readers, audio engines and download manager.

**YOMI, OTO and KURA are placeholder names for the reference packs, not product or section names.** YOMI supplies the Read/Books reference, OTO the Music reference, and KURA the Vault reference. The application brand remains **TSUGI**; user-facing navigation keeps **Read**, **Books**, **Music** and **Vault**. Internal CSS, asset and filename labels may retain the pack names without displaying them.

The **Windows x64 portable test ZIP is available** at [`0c277fc`](https://github.com/G1NYU/TSUGI/actions/runs/45813841951/artifacts/15114279276). Its [Windows build](https://github.com/G1NYU/TSUGI/actions/runs/45813841951), assembled-package checks and downloaded-archive verification passed. Exact checksums and verification results are recorded in [PROGRESS.md](../PROGRESS.md). The package records its source revision in `BUILD-INFO.json`; physical Windows acceptance is separate from automated verification.

## Design and data

The shared stylesheet and bundled design assets are derived from the user-provided reference packs. **Interface** is the everyday UI font; **Amanojaku** is reserved for feature headlines. The established TSUGI signature and mark remain the application brand. Japanese lettering uses the supplied Japanese font. Ordinary headings, controls and operational information remain readable sans-serif text. Navigation and controls use the established Brush/Tsugi vector icon system rather than icon images copied from a prototype.

The default Sumi palette uses graphite surfaces, warm white text and coral (`#F17960`). Existing saved palette and accent choices remain respected. Spacing, surface tones and rounded groups separate content without decorative divider lines. Focus outlines, progress bars and transfer charts remain functional indicators.

Shared `LandscapeDecoration` uses the existing Kitsu landscape catalogue and Nekos safe landscape image API in Read/Books library, series and editorial banners, Music Discover and library overview, and the Vault hero. External illustrations are enabled by default, as before the redesign; the saved global local-only opt-out remains respected. Bundled artwork appears immediately and provides the offline/error fallback. Candidate fetching and pending image fallback run only for active, visible decorations. Already decoded artwork is retained across navigation and scrolling. The 20-second rotation pauses when the decoration is offscreen, the document is hidden or reduced motion is enabled.

Covers, titles, source results, progress, transfer statistics and file metadata come from actual application data. Missing covers use neutral fallbacks. Decorative artwork remains separate from a title's actual cover and does not imply a catalogue entry. The mockups' fictional catalogues, ratings, activity totals and notes are not production data. Controlled-provider browser checks passed for image recovery, shared local-only choice, rotation and visibility lifecycle; these checks do not verify live artwork API availability.

## Supported spaces

| Space | Existing flows presented by the redesign |
| --- | --- |
| **Read and Books** | Manga library and continuation shelves; categories; installed sources, extension management and global search; manually refreshed source Feed; series metadata and chapter catalogues; reading history and chapter updates; download queue and recovery feedback; source, reader and tracker settings. The manga reader keeps its scroll/single/spread modes, direction, focus controls, bookmarks and saved page progress. Reviewed local CBZ import keeps its validation, duplicate handling and explicit apply step. **Books** imports local EPUB/PDF files, offers format and sort controls, and opens the existing isolated ebook renderer with its supported reading controls. |
| **Music** | Discover and source search; library, saved tracks, recently played items and playlists; local files and remembered folders; connected music sources; existing playback, queue and player settings. The redesigned sound-profile presentation reflects the existing three-band profiles and their engine availability. Music controls remain available during manga reading. |
| **Vault** | Single-link and batch intake into the Windows download queue; active, waiting and completed views; audio/book filters; supported queue actions, concurrency, rate limits and destination controls; completed audio handoff to Music and reviewed EPUB/PDF import into Books. TorBox connection and explicit submissions retain their separate cloud status. The optional custom-location direct-file saver keeps its existing browser-access and format limits. |

Controls retain their loading, empty, unavailable, partial and error states. A source or service connection is required where the underlying flow requires one; artwork does not imply that a catalogue, transfer or account is available.

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
