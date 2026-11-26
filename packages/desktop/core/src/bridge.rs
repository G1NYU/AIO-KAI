//! Messages between the page and the shell.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::discord::Presence;
use crate::licenses::LicenseList;
use crate::now_playing::{self, MediaKey};
use crate::playback::{Change, Chapter, Load, PlayerState, Settings, Style, SubtitleLine, Track};

/// Bumped when a message changes shape, so pages can tell shells apart.
pub const PROTOCOL_VERSION: u32 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UpdateChannel {
    Stable,
    Nightly,
}

/// Where the page's mini player leaves room for the video, in the page's pixels.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoFrame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// Dragged by the app, which then says where it let go.
    #[serde(default)]
    pub draggable: bool,
    /// Under something the page shows over it.
    #[serde(default)]
    pub hidden: bool,
    /// Moves there as the page's card does.
    #[serde(default)]
    pub animate: bool,
    /// The top corners' and the bottom corners'.
    #[serde(default)]
    pub radius: f64,
    #[serde(default)]
    pub bottom_radius: f64,
    /// Subtitles show while small.
    #[serde(default = "shown")]
    pub subtitles: bool,
}

fn shown() -> bool {
    true
}

/// Reviewed additive restore against an exact cached chapter identity and state.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MangaProgressPatch {
    pub identity: String,
    pub expected_read: bool,
    pub expected_bookmarked: bool,
    pub expected_last_page: u32,
    pub expected_page_count: u32,
    pub expected_last_read_at: String,
    pub mark_read: bool,
    pub bookmark: bool,
    pub page: Option<u32>,
}

/// Publisher-declared engine metadata, not a per-title safety assessment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReadContentWarning { Safe, Mixed, Nsfw }

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum SourcePreferenceValue { Bool(bool), Choice(u32) }

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MihonImportInput {
    pub manga: Vec<MihonImportManga>, pub categories: Vec<String>,
    pub include_partial_pages: bool, pub include_trackers: bool,
}
impl std::fmt::Debug for MihonImportInput {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("MihonImportInput(<private library metadata>)")
    }
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MihonImportManga {
    pub source_id: String, pub url: String, pub title: String, pub categories: Vec<String>,
    pub chapters: Vec<MihonImportChapter>, pub trackers: Vec<MihonImportTracker>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MihonImportChapter {
    pub url: String, pub name: String, pub read: bool, pub bookmark: bool,
    pub page: i32, pub chapter_number: f32, pub source_order: i32, pub last_read_at: String,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MihonImportTracker { pub tracker_id: i32, pub remote_id: String }

/// Fixed reading operations; the page cannot send arbitrary GraphQL,
/// local paths, upstream URLs for pages, or authentication credentials.
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum ReadAction {
    Prepare,
    Status,
    Sources,
    SourceInventory,
    SourcePreferences { source: String },
    ApplySourcePreference { review_id: String, control_id: String, value: SourcePreferenceValue },
    CancelSourcePreferences { review_id: String },
    Library,
    LibraryPage { offset: u32 },
    History,
    Updates,
    Categories,
    SaveCategory { id: Option<i32>, name: String },
    DeleteCategory { id: i32 },
    AssignCategory { manga_id: i32, category_id: i32, assigned: bool },
    CachedManga { id: i32 },
    BackupManga { id: i32 },
    RestoreMangaProgress { id: i32, identity: String, changes: Vec<MangaProgressPatch> },
    LibraryUpdateStatus,
    StartLibraryUpdate,
    Stores,
    AddStore { index: String },
    RemoveStore { index: String },
    RefreshExtensions,
    Extensions { offset: u32, query: Option<String>, store: Option<String>, language: Option<String>, installed: Option<bool>, #[serde(default)] updates_only: bool, #[serde(default)] obsolete_only: bool, content_warning: Option<ReadContentWarning> },
    InstallExtension { package: String },
    UpdateExtension { package: String },
    UninstallExtension { package: String },
    Catalogue { source: String, page: u32, mode: String, query: Option<String> },
    Manga { id: i32 },
    Cover { id: i32 },
    ExtensionIcon { package: String },
    SetLibrary { id: i32, in_library: bool },
    Chapter { id: i32 },
    CloseChapter { chapter_id: i32, session: String },
    DownloadStatus {},
    EnqueueDownloads { ids: Vec<i32> },
    CancelDownloads { ids: Vec<i32> },
    RetryDownloads { ids: Vec<i32> },
    PauseDownloads {},
    ResumeDownloads {},
    BeginLocalImport {},
    ApplyLocalImport { review_id: String },
    CancelLocalImport { review_id: String },
    ReviewMihonImport { input: MihonImportInput },
    ApplyMihonImport { review_id: String },
    CancelMihonImport { review_id: String },
    Page { chapter_id: i32, index: usize },
    Progress { chapter_id: i32, index: usize, finished: bool },
    DownloadCleanupCandidates { offset: u32 },
    ReviewDownloadCleanup { ids: Vec<i32> },
    ApplyDownloadCleanup { review_id: String },
    CancelDownloadCleanup { review_id: String },
    ReviewImageCacheCleanup {},
    ApplyImageCacheCleanup { review_id: String },
    CancelImageCacheCleanup { review_id: String },
    Trackers,
    TrackerLogin { id: i32 },
    TrackerLogout { id: i32 },
    TrackRecords { manga_id: i32 },
    TrackerSearch { id: i32, query: String },
    TrackerBind { manga_id: i32, id: i32, remote_id: String },
    TrackerUnbind { manga_id: i32, record_id: i32 },
    TrackerSync { manga_id: i32 },
    ChapterFlags { ids: Vec<i32>, read: Option<bool>, bookmarked: Option<bool> },
}

#[cfg(test)]
mod reading_metadata_tests {
    use super::*;

    #[test]
    fn image_cache_cleanup_bridge_accepts_only_review_capabilities() {
        assert!(serde_json::from_value::<ReadAction>(serde_json::json!({"kind":"review-image-cache-cleanup"})).is_ok());
        for extra in ["path", "url", "downloadedThumbnails", "cachedPages", "deleteFiles"] {
            let mut input = serde_json::json!({"kind":"review-image-cache-cleanup"});
            input[extra] = serde_json::json!(true);
            assert!(serde_json::from_value::<ReadAction>(input).is_err());
        }
        for kind in ["apply-image-cache-cleanup", "cancel-image-cache-cleanup"] {
            assert!(serde_json::from_value::<ReadAction>(serde_json::json!({"kind":kind,"reviewId":"a".repeat(32)})).is_ok());
            for invalid in [serde_json::json!({"kind":kind}), serde_json::json!({"kind":kind,"reviewId":3}),
                serde_json::json!({"kind":kind,"reviewId":"a".repeat(32),"path":"C:/outside"})] {
                assert!(serde_json::from_value::<ReadAction>(invalid).is_err());
            }
        }
    }

    #[test]
    fn extension_metadata_filters_preserve_old_defaults_and_accept_only_known_labels() {
        let action: ReadAction = serde_json::from_value(serde_json::json!({"kind": "extensions", "offset": 0})).unwrap();
        assert!(matches!(action, ReadAction::Extensions { updates_only: false, obsolete_only: false, content_warning: None, .. }));
        for (label, expected) in [("SAFE", ReadContentWarning::Safe), ("MIXED", ReadContentWarning::Mixed), ("NSFW", ReadContentWarning::Nsfw)] {
            let action: ReadAction = serde_json::from_value(serde_json::json!({"kind": "extensions", "offset": 100,
                "contentWarning": label, "obsoleteOnly": true})).unwrap();
            assert!(matches!(action, ReadAction::Extensions { offset: 100, obsolete_only: true, content_warning: Some(value), .. } if value == expected));
        }
        for value in [serde_json::json!("safe"), serde_json::json!("UNKNOWN"), serde_json::json!(true), serde_json::json!(0)] {
            assert!(serde_json::from_value::<ReadAction>(serde_json::json!({"kind": "extensions", "offset": 0, "contentWarning": value})).is_err());
        }
        assert!(serde_json::from_value::<ReadAction>(serde_json::json!({"kind": "extensions", "offset": 0, "isNsfw": true})).is_err());
        assert!(serde_json::from_value::<ReadAction>(serde_json::json!({"kind": "extensions", "offset": 0, "obsoleteOnly": "true"})).is_err());
    }

    #[test]
    fn source_setting_bridge_accepts_only_boolean_or_nonnegative_choice_index() {
        for value in [serde_json::json!(false), serde_json::json!(true), serde_json::json!(0), serde_json::json!(63)] {
            assert!(serde_json::from_value::<ReadAction>(serde_json::json!({"kind":"apply-source-preference","reviewId":"a".repeat(32),"controlId":"b".repeat(32),"value":value})).is_ok());
        }
        for value in [serde_json::json!("raw value"), serde_json::json!(-1), serde_json::json!(1.5), serde_json::json!([]), Value::Null] {
            assert!(serde_json::from_value::<ReadAction>(serde_json::json!({"kind":"apply-source-preference","reviewId":"a".repeat(32),"controlId":"b".repeat(32),"value":value})).is_err());
        }
        assert!(serde_json::from_value::<ReadAction>(serde_json::json!({"kind":"source-preferences","source":"12345","key":"private"})).is_err());
    }

    #[test]
    fn chapter_download_bridge_exposes_only_fixed_controls_and_integer_ids() {
        for kind in ["download-status", "pause-downloads", "resume-downloads"] {
            assert!(serde_json::from_value::<ReadAction>(serde_json::json!({"kind":kind})).is_ok());
            assert!(serde_json::from_value::<ReadAction>(serde_json::json!({"kind":kind,"url":"https://example.invalid"})).is_err());
        }
        for kind in ["enqueue-downloads", "cancel-downloads", "retry-downloads"] {
            assert!(serde_json::from_value::<ReadAction>(serde_json::json!({"kind":kind,"ids":[1,2147483647]})).is_ok());
            for ids in [serde_json::json!(["1"]),serde_json::json!([1.5]),serde_json::json!([true]),serde_json::json!([2147483648u64])] {
                assert!(serde_json::from_value::<ReadAction>(serde_json::json!({"kind":kind,"ids":ids})).is_err());
            }
            assert!(serde_json::from_value::<ReadAction>(serde_json::json!({"kind":kind,"ids":[1],"deleteFiles":true})).is_err());
        }
    }

    #[test]
    fn local_import_bridge_accepts_only_native_picker_and_review_capability() {
        assert!(serde_json::from_value::<ReadAction>(serde_json::json!({"kind":"begin-local-import"})).is_ok());
        for extra in ["path", "url", "archive", "title"] {
            let mut value = serde_json::json!({"kind":"begin-local-import"});
            value[extra] = serde_json::json!("untrusted");
            assert!(serde_json::from_value::<ReadAction>(value).is_err());
        }
        for kind in ["apply-local-import", "cancel-local-import"] {
            assert!(serde_json::from_value::<ReadAction>(serde_json::json!({"kind":kind,"reviewId":"a".repeat(32)})).is_ok());
            assert!(serde_json::from_value::<ReadAction>(serde_json::json!({"kind":kind,"reviewId":42})).is_err());
            assert!(serde_json::from_value::<ReadAction>(serde_json::json!({"kind":kind,"reviewId":"a".repeat(32),"path":"C:/outside.cbz"})).is_err());
        }
    }
}

/// Managed backup operations accept no arbitrary paths.
#[derive(Debug, Deserialize)]
#[serde(tag="kind",rename_all="kebab-case",deny_unknown_fields)]
pub enum BackupAction {
    List,
    Storage { #[serde(default)] detailed: bool },
    Save { archive: String },
    SaveScheduled { archive: String, keep: usize },
    Open { name: String },
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum Inbound {
    /// `external` messages go to the player started with `external-open`.
    PlayerLoad {
        #[serde(flatten)]
        load: Load,
        #[serde(default)]
        external: bool,
    },
    PlayerStop {
        #[serde(default)]
        external: bool,
    },
    /// Drops the files queued after the playing one.
    PlayerUnqueue {
        #[serde(default)]
        external: bool,
    },
    PlayerSet {
        #[serde(flatten)]
        change: Change,
        #[serde(default)]
        external: bool,
    },
    PlayerSeek {
        position_ms: f64,
        #[serde(default)]
        external: bool,
    },
    /// Adds a subtitle from the server and shows it, in place of track `replace`.
    PlayerSubtitleAdd {
        url: String,
        title: String,
        language: String,
        replace: Option<u64>,
        #[serde(default)]
        external: bool,
    },
    /// The app's own player only: the user's player keeps its own look.
    PlayerStyle(Style),
    /// mpv's stats overlay, on one of its pages or off.
    PlayerStatsOverlay {
        page: Option<String>,
        #[serde(default)]
        external: bool,
    },
    /// Reports the lines of one of the file's own subtitles as mpv reads them, or stops with `None`.
    PlayerSubtitleLines {
        track: Option<String>,
    },
    /// Answered with `player-subtitle-index` once the file's index has been read.
    PlayerSubtitleIndex,
    /// Answered with `player-thumbnail`s for the keyframe at or before the position, newest asked
    /// first, except the one at `showing_ms` the page has; without a position, reads the file's
    /// index ahead of the first.
    PlayerThumbnail {
        url: String,
        #[serde(default)]
        headers: BTreeMap<String, String>,
        position_ms: Option<f64>,
        showing_ms: Option<f64>,
    },
    /// Reports the player's whole state again.
    PlayerSync {
        #[serde(default)]
        external: bool,
    },
    PlayerSettings(Settings),
    /// A key the page left alone, in mpv's name for it, for the user's own key bindings.
    PlayerKey {
        key: String,
    },
    /// Answered with `youtube-resolved` carrying the same `request`.
    YoutubeResolve {
        request: String,
        id: String,
    },
    YoutubeMusicRequest {
        request: String,
        operation: String,
        value: String,
    },
    TorboxRequest { request: String, operation: String, value: String },
    ReadRequest {
        request: String,
        action: ReadAction,
    },
    BackupRequest { request: String, action: BackupAction },
    TsugiReleaseCheck { request: String },
    MusicAudioLoad {
        request: String,
        url: String,
        volume: f64,
    },
    MusicAudioPrefetch {
        request: String,
        url: Option<String>,
    },
    MusicAudioControl {
        request: String,
        action: String,
        value: f64,
    },
    /// Asks for an `audio-devices` answer.
    AudioDevices,
    /// A subtitle file the user dropped or picked, base64-encoded.
    SubtitleFile {
        name: String,
        data: String,
        #[serde(default)]
        external: bool,
    },
    /// Asks for an `external-players` answer.
    ExternalPlayers,
    /// Lets the user pick where a player is installed.
    ExternalChoose {
        player: String,
    },
    /// Starts the player, or keeps the one already open, for the next `loadfile`.
    ExternalOpen {
        player: String,
        title: Option<String>,
    },
    ExternalClose,
    Fullscreen {
        value: Option<bool>,
    },
    /// Shrinks the window to the video, over other windows; `None` toggles.
    Pip {
        value: Option<bool>,
    },
    /// The video small over the page, where its mini player leaves room; none fills the window
    /// behind the page again.
    PlayerFrame {
        frame: Option<VideoFrame>,
    },
    Minimize,
    Close,
    /// Moves the window with the mouse, from a press on the page's title strip.
    WindowDrag,
    /// Resizes from the top edge, which the page covers: `n`, `ne` or `nw`.
    WindowResize {
        edge: String,
    },
    WindowMaximize,
    /// Asks for a `window-state` answer.
    WindowState,
    /// Shows or hides the system's own window buttons, where it draws them over the page.
    WindowButtons {
        visible: bool,
    },
    AppInfo,
    /// Picks the output that draws the video from the next start, then answers with a
    /// `video-output`; `None` only asks.
    VideoOutput {
        output: Option<String>,
    },
    /// Quits and opens the app again.
    Restart,
    OpenMpvConfig,
    OpenLogs,
    /// Versions, paths and the recent log, for a bug report; the page names its own build and the server's.
    Diagnostics {
        web: Option<String>,
        server: Option<String>,
    },
    /// The licences of what the app ships besides the page.
    Licenses,
    /// Checks for an update and downloads it; `None` keeps the installed channel.
    UpdateCheck {
        channel: Option<UpdateChannel>,
    },
    /// Restarts into a downloaded update.
    UpdateApply,
    /// An error from the page: uncaught, or passed to `console.error`.
    WebError {
        message: String,
    },
    /// A line the page writes to the app's log.
    Log {
        level: PageLogLevel,
        message: String,
    },
    /// What Discord shows the user doing; `None` clears it.
    Presence {
        presence: Option<Presence>,
    },
    /// Explicit opt-in policy; disabled until configured by this page session.
    DiscordConfigure { config: crate::discord::Config },
    /// Connects to Discord if enabled and answers with a `discord-status`.
    DiscordCheck,
    /// The title the player shows; `None` once it closes.
    NowPlaying {
        item: Option<now_playing::Item>,
    },
    /// The page can take `link` messages, and any that arrived before it loaded.
    LinksReady,
    /// Downloads to fetch; one already known keeps its state.
    DownloadAdd {
        jobs: Vec<DownloadJob>,
    },
    /// `pause`, `resume` or `retry`.
    DownloadControl {
        id: String,
        action: String,
    },
    /// Forgets a download, and with `files` deletes what it saved.
    DownloadRemove {
        id: String,
        files: bool,
    },
    /// Asks for a `download-state` answer.
    DownloadList,
    /// Lets the user pick the folder new downloads go to.
    DownloadFolder,
    /// Shows the downloads folder, or one download's, in the file manager.
    DownloadOpen {
        id: Option<String>,
    },
    DownloadConfig {
        concurrent: u32,
    },
    VaultRate {
        mib: u32,
    },
}

static REFUSED: Mutex<BTreeSet<String>> = Mutex::new(BTreeSet::new());

/// A page message, or `None` for one this version can't read, logged once per type.
pub fn parse(body: &str) -> Option<Inbound> {
    let error = match serde_json::from_str(body) {
        Ok(message) => return Some(message),
        Err(e) => e.to_string(),
    };
    let kind = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v["type"].as_str().map(String::from))
        .unwrap_or_default();
    if REFUSED.lock().is_ok_and(|mut r| r.insert(kind.clone())) {
        if kind == "backup-request" {
            log::warn!("ignored a malformed managed backup request");
        } else if error.starts_with("unknown variant") {
            log::warn!("ignored {kind} messages, which this version doesn't know");
        } else {
            log::warn!("ignored a {kind} message: {error}");
        }
    }
    None
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PageLogLevel {
    Info,
    Warn,
}

impl From<PageLogLevel> for log::Level {
    fn from(level: PageLogLevel) -> Self {
        match level {
            PageLogLevel::Info => log::Level::Info,
            PageLogLevel::Warn => log::Level::Warn,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileKind {
    Video,
    Subtitle,
    Image,
    Vault,
}

/// A file to fetch, at a path relative to the downloads folder.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadFile {
    pub url: String,
    pub path: String,
    pub kind: FileKind,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub headers: BTreeMap<String, String>,
}

/// A file the page writes itself, such as the item's details.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadText {
    pub path: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadJob {
    pub id: String,
    pub title: String,
    pub files: Vec<DownloadFile>,
    #[serde(default)]
    pub texts: Vec<DownloadText>,
}

#[derive(Debug, Serialize)]
pub struct DownloadStatus {
    pub id: String,
    /// `queued`, `downloading`, `paused`, `failed` or `done`.
    pub state: &'static str,
    pub bytes: u64,
    pub total: Option<u64>,
    pub error: Option<String>,
    /// Where a finished download's video and subtitles are, for playing it.
    pub video: Option<String>,
    pub subtitles: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vault_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vault_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Outbound {
    YoutubeResolved {
        request: String,
        url: Option<String>,
        #[serde(rename = "originalLanguage", skip_serializing_if = "Option::is_none")]
        original_language: Option<String>,
    },
    YoutubeMusicResult {
        request: String,
        data: Option<Value>,
        error: Option<String>,
    },
    TorboxResult { request: String, data: Option<Value>, error: Option<String> },
    BackupResult { request: String, data: Option<Value>, error: Option<String> },
    TsugiReleaseResult { request: String, data: Option<Value>, error: Option<String> },
    ReadResult {
        request: String,
        data: Option<Value>,
        error: Option<String>,
    },
    MusicAudioMeter {
        request: String,
        level: f64,
    },
    MusicAudioDsp {
        request: String,
        error: Option<String>,
    },
    MusicAudioState {
        request: String,
        status: String,
        position: f64,
        duration: f64,
        error: Option<String>,
    },
    PlayerState {
        #[serde(flatten)]
        state: PlayerState,
        #[serde(skip_serializing_if = "is_false")]
        external: bool,
    },
    PlayerTracks {
        tracks: Vec<Track>,
        #[serde(skip_serializing_if = "is_false")]
        external: bool,
    },
    PlayerChapters {
        chapters: Vec<Chapter>,
        #[serde(skip_serializing_if = "is_false")]
        external: bool,
    },
    PlayerSubtitleLines {
        track: String,
        lines: Vec<SubtitleLine>,
    },
    /// Each of the file's own subtitles' lines from its index by mpv id, or none without one.
    PlayerSubtitleIndex {
        tracks: Option<BTreeMap<String, Vec<SubtitleLine>>>,
    },
    /// Where the page loads the JPEG of the keyframe at `position_ms`; without a `src` the file
    /// has no thumbnails.
    PlayerThumbnail {
        url: String,
        #[serde(rename = "positionMs", skip_serializing_if = "Option::is_none")]
        position_ms: Option<u64>,
        src: Option<String>,
    },
    /// `start`, `loaded` or `restart`.
    PlayerEvent {
        name: &'static str,
        #[serde(skip_serializing_if = "is_false")]
        external: bool,
    },
    /// For the app's own HDR output; never sent to the page.
    VideoColour {
        gamma: Option<String>,
        primaries: Option<String>,
    },
    /// For the app's picture-in-picture window; never sent to the page.
    VideoAspect {
        aspect: Option<f64>,
    },
    PlayerEnded {
        reason: &'static str,
        error: Option<String>,
        /// The HTTP status a failed load answered with.
        #[serde(skip_serializing_if = "Option::is_none")]
        status: Option<u16>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<String>,
        #[serde(skip_serializing_if = "is_false")]
        external: bool,
    },
    /// The players this computer can start; empty where the app may not start programs.
    ExternalPlayers {
        players: Vec<ExternalPlayer>,
    },
    /// The external player closed, or with `error`, never started.
    ExternalEnded {
        error: Option<String>,
    },
    Fullscreen {
        value: bool,
    },
    Pip {
        value: bool,
    },
    /// A click on the small video (`tap`), a drag of it starting (`grabbed`), where it is as it
    /// drags (`moving`), or where the drag let go (`moved`), in the page's pixels.
    PlayerFrame {
        event: &'static str,
        #[serde(skip_serializing_if = "Option::is_none")]
        x: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        y: Option<f64>,
    },
    WindowState {
        maximized: bool,
    },
    AppInfo {
        app: &'static str,
        platform: &'static str,
        mpv: Option<String>,
        ffmpeg: Option<String>,
        #[serde(rename = "ac3Encoder")]
        ac3_encoder: bool,
        /// The graphics card can upscale video itself.
        #[serde(rename = "superResolution")]
        super_resolution: bool,
    },
    /// `outputs` is empty where there is no choice.
    VideoOutput {
        outputs: Vec<&'static str>,
        running: &'static str,
        chosen: &'static str,
    },
    /// mpv's `audio-device-list`.
    AudioDevices {
        devices: Value,
    },
    Diagnostics {
        text: String,
    },
    Licenses(LicenseList),
    /// `checking`, `downloading`, `ready`, `current`, `error`, or `off` for a
    /// copy Velopack did not install.
    UpdateState {
        state: &'static str,
        channel: Option<UpdateChannel>,
        version: Option<String>,
        error: Option<String>,
    },
    /// `connected`, `not-found`, `failed` or `refused`, with the reason for the last two.
    DiscordStatus {
        state: &'static str,
        message: Option<String>,
    },
    /// An `aiostreams://` link the app was opened with.
    Link {
        url: String,
    },
    MediaKey {
        key: MediaKey,
    },
    Error {
        message: String,
    },
    DownloadState {
        folder: String,
        vault_rate_mib: u32,
        aria2_available: bool,
        jobs: Vec<DownloadStatus>,
    },
    /// The running download's video; `speed` in bytes a second.
    DownloadProgress {
        id: String,
        bytes: u64,
        total: Option<u64>,
        speed: u64,
    },
}

#[derive(Debug, Serialize)]
pub struct ExternalPlayer {
    pub id: &'static str,
    pub path: Option<String>,
}

fn is_false(value: &bool) -> bool {
    !value
}

impl Outbound {
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }
}

pub fn origin(url: &str) -> Option<String> {
    let url = url::Url::parse(url).ok()?;
    let origin = url.origin();
    // A custom scheme's origin is opaque, "null" for every such page, so it is spelled out.
    if origin.is_tuple() {
        Some(origin.ascii_serialization())
    } else {
        Some(format!("{}://{}", url.scheme(), url.host_str()?))
    }
}
