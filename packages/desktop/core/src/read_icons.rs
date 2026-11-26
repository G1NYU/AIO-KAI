//! Bounded, cache-only extension icons. The pinned HTTP icon endpoint fills
//! its cache without a download limit, so it must not be used for this path.
use super::*;
use std::path::PathBuf;

const MAX_ICON: u64 = 512 * 1024;
const MAX_ICON_EDGE: u32 = 1024;
const INVALID_ICON: &str = "This extension icon is unavailable.";

fn icon_size(width: u32, height: u32) -> Option<(u32, u32)> {
    (width > 0 && height > 0 && width <= MAX_ICON_EDGE && height <= MAX_ICON_EDGE)
        .then_some((width, height))
}

fn be32(bytes: &[u8]) -> Option<u32> { Some(u32::from_be_bytes(bytes.get(..4)?.try_into().ok()?)) }
fn le32(bytes: &[u8]) -> Option<u32> { Some(u32::from_le_bytes(bytes.get(..4)?.try_into().ok()?)) }
fn le16(bytes: &[u8]) -> Option<u32> { Some(u16::from_le_bytes(bytes.get(..2)?.try_into().ok()?) as u32) }

/// Inspect bounded raster containers before handing them to the WebView's
/// decoder. Animation is excluded; malformed encodings still fall back if
/// the browser cannot decode them. No SVG or content-type sniffing fallback.
fn icon_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.is_empty() || bytes.len() as u64 > MAX_ICON { return None; }
    let mime = image_mime(bytes)?;
    match mime {
        "image/png" => {
            if bytes.get(8..16)? != b"\0\0\0\rIHDR" { return None; }
            icon_size(be32(bytes.get(16..)?)?, be32(bytes.get(20..)?)?)?;
            let (mut at, mut data) = (8usize, false);
            while at < bytes.len() {
                let size = be32(bytes.get(at..)?)? as usize;
                let kind = bytes.get(at + 4..at + 8)?;
                let end = at.checked_add(size)?.checked_add(12)?;
                bytes.get(at..end)?;
                if matches!(kind, b"acTL" | b"fcTL" | b"fdAT") || (at != 8 && kind == b"IHDR") { return None; }
                if kind == b"IDAT" { data = true; }
                if kind == b"IEND" { return (size == 0 && data && end == bytes.len()).then_some(mime); }
                at = end;
            }
            None
        }
        "image/jpeg" => {
            if !bytes.ends_with(&[0xff, 0xd9]) { return None; }
            let mut at = 2usize;
            while at < bytes.len() {
                if *bytes.get(at)? != 0xff { return None; }
                while bytes.get(at) == Some(&0xff) { at += 1; }
                let marker = *bytes.get(at)?;
                at += 1;
                if marker == 0xda || marker == 0xd9 { return None; }
                if marker == 0x01 || (0xd0..=0xd7).contains(&marker) { continue; }
                let size = u16::from_be_bytes(bytes.get(at..at + 2)?.try_into().ok()?) as usize;
                if size < 2 { return None; }
                let segment = bytes.get(at..at.checked_add(size)?)?;
                if matches!(marker, 0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf) {
                    let components = usize::from(*segment.get(7)?);
                    if !(1..=4).contains(&components) || size != 8 + 3 * components { return None; }
                    let height = u16::from_be_bytes(segment.get(3..5)?.try_into().ok()?) as u32;
                    let width = u16::from_be_bytes(segment.get(5..7)?.try_into().ok()?) as u32;
                    icon_size(width, height)?;
                    return Some(mime);
                }
                at += size;
            }
            None
        }
        "image/gif" => {
            let (width, height) = icon_size(le16(bytes.get(6..)?)?, le16(bytes.get(8..)?)?)?;
            let packed = *bytes.get(10)?;
            let mut at = 13usize + if packed & 0x80 != 0 { 3usize << (usize::from(packed & 7) + 1) } else { 0 };
            let mut frames = 0;
            loop {
                match *bytes.get(at)? {
                    0x3b => return (frames == 1 && at + 1 == bytes.len()).then_some(mime),
                    0x21 => { at += 2; }
                    0x2c => {
                        frames += 1;
                        if frames != 1 { return None; }
                        let descriptor = bytes.get(at + 1..at + 10)?;
                        let (frame_width, frame_height) = icon_size(le16(&descriptor[4..])?, le16(&descriptor[6..])?)?;
                        if le16(descriptor)? + frame_width > width || le16(&descriptor[2..])? + frame_height > height { return None; }
                        let flags = descriptor[8];
                        at += 10 + if flags & 0x80 != 0 { 3usize << (usize::from(flags & 7) + 1) } else { 0 };
                        if !(2..=8).contains(bytes.get(at)?) { return None; }
                        at += 1;
                    }
                    _ => return None,
                }
                loop {
                    let size = usize::from(*bytes.get(at)?);
                    at += 1;
                    bytes.get(at..at.checked_add(size)?)?;
                    at += size;
                    if size == 0 { break; }
                }
            }
        }
        "image/webp" => {
            if le32(bytes.get(4..)?)? as usize != bytes.len().checked_sub(8)? { return None; }
            let (mut at, mut canvas, mut frame) = (12usize, None, None);
            while at < bytes.len() {
                let kind = bytes.get(at..at + 4)?;
                let size = le32(bytes.get(at + 4..)?)? as usize;
                let end = at.checked_add(8)?.checked_add(size)?;
                let data = bytes.get(at + 8..end)?;
                match kind {
                    b"ANIM" | b"ANMF" => return None,
                    b"VP8X" => {
                        if canvas.is_some() || size != 10 || data[0] & 2 != 0 { return None; }
                        let dim = |part: &[u8]| 1 + u32::from(part[0]) + (u32::from(part[1]) << 8) + (u32::from(part[2]) << 16);
                        canvas = Some(icon_size(dim(&data[4..7]), dim(&data[7..10]))?);
                    }
                    b"VP8 " | b"VP8L" => {
                        if frame.is_some() { return None; }
                        let dimensions = if kind == b"VP8L" {
                            if *data.first()? != 0x2f { return None; }
                            let bits = le32(data.get(1..)?)?;
                            icon_size((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1)?
                        } else {
                            if data.first()? & 1 != 0 || data.get(3..6)? != b"\x9d\x01\x2a" { return None; }
                            icon_size(le16(data.get(6..)?)? & 0x3fff, le16(data.get(8..)?)? & 0x3fff)?
                        };
                        frame = Some(dimensions);
                    }
                    _ => (),
                }
                at = end.checked_add(size & 1)?;
                bytes.get(..at)?;
            }
            let frame = frame?;
            (at == bytes.len() && canvas.is_none_or(|canvas| canvas == frame)).then_some(mime)
        }
        _ => None,
    }
}

fn cached_icon_path(directory: &Path, package: &str) -> Result<PathBuf, &'static str> {
    let stem = if package == "eu.kanade.tachiyomi.source.local" { "localSource" } else { package };
    let prefix = format!("{stem}.");
    let mut selected = None;
    for (index, entry) in fs::read_dir(directory).map_err(|_| INVALID_ICON)?.enumerate() {
        if index >= 10_000 { return Err(INVALID_ICON); }
        let entry = entry.map_err(|_| INVALID_ICON)?;
        let name = entry.file_name();
        let name = name.to_str().ok_or(INVALID_ICON)?;
        if !name.to_ascii_lowercase().starts_with(&prefix.to_ascii_lowercase()) { continue; }
        let suffix = name.strip_prefix(&prefix).ok_or(INVALID_ICON)?;
        if !matches!(suffix, "png" | "jpg" | "jpeg" | "gif" | "webp") || selected.is_some() { return Err(INVALID_ICON); }
        selected = Some(entry.path());
    }
    selected.ok_or(INVALID_ICON)
}

fn read_cached_icon(data: &Path, package: &str, verify: &impl Fn(&Path, bool) -> Result<(), &'static str>) -> Result<PageImage, &'static str> {
    extension_package(package).map_err(|_| INVALID_ICON)?;
    verify(data, true)?;
    let extensions = data.join("extensions");
    verify(&extensions, true)?;
    let directory = extensions.join("icon");
    verify(&directory, true)?;
    let path = cached_icon_path(&directory, package)?;
    verify(&path, false)?;
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // Keep this file stable while it is read, and open a reparse point
        // itself rather than following a changed final path component.
        options.share_mode(1).custom_flags(0x00200000);
    }
    let mut file = options.open(&path).map_err(|_| INVALID_ICON)?;
    let before = file.metadata().map_err(|_| INVALID_ICON)?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if before.file_attributes() & 0x400 != 0 { return Err(INVALID_ICON); }
    }
    if !before.is_file() || before.len() == 0 || before.len() > MAX_ICON { return Err(INVALID_ICON); }
    let mut bytes = Vec::new();
    (&mut file).take(MAX_ICON + 1).read_to_end(&mut bytes).map_err(|_| INVALID_ICON)?;
    let after = file.metadata().map_err(|_| INVALID_ICON)?;
    if bytes.len() as u64 != before.len() || after.len() != before.len()
        || after.modified().ok() != before.modified().ok() { return Err(INVALID_ICON); }
    let mime = icon_mime(&bytes).ok_or(INVALID_ICON)?;
    Ok(PageImage { bytes, mime })
}

impl ReadRuntime {
    /// Source icons are their owning extension's icon. Accept only a known
    /// package identity and read its existing private cache; never trigger
    /// the upstream icon route's unbounded remote cache fill.
    pub fn extension_icon(&self, package: &str) -> Result<PageImage, &'static str> {
        extension_package(package).map_err(|_| INVALID_ICON)?;
        let record = self.client.document(
            "query TsugiExtensionIcon($pkg: String!) { extension(pkgName: $pkg) { pkgName } }",
            "extension", json!({"pkg": package})).map_err(|_| INVALID_ICON)?;
        if record["pkgName"] != package { return Err(INVALID_ICON); }
        let user = private_storage::CurrentUser::get().map_err(|_| INVALID_ICON)?;
        read_cached_icon(&self.data_path, package, &|path, directory| {
            if path == self.data_path { user.verify(path, directory) }
            else { user.verify_descendant(path, directory) }.map_err(|_| INVALID_ICON)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png() -> Vec<u8> {
        STANDARD.decode("iVBORw0KGgoAAAANSUhEUgAAABAAAAAYCAIAAAB8wupbAAAAHUlEQVR4nGOsqF3FQApgIkn1qIZRDaMaRjWQrAEA4jkBz8UryC4AAAAASUVORK5CYII=").unwrap()
    }

    #[test]
    fn icons_require_bounded_static_rasters() {
        let original = png();
        assert_eq!(icon_mime(&original), Some("image/png"));
        for bad in [b"<svg xmlns='http://www.w3.org/2000/svg'/>".to_vec(), vec![0; MAX_ICON as usize + 1], original[..20].to_vec()] {
            assert!(icon_mime(&bad).is_none());
        }
        let mut huge = original.clone();
        huge[16..20].copy_from_slice(&1025u32.to_be_bytes());
        assert!(icon_mime(&huge).is_none());
        let mut animated = original.clone();
        animated.splice(33..33, [0, 0, 0, 0, b'a', b'c', b'T', b'L', 0, 0, 0, 0]);
        assert!(icon_mime(&animated).is_none());
        let gif = STANDARD.decode("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7").unwrap();
        assert_eq!(icon_mime(&gif), Some("image/gif"));
        let mut multiple = gif.clone();
        let frame = gif.iter().position(|byte| *byte == 0x2c).unwrap();
        multiple.splice(multiple.len() - 1..multiple.len() - 1, gif[frame..gif.len() - 1].iter().copied());
        assert!(icon_mime(&multiple).is_none());
        for (encoded, mime) in [
            ("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAYABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAT/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAT/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwC0BUnAAf/Z", "image/jpeg"),
            ("UklGRjoAAABXRUJQVlA4IC4AAADQAgCdASoQABgAPm0qkUWkIqGYBABABsSzgFp0IZEAAP7OgoMttioxhNIfFu4A", "image/webp"),
            ("UklGRh4AAABXRUJQVlA4TBEAAAAvD8AFAAdQyAIWtP+BiOh/AAA=", "image/webp"),
        ] {
            let raster = STANDARD.decode(encoded).unwrap();
            assert_eq!(icon_mime(&raster), Some(mime));
            assert!(icon_mime(&raster[..raster.len() - 1]).is_none());
        }
    }

    #[test]
    fn cached_icon_paths_refuse_ambiguous_temporary_and_mismatched_names() {
        let mut entropy = [0u8; 16]; getrandom::fill(&mut entropy).unwrap();
        let directory = std::env::temp_dir().join(format!("tsugi-icons-{}", entropy.iter().map(|byte| format!("{byte:02x}")).collect::<String>()));
        fs::create_dir(&directory).unwrap();
        let file = directory.join("org.tsugi.fixture.png");
        assert!(cached_icon_path(&directory, "org.tsugi.fixture").is_err());
        fs::write(&file, png()).unwrap();
        assert_eq!(cached_icon_path(&directory, "org.tsugi.fixture").unwrap(), file);
        for name in ["org.tsugi.fixture.jpg", "org.tsugi.fixture.tmp", "org.tsugi.fixture.svg"] {
            fs::write(directory.join(name), b"other").unwrap();
            assert!(cached_icon_path(&directory, "org.tsugi.fixture").is_err());
            fs::remove_file(directory.join(name)).unwrap();
        }
        assert!(cached_icon_path(&directory, "org.tsugi.Fixture").is_err());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    #[cfg(windows)]
    fn cached_icons_require_private_ancestors_and_enforce_the_file_limit() {
        let mut entropy = [0u8; 16]; getrandom::fill(&mut entropy).unwrap();
        let data = std::env::temp_dir().join(format!("tsugi-icons-private-{}", entropy.iter().map(|byte| format!("{byte:02x}")).collect::<String>()));
        let user = private_storage::CurrentUser::get().unwrap();
        assert!(user.create_root(&data).unwrap());
        let directory = data.join("extensions/icon");
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("org.tsugi.fixture.png");
        fs::write(&path, png()).unwrap();
        let verify = |path: &Path, directory| {
            if path == data { user.verify(path, directory) }
            else { user.verify_descendant(path, directory) }
        };
        let image = read_cached_icon(&data, "org.tsugi.fixture", &verify).unwrap();
        assert_eq!(image.mime, "image/png");
        assert_eq!(image.bytes, png());
        assert!(read_cached_icon(&data, "../org.tsugi.fixture", &verify).is_err());
        fs::write(&path, vec![0; MAX_ICON as usize + 1]).unwrap();
        assert!(read_cached_icon(&data, "org.tsugi.fixture", &verify).is_err());
        fs::remove_dir_all(&directory).unwrap();
        private_storage::create_public_fixture(&directory, &user);
        fs::write(&path, png()).unwrap();
        assert!(read_cached_icon(&data, "org.tsugi.fixture", &verify).is_err());
        assert_eq!(fs::read(&path).unwrap(), png());
        fs::remove_dir_all(data).unwrap();
    }
}
