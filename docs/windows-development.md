# Windows development and acceptance

The unified application is maintained on `feature/tsugi-read-runtime`. Use a separate working checkout and never build or extract over your working portable installation.

## Requirements

- Windows x64, Git, PowerShell 7, Node.js 24 or newer, and pnpm **11.0.8** (the repository's pinned package-manager version).
- Rust stable with the MSVC toolchain, Visual Studio C++ desktop build tools and Windows SDK, and the WebView2 runtime.
- Full packaging additionally uses the pinned native dependencies, JDK 21 for the reading launcher and Python 3.12 for the media fixture. Follow the exact [Windows CI workflow](../.github/workflows/tsugi-unified-windows.yml) for packaging.
- Network access to GitHub, the npm registry and the upstream assets referenced by the existing build scripts. Corporate proxies and DNS should be configured by the workstation administrator; do not work around a sandbox's network isolation.

## Checkout and web checks

In PowerShell:

```powershell
git clone --branch feature/tsugi-read-runtime https://github.com/G1NYU/TSUGI.git
Set-Location TSUGI
node --version
pnpm --version
rustc --version
cargo --version
pnpm install --frozen-lockfile
pnpm -F @aiostreams/core build
pnpm -F @aiostreams/web typecheck
pnpm -F @aiostreams/web lint
pnpm -F @aiostreams/web prepare:ebooks
```

Install the required versions first. If using Corepack, enable it and let the repository's packageManager field select the pinned pnpm; otherwise install the exact pnpm version through your normal trusted Node setup. Do not silently regenerate the lockfile or change dependencies to compensate for an old local toolchain.

## Native checks

From the repository root on Windows x64:

```powershell
./packages/desktop/scripts/fetch-libs.ps1 -Arch x86_64
Push-Location packages/desktop
try {
    cargo check --locked --workspace
    if ($LASTEXITCODE -ne 0) { throw 'Native check failed' }
    cargo test --locked -p aiostreams-desktop-core --lib
    if ($LASTEXITCODE -ne 0) { throw 'Native tests failed' }
} finally { Pop-Location }
```

These are the core checks, not the complete distribution assembly. The workflow also verifies media and Vault binaries, upstream source notices, staged WebView assets and native Reader preparation. Use GitHub Actions for the complete portable candidate unless you reproduce all its staging and verification steps.

## Package and test

Open [Unified Tsugi Windows Build](https://github.com/G1NYU/TSUGI/actions/workflows/tsugi-unified-windows.yml), select the development branch and use Run workflow if you have repository access. A development push marked `[package tsugi]` also triggers packaging when it touches an included workflow path. Do not add the release-publication marker for a test candidate. Subsequent pushes on the same branch may cancel a running package.

Download the successful `Tsugi-Windows-x64-test` artifact. Extract the inner portable ZIP to a fresh writable directory, retain the `.portable` marker and open `current/Tsugi.exe`. Check BUILD-INFO.json against the workflow SHA. The package workflow verifies the uploaded ZIP by downloading it again and comparing it to the original archive. This checks delivery integrity, not signing or every runtime behavior.

Physical Windows acceptance is still separate: check first launch, new Movies filled icons and all four profile-gated shortcuts, navigation at a short window height, App settings release checking and official GitHub links, and real playback/Reader behavior using authorized sources. The startup update notice only appears if the published stable build is a verified newer descendant; the manual release link remains available for other build relationships. Do not replace a working installation or downgrade its data merely to test the notice.

A restricted cloud shell without network access, Node 24, pnpm and Cargo cannot compile the repository locally. GitHub Actions is the supported remote verification path; a Windows development workstation can additionally run the checks and inspect the actual app.
