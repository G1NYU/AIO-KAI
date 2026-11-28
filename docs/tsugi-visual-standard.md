# TSUGI mandatory visual standard

**Maintainer directive — 2026-11-28. NON-NEGOTIABLE.**

This standard applies to every current and future TSUGI desktop UI change, screen, control, state, theme and build candidate. Visual quality and cohesion are hard release blockers alongside functional correctness, security and data preservation. A green build is not visual acceptance. Do not waive, dilute or defer this standard without an explicit maintainer decision.

## Governing references and precedence

- RE-Harbor, the supplied Harbor screenshots and streaming-flow HTML govern Watch/Movies & TV presentation and interaction: clean, flat, premium, cinematic, content-first, dense but readable. Inspect actual reference code and supplied designs; do not approximate with a generic interface or import Harbor branding.
- TSUGI retains its approved identity, original HTML mockups, annotated screenshots, artwork, brand and shared design system. YOMI, OTO and KURA are reference-pack placeholders, not user-facing product names.
- Latest explicit maintainer direction and this standard override conflicting historical design notes. Preserve approved content-specific layouts, theme choices, native security boundaries and working playback, data and navigation. Do not use functional differences to excuse visual drift. Document and obtain explicit approval for any proposed exception.

## Non-negotiable shared visual language

1. **Typography:** consistent loaded Interface sans-serif, type hierarchy, weights, sizes, line heights, tracking, labels and metadata across equivalent surfaces. Amanojaku/brush belongs only in approved brand assets and intentional editorial headings. No accidental Georgia, Times New Roman or other inappropriate fallback; no clipped glyphs or duplicate brand. Verify actual loaded/computed fonts, not merely declarations. Preserve script-specific accessibility fallbacks.
2. **Colors and materials:** shared semantic theme tokens for canvas, surfaces, text, accent, borders, focus and feedback; honor saved palette and accent preferences. Equivalent controls share hover, active, pressed, selected, disabled, focus and error treatments. No competing section palette, unnecessary gray panels, arbitrary boxes, or inconsistent radii/shadows. Maintain readable contrast.
3. **Rails and layout:** reuse the shared rail/shell for equivalent destinations, matching widths, spacing, alignment, brand, icon style, active states, gutters, media switching and native window clearance. Movies & TV uses clean flat filled icons; no rounded gray tiles behind icons or labels. Preserve working server-backed routes and their necessary functional navigation while harmonizing visual treatment. No overlap, clipping, obscured controls or unintended overflow at narrow, short, standard or wide sizes.
4. **Settings must look like the same product everywhere:** global App settings and every domain's settings, including Watch, Anime, Movies & TV, Music, Read, Books, Vault, player, accounts/addons, trackers, sources/extensions and nested dialogs. Match equivalent category navigation, headers, rows, labels, descriptions, typography, spacing, toggles, inputs, buttons, selects, sliders, tabs, status and feedback. Flat, unboxed, legible settings, with meaningful control boundaries and tonal separation, not decorative cards or icon/label tiles. Domain-specific content may differ; shared control styling may not. Use shared components and tokens, not copied competing implementations.
5. **Every other element:** consistent buttons, pills, inputs, search, tabs, filters, dropdowns, tooltips, menus, context actions, cards, shelves, lists/tables, badges, progress, notifications, dialogs, overlays, focus rings, artwork frames and motion. Preserve accessible labels, keyboard reach, focus, reduced motion, back/dismissal and responsive scrolling. No inert mockup controls, fabricated data, decorative clutter, redundant labels or unrelated placeholder artwork.

## Harbor-style Watch journey

- While typing Family Guy, show a polished top match with actual artwork/metadata, distinct Series row first and Movies row second, useful related matches and descriptions. Keep the search overlay clean, grouped and accurate; no random mixed grid or raw troubleshooting clutter.
- Movie/series details open a large title-specific cinematic hero, correct logo/artwork, relevant metadata and synopsis, with real Play/Resume, Favorite and Queue actions.
- Series show readable flat season/episode rows with actual stills, episode title, synopsis, progress and other available metadata. No generic provider diagnostics in consumer details.
- Selecting an exact movie/episode opens a dedicated full-width Harbor-style selector quickly: relevant backdrop, clear back/refresh, ordered providers and icons, readable stream labels, useful filters, no redundant quality labels. Fast results remain selectable while other providers load. In-player versions share the same design language and retain exact identity and playback position.
- Anime Hub, Continue Watching, Favorites and Queue use the same TSUGI vocabulary and real title/episode-specific artwork. Avoid blank poster floods; fallback imagery remains tied to the same identity.
- Keep illustrated Welcome and personalization, distinct minimalist returning Home/profile artwork, and the approved Music, Read/Books and Vault designs. Replace duplicate placeholder artwork with distinct fitting assets. Do not invent unrelated designs.

## Mandatory whole-application visual audit

Enumerate actual routes, entry paths, nested sections, states and shared elements from source/navigation. Review every visual element, not only selected screenshots. Group equivalent instances only after checking shared rendering, local overrides and affected consumers.

Coverage must include:

| Surface | Required review |
| --- | --- |
| First run and Home | Splash, native chrome, illustrated Welcome, personalization, mandatory connections, profile picker/switching, returning Home and upgrade |
| Movies & TV / Watch | Standalone and AIOStreams/Jellyfin paths, hubs, discovery, search, results, details, episodes, selector, player/versions, favorites, queue, resume, Anime Hub, addon/account flows |
| Music | Discover, search, library, albums, tracks, playlists, local/provider sources, queues, mini/expanded players, lyrics, audio settings |
| Read / Books | Library, sources/extensions, repositories, feed, search, trackers, migration, details, manga/ebook readers, downloads, progress and controls |
| Vault | Intake, transfers and queue, import/review, service controls, progress, errors and storage |
| Settings | Global and every local category, nested controls, connection forms, profiles, import/export, backup/restore, support, credits, updater |
| Shared UI | Rails, window controls, headers, icons, typography, controls, cards, rows, menus, overlays, tooltips, dialogs, status and all applicable variants |

For each surface record the route/entry, reference, exact source SHA, theme, window size/scaling, state, rendered screenshot or interaction evidence, finding, repair commit and verification status. Include populated, loading, empty, partial, unavailable, error, selected, disabled, hover and keyboard-focus states where applicable. Exercise narrow, short, standard and wide windows and supported themes; verify native Windows frame/DPI in the actual app. Compare equivalent settings and controls side by side across every section. Inspect actual font and image loading and computed styles, and exercise distinct navigation/overlay patterns.

For each defect, repair the responsible shared component/token/asset or incorrect local override, recheck its consumers and adjacent routes, capture comparable evidence, and run relevant regression/build checks. Repeat until every required surface and state is accounted for. Record inaccessible references and unvisited/device-dependent states as open. Maintain a repository audit ledger with evidence links and explicit outstanding items. Synthetic previews establish fixture behavior only, not real artwork coverage, authenticated playback or actual Windows visual quality.

## Acceptance and packaging

- Functional correctness, P0–P5, visual inventory, cross-section cohesion (especially settings), Harbor fidelity and actual Windows/artwork acceptance must all pass. Existing performance, live-device, security and data-preservation requirements remain mandatory.
- No knowingly visually deficient candidate may be packaged or represented as accepted. Follow the existing P0–P5 packaging gate. No stable publication without explicit maintainer release approval. Preserve the working stable release.
- Record verified evidence and open criteria in HANDOFF.md, PROGRESS.md and the active roadmap. Never convert CI success or a partial screenshot review into complete visual sign-off.
- All future agents must read this standard before UI work or release-readiness decisions. Continue authorized audit and repair work without requiring routine check-ins. These requirements survive chat interruptions and handoffs.
