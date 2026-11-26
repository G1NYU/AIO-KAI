# Reader, Vault and diagnostics workflow additions

These independent B1, B4, C2 and C3 increments keep the existing media engines and can be carried into the forthcoming YOMI (Read), OTO (Music) and KURA (Vault) layouts. They do not close every requirement in those milestones.

## B1: source and extension icons

Sources and Extensions show an existing extracted/cached icon for a known extension package. Sources use their owning extension's icon. Missing or rejected artwork keeps the globe/grid fallback without blocking the row's catalogue, settings or extension actions.

The native adapter reads only the private Reader `extensions/icon` directory. It validates package identity through the engine, checks private paths and refuses redirected, ambiguous or temporary entries. Only static PNG, JPEG, GIF and WebP are accepted, with a 512 KiB file limit and 1024-pixel dimension limit. SVG and animation use the fallback.

Loading is lazy. A shared compressed cache is limited to 64 entries and 8 MiB, keyed by package and version/installation metadata. Object URLs are released when icons leave the viewport or unmount. Icons share the existing serialized native image transfer, with Reader pages retaining priority.

Uncached remote catalogue icons remain a separate limitation. The pinned upstream HTTP route downloads its cache entry without a byte limit before returning; this adapter does not invoke that route or contact a repository icon URL. It displays cached artwork only.

## B4: searchable Reader settings

Use **Search reader settings** in either global Reader settings or an open chapter. Search matches localized labels, choices, help text and section names across Pages, Appearance and Controls. All search words must match the same setting group; accented/composed text is normalized and matching ignores case.

Search and clearing do not change preferences or contact providers. Matching controls still work normally. Clearing restores the previously selected section. Choosing a section clears the search. Escape in a nonempty search clears it first; the next Escape retains the normal close-panel behavior. There is an explicit empty-results message.

Per-title overrides and configurable shortcuts remain separate B4 work.

## C2: reviewed Vault-to-Books import and retry

For a completed EPUB/PDF, **Import into Books** opens a review of its filename, size and Books destination. No file is read or imported until confirmation. Matching filenames are possible duplicates, not proof of identical content; **Import another copy** must be selected before proceeding. Confirmation rechecks the current library and requests another review if the duplicate set changed.

The result stays in Vault as **Imported**, with a separate **Open Books** action. Existing Books records identify the original Vault job, so reload shows **Already in Books** without rereading the downloaded file. Removing that saved Books copy allows another import when returning to Vault.

A missing, empty, oversized or invalid-header file, or a failed Books transaction, produces a per-job **Import failed** result and **Retry import**. Import checks the existing format header; full document decoding occurs when opening the book. Retry affects only that import; it does not restart, resume or add a download. Cancellation aborts an in-flight file read before storage begins. The final atomic Books save cannot be cancelled partway through. The existing 128 MiB completed-file limit remains.

Successful status derives from the existing Books records. Failure messages are session-local. Audio still uses **Open in Music**; automatic handoff, persistent audio-library import and CBZ handoff remain separate work.

## C3: safe support summary

App settings → Advanced → Diagnostics provides **Create support summary**, a read-only preview and **Copy support summary**. Creation is explicit and requests only native application version information. It does not request the existing full diagnostics/log endpoint, start Reader, enumerate downloads or test provider accounts.

The report contains a fixed allowlist: web commit/version, native platform/bridge protocol/version, available native app/mpv/FFmpeg version numbers, and declared capability flags. Unknown fields, device/account identifiers, settings, raw version descriptions, logs, paths, library titles and connection URLs are excluded. Version numbers and known prerelease labels are normalized; arbitrary build descriptions are omitted. Capability availability is not a connection-health result.

Copy sends exactly the displayed preview through the existing clipboard helper; there is no upload. Refresh clears the old preview. Failed native requests time out after ten seconds and produce a partial report without stale native versions. An absent native bridge remains supported as an unavailable state.

Full redacted crash/log export, presence, app lock and broader background controls remain separate C3 work.

## YouTube diagnostic correction

The reported sign-in/verification failure occurs in bundled yt-dlp stream resolution before mpv receives audio. The transport and waveform fixes do not prove this later failure is resolved. TSUGI currently makes anonymous requests and does not inherit a signed-in browser session.

The error classifier now uses the final yt-dlp error and distinguishes bot verification, age verification, sign-in, HTTP 403 and HTTP 429. Earlier warnings and incidental URL digits cannot replace the terminal cause. Only fixed messages are returned; raw provider output stays private.

This is a diagnostic repair, not verified restoration of playback on the affected connection. The bundled `2026.11.23` extractor is the current stable release checked for this batch, and the bundled JavaScript runtime meets the documented requirement. Upstream documents the separate [YouTube access restrictions](https://github.com/yt-dlp/yt-dlp/wiki/Extractors) and [JavaScript runtime requirements](https://github.com/yt-dlp/yt-dlp/wiki/EJS). No tool pin, authentication or cookie behavior was changed. Normal branch CI skips the opt-in live export probe, so its success does not establish live YouTube acceptance.

## Verification

Local full TypeScript, scoped lint and 20 focused unit/regression tests passed. The production YouTube resolver module passed six tests. Native icon compilation and parser/path checks passed. Focused actual-UI helpers cover icons and shared image transfers; search in global/chapter settings; Vault review, cancellation, independent retry and duplicate persistence; and exact allowlisted support preview/copy including timeout and unavailable states. Responsive screenshots were inspected.

The existing real-runtime metadata case now checks cached icons, missing/unknown/SVG/oversized refusal, no remote icon requests, unchanged reading state and restart. Actual Windows execution and the integrated browser gate are pending publication of this batch. Packaging and hands-on acceptance remain deferred.
