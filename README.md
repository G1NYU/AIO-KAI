<p align="center">
  <img src="branding/tsugi-mark.svg" width="104" height="104" alt="Tsugi brush mark">
</p>

<h1 align="center">Tsugi <sub>次</sub></h1>

<p align="center">
  Movies, television, music and manga in one desktop application.
</p>

<p align="center">
  <a href="https://github.com/G1NYU/TSUGI/actions/workflows/tsugi-unified-windows.yml">Development builds</a> &nbsp;·&nbsp;
  <a href="https://github.com/G1NYU/TSUGI/tree/feature/tsugi-read-runtime">Source</a> &nbsp;·&nbsp;
  <a href="https://github.com/G1NYU/TSUGI/issues">Issues</a> &nbsp;·&nbsp;
  <a href="LICENSE">License</a>
</p>

<br>

Tsugi (次, *next*) is an independent, open-source desktop media project built on AIOStreams. It brings video, music and reading into a shared workspace while retaining the strengths of the individual media engines. Switch between your library, albums and chapters without managing separate applications or separate appearance settings.

**Development preview · Windows x64.** The unified application is being developed on [`feature/tsugi-read-runtime`](https://github.com/G1NYU/TSUGI/tree/feature/tsugi-read-runtime). The default branch remains the upstream baseline with project documentation. There is no stable Tsugi release yet.

## Movies & TV

Connect an existing AIOStreams or compatible Jellyfin server and use its media catalogues from Tsugi.

- Home, discovery, search, favourites, series and movie detail pages.
- Native mpv playback, subtitles, audio tracks and server-provided stream versions.
- Continue Watching, watch history and server-supported features such as watch state, live television and playlists.
- AIOStreams source filtering, sorting and formatting remain available through the configured server.

For server configuration and hosting, refer to the [AIOStreams documentation](https://aiostreams.org/). Tsugi does not require the user to replace their existing server.

## Music

A dedicated music library and player, separate from the video server connection.

- Native YouTube Music provider integration using the packaged yt-dlp and Deno tools.
- Eclipse-compatible music addon manifests and community addon discovery.
- Track, album, artist and playlist search, playback queues, shuffle and repeat.
- Local audio files, remembered folders, saved tracks and playlists.
- Player layouts, imported Eclipse Studio layouts and local-file equalizer profiles.
- Background music while browsing manga or reading a chapter, with compact playback controls and return to the same chapter when switching back from Music.

Live YouTube Music playback across reading and music on Windows still requires physical acceptance testing. Local audio continuity and the simulated native audio protocol have passed automated browser tests.

## Read

A native reading interface backed by a Tsugi-managed [Suwayomi Server](https://github.com/Suwayomi/Suwayomi-Server) runtime.

- Manga and manhwa library, installed sources, extension repositories and global source search.
- User-supplied Mihon-compatible extension repositories, searchable and filterable extension catalogue, explicit installation.
- Manga details, chapter lists, reading progress, bookmarks and resume reading.
- Continuous vertical scrolling, single-page and two-page layouts, reading direction, zoom and adjustable page spacing.
- Focus mode hides interface controls for an uninterrupted reading view.
- Initial MyAnimeList and AniList account integration, explicit series matching and manual progress sync. Live account authorization and remote sync still need verification.

Extension compatibility varies by source. Repositories and extensions are not bundled, and cover availability depends on the source.

## One workspace

Movies & TV, Music and Read share a palette, typography, category navigation and app appearance settings. Media-specific preferences stay within their respective sections. The reader can keep its current chapter open during a visit to Music; video playback remains exclusive with music to avoid competing audio.

## Getting started

The current development package is a **portable Windows x64 ZIP**, not an installer. A GitHub account may be required to download Actions artifacts.

- Open [Unified Tsugi Windows Build](https://github.com/G1NYU/TSUGI/actions/workflows/tsugi-unified-windows.yml) and select a successful **packaging** run with the `Tsugi-Windows-x64-test` artifact. Source-only validation runs do not contain the executable package.
- Download the artifact and extract the complete ZIP (including the `.portable` marker) into a writable folder.
- Open `current/Tsugi.exe` directly. Keep the rest of the extracted files beside it.
- For Movies & TV, enter your media server address. For Music, connect a supported source or open local audio.
- On the first visit to Read, choose **Set up reading**. Tsugi downloads and verifies the pinned upstream reading runtime. Then open **Settings / Browse / Sources / Extension repositories** to add a trusted repository, and use **Extensions** to install a source.

No separate Java installation, command prompt or manual reader launcher is required for normal use. Internet access is required for reading setup and remote media. Portable application data is stored alongside the extracted application; keep that folder when upgrading or back it up before replacing it.

> **Preview status:** packaged artifacts expire, and may be older than the newest source revision. Check the build's commit before testing. Do not treat a green source-only run as a fresh Windows download.

## Development

| Component | Foundation |
| :--- | :--- |
| Desktop | Rust, native Windows shell, WebView2 |
| Interface | React, TypeScript, shared CSS tokens |
| Video | AIOStreams, Jellyfin API, mpv |
| Music | Eclipse-compatible providers, yt-dlp, Deno |
| Reading | Suwayomi, authenticated local native bridge |
| Validation | Vitest, Playwright, Cargo and GitHub Actions |

The active source branch contains the unified app and the Windows packaging workflow. Node.js 24+, pnpm 11+ and the Rust toolchain are used by the build.

```sh
git clone --branch feature/tsugi-read-runtime https://github.com/G1NYU/TSUGI.git
cd TSUGI
corepack enable
pnpm install --frozen-lockfile
pnpm -F @aiostreams/core build
pnpm -F @aiostreams/web typecheck
pnpm -F @aiostreams/web lint
```

For native staging, dependency pins and the complete packaging procedure, see the [Windows workflow](https://github.com/G1NYU/TSUGI/blob/feature/tsugi-read-runtime/.github/workflows/tsugi-unified-windows.yml). Reading runtime integration and security acceptance are documented in the [runtime notes](https://github.com/G1NYU/TSUGI/blob/feature/tsugi-read-runtime/docs/tsugi-read-runtime.md). Development history is tracked in [PROGRESS.md](https://github.com/G1NYU/TSUGI/blob/feature/tsugi-read-runtime/PROGRESS.md).

### Current status

The [latest validated implementation checkpoint](https://github.com/G1NYU/TSUGI/actions/runs/45446115121) passed Windows compilation, TypeScript, lint, 74 regression tests and browser interaction smoke, including continuous local audio during reading and simulated native audio transitions.

Remaining acceptance work includes the physical Windows interface, actual YouTube Music playback during reading, tracker account authorization and sync, source-specific extension compatibility and the next unified package. Refract and MangaBaka integrations are not currently shipped.

## Credits & license

Tsugi is maintained by [giinyu](https://github.com/G1NYU) as an independent fork of [Viren070/AIOStreams](https://github.com/Viren070/AIOStreams). It is not an official AIOStreams, Suwayomi, Mihon, Jellyfin or YouTube application.

The project builds on the work of [AIOStreams](https://github.com/Viren070/AIOStreams), [Suwayomi](https://github.com/Suwayomi/Suwayomi-Server), [Jellyfin](https://jellyfin.org/), [mpv](https://mpv.io/), [FFmpeg](https://ffmpeg.org/), [libass](https://github.com/libass/libass), [yt-dlp](https://github.com/yt-dlp/yt-dlp), [Deno](https://github.com/denoland/deno) and the Eclipse music ecosystem. The reading experience draws inspiration from [Mihon](https://github.com/mihonapp/mihon) and [Seanime](https://github.com/5rahim/seanime).

The upstream project's full credits, history and documentation remain available in [AIOStreams](https://github.com/Viren070/AIOStreams). See the [desktop third-party notices](https://github.com/G1NYU/TSUGI/blob/feature/tsugi-read-runtime/packages/desktop/THIRD-PARTY.md) for packaged components and their individual licenses. Tsugi source is provided under the [GNU Affero General Public License v3.0](LICENSE).

Tsugi does not provide a bundled media catalogue or host a content service. Use sources you are authorized to access and comply with their terms and applicable law. Third-party reading extensions execute with your account's permissions; only install extensions from publishers you trust. Extension signatures are not independently verified.
