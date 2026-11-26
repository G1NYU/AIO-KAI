//! Reviewed removal of completed managed chapter downloads. Paths and proof
//! objects stay native; the renderer supplies chapter IDs, never file paths.
use super::*;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::io::{Seek, SeekFrom};
use std::path::PathBuf;
use std::time::SystemTime;

const MAX_CHAPTERS: usize = 10_000;
const MAX_MANGAS: usize = 5_000;
const MAX_METADATA: usize = 16 * 1024 * 1024;
const MAX_DOWNLOAD: u64 = 512 * 1024 * 1024;
const MAX_REVIEW_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_PAGES: u32 = 2_000;
const REVIEW_LIFETIME: Duration = Duration::from_secs(600);
const INVALID: &str = "The managed download inventory could not be verified. No further downloads were removed.";
const CHANGED: &str = "The reviewed downloads or reading state changed. Review the selection again.";
const UNSAFE_PATH: &str = "A download path is ambiguous, redirected or outside the supported private storage.";

#[derive(Clone, Debug, PartialEq)]
struct FileStamp {
    name: String,
    bytes: u64,
    modified: SystemTime,
    created: SystemTime,
    sha256: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
struct DownloadFingerprint {
    format: &'static str,
    bytes: u64,
    files: u32,
    entries: Vec<FileStamp>,
}

#[derive(Clone)]
struct CleanupItem {
    chapter_id: i32,
    relative: PathBuf,
    page_count: u32,
    public: Value,
    fingerprint: DownloadFingerprint,
}

#[derive(Clone)]
struct MetadataSnapshot {
    sources: Vec<Value>,
    mangas: BTreeMap<i32, Value>,
    chapters: BTreeMap<i32, Value>,
}

impl MetadataSnapshot {
    fn protected_eq(&self, other: &Self) -> bool {
        if self.sources != other.sources || self.mangas != other.mangas || self.chapters.len() != other.chapters.len() { return false; }
        self.chapters.iter().all(|(id, chapter)| {
            let Some(other) = other.chapters.get(id) else { return false; };
            let mut chapter = chapter.clone();
            let mut other = other.clone();
            chapter.as_object_mut().unwrap().remove("isDownloaded");
            other.as_object_mut().unwrap().remove("isDownloaded");
            chapter == other
        })
    }

    fn exact_eq(&self, other: &Self) -> bool {
        self.sources == other.sources && self.mangas == other.mangas && self.chapters == other.chapters
    }
}

/// One-use native capability. The worker retains it through its own dialog.
/// The verified portable metadata copy is a separate prerequisite; it cannot
/// recover chapter media intentionally removed by this operation.
pub struct DownloadCleanupReview {
    id: String,
    created: Instant,
    owner_pid: u32,
    port: u16,
    data_path: PathBuf,
    settings: Value,
    metadata: MetadataSnapshot,
    items: Vec<CleanupItem>,
    description: String,
}

impl DownloadCleanupReview {
    pub fn id(&self) -> &str { &self.id }
    pub fn description(&self) -> &str { &self.description }
    pub fn preview(&self) -> Value {
        json!({"reviewId": self.id, "items": self.items.iter().map(|item| item.public.clone()).collect::<Vec<_>>(),
            "totalBytes": self.items.iter().map(|item| item.fingerprint.bytes).sum::<u64>()})
    }
}

fn positive_id(value: &Value) -> Result<i32, &'static str> {
    value.as_i64().and_then(|value| i32::try_from(value).ok()).filter(|value| *value > 0).ok_or(INVALID)
}

fn label(value: &Value) -> Result<&str, &'static str> {
    let value = backup_text(value, 500)?;
    if value.len() > 2000 { return Err(INVALID); }
    Ok(value)
}

/// Match pinned SafePath.buildValidFilename, including its UTF-8 and UTF-16
/// bounds. Refuse additional Win32 aliases that SafePath itself does not cover.
fn safe_component(value: &str) -> Result<String, &'static str> {
    if value.len() > 16_384 { return Err(UNSAFE_PATH); }
    let trimmed = value.trim_matches(['.', ' ']);
    let mut result = String::new();
    let mut units = 0;
    for character in trimmed.chars() {
        let character = if character <= '\u{1f}' || character == '\u{7f}' || "\"*/:<>?\\|".contains(character) { '_' } else { character };
        if units >= 240 || result.len() + character.len_utf8() > 240 { break; }
        result.push(character);
        units += character.len_utf16();
    }
    if result.is_empty() { result = "(invalid)".into(); }
    let stem = result.split('.').next().unwrap_or_default().trim_end_matches(' ').to_ascii_uppercase();
    let numbered_device = ["COM", "LPT"].iter().any(|prefix| stem.strip_prefix(prefix).is_some_and(|suffix|
        matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³")));
    if result.ends_with(['.', ' ']) || matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$") || numbered_device {
        return Err(UNSAFE_PATH);
    }
    Ok(result)
}

#[derive(Clone)]
struct PathOwner { path: String, owner: String }

#[cfg(windows)]
fn compare_paths(left: &str, right: &str) -> Result<std::cmp::Ordering, &'static str> {
        #[link(name = "kernel32")]
        unsafe extern "system" { fn CompareStringOrdinal(left: *const u16, left_len: i32, right: *const u16, right_len: i32, ignore_case: i32) -> i32; }
        let left = left.encode_utf16().collect::<Vec<_>>();
        let right = right.encode_utf16().collect::<Vec<_>>();
        // SAFETY: both counted UTF-16 buffers are live; lengths are bounded by
        // the three validated path components, well below i32::MAX.
        match unsafe { CompareStringOrdinal(left.as_ptr(), left.len() as i32, right.as_ptr(), right.len() as i32, 1) } {
            1 => Ok(std::cmp::Ordering::Less), 2 => Ok(std::cmp::Ordering::Equal), 3 => Ok(std::cmp::Ordering::Greater), _ => Err(UNSAFE_PATH),
        }
}
#[cfg(not(windows))]
fn compare_paths(left: &str, right: &str) -> Result<std::cmp::Ordering, &'static str> { Ok(left.to_uppercase().cmp(&right.to_uppercase())) }

fn validate_namespace(paths: &[PathOwner]) -> Result<(), &'static str> {
    let mut paths = paths.iter().collect::<Vec<_>>();
    let mut comparison_failed = false;
    paths.sort_by(|left, right| compare_paths(&left.path, &right.path).unwrap_or_else(|_| { comparison_failed = true; std::cmp::Ordering::Equal }));
    if comparison_failed { return Err(UNSAFE_PATH); }
    for pair in paths.windows(2) {
        if compare_paths(&pair[0].path, &pair[1].path)? == std::cmp::Ordering::Equal && pair[0].owner != pair[1].owner {
            return Err("Download names collide after Windows filename normalization. Resolve the ambiguity before cleanup.");
        }
    }
    Ok(())
}

fn checked_metadata(path: &Path) -> Result<Option<fs::Metadata>, &'static str> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            #[cfg(windows)]
            let redirected = { use std::os::windows::fs::MetadataExt; metadata.file_attributes() & 0x400 != 0 };
            #[cfg(not(windows))]
            let redirected = metadata.file_type().is_symlink();
            if redirected || (!metadata.is_file() && !metadata.is_dir()) { return Err(UNSAFE_PATH); }
            Ok(Some(metadata))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("Could not inspect a managed download. Check file access and review again."),
    }
}

/// A Win32 8.3 alias must not redirect a reviewed title to another long name.
/// Require the real directory entry to match under Windows ordinal casing.
fn verify_disk_name(path: &Path) -> Result<(), &'static str> {
    let parent = path.parent().ok_or(UNSAFE_PATH)?;
    let name = path.file_name().and_then(|name| name.to_str()).ok_or(UNSAFE_PATH)?;
    let mut matches = 0;
    for (count, entry) in fs::read_dir(parent).map_err(|_| UNSAFE_PATH)?.enumerate() {
        if count >= MAX_CHAPTERS { return Err(UNSAFE_PATH); }
        let entry = entry.map_err(|_| UNSAFE_PATH)?;
        let actual = entry.file_name();
        let actual = actual.to_str().ok_or(UNSAFE_PATH)?;
        if compare_paths(actual, name)? == std::cmp::Ordering::Equal { matches += 1; }
    }
    if matches != 1 { return Err(UNSAFE_PATH); }
    Ok(())
}

fn checked_parent(root: &Path, relative: &Path, verify: &impl Fn(&Path, bool) -> Result<(), &'static str>) -> Result<(), &'static str> {
    let mut current = root.to_path_buf();
    for component in std::iter::once(None).chain(relative.parent().ok_or(UNSAFE_PATH)?.components().map(Some)) {
        if let Some(component) = component {
            let std::path::Component::Normal(name) = component else { return Err(UNSAFE_PATH); };
            current.push(name);
            verify_disk_name(&current)?;
        }
        let metadata = checked_metadata(&current)?.ok_or(UNSAFE_PATH)?;
        if !metadata.is_dir() { return Err(UNSAFE_PATH); }
        verify(&current, true)?;
    }
    Ok(())
}

fn stamp_file(path: &Path, name: String, verify: &impl Fn(&Path, bool) -> Result<(), &'static str>, hash: bool) -> Result<FileStamp, &'static str> {
    let metadata = checked_metadata(path)?.filter(fs::Metadata::is_file).ok_or(UNSAFE_PATH)?;
    if metadata.len() == 0 || metadata.len() > MAX_DOWNLOAD { return Err(INVALID); }
    verify(path, false)?;
    let mut stamp = FileStamp { name, bytes: metadata.len(), modified: metadata.modified().map_err(|_| INVALID)?,
        created: metadata.created().map_err(|_| INVALID)?, sha256: None };
    if hash {
        let mut file = fs::File::open(path).map_err(|_| "A selected download is in use or unreadable.")?;
        let mut digest = Sha256::new();
        let mut bytes = 0u64;
        let mut buffer = [0; 64 * 1024];
        loop {
            let count = file.read(&mut buffer).map_err(|_| "Could not verify the selected download contents.")?;
            if count == 0 { break; }
            bytes += count as u64;
            if bytes > stamp.bytes { return Err(CHANGED); }
            digest.update(&buffer[..count]);
        }
        if bytes != stamp.bytes { return Err(CHANGED); }
        stamp.sha256 = Some(format!("{:x}", digest.finalize()));
    }
    let current = checked_metadata(path)?.filter(fs::Metadata::is_file).ok_or(CHANGED)?;
    verify(path, false)?;
    if current.len() != stamp.bytes || current.modified().map_err(|_| INVALID)? != stamp.modified || current.created().map_err(|_| INVALID)? != stamp.created { return Err(CHANGED); }
    Ok(stamp)
}

fn page_name(name: &str, page_count: u32) -> Result<Option<u32>, &'static str> {
    if name == "ComicInfo.xml" { return Ok(None); }
    let (number, extension) = name.rsplit_once('.').ok_or(INVALID)?;
    if !matches!(extension.to_ascii_lowercase().as_str(), "jpg" | "jpeg" | "png" | "gif" | "webp" | "avif" | "bmp") { return Err(INVALID); }
    let index = number.parse::<u32>().ok().filter(|index| *index > 0 && *index <= page_count).ok_or(INVALID)?;
    if number != format!("{index:0width$}", width = page_count.to_string().len().max(3)) { return Err(INVALID); }
    Ok(Some(index))
}

fn verify_page_names(names: &[String], page_count: u32) -> Result<(), &'static str> {
    if page_count == 0 || page_count > MAX_PAGES || names.len() != page_count as usize + 1 { return Err(INVALID); }
    let mut pages = BTreeSet::new();
    let mut comic_info = false;
    for name in names {
        match page_name(name, page_count)? {
            Some(index) if pages.insert(index) => {},
            None if !comic_info => comic_info = true,
            _ => return Err(INVALID),
        }
    }
    if pages.len() != page_count as usize || !comic_info { return Err(INVALID); }
    Ok(())
}

/// Read only the bounded ZIP directory; never extract or execute its contents.
/// The pinned downloader emits ordinary non-ZIP64 archives with flat entries.
fn verify_cbz(path: &Path, size: u64, page_count: u32) -> Result<(), &'static str> {
    fn u16_at(bytes: &[u8], at: usize) -> Result<u16, &'static str> { Ok(u16::from_le_bytes(bytes.get(at..at + 2).ok_or(INVALID)?.try_into().map_err(|_| INVALID)?)) }
    fn u32_at(bytes: &[u8], at: usize) -> Result<u32, &'static str> { Ok(u32::from_le_bytes(bytes.get(at..at + 4).ok_or(INVALID)?.try_into().map_err(|_| INVALID)?)) }
    if size < 22 || size > MAX_DOWNLOAD { return Err(INVALID); }
    let mut file = fs::File::open(path).map_err(|_| INVALID)?;
    file.seek(SeekFrom::End(-22)).map_err(|_| INVALID)?;
    let mut end = [0u8; 22];
    file.read_exact(&mut end).map_err(|_| INVALID)?;
    let count = u16_at(&end, 10)?;
    let directory_size = u64::from(u32_at(&end, 12)?);
    let directory_offset = u64::from(u32_at(&end, 16)?);
    if end[..4] != *b"PK\x05\x06" || u16_at(&end, 4)? != 0 || u16_at(&end, 6)? != 0 || u16_at(&end, 8)? != count
        || u16_at(&end, 20)? != 0 || u32::from(count) != page_count + 1 || directory_size > 256 * 1024
        || directory_offset + directory_size != size - 22 { return Err(INVALID); }
    file.seek(SeekFrom::Start(directory_offset)).map_err(|_| INVALID)?;
    let mut directory = vec![0; directory_size as usize];
    file.read_exact(&mut directory).map_err(|_| INVALID)?;
    let mut offset = 0usize;
    let mut names = Vec::new();
    let mut ranges = Vec::new();
    let mut expanded = 0u64;
    for _ in 0..count {
        if directory.get(offset..offset + 4) != Some(b"PK\x01\x02") { return Err(INVALID); }
        let flags = u16_at(&directory, offset + 8)?;
        let method = u16_at(&directory, offset + 10)?;
        let compressed = u64::from(u32_at(&directory, offset + 20)?);
        let uncompressed = u64::from(u32_at(&directory, offset + 24)?);
        let name_len = usize::from(u16_at(&directory, offset + 28)?);
        let extra_len = usize::from(u16_at(&directory, offset + 30)?);
        let comment_len = usize::from(u16_at(&directory, offset + 32)?);
        let start = u64::from(u32_at(&directory, offset + 42)?);
        if flags & !0x080e != 0 || !matches!(method, 0 | 8) || name_len > 64 || extra_len > 4096 || comment_len != 0
            || u16_at(&directory, offset + 34)? != 0 || uncompressed == 0 || uncompressed > 64 * 1024 * 1024 { return Err(INVALID); }
        let name = std::str::from_utf8(directory.get(offset + 46..offset + 46 + name_len).ok_or(INVALID)?).map_err(|_| INVALID)?.to_owned();
        page_name(&name, page_count)?;
        if name == "ComicInfo.xml" && uncompressed > 1024 * 1024 { return Err(INVALID); }
        expanded += uncompressed;
        if expanded > MAX_DOWNLOAD || start + 30 > directory_offset { return Err(INVALID); }
        file.seek(SeekFrom::Start(start)).map_err(|_| INVALID)?;
        let mut local = [0u8; 30];
        file.read_exact(&mut local).map_err(|_| INVALID)?;
        let local_name_len = usize::from(u16_at(&local, 26)?);
        let local_extra_len = u64::from(u16_at(&local, 28)?);
        if local[..4] != *b"PK\x03\x04" || u16_at(&local, 6)? != flags || u16_at(&local, 8)? != method || local_name_len != name_len || local_extra_len > 4096 { return Err(INVALID); }
        let mut local_name = vec![0; local_name_len];
        file.read_exact(&mut local_name).map_err(|_| INVALID)?;
        if local_name != name.as_bytes() { return Err(INVALID); }
        let end = start + 30 + name_len as u64 + local_extra_len + compressed;
        if end > directory_offset { return Err(INVALID); }
        ranges.push((start, end));
        names.push(name);
        offset = offset.checked_add(46 + name_len + extra_len + comment_len).ok_or(INVALID)?;
    }
    if offset != directory.len() { return Err(INVALID); }
    ranges.sort_unstable();
    if ranges.windows(2).any(|range| range[0].1 > range[1].0) { return Err(INVALID); }
    verify_page_names(&names, page_count)
}

fn inspect_download(root: &Path, relative: &Path, page_count: u32, verify: &impl Fn(&Path, bool) -> Result<(), &'static str>, hash: bool) -> Result<Option<DownloadFingerprint>, &'static str> {
    if relative.components().count() != 3 || !relative.components().all(|component| matches!(component, std::path::Component::Normal(_))) { return Err(UNSAFE_PATH); }
    checked_parent(root, relative, verify)?;
    let folder = root.join(relative);
    let cbz = root.join(format!("{}.cbz", relative.to_str().ok_or(UNSAFE_PATH)?));
    let folder_meta = checked_metadata(&folder)?;
    let cbz_meta = checked_metadata(&cbz)?;
    if folder_meta.is_some() && cbz_meta.is_some() { return Err("A chapter has both folder and CBZ downloads. Resolve the duplicate before cleanup."); }
    if let Some(metadata) = cbz_meta {
        if !metadata.is_file() { return Err(UNSAFE_PATH); }
        verify_disk_name(&cbz)?;
        let stamp = stamp_file(&cbz, "archive.cbz".into(), verify, hash)?;
        verify_cbz(&cbz, stamp.bytes, page_count)?;
        return Ok(Some(DownloadFingerprint { format: "cbz", bytes: stamp.bytes, files: 1, entries: vec![stamp] }));
    }
    let Some(metadata) = folder_meta else { return Ok(None); };
    if !metadata.is_dir() { return Err(UNSAFE_PATH); }
    verify_disk_name(&folder)?;
    verify(&folder, true)?;
    let mut entries = Vec::new();
    let mut bytes = 0u64;
    for entry in fs::read_dir(&folder).map_err(|_| INVALID)? {
        if entries.len() >= MAX_PAGES as usize + 1 { return Err(INVALID); }
        let entry = entry.map_err(|_| INVALID)?;
        let name = entry.file_name().to_str().ok_or(UNSAFE_PATH)?.to_owned();
        page_name(&name, page_count)?;
        let stamp = stamp_file(&entry.path(), name.clone(), verify, hash)?;
        if (name == "ComicInfo.xml" && stamp.bytes > 1024 * 1024) || (name != "ComicInfo.xml" && stamp.bytes > 64 * 1024 * 1024) { return Err(INVALID); }
        bytes += stamp.bytes;
        if bytes > MAX_DOWNLOAD { return Err(INVALID); }
        entries.push(stamp);
    }
    entries.sort_by(|left, right| left.name.cmp(&right.name));
    verify_page_names(&entries.iter().map(|entry| entry.name.clone()).collect::<Vec<_>>(), page_count)?;
    Ok(Some(DownloadFingerprint { format: "folder", bytes, files: entries.len() as u32, entries }))
}

impl ReadRuntime {
    fn cleanup_settings(&self) -> Result<Value, &'static str> {
        let settings = self.client.document(
            "query TsugiCleanupSettings { settings { downloadsPath downloadAsCbz autoDownloadNewChapters globalUpdateInterval } }", "settings", json!({}))?;
        if settings["downloadsPath"].as_str() != Some("") || settings["autoDownloadNewChapters"] != false
            || settings["globalUpdateInterval"].as_f64() != Some(0.0) || !settings["downloadAsCbz"].is_boolean() {
            return Err("Cleanup requires the default private download folder and disabled automatic downloads and scheduled library updates.");
        }
        let status = self.client.document("query TsugiCleanupQueue { downloadStatus { state queue { chapter { id } } } }", "downloadStatus", json!({}))?;
        if status["state"] != "STOPPED" || !status["queue"].as_array().is_some_and(Vec::is_empty) {
            return Err("Stop downloads and finish or clear the download queue before cleanup.");
        }
        if self.library_update_status()?["jobsInfo"]["isRunning"] != false { return Err("Wait for the library update to finish before cleanup."); }
        Ok(settings)
    }

    fn cleanup_metadata(&self) -> Result<MetadataSnapshot, &'static str> {
        let sources = self.client.document("query TsugiCleanupSources { sources(first: 1001, order: [{ by: ID, byType: ASC }]) { nodes { id displayName extension { pkgName isInstalled versionName versionCodeLong } } totalCount } }", "sources", json!({}))?;
        let sources = backup_nodes(&sources, 1000)?.clone();
        let mut source_ids = BTreeSet::new();
        for source in &sources {
            let id = source["id"].as_str().filter(|id| id.parse::<i64>().is_ok()).ok_or(INVALID)?;
            if !source_ids.insert(id.to_owned()) || !source["extension"]["isInstalled"].is_boolean() { return Err(INVALID); }
            label(&source["displayName"])?;
        }
        let mut total_bytes = serde_json::to_vec(&sources).map_err(|_| INVALID)?.len();
        let mut mangas = BTreeMap::new();
        let mut chapters = BTreeMap::new();
        for (key, query, max, target) in [
            ("mangas", "query TsugiCleanupManga($offset: Int!) { mangas(first: 100, offset: $offset, order: [{ by: ID, byType: ASC }]) { nodes { id sourceId title url inLibrary categories { nodes { id name order } totalCount } } totalCount } }", MAX_MANGAS, &mut mangas),
            ("chapters", "query TsugiCleanupChapters($offset: Int!) { chapters(first: 100, offset: $offset, order: [{ by: ID, byType: ASC }]) { nodes { id mangaId url name scanlator chapterNumber sourceOrder uploadDate fetchedAt isDownloaded isRead isBookmarked lastPageRead lastReadAt pageCount } totalCount } }", MAX_CHAPTERS, &mut chapters),
        ] {
            let mut expected = None;
            let mut last_id = 0;
            loop {
                let page = self.client.document(query, key, json!({"offset": target.len()}))?;
                let rows = page["nodes"].as_array().ok_or(INVALID)?;
                let total = page["totalCount"].as_u64().filter(|total| *total <= max as u64).ok_or("The complete download inventory exceeds this cleanup operation's limit.")?;
                if rows.len() > 100 || expected.replace(total).is_some_and(|expected| expected != total) || (rows.is_empty() && target.len() < total as usize) { return Err(INVALID); }
                for row in rows {
                    let mut row = row.clone();
                    let id = positive_id(&row["id"])?;
                    if id <= last_id { return Err(INVALID); }
                    last_id = id;
                    if key == "mangas" {
                        let source = row["sourceId"].as_str().ok_or(INVALID)?;
                        if !source_ids.contains(source) { return Err("An unavailable source prevents a complete download ownership inventory."); }
                        if !row["inLibrary"].is_boolean() { return Err(INVALID); }
                        let categories = backup_nodes(&row["categories"], 100)?;
                        let mut ids = BTreeSet::new();
                        for category in categories {
                            let id = category["id"].as_i64().filter(|id| *id >= 0).ok_or(INVALID)?;
                            if !ids.insert(id) { return Err(INVALID); }
                        }
                        row["categories"]["nodes"].as_array_mut().ok_or(INVALID)?.sort_by_key(|node| node["id"].as_i64());
                    } else if !row["isDownloaded"].is_boolean() || !row["isRead"].is_boolean() || !row["isBookmarked"].is_boolean() {
                        return Err(INVALID);
                    }
                    total_bytes += serde_json::to_vec(&row).map_err(|_| INVALID)?.len();
                    if total_bytes > MAX_METADATA { return Err("The complete download metadata exceeds the supported cleanup limit."); }
                    target.insert(id, row);
                }
                if target.len() == total as usize { break; }
                if target.len() > total as usize { return Err(INVALID); }
            }
        }
        Ok(MetadataSnapshot { sources, mangas, chapters })
    }

    fn cleanup_items(&self, metadata: &MetadataSnapshot, hash_ids: &BTreeSet<i32>) -> Result<Vec<CleanupItem>, &'static str> {
        let user = private_storage::CurrentUser::get()?;
        user.verify(&self.data_path, true)?;
        let downloads = self.data_path.join("downloads");
        let root = downloads.join("mangas");
        let verify = |path: &Path, directory| user.verify_descendant(path, directory);
        for directory in [&downloads, &root] {
            if let Some(meta) = checked_metadata(directory)? {
                if !meta.is_dir() { return Err(UNSAFE_PATH); }
                verify(directory, true)?;
            }
        }
        let sources = metadata.sources.iter().map(|source| (source["id"].as_str().ok_or(INVALID), source))
            .map(|(id, source)| Ok((id?, source))).collect::<Result<BTreeMap<_, _>, &'static str>>()?;
        let mut owners = Vec::new();
        let mut manga_paths = BTreeMap::new();
        for (source_id, source) in &sources {
            if *source_id == "0" { continue; }
            owners.push(PathOwner { path: safe_component(source["displayName"].as_str().ok_or(INVALID)?)?, owner: format!("source:{source_id}") });
        }
        for (manga_id, manga) in &metadata.mangas {
            let source_id = manga["sourceId"].as_str().ok_or(INVALID)?;
            if source_id == "0" { continue; }
            let source = sources.get(source_id).ok_or(INVALID)?;
            let path = format!("{}/{}", safe_component(source["displayName"].as_str().ok_or(INVALID)?)?, safe_component(manga["title"].as_str().ok_or(INVALID)?)?);
            owners.push(PathOwner { path: path.clone(), owner: format!("manga:{manga_id}") });
            manga_paths.insert(*manga_id, path);
        }
        let mut rows = Vec::new();
        for (id, chapter) in &metadata.chapters {
            let manga_id = positive_id(&chapter["mangaId"])?;
            let manga = metadata.mangas.get(&manga_id).ok_or(INVALID)?;
            let source_id = manga["sourceId"].as_str().ok_or(INVALID)?;
            let source = sources.get(source_id).ok_or(INVALID)?;
            if source_id == "0" { continue; }
            let chapter_name = chapter["name"].as_str().ok_or(INVALID)?;
            let chapter_stem = match chapter["scanlator"].as_str() {
                Some(scanlator) => format!("{scanlator}_{chapter_name}"),
                None if chapter["scanlator"].is_null() => chapter_name.to_owned(),
                None => return Err(INVALID),
            };
            let manga_path = manga_paths.get(&manga_id).ok_or(INVALID)?;
            let chapter_path = format!("{manga_path}/{}", safe_component(&chapter_stem)?);
            owners.push(PathOwner { path: chapter_path.clone(), owner: format!("chapter:{id}") });
            owners.push(PathOwner { path: format!("{chapter_path}.cbz"), owner: format!("chapter:{id}") });
            rows.push((*id, manga_id, chapter, manga, source, PathBuf::from(chapter_path)));
        }
        validate_namespace(&owners)?;
        let mut items = Vec::new();
        for (id, manga_id, chapter, manga, source, relative) in rows {
            if chapter["isDownloaded"] != true || chapter["isRead"] != true || chapter["isBookmarked"] != false
                || manga["inLibrary"] != true || source["extension"]["isInstalled"] != true { continue; }
            let Some(page_count) = chapter["pageCount"].as_u64().filter(|count| *count > 0 && *count <= u64::from(MAX_PAGES)) else { continue; };
            let Some(fingerprint) = inspect_download(&root, &relative, page_count as u32, &verify, hash_ids.contains(&id))? else { continue; };
            let source_id = manga["sourceId"].as_str().ok_or(INVALID)?;
            let manga_identity = backup_identity("tsugi-manga-v1", source_id, backup_url(&manga["url"])?);
            let chapter_identity = backup_identity("tsugi-chapter-v1", &manga_identity, backup_url(&chapter["url"])?);
            let public = json!({"chapterId": id, "mangaId": manga_id, "mangaIdentity": manga_identity, "chapterIdentity": chapter_identity,
                "mangaTitle": label(&manga["title"])?, "chapterName": label(&chapter["name"])?, "sourceName": label(&source["displayName"])?,
                "bytes": fingerprint.bytes, "files": fingerprint.files, "format": fingerprint.format});
            items.push(CleanupItem { chapter_id: id, relative, page_count: page_count as u32, public, fingerprint });
        }
        Ok(items)
    }

    pub fn download_cleanup_candidates(&self, offset: u32) -> Result<Value, &'static str> {
        if offset as usize > MAX_CHAPTERS || offset % 100 != 0 { return Err("Invalid cleanup inventory page."); }
        self.cleanup_settings()?;
        let metadata = self.cleanup_metadata()?;
        let items = self.cleanup_items(&metadata, &BTreeSet::new())?;
        if offset as usize > items.len() { return Err("The download inventory changed. Refresh the first page."); }
        Ok(json!({"items": items.iter().skip(offset as usize).take(100).map(|item| item.public.clone()).collect::<Vec<_>>(),
            "totalCount": items.len(), "totalBytes": items.iter().map(|item| item.fingerprint.bytes).sum::<u64>(), "offset": offset}))
    }

    pub fn review_download_cleanup(&self, ids: &[i32]) -> Result<DownloadCleanupReview, &'static str> {
        let selected = ids.iter().copied().collect::<BTreeSet<_>>();
        if ids.is_empty() || ids.len() > 50 || selected.len() != ids.len() || ids.iter().any(|id| *id <= 0) { return Err("Select between one and fifty distinct eligible chapter downloads."); }
        let settings = self.cleanup_settings()?;
        let metadata = self.cleanup_metadata()?;
        let available = self.cleanup_items(&metadata, &selected)?.into_iter().map(|item| (item.chapter_id, item)).collect::<BTreeMap<_, _>>();
        let items = ids.iter().map(|id| available.get(id).cloned().ok_or("A selected chapter is no longer eligible for download cleanup.")).collect::<Result<Vec<_>, _>>()?;
        let total = items.iter().map(|item| item.fingerprint.bytes).sum::<u64>();
        if total > MAX_REVIEW_BYTES { return Err("Select at most 2 GiB of chapter downloads per cleanup review."); }
        // Reading all selected files must not have raced a metadata or job change.
        if self.cleanup_settings()? != settings || !metadata.exact_eq(&self.cleanup_metadata()?) { return Err(CHANGED); }
        let mut entropy = [0u8; 16];
        getrandom::fill(&mut entropy).map_err(|_| "Could not prepare the cleanup review.")?;
        let id = entropy.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
        let descriptions = items.iter().map(|item| format!("• {} — {} ({} bytes)", item.public["mangaTitle"].as_str().unwrap_or_default(), item.public["chapterName"].as_str().unwrap_or_default(), item.fingerprint.bytes)).collect::<Vec<_>>().join("\n");
        let description = format!("Remove {} completed, read and unbookmarked chapter downloads from Tsugi's private Reader storage?\n\n{descriptions}\n\nTotal: {total} logical bytes.\n\nLibrary entries, read progress, bookmarks and categories must remain unchanged. The verified metadata safety copy does not include downloaded chapter media. Removed pages cannot be restored from that copy; downloading them again depends on the source remaining available. Cleanup stops at the first failure, and only confirmed removals count as freed space.", items.len());
        Ok(DownloadCleanupReview { id, created: Instant::now(), owner_pid: self.client.owner_pid, port: self.client.port, data_path: self.data_path.clone(), settings, metadata, items, description })
    }

    pub fn apply_reviewed_download_cleanup(&self, review: DownloadCleanupReview) -> Result<Value, &'static str> {
        if review.created.elapsed() > REVIEW_LIFETIME || review.owner_pid != self.client.owner_pid || review.port != self.client.port || review.data_path != self.data_path { return Err("The cleanup review expired or the Reader restarted. Review the selection again."); }
        verify_listener(self.client.port, self.client.owner_pid)?;
        if self.cleanup_settings()? != review.settings || !review.metadata.exact_eq(&self.cleanup_metadata()?) { return Err(CHANGED); }
        let selected = review.items.iter().map(|item| item.chapter_id).collect::<BTreeSet<_>>();
        let current = self.cleanup_items(&review.metadata, &selected)?.into_iter().map(|item| (item.chapter_id, item)).collect::<BTreeMap<_, _>>();
        for item in &review.items {
            let now = current.get(&item.chapter_id).ok_or(CHANGED)?;
            if item.public != now.public || item.relative != now.relative || item.fingerprint != now.fingerprint { return Err(CHANGED); }
        }
        let user = private_storage::CurrentUser::get()?;
        let verify = |path: &Path, directory| user.verify_descendant(path, directory);
        let root = self.data_path.join("downloads/mangas");
        let mut expected = review.metadata.clone();
        let mut results = Vec::new();
        let mut stopped = false;
        let mut metadata_preserved = true;
        let mut removed_count = 0u32;
        let mut removed_bytes = 0u64;
        for item in &review.items {
            if stopped {
                results.push(json!({"chapterId": item.chapter_id, "status": "not-attempted", "bytes": 0, "error": "Cleanup stopped after the previous failure."}));
                continue;
            }
            let attempt = (|| {
                if review.created.elapsed() > REVIEW_LIFETIME { return Err("The cleanup review expired. Review the remaining downloads again."); }
                if self.cleanup_settings()? != review.settings { return Err(CHANGED); }
                let current = self.cleanup_metadata()?;
                metadata_preserved &= review.metadata.protected_eq(&current);
                if !expected.exact_eq(&current) { return Err(CHANGED); }
                if inspect_download(&root, &item.relative, item.page_count, &verify, true)?.as_ref() != Some(&item.fingerprint) { return Err(CHANGED); }
                let mutation = self.client.slow().mutation(
                    "mutation TsugiCleanupChapter($input: DeleteDownloadedChaptersInput!) { deleteDownloadedChapters(input: $input) { chapters { id isDownloaded } } }",
                    "deleteDownloadedChapters", json!({"ids": [item.chapter_id]}));
                // Upstream ignores a provider's false deletion result. Always
                // check actual paths and exact protected state independently.
                let post = match self.cleanup_metadata() {
                    Ok(post) => post,
                    Err(error) => { metadata_preserved = false; return Err(error); }
                };
                metadata_preserved &= review.metadata.protected_eq(&post);
                expected.chapters.get_mut(&item.chapter_id).ok_or(INVALID)?["isDownloaded"] = json!(false);
                if !metadata_preserved || !expected.exact_eq(&post) { return Err("Cleanup could not confirm unchanged reading metadata. Stop and review the metadata safety copy."); }
                let folder = root.join(&item.relative);
                let cbz = root.join(format!("{}.cbz", item.relative.to_str().ok_or(UNSAFE_PATH)?));
                if checked_metadata(&folder)?.is_some() || checked_metadata(&cbz)?.is_some() {
                    return Err("The chapter files were not completely removed. The download indicator may have changed; no reclaimed bytes were confirmed.");
                }
                mutation?;
                Ok(())
            })();
            match attempt {
                Ok(()) => {
                    removed_count += 1;
                    removed_bytes += item.fingerprint.bytes;
                    results.push(json!({"chapterId": item.chapter_id, "status": "removed", "bytes": item.fingerprint.bytes}));
                }
                Err(error) => {
                    stopped = true;
                    results.push(json!({"chapterId": item.chapter_id, "status": "failed", "bytes": 0, "error": error}));
                }
            }
        }
        Ok(json!({"reviewId": review.id, "items": results, "removedCount": removed_count, "removedBytes": removed_bytes, "metadataPreserved": metadata_preserved}))
    }
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    struct TestRoot(PathBuf);
    impl TestRoot {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("tsugi-cleanup-unit-{}-{}", std::process::id(), SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_nanos()));
            #[cfg(windows)]
            assert!(private_storage::CurrentUser::get().unwrap().create_root(&path).unwrap());
            #[cfg(not(windows))]
            fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn verify(&self, path: &Path, directory: bool) -> Result<(), &'static str> {
            let metadata = checked_metadata(path)?.ok_or(UNSAFE_PATH)?;
            if metadata.is_dir() != directory { return Err(UNSAFE_PATH); }
            #[cfg(windows)]
            private_storage::CurrentUser::get()?.verify_descendant(path, directory)?;
            Ok(())
        }
        fn chapter(&self) -> PathBuf {
            let relative = PathBuf::from("Original source/Original title/Original chapter");
            let path = self.0.join(&relative);
            fs::create_dir_all(&path).unwrap();
            fs::write(path.join("001.png"), b"original authored page bytes").unwrap();
            fs::write(path.join("ComicInfo.xml"), b"<ComicInfo/>").unwrap();
            relative
        }
    }
    impl Drop for TestRoot { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }

    #[test]
    fn cleanup_paths_follow_pinned_safepath_and_refuse_windows_aliases() {
        assert_eq!(safe_component(". a/b:c?. ").unwrap(), "a_b_c_");
        assert_eq!(safe_component(" ... ").unwrap(), "(invalid)");
        assert_eq!(safe_component(&"界".repeat(81)).unwrap(), "界".repeat(80));
        assert_eq!(safe_component(&"😀".repeat(61)).unwrap(), "😀".repeat(60));
        for name in ["CON", "con.txt", "CON .txt", "NUL.cbz", "LPT9", "COM¹.txt", "CONOUT$"] {
            assert!(safe_component(name).is_err(), "reserved Win32 device names must not be opened");
        }
        let truncated_dot = format!("{}.tail", "a".repeat(239));
        assert!(safe_component(&truncated_dot).is_err(), "truncation must not introduce a trailing-dot alias");
    }

    #[test]
    fn cleanup_ownership_rejects_case_sanitization_and_cross_provider_aliases() {
        let rows = |left: String, right: String| [PathOwner { path: left, owner: "chapter:1".into() }, PathOwner { path: right, owner: "chapter:2".into() }];
        assert!(validate_namespace(&rows("Source/Title/Chapter".into(), "source/TITLE/chapter".into())).is_err());
        assert!(validate_namespace(&rows(safe_component("A/B").unwrap(), safe_component("A\\B").unwrap())).is_err());
        assert!(validate_namespace(&rows("Source/Title/Chapter.cbz".into(), "Source/Title/Chapter.CBZ".into())).is_err());
        assert!(validate_namespace(&rows("Source/Title/Chapter 1".into(), "Source/Title/Chapter 2".into())).is_ok());
        assert!(validate_namespace(&[PathOwner { path: "source".into(), owner: "source:1".into() }, PathOwner { path: "SOURCE".into(), owner: "source:1".into() }]).is_ok());
    }

    #[test]
    fn cleanup_folder_fingerprint_detects_same_size_replacement_and_unknown_files() {
        let root = TestRoot::new();
        let relative = root.chapter();
        let verify = |path: &Path, directory| root.verify(path, directory);
        let original = inspect_download(&root.0, &relative, 1, &verify, true).unwrap().unwrap();
        assert_eq!(original.format, "folder");
        assert_eq!(original.files, 2);
        assert_eq!(original.bytes, 40);
        let page = root.0.join(&relative).join("001.png");
        let modified = fs::metadata(&page).unwrap().modified().unwrap();
        fs::write(&page, b"changed! authored page bytes").unwrap();
        fs::File::open(&page).unwrap().set_times(fs::FileTimes::new().set_modified(modified)).unwrap();
        let changed = inspect_download(&root.0, &relative, 1, &verify, true).unwrap().unwrap();
        assert_eq!(original.bytes, changed.bytes);
        assert_eq!(original.entries[0].modified, changed.entries[0].modified);
        assert_ne!(original.entries[0].sha256, changed.entries[0].sha256);
        fs::write(root.0.join(&relative).join("unrelated.txt"), b"keep").unwrap();
        assert!(inspect_download(&root.0, &relative, 1, &verify, true).is_err());
        assert_eq!(fs::read(root.0.join(&relative).join("unrelated.txt")).unwrap(), b"keep");
    }

    fn stored_cbz(entries: &[(&str, &[u8])]) -> Vec<u8> {
        fn word(out: &mut Vec<u8>, value: u16) { out.extend_from_slice(&value.to_le_bytes()); }
        fn dword(out: &mut Vec<u8>, value: u32) { out.extend_from_slice(&value.to_le_bytes()); }
        let mut result = Vec::new();
        let mut central = Vec::new();
        for (name, contents) in entries {
            let mut crc = !0u32;
            for byte in *contents {
                crc ^= u32::from(*byte);
                for _ in 0..8 { crc = (crc >> 1) ^ (0xedb88320u32 & 0u32.wrapping_sub(crc & 1)); }
            }
            let crc = !crc;
            let start = result.len() as u32;
            result.extend_from_slice(b"PK\x03\x04");
            for value in [20, 0, 0, 0, 0] { word(&mut result, value); }
            for value in [crc, contents.len() as u32, contents.len() as u32] { dword(&mut result, value); }
            word(&mut result, name.len() as u16); word(&mut result, 0);
            result.extend_from_slice(name.as_bytes()); result.extend_from_slice(contents);
            central.extend_from_slice(b"PK\x01\x02");
            for value in [20, 20, 0, 0, 0, 0] { word(&mut central, value); }
            for value in [crc, contents.len() as u32, contents.len() as u32] { dword(&mut central, value); }
            for value in [name.len() as u16, 0, 0, 0, 0] { word(&mut central, value); }
            dword(&mut central, 0); dword(&mut central, start); central.extend_from_slice(name.as_bytes());
        }
        let offset = result.len() as u32;
        result.extend_from_slice(&central); result.extend_from_slice(b"PK\x05\x06");
        for value in [0, 0, entries.len() as u16, entries.len() as u16] { word(&mut result, value); }
        dword(&mut result, central.len() as u32); dword(&mut result, offset); word(&mut result, 0);
        result
    }

    #[test]
    fn cleanup_cbz_requires_complete_flat_pages_and_one_unambiguous_provider() {
        let root = TestRoot::new();
        let relative = root.chapter();
        let verify = |path: &Path, directory| root.verify(path, directory);
        let cbz = root.0.join(format!("{}.cbz", relative.to_str().unwrap()));
        let bytes = stored_cbz(&[("001.png", b"original page"), ("ComicInfo.xml", b"<ComicInfo/>")]);
        fs::write(&cbz, &bytes).unwrap();
        assert!(inspect_download(&root.0, &relative, 1, &verify, true).is_err(), "a folder plus archive is ambiguous");
        fs::remove_dir_all(root.0.join(&relative)).unwrap();
        let archive = inspect_download(&root.0, &relative, 1, &verify, true).unwrap().unwrap();
        assert_eq!(archive.format, "cbz");
        assert_eq!(archive.files, 1);
        assert_eq!(archive.bytes, bytes.len() as u64);
        assert!(inspect_download(&root.0, &relative, 2, &verify, true).is_err(), "missing archive pages are not completed downloads");
        fs::write(&cbz, stored_cbz(&[("../001.png", b"original page"), ("ComicInfo.xml", b"<ComicInfo/>")])).unwrap();
        assert!(inspect_download(&root.0, &relative, 1, &verify, true).is_err());
        assert!(inspect_download(&root.0, Path::new("Original source/Original title/.."), 1, &verify, true).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn cleanup_folder_refuses_redirected_files_and_parents() {
        use std::os::unix::fs::symlink;
        let root = TestRoot::new();
        let relative = root.chapter();
        let verify = |path: &Path, directory| root.verify(path, directory);
        let original = root.0.join(&relative).join("001.png");
        let outside = root.0.join("retained-original");
        fs::rename(&original, &outside).unwrap();
        symlink(&outside, &original).unwrap();
        assert!(inspect_download(&root.0, &relative, 1, &verify, true).is_err());
        assert_eq!(fs::read(&outside).unwrap(), b"original authored page bytes");
    }
}

#[cfg(test)]
#[path = "read_download_cleanup_tests.rs"]
mod tests;
