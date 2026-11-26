# Disposable WebView2 disk-cache preservation

This is a Windows-only **test**, not an application cleanup command. Run from the repository root:

```powershell
pwsh -File packages/desktop/scripts/verify-webview-cache.ps1
```

It compiles the desktop example using the existing locked Tao/Wry/WebView2 dependencies and requires an installed WebView2 runtime. Unified Windows validation invokes it after native core tests. No external provider or real user data is needed.

## Scope and expected evidence

- The supervisor creates a unique temporary profile and a loopback-only HTTP server. Children accept only the fixture token, loopback port and a known phase; no arbitrary profile path. The actual COM environment folder and profile path are checked against the fixture before navigation and immediately before cache clear. Environment overrides, unexpected profile paths and reparse points cause refusal.
- The page uses the actual local-books database name and store shape with original synthetic data: book and cover blobs, immutable identity, title, PDF progress/fraction, Vault identity and timestamps. It also seeds reader preferences, synthetic source state, a persistent cookie and a separate CacheStorage entry. No credentials or real documents are used.
- The cold seed phase must make exactly one HTTP cache asset request. A new host/browser process must reuse it without an additional request. The clear phase invokes only the WebView2 `DISK_CACHE` category, waits for completion and verifies protected values, including active-tab sessionStorage. After another normal browser exit and restart, the asset must be fetched again (cumulative counts **1/1/2**) while protected state still matches.
- An additional phase initiates a clear and closes without observing its completion: exit **2** represents an unknown result, not successful cleanup. A final restart checks protected values. Each child and browser shutdown has a deadline. The supervisor holds/waits on the actual disposable browser process handle rather than assuming a host exit is enough.
- Successful validation removes only the uniquely created fixture directory. Failure preserves it for diagnosis; it must not be mistaken for an application profile.

## Production boundary

Microsoft's [WebView2 clear-browsing-data API](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2profile2) reports category completion, not a reviewed file list or an exact reclaimed byte count. Even a passing probe does not justify deleting WebView2 files directly, clearing all DOM/site data, or claiming that a reviewed number of bytes was freed. Production cleanup remains a separate A1 acceptance item. Real portable data and physical-machine acceptance remain distinct.

The HTML JavaScript was syntax-checked and the locally inspected blob matched the staged source. Local Chromium navigation was blocked by administrator policy; it did not exercise the COM API or establish a passing browser result. Windows CI is the actual integration gate.

## Verified Windows result

The disposable WebView2 fixture at `18ef6ed` passed the actual Windows runtime in [job 140173949511](https://github.com/G1NYU/TSUGI/actions/runs/45897205036/job/140173949511), including cold/warm/restart HTTP request counts 1/1/2, protected data checks and interrupted/unknown exit 2 followed by a preservation check. The same job passed all 164 native core tests, with 18 intentionally ignored. Production cleanup and physical mixed-media recovery remain open.
