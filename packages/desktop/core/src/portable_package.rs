//! Read-only validation of a complete TSUGI Windows portable release archive.
//!
//! The expected digest and source commit must come from the trusted release
//! selection. Matching that digest detects corruption, not independent signing.
//! This module never extracts files, starts executables, or touches app data.
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom},
    os::windows::fs::{MetadataExt, OpenOptionsExt},
    path::{Component, Path, PathBuf, Prefix},
    sync::atomic::{AtomicBool, Ordering},
};
use zip::{CompressionMethod, ZipArchive};

pub const MAX_PACKAGE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_UNPACKED: u64 = 4 * 1024 * 1024 * 1024;
const MAX_ENTRY: u64 = 1024 * 1024 * 1024;
const MAX_CENTRAL: u64 = 4 * 1024 * 1024;
const MAX_ENTRIES: usize = 4096;
const MAX_BUILD_INFO: u64 = 8192;
const MAX_PE_HEADER: usize = 1024 * 1024;
const REPARSE_POINT: u32 = 0x400;
// The one pre-manifest release accepted for read-only review. The exact
// published identity is pinned; this does not authorize a downgrade/apply.
const LEGACY_COMMIT: &str = "e8e7140fe20ae265ffae4e559a45f939dd5b243b";
const LEGACY_SHA256: &str = "e26fb604d39a1b6a13c6e976f2f820bc6338ee044a21d5c8451d1ed68fa2cd65";
const LEGACY_BYTES: u64 = 173235714;
const REQUIRED: &[&str] = &[
    ".portable", "BUILD-INFO.json", "LICENSE", "README-TEST.txt",
    "current/Tsugi.exe", "current/libmpv-2.dll", "current/vulkan/vulkan-1.dll",
    "current/THIRD-PARTY.md", "current/web/index.html",
    "current/music-tools/yt-dlp.exe", "current/music-tools/deno.exe",
    "current/music-tools/SOURCE.txt", "current/music-tools/GPL-3.0.txt",
    "current/music-tools/yt-dlp-LICENSE.txt", "current/music-tools/yt-dlp-THIRD_PARTY_LICENSES.txt",
    "current/music-tools/deno-LICENSE.md",
    "current/read-launcher/TsugiReadLauncher.class", "current/read-launcher/fetch-read-tools.ps1",
    "current/vault-tools/aria2-next.exe", "current/vault-tools/SOURCE.txt",
    "current/vault-tools/source/COPYING", "current/vault-tools/source/AUTHORS",
    "current/vault-tools/source/SOURCE.sha256",
    "current/vault-tools/source/aria2-next-3.1.2-source.tar.gz",
    "current/media-tools/ffmpeg.exe", "current/media-tools/ffprobe.exe",
    "current/media-tools/SHA256SUMS", "current/media-tools/SOURCE.txt",
    "current/media-tools/source/ffmpeg-8.1.2-source.tar.gz",
    "current/media-tools/source/build-media-tools.sh",
    "current/media-tools/source/COPYING.LGPLv2.1",
    "current/media-tools/source/LICENSE.md", "current/media-tools/source/config.mak",
];
const DESIGN: &[&str] = &[
    "current/web/design/yomi/hero-torii.webp", "current/web/design/oto/hero-yuna.webp",
    "current/web/design/kura/hero-kura.webp", "current/web/design/shared/hero-neon.webp",
    "current/web/design/shared/hero-train.webp",
];
const PE_FILES: &[&str] = &[
    "current/Tsugi.exe", "current/libmpv-2.dll", "current/vulkan/vulkan-1.dll",
    "current/music-tools/yt-dlp.exe", "current/music-tools/deno.exe",
    "current/vault-tools/aria2-next.exe", "current/media-tools/ffmpeg.exe",
    "current/media-tools/ffprobe.exe",
];
const FONTS: &[&str] = &["amanojaku", "interface-regular", "interface-medium", "interface-semibold", "noto-jp"];

type Result<T> = std::result::Result<T, &'static str>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackageReport {
    pub source_commit: String,
    pub sha256: String,
    pub package_bytes: u64,
    pub unpacked_bytes: u64,
    pub entries: usize,
}

fn hex(value: &str, count: usize) -> bool {
    value.len() == count && value.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn canceled(cancel: &AtomicBool) -> Result<()> {
    if cancel.load(Ordering::Relaxed) { Err("Package verification cancelled.") } else { Ok(()) }
}
fn read_exact_at<R: Read + Seek>(source: &mut R, offset: u64, bytes: &mut [u8]) -> Result<()> {
    source.seek(SeekFrom::Start(offset)).and_then(|_| source.read_exact(bytes))
        .map_err(|_| "Truncated package structure.")
}
fn u16_at(bytes: &[u8], i: usize) -> u16 {
    u16::from_le_bytes([bytes[i], bytes[i + 1]])
}
fn u32_at(bytes: &[u8], i: usize) -> u32 {
    u32::from_le_bytes([bytes[i], bytes[i+1], bytes[i+2], bytes[i+3]])
}

fn open_package(path: &Path) -> Result<File> {
    let path = std::path::absolute(path).map_err(|_| "Invalid package path.")?;
    let mut current = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => {
                if !matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_)) {
                    return Err("Package must be a local regular file.");
                }
                current.push(component.as_os_str());
                continue;
            }
            Component::RootDir => current.push(component.as_os_str()),
            Component::Normal(part) if !part.to_string_lossy().contains(':') => current.push(part),
            _ => return Err("Invalid package path."),
        }
        let meta = fs::symlink_metadata(&current).map_err(|_| "Package path unavailable.")?;
        if meta.file_attributes() & REPARSE_POINT != 0 || meta.file_type().is_symlink() ||
            (current != path && !meta.is_dir()) {
            return Err("Package path is redirected or not a regular directory.");
        }
    }
    // Deny concurrent write/delete sharing, and open the final entry itself.
    let file = OpenOptions::new().read(true).share_mode(1).custom_flags(0x0020_0000)
        .open(&path).map_err(|_| "Could not exclusively verify package for reading.")?;
    let meta = file.metadata().map_err(|_| "Could not inspect package.")?;
    if !meta.is_file() || meta.file_attributes() & REPARSE_POINT != 0 {
        return Err("Package is not a regular file.");
    }
    Ok(file)
}

fn hash<R: Read + Seek>(source: &mut R, length: u64, cancel: &AtomicBool) -> Result<String> {
    source.seek(SeekFrom::Start(0)).map_err(|_| "Could not rewind package.")?;
    let mut reader = source.take(length + 1);
    let mut hash = Sha256::new();
    let mut count = 0u64;
    let mut buffer = [0; 64 * 1024];
    loop {
        canceled(cancel)?;
        let n = reader.read(&mut buffer).map_err(|_| "Could not hash package.")?;
        if n == 0 { break; }
        count += n as u64;
        if count > length { return Err("Package length changed."); }
        hash.update(&buffer[..n]);
    }
    if count != length { return Err("Package length changed."); }
    Ok(format!("{:x}", hash.finalize()))
}

#[derive(Debug)]
struct Entry {
    name: String,
    directory: bool,
    flags: u16,
    method: u16,
    crc: u32,
    compressed: u64,
    size: u64,
    offset: u64,
    data: u64,
}

fn safe_component(part: &str) -> bool {
    if part.is_empty() || part.len() > 128 || part == "." || part == ".." ||
        part.ends_with('.') || part.ends_with(' ') || part.starts_with(' ') ||
        !part.bytes().all(|b| b.is_ascii_graphic() || b == b' ') ||
        part.bytes().any(|b| b"<>:\"\\|?*~".contains(&b)) { return false; }
    let base = part.split('.').next().unwrap_or("").trim_end().to_ascii_uppercase();
    if matches!(base.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$") {
        return false;
    }
    !((base.starts_with("COM") || base.starts_with("LPT")) && base.len() == 4 &&
        matches!(base.as_bytes()[3], b'1'..=b'9'))
}
fn safe_name(name: &str, directory: bool) -> Result<&str> {
    let path = if directory { name.strip_suffix('/').ok_or("Invalid directory entry.")? } else { name };
    if path.len() > 240 || path.split('/').count() > 24 ||
        !path.split('/').all(safe_component) { return Err("Unsafe package entry path."); }
    if path == "current" {
        if !directory { return Err("Invalid application directory."); }
    } else if let Some(sub) = path.strip_prefix("current/") {
        let first = sub.split('/').next().unwrap_or("");
        if matches!(first.to_ascii_lowercase().as_str(), "data" | "read-tools" | "webview2") ||
            sub.eq_ignore_ascii_case("aiostreams-desktop.exe") {
            return Err("Package contains a mutable or legacy application path.");
        }
    } else if directory || !matches!(path, ".portable" | "BUILD-INFO.json" | "LICENSE" | "README-TEST.txt") {
        return Err("Unexpected package root path.");
    }
    Ok(path)
}
fn add_path(paths: &mut BTreeMap<String, (String, bool)>, explicit: &mut BTreeSet<String>,
            path: &str, directory: bool) -> Result<()> {
    if !explicit.insert(path.to_ascii_lowercase()) { return Err("Duplicate package entry."); }
    let mut prefix = String::new();
    let parts: Vec<_> = path.split('/').collect();
    for (index, part) in parts.iter().enumerate() {
        if !prefix.is_empty() { prefix.push('/'); }
        prefix.push_str(part);
        let dir = index + 1 < parts.len() || directory;
        let key = prefix.to_ascii_lowercase();
        if let Some((original, previous_dir)) = paths.get(&key) {
            if original != &prefix || *previous_dir != dir {
                return Err("Conflicting package path or Windows case alias.");
            }
        } else {
            paths.insert(key, (prefix.clone(), dir));
        }
    }
    Ok(())
}
fn check_extra(mut bytes: &[u8]) -> Result<()> {
    while !bytes.is_empty() {
        if bytes.len() < 4 { return Err("Malformed ZIP extra data."); }
        let id = u16_at(bytes, 0);
        let size = u16_at(bytes, 2) as usize;
        if id == 1 || id == 0x7075 || id == 0x9901 {
            return Err("ZIP64, alternate path names and encrypted ZIP entries are not supported.");
        }
        bytes = bytes.get(4 + size..).ok_or("Malformed ZIP extra data.")?;
    }
    Ok(())
}

fn local_header<R: Read + Seek>(source: &mut R, entry: &mut Entry, central: u64) -> Result<(u64, u64)> {
    let mut header = [0; 30];
    if entry.offset.checked_add(30).is_none_or(|end| end > central) {
        return Err("Invalid ZIP local header offset.");
    }
    read_exact_at(source, entry.offset, &mut header)?;
    if &header[..4] != b"PK\x03\x04" || u16_at(&header, 6) != entry.flags ||
        u16_at(&header, 8) != entry.method {
        return Err("ZIP local and central headers disagree.");
    }
    let name_len = u16_at(&header, 26) as usize;
    let extra_len = u16_at(&header, 28) as usize;
    if name_len != entry.name.len() || extra_len > 4096 {
        return Err("Invalid ZIP local name or extra length.");
    }
    let start = entry.offset + 30 + name_len as u64 + extra_len as u64;
    let end = start.checked_add(entry.compressed).ok_or("Invalid ZIP data range.")?;
    if end > central { return Err("ZIP data overlaps central directory."); }
    let mut local = vec![0; name_len + extra_len];
    read_exact_at(source, entry.offset + 30, &mut local)?;
    if &local[..name_len] != entry.name.as_bytes() {
        return Err("ZIP local and central entry names disagree.");
    }
    check_extra(&local[name_len..])?;
    let mut finish = end;
    if entry.flags & 8 == 0 {
        if u32_at(&header, 14) != entry.crc || u32_at(&header, 18) as u64 != entry.compressed ||
            u32_at(&header, 22) as u64 != entry.size {
            return Err("ZIP local and central entry sizes disagree.");
        }
    } else {
        // Non-seekable ZIP writers can use a bounded, ordinary data descriptor.
        let mut descriptor = [0; 16];
        if end.checked_add(12).is_none_or(|n| n > central) { return Err("Truncated ZIP descriptor."); }
        read_exact_at(source, end, &mut descriptor[..12])?;
        let signed = &descriptor[..4] == b"PK\x07\x08";
        let at = if signed {
            if end + 16 > central { return Err("Truncated ZIP descriptor."); }
            read_exact_at(source, end + 12, &mut descriptor[12..])?;
            4
        } else { 0 };
        if u32_at(&descriptor, at) != entry.crc || u32_at(&descriptor, at+4) as u64 != entry.compressed ||
            u32_at(&descriptor, at+8) as u64 != entry.size {
            return Err("ZIP descriptor and central entry disagree.");
        }
        finish += (at + 12) as u64;
    }
    entry.data = start;
    Ok((entry.offset, finish))
}

fn directory<R: Read + Seek>(source: &mut R, length: u64, cancel: &AtomicBool) -> Result<(Vec<Entry>, u64)> {
    if length < 22 { return Err("Truncated ZIP package."); }
    // The official pipeline emits a single-disk ordinary ZIP without a comment.
    // Bound the directory *before* letting the ZIP crate allocate its index.
    let mut eocd = [0; 22];
    read_exact_at(source, length - 22, &mut eocd)?;
    if &eocd[..4] != b"PK\x05\x06" || u16_at(&eocd, 4) != 0 || u16_at(&eocd, 6) != 0 ||
        u16_at(&eocd, 8) != u16_at(&eocd, 10) || u16_at(&eocd, 20) != 0 {
        return Err("Unsupported ZIP end record.");
    }
    let count = u16_at(&eocd, 10) as usize;
    let size = u32_at(&eocd, 12) as u64;
    let offset = u32_at(&eocd, 16) as u64;
    if count == 0 || count > MAX_ENTRIES || size > MAX_CENTRAL ||
        size < (count * 46) as u64 || offset.checked_add(size) != Some(length - 22) {
        return Err("ZIP central directory exceeds limits or has invalid bounds.");
    }
    let mut bytes = vec![0; size as usize];
    read_exact_at(source, offset, &mut bytes)?;
    let mut rows = Vec::with_capacity(count);
    let mut total = 0u64;
    let mut at = 0usize;
    let mut paths = BTreeMap::new();
    let mut explicit = BTreeSet::new();
    for _ in 0..count {
        canceled(cancel)?;
        let h = bytes.get(at..at + 46).ok_or("Truncated ZIP central header.")?;
        if &h[..4] != b"PK\x01\x02" { return Err("Invalid ZIP central header."); }
        let flags = u16_at(h, 8);
        let method = u16_at(h, 10);
        let crc = u32_at(h, 16);
        let compressed = u32_at(h, 20) as u64;
        let size = u32_at(h, 24) as u64;
        let name_len = u16_at(h, 28) as usize;
        let extra_len = u16_at(h, 30) as usize;
        let comment_len = u16_at(h, 32) as usize;
        let attr = u32_at(h, 38);
        let local = u32_at(h, 42) as u64;
        // Permit only ordinary stored/deflated, UTF-8 and optional descriptor flags.
        if flags & !0x080e != 0 || !matches!(method, 0 | 8) ||
            u16_at(h, 34) != 0 || name_len == 0 || name_len > 241 ||
            extra_len > 4096 || comment_len > 1024 || size > MAX_ENTRY ||
            compressed > offset || local >= offset ||
            (method == 0 && compressed != size) || (size > 0 && compressed == 0) {
            return Err("Unsupported or oversized ZIP entry.");
        }
        let start = at + 46;
        let end = start + name_len + extra_len + comment_len;
        let fields = bytes.get(start..end).ok_or("Truncated ZIP central entry.")?;
        let name = std::str::from_utf8(&fields[..name_len]).map_err(|_| "Invalid package name encoding.")?;
        let is_dir = name.ends_with('/');
        let unix_type = (attr >> 16) & 0o170000;
        if attr & REPARSE_POINT != 0 || !matches!(unix_type, 0 | 0o040000 | 0o100000) ||
            (unix_type == 0o040000 && !is_dir) || (unix_type == 0o100000 && is_dir) ||
            (attr & 0x10 != 0 && !is_dir) || (is_dir && (size != 0 || compressed != 0 || crc != 0 || method != 0)) {
            return Err("ZIP links, special files and inconsistent directories are not allowed.");
        }
        let path = safe_name(name, is_dir)?;
        add_path(&mut paths, &mut explicit, path, is_dir)?;
        check_extra(&fields[name_len..name_len+extra_len])?;
        total = total.checked_add(size).filter(|n| *n <= MAX_UNPACKED).ok_or("Package unpacked size exceeds limit.")?;
        rows.push(Entry {name:name.to_owned(), directory:is_dir, flags, method, crc, compressed, size, offset:local, data:0});
        at = end;
    }
    if at != bytes.len() { return Err("Unexpected ZIP central directory data."); }
    let mut ranges = Vec::with_capacity(count);
    for entry in &mut rows {
        canceled(cancel)?;
        ranges.push(local_header(source, entry, offset)?);
    }
    ranges.sort_unstable();
    let mut next = 0;
    for (start, end) in ranges {
        if start != next || end <= start { return Err("Overlapping or unclaimed ZIP archive data."); }
        next = end;
    }
    if next != offset { return Err("Unexpected ZIP data before central directory."); }
    Ok((rows, total))
}

fn inventory(entries: &[Entry], legacy: bool) -> Result<()> {
    let files: BTreeMap<_, _> = entries.iter().filter(|e| !e.directory).map(|e| (e.name.as_str(), e.size)).collect();
    for required in REQUIRED.iter().chain(if legacy { &[][..] } else { DESIGN }.iter()) {
        let size = files.get(required).ok_or("Required portable package entry missing.")?;
        if (required == &".portable" && *size != 0) || (required != &".portable" && *size == 0) {
            return Err("Required package entry has invalid size.");
        }
    }
    if files.get("BUILD-INFO.json").copied().unwrap_or(0) > MAX_BUILD_INFO {
        return Err("Package build identity exceeds limit.");
    }
    for font in if legacy { &[][..] } else { FONTS } {
        let found = files.keys().any(|path| {
            let lower = path.to_ascii_lowercase();
            lower.starts_with("current/web/") &&
                (lower.ends_with(".otf") || lower.ends_with(".woff2")) &&
                (lower.contains(&format!("{font}-")) || lower.contains(&format!("{font}.")))
        });
        if !found { return Err("Required portable font missing."); }
    }
    Ok(())
}

fn pe64(bytes: &[u8]) -> bool {
    if bytes.len() < 64 || &bytes[..2] != b"MZ" { return false; }
    let at = u32_at(bytes, 60) as usize;
    let Some(header) = bytes.get(at..at.saturating_add(26)) else { return false; };
    at >= 64 && &header[..4] == b"PE\0\0" && u16_at(header, 4) == 0x8664 &&
        u16_at(header, 20) >= 2 && u16_at(header, 24) == 0x20b
}
fn build_identity(bytes: &[u8], expected: &str, legacy: bool) -> Result<()> {
    if bytes.len() as u64 > MAX_BUILD_INFO { return Err("Package build identity exceeds limit."); }
    let value: serde_json::Value = serde_json::from_slice(bytes.strip_prefix(&[0xef,0xbb,0xbf]).unwrap_or(bytes))
        .map_err(|_| "Invalid package build identity.")?;
    let numeric = |key: &str| value[key].as_str().is_some_and(|s|
        !s.is_empty() && s.len() <= 20 && s.bytes().all(|b| b.is_ascii_digit()) && !s.starts_with('0'));
    if value["repository"] != "G1NYU/TSUGI" || value["commit"] != expected ||
        !numeric("run_id") || !numeric("run_attempt") ||
        !matches!(value["ref"].as_str(), Some("refs/heads/feature/tsugi-read-runtime" | "refs/heads/main")) {
        return Err("Portable package build identity disagrees with release.");
    }
    if !legacy && (value["package_format"] != 1 || value["architecture"] != "windows-x64") {
        return Err("Unknown portable package manifest or architecture.");
    }
    Ok(())
}

fn verify<R: Read + Seek>(mut source: R, expected_bytes: u64, expected_sha256: &str,
                          expected_commit: &str, cancel: &AtomicBool) -> Result<PackageReport> {
    if expected_bytes == 0 || expected_bytes > MAX_PACKAGE_BYTES ||
        !hex(expected_sha256,64) || !hex(expected_commit,40) {
        return Err("Invalid expected package identity.");
    }
    canceled(cancel)?;
    let length = source.seek(SeekFrom::End(0)).map_err(|_| "Could not measure package.")?;
    if length != expected_bytes { return Err("Package byte count disagrees with release."); }
    let digest = hash(&mut source, length, cancel)?;
    if digest != expected_sha256 { return Err("Package SHA-256 disagrees with release."); }
    let legacy = expected_commit == LEGACY_COMMIT && digest == LEGACY_SHA256 && length == LEGACY_BYTES;
    let (entries, unpacked) = directory(&mut source, length, cancel)?;
    inventory(&entries, legacy)?;
    // Use the pinned ZIP crate for actual decompression, while requiring it to
    // agree with the bounded, non-ambiguous header/index review above.
    let mut archive = ZipArchive::new(source).map_err(|_| "Invalid portable ZIP package.")?;
    if archive.len() != entries.len() { return Err("ZIP parser and reviewed directory disagree."); }
    let mut buffer = [0; 64*1024];
    for (index, entry) in entries.iter().enumerate() {
        canceled(cancel)?;
        let mut file = archive.by_index(index).map_err(|_| "Unreadable ZIP entry.")?;
        let method = if entry.method == 0 { CompressionMethod::Stored } else { CompressionMethod::Deflated };
        if file.name() != entry.name || file.size() != entry.size || file.compressed_size() != entry.compressed ||
            file.crc32() != entry.crc || file.compression() != method || file.is_dir() != entry.directory ||
            file.data_start() != entry.data {
            return Err("ZIP parser and reviewed entry disagree.");
        }
        let capture = if entry.name == "BUILD-INFO.json" { MAX_BUILD_INFO as usize }
            else if PE_FILES.contains(&entry.name.as_str()) { MAX_PE_HEADER } else { 0 };
        let mut prefix = Vec::with_capacity(capture.min(entry.size as usize));
        let mut count = 0u64;
        let mut crc = crc32fast::Hasher::new();
        let mut limited = (&mut file).take(entry.size + 1);
        loop {
            canceled(cancel)?;
            let n = limited.read(&mut buffer).map_err(|_| "Portable ZIP decompression or CRC check failed.")?;
            if n == 0 { break; }
            count += n as u64;
            if count > entry.size { return Err("ZIP entry exceeded its declared size."); }
            crc.update(&buffer[..n]);
            let keep = n.min(capture.saturating_sub(prefix.len()));
            prefix.extend_from_slice(&buffer[..keep]);
        }
        if count != entry.size || crc.finalize() != entry.crc { return Err("ZIP entry size or CRC disagrees."); }
        if entry.name == "BUILD-INFO.json" { build_identity(&prefix, expected_commit, legacy)?; }
        else if capture != 0 && !pe64(&prefix) { return Err("Portable executable or DLL is not Windows x64."); }
    }
    Ok(PackageReport {source_commit:expected_commit.to_owned(), sha256:digest,
        package_bytes:length, unpacked_bytes:unpacked, entries:entries.len()})
}

/// Read-only verification against the exact trusted package size, digest and
/// source SHA. A single denied-write/delete handle is retained throughout.
pub fn verify_package(path: &Path, expected_bytes: u64, expected_sha256: &str,
                      expected_commit: &str, cancel: &AtomicBool) -> Result<PackageReport> {
    verify(open_package(path)?, expected_bytes, expected_sha256, expected_commit, cancel)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use zip::{ZipWriter, write::SimpleFileOptions};
    const COMMIT: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn pe() -> Vec<u8> {
        let mut data = vec![0; 100];
        data[..2].copy_from_slice(b"MZ");
        data[60..64].copy_from_slice(&64u32.to_le_bytes());
        data[64..68].copy_from_slice(b"PE\0\0");
        data[68..70].copy_from_slice(&0x8664u16.to_le_bytes());
        data[84..86].copy_from_slice(&2u16.to_le_bytes());
        data[88..90].copy_from_slice(&0x20bu16.to_le_bytes());
        data
    }
    fn fixture(extra: Option<(&str, &[u8])>, omit: Option<&str>, identity: &str, bad_pe: bool) -> Vec<u8> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        let info = serde_json::json!({"repository":"G1NYU/TSUGI", "commit":identity, "run_id":"123",
            "run_attempt":"1", "ref":"refs/heads/feature/tsugi-read-runtime",
            "package_format":1,"architecture":"windows-x64"}).to_string();
        for name in REQUIRED.iter().chain(DESIGN) {
            if Some(*name) == omit { continue; }
            let selected = if *name == "current/web/index.html" {
                options.compression_method(CompressionMethod::Deflated)
            } else { options };
            writer.start_file(*name, selected).unwrap();
            let data = if *name == ".portable" { Vec::new() }
                else if *name == "BUILD-INFO.json" { info.as_bytes().to_vec() }
                else if PE_FILES.contains(name) && !bad_pe { pe() } else { b"fixture".to_vec() };
            writer.write_all(&data).unwrap();
        }
        for font in FONTS {
            writer.start_file(format!("current/web/assets/{font}-fixture.woff2"), options).unwrap();
            writer.write_all(b"font").unwrap();
        }
        if let Some((name,data)) = extra { writer.start_file(name,options).unwrap(); writer.write_all(data).unwrap(); }
        writer.finish().unwrap().into_inner()
    }
    fn inspect(bytes: Vec<u8>) -> Result<PackageReport> {
        let digest = format!("{:x}", Sha256::digest(&bytes));
        let length = bytes.len() as u64;
        verify(Cursor::new(bytes),length,&digest,COMMIT,&AtomicBool::new(false))
    }

    #[test]
    fn accepts_complete_matching_read_only_package() {
        let bytes = fixture(None,None,COMMIT,false);
        let report = inspect(bytes.clone()).unwrap();
        assert_eq!(report.source_commit,COMMIT);
        assert_eq!(report.package_bytes,bytes.len() as u64);
        assert_eq!(report.entries,REQUIRED.len()+DESIGN.len()+FONTS.len());
        assert!(report.unpacked_bytes > 0);
    }
    #[test]
    fn refuses_bad_checksum_size_commit_inventory_and_architecture() {
        let bytes = fixture(None,None,COMMIT,false);
        let length = bytes.len() as u64;
        let digest = format!("{:x}", Sha256::digest(&bytes));
        assert!(verify(Cursor::new(bytes.clone()),length,&"0".repeat(64),COMMIT,&AtomicBool::new(false)).is_err());
        assert!(verify(Cursor::new(bytes),length+1,&digest,COMMIT,&AtomicBool::new(false)).is_err());
        assert!(inspect(fixture(None,None,&"b".repeat(40),false)).is_err());
        assert!(inspect(fixture(None,Some("current/libmpv-2.dll"),COMMIT,false)).is_err());
        assert!(inspect(fixture(None,None,COMMIT,true)).is_err());
    }
    #[test]
    fn rejects_traversal_windows_aliases_mutable_paths_and_file_parent_collisions() {
        for name in ["../data/x","/current/x","current/../data/x","current/a:b","current/NUL.txt",
            "current/COM1.log","current/a. ","current/data/settings","current/read-tools/jre.exe",
            "current/web/INDEX.HTML","current/WEB/extra","current/Tsugi.exe/child",
            "current/aiostreams-desktop.exe","data/config.json"] {
            assert!(inspect(fixture(Some((name,b"x")),None,COMMIT,false)).is_err(),"{name}");
        }
    }
    #[test]
    fn rejects_modified_payload_even_with_matching_outer_digest_and_cancellation() {
        let mut bytes = fixture(None,None,COMMIT,false);
        let at = bytes.windows(b"fixture".len()).position(|s|s==b"fixture").unwrap();
        bytes[at] ^= 1;
        assert!(inspect(bytes).is_err());
        let bytes = fixture(None,None,COMMIT,false);
        let digest = format!("{:x}", Sha256::digest(&bytes));
        let length = bytes.len() as u64;
        assert_eq!(verify(Cursor::new(bytes),length,&digest,COMMIT,&AtomicBool::new(true)).unwrap_err(),
            "Package verification cancelled.");
    }
    #[test]
    fn rejects_symlink_metadata_local_name_mismatch_and_unknown_manifest() {
        let mut bytes = fixture(None,None,COMMIT,false);
        let end = bytes.len()-22;
        let central = u32_at(&bytes[end..],16) as usize;
        bytes[central+38..central+42].copy_from_slice(&(0o120777u32<<16).to_le_bytes());
        assert_eq!(inspect(bytes).unwrap_err(),"ZIP links, special files and inconsistent directories are not allowed.");
        let mut bytes = fixture(None,None,COMMIT,false);
        bytes[30] = b'x';
        assert_eq!(inspect(bytes).unwrap_err(),"ZIP local and central entry names disagree.");
        let info = serde_json::json!({"repository":"G1NYU/TSUGI","commit":COMMIT,
            "run_id":"123","run_attempt":"1","ref":"refs/heads/main","package_format":2,
            "architecture":"windows-x64"}).to_string();
        assert!(build_identity(info.as_bytes(),COMMIT,false).is_err());
        assert!(safe_name("current/web/SHORT~1.JS",false).is_err());
    }
    #[test]
    fn rejects_unclaimed_data_and_huge_central_directory() {
        let mut bytes = fixture(None,None,COMMIT,false);
        bytes.push(0);
        assert!(inspect(bytes).is_err());
        let mut bytes = fixture(None,None,COMMIT,false);
        let end = bytes.len()-22;
        bytes[end+8..end+10].copy_from_slice(&u16::MAX.to_le_bytes());
        bytes[end+10..end+12].copy_from_slice(&u16::MAX.to_le_bytes());
        assert!(inspect(bytes).is_err());
    }
}
