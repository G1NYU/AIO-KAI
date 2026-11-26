//! Reviewed removal of the pinned runtime's disposable image files. The JVM
//! uses our private java.io.tmpdir, so only Tachidesk/{manga-cache,thumbnails}
//! belong here. Browser sessions, downloads and legacy shared TEMP never do.
//! Keep the runtime stopped and directory/file handles pinned during removal;
//! upstream's unbounded recursive clearCachedImages mutation is not used.
use super::*;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::time::SystemTime;

const MAX_ENTRIES: usize = 20_000;
const MAX_DEPTH: usize = 16;
const MAX_FILE: u64 = 512 * 1024 * 1024;
const MAX_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const SCAN_TIME: Duration = Duration::from_secs(60);
const REVIEW_LIFETIME: Duration = Duration::from_secs(600);
const STALE: &str = "The Reader image cache changed or the review expired. Review the cache again. No images were removed.";
const UNSAFE: &str = "A Reader image cache path is redirected, shared, or outside private storage. No images were removed.";
const UNVERIFIED: &str = "The Reader image cache could not be verified within its safety limits. No images were removed.";
const IN_USE: &str = "A Reader image cache file is in use or cannot be removed. Close it and review the cache again. No images were removed.";
const BUSY: &str = "Finish Reader downloads and library updates, and disable automatic jobs before clearing cached images. No images were removed.";

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Kind { Pages, Thumbnails }
impl Kind {
    fn index(self) -> usize { match self { Self::Pages => 0, Self::Thumbnails => 1 } }
    fn name(self) -> &'static str { match self { Self::Pages => "pages", Self::Thumbnails => "thumbnails" } }
    fn directory(self) -> &'static str { match self { Self::Pages => "manga-cache", Self::Thumbnails => "thumbnails" } }
}
const KINDS: [Kind; 2] = [Kind::Pages, Kind::Thumbnails];

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct Totals { files: u32, bytes: u64 }

#[derive(Clone, Debug, PartialEq, Eq)]
enum Stamp {
    Directory { created: SystemTime },
    File { bytes: u64, created: SystemTime, modified: SystemTime, sha256: [u8; 32] },
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Entry { relative: PathBuf, kind: Kind, stamp: Stamp }

#[derive(Clone, Debug, PartialEq, Eq)]
struct Snapshot {
    parents: Vec<(PathBuf, SystemTime)>,
    entries: Vec<Entry>,
    totals: [Totals; 2],
}

impl Snapshot {
    fn files(&self) -> u32 { self.totals.iter().map(|total| total.files).sum() }
    fn bytes(&self) -> u64 { self.totals.iter().map(|total| total.bytes).sum() }
}

struct Inventory {
    snapshot: Snapshot,
    // Denying FILE_SHARE_DELETE on every directory prevents a reviewed parent
    // from being renamed/replaced while its descendants are being inspected.
    _directories: Vec<fs::File>,
    files: Vec<(Entry, fs::File)>,
}

/// One-use, process-bound capability. Paths, hashes and handles stay native.
pub struct ImageCacheCleanupReview {
    id: String,
    created: Instant,
    owner_pid: u32,
    port: u16,
    data_path: PathBuf,
    snapshot: Snapshot,
    description: String,
}

impl ImageCacheCleanupReview {
    pub fn id(&self) -> &str { &self.id }
    pub fn description(&self) -> &str { &self.description }
    pub fn preview(&self) -> Value {
        json!({"reviewId": self.id, "groups": KINDS.iter().map(|kind| {
            let total = self.snapshot.totals[kind.index()];
            json!({"kind": kind.name(), "files": total.files, "bytes": total.bytes})
        }).collect::<Vec<_>>(), "totalFiles": self.snapshot.files(), "totalBytes": self.snapshot.bytes(),
            "expiresInSeconds": REVIEW_LIFETIME.as_secs()})
    }
}

fn metadata(path: &Path) -> Result<Option<fs::Metadata>, &'static str> {
    match fs::symlink_metadata(path) {
        Ok(meta) => { safe_metadata(&meta)?; Ok(Some(meta)) }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(UNVERIFIED),
    }
}

fn safe_metadata(meta: &fs::Metadata) -> Result<(), &'static str> {
    #[cfg(windows)]
    let redirected = { use std::os::windows::fs::MetadataExt; meta.file_attributes() & 0x400 != 0 };
    #[cfg(not(windows))]
    let redirected = meta.file_type().is_symlink();
    if redirected || (!meta.is_file() && !meta.is_dir()) { Err(UNSAFE) } else { Ok(()) }
}

fn pin_directory(path: &Path, verify: &impl Fn(&Path, bool) -> Result<(), &'static str>) -> Result<fs::File, &'static str> {
    if !metadata(path)?.is_some_and(|meta| meta.is_dir()) { return Err(UNSAFE); }
    verify(path, true).map_err(|_| UNSAFE)?;
    #[cfg(windows)]
    let file = {
        use std::os::windows::fs::OpenOptionsExt;
        fs::OpenOptions::new().access_mode(0x0002_0080).share_mode(3)
            .custom_flags(0x0220_0000).open(path)
    };
    #[cfg(not(windows))]
    let file = fs::File::open(path);
    let file = file.map_err(|_| IN_USE)?;
    let meta = file.metadata().map_err(|_| UNVERIFIED)?;
    safe_metadata(&meta)?;
    if !meta.is_dir() { return Err(UNSAFE); }
    verify(path, true).map_err(|_| UNSAFE)?;
    Ok(file)
}

fn pin_file(path: &Path, removing: bool, verify: &impl Fn(&Path, bool) -> Result<(), &'static str>) -> Result<fs::File, &'static str> {
    if !metadata(path)?.is_some_and(|meta| meta.is_file()) { return Err(UNSAFE); }
    verify(path, false).map_err(|_| UNSAFE)?;
    #[cfg(windows)]
    let file = {
        use std::os::windows::fs::OpenOptionsExt;
        // Read-only preview; DELETE access only after the native confirmation
        // and clean JVM shutdown. No writer or replacement can share this file.
        let access = 0x8000_0000 | if removing { 0x0001_0000 } else { 0 };
        fs::OpenOptions::new().access_mode(access).share_mode(1)
            .custom_flags(0x0820_0000).open(path)
    };
    #[cfg(not(windows))]
    let file = fs::File::open(path);
    let file = file.map_err(|_| IN_USE)?;
    let meta = file.metadata().map_err(|_| UNVERIFIED)?;
    safe_metadata(&meta)?;
    if !meta.is_file() { return Err(UNSAFE); }
    if removing && meta.permissions().readonly() { return Err(IN_USE); }
    verify(path, false).map_err(|_| UNSAFE)?;
    Ok(file)
}

fn check_time(start: Instant) -> Result<(), &'static str> {
    if start.elapsed() > SCAN_TIME { Err(UNVERIFIED) } else { Ok(()) }
}

fn hash_file(file: &mut fs::File, start: Instant) -> Result<Stamp, &'static str> {
    let meta = file.metadata().map_err(|_| UNVERIFIED)?;
    safe_metadata(&meta)?;
    if !meta.is_file() || meta.len() > MAX_FILE { return Err(UNVERIFIED); }
    let (created, modified) = (meta.created().map_err(|_| UNVERIFIED)?, meta.modified().map_err(|_| UNVERIFIED)?);
    let mut sha256 = Sha256::new();
    let mut bytes = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        check_time(start)?;
        let count = file.read(&mut buffer).map_err(|_| UNVERIFIED)?;
        if count == 0 { break; }
        bytes += count as u64;
        if bytes > meta.len() { return Err(STALE); }
        sha256.update(&buffer[..count]);
    }
    let after = file.metadata().map_err(|_| UNVERIFIED)?;
    if bytes != meta.len() || after.len() != bytes || after.created().ok() != Some(created) || after.modified().ok() != Some(modified) {
        return Err(STALE);
    }
    Ok(Stamp::File { bytes, created, modified, sha256: sha256.finalize().into() })
}

/// Fixed root names must match their real directory entries, never an 8.3 alias
/// or a case-folded alternate path. A pinned parent cannot be replaced here.
fn exact_directory(path: &Path, expected: &str) -> Result<(), &'static str> {
    if fs::canonicalize(path).map_err(|_| UNSAFE)?.file_name().and_then(|name| name.to_str()) != Some(expected) {
        return Err(UNSAFE);
    }
    Ok(())
}

fn inventory(data: &Path, removing: bool, verify: &impl Fn(&Path, bool) -> Result<(), &'static str>) -> Result<Inventory, &'static str> {
    let start = Instant::now();
    let mut result = Inventory { snapshot: Snapshot { parents: Vec::new(), entries: Vec::new(), totals: [Totals::default(); 2] },
        _directories: Vec::new(), files: Vec::new() };
    for (relative, required) in [("", true), ("runtime-temp", true), ("runtime-temp/Tachidesk", false)] {
        let path = data.join(relative);
        if metadata(&path)?.is_none() {
            if required { return Err(UNSAFE); }
            return Ok(result);
        }
        let file = pin_directory(&path, verify)?;
        if !relative.is_empty() { exact_directory(&path, Path::new(relative).file_name().and_then(|name| name.to_str()).ok_or(UNSAFE)?)?; }
        result.snapshot.parents.push((PathBuf::from(relative), file.metadata().map_err(|_| UNVERIFIED)?.created().map_err(|_| UNVERIFIED)?));
        result._directories.push(file);
    }
    let mut directories = Vec::new();
    for kind in KINDS {
        let relative = PathBuf::from("runtime-temp/Tachidesk").join(kind.directory());
        let path = data.join(&relative);
        if metadata(&path)?.is_none() { continue; }
        let file = pin_directory(&path, verify)?;
        exact_directory(&path, kind.directory())?;
        result.snapshot.entries.push(Entry { relative: relative.clone(), kind,
            stamp: Stamp::Directory { created: file.metadata().map_err(|_| UNVERIFIED)?.created().map_err(|_| UNVERIFIED)? } });
        result._directories.push(file);
        directories.push((relative, kind, 0usize));
    }
    while let Some((relative, kind, depth)) = directories.pop() {
        check_time(start)?;
        for entry in fs::read_dir(data.join(&relative)).map_err(|_| UNVERIFIED)? {
            check_time(start)?;
            if result.snapshot.entries.len() >= MAX_ENTRIES { return Err(UNVERIFIED); }
            let entry = entry.map_err(|_| UNVERIFIED)?;
            let name = entry.file_name();
            let text = name.to_str().ok_or(UNSAFE)?;
            if text.is_empty() || matches!(text, "." | "..") || text.ends_with(['.', ' '])
                || text.chars().any(|character| character.is_control() || "/\\:".contains(character)) { return Err(UNSAFE); }
            let child = relative.join(name);
            let path = data.join(&child);
            let meta = metadata(&path)?.ok_or(STALE)?;
            if meta.is_dir() {
                if depth >= MAX_DEPTH { return Err(UNVERIFIED); }
                let file = pin_directory(&path, verify)?;
                result.snapshot.entries.push(Entry { relative: child.clone(), kind,
                    stamp: Stamp::Directory { created: file.metadata().map_err(|_| UNVERIFIED)?.created().map_err(|_| UNVERIFIED)? } });
                result._directories.push(file);
                directories.push((child, kind, depth + 1));
            } else {
                let total = result.snapshot.bytes().checked_add(meta.len()).filter(|bytes| *bytes <= MAX_BYTES).ok_or(UNVERIFIED)?;
                let mut file = pin_file(&path, removing, verify)?;
                let stamp = hash_file(&mut file, start)?;
                let Stamp::File { bytes, .. } = stamp else { return Err(UNVERIFIED); };
                if bytes != meta.len() || total > MAX_BYTES { return Err(STALE); }
                let value = Entry { relative: child, kind, stamp };
                result.snapshot.totals[kind.index()].files += 1;
                result.snapshot.totals[kind.index()].bytes += bytes;
                result.snapshot.entries.push(value.clone());
                result.files.push((value, file));
            }
        }
    }
    result.snapshot.entries.sort_by(|left, right| left.relative.cmp(&right.relative));
    result.files.sort_by(|(left, _), (right, _)| left.relative.cmp(&right.relative));
    Ok(result)
}

fn reviewed_inventory(data: &Path, expected: &Snapshot, verify: &impl Fn(&Path, bool) -> Result<(), &'static str>) -> Result<Inventory, &'static str> {
    let current = inventory(data, true, verify)?;
    if current.snapshot != *expected { return Err(STALE); }
    Ok(current)
}

#[cfg(windows)]
fn remove_pinned(_path: &Path, file: fs::File) -> bool {
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn SetFileInformationByHandle(file: *mut std::ffi::c_void, class: u32, info: *const std::ffi::c_void, size: u32) -> i32;
    }
    // FILE_DISPOSITION_INFO contains one BOOLEAN. Unlike path deletion, this
    // names the exact verified handle. The last close commits the removal.
    // https://learn.microsoft.com/windows/win32/api/winbase/ns-winbase-file_disposition_info
    let delete_file = 1u8;
    // SAFETY: the live file has DELETE access, class 4 is FileDispositionInfo,
    // and the one-byte structure remains valid through the synchronous call.
    let removed = unsafe { SetFileInformationByHandle(file.as_raw_handle(), 4, (&delete_file as *const u8).cast(), 1) } != 0;
    drop(file);
    removed
}

#[cfg(not(windows))]
fn remove_pinned(path: &Path, file: fs::File) -> bool { drop(file); fs::remove_file(path).is_ok() }

fn remove_inventory(data: &Path, mut current: Inventory, mut remove: impl FnMut(&Path, fs::File) -> bool) -> ([Totals; 2], bool) {
    let mut totals = [Totals::default(); 2];
    let mut complete = true;
    for (entry, file) in current.files.drain(..) {
        let Stamp::File { bytes, .. } = entry.stamp else { complete = false; break; };
        let path = data.join(&entry.relative);
        if !remove(&path, file) || !matches!(metadata(&path), Ok(None)) { complete = false; break; }
        totals[entry.kind.index()].files += 1;
        totals[entry.kind.index()].bytes += bytes;
    }
    // Unattempted files and every ancestor remain pinned until here. Do not
    // recursively remove directories; empty cache directories are harmless.
    drop(current);
    (totals, complete)
}

fn result(review_id: &str, totals: [Totals; 2], complete: bool, runtime_ready: bool, message: &str) -> Value {
    json!({"reviewId": review_id, "status": if complete { "removed" } else { "partial" },
        "groups": KINDS.iter().map(|kind| { let total = totals[kind.index()];
            json!({"kind": kind.name(), "removedFiles": total.files, "removedBytes": total.bytes}) }).collect::<Vec<_>>(),
        "removedFiles": totals.iter().map(|total| total.files).sum::<u32>(),
        "removedBytes": totals.iter().map(|total| total.bytes).sum::<u64>(),
        "runtimeReady": runtime_ready, "message": message})
}

#[cfg(windows)]
impl ReadRuntime {
    fn image_cache_idle(&self) -> Result<(), &'static str> {
        self.require_empty_download_queue().map_err(|_| BUSY)?;
        let settings = self.client.document("query TsugiImageCacheSchedules { settings { autoDownloadNewChapters globalUpdateInterval } }", "settings", json!({})).map_err(|_| UNVERIFIED)?;
        if settings["autoDownloadNewChapters"] != false || settings["globalUpdateInterval"].as_f64() != Some(0.0)
            || self.library_update_status().map_err(|_| UNVERIFIED)?["jobsInfo"]["isRunning"] != false { return Err(BUSY); }
        if self._storage.temp_dir != self.data_path.join("runtime-temp") { return Err(UNSAFE); }
        Ok(())
    }

    pub fn review_image_cache_cleanup(&self) -> Result<ImageCacheCleanupReview, &'static str> {
        verify_listener(self.client.port, self.client.owner_pid).map_err(|_| UNVERIFIED)?;
        self.image_cache_idle()?;
        let user = private_storage::CurrentUser::get().map_err(|_| UNSAFE)?;
        let verify = |path: &Path, directory| if path == self.data_path { user.verify(path, directory) } else { user.verify_descendant(path, directory) };
        let snapshot = inventory(&self.data_path, false, &verify)?.snapshot;
        self.image_cache_idle()?;
        let mut entropy = [0u8; 16];
        getrandom::fill(&mut entropy).map_err(|_| UNVERIFIED)?;
        let id = entropy.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
        let description = format!("Clear {} temporary Reader image files ({} logical bytes)?\n\nThis removes only the reviewed cached chapter pages and thumbnails. Images will be fetched again when needed; uncached pages may require an internet connection.\n\nSaved chapter downloads, books, library entries, reading progress, bookmarks, categories and source sessions are preserved. Reader will briefly restart. Cleanup stops if any reviewed file cannot be safely removed.", snapshot.files(), snapshot.bytes());
        Ok(ImageCacheCleanupReview { id, created: Instant::now(), owner_pid: self.client.owner_pid,
            port: self.client.port, data_path: self.data_path.clone(), snapshot, description })
    }

    pub fn apply_reviewed_image_cache_cleanup(&mut self, review: ImageCacheCleanupReview) -> Result<Value, &'static str> {
        if review.created.elapsed() > REVIEW_LIFETIME || review.owner_pid != self.client.owner_pid
            || review.port != self.client.port || review.data_path != self.data_path { return Err(STALE); }
        verify_listener(self.client.port, self.client.owner_pid).map_err(|_| UNVERIFIED)?;
        self.image_cache_idle()?;
        let user = private_storage::CurrentUser::get().map_err(|_| UNSAFE)?;
        let stopped_cleanly = self.shutdown().is_ok();
        if !stopped_cleanly {
            let ready = self.restart_after_stop().is_ok();
            return Ok(result(&review.id, [Totals::default(); 2], false, ready,
                "Reader did not stop cleanly. No images were removed. Review the cache again after Reader is ready."));
        }
        // The serialized worker cannot issue cover/page requests while this is
        // running, and the stopped JVM cannot finish an earlier background load.
        let attempt = (|| {
            if review.created.elapsed() > REVIEW_LIFETIME { return Err(STALE); }
            let verify = |path: &Path, directory| if path == self.data_path { user.verify(path, directory) } else { user.verify_descendant(path, directory) };
            let current = reviewed_inventory(&self.data_path, &review.snapshot, &verify)?;
            Ok(remove_inventory(&self.data_path, current, remove_pinned))
        })();
        // All file and directory handles are released before Java is restarted.
        let ready = self.restart_after_stop().is_ok();
        match attempt {
            Err(error) if ready => Err(error),
            Err(_) => Ok(result(&review.id, [Totals::default(); 2], false, false,
                "The reviewed cache could not be safely cleared and Reader could not restart. No images were removed. Close and reopen Tsugi before reviewing again.")),
            Ok((totals, complete)) => Ok(result(&review.id, totals, complete, ready, match (complete, ready) {
                (true, true) => "The reviewed cached images were removed. Reader is ready and will fetch images again when needed.",
                (true, false) => "The reviewed cached images were removed, but Reader could not restart. Close and reopen Tsugi to continue reading.",
                (false, true) => "Some reviewed images could not be confirmed removed. Cleanup stopped; only confirmed removals are counted. Review the cache again.",
                (false, false) => "Some reviewed images could not be confirmed removed and Reader could not restart. Only confirmed removals are counted. Close and reopen Tsugi before reviewing again.",
            })),
        }
    }
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            static SERIAL: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
            let serial = SERIAL.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!("tsugi-image-cache-unit-{}-{}-{serial}", std::process::id(),
                SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_nanos()));
            #[cfg(windows)]
            assert!(private_storage::CurrentUser::get().unwrap().create_root(&path).unwrap());
            #[cfg(not(windows))]
            fs::create_dir(&path).unwrap();
            fs::create_dir(path.join("runtime-temp")).unwrap();
            Self(path)
        }
        fn write(&self, relative: &str, bytes: &[u8]) -> PathBuf {
            let path = self.0.join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, bytes).unwrap();
            path
        }
        fn verify(&self, path: &Path, directory: bool) -> Result<(), &'static str> {
            let meta = metadata(path)?.ok_or(UNSAFE)?;
            if meta.is_dir() != directory { return Err(UNSAFE); }
            #[cfg(windows)]
            { let user = private_storage::CurrentUser::get()?;
                if path == self.0 { user.verify(path, directory)?; } else { user.verify_descendant(path, directory)?; } }
            Ok(())
        }
        fn snapshot(&self) -> Snapshot { inventory(&self.0, false, &|path, directory| self.verify(path, directory)).unwrap().snapshot }
    }
    impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }

    #[test]
    fn image_cache_cleanup_removes_only_reviewed_temporary_images() {
        let fixture = Fixture::new();
        fixture.write("runtime-temp/Tachidesk/manga-cache/Source/Title/Chapter/001.png", b"original page");
        fixture.write("runtime-temp/Tachidesk/manga-cache/Source/Title/Chapter/002.tmp", b"");
        fixture.write("runtime-temp/Tachidesk/thumbnails/17.png", b"original thumbnail");
        let retained = ["database.mv.db", "server.conf", "settings/source-preferences", "cache/kcef/Cookies",
            "downloads/mangas/Source/Title/Saved/001.png", "downloads/thumbnails/17.png", "local/book.cbz",
            "runtime-temp/Tachidesk/webUI-serve/index.html", "runtime-temp/unrelated.tmp"];
        for relative in retained { fixture.write(relative, b"keep exactly"); }
        let snapshot = fixture.snapshot();
        assert_eq!(snapshot.totals, [Totals { files: 2, bytes: 13 }, Totals { files: 1, bytes: 18 }]);
        let current = reviewed_inventory(&fixture.0, &snapshot, &|path, directory| fixture.verify(path, directory)).unwrap();
        let (removed, complete) = remove_inventory(&fixture.0, current, remove_pinned);
        assert!(complete);
        assert_eq!(removed, snapshot.totals);
        for relative in retained { assert_eq!(fs::read(fixture.0.join(relative)).unwrap(), b"keep exactly", "preserved {relative}"); }
        assert_eq!(fixture.snapshot().files(), 0);
        assert!(fixture.0.join("runtime-temp/Tachidesk/manga-cache/Source/Title/Chapter").is_dir());
    }

    #[test]
    fn image_cache_cleanup_refuses_equal_size_timestamp_replacement_and_new_files() {
        let fixture = Fixture::new();
        let page = fixture.write("runtime-temp/Tachidesk/manga-cache/source/title/chapter/001.png", b"first bytes");
        let original = fixture.snapshot();
        let modified = fs::metadata(&page).unwrap().modified().unwrap();
        fs::write(&page, b"other bytes").unwrap();
        fs::File::options().write(true).open(&page).unwrap().set_times(fs::FileTimes::new().set_modified(modified)).unwrap();
        assert!(reviewed_inventory(&fixture.0, &original, &|path, directory| fixture.verify(path, directory)).is_err());
        assert_eq!(fs::read(&page).unwrap(), b"other bytes");
        let replaced = fixture.snapshot();
        fixture.write("runtime-temp/Tachidesk/thumbnails/18.png", b"newly loaded");
        assert!(reviewed_inventory(&fixture.0, &replaced, &|path, directory| fixture.verify(path, directory)).is_err());
        assert_eq!(fixture.snapshot().files(), 2);
    }

    #[test]
    fn image_cache_cleanup_empty_missing_roots_are_read_only_and_new_roots_are_stale() {
        let fixture = Fixture::new();
        let snapshot = fixture.snapshot();
        assert_eq!(snapshot.files(), 0);
        assert!(!fixture.0.join("runtime-temp/Tachidesk").exists());
        let current = reviewed_inventory(&fixture.0, &snapshot, &|path, directory| fixture.verify(path, directory)).unwrap();
        assert_eq!(remove_inventory(&fixture.0, current, remove_pinned), ([Totals::default(); 2], true));
        fixture.write("runtime-temp/Tachidesk/thumbnails/1.png", b"new image");
        assert!(reviewed_inventory(&fixture.0, &snapshot, &|path, directory| fixture.verify(path, directory)).is_err());
        assert_eq!(fs::read(fixture.0.join("runtime-temp/Tachidesk/thumbnails/1.png")).unwrap(), b"new image");
    }

    #[test]
    fn image_cache_cleanup_stops_after_failure_and_counts_only_confirmed_absence() {
        let fixture = Fixture::new();
        for name in ["a.png", "b.png", "c.png"] { fixture.write(&format!("runtime-temp/Tachidesk/thumbnails/{name}"), b"image"); }
        let snapshot = fixture.snapshot();
        let current = reviewed_inventory(&fixture.0, &snapshot, &|path, directory| fixture.verify(path, directory)).unwrap();
        let mut attempts = 0;
        let (removed, complete) = remove_inventory(&fixture.0, current, |path, file| {
            attempts += 1;
            if attempts == 2 { drop(file); false } else { remove_pinned(path, file) }
        });
        assert!(!complete);
        assert_eq!(attempts, 2);
        assert_eq!(removed, [Totals::default(), Totals { files: 1, bytes: 5 }]);
        assert_eq!(fixture.snapshot().files(), 2);
        assert_eq!(fs::read(fixture.0.join("runtime-temp/Tachidesk/thumbnails/c.png")).unwrap(), b"image");
        let current = inventory(&fixture.0, true, &|path, directory| fixture.verify(path, directory)).unwrap();
        let (unconfirmed, complete) = remove_inventory(&fixture.0, current, |_path, file| { drop(file); true });
        assert!(!complete, "an acknowledged deletion without actual absence is not success");
        assert_eq!(unconfirmed, [Totals::default(); 2]);
    }

    #[test]
    fn image_cache_cleanup_refuses_oversized_files_deep_trees_and_untrusted_ownership() {
        let fixture = Fixture::new();
        let path = fixture.write("runtime-temp/Tachidesk/thumbnails/1.png", b"image");
        fs::File::options().write(true).open(&path).unwrap().set_len(MAX_FILE + 1).unwrap();
        assert!(inventory(&fixture.0, false, &|path, directory| fixture.verify(path, directory)).is_err());
        fs::remove_file(&path).unwrap();
        let relative = format!("runtime-temp/Tachidesk/manga-cache/{}/1.png", vec!["nested"; MAX_DEPTH + 1].join("/"));
        fixture.write(&relative, b"image");
        assert!(inventory(&fixture.0, false, &|path, directory| fixture.verify(path, directory)).is_err());
        assert!(inventory(&fixture.0, false, &|_, _| Err(UNSAFE)).is_err());
        assert_eq!(fs::read(fixture.0.join(relative)).unwrap(), b"image");
    }

    #[test]
    fn image_cache_cleanup_public_results_expose_only_counts_and_opaque_identity() {
        let fixture = Fixture::new();
        fixture.write("runtime-temp/Tachidesk/thumbnails/private-source-name.png", b"image");
        let review = ImageCacheCleanupReview { id: "a".repeat(32), created: Instant::now(), owner_pid: 1, port: 2,
            data_path: fixture.0.clone(), snapshot: fixture.snapshot(), description: "fixed review".into() };
        let preview = review.preview();
        assert_eq!(preview["totalFiles"], 1);
        assert_eq!(preview["totalBytes"], 5);
        assert_eq!(preview["expiresInSeconds"], 600);
        assert!(!preview.to_string().contains("private-source-name"));
        assert!(!preview.to_string().contains("runtime-temp"));
        let applied = result(review.id(), review.snapshot.totals, true, false, "Reader needs to restart.");
        assert_eq!(applied["status"], "removed");
        assert_eq!(applied["runtimeReady"], false);
        assert_eq!(applied["removedFiles"], 1);
        assert_eq!(applied["removedBytes"], 5);
        assert!(!applied.to_string().contains("private-source-name"));
    }

    #[cfg(windows)]
    #[test]
    fn image_cache_cleanup_locked_file_blocks_before_any_deletion_and_pins_parents() {
        use std::os::windows::fs::OpenOptionsExt;
        let fixture = Fixture::new();
        let first = fixture.write("runtime-temp/Tachidesk/thumbnails/a.png", b"first");
        let second = fixture.write("runtime-temp/Tachidesk/thumbnails/b.png", b"second");
        let snapshot = fixture.snapshot();
        let locked = fs::OpenOptions::new().read(true).share_mode(1).open(&second).unwrap();
        assert!(reviewed_inventory(&fixture.0, &snapshot, &|path, directory| fixture.verify(path, directory)).is_err());
        assert_eq!(fs::read(&first).unwrap(), b"first");
        drop(locked);
        let current = reviewed_inventory(&fixture.0, &snapshot, &|path, directory| fixture.verify(path, directory)).unwrap();
        assert!(fs::rename(fixture.0.join("runtime-temp"), fixture.0.join("redirected-temp")).is_err());
        assert!(fs::write(&first, b"wrong").is_err());
        assert!(fs::remove_file(&second).is_err());
        assert!(remove_inventory(&fixture.0, current, remove_pinned).1);
    }

    #[cfg(windows)]
    #[test]
    fn image_cache_cleanup_refuses_a_junction_replacing_a_reviewed_root() {
        let fixture = Fixture::new();
        fixture.write("runtime-temp/Tachidesk/thumbnails/1.png", b"reviewed cached image");
        let retained = fixture.write("downloads/mangas/1.png", b"retained original download");
        let snapshot = fixture.snapshot();
        let thumbnails = fixture.0.join("runtime-temp/Tachidesk/thumbnails");
        let displaced = fixture.0.join("displaced-thumbnails");
        fs::rename(&thumbnails, &displaced).unwrap();
        let junction = Command::new("cmd.exe").current_dir(&fixture.0)
            .args(["/d", "/c", "mklink", "/J", "runtime-temp\\Tachidesk\\thumbnails", "downloads\\mangas"])
            .output().expect("create original Windows junction fixture");
        assert!(junction.status.success(), "the directory junction fixture must be created");
        let error = reviewed_inventory(&fixture.0, &snapshot, &|path, directory| fixture.verify(path, directory)).err();
        assert_eq!(error, Some(UNSAFE));
        assert_eq!(fs::read(&retained).unwrap(), b"retained original download");
        assert_eq!(fs::read(displaced.join("1.png")).unwrap(), b"reviewed cached image");
        fs::remove_dir(&thumbnails).unwrap();
        assert_eq!(fs::read(retained).unwrap(), b"retained original download");
    }

    #[cfg(unix)]
    #[test]
    fn image_cache_cleanup_refuses_redirected_files_and_fixed_parents() {
        use std::os::unix::fs::symlink;
        let fixture = Fixture::new();
        let outside = fixture.write("retained.png", b"keep original");
        fs::create_dir_all(fixture.0.join("runtime-temp/Tachidesk/thumbnails")).unwrap();
        let image = fixture.0.join("runtime-temp/Tachidesk/thumbnails/1.png");
        symlink(&outside, &image).unwrap();
        assert!(inventory(&fixture.0, false, &|path, directory| fixture.verify(path, directory)).is_err());
        fs::remove_file(&image).unwrap();
        fs::remove_dir(fixture.0.join("runtime-temp/Tachidesk/thumbnails")).unwrap();
        symlink(&fixture.0, fixture.0.join("runtime-temp/Tachidesk/thumbnails")).unwrap();
        assert!(inventory(&fixture.0, false, &|path, directory| fixture.verify(path, directory)).is_err());
        assert_eq!(fs::read(outside).unwrap(), b"keep original");
    }
}

#[cfg(all(test, windows))]
#[path = "read_image_cache_cleanup_tests.rs"]
mod runtime_tests;
