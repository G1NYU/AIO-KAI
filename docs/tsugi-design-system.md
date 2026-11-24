# Tsugi / Sumi

Design direction: Japanese editorial minimalism, quiet surfaces and strong typography. The name Sumi (ink) is a palette, not a new product or a separate theme engine.

## Foundation

- Canvas #101214, surface #171A1D, panel #202428, line #363C41, paper text #E8E6DF, secondary text #A3ABB0, ice focus/accent #A8D3E5.
- Sumi is the default for fresh preferences; previously saved palette IDs remain unchanged. Other palettes and imported appearance are still available.
- Focus is icy blue even when Mocha or an imported purple palette is active. Input focus is not a content accent.
- Desktop text: Segoe UI Variable with local fallbacks, consistent heading/display stack. No external font downloads.
- Use 0–2px radii on forms, navigation and settings; preserve circular media controls, avatars and the native player surface. Avoid card shells around empty space.
- Preserve the existing brush mark and use the new filled film, waveform and open-book glyphs for media destinations.
- Launcher: typographic identity plus indexed, full-width media destinations, keyboard focus, responsive layout. No network art or animation dependency.
- Movie onboarding: centered identity above unboxed form; shared canvas, visible category navigation and app settings even before server configuration.
- Music and Read retain their working layouts, media engines and focus behavior; share typography, category glyphs and square controls. Signed-in video exposes All media.

## References

Pley grouped libraries and destination navigation: https://github.com/pley-media-server/pley/blob/main/apps/web/src/components/Sidebar.tsx (reference only; no source copied).
Seanime CSS tokens and consistent media shell: https://github.com/5rahim/seanime (seanime-web/src/app/globals.css).
User's Windows screenshot of the inherited video onboarding form.

## Acceptance

Browser checks compare actual computed styles, logo centering, keyboard-visible focus after palette changes, category navigation and previously existing reading/music regression flows. Actual signed-in video home/settings visual review, Windows native frame, modal focus and real YouTube continuity remain required. Do not equate browser smoke with Windows visual QA.

Run 45441655423 passed Windows check, TypeScript and lint, then failed two outdated unit assertions (old default/count of palettes and exact quote style in explicit Read translation ID). Update expected palette set to six, preserve the old names and human-readable translation guard. Add optional real browser screenshots from the synthetic smoke fixture as a short-lived source-only CI artifact (launcher, onboarding, library, details, reader, music; no accounts or external media). No Windows packaging trigger. Visual QA remains pending.
