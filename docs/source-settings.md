# Supported source settings

Reader → Browse → Sources shows a separate **Settings** action for configurable sources. Opening it explicitly loads the installed extension's preference screen. Browsing, filtering, opening Feed and restoring TSUGI preferences do not preload source settings. Opening the catalogue remains a separate action.

## Supported controls

The first editor supports **switches, checkboxes and single-choice lists**. Hidden controls stay hidden. Disabled, keyless, malformed or unsupported controls cannot be changed. Text entry and multi-select controls are not editable in this slice. The engine does not identify password fields, so text values, text defaults and summaries are not requested or sent to the web interface.

Choose one setting, select **Review change**, then **Apply change**. The review shows its previous and proposed display values; the native confirmation identifies the source, extension and exact choice. Cancel change only discards the local draft. The editor does not offer Reset: upstream does not reliably distinguish an inherited default from an explicit saved override.

Reader restarts during an accepted change to verify persistence. Close manga chapters first and wait for downloads or library updates to stop. Automatic Reader download/update schedules must be paused before restart-sensitive writes. These conditions are checked again natively before mutation.

After applied, cancelled, rolled-back or uncertain results, use **Reload settings** to inspect the current state and obtain a new review. Apply does not automatically execute the extension's preference screen again. A failed reload removes stale controls. Closing requests cancellation of the displayed review and discards the local draft.

## Native identity and privacy

The bridge carries opaque review/control identifiers and either a Boolean or zero-based option index. Preference keys, original positions and underlying list values remain native. The complete original screen order is retained privately, including hidden and unsupported entries; filtering the visible controls never renumbers the engine mutation target.

Reviews expire after ten minutes and are single-use. They are bound to the source ID, runtime process, owning extension/version/artifact, full reviewed definitions and prior values, and private settings-file fingerprints. Changed values, reordered controls, changed code or an expired review require a fresh load. Boolean false remains a real value; null and omission are not substitutes for it.

Preview is limited to 100 raw controls and 64 choices per list, with 200-character titles and choice labels. Source IDs remain exact signed 64-bit strings. Source settings are not stored in WebView local storage or added to portable backup exports. Their device-local recovery copy stays under the existing private Reader checkpoint directory and may contain credentials.

## Persistence and recovery

Before writing, native code verifies the current review and idle state, stops the engine under its exclusive storage lock and creates a v2 checkpoint. After restart, it rechecks the source and exact screen before sending one typed positional mutation through the supported engine API.

The engine saves before calling an extension listener, and its normal preference write is asynchronous. A successful response therefore does not establish durable success; a listener error can occur after data has already changed. TSUGI waits for persisted state, restarts Reader and verifies again before accepting the checkpoint.

A bounded native-only Java verifier compares the target source XML semantically: exactly the selected key has the expected value and every other key is unchanged. It parses the standard properties format with external DTD/entity/schema/network access disabled. Raw keys and expected values travel through private stdin; output is a single verification byte. Native checks also compare every other settings path, refuse new unrelated files, enforce private ownership/permissions and reject reparse points. Settings inspection is bounded to 2,000 entries, 1 MiB per file and 16 MiB total.

The transaction also checks source/extension identity and saved Reader state. A failed or uncertain mutation stops the engine and restores the checkpoint. A rolled-back result is reported only after restoration, restart and verification. If recovery cannot be verified, Reader is stopped and reports an error. Trusted extension code still runs with the user's Windows permissions; this recovery mechanism is not a sandbox for arbitrary extension side effects outside the managed snapshot.

## Verification

The web component passed TypeScript, scoped ESLint and the focused browser helper. That helper checks explicit-only loading, StrictMode request reuse, sibling Settings keyboard activation, all three supported controls, cancellation, opaque one-value payloads, explicit reload, stale reviews, verified rollback reporting, failed requests and wide/440px layouts.

Windows-target core and desktop test compilation passed. Five extracted production projection/bridge/fileset checks and eleven actual Java 21 verifier cases also passed, including standard properties output, unrelated-key preservation, new/duplicate keys and DTD/entity/size refusal. The Java checks found and corrected a buffered single-byte result by explicitly flushing stdout.

The dedicated authored fixture contains nine original rows with hidden, unsupported, disabled and keyless entries before the supported settings. Its Windows test checks actual false/list persistence, private text preservation, stale/reordered refusals, an ignored false listener return, a listener that writes before throwing, exact recovery, removal of a newly created settings file and saved reading state across restart. It also verifies the shipped Java helper against actual JVM-produced XML while stopped: only the exact property change is accepted; unrelated properties, added settings files and internal DTD declarations are rejected before restoring the original checkpoint.

Both gates passed at [de3cdd8](https://github.com/G1NYU/TSUGI/commit/de3cdd8f88cb39f6625ce86ab6df562e69fad3d6). [Unified Windows](https://github.com/G1NYU/TSUGI/actions/runs/45792614256) passed 104 native tests, 283 web tests in 27 suites, full typecheck/lint and the complete browser harness. [Reader runtime](https://github.com/G1NYU/TSUGI/actions/runs/45792614317) passed 39 focused broker tests, with the subprocess-only fixture ignored, and all nine packaged-runtime cases. The new source-settings marker confirms actual persistence, saved-state preservation and verified rollback of a listener that saved before throwing. The intentional listener GraphQL error is part of that passing recovery case. These automated results do not replace physical/live-provider acceptance. Packaging and release jobs were skipped.
