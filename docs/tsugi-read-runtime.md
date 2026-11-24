# Tsugi Read: embedded runtime acceptance

The Read environment is a native Tsugi frontend backed by a separately managed,
bundled Suwayomi server. The user must not install Java, Suwayomi, or a separate
reader. Use the existing desktop shell rather than replacing the application.

## Runtime proof

- Stable Suwayomi Server v2.4.2373 (MPL-2.0) and Temurin JRE 21.0.13.1+2
  (GPL-2.0 with Classpath Exception), unmodified and pinned by SHA-256.
- Fetch only the server JAR and JRE, not the upstream Electron or launcher.
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
