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
