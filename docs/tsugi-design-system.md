# Tsugi desktop design system

## Current direction

Use typography, alignment and useful controls rather than decorative numbering, arrows, marketing copy or theme branding. The launcher contains a single Tsugi identity, a small 次 (next) and three direct media destinations. Japanese lettering is a restrained part of the brand, not a visual motif repeated throughout the interface.

- Shared dark canvas #101214, surface #171A1D, panel #202428, line #363C41, text #E8E6DF, secondary text #A3ABB0, ice focus/accent #A8D3E5.
- The fresh default is labeled Default in both settings surfaces. Retain the existing internal palette key for compatibility; no user-facing theme name or migration is needed. All other saved palettes remain available.
- Text-field focus is icy blue independently of the selected palette. Preserve visible keyboard focus.
- Consistent Segoe UI Variable text/display stack with local fallbacks; no font download. Use Japanese system font fallbacks for 次.
- Flat forms and navigation; preserve circular media controls, avatars, artwork behavior and native player surfaces.
- Shared filled film, waveform and open-book icons. No additional launcher glyphs unless they perform a function.
- Movie onboarding: centered identity above unboxed form; shared canvas and direct category navigation.
- Music and Read retain their working layouts, media engines and focus behavior. Signed-in video exposes All media.

## References

Publisher summaries: Kenya Hara, Designing Design and White (https://www.lars-mueller-publishers.com/designing-design and https://www.lars-mueller-publishers.com/white), on emptiness and restraint; Josef Müller-Brockmann, Grid systems in graphic design (https://niggli.ch/en/products/rastersysteme-fur-die-visuele-gestaltung), on alignment and grids.
Primary design guidance: Dieter Rams (https://www.vitsoe.com/eu/about/good-design); Apple typography and layout (https://developer.apple.com/design/human-interface-guidelines/typography and https://developer.apple.com/design/human-interface-guidelines/layout); W3C Japanese Text Layout (https://www.w3.org/TR/jlreq/).
Implementation references: Pley grouped destinations and Seanime shared tokens. No source copied.

## Acceptance

Browser checks validate exact launcher labels, one media icon per destination, Japanese brand lettering, centered movie setup, square controls and independent focus colors. Synthetic screenshots are uploaded by source-only CI. Actual signed-in video home/settings visual review, Windows native frame, modal focus and real YouTube continuity remain required. Do not equate browser smoke with Windows visual QA.

Shared media navigation now uses one component for movie entry, Music and Read (horizontal or rail). Keep the signed-in video shell's existing navigation layouts. Reading retains its chapter session when visiting Music, and focus mode hides the playback dock. Actual chapter and round-trip tests are added to the synthetic browser flow.

Candidate consistency pass: movie settings surfaces, header glyphs, detail actions and desktop menu controls now use the shared palette. Scope is limited to named controls; artwork behavior and playback are untouched. Actual global settings typography and radii are covered by browser assertions; signed-in movie visuals still need live-server acceptance.

Physical Windows feedback after 2eedac2: remove launcher 次, teal and cramped dashboard feel. Shared silver default and independent accent presets; neutral field focus. User-provided Harbor Modern mockup informs grid widths, stronger type and functional empty states. Read uses the same top category navigation as Music; local navigation stays in its rail. No fabricated artwork or dashboard cards. Expanded album artwork prefers a larger original provider asset with fallback; no changes to reading cover pipeline.

The content composition follows the supplied Harbor Modern picker: responsive art/metadata beside the main collection, clear primary action, and bounded image size. Music featured artwork is a square content image, not a background pattern. Browser test covers real detail-column positions and simulated CDN rejection of the larger image variant.

User requested a full header/music library redesign. Harbor Modern HTML uses purposeful layout columns, 15px body typography, compact aligned action groups and readable row boundaries. Translate these into centered media navigation with an actual brand, content-specific tools, collection rail and real local/recent/saved track views. Tauon, fooyin and Feishin are reference projects (no copied implementation). Use actual metadata only, preserve functional controls. No decorative underlines for category selection.

## Soft geometry and restrained motion — current direction

User-provided Caye/media screenshot supersedes the previous square-control target: use 6px small elements, 8px buttons and fields, 10px covers and artwork, 14px floating panels. Preserve unboxed forms, table rows, edge-to-edge player bar, circular play control and unmodified chapter images. Keep current icon glyphs and palettes; no teal requirement or additional branding. Use foreground rather than accent for media icon hover. Introduce an original quiet, monochrome dotted thread pattern on the launcher alone, a clipped CSS transform animation with no external assets or JS loop, respecting reduced motion. No animation during movie playback, music or reading. The supplied screenshot grounds the geometry; Awwwards Jimo text describes scroll-driven motion and Caye page text was accessible, but its animation could not be inspected from extracted text; Visuvate and Sokolovski references returned 403. Do not claim a visual reproduction of those sites. Browser tests replace old exact 2px assertions and verify launcher animation/reduced motion. Previous package 45514693776 remains unchanged; source validation before another package.

### Media-led discovery and reading

Discover uses the parent workspace title once, provider context and source controls, a compact actual-artwork feature and denser provider shelves. Missing music art uses theme-neutral placeholders. Reading shows only unfinished or unread-follow-up items in Continue reading, page progress from the last-read chapter index when known, and a count of loaded/filtered library results. Preserve existing source art, playback/reader actions and pagination. Browser fixture adds a real provider-shaped synthetic Discover shelf, never a network request to YouTube. Signed-in movie acceptance and physical Windows acceptance still pending.

### Windows acceptance corrections

User's actual Windows screenshots supersede the synthetic geometry review. Remove launcher dotted motion entirely. Use local installed Amanojaku for Tsugi wordmarks only, with clean sans-serif fallback; the provided demo is not bundled or published. Desktop boot HTML selects Tsugi mark/title before the first paint, keeping the existing other-host splash. Use outline Boxicons for music/read with matching outlined play rectangle; distinguish the All media icon from Home and global settings from video settings. Remove broad music root child width cap, align media navigation/search/discover/library to the window gutter, ensure source drawer/backdrop covers full viewport and has one clearly named source control. Empty video search is centered with existing history and browse shortcuts; typed search retains existing result navigation. Use real content, not filler. Wide 2560px browser checks for workspace and drawer.

Launcher refinement: the final annotated screenshot places the brush mark and Tsugi lettering together, centered above the viewport midpoint, with Movies & TV, Music and Read arranged in one equal-width horizontal row near the bottom. Keep settings top-right, no pattern or additional artwork. At narrow and short window sizes keep controls in bounds. Assert centering, raised wordmark and baseline at both 1440x900 and 2560x1440.

### Bundled signature

User confirmed the Amanojaku face is theirs. Render the exact Tsugi lettering from the supplied face as a bundled 432x285 transparent monochrome brand artwork (not an installable font), tinted by the active palette. Preserve accessible wordmark text. This supersedes the earlier local-font fallback design; launcher and navigation/auth wordmarks no longer require a system font. Body text is unchanged. Verify image decoding and launcher layout in the browser test.

### Finishing pass: listening and shared separators

Static two-row square pixel rules replace named horizontal workspace/collection separators, not interactive borders or reader pages. Selected accents tint active navigation and reading progress. Built-in players now use distinct native compositions: Default centered portrait, Junction split listening workspace, Nocturne cinematic artwork backdrop with low console; all share existing transport, queue and lyrics. Only imported layouts use Studio renderer. No new ambient dot fields. Intermediate exact-source 544px artwork retry before original thumbnail. Remove duplicate App settings movie rail entry; movie Settings > Theme retains global appearance controls. Brush icon, migration, history, updates, categories, batch import and further features remain subsequent work.

### Reader collection workspace

History, Chapter updates and Categories sit in the Collection rail. Compact chapter rows use existing source artwork and two-row separators. Categories use a management rail and title membership list, plus shelf filters on Library. Update progress uses the selected accent, with explicit engine status and a manual refresh action. Category deletion does not remove manga. No empty decorative panels beyond actionable empty states.

Migration and Batch Add use a compact form followed by result rows and explicit review. Do not automatically remove old titles or guess ambiguous chapters. Batch import never maps tracker IDs to source IDs. Existing artwork and playback paths remain unchanged.

### Unified desktop rail and identity

One compact 80px rail (58px at narrow widths) in normal desktop Movies sidebar, Music and Read. The shared media group uses the same brand mark and three destination buttons, followed by a double-row pixel break and section actions. Selected icons use the active accent and a subtle surface tint. Bottom preferences use the same dimensions; legacy TV/touch and alternate movie navigation modes are retained. Use bundled Inter for application UI and the existing Amanojaku signature artwork for branding. New 24px outline family with restrained filled directional wedges, and a more pronounced tapered brush mark with internal bristle cuts. Replace named structural lines with two rows of static square pixels; preserve control outlines and progress indicators.
