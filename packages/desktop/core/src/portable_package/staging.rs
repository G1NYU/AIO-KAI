//! Disposable verified extraction. No live application path is accepted and
//! no executable is started. This is a package staging/readback diagnostic,
//! not the persistent replacement transaction or an independent trust check.
use super::*;
use crate::read_runtime::private_storage::CurrentUser;
use std::{io::Write, os::windows::ffi::OsStrExt};

const STAGE_MARGIN: u64 = 32 * 1024 * 1024;
const STAGE_DIRECTORY_LIMIT: usize = 8192;
const OPEN_REPARSE_POINT: u32 = 0x0020_0000;
const BACKUP_SEMANTICS: u32 = 0x0200_0000;

#[link(name = "kernel32")]
unsafe extern "system" {
    fn GetDiskFreeSpaceExW(directory: *const u16, available: *mut u64,
                          total: *mut u64, total_free: *mut u64) -> i32;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StagingReport {
    pub package: PackageReport,
    pub files: usize,
    pub directories: usize,
    pub tree_sha256: String,
}

fn pin_directory(path: &Path) -> Result<File> {
    // No delete sharing: while this handle lives the directory itself cannot
    // be renamed out from under descendant path operations.
    let file = OpenOptions::new().access_mode(0x80).share_mode(3)
        .custom_flags(OPEN_REPARSE_POINT | BACKUP_SEMANTICS)
        .open(path).map_err(|_| "Could not pin staging directory.")?;
    let meta = file.metadata().map_err(|_| "Could not inspect staging directory.")?;
    if !meta.is_dir() || meta.file_attributes() & REPARSE_POINT != 0 {
        return Err("Staging directory is redirected or not an ordinary directory.");
    }
    Ok(file)
}

fn pin_local_parent(path: &Path) -> Result<(PathBuf, Vec<File>)> {
    let path = std::path::absolute(path).map_err(|_| "Invalid staging parent.")?;
    let mut current = PathBuf::new();
    let mut pins = Vec::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) if matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_)) => {
                current.push(component.as_os_str());
                continue;
            }
            Component::RootDir => current.push(component.as_os_str()),
            Component::Normal(part) if !part.to_string_lossy().contains(':') => current.push(part),
            _ => return Err("Staging requires an ordinary local parent."),
        }
        pins.push(pin_directory(&current)?);
    }
    if pins.is_empty() || current != path { return Err("Invalid staging parent."); }
    Ok((path, pins))
}

fn require_space(available: u64, unpacked: u64) -> Result<()> {
    let needed = unpacked.checked_add(STAGE_MARGIN).ok_or("Staging size exceeds limit.")?;
    if unpacked > MAX_UNPACKED || available < needed {
        return Err("Insufficient disk space for verified package staging.");
    }
    Ok(())
}

fn check_space(parent: &Path, unpacked: u64) -> Result<()> {
    let mut wide: Vec<u16> = parent.as_os_str().encode_wide().collect();
    if wide.contains(&0) { return Err("Invalid staging parent."); }
    wide.push(0);
    let mut available = 0u64;
    // SAFETY: the path is terminated and the output points to a live u64.
    if unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut available, std::ptr::null_mut(), std::ptr::null_mut()) } == 0 {
        return Err("Could not measure free space for verified package staging.");
    }
    require_space(available, unpacked)
}

struct StagedFile {
    file: File,
    bytes: u64,
    digest: String,
}

struct Stage {
    root: PathBuf,
    user: CurrentUser,
    _parent_pins: Vec<File>,
    root_pin: Option<File>,
    directories: BTreeMap<String, Option<File>>,
    files: BTreeMap<String, StagedFile>,
    closed: bool,
}

impl Stage {
    fn new(unpacked: u64) -> Result<Self> {
        let (parent, parent_pins) = pin_local_parent(&std::env::temp_dir())?;
        check_space(&parent, unpacked)?;
        let user = CurrentUser::get().map_err(|_| "Could not identify private staging owner.")?;
        let mut nonce = [0u8; 16];
        getrandom::fill(&mut nonce).map_err(|_| "Could not allocate private staging identity.")?;
        let nonce: String = nonce.iter().map(|b| format!("{b:02x}")).collect();
        let root = parent.join(format!("tsugi-package-stage-{nonce}"));
        if !user.create_root(&root).map_err(|_| "Could not create private staging directory.")? {
            return Err("Staging directory already exists.");
        }
        // Record ownership immediately. Drop only attempts exact empty-dir
        // cleanup when verification/pinning fails during construction.
        let mut stage = Self { root, user, _parent_pins: parent_pins,
            root_pin:None, directories:BTreeMap::new(), files:BTreeMap::new(), closed:false };
        stage.user.verify(&stage.root, true)?;
        stage.root_pin = Some(pin_directory(&stage.root)?);
        Ok(stage)
    }

    fn directory(&mut self, relative: &str) -> Result<()> {
        if relative.is_empty() { return Ok(()); }
        let mut prefix = String::new();
        for part in relative.split('/') {
            if !safe_component(part) { return Err("Unsafe staging directory name."); }
            if !prefix.is_empty() { prefix.push('/'); }
            prefix.push_str(part);
            if let Some(pin) = self.directories.get(&prefix) {
                if pin.is_none() { return Err("Incomplete staging directory."); }
                continue;
            }
            if self.directories.len() >= STAGE_DIRECTORY_LIMIT { return Err("Too many staging directories."); }
            let path = self.root.join(&prefix);
            fs::create_dir(&path).map_err(|_| "Could not exclusively create staging directory.")?;
            self.directories.insert(prefix.clone(), None);
            self.user.verify_descendant(&path, true)?;
            self.directories.insert(prefix.clone(), Some(pin_directory(&path)?));
        }
        Ok(())
    }

    fn write_entry(&mut self, entry: &Entry, reader: &mut impl Read, cancel: &AtomicBool) -> Result<()> {
        canceled(cancel)?;
        let relative = safe_name(&entry.name, entry.directory)?;
        if entry.directory { return self.directory(relative); }
        if let Some((parent, _)) = relative.rsplit_once('/') { self.directory(parent)?; }
        if self.files.contains_key(relative) { return Err("Duplicate staged file."); }
        let path = self.root.join(relative);
        let file = OpenOptions::new().read(true).write(true).create_new(true)
            .share_mode(1).custom_flags(OPEN_REPARSE_POINT)
            .open(&path).map_err(|_| "Could not exclusively create staged file.")?;
        // Keep the original file handle throughout extraction/readback. Other
        // processes cannot write or delete it while staged verification runs.
        self.files.insert(relative.to_owned(), StagedFile{file, bytes:entry.size, digest:String::new()});
        self.user.verify_descendant(&path, false)?;
        let staged = self.files.get_mut(relative).expect("recorded staged file");
        let mut buffer = [0u8; 64 * 1024];
        let mut limited = reader.take(entry.size + 1);
        let mut count = 0u64;
        let mut crc = crc32fast::Hasher::new();
        let mut digest = Sha256::new();
        loop {
            canceled(cancel)?;
            let n = limited.read(&mut buffer).map_err(|_| "Could not decode staged package entry.")?;
            if n == 0 { break; }
            count += n as u64;
            if count > entry.size { return Err("Staged entry exceeded declared size."); }
            staged.file.write_all(&buffer[..n]).map_err(|_| "Could not write staged package (disk may be full).")?;
            crc.update(&buffer[..n]);
            digest.update(&buffer[..n]);
        }
        if count != entry.size || crc.finalize() != entry.crc { return Err("Staged entry size or CRC disagrees."); }
        staged.file.sync_all().map_err(|_| "Could not flush staged package file.")?;
        staged.digest = format!("{:x}", digest.finalize());
        Ok(())
    }

    fn verify_contents(&mut self, cancel: &AtomicBool) -> Result<String> {
        self.user.verify(&self.root, true)?;
        if self.root_pin.is_none() { return Err("Staging root is not pinned."); }
        let mut seen_files = BTreeSet::new();
        let mut seen_dirs = BTreeSet::new();
        // Scan only known directories, never recurse into an unreviewed path.
        for directory in std::iter::once("").chain(self.directories.keys().map(String::as_str)) {
            canceled(cancel)?;
            let folder = self.root.join(directory);
            for item in fs::read_dir(folder).map_err(|_| "Could not review staged directory.")? {
                canceled(cancel)?;
                let item = item.map_err(|_| "Could not review staged entry.")?;
                let name = item.file_name().into_string().map_err(|_| "Unexpected staged entry name.")?;
                let relative = if directory.is_empty() { name } else { format!("{directory}/{name}") };
                let meta = fs::symlink_metadata(item.path()).map_err(|_| "Could not inspect staged entry.")?;
                if meta.file_attributes() & REPARSE_POINT != 0 { return Err("Redirected staged entry."); }
                if meta.is_dir() && self.directories.get(&relative).is_some_and(Option::is_some) {
                    self.user.verify_descendant(&item.path(), true)?;
                    if !seen_dirs.insert(relative) { return Err("Duplicate staged directory."); }
                } else if meta.is_file() && self.files.contains_key(&relative) {
                    self.user.verify_descendant(&item.path(), false)?;
                    if !seen_files.insert(relative) { return Err("Duplicate staged file."); }
                } else { return Err("Unexpected staged content."); }
            }
        }
        if seen_files.len() != self.files.len() || seen_dirs.len() != self.directories.len() {
            return Err("Staged inventory is incomplete.");
        }
        let mut tree = Sha256::new();
        tree.update(b"tsugi-package-stage-v1");
        for relative in self.directories.keys() {
            tree.update(b"d"); tree.update((relative.len() as u64).to_be_bytes()); tree.update(relative.as_bytes());
        }
        for (relative, staged) in &mut self.files {
            canceled(cancel)?;
            let meta = staged.file.metadata().map_err(|_| "Could not inspect staged file.")?;
            if !meta.is_file() || meta.file_attributes() & REPARSE_POINT != 0 ||
                meta.len() != staged.bytes || !hex(&staged.digest, 64) ||
                hash(&mut staged.file, staged.bytes, cancel)? != staged.digest {
                return Err("Staged file readback differs from verified package.");
            }
            tree.update(b"f"); tree.update((relative.len() as u64).to_be_bytes()); tree.update(relative.as_bytes());
            tree.update(staged.bytes.to_be_bytes()); tree.update(staged.digest.as_bytes());
        }
        Ok(format!("{:x}", tree.finalize()))
    }

    fn cleanup(&mut self) -> Result<()> {
        if self.closed { return Ok(()); }
        self.closed = true;
        // No recursive delete. Only files created exclusively by this Stage
        // and empty directories created by this Stage are ever removed.
        // Keep parent/ancestor pins until their child cleanup is complete.
        let mut failed = false;
        for (relative, staged) in std::mem::take(&mut self.files) {
            let path = self.root.join(relative);
            let owned = self.user.verify_descendant(&path, false).is_ok();
            drop(staged);
            if !owned || fs::remove_file(&path).is_err() { failed = true; }
        }
        for (relative, pin) in std::mem::take(&mut self.directories).into_iter().rev() {
            let path = self.root.join(relative);
            let owned = self.user.verify_descendant(&path, true).is_ok();
            drop(pin);
            if !owned || fs::remove_dir(&path).is_err() { failed = true; }
        }
        let owned = self.user.verify(&self.root, true).is_ok();
        self.root_pin.take();
        if !owned || fs::remove_dir(&self.root).is_err() { failed = true; }
        if failed { Err("Private staging cleanup incomplete; no unreviewed content removed.") } else { Ok(()) }
    }
}

impl Drop for Stage {
    fn drop(&mut self) {
        if self.cleanup().is_err() { log::warn!("Private package staging cleanup incomplete."); }
    }
}

pub(super) fn probe_source<R: Read + Seek>(mut source: R, expected_bytes: u64, expected_sha256: &str,
                                        expected_commit: &str, cancel: &AtomicBool) -> Result<StagingReport> {
    // Full validation comes first, retaining the same immutable package handle.
    let package = verify(&mut source, expected_bytes, expected_sha256, expected_commit, cancel)?;
    let (entries, unpacked) = directory(&mut source, package.package_bytes, cancel)?;
    if unpacked != package.unpacked_bytes || entries.len() != package.entries {
        return Err("Staging directory changed after verification.");
    }
    let mut archive = ZipArchive::new(&mut source).map_err(|_| "Could not reopen verified package.")?;
    if archive.len() != entries.len() { return Err("Verified package index changed."); }
    let mut stage = Stage::new(unpacked)?;
    for (index, entry) in entries.iter().enumerate() {
        canceled(cancel)?;
        let mut file = archive.by_index(index).map_err(|_| "Could not reopen verified entry.")?;
        let method = if entry.method == 0 { CompressionMethod::Stored } else { CompressionMethod::Deflated };
        if file.name() != entry.name || file.size() != entry.size ||
            file.compressed_size() != entry.compressed || file.crc32() != entry.crc ||
            file.compression() != method || file.is_dir() != entry.directory || file.data_start() != Some(entry.data) {
            return Err("Staging entry differs from reviewed ZIP index.");
        }
        stage.write_entry(entry, &mut file, cancel)?;
    }
    let tree_sha256 = stage.verify_contents(cancel)?;
    let report = StagingReport { package, files:stage.files.len(), directories:stage.directories.len(), tree_sha256 };
    stage.cleanup()?;
    Ok(report)
}

/// Verify, extract, read back and remove a package in private temporary
/// storage. The source is opened once with write/delete sharing denied.
/// Accepts no installation or destination path; never installs or executes.
pub fn probe_stage_package(path: &Path, expected_bytes: u64, expected_sha256: &str,
                           expected_commit: &str, cancel: &AtomicBool) -> Result<StagingReport> {
    probe_source(open_package(path)?,expected_bytes,expected_sha256,expected_commit,cancel)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    fn entry(name: &str, data: &[u8]) -> Entry {
        Entry {name:name.into(), directory:false, flags:0, method:0, crc:crc32fast::hash(data),
            compressed:data.len() as u64, size:data.len() as u64, offset:0, data:0}
    }

    #[test]
    fn stage_checks_free_space_before_creating_files() {
        assert!(require_space(STAGE_MARGIN+10,10).is_ok());
        assert!(require_space(STAGE_MARGIN+9,10).is_err());
        assert!(require_space(u64::MAX,MAX_UNPACKED+1).is_err());
    }

    #[test]
    fn staging_checks_readback_and_cleans_exact_created_files() {
        let mut stage=Stage::new(16).unwrap();
        let root=stage.root.clone();
        let cancel=AtomicBool::new(false);
        let bytes=b"fixture";
        stage.write_entry(&entry("current/web/fixture.txt",bytes),&mut Cursor::new(bytes),&cancel).unwrap();
        let digest=stage.verify_contents(&cancel).unwrap();
        assert_eq!(digest.len(),64);
        assert_eq!(stage.verify_contents(&cancel).unwrap(),digest);
        let staged=stage.files.get_mut("current/web/fixture.txt").unwrap();
        staged.file.seek(SeekFrom::Start(0)).unwrap();
        staged.file.write_all(b"corrupt").unwrap();
        staged.file.sync_all().unwrap();
        assert!(stage.verify_contents(&cancel).is_err());
        stage.cleanup().unwrap();
        assert!(!root.exists());
    }

    #[test]
    fn cancellation_and_unexpected_content_do_not_delete_unreviewed_files() {
        let mut stage=Stage::new(16).unwrap();
        let root=stage.root.clone();
        let cancel=AtomicBool::new(false);
        stage.write_entry(&entry("current/fixture.txt",b"owned"),&mut Cursor::new(b"owned"),&cancel).unwrap();
        cancel.store(true,Ordering::Relaxed);
        assert!(stage.write_entry(&entry("current/another.txt",b"new"),&mut Cursor::new(b"new"),&cancel).is_err());
        assert!(!root.join("current/another.txt").exists());
        cancel.store(false,Ordering::Relaxed);
        fs::write(root.join("unexpected.txt"),b"preserve").unwrap();
        assert!(stage.verify_contents(&cancel).is_err());
        assert!(stage.cleanup().is_err());
        assert_eq!(fs::read(root.join("unexpected.txt")).unwrap(),b"preserve");
        assert!(!root.join("current").exists());
        fs::remove_file(root.join("unexpected.txt")).unwrap();
        fs::remove_dir(root).unwrap();
    }
}
