# TSUGI current development handoff

Updated: 2026-11-26. Repository: [G1NYU/TSUGI](https://github.com/G1NYU/TSUGI). Development branch: `feature/tsugi-read-runtime`. Stable `v0.1.0` is unchanged.

This focused handoff records the current candidate. The existing `PROGRESS.md` remains the published historical record; this update leaves that history unchanged.

## Source and publication

The candidate is a development portable ZIP. Stable release publication remains outside this candidate; its commit carries only the package marker.

- Full reviewed UI/YouTube/Mihon/Discord implementation: [`75d85da`](https://github.com/G1NYU/TSUGI/commit/75d85da5775784c3a2132edc26e86a4c2d649e9f), exact reviewed tree `42417bb9ab7a15e836008a2f94b33c25a0b84a49`.
- Windows repair: [`a0729e9`](https://github.com/G1NYU/TSUGI/commit/a0729e99bb5d3f263437ea67d57e9cfd8e476908), tree `9c855fba1245888d697b2448423c4850b5936443`.
- Final web-only cleanup removes four broad Junction/Nocturne control-wrapper background fills, preserving layout, typography, artwork backdrop and functional control surfaces. Its focused browser helper and production build pass. Its publication/package identity is recorded after the final run below.

The Git CLI has no configured write credentials. Publication uses the connected GitHub Git Data API: upload complete intended files, verify the resulting tree against the local reviewed tree, create a commit with the checked remote parent, and update the branch non-forcibly with an expected-head lease. Fetch again and confirm tree equality. API-created and local review commit IDs may differ; their verified source trees must be identical.

## Screenshot and written feedback scope

All sixteen uploaded filenames and the written feedback are mapped in [Windows UI acceptance](docs/windows-ui-review.md). Implemented corrections cover:

- Continuous sidebar tone to the window top, equal header controls, inset media selections and desktop Vault column alignment.
- Unframed artwork shelves and section headings throughout Music, Movies, Read, Books and Settings, including the final alternate-player wrapper cleanup.
- Restored Movies sidebar, All media navigation, aligned hero/catalogue content, bounded Settings and centred server setup.
- Genuine larger variants of the same music artwork with fallback; bounded player composition and measured brush-title clearance, including lyrics mode.
- Music-specific artwork or neutral fallbacks; no anime decoration/provider calls in Music. Read/Books and Vault use a shared shuffled sequence advancing every twelve visible seconds, respecting local-only, reduced-motion and inactive/offscreen behavior.
- Recording-aware lyrics selection using actual decoder duration and album information, unconfirmed video timing, and explicit per-recording line alignment with consistent highlighting/seek offsets.

Controlled browser results are not physical Windows acceptance. Exact-recording acoustic lyric alignment and every live provider image remain separate checks.

## Actual verification completed

| Check | Evidence |
| --- | --- |
| Full web suite, typecheck, lint, pinned ebooks and production build | [Unified web job at 75d85da](https://github.com/G1NYU/TSUGI/actions/runs/45841593243/job/139984389419): **376 tests in 35 files**, **57 browser checkpoints**, all successful. |
| Actual Windows native core | [Windows job at a0729e9](https://github.com/G1NYU/TSUGI/actions/runs/45844069713/job/139994499675): **150 passed, 0 failed, 17 intentionally ignored**. |
| Native media tools and executable | Same Windows job: bundled-media fixture explicitly invoked (**1 passed**), optimized application compilation, staging and upload all passed. |
| Actual pinned Reader runtime | [Reader run 45844069787](https://github.com/G1NYU/TSUGI/actions/runs/45844069787): **60 broker tests passed**, one helper ignored; **42 CBZ checks passed**; **12 packaged JVM cases passed**, none failed or ignored. |
| Vault engine | [Vault run 45844069930](https://github.com/G1NYU/TSUGI/actions/runs/45844069930): all nine scenario/probe checks plus aggregate success, no failed assertions. |
| Final player cleanup | Four focused real-component checkpoints passed: all three layouts, normal/short/narrow geometry, brush/lyrics clearance and actual original PCM waveform/playback/queue/seek/minimise. Junction and Nocturne captures visually inspected. Declared ebook preparation, Lingui extraction and standalone bundling passed through installed Node CLI entry points; the pnpm wrapper refuses the existing symlinked dependency directory. Generated locale changes were restored. |

The first Windows run exposed two new audio fixture failures. Their repair canonicalizes the pinned DLL path and uses a bounded, byte-preserving native subprocess producer with an explicit readiness handshake and cleanup guards. Tests still require exact file bytes before EOF, cancellation before producer shutdown, size limits and closed file handles. Both failures are cleared on actual Windows. No per-format Windows decode timings were printed on success; do not invent them.

The first Reader run exposed a real integration defect: pinned Suwayomi uses `pageCount=-1` for unknown chapters. The repair accepts only integer `-1..=i32::MAX`, maps the unknown sentinel to portable 0, and preserves the exact signed value inside native review/staleness/post-restore checks. Unknown counts cannot authorize partial-page restoration. The Windows Mihon case now verifies reconstruction, exact source identity, chapters/history/categories/local tracker references, repeat-import idempotence, stale review rejection and forced rollback across restart. The eleven previous runtime cases also pass.

Final web-only changes leave all desktop source identical to a0729e9. Reader and Vault path-filtered workflows therefore do not need another run solely for the CSS/test changes. The final Unified package must still complete its own web/native/build/assembled-package gates.

## Final package gate

Pending at this handoff checkpoint: publish the final visual cleanup, wait for its Unified workflow, download the actual artifact and verify its exact `BUILD-INFO.json`, every ZIP entry CRC, required bundled tools/source notices, five illustrations and five fonts. Record its actual commit/run/attempt, ZIP size/SHA-256, executable SHA-256 and artifact link. Do not deliver an older intermediate ZIP as the final candidate.

The package must pass `--check-vault-engine`, `--check-media-tools`, the pre-setup Reader probe, preparation/repeated preparation and authenticated pinned runtime checks. Remove the temporary test-installed Reader tools before packaging so the normal first-run setup remains applicable. Stable release publication must remain skipped.

## Remaining acceptance and next work

**YouTube is not marked fixed.** Controlled decoding proves progressive playback can start before complete transfer; one-pass export removes duplicated extraction/transfer work. Live access, first-audio/download timing, seeking, rapid switching/replay and optional Firefox recovery still need the affected Windows connection. No comparative speed claim against the reference projects is established.

Mihon supports the documented reconstruction fields; it does not import account credentials, source preferences, extension code, absent local media or reading durations. A user-approved physical backup import remains pending. Discord presence is implemented, default off and scoped by media/privacy settings; live acceptance requires a registered public TSUGI Application ID and a running Discord client.

Continue the reliability/recovery roadmap after candidate acceptance; see [ROADMAP.md](ROADMAP.md). D1 (Books/Manga YouTube AI-story catalogue) and D2 (TorBox cached music discovery exposed through an Eclipse JSON source) remain requested later work, not implemented features. Their existing investigation notes and API limitations remain in the roadmap.
