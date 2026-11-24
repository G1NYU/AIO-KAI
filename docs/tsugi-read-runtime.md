# Tsugi Read: embedded runtime acceptance

The Read environment is a native Tsugi frontend backed by a separately managed,
bundled Suwayomi server. The user must not install Java, Suwayomi, or a separate
reader. Use the existing desktop shell rather than replacing the application.

## Runtime proof

- Stable Suwayomi Server v2.4.2373 (MPL-2.0) and Azul Zulu JRE 25.0.5.1+2
  (GPL-2.0 with Classpath Exception) from the SHA-256-pinned official Windows
  distribution. Stage only its server JAR and complete JRE in original relative
  paths; do not launch or redistribute Electron or the launcher. Verify
  corresponding-source obligations before any public runtime redistribution.
- Smoke on Windows with isolated disposable data, no extension repositories,
  no user account, no external browser/tray window, and loopback-only binding.
- Authenticate the source GraphQL query and verify unauthenticated access is
  rejected. Verify version and terminate the process on success or failure.
- No Read launcher entry or shipping package change until the runtime smoke passes.

Sources: [stable server](https://github.com/Suwayomi/Suwayomi-Server/tree/v2.4.2373),
[configuration](https://github.com/Suwayomi/Suwayomi-Server/blob/v2.4.2373/docs/Configuring-Suwayomi%E2%80%90Server.md),
[GraphQL source query](https://github.com/Suwayomi/Suwayomi-Server/blob/v2.4.2373/server/src/main/kotlin/suwayomi/tachidesk/graphql/queries/SourceQuery.kt),
and [extension configuration](https://github.com/Suwayomi/Suwayomi-Server/blob/v2.4.2373/docs/Getting-Extensions.md).

## Integration acceptance

1. App-owned native process lifecycle and app-data root; private local port,
   authenticated native broker, fixed GraphQL operations, bounded replies.
2. Source management with explicitly user-added Mihon-compatible repos and
   explicit extension install/trust. No bundled untrusted extension.
3. Native Tsugi Browse/Search, manga details, chapters, and reader.
4. Library, resume position, chapter progress, source ownership and
   error/empty states. Verify local fixture chapter and real user-selected source.
5. Add Read to the launcher only when functional; theme integration, keyboard
   navigation and responsive layout, then regression-test Music and Video.

Installed extension code is third-party executable code, not just metadata.
A localhost bind is not a sandbox; user trust and restrictions on native bridge
operations are required. No arbitrary GraphQL, arbitrary native requests or
credential-bearing URLs passed to the webview. No claims of universal
Mihon/Komikku source compatibility; verify individual extension support.

The isolated smoke workflow is the first implementation milestone. It does
not yet integrate a reading UI or ship the runtime in the main Windows build.

## Startup investigation

Run 45372797968 established that the JVM does not bind to loopback and emits
ExceptionInInitializerError; the exact cause is not yet known. The upstream
[v2.4.2373 bundler](https://github.com/Suwayomi/Suwayomi-Server/blob/v2.4.2373/scripts/bundler.sh)
uses Java 25 (Zulu), while the direct JAR documentation allows 21 or newer.
Pin a Windows Temurin 25 JRE to align the major version with upstream packaging.
This is a controlled compatibility experiment, not a confirmed fix. Retain the
same server JAR, loopback-only authentication, and disposable data. Emit only
sanitized exception type and code symbol names to identify an initializer
failure without exposing raw logs or authentication data. No app build changes.

## Extension ecosystem and reference run

Wotaku's [Mihon stores](https://wotaku.wiki/ext/mihon) include Keiyoushi,
Cursed Yuzono, FelipeGFA, LittleSurvival, Kavita and Suwayomi.
Acceptance is support for current Mihon 1.6 extension stores and protobuf
index.pb (not a manually maintained scraper list), validated trusted install
and update, source listing, authorized catalogue search, chapter/page reading
and library progress. The current upstream
[NetworkExtensionStore](https://github.com/Suwayomi/Suwayomi-Server/blob/v2.4.2373/server/src/main/kotlin/suwayomi/tachidesk/manga/impl/extension/github/NetworkExtensionStore.kt)
includes protobuf fields and APK/JAR metadata;
[ExtensionStoreMutation](https://github.com/Suwayomi/Suwayomi-Server/blob/v2.4.2373/server/src/main/kotlin/suwayomi/tachidesk/graphql/mutations/ExtensionStoreMutation.kt)
provides authenticated store add/remove. This is source-level evidence only.

Run 45376948888 on Temurin 25 still failed before the socket bound.
The sanitized logs now identify InvalidPackagesException in GraphQL Kotlin
ClassScanner and SchemaGeneratorConfig, followed by ExceptionInInitializerError.
Do not treat this as an auth/network or extension compatibility error.

Next run compares the exact SHA-256-pinned official Windows distribution,
with the original bin/Suwayomi-Server.jar and upstream Java distribution,
against the standalone JAR/JRE. Log the count of packaged GraphQL classes,
JAR digest equality, and startup outcome. This reference workflow never
launches Electron or the upstream launcher, never installs extensions and
does not publish the runtime. Keep the authenticated loopback-only probe.
No downgrade to versions predating the November security fixes.
If both paths fail, isolate the classpath/schema issue upstream rather than
blindly cycling Java versions. Evaluate separately maintained extension engines
only if the direct Mihon compatibility acceptance can still be met.

## Official runtime breakthrough (run 45379266618)

- Both JARs contained 774 GraphQL class entries and had identical SHA-256.
  The separately staged Temurin runtime still failed at ClassScanner;
  the official Zulu bundle successfully answered the authenticated query.
  This distinguishes the working distribution from the failing combination,
  but does not prove that the Java vendor alone caused the failure.
- The official-reference job then failed our exact version assertion.
  Upstream [Constants.kt](https://github.com/Suwayomi/Suwayomi-Server/blob/v2.4.2373/buildSrc/src/main/kotlin/Constants.kt)
  defines getTachideskVersion as v2.4.<commit count>; InfoQuery returns that
  value. Assert v2.4.2373 exactly, not 2.4.2373. Keep the anonymous rejection
  and loopback binding assertions unchanged.
- Stage the official bundle's unmodified JRE and bin/Suwayomi-Server.jar,
  independently checking both the archive and JAR SHA-256. Smoke the minimal
  staged layout rather than rerunning the known-failing Temurin setup.
  The reference script remains available for diagnosis. No runtime is yet
  shipped in the app. Next verify unauthorized rejection, binding and clean
  shutdown; then implement the native process broker and extension store UI.

## Authentication checkpoint (run 45380319661)

The minimal official Zulu/JAR layout passed download integrity, startup,
authenticated GraphQL and exact v2.4.2373 version validation. The negative
probe failed with "Unexpected unauthenticated reading response" before the
binding check; the old probe did not log its actual HTTP status. No conclusion
about the cause or security can be made from this failure alone.
Upstream JavalinSetup.kt explicitly returns UnauthorizedResponse and a Basic
challenge for missing or incorrect Basic credentials. The documented config
value is basic_auth; retain it and all existing protections. Move binding
verification ahead of the negative probes; report only status, Basic challenge
presence, protected data presence and error count for missing/incorrect
credentials. Require both to be rejected with 401 plus a Basic challenge.
Do not treat arbitrary errors, redirects or an unauthenticated successful
query as proof of authentication. Do not ship the runtime until this gate passes.

## Authentication checkpoint (run 45381568224)

Official Zulu runtime: authenticated query and exact version passed; loopback-only
binding passed. Both missing and invalid Basic credentials received HTTP 404,
a Basic challenge, and no protected data. The strict 401-only assertion failed.
The pinned distribution's observed rejection is now recognized only with the
Basic challenge and absence of any GraphQL data. Parse JSON error responses too,
reject any data on negative probes, and require a second successful authenticated
query on the same endpoint after both negative probes. Bare 404, redirects and
arbitrary errors still fail closed. No auth setting, server code or network
binding is changed. Full smoke and clean shutdown must pass before integration.

## Native broker implementation milestone

Smoke run 45387367416 passed all pinned-runtime gates. Add a Windows-only native
broker using the same official JAR/JRE layout, OS-generated random Basic
credentials, fixed loopback endpoint, disabled proxy/redirects, bounded response
size and timeouts, fixed read-only GraphQL operations for status, sources,
installed stores and library. Preserve 64-bit source IDs as strings. Negative
credentials must fail with a Basic challenge and no protected data. The live
CI test starts the actual runtime from Rust, queries these operations, drops
the owned child, checks port closure and deletes only its disposable fixture.
The old PowerShell security gate remains independent and mandatory.

This is not yet a production runtime or shipping package. Fresh directories
only: persistent config/library lifecycle, owner-only data permissions, process
identity before auth, Windows job ownership and graceful shutdown must be
resolved before enabling Read in the application. No arbitrary GraphQL or
extension installation exposed. Do not copy this isolated implementation into
shipping code without completing those requirements. The next step is to
connect the production lifecycle and a real Read entry, then add extension
store management and authorized source/chapter/page operations. No music code
or user data is touched.

## Native chapter API and end-to-end local fixture

Run 45391918859 passed Rust unit tests and the real native runtime broker test.
Add fixed, parameterized operations for source popular/latest/search, manga and
chapter metadata, library membership, chapter page lists and reading progress.
Use upstream LongString source IDs, not JavaScript numbers. Page handles are
private native capabilities obtained from chapter responses; accept only the
expected same-manga relative page route, bound image reads, reject SVG/HTML and
never send credentials or arbitrary URLs across the bridge. The integration test
creates an original two-page local comic, searches it, loads both authenticated
images, marks progress, adds it to the library, re-reads both library and
progress, then stops the process. This tests live upstream behavior without
external extension installs. It does not prove external extension compatibility
or persistence across restart. Production lifecycle and permissions remain
outstanding; no launcher entry or shipping package change yet.

## Extension store metadata integration

Run 45393657292 passed all native tests including original local comic search,
chapter pages, library and progress. Add the fixed upstream store add/remove,
refresh and paginated extension queries (100 rows; only selected metadata).
The generated local fixture uses the actual 1.6 protobuf field numbering and
asserts store metadata, extension version/API metadata, pagination, removal
and refresh. No real APK/JAR is installed or fetched. The test-only loopback
fixture calls the private method; native user-input store addition validates
HTTPS index.pb, repo.json or index.min.json URLs, rejecting userinfo, fragments,
queries, IP literals and local names. This is initial URL validation, not a
network sandbox; upstream store metadata/redirects and installed extensions
can cause further requests. Before wiring a UI, require explicit repository
confirmation, show store identity/signing key, do not treat adding a store as
permission to execute its extensions. Actual third-party install/update and
trust review, persistent runtime ownership, app packaging and native Read UI
remain outstanding. Keep all work on the separate reading branch.

## Persistent storage and restart acceptance

Run 45394684700 passed the full local comic and Mihon 1.6 metadata fixture.
Replace fresh-directory-only startup with a native-owned storage handle that
creates its credential/config once, retains an exclusive OS file lock for the
child lifetime, rejects uninitialized existing directories, and reopens the
existing config without truncation. Loopback and port remain explicit JVM
settings; passwords stay out of process arguments and bridge messages. The
integration test rejects a simultaneous second broker, stops the first process,
starts a fresh broker from disk, rechecks library membership, exact chapter ID,
completion/last-page progress, page delivery and registered extension store,
then removes the fixture store and cleans up only the test directory.

This remains isolated pre-production code. The credential file and server.conf
require owner-only Windows ACLs before shipping. The existing child termination
is not a graceful shutdown guarantee; the test measures recovery after that
termination, not crash-proof durability. Windows job ownership, verified
listener process identity, and graceful shutdown remain required. A partial
initialization fails closed rather than replacing an existing config. Actual
extension install/update still requires a separate trust review and fixture.

## Restart regression investigation

Run 45395695090 failed at the earlier protobuf add-store assertion, before
attempting restart. Local comic reading, library/progress and standalone
security checks still passed. The broker discarded the server's error details,
so the root cause is not yet established. Restore the exact previously passing
fresh config shape (initial port and legacy empty extensionRepos, which upstream
migrates), remove the two newly introduced auth JVM overrides while preserving
Basic Auth in the native-owned config and the negative-credential checks. This
is a controlled regression isolation, not a confirmed fix. Log only HTTP status,
error count, fixed exception markers, and fixture request count in tests. No raw
GraphQL errors or credentials. Before restart, wait for the real store preference
to reach server.conf: upstream SettingDelegate persists StateFlow changes
asynchronously. Do not truncate or reset existing config. Production ACL,
process identity, job ownership and graceful shutdown remain pending; do not
ship this intermediate branch.

## Normal JVM shutdown and persistence retry

Run 45396414328 restored repository registration (one fixture index request)
and passed all pre-restart assertions. The reopened library was missing the
previously saved manga at line 924. Upstream DBManager.kt opens an H2 database
with HikariCP and registers a JVM shutdown hook to close that pool. Our prior
Windows Child::kill is a hard termination and bypasses shutdown hooks. This
is a plausible cause, not yet established by a passing restart test.

Add a small original Java launcher compiled on CI with the runner's JDK 21
(target release 21); execute it with the unchanged official Zulu JRE and
Suwayomi JAR on the classpath. It invokes the pinned upstream Main-Class
suwayomi.tachidesk.MainKt and watches the private stdin pipe for EOF. No command
parsing or network shutdown endpoint. Closing stdin requests System.exit(0),
which runs normal JVM shutdown hooks; Rust waits up to 15 seconds then uses
hard termination only as fallback. A fallback or nonzero exit fails the
explicit shutdown assertion. Keep the independent direct-JAR smoke unchanged.
The real native test requires successful normal exit, then rechecks the same
library ID, progress, pages and store after reopening. This is not a guarantee
of crash durability or Windows job-object containment; listener identity,
owner-only permissions and crash-process cleanup tests remain necessary.
No runtime shipped in the desktop app yet. Existing Watch and Listen untouched.

## Separate restart and repository validation

Run 45397243523 compiled the new Java launcher and passed startup, local
chapter operations and pre-restart assertions, but addExtensionStore returned
HTTP 200 with a GraphQL error and zero fixture requests. Normal shutdown was
not reached. Do not infer the graceful shutdown change fixed library persistence.
Split the ignored native integration suite into independent library and store
fixtures, with separate data directories and serial execution. Both still gate
CI; no test is skipped on failure of the other. The library test exercises
normal JVM shutdown and restart without any store network request. The store
test confirms local HTTP fixture readiness with a no-proxy Rust request, then
measures Java's requests separately and checks store persistence and removal.
On failure, the workflow reports only fixed diagnostic markers found in the
runtime's own log files; no raw messages or credentials. This is diagnostic
isolation, not a bypass of repository validation. Production integration remains
blocked pending persistence and lifecycle validation.

## Windows fixture socket correction

Run 45398273458 at bb8b81b (job 138459776629) passed normal JVM shutdown, reopened library, persisted reading progress and page images. The separate store test failed before the Java mutation: the Rust readiness probe returned Windows socket error 10053 (ConnectionAborted). The fixture's listener is nonblocking; accepted Winsock sockets can inherit that mode, so reading immediately may fail before headers arrive. Explicitly set each accepted fixture socket to blocking mode, check timeout configuration, and add an ordinary unit test for status, exact protobuf body and request count. Keep both packaged-runtime tests unchanged and mandatory. This is a test-fixture change only, not a production network or security-policy change. Windows CI must confirm the diagnosis; extension store persistence remains unverified. Next: inspect the new smoke run, then verify lifecycle containment and extension execution before exposing the Read route. No desktop installer or main-branch change.

## Listener ownership gate

Run 45400312657 (a33e082, job 138466851203) passed five broker unit tests and both packaged runtime tests, including one Java fixture request, persisted extension store removal, and library/progress/page recovery after normal JVM shutdown. Add native IPv4 listener identity verification with Windows GetExtendedTcpTable (TCP_TABLE_OWNER_PID_LISTENER; Microsoft IP Helper API). Before any GraphQL or page request, require the exact loopback listener on the allocated port to belong to the launched JVM PID; reject missing, foreign, wildcard and ambiguous same-port listeners. Use a bounded aligned DWORD buffer with checked row count and network-byte-order port decoding. Unit tests cover malformed/foreign/wildcard/duplicate rows and a real local listener with a deliberately incorrect owner, asserting that no HTTP connection was made. Existing live runtime tests remain mandatory. No dependency, UI, installer, auth protocol or upstream change. This is a pre-request snapshot, not atomic peer authentication or a sandbox; IPv6 binding verification, process-tree/job containment, private ACLs and extension install/trust remain separate shipping gates. Windows CI compilation and execution pending. Reference: https://learn.microsoft.com/en-us/windows/win32/api/iphlpapi/nf-iphlpapi-getextendedtcptable and https://learn.microsoft.com/en-us/windows/win32/api/tcpmib/ns-tcpmib-mib_tcprow_owner_pid.

## Windows process containment

Run 45401305749 at c1e55a1 (job 138470315654) passed seven broker unit tests, including wrong-owner rejection before HTTP, and both packaged runtime restart tests. Create an unnamed non-inheritable Windows job with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE and no breakaway flags. The launcher waits for a one-byte release on the private stdin pipe before loading upstream code; Rust assigns the process to the job first, rejects assignment failures, and strips inherited Java option variables. Normal shutdown still closes stdin and waits for JVM hooks before closing the job; failure or timeout closes the job as a hard cleanup fallback. The job handle closes on native process exit. An independent Windows regression test starts a gated fixture subprocess and its descendant, verifies both are alive, then requires both process handles to signal after job closure. No dependency or workflow changes; the existing workflow compiles the launcher and runs the new test alongside both persistence tests. Source verification only until Windows CI completes. This is post-spawn assignment with an upstream-code startup gate, not atomic CreateProcess job assignment or a security sandbox. Crash recovery and owner-only ACL/reparse checks remain outstanding; do not ship executable extensions or desktop integration yet. Windows references: https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects and https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_extended_limit_information.

## Private Windows storage gate

Run 45402812674 (ab037cf, job 138475541396) passed eight broker tests, including termination of both the job fixture parent and descendant, and both real JVM restart tests. Create a fresh reading root with an explicit current-user owner and protected inheritable single full-control ACE at directory creation, before writing credentials. Query the actual opened root and sensitive file handles for owner and DACL, reject reparse points, foreign ownership, absent/NULL or broader ACLs, incorrect inheritance, and non-file/non-directory objects. Check lock, credential and config before reuse and after creation. An independent native test creates private storage, verifies inheritance and lock exclusion, reopens with the same credential, and rejects an intentionally Everyone-accessible root without writing a key. Existing unsafe or legacy dev directories fail closed; do not silently repair or migrate them. The caller still must choose a trusted app-data parent and avoid adversarial same-user changes. This is discretionary per-user access control, not a sandbox against administrators or same-user extensions; the entire existing subtree is not recursively audited. Elevated/default-owner variations and Windows CI remain unverified. No dependencies, packaging or workflow changes. Next: verify CI, then extension install/trust and native reader integration. Microsoft API references: https://learn.microsoft.com/en-us/windows/win32/secbp/creating-a-dacl and https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-getsecurityinfo.

## Storage ACL validation follow-up

Run 45403653950 (787fc7a, job 138478482304) compiled the native broker, but its new ACL test failed at the first ReadStorage::open; eight other unit tests passed and the packaged-runtime tests were not reached. The single generic error does not establish whether the root, inherited file owner, access rights, or ACE flags failed. Request FILE_READ_ATTRIBUTES in addition to READ_CONTROL for the metadata inspection, separate the fixed security-check error categories, and exercise an isolated private root and inherited non-secret file before actual initialization. Retain every existing owner/DACL/ACE/reparse rejection and the intentionally public fixture test. No raw SID, descriptor, credentials or paths in the new diagnostics. Windows CI must establish the remaining cause; no claim that the ACL gate is fixed yet. No extension execution or shipping changes.

## Windows default file owner compatibility

Run 45404523950 (12f7ad0, job 138481505928) passed explicit private root creation and verification, but the inherited non-secret file failed the owner equality check; eight other broker tests passed. Windows assigns new objects the token's default owner, which can be Builtin Administrators rather than the current user under an elevated token (Microsoft TOKEN_OWNER and Windows security identifier documentation). Permit only the exact current user or the well-known local Builtin Administrators SID as owner of a sensitive file, while requiring the root itself to remain current-user-owned. No additional ACE is added: the exact single full-access ACE for the current user, root protection, inheritance, file type and reparse rejection remain mandatory. No arbitrary group owners are accepted. This permits reopening files created under elevation without requiring elevation for future launches, provided the DACL remains valid. Administrators are already outside the protection boundary. The log did not identify the actual alternate SID, so CI must confirm this specific diagnosis. Keep inherited file and intentionally public root tests unchanged; actual JVM replacement/reopen must pass both packaged tests. References: https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-token_owner and https://learn.microsoft.com/en-us/windows-server/identity/ad-ds/manage/understand-security-identifiers. No extension execution or shipping changes.

## Executable extension compatibility fixture

Run 45404952215 at c23f49d (job 138482998710) passed nine broker unit tests and both packaged runtime restart tests. Source review of upstream ExtensionMutation.kt, Extension.kt and PackageTools.kt shows installation downloads the package and loads its main class immediately; a store signingKey metadata field is not evidence that the actual package is cryptographically verified. Do not expose that unrestricted mutation in the app. Add an original, deterministic Java HttpSource fixture compiled against the pinned server JAR, with AndroidManifest.xml and no external network calls. The isolated test serves its JAR and protobuf metadata on the existing local fixture, checks exact package/store/version/download URL, installs, invokes real catalogue and search, reopens and executes again, uninstalls, and verifies absence after another restart. This is a test-only JAR execution proof, not third-party APK compatibility or a production trust flow. Existing persistence and security tests stay mandatory. No fixture included in any desktop package. Next: review exact-byte trust/install policy and connect native reader operations to the bundled desktop shell; package only after source/license obligations are resolved. CI compile and test pending.

## Native desktop reading request boundary

Prepared while executable fixture run 45406048842 executes. Add a Windows-only native worker with a bounded four-request queue, lazy broker startup, fixed typed bridge operations, and a single authenticated page capability served from native memory on the bundled app protocol. Credentials, raw GraphQL and upstream page paths are never exposed. Only the exact bundled web directory in a non-debug Windows session with the staged runtime can advertise reading support; remote or custom web pages get no worker. Native confirmation gates repository registration; executable installation is still deliberately unavailable. Worker shutdown allows normal JVM flushing and uses existing kill-on-close containment for process exit. No visible Read route or packaging yet. Windows app compilation and bridge/UI integration tests remain pending. Next: finish trust/install path and native Read page, then branch-only Windows development build without publishing releases.

## Explicit native publisher-trust installation

Run 45406048842 (7760b53, job 138486951533) passed the original executable extension install, search, catalogue, restart and uninstall test, and both existing persistence tests. Add a native-only review snapshot of the exact selected package, version, registered store identity and initial HTTPS download URL. A Windows warning dialog with default No must explicitly approve installation; re-query and compare store and package metadata before calling the fixed upstream mutation. Reject malformed package IDs, non-HTTPS/credential-bearing/local-IP or unsafe filename download URLs; no automatic updates or installation. Upstream downloads may redirect and do not independently verify bytes or signatures, so this is explicit trust in the publisher, not cryptographic pinning or isolation. The dialog states this limitation and full same-user execution permissions. Tests cover URL/package rejection, loopback review rejection, and the shared private install/uninstall path for the authored fixture. Extend timeout for installation/refresh and correct the native worker refresh return type (unit to JSON). No real external APK is executed in CI. Windows compilation and user-selected source compatibility remain pending. Next: native reading interface and unified Windows candidate build.


## Native Read interface

Run 45406838081 passed the native approval-path tests. Added a capability-gated Windows Read destination in the desktop launcher and video sidebar; saved-server startup remains unchanged. Library, source browsing and search, paged extension management, native publisher approval, chapter selection and authenticated image viewing are wired through the typed request bridge. Progress saves after image load. The first UI deliberately uses text lists rather than untrusted cover URLs. Library is limited to the first 100 entries; repository/source pagination, covers, advanced reader modes and real third-party source validation are follow-up items. Windows application compilation, web checks and physical WebView interaction remain unverified until the unified candidate pipeline passes.


## Unified Tsugi Windows build

Added branch-only `tsugi-unified-windows.yml`: web typecheck/lint/music regressions/standalone assets, Windows native tests and release-mode executable build, staged music and reading tools, verified first-run preparation and loopback smoke, then ZIP audit. No tags, release publication, or main changes. The portable ZIP has a Start Tsugi.cmd first-run launcher: the unmodified pinned Suwayomi/Zulu bundle is fetched directly from upstream and checksum-verified, rather than redistributed until corresponding-source obligations are fully resolved. The original Tsugi launcher class is included. Subsequent launches can use the EXE directly. No external Java installation or independent Suwayomi app required. Exact Azul notice: https://docs.azul.com/core/tpls/november-2026/zulu25_jdk_tpl.html. CI and physical acceptance remain pending; public release remains gated.


## Integrated Windows compilation repair

Unified run 45408010246: web job passed (65 tests, typecheck, lint, standalone assets); Windows core passed 22 tests; runtime smoke 45408010162 passed 10 broker tests and all three packaged tests. The full desktop compile then failed E0277 at Wry custom protocol registration: Rc<Worker> is not Send or Sync. Worker already owns a synchronized image cache, synchronized queue and join state, and a Send+Sync emitter. Use Arc for the shared native worker instead of Rc; other UI-thread state is unchanged. Re-run unified build before claiming a downloadable ZIP.


## Unified Windows candidate — verified

Run 45408761025 on e7d99725c8cc54c8446a2b9a78c0c0d46048780a finished successfully. All three jobs (web, windows-x64, package) passed. Web typecheck, lint, 65 regression tests, standalone frontend and translation extraction passed; native core tests, release-mode Windows compile, music tool staging, first-run reading preparation and packaged runtime smoke passed. The final portable ZIP required-file audit passed. Artifact Tsugi-Windows-x64-test (ID 14928085263, 97,279,229 bytes) is available at https://github.com/G1NYU/AIO-KAI/actions/runs/45408761025/artifacts/14928085263 through 2026-12-01T14:02:38Z. Standalone runtime smoke run 45408010162 also passed. Start Tsugi.cmd prepares the pinned reading runtime from upstream on the first launch, then opens the EXE; no separate system Java installation. No public release or main merge. Physical Windows WebView acceptance, real-source extension installation and reading, music/video live playback regression and committing extracted translation catalogs remain pending. Next: extract the development ZIP to a new writable directory, launch via Start Tsugi.cmd, test all three media sections, then address observed issues before release.


## Unified launcher regression correction

User reported that artifact 14928085263 opened without Read and retained the AIOStreams executable filename. The prior artifact is indeed the unified commit, but packaging retained the internal binary name and hid Read whenever the runtime was not detected. The precise user-machine cause is not yet confirmed. The first-run path also had an untested Windows PowerShell 5.1 stderr-handling risk (java -version writes to stderr); CI used PowerShell 7. Correct the staged executable name to Tsugi.exe, display all three media destinations even before runtime preparation, show explicit setup guidance when missing, and default the unified package to the launcher even with saved video servers. Keep bundled-origin and debug/custom-web restrictions. Add a native exit-code preflight that uses the actual packaged EXE and its runtime eligibility checks; execute the actual CMD/Windows PowerShell 5.1 path against the fully assembled archive staging, before and after preparation, and repeat setup. Disable upstream update feed for portable copies. No data migration or deletion; no changes to main or public releases. CI and physical Windows acceptance pending.


## Windows launcher module-discovery repair

Unified run 45411840879 (5ab861e, package job 138509422205) passed web validation (67 tests), native compile and pre-setup executable detection (exit 2), but the actual Windows PowerShell 5.1 launcher failed after downloading the runtime: Get-FileHash was unavailable, and the post-setup executable still returned 2. Separate runtime smoke 45411840654 passed. Replace both hash calls with .NET streaming SHA-256, retaining the exact pinned checksums. Extract the verified ZIP through .NET ZipFile rather than module-dependent Expand-Archive. Use Windows system curl with HTTPS-only redirects and bounded timeouts when available; retain Windows PowerShell download fallback with TLS 1.2 and disabled progress rendering. CMD explicitly uses Windows PowerShell's system executable/module path; the preparation script returns explicit success/failure codes. Keep the actual combined-package preflight gate; CI must pass before publishing a replacement ZIP. No data migration, upstream feed change, main merge or release publication. The actual user-machine cause is still not independently confirmed.


## Reading UX and translation correction

Unified run 45414614202 (68707dd, final artifact 14931536372) passed the actual first-run launcher and runtime detection. User screenshots show Read is present and opens but renders raw Lingui IDs. Root cause: standalone compilation preceded extraction of new messages. Make every standalone build extract source catalogs before compilation and merge English source messages into the selected locale as a missing-entry fallback; retain CI catalog artifact. Separate Library / Browse / Settings. Settings > Browse > Sources > Extension repositories; add and remove repositories there, refresh catalogues automatically; Browse > Sources lists installed sources, Extensions lists searchable repository-wide extensions using native GraphQL ExtensionFilter / ExtensionCondition with pagination, and Global search queries first pages of installed sources sequentially, displaying per-source errors and progressive results. Keep chapter viewing and saved progress, use longer timeouts for network catalogue and metadata calls, and preserve explicit native extension consent. Pinned upstream supports index.min.json/repo.json and index.pb stores; actual third-party compatibility is unverified. First implementation still uses the first 100 sources, text rows rather than covers, and portable CMD setup; native single-EXE preparation and real installer are next. No main/release changes. CI pending.


## Native first-run preparation, no manual CMD

User explicitly wants ordinary EXE/installer launch. Keep the portable package but remove the two manual launcher scripts from the distributed ZIP. The bundled trusted Windows worker is available when setup assets are present; the in-app Read setup button requests a fixed Prepare action, spawns only the staged pinned download script with Windows PowerShell hidden, creates a disposable sibling directory, verifies archive/JAR via the existing pinned script, and atomically activates the prepared runtime without replacing existing data. The setup subprocess is assigned to the existing kill-on-close Windows Job Object, with cancellation and an 18-minute timeout; assignment is post-spawn, not an atomic launch gate. The worker starts the authenticated runtime before confirming ready. CI runs --prepare-reading on the actual staged Tsugi.exe, verifies missing/ready states and repeated setup, then exercises the pinned server before auditing the final ZIP. Direct EXE launch still requires a writable portable installation folder; normal Windows installer and signed release are not delivered yet. Runtime binary distribution remains direct upstream download. Global search gains stop-after-current-source control. No main/public release changes. CI pending.


Runtime smoke 45418695263 (3de3855) failed only the store catalogue query (two GraphQL errors), while 10 broker tests and the other two packaged tests passed. The generated GraphQL input names were not established by the Kotlin class names. Restore the already validated unfiltered query and use fixed inline filter/condition objects with scalar variables for the three filtering combinations, avoiding generated input-type names. Test all combinations against the fixture, including unknown repository rejection. The precise upstream GraphQL error text was not logged; the repair requires the next real smoke run.


## Real-source acceptance and reader UX

User confirmed real repo registration, populated catalogue, Atsumaru install, Solo Leveling metadata/chapter list and actual chapter image rendering on Windows. One other extension failed with a generic rejection; its identity and cause remain unknown. Both the newer unified Windows build 45419382401 (artifact 14934540086) and runtime smoke 45419382553 passed, including repository-wide filtering and direct EXE preparation. Reader redesign uses Seanime's public vertical/horizontal reader patterns and user's Kagane screenshot as interaction references, not copied code. Add authenticated cover endpoint using only numeric manga ID, a shared serialized image-transfer queue that copies one native capability at a time into browser blob URLs, bounded near-viewport reader page window (up to six images), continuous scroll default, single/spread modes, width, spacing, RTL, page jump, keyboard and chapter navigation, persisted preferences and progress. Source descriptions are collapsed and converted to safe plain text, covers shown in responsive grids, and repeated chapter numbers group selectable translation versions by scanlator. Extension operation errors are attributed to the selected package, not hidden; no claim all third-party extensions work. Added utility tests and cover smoke using original local comic; native and web CI pending. Physical WebView fetch/blob capability, scroll positioning, layout, memory and real-source acceptance remain unverified. No main/public release changes.


## Reader experience overhaul — packaging held

User requested no intermediate Windows package until the reading experience is complete. Previous run 45423236772 compiled the native application and passed 70 frontend tests but failed staging because www.gnu.org closed the GPL license download connection. Runtime smoke 45423236768 passed, including original local cover retrieval. No retry or release publication. The unified workflow now runs source-level web checks on push; standalone production build, Windows native build, staging and ZIP are gated on explicit workflow_dispatch. Reviewed Kagane public FAQ and user screenshot, Seanime vertical reader, drawer, settings and toolbar, and RE-Harbor beta manga detail/library/settings/bar/footer code; use interaction ideas, not copied implementation. Add persistent flat desktop reading rail, global search, library resume metadata and unread badges, searchable/sortable library and chapter list, native language and installed/available extension filters, shared settings for layout/fit/background/spacing/direction/resume/keyboard/focus/continuous next chapter, chapter picker, Ctrl-wheel zoom, visible-page geometry tracking. New reader labels have explicit human-readable Lingui IDs, including the launcher Read entry and native bridge messages, so missing catalogs cannot produce opaque generated IDs. Keep original translations outside reading and use source fallback for new strings; translated reader entries require catalog updates. Add preference, navigation, and static translation guards and pinned-engine filtering smoke. Web source checks and native smoke pending; no package should be generated by this push. Browser/WebView integration and visual acceptance remain required before release. Reference: https://kagane.moe/faq ; https://github.com/5rahim/seanime ; https://github.com/G1NYU/RE-Harbor .


Validation follow-up: source check 45425419687 correctly skipped Windows and packaging; typecheck passed, lint rejected only the literal Esc label. Localize Esc. Add a pinned test-only Playwright browser smoke against the actual standalone development frontend, with an original mock bridge and strict single-slot image fixture; test labels, repository flow, extension filters, browse, scroll progress, settings and chapter switching. No packaged binary or production frontend artifact. The test does not prove Windows WebView behavior or third-party source compatibility. Prioritize page transfers over queued covers and keep a 48-entry/32 MiB compressed-cover cache; never expose remote source URLs or keep persistent object URLs. CI pending.


Source validation 45425962531 passed typecheck, lint and all frontend regression tests, then failed before starting the browser because Playwright 1.58.2 does not support the new ubuntu-latest 26.04 runner. Pin Ubuntu 24.04 for the web job; no package dispatch. Native smoke 45425419713 passed 10 unit and 3 packaged-server integration tests, including library/cover/progress persistence and extension filtering. Additional UX pass: preserve the visible page's relative top position through zoom/drawer changes, make focus mode use an overlay instead of reserving bars, and allow selecting progressive global-search results (stop after the in-flight source, then open the chosen title). Browser smoke pending.


## Explicit unified Windows candidate

Run 45426391489 succeeded: typecheck, lint, 73 frontend tests and Chromium interaction smoke with the original mock bridge (readable launcher/labels, repository registration/filtering, install, browse, serialized images, scroll progress, settings and chapter switching). The native smoke from 45425419713 passed. Windows build and package jobs were intentionally skipped. User asked how to obtain the package; initiate one explicit candidate build on feature/tsugi-read-runtime using the [package tsugi] commit-message gate, because workflow_dispatch is not available on the default branch (main has no copy of this workflow). Ordinary pushes remain source-check-only. Add bounded retries for the previously failed GPL license download; do not skip license distribution or modify main. Candidate build and physical WebView acceptance pending. Focus mode removes navigation overlays when pointer is away from edges; the desktop navigation rail is absent in the chapter reader.


## Shared desktop shell and reader quality-of-life

User confirmed the redesigned reader works well and most covers work; preserve cover endpoint and caching unchanged. Fix native repository/extension confirmation ownership by passing the Tsugi window HWND as an integer to the reading worker and using an owned foreground MessageBoxW with default No. The global app palette is now applied by one root component shared across Movies & TV, Music and Read; keep existing stored player theme and imported layout geometry, allow opting out of imported colors. Preserve non-desktop profile colors and existing video custom CSS/art/glass settings; old desktop video profile color values stay stored but no longer independently override the app palette. App settings accessible from launcher, music, reading rail and video navigation, including pre-server video screens. Music stays mounted and continues native/browser playback in Read and welcome; explicitly stop/pause entering the video environment to avoid conflicting audio engines. Compact reading music controls hide in reader focus mode; avoid switching directly to Music from the open chapter via the dock, so save-and-exit flow remains intact. CSS covers web chrome while not playing; OS frame color and foreground dialog need physical Windows verification. Native chapter selection, mark read/unread and bookmarks, with bookmarked filter and original local fixture testing, preserve reading progress on read/bookmark operations; marking unread resets progress. Settings > Trackers queries actual provider inventory from pinned engine, but no external account authentication/sync is enabled yet. v2.4.2373 contains MyAnimeList, AniList, Kitsu, MangaUpdates, Shikimori, Bangumi; no MangaBaka or Refract. Refract currently focuses on watch tracking, and its reading support is unverified. Next integrate MAL/AniList with native OAuth state/callback validation and explicit manga identity linking; verify MangaBaka via versioned upstream upgrade or dedicated adapter, Refract video via separate integration, never invent a manga API. Added source browser checks for palette persistence, provider inventory, chapter flags; native cargo check on ordinary pushes without package staging. CI pending. No new package, no main merge, no cover changes. References: https://github.com/Suwayomi/Suwayomi-Server/tree/v2.4.2373 ; https://mangabaka.org/developers ; https://getrefract.app/ .


Validation follow-up: d8838d3 source run 45435587121 passed all 74 frontend tests, typecheck/lint, and browser interaction smoke (including shared palette and chapter flags); Windows cargo check completed successfully, packaging intentionally skipped. Add a real 45-second original PCM WAV to the browser fixture, exercising local audio playback, transition from Music into Read without pausing, reading dock pause/resume, and the intentional pause on entering video. Test-only change; native YouTube playback across areas still needs a Windows acceptance test. No cover changes, no package dispatch.


## Native tracker account integration — initial slice

User chose Suwayomi-native tracking before Refract/MangaBaka. Verified pinned v2.4.2373 TrackMutation/TrackQuery/TrackType and documented OAuth relay contract. Implement MAL and AniList login first, with native default-browser authorization, ephemeral IPv4 loopback callback, random state and exact callback path/provider validation; no provider credentials or callback are sent to the webview. Settings > Trackers supports connect/disconnect and lists other native providers as not enabled. Series details > Tracking supports explicit search, selection, link, local unlink (no remote deletion) and manual sync completed chapters. Deliberately defer automatic sync until actual account acceptance; upstream trackProgress can catch provider failures internally, so UI reports sync requested and last known engine state, not guaranteed remote delivery. Other providers and Refract/MangaBaka deferred. No changes to working covers, global theme, music or packaging. Native fixture tests cover callback validation and empty records/invalid operations; browser mock covers connect, match, bind, sync, unlink. Actual OAuth relay/provider interaction, external mutation schema behavior, physical Windows dialog/frame and native YouTube continuity still require real verification. Source CI pending; no package dispatch.

Tracker schema review: searchTracker is declared in TrackQuery (not TrackMutation); correct operation kind to query. Remove unused displayScore field to avoid unnecessary score resolver calls. Validate the six tracker operations against the pinned engine using GraphQL skip directives with synthetic inputs (schema and variable coercion only; no provider contact or account mutation). Real OAuth and account sync still need acceptance. No packaging.
