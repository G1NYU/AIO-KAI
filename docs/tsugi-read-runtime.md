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
