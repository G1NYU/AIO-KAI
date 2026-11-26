# Measured music-player visuals

## User controls

Player settings → Audio-reactive visuals has the reactive seek-bar toggle (on by default) and optional listening mascot (off, built-in listening spirit or custom image). Import PNG, WebP or GIF up to 4 MiB and 1024 × 1024 pixels. The app checks raster signatures and dimensions before the browser decode, verifies decoded dimensions, makes a still PNG poster at up to 256 px and saves original/poster together in one local IndexedDB record. Invalid import preserves the existing asset; removal explicitly deletes it. Settings and asset persist locally; no upload, account linkage or network image fetch. They are not added to the portable backup schema at this checkpoint.

## Playback and rendering

One sampler uses the existing Web Audio analyser PCM RMS or fresh native RMS at up to 24 fps. Native values are clamped and expire after 650 ms. No guessed signal, fabricated spectrum, timed dot-flow or second audio graph. The amplitude changes only the decorative played ribbon and mascot transform; the accessible range, queue, transport and layout geometry are unchanged. The custom original image is displayed while a measured level exceeds the silence threshold; static poster is used otherwise. GIF/WebP frame timing itself is the supplied animation, not reconstructed PCM.

Paused, loading, error, hidden/inactive, reduced-motion, stale-native-meter and direct-only streams stay still. CORS-opaque Eclipse streams retain their existing direct audio fallback. Imported Studio expanded layouts remain unchanged; the native mini-player still supports the same controls.

## Regression gates

`music-reactivity.test.ts` checks default/validated settings, bounded and stale native meter values, PCM RMS and PNG/WebP/GIF header bounds. The new real-browser fixture plays an original generated local WAV, imports a generated two-frame GIF, verifies invalid replacement refusal, pause, reduced motion, navigation to Read without interrupting audio, persisted image reload, isolated fresh/stale native meter and removal. The pre-existing audio fixture explicitly disables new seek motion to retain the intentional first-graph-on-expand and direct-fallback checks.

These checks are wired into unified CI. The reconstructed implementation has not yet passed the cumulative production gate; no actual provider speed, decoder or visual acceptance claim is made.
