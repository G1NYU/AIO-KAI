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

## Managed Aria2 Next sidecar (Windows x64 development ZIP)

Tsugi distributes the unmodified upstream [Aria2 Next v3.1.2 Windows x64 executable](https://github.com/AnInsomniacy/aria2-next/releases/tag/v3.1.2) as an independent process under GPLv2. SHA-256: `94edc284cd84dec26a16ae9431378c5ab9e5cde8011482566483f4f0cb20c03f`. Tsugi verifies the binary and automatically uses it for eligible direct-file jobs; unsupported sources or failures use the built-in transfer engine.

The corresponding upstream source snapshot at commit `2a13a664edb5314d86bfd7d488305266be6688e8` accompanies the binary in `vault-tools/source/aria2-next-3.1.2-source.tar.gz`, including the vendored libraries, license materials and build/installation scripts. The source archive checksum, COPYING and AUTHORS are in the same folder. Build instructions are in the archived upstream README, packaging scripts and release workflow. No upstream source is incorporated into Tsugi's own adapter, which communicates with the separate executable through authenticated localhost JSON-RPC. This packaging path is specific to the Windows development ZIP; future installer/release workflows must preserve the same source and notice distribution.

## FFmpeg / FFprobe (Windows x64 development ZIP)

Independent local-only executables from FFmpeg revision `38b88335f99e76ed89ff3c93f877fdefce736c13` (8.1.2), built with the LGPL configuration, no GPL/nonfree options and no external codec libraries. Tsugi uses the tools to inspect and decode-check downloaded audio without re-encoding the original file. The corresponding source archive, configuration, license notices and build script accompany the executables in `media-tools/source/`; see `media-tools/SOURCE.txt` and `SHA256SUMS`. No FFmpeg libraries are linked into Tsugi. Additional export formats are not enabled in this candidate.

## External addon identity artwork and release discovery

The Watch account import and installed-addon lists may display public logo artwork declared in a selected Stremio-compatible manifest. These images are retrieved from a restricted set of public HTTPS artwork origins at runtime, not included in the distributed application. Logo and trademark rights remain with the respective addon and service owners; no ownership or endorsement is implied. Unavailable or unsupported artwork uses Tsugi's neutral addon glyph. Configured manifest endpoints and account credentials are not used as renderer artwork URLs.

The Windows release check reads metadata from the official [Tsugi GitHub Releases](https://github.com/G1NYU/TSUGI/releases) page. The application offers a link to the verified stable release; it does not download or overwrite program files automatically.

## Launcher artwork (portable live-acceptance build)

The recovery candidate includes six launcher images in `packages/web/public/design/launch/`: `launch-purple.jpg` is the exact user-provided purple wallpaper (SHA-256 `aaa60e2c16ef1692449dc2f866156b3af32568acf1e86ac55ac26c72d7c7ec9f`), `world-hero.webp` is an optimized version of the user-provided monochrome landscape, and `world-video.webp`, `world-music.webp`, `world-read.webp`, and `world-vault.webp` are distinct generated dark illustrations based on the supplied visual direction. This is a user-requested development candidate for live acceptance. The provenance note does not establish ownership or permission for broader public redistribution of supplied reference imagery. Review artwork rights before any stable publication.

## TVmaze public series discovery

The Discover Series Hub uses the [TVmaze public API](https://www.tvmaze.com/api) for broadcast and web schedules and show search. TVmaze data is attributed in the interface and is licensed under [CC BY-SA](https://creativecommons.org/licenses/by-sa/4.0/); the selected titles are a filtered, normalized view of the source data. Remote poster images are linked from the TVmaze CDN, not bundled. Requests contain only public schedule dates, country codes and user-entered title queries, no account or playback credentials. Only explicitly mapped IMDb identities enter the existing Watch route; no TVDB key or direct TVDB service is used.
