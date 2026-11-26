# Source metadata and visibility filters

Reader → Browse → Sources now uses the complete bounded native inventory, rather than the first 100 loaded sources. Each row identifies the source language, declared content label, Latest capability and configurable-source capability. When available, it also shows the owning extension, actual installed version, package identifier and update/obsolete state. Selecting the source still opens its normal catalogue.

## Sources

Text, language and content filters combine. Text matches the source name, display name, source ID or owning extension name/package. Language matching is exact: **Multilingual** selects the `all` language code; **All languages** imposes no language restriction. The options include every language in the loaded inventory, preserving unfamiliar codes instead of dropping those sources.

Source filters operate locally over the complete loaded inventory. Changing them does not request provider catalogues or reload metadata. The count describes matching loaded sources, not every raw database record. A source the engine cannot load may be absent even though the native scan is complete. **Reload installed sources** explicitly refreshes metadata. An incomplete or failed inventory is reported and does not leave stale source rows active.

The inventory remains bounded to 1,000 raw database rows and two matching complete passes. Exact signed 64-bit IDs stay strings throughout. Source metadata reads do not fetch extension preference definitions or invoke a configuration screen.

## Extensions

Search, repository, language, installation status and content conditions combine in the pinned engine **before** its 100-row page limit and total count. The native adapter orders by package identifier, so adjacent pages have stable ordering while the underlying repository state is unchanged.

Status choices are **All extensions**, **Installed**, **Available**, **Updates available** and **Obsolete**. Updates and Obsolete restrict results to installed extensions. Obsolete entries keep their installed state visible and have no update action or available-update badge, even when the engine retains an old update flag.

The matching count follows the selected filters. The update count explicitly describes eligible updates **on this page**. Changing filters restarts at the first page and clears the previous update selection. A failed request clears stale rows and leaves a visible error; Search retries the selected filters. An accepted install/uninstall followed by a failed list refresh also exposes the refresh error at page level.

Installed entries display the actual **Installed version**. Uninstalled repository entries display their **Available version**. An installed entry's update badge does not imply that its displayed version is the candidate version; the existing native update review identifies the exact candidate before applying it. **Current repository** means the repository currently associated with the catalogue record, not independent proof of installed-code provenance.

## Content labels

| Engine value | Display label | Meaning |
|---|---|---|
| `SAFE` | Not flagged | No warning in the engine's current metadata. The pinned importer also maps unspecified metadata to this value. |
| `MIXED` | Mixed content | The extension declares mixed content. |
| `NSFW` | 18+ content | The extension declares adult content. |
| Missing or unrecognized UI metadata | Unknown | No supported classification is available to display. |

These are source/extension declarations, not per-title ratings or a guarantee of suitability. All content is the default. Unknown UI metadata stays visible under All and is excluded from an explicit classification filter. Native responses must contain a valid pinned enum; malformed engine metadata causes a reported error. The original missing-vs-declared-SAFE distinction cannot be reconstructed after upstream normalization.

Filters stay in memory while Reader is mounted and reset to All after an app reload. They affect their Sources or Extensions list only; they do not remove library titles or change Feed selections, global search, saved progress or downloaded media. They are not parental controls.

## Verification and remaining scope

Local validation passed 13 native production-helper/bridge tests, Windows-target app/core test compilation, full web typecheck, scoped ESLint, six new metadata unit tests and the focused browser helper. Related Feed tests passed again. Browser coverage includes combined filters, exact IDs, pagination, unknown metadata, keyboard use, stale-result/error recovery and a 440px layout.

The separate authored runtime case provides a 125-entry repository, 120 matching English entries across two filtered pages and a 105-source installed factory. It checks real metadata, unspecified-rating normalization, update/obsolete transitions, saved reading state and restart without further executable downloads. Actual pinned-JAR compilation and Windows runtime execution remain the next CI gate for this slice; local stubs and cross-compilation do not establish that result.

This batch does not yet provide source-preference editing or a native source-icon loader. The configurable-source label is metadata, not an enabled settings action. Those remain separate B1 work, alongside physical/live-provider acceptance.
