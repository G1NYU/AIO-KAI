//! Reviewed local CBZ import. Original paths and staged files remain native.
//! Only generated, verified PNG/JPEG folders are published to local source 0.
use super::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Component, PathBuf, Prefix};

const MAX_ARCHIVE: u64 = 256 * 1024 * 1024;
const MAX_EXPANDED: u64 = 512 * 1024 * 1024;
const MAX_MANIFEST: u64 = 512 * 1024;
const MAX_PIXELS: u64 = 32_000_000;
const STAGES: &str = ".tsugi-cbz-staging";
const CHAPTER: &str = "Chapter 1";
const RECORD: &str = ".tsugi-cbz-import";
const INVALID: &str = "The CBZ archive could not be safely imported. Choose a supported PNG/JPEG archive within the import limits.";
const STALE: &str = "The CBZ import review expired or changed. Choose the archive again.";
const PRIVATE_ROOT: &str = "CBZ import requires the default private local manga folder.";
const UNREADABLE: &str = "The selected CBZ could not be read. Close other applications using it and choose it again.";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ImportPage { name: String, bytes: u64, sha256: String, width: u32, height: u32 }

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ImportManifest {
    version: u32,
    archive_sha256: String,
    archive_bytes: u64,
    expanded_bytes: u64,
    page_count: u32,
    pages: Vec<ImportPage>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct ImportRecord { version: u32, title: String, manifest: ImportManifest }

fn hexadecimal(value: &str, length: usize) -> bool {
    value.len() == length && value.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_title(title: &str) -> bool {
    !title.is_empty() && title.trim() == title && title.chars().count() <= 200
        && !title.chars().any(char::is_control)
}

fn selected_title(path: &Path) -> Result<String, &'static str> {
    let name = path.file_stem().and_then(|name| name.to_str()).ok_or(UNREADABLE)?;
    let title = name.chars().filter(|c| !c.is_control() && !matches!(*c, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}'))
        .take(200).collect::<String>().trim().to_owned();
    Ok(if title.is_empty() { "Imported comic".to_owned() } else { title })
}

fn validate_manifest(manifest: &ImportManifest) -> Result<(), &'static str> {
    if manifest.version != 1 || !hexadecimal(&manifest.archive_sha256, 64)
        || !(1..=MAX_ARCHIVE).contains(&manifest.archive_bytes)
        || !(1..=MAX_EXPANDED).contains(&manifest.expanded_bytes)
        || !(1..=MAX_PAGES as u32).contains(&manifest.page_count)
        || manifest.pages.len() != manifest.page_count as usize { return Err(INVALID); }
    let mut expanded = 0u64;
    for (index, page) in manifest.pages.iter().enumerate() {
        if ![format!("{:04}.png", index + 1), format!("{:04}.jpg", index + 1)].contains(&page.name)
            || !(1..=MAX_PAGE).contains(&page.bytes) || !hexadecimal(&page.sha256, 64)
            || page.width == 0 || page.height == 0 || page.width > 100_000 || page.height > 100_000
            || u64::from(page.width) * u64::from(page.height) > MAX_PIXELS { return Err(INVALID); }
        expanded = expanded.checked_add(page.bytes).ok_or(INVALID)?;
    }
    // The only discarded non-image entry is bounded root ComicInfo.xml.
    if expanded > manifest.expanded_bytes || manifest.expanded_bytes - expanded > 64 * 1024 { return Err(INVALID); }
    Ok(())
}

fn regular(path: &Path, directory: bool) -> Result<fs::Metadata, &'static str> {
    let metadata = fs::symlink_metadata(path).map_err(|_| INVALID)?;
    if metadata.file_attributes() & 0x400 != 0 || metadata.is_dir() != directory
        || (!directory && !metadata.is_file()) { return Err(INVALID); }
    Ok(metadata)
}

fn private(user: &private_storage::CurrentUser, path: &Path, directory: bool) -> Result<(), &'static str> {
    regular(path, directory)?;
    user.verify_descendant(path, directory).map_err(|_| PRIVATE_ROOT)
}

fn private_root(user: &private_storage::CurrentUser, data: &Path) -> Result<(), &'static str> {
    regular(data, true)?;
    user.verify(data, true).map_err(|_| PRIVATE_ROOT)
}

fn exact_children(user: &private_storage::CurrentUser, path: &Path, expected: &[(&str, bool)]) -> Result<(), &'static str> {
    private(user, path, true)?;
    let mut seen = BTreeSet::new();
    for entry in fs::read_dir(path).map_err(|_| INVALID)? {
        if seen.len() >= expected.len() { return Err(INVALID); }
        let entry = entry.map_err(|_| INVALID)?;
        let name = entry.file_name().into_string().map_err(|_| INVALID)?;
        let directory = expected.iter().find(|(wanted, _)| *wanted == name).map(|(_, directory)| *directory).ok_or(INVALID)?;
        if !seen.insert(name) { return Err(INVALID); }
        private(user, &entry.path(), directory)?;
    }
    if seen.len() != expected.len() { return Err(INVALID); }
    Ok(())
}

/// Generated ASCII names must be exact, not a Windows case-fold alias.
fn child_exists(user: &private_storage::CurrentUser, parent: &Path, name: &str) -> Result<bool, &'static str> {
    private(user, parent, true)?;
    let mut found = false;
    for (index, entry) in fs::read_dir(parent).map_err(|_| INVALID)?.enumerate() {
        if index >= 10_000 { return Err(INVALID); }
        let entry = entry.map_err(|_| INVALID)?;
        let actual = entry.file_name().into_string().map_err(|_| INVALID)?;
        if actual.eq_ignore_ascii_case(name) {
            if found || actual != name { return Err(INVALID); }
            found = true;
        }
    }
    Ok(found)
}

fn ensure_directory(user: &private_storage::CurrentUser, parent: &Path, name: &str) -> Result<PathBuf, &'static str> {
    let path = parent.join(name);
    if !child_exists(user, parent, name)? { fs::create_dir(&path).map_err(|_| PRIVATE_ROOT)?; }
    private(user, &path, true)?;
    Ok(path)
}

fn locked_file(path: &Path) -> Result<fs::File, &'static str> {
    fs::OpenOptions::new().read(true).share_mode(1).custom_flags(0x0020_0000).open(path).map_err(|_| UNREADABLE)
}

fn file_hash(user: &private_storage::CurrentUser, path: &Path, limit: u64) -> Result<(u64, String), &'static str> {
    private(user, path, false)?;
    let mut file = locked_file(path)?;
    let metadata = file.metadata().map_err(|_| INVALID)?;
    if metadata.file_attributes() & 0x400 != 0 || !metadata.is_file() || metadata.len() == 0 || metadata.len() > limit { return Err(INVALID); }
    let mut hash = Sha256::new();
    let mut bytes = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|_| INVALID)?;
        if count == 0 { break; }
        bytes += count as u64;
        if bytes > metadata.len() { return Err(INVALID); }
        hash.update(&buffer[..count]);
    }
    if bytes != metadata.len() { return Err(INVALID); }
    private(user, path, false)?;
    Ok((bytes, format!("{:x}", hash.finalize())))
}

fn private_bytes(user: &private_storage::CurrentUser, path: &Path, maximum: u64) -> Result<Vec<u8>, &'static str> {
    private(user, path, false)?;
    let mut bytes = Vec::new();
    locked_file(path)?.take(maximum + 1).read_to_end(&mut bytes).map_err(|_| INVALID)?;
    if bytes.is_empty() || bytes.len() as u64 > maximum { return Err(INVALID); }
    Ok(bytes)
}

fn write_new(path: &Path, bytes: &[u8]) -> Result<(), &'static str> {
    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(path).map_err(|_| INVALID)?;
    file.write_all(bytes).and_then(|()| file.sync_all()).map_err(|_| INVALID)
}

fn cover_name(manifest: &ImportManifest) -> String {
    format!("cover.{}", manifest.pages[0].name.rsplit_once('.').unwrap().1)
}

fn verify_pages(user: &private_storage::CurrentUser, directory: &Path, manifest: &ImportManifest) -> Result<(), &'static str> {
    validate_manifest(manifest)?;
    let names = manifest.pages.iter().map(|page| (page.name.as_str(), false)).collect::<Vec<_>>();
    exact_children(user, directory, &names)?;
    for page in &manifest.pages {
        let path = directory.join(&page.name);
        if file_hash(user, &path, MAX_PAGE)? != (page.bytes, page.sha256.clone()) { return Err(STALE); }
        let mut header = [0u8; 16];
        let count = locked_file(&path)?.read(&mut header).map_err(|_| INVALID)?;
        let expected = if page.name.ends_with(".png") { "image/png" } else { "image/jpeg" };
        if image_mime(&header[..count]) != Some(expected) { return Err(INVALID); }
    }
    Ok(())
}

fn book_metadata(user: &private_storage::CurrentUser, path: &Path) -> Result<ImportRecord, &'static str> {
    private(user, path, true)?;
    let record: ImportRecord = serde_json::from_slice(&private_bytes(user, &path.join(RECORD), MAX_MANIFEST)?).map_err(|_| INVALID)?;
    if record.version != 1 || !valid_title(&record.title) { return Err(INVALID); }
    validate_manifest(&record.manifest)?;
    let cover = cover_name(&record.manifest);
    exact_children(user, path, &[(CHAPTER, true), (RECORD, false), ("details.json", false), (&cover, false)])?;
    let details = serde_json::to_vec(&json!({"title": record.title})).map_err(|_| INVALID)?;
    if private_bytes(user, &path.join("details.json"), 2048)? != details { return Err(STALE); }
    Ok(record)
}

fn verify_book(user: &private_storage::CurrentUser, path: &Path) -> Result<ImportRecord, &'static str> {
    let record = book_metadata(user, path)?;
    verify_pages(user, &path.join(CHAPTER), &record.manifest)?;
    let first = &record.manifest.pages[0];
    if file_hash(user, &path.join(cover_name(&record.manifest)), MAX_PAGE)? != (first.bytes, first.sha256.clone()) { return Err(STALE); }
    Ok(record)
}

struct OwnedStage { data: PathBuf, id: String }
impl OwnedStage {
    fn path(&self) -> PathBuf { self.data.join(STAGES).join(&self.id) }
}
impl Drop for OwnedStage {
    fn drop(&mut self) { let _ = remove_owned_stage(&self.data, &self.id); }
}

fn remove_owned_stage(data: &Path, id: &str) -> Result<(), &'static str> {
    if !hexadecimal(id, 32) { return Err(INVALID); }
    let user = private_storage::CurrentUser::get()?;
    private_root(&user, data)?;
    let parent = data.join(STAGES);
    private(&user, &parent, true)?;
    let root = parent.join(id);
    if !root.try_exists().map_err(|_| INVALID)? { return Ok(()); }
    private(&user, &root, true)?;
    if private_bytes(&user, &root.join(".owner"), 32)? != id.as_bytes() { return Err(INVALID); }
    // Collect and verify the entire bounded tree before removing any entry.
    // Never recurse through a reparse point or touch the published local tree.
    let mut entries = vec![(root.clone(), true, 0usize)];
    let mut at = 0;
    while at < entries.len() {
        let (path, directory, depth) = entries[at].clone();
        if depth > 4 || entries.len() > 4010 { return Err(INVALID); }
        private(&user, &path, directory)?;
        if directory {
            for entry in fs::read_dir(&path).map_err(|_| INVALID)? {
                if entries.len() >= 4010 { return Err(INVALID); }
                let entry = entry.map_err(|_| INVALID)?;
                let metadata = fs::symlink_metadata(entry.path()).map_err(|_| INVALID)?;
                if metadata.file_attributes() & 0x400 != 0 || (!metadata.is_file() && !metadata.is_dir()) { return Err(INVALID); }
                entries.push((entry.path(), metadata.is_dir(), depth + 1));
            }
        }
        at += 1;
    }
    for (path, directory, _) in entries.into_iter().rev() {
        private(&user, &path, directory)?;
        if directory { fs::remove_dir(&path) } else { fs::remove_file(&path) }.map_err(|_| INVALID)?;
    }
    Ok(())
}

/// Called only after the application's exclusive Reader storage lock is held.
/// A malformed or unmarked entry is retained instead of guessed to be ours.
pub(super) fn remove_abandoned_stages(data: &Path) {
    let Ok(user) = private_storage::CurrentUser::get() else { return };
    if private_root(&user, data).is_err() || private(&user, &data.join(STAGES), true).is_err() { return; }
    let Ok(entries) = fs::read_dir(data.join(STAGES)) else { return };
    for entry in entries.take(33) {
        let Ok(entry) = entry else { return };
        let Some(id) = entry.file_name().to_str().map(str::to_owned) else { continue };
        if hexadecimal(&id, 32) { let _ = remove_owned_stage(data, &id); }
    }
}

/// One-use review owned by the worker; dropping it cleans verified staging.
pub struct LocalImportReview {
    id: String,
    created: Instant,
    owner_pid: u32,
    port: u16,
    stage: OwnedStage,
    record: ImportRecord,
    duplicate: bool,
    description: String,
}
impl LocalImportReview {
    pub fn id(&self) -> &str { &self.id }
    pub fn description(&self) -> &str { &self.description }
    pub fn preview(&self) -> Value {
        let manifest = &self.record.manifest;
        json!({"reviewId": self.id, "title": self.record.title, "archiveSha256": manifest.archive_sha256,
            "archiveBytes": manifest.archive_bytes, "expandedBytes": manifest.expanded_bytes,
            "pageCount": manifest.page_count, "duplicate": self.duplicate})
    }
}

fn import_classpath(runtime: &Path) -> Result<PathBuf, &'static str> {
    let current = runtime.parent().ok_or(INVALID)?.join("read-launcher");
    if current.join("TsugiReadLauncher.class").try_exists().map_err(|_| INVALID)? {
        regular(&current, true)?; regular(&current.join("TsugiReadLauncher.class"), false)?; return Ok(current);
    }
    let prepared = runtime.join("launcher");
    regular(&prepared, true)?; regular(&prepared.join("TsugiReadLauncher.class"), false)?;
    Ok(prepared)
}

fn copy_selected(selected: &Path, stage: &Path, data: &Path, runtime: &Path, stopped: &AtomicBool) -> Result<(u64, String), &'static str> {
    if !selected.is_absolute() || !selected.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("cbz"))
        || selected.starts_with(data) || selected.starts_with(runtime) { return Err(UNREADABLE); }
    match selected.components().next() {
        Some(Component::Prefix(prefix)) if matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_)) => (),
        _ => return Err(UNREADABLE),
    }
    for ancestor in selected.ancestors() {
        if ancestor.as_os_str().is_empty() { break; }
        regular(ancestor, ancestor != selected).map_err(|_| UNREADABLE)?;
    }
    let mut input = locked_file(selected)?;
    let size = input.metadata().map_err(|_| UNREADABLE)?.len();
    if size == 0 || size > MAX_ARCHIVE { return Err(INVALID); }
    let mut output = fs::OpenOptions::new().write(true).create_new(true).open(stage.join("input.cbz")).map_err(|_| INVALID)?;
    let mut digest = Sha256::new();
    let mut total = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        if stopped.load(Ordering::Acquire) { return Err("CBZ import cancelled."); }
        let count = input.read(&mut buffer).map_err(|_| UNREADABLE)?;
        if count == 0 { break; }
        total += count as u64;
        if total > size { return Err(UNREADABLE); }
        output.write_all(&buffer[..count]).map_err(|_| INVALID)?;
        digest.update(&buffer[..count]);
    }
    if total != size { return Err(UNREADABLE); }
    output.sync_all().map_err(|_| INVALID)?;
    Ok((total, format!("{:x}", digest.finalize())))
}

impl ReadRuntime {
    fn cached_imported_titles(&self) -> Result<Vec<Value>, &'static str> {
        let cached = self.client.document(
            "query TsugiImportedTitleSearch { mangas(filter: {sourceId: {equalTo: \"0\"}, url: {startsWith: \"tsugi-cbz-\"}}, first: 1001, order: [{by: ID, byType: ASC}]) { nodes { id sourceId url title author thumbnailUrl inLibrary } totalCount } }",
            "mangas", json!({}))?;
        let rows = cached["nodes"].as_array().filter(|rows| rows.len() <= 1000).ok_or("The complete local comic search exceeded 1000 cached imports. Open the title from Library.")?;
        if cached["totalCount"].as_u64() != Some(rows.len() as u64) { return Err(INVALID); }
        Ok(rows.clone())
    }

    /// Refuse predictable result/metadata limits before LocalSource's normal
    /// catalogue mutation can overwrite any known imported title.
    pub(super) fn preflight_local_import_catalogue(&self, query: Option<&str>) -> Result<(), &'static str> {
        let settings = self.client.document("query TsugiLocalCataloguePreflight { settings { localSourcePath } }", "settings", json!({}))?;
        if settings["localSourcePath"].as_str() != Some("") { return Ok(()); }
        let user = private_storage::CurrentUser::get()?; private_root(&user, &self.data_path)?;
        let local = self.data_path.join("local"); private(&user, &local, true)?;
        let needle = query.map(str::to_lowercase);
        let mut candidates = BTreeSet::new();
        for (index, entry) in fs::read_dir(&local).map_err(|_| INVALID)?.enumerate() {
            if index >= 10_000 { return Err(INVALID); }
            let entry = entry.map_err(|_| INVALID)?;
            let name = entry.file_name().into_string().map_err(|_| INVALID)?;
            if name.starts_with('.') || !entry.metadata().map_err(|_| INVALID)?.is_dir() { continue; }
            // Count non-ASCII names conservatively: Java's per-character
            // ignoreCase relation can differ from Rust's Unicode lowercase.
            if needle.as_ref().is_none_or(|needle| !name.is_ascii() || name.to_ascii_lowercase().contains(needle)) {
                candidates.insert(name);
                if candidates.len() > 200 { return Err("The local catalogue exceeded 200 titles. Use a narrower search."); }
            }
        }
        let mut budget = 0;
        let mut last_id = 0;
        let mut urls = BTreeSet::new();
        for row in self.cached_imported_titles()? {
            let id = row["id"].as_i64().filter(|id| *id > last_id && *id <= i32::MAX as i64).ok_or(INVALID)?;
            last_id = id;
            let url = row["url"].as_str().ok_or(INVALID)?;
            let title = row["title"].as_str().ok_or(INVALID)?;
            if row["sourceId"] != "0" || !urls.insert(url.to_owned()) { return Err(INVALID); }
            if needle.as_ref().is_some_and(|needle| !candidates.contains(url) && !title.to_lowercase().contains(needle) && title != url) { continue; }
            if let Some(record) = self.owned_catalogue_metadata(&user, &local, &row, &mut budget)? {
                if needle.as_ref().is_none_or(|needle| record.title.to_lowercase().contains(needle)) {
                    candidates.insert(url.to_owned());
                    if candidates.len() > 200 { return Err("The local catalogue exceeded 200 titles. Use a narrower search."); }
                }
            }
        }
        Ok(())
    }

    fn owned_catalogue_metadata(&self, user: &private_storage::CurrentUser, local: &Path, row: &Value,
        budget: &mut u64) -> Result<Option<ImportRecord>, &'static str>
    {
        let Some(folder) = row["url"].as_str() else { return Err(INVALID) };
        let Some(hash) = folder.strip_prefix("tsugi-cbz-").filter(|hash| hexadecimal(hash, 64)) else { return Ok(None) };
        if row["sourceId"] != "0" || !row["id"].as_i64().is_some_and(|id| id > 0 && id <= i32::MAX as i64) { return Err(INVALID); }
        if !child_exists(user, local, folder)? { return Ok(None); }
        let path = local.join(folder);
        private(user, &path, true)?;
        if !child_exists(user, &path, RECORD)? { return Ok(None); }
        let bytes = regular(&path.join(RECORD), false)?.len();
        *budget = budget.checked_add(bytes).ok_or(INVALID)?;
        if *budget > 16 * 1024 * 1024 { return Err("The complete local comic search exceeded its metadata limit. Open the title from Library."); }
        let record = book_metadata(user, &path)?;
        if record.manifest.archive_sha256 != hash { return Err(STALE); }
        Ok(Some(record))
    }

    fn refresh_imported_title(&self, row: &mut Value, record: &ImportRecord) -> Result<(), &'static str> {
        let folder = row["url"].as_str().ok_or(INVALID)?;
        let before = self.local_import_record(folder)?.ok_or(INVALID)?;
        if before["id"] != row["id"] || before["sourceId"] != "0" { return Err(INVALID); }
        if before["title"] != record.title {
            let id = before["id"].as_i64().ok_or(INVALID)?;
            self.client.slow().mutation(
                "mutation TsugiRefreshImportedTitle($input: FetchMangaAndChaptersInput!) { fetchMangaAndChapters(input: $input) { manga { id sourceId url title } } }",
                "fetchMangaAndChapters", json!({"id": id, "fetchManga": true, "fetchChapters": false}))?;
            let after = self.local_import_record(folder)?.ok_or(INVALID)?;
            if after["id"] != before["id"] || after["sourceId"] != "0" || after["url"] != folder
                || after["title"] != record.title || after["chapters"] != before["chapters"] || after["inLibrary"] != before["inLibrary"] { return Err(INVALID); }
        }
        row["title"] = json!(record.title);
        Ok(())
    }

    /// LocalSource's catalogue uses folder names and overwrites cached local
    /// titles, including followed titles. Restore only importer-owned details.
    /// Friendly search merges existing cache rows; it performs no second
    /// catalogue lookup, page read, media hash scan or persisted search index.
    pub(super) fn complete_local_import_catalogue(&self, result: &mut Value, query: Option<&str>) -> Result<(), &'static str> {
        let settings = self.client.document("query TsugiLocalCatalogueRoot { settings { localSourcePath } }", "settings", json!({}))?;
        if settings["localSourcePath"].as_str() != Some("") { return Ok(()); }
        let user = private_storage::CurrentUser::get()?;
        private_root(&user, &self.data_path)?;
        let local = self.data_path.join("local"); private(&user, &local, true)?;
        if result["hasNextPage"] != false { return Err(INVALID); }
        let rows = result["mangas"].as_array_mut().filter(|rows| rows.len() <= 200).ok_or("The local catalogue exceeded 200 titles. Use a narrower search.")?;
        let mut seen = std::collections::BTreeMap::new();
        let mut urls = BTreeSet::new();
        let mut budget = 0u64;
        for row in rows.iter_mut() {
            let id = row["id"].as_i64().filter(|id| *id > 0 && *id <= i32::MAX as i64).ok_or(INVALID)?;
            let url = row["url"].as_str().ok_or(INVALID)?.to_owned();
            if row["sourceId"] != "0" || seen.insert(id, url.clone()).is_some() || !urls.insert(url) { return Err(INVALID); }
            if let Some(record) = self.owned_catalogue_metadata(&user, &local, row, &mut budget)? {
                self.refresh_imported_title(row, &record)?;
            }
        }
        let Some(query) = query else { return Ok(()) };
        let needle = query.to_lowercase();
        let matches = self.cached_imported_titles()?;
        let mut last_id = 0;
        for cached in matches {
            let id = cached["id"].as_i64().filter(|id| *id > last_id && *id <= i32::MAX as i64).ok_or(INVALID)?;
            last_id = id;
            let url = cached["url"].as_str().ok_or(INVALID)?;
            if cached["sourceId"] != "0" { return Err(INVALID); }
            if let Some(previous) = seen.get(&id) {
                if previous != url { return Err(INVALID); }
                continue;
            }
            let title = cached["title"].as_str().ok_or(INVALID)?;
            if !title.to_lowercase().contains(&needle) && title != url { continue; }
            let Some(record) = self.owned_catalogue_metadata(&user, &local, &cached, &mut budget)? else { continue };
            if !record.title.to_lowercase().contains(&needle) { continue; }
            if rows.len() >= 200 { return Err("The local catalogue exceeded 200 titles. Use a narrower search."); }
            if !urls.insert(url.to_owned()) { return Err(INVALID); }
            let mut row = cached.clone(); self.refresh_imported_title(&mut row, &record)?;
            seen.insert(id, url.to_owned()); rows.push(row);
        }
        Ok(())
    }

    fn local_import_root(&self) -> Result<(private_storage::CurrentUser, PathBuf), &'static str> {
        let settings = self.client.document("query TsugiLocalImportSettings { settings { localSourcePath } }", "settings", json!({}))?;
        if settings["localSourcePath"].as_str() != Some("") { return Err(PRIVATE_ROOT); }
        let user = private_storage::CurrentUser::get()?;
        private_root(&user, &self.data_path)?;
        let root = ensure_directory(&user, &self.data_path, "local")?;
        Ok((user, root))
    }

    fn validate_staged_cbz(&self, stage: &Path, stopped: &AtomicBool) -> Result<ImportManifest, &'static str> {
        let job = ReadJob::new()?;
        let mut child = Command::new(self.runtime_path.join("jre/bin/java.exe"))
            .arg(format!("-Djava.io.tmpdir={}", self._storage.temp_dir.display()))
            .args(["-Xmx384m", "-Djava.awt.headless=true", "-cp"]).arg(import_classpath(&self.runtime_path)?)
            .args(["TsugiReadLauncher", "--import-cbz"]).arg(stage.join("input.cbz")).arg(stage.join("pages"))
            .env_remove("JAVA_TOOL_OPTIONS").env_remove("JDK_JAVA_OPTIONS").env_remove("_JAVA_OPTIONS")
            .creation_flags(NO_WINDOW).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null())
            .spawn().map_err(|_| INVALID)?;
        if let Err(error) = job.attach_and_release(&mut child) { let _ = child.kill(); let _ = child.wait(); return Err(error); }
        let output = child.stdout.take().ok_or(INVALID)?;
        // The 2000-page manifest can exceed a Windows pipe buffer. Drain it
        // concurrently, with a hard output bound, while monitoring the helper.
        let collector = std::thread::spawn(move || {
            let mut bytes = Vec::new();
            output.take(MAX_MANIFEST + 1).read_to_end(&mut bytes).map(|_| bytes)
        });
        let deadline = Instant::now() + Duration::from_secs(120);
        let success = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status.success(),
                Ok(None) if !stopped.load(Ordering::Acquire) && Instant::now() < deadline => std::thread::sleep(Duration::from_millis(25)),
                _ => { let _ = child.kill(); let _ = child.wait(); break false; }
            }
        };
        drop(job);
        let bytes = collector.join().map_err(|_| INVALID)?.map_err(|_| INVALID)?;
        if !success || bytes.is_empty() || bytes.len() as u64 > MAX_MANIFEST { return Err(INVALID); }
        let manifest: ImportManifest = serde_json::from_slice(&bytes).map_err(|_| INVALID)?;
        validate_manifest(&manifest)?;
        Ok(manifest)
    }

    pub fn review_local_import(&self, selected: &Path, stopped: &AtomicBool) -> Result<LocalImportReview, &'static str> {
        let (user, local) = self.local_import_root()?;
        let parent = ensure_directory(&user, &self.data_path, STAGES)?;
        let mut entropy = [0u8; 16]; getrandom::fill(&mut entropy).map_err(|_| INVALID)?;
        let id = entropy.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
        let path = parent.join(&id);
        fs::create_dir(&path).map_err(|_| INVALID)?;
        private(&user, &path, true)?;
        if let Err(error) = write_new(&path.join(".owner"), id.as_bytes()) { let _ = fs::remove_dir(&path); return Err(error); }
        let stage = OwnedStage { data: self.data_path.clone(), id: id.clone() };
        let original = copy_selected(selected, &path, &self.data_path, &self.runtime_path, stopped)?;
        fs::create_dir(path.join("pages")).map_err(|_| INVALID)?;
        private(&user, &path.join("pages"), true)?;
        let manifest = self.validate_staged_cbz(&path, stopped)?;
        if original != (manifest.archive_bytes, manifest.archive_sha256.clone())
            || file_hash(&user, &path.join("input.cbz"), MAX_ARCHIVE)? != original { return Err(STALE); }
        verify_pages(&user, &path.join("pages"), &manifest)?;
        for page in &manifest.pages {
            let file = path.join("pages").join(&page.name);
            private(&user, &file, false)?;
            fs::OpenOptions::new().read(true).write(true).share_mode(1).custom_flags(0x0020_0000)
                .open(file).and_then(|file| file.sync_all()).map_err(|_| INVALID)?;
        }
        let folder = format!("tsugi-cbz-{}", manifest.archive_sha256);
        let duplicate = child_exists(&user, &local, &folder)?;
        let record = if duplicate {
            let previous = verify_book(&user, &local.join(&folder))?;
            if previous.manifest != manifest { return Err(STALE); }
            previous
        } else { ImportRecord { version: 1, title: selected_title(selected)?, manifest } };
        let book = path.join("book"); fs::create_dir(&book).map_err(|_| INVALID)?;
        fs::rename(path.join("pages"), book.join(CHAPTER)).map_err(|_| INVALID)?;
        write_new(&book.join("details.json"), &serde_json::to_vec(&json!({"title": record.title})).map_err(|_| INVALID)?)?;
        write_new(&book.join(RECORD), &serde_json::to_vec(&record).map_err(|_| INVALID)?)?;
        let first = book.join(CHAPTER).join(&record.manifest.pages[0].name);
        write_new(&book.join(cover_name(&record.manifest)), &private_bytes(&user, &first, MAX_PAGE)?)?;
        if verify_book(&user, &book)? != record { return Err(STALE); }
        let description = format!("Import local comic?\n\nTitle: {}\nPages: {}\nArchive: {} bytes\nExpanded contents: {} bytes\n\n{}The original archive stays unchanged. Local pages are not included in metadata backups.",
            record.title, record.manifest.page_count, record.manifest.archive_bytes, record.manifest.expanded_bytes,
            if duplicate { "The existing validated copy will be reused without resetting progress.\n\n" } else { "" });
        Ok(LocalImportReview { id, created: Instant::now(), owner_pid: self.client.owner_pid, port: self.client.port,
            stage, record, duplicate, description })
    }

    fn local_import_record(&self, folder: &str) -> Result<Option<Value>, &'static str> {
        let value = self.client.document(
            "query TsugiLocalImportRecord($url: String!) { mangas(condition: {sourceId: \"0\", url: $url}, first: 2) { nodes { id sourceId url title initialized inLibrary chapters { nodes { id mangaId url name pageCount isRead isBookmarked lastPageRead lastReadAt } totalCount } } totalCount } }",
            "mangas", json!({"url": folder}))?;
        let nodes = value["nodes"].as_array().ok_or(INVALID)?;
        if nodes.len() > 1 || value["totalCount"].as_u64() != Some(nodes.len() as u64) { return Err(INVALID); }
        let Some(manga) = nodes.first() else { return Ok(None) };
        let id = manga["id"].as_i64().filter(|id| *id > 0 && *id <= i32::MAX as i64).ok_or(INVALID)?;
        if manga["sourceId"] != "0" || manga["url"] != folder || !manga["inLibrary"].is_boolean() || !manga["initialized"].is_boolean() { return Err(INVALID); }
        let chapters = manga["chapters"]["nodes"].as_array().ok_or(INVALID)?;
        if chapters.len() > 1 || manga["chapters"]["totalCount"].as_u64() != Some(chapters.len() as u64) { return Err(INVALID); }
        if let Some(chapter) = chapters.first() {
            if !chapter["id"].as_i64().is_some_and(|id| id > 0 && id <= i32::MAX as i64)
                || chapter["mangaId"].as_i64() != Some(id) || chapter["url"] != format!("{folder}/{CHAPTER}") { return Err(INVALID); }
        }
        Ok(Some(manga.clone()))
    }

    fn register_local_import(&self, record: &ImportRecord, folder: &str, duplicate: bool) -> Result<(i32, &'static str), &'static str> {
        let mut current = self.local_import_record(folder)?;
        if current.is_none() {
            let result = self.client.slow().mutation(
                "mutation TsugiDiscoverLocalImport($input: FetchSourceMangaInput!) { fetchSourceManga(input: $input) { hasNextPage mangas { id sourceId url } } }",
                "fetchSourceManga", json!({"source": "0", "page": 1, "type": "SEARCH", "query": folder}))?;
            let rows = result["mangas"].as_array().ok_or(INVALID)?;
            if result["hasNextPage"] != false || rows.len() != 1 || rows[0]["sourceId"] != "0" || rows[0]["url"] != folder { return Err(INVALID); }
            current = self.local_import_record(folder)?;
            if current.as_ref().is_none_or(|current| current["id"] != rows[0]["id"]) { return Err(INVALID); }
        }
        let mut current = current.ok_or(INVALID)?;
        let id = current["id"].as_i64().and_then(|id| i32::try_from(id).ok()).ok_or(INVALID)?;
        let previous_chapters = current["chapters"].clone();
        let missing_chapters = current["chapters"]["totalCount"] == 0;
        if missing_chapters || current["initialized"] != true {
            self.client.slow().mutation(
                "mutation TsugiInitializeLocalImport($input: FetchMangaAndChaptersInput!) { fetchMangaAndChapters(input: $input) { manga { id sourceId url title initialized } } }",
                "fetchMangaAndChapters", json!({"id": id, "fetchManga": true, "fetchChapters": missing_chapters}))?;
            current = self.local_import_record(folder)?.ok_or(INVALID)?;
            if current["id"].as_i64() != Some(i64::from(id)) || current["title"] != record.title
                || (!missing_chapters && current["chapters"] != previous_chapters) { return Err(INVALID); }
        }
        if current["chapters"]["totalCount"] != 1 || current["initialized"] != true { return Err(INVALID); }
        let already = current["inLibrary"] == true;
        if !already {
            // A failed acknowledgement may follow a successful flag write.
            // Reconcile once from the exact local identity; never replay.
            let _ = self.set_library(id, true);
        }
        let after = self.local_import_record(folder)?.ok_or(INVALID)?;
        if after["id"] != current["id"] || after["inLibrary"] != true || after["chapters"] != current["chapters"] { return Err(INVALID); }
        let (user, local) = self.local_import_root()?;
        if verify_book(&user, &local.join(folder))? != *record { return Err(STALE); }
        Ok((id, if duplicate && already { "already-imported" } else { "imported" }))
    }

    pub fn apply_local_import(&self, review: LocalImportReview) -> Result<Value, &'static str> {
        if review.created.elapsed() > Duration::from_secs(600) || review.owner_pid != self.client.owner_pid
            || review.port != self.client.port || review.stage.data != self.data_path { return Err(STALE); }
        let (user, local) = self.local_import_root()?;
        let staged = review.stage.path();
        if file_hash(&user, &staged.join("input.cbz"), MAX_ARCHIVE)? != (review.record.manifest.archive_bytes, review.record.manifest.archive_sha256.clone())
            || verify_book(&user, &staged.join("book"))? != review.record { return Err(STALE); }
        let folder = format!("tsugi-cbz-{}", review.record.manifest.archive_sha256);
        // The source's search is a substring match. Refuse another local
        // folder containing our identifier before invoking its catalogue.
        for (index, entry) in fs::read_dir(&local).map_err(|_| INVALID)?.enumerate() {
            if index >= 10_000 { return Err(INVALID); }
            let name = entry.map_err(|_| INVALID)?.file_name().into_string().map_err(|_| INVALID)?;
            if name.to_ascii_lowercase().contains(&folder) && name != folder { return Err(STALE); }
        }
        let exists = child_exists(&user, &local, &folder)?;
        if exists {
            if verify_book(&user, &local.join(&folder))? != review.record { return Err(STALE); }
        } else {
            if review.duplicate { return Err(STALE); }
            fs::rename(staged.join("book"), local.join(&folder)).map_err(|_| INVALID)?;
        }
        // Published media is immutable and is never rolled back by deleting
        // it after an uncertain database acknowledgement. A fresh review of
        // the same archive can finish the exact registration safely.
        let mut result = json!({"reviewId": review.id, "title": review.record.title,
            "pageCount": review.record.manifest.page_count, "status": "published-unregistered"});
        if let Ok((id, status)) = self.register_local_import(&review.record, &folder, exists) {
            result["status"] = json!(status); result["mangaId"] = json!(id);
        }
        Ok(result)
    }
}

#[cfg(test)]
#[path = "read_local_import_tests.rs"]
mod tests;

#[cfg(test)]
mod unit_tests {
    use super::*;

    fn manifest() -> ImportManifest {
        ImportManifest { version: 1, archive_sha256: "a".repeat(64), archive_bytes: 200,
            expanded_bytes: 80, page_count: 1,
            pages: vec![ImportPage { name: "0001.png".into(), bytes: 80, sha256: "b".repeat(64), width: 16, height: 24 }] }
    }

    #[test]
    fn cbz_manifest_requires_exact_generated_names_and_all_expansion_bounds() {
        assert!(validate_manifest(&manifest()).is_ok());
        for value in [0, MAX_ARCHIVE + 1] { let mut bad = manifest(); bad.archive_bytes = value; assert!(validate_manifest(&bad).is_err()); }
        for value in [0, MAX_EXPANDED + 1, 79, 80 + 65537] { let mut bad = manifest(); bad.expanded_bytes = value; assert!(validate_manifest(&bad).is_err()); }
        for value in [0, 2, 2001] { let mut bad = manifest(); bad.page_count = value; assert!(validate_manifest(&bad).is_err()); }
        for name in ["../0001.png", "0001.PNG", "0002.png", "0001.svg", "1.png", "0001.jpeg"] {
            let mut bad = manifest(); bad.pages[0].name = name.into(); assert!(validate_manifest(&bad).is_err());
        }
        for value in [0, MAX_PAGE + 1] { let mut bad = manifest(); bad.pages[0].bytes = value; assert!(validate_manifest(&bad).is_err()); }
        let mut bad = manifest(); bad.pages[0].width = 100_001; assert!(validate_manifest(&bad).is_err());
        let mut bad = manifest(); bad.pages[0].width = 10_000; bad.pages[0].height = 10_000; assert!(validate_manifest(&bad).is_err());
        let mut bad = manifest(); bad.archive_sha256 = "A".repeat(64); assert!(validate_manifest(&bad).is_err());
        let mut bad = serde_json::to_value(manifest()).unwrap(); bad["path"] = json!("outside");
        assert!(serde_json::from_value::<ImportManifest>(bad).is_err());
        let mut allowed = manifest(); allowed.expanded_bytes += 65536; assert!(validate_manifest(&allowed).is_ok());
    }

    struct TestRoot { path: PathBuf, user: private_storage::CurrentUser }
    impl TestRoot {
        fn new() -> Self {
            let mut entropy = [0u8; 16]; getrandom::fill(&mut entropy).unwrap();
            let nonce = entropy.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
            let path = std::env::temp_dir().join(format!("tsugi-cbz-test-{nonce}"));
            let user = private_storage::CurrentUser::get().unwrap();
            assert!(user.create_root(&path).unwrap());
            Self { path, user }
        }
    }
    impl Drop for TestRoot { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.path); } }

    fn original_png() -> Vec<u8> {
        STANDARD.decode("iVBORw0KGgoAAAANSUhEUgAAABAAAAAYCAIAAAB8wupbAAAAHUlEQVR4nGOsqF3FQApgIkn1qIZRDaMaRjWQrAEA4jkBz8UryC4AAAAASUVORK5CYII=").unwrap()
    }

    fn book(root: &TestRoot) -> (PathBuf, ImportRecord) {
        let path = root.path.join("book"); fs::create_dir(&path).unwrap();
        fs::create_dir(path.join(CHAPTER)).unwrap();
        let png = original_png();
        let mut manifest = manifest();
        manifest.pages[0].bytes = png.len() as u64;
        manifest.pages[0].sha256 = format!("{:x}", Sha256::digest(&png));
        manifest.expanded_bytes = png.len() as u64;
        let record = ImportRecord { version: 1, title: "Original imported comic".into(), manifest };
        write_new(&path.join(CHAPTER).join("0001.png"), &png).unwrap();
        write_new(&path.join("cover.png"), &png).unwrap();
        write_new(&path.join("details.json"), &serde_json::to_vec(&json!({"title": record.title})).unwrap()).unwrap();
        write_new(&path.join(RECORD), &serde_json::to_vec(&record).unwrap()).unwrap();
        (path, record)
    }

    #[test]
    fn cbz_published_copy_requires_exact_private_pages_cover_and_metadata() {
        let root = TestRoot::new(); let (path, record) = book(&root);
        assert_eq!(verify_book(&root.user, &path).unwrap(), record);
        let local = ensure_directory(&root.user, &root.path, "local").unwrap();
        let published = local.join(format!("tsugi-cbz-{}", record.manifest.archive_sha256));
        fs::rename(&path, &published).unwrap();
        assert_eq!(verify_book(&root.user, &published).unwrap(), record, "renamed private descendants retain the required ACL");
        let page = published.join(CHAPTER).join("0001.png");
        let original = fs::read(&page).unwrap(); let mut changed = original.clone(); changed[20] ^= 1;
        fs::write(&page, changed).unwrap(); assert!(verify_book(&root.user, &published).is_err());
        fs::write(&page, original).unwrap();
        fs::write(published.join("unexpected.json"), b"{}").unwrap();
        assert!(verify_book(&root.user, &published).is_err());
        fs::remove_file(published.join("unexpected.json")).unwrap();
        fs::write(published.join("details.json"), b"{\"title\":\"Changed title\"}").unwrap();
        assert!(verify_book(&root.user, &published).is_err());
    }

    #[test]
    fn cbz_stage_cleanup_requires_owned_marker_and_private_complete_tree() {
        let root = TestRoot::new(); let parent = ensure_directory(&root.user, &root.path, STAGES).unwrap();
        let id = "a".repeat(32); let path = parent.join(&id); fs::create_dir(&path).unwrap();
        write_new(&path.join("input.cbz"), b"original copied bytes").unwrap();
        assert!(remove_owned_stage(&root.path, &id).is_err());
        assert!(path.join("input.cbz").exists());
        write_new(&path.join(".owner"), id.as_bytes()).unwrap();
        private_storage::create_public_fixture(&path.join("unsafe"), &root.user);
        assert!(remove_owned_stage(&root.path, &id).is_err());
        assert!(path.join("input.cbz").exists(), "whole-tree verification precedes deletion");
        fs::remove_dir(path.join("unsafe")).unwrap();
        let published = ensure_directory(&root.user, &root.path, "local").unwrap();
        write_new(&published.join("retained"), b"published media").unwrap();
        remove_owned_stage(&root.path, &id).unwrap();
        assert!(!path.exists()); assert_eq!(fs::read(published.join("retained")).unwrap(), b"published media");
        assert!(remove_owned_stage(&root.path, "../local").is_err());
        let abandoned_id = "c".repeat(32); let abandoned = parent.join(&abandoned_id);
        fs::create_dir(&abandoned).unwrap();
        write_new(&abandoned.join(".owner"), abandoned_id.as_bytes()).unwrap();
        write_new(&abandoned.join("input.cbz"), b"interrupted import").unwrap();
        let unmarked = parent.join("d".repeat(32)); fs::create_dir(&unmarked).unwrap();
        write_new(&unmarked.join("retained"), b"not an owned import").unwrap();
        remove_abandoned_stages(&root.path);
        assert!(!abandoned.exists());
        assert_eq!(fs::read(unmarked.join("retained")).unwrap(), b"not an owned import");
        assert_eq!(fs::read(published.join("retained")).unwrap(), b"published media");
    }

    #[test]
    fn cbz_helper_prefers_current_bundle_over_prepared_runtime_class() {
        let root = TestRoot::new(); let runtime = root.path.join("read-tools");
        fs::create_dir(&runtime).unwrap(); fs::create_dir(runtime.join("launcher")).unwrap();
        write_new(&runtime.join("launcher/TsugiReadLauncher.class"), b"old prepared helper").unwrap();
        assert_eq!(import_classpath(&runtime).unwrap(), runtime.join("launcher"));
        fs::create_dir(root.path.join("read-launcher")).unwrap();
        write_new(&root.path.join("read-launcher/TsugiReadLauncher.class"), b"current bundled helper").unwrap();
        assert_eq!(import_classpath(&runtime).unwrap(), root.path.join("read-launcher"));
        fs::remove_file(root.path.join("read-launcher/TsugiReadLauncher.class")).unwrap();
        fs::create_dir(root.path.join("read-launcher/TsugiReadLauncher.class")).unwrap();
        assert!(import_classpath(&runtime).is_err(), "an invalid current helper must not silently fall back");
    }

    #[test]
    fn cbz_source_copy_preserves_original_and_cancellation_cleans_only_stage() {
        let root = TestRoot::new(); let selected = root.path.join("Friendly Comic.CBZ");
        write_new(&selected, b"authored archive snapshot").unwrap();
        let data = ensure_directory(&root.user, &root.path, "data").unwrap();
        let stages = ensure_directory(&root.user, &data, STAGES).unwrap();
        let id = "b".repeat(32); let path = stages.join(&id); fs::create_dir(&path).unwrap();
        write_new(&path.join(".owner"), id.as_bytes()).unwrap();
        let original = fs::read(&selected).unwrap();
        let result = copy_selected(&selected, &path, &data, &root.path.join("runtime"), &AtomicBool::new(false)).unwrap();
        assert_eq!(result, (original.len() as u64, format!("{:x}", Sha256::digest(&original))));
        assert_eq!(selected_title(&selected).unwrap(), "Friendly Comic");
        assert_eq!(fs::read(path.join("input.cbz")).unwrap(), original);
        // The staging root normally lives inside the protected ReadStorage
        // root; create the standalone fixture with that same root policy.
        let protected = TestRoot::new();
        let parent = ensure_directory(&protected.user, &protected.path, STAGES).unwrap();
        let owned = parent.join(&id); fs::create_dir(&owned).unwrap();
        write_new(&owned.join(".owner"), id.as_bytes()).unwrap();
        write_new(&owned.join("input.cbz"), &original).unwrap();
        drop(OwnedStage { data: protected.path.clone(), id });
        assert!(!owned.exists()); assert_eq!(fs::read(selected).unwrap(), original);
    }
}
