# Third-party software

AIOStreams Desktop is licensed under the AGPL-3.0. It ships with:

- **libmpv**, from [mpv](https://mpv.io), licensed under the GPL-2.0-or-later.
  - Windows: `libmpv-2.dll` and FFmpeg's DLLs beside it. macOS: `libmpv.2.dylib` with FFmpeg's,
    libdovi's and [MoltenVK](https://github.com/KhronosGroup/MoltenVK)'s dylibs in
    `Contents/Frameworks`. libass, libplacebo, dav1d and the other libraries they use are built in.
    mpv and FFmpeg carry [edde746's MPVKit](https://github.com/edde746/MPVKit) patches, licensed
    under the GPL-3.0-only, and FFmpeg is built with its GPL-3.0 parts, so together they are
    licensed under the GPL-3.0. Each library's licence text is in `licenses`
    (`Contents/Resources/licenses` on macOS). They are built from pinned sources by
    [AIOStreams/libs](https://github.com/AIOStreams/libs), whose release is in `libs.pin` and
    `libs-macos.pin` in the AIOStreams repository. Source: that repository's build scripts, its
    forks of mpv, FFmpeg and libass, and each library's own project.
- **The Vulkan loader** on Windows: `vulkan/vulkan-1.dll`, from the
  [LunarG Vulkan Runtime](https://vulkan.lunarg.com/sdk/home), whose version is in `libs.pin` in
  the AIOStreams repository. Licensed under the Apache-2.0; its licence text is beside it in
  `vulkan/VulkanRT-License.txt`. Source:
  [KhronosGroup/Vulkan-Loader](https://github.com/KhronosGroup/Vulkan-Loader).
- **Windows x64 Tsugi music tools** (portable development package only):
  separately invoked, unmodified upstream [yt-dlp 2026.11.23](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.11.23)
  executable (GPL-3.0-or-later including bundled dependencies) and
  [Deno v2.9.8](https://github.com/denoland/deno/releases/tag/v2.9.8) (MIT).
  Pinned downloads, licenses and source references are in
  `music-tools`, prepared by `scripts/fetch-music-tools.ps1`.
- **Rust crates** built into the app, under MIT, Apache-2.0 and other permissive licences.
  `third-party-licenses.html` lists each crate with its licence text.
- **JavaScript libraries** built into the web app in `web` (`Contents/Resources/web` on macOS).
  Their licence notices are in the `.LICENSE.txt` files beside its scripts in `web/static/js`.

It uses the system's web view, which it does not ship: the Microsoft Edge WebView2 Runtime on
Windows and WebKit on macOS. On Linux it uses the system's libmpv, GTK 4 and WebKitGTK, and ships
none of them.

The Flatpak builds its own libmpv, from AIOStreams' forks of mpv and libass with libplacebo,
LuaJIT, uchardet and libXpresent, and takes FFmpeg, GTK 4 and WebKitGTK from its runtime. Its mpv
carries the MPVKit patches too, so it is licensed under the GPL-3.0. Each of those libraries'
licence text is in `lib/aiostreams-desktop/licenses`.

- **Reading runtime (Windows development ZIP):** the first-run launcher fetches the pinned Suwayomi Server v2.4.2373 and Azul Zulu JRE directly from the official upstream bundle. The archive is verified before extraction; the ZIP itself does not redistribute those binaries. See `read-tools/SOURCE.txt` after preparation.

- **Local ebook rendering (Tsugi Windows development package):** [Readest/Foliate](https://github.com/readest/foliate-js) at `de8c86324b51c231bbbdfa9faf18e84175f563cc` (MIT), with local security patches applied by `packages/web/scripts/prepare-ebook-engine.mjs`. The upstream bundled PDF.js 4.7.76 (Apache-2.0), zip.js 2.7.52 (BSD-3-Clause), fflate 0.8.2 (MIT), CMaps and standard fonts retain their respective license files under `web/tsugi-books/engine`. Source preparation and modifications are documented in the build script. No upstream install scripts are executed.

## Optional Aria2 Next sidecar (Windows x64)

Tsugi does **not** bundle or redistribute Aria2 Next. Its built-in Vault downloader remains the default. To try the separate optional engine:

1. Download the upstream [v3.1.2 Windows x64 executable](https://github.com/AnInsomniacy/aria2-next/releases/download/v3.1.2/aria2-next-3.1.2-windows-x86_64.exe).
2. Save it as `vault-tools/aria2-next.exe` alongside `Tsugi.exe` (for the portable build, inside `current/vault-tools/`). Verify SHA-256 `94edc284cd84dec26a16ae9431378c5ab9e5cde8011482566483f4f0cb20c03f`; Tsugi also checks the digest before use.
3. Restart Tsugi and enable **Use Aria2 Next** in Vault → Providers. Changes apply to new or resumed jobs. Ineligible direct URLs, missing or mismatched engine binaries and engine failures use the built-in path. Music, video and cloud provider behavior is unchanged.

Aria2 Next's [source](https://github.com/AnInsomniacy/aria2-next/tree/v3.1.2) and [GPLv2 license](https://github.com/AnInsomniacy/aria2-next/blob/v3.1.2/COPYING) are available from the upstream project. Tsugi's original adapter invokes the independent executable using authenticated localhost JSON-RPC; it does not link to or incorporate upstream source. Any future redistribution must include the corresponding source and required notices under the applicable licenses.
