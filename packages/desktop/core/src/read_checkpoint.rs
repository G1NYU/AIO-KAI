//! Device-local extension-update recovery. The caller holds ReadStorage's
//! exclusive lock and has stopped Java before creating or restoring a copy.
//! These files can contain runtime credentials and are never portable exports.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

const ROOTS: [&str; 4] = ["database.mv.db", "extensions", "android-compat", "server.conf"];
const MAX_ENTRIES: usize = 20_000;
const MAX_FILE: u64 = 512 * 1024 * 1024;
const MAX_TOTAL: u64 = 2 * 1024 * 1024 * 1024;
const MAX_MANIFEST: u64 = 8 * 1024 * 1024;
const INVALID: &str = "Extension recovery files failed verification. Reading remains stopped.";
const IO_ERROR: &str = "Could not prepare or restore the extension recovery copy. Check available disk space and retry.";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Kind { Missing, Directory, File }

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct Entry { path: String, kind: Kind, bytes: u64, sha256: String }

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Manifest { version: u32, id: String, entries: Vec<Entry> }

/// A verified, immutable pre-update copy. Dropping it intentionally leaves the
/// pending journal: startup recovery must handle a crash at any later step.
pub struct ReadCheckpoint { data: PathBuf, pending: PathBuf, manifest: Manifest }

fn redirected(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_type().is_symlink() || metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    { metadata.file_type().is_symlink() }
}

fn metadata(path: &Path) -> Result<Option<fs::Metadata>, &'static str> {
    match fs::symlink_metadata(path) {
        Ok(meta) if !redirected(&meta) && (meta.is_file() || meta.is_dir()) => Ok(Some(meta)),
        Ok(_) => Err(INVALID),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(IO_ERROR),
    }
}

fn directory(path: &Path) -> Result<(), &'static str> {
    if metadata(path)?.is_some_and(|meta| meta.is_dir()) { Ok(()) } else { Err(INVALID) }
}

fn verify_privacy(paths: &[&Path]) -> Result<(), &'static str> {
    #[cfg(windows)]
    {
        use crate::read_runtime::private_storage::CurrentUser;
        fn visit(path: &Path, user: &CurrentUser, remaining: &mut usize, depth: usize) -> Result<(), &'static str> {
            if *remaining == 0 || depth > 35 { return Err(INVALID); }
            *remaining -= 1;
            let Some(meta) = metadata(path)? else { return Ok(()); };
            user.verify_descendant(path, meta.is_dir())?;
            if meta.is_dir() {
                for child in fs::read_dir(path).map_err(|_| IO_ERROR)? {
                    visit(&child.map_err(|_| IO_ERROR)?.path(), user, remaining, depth + 1)?;
                }
            }
            Ok(())
        }
        let user = CurrentUser::get()?;
        let mut remaining = MAX_ENTRIES * 4 + 20;
        for path in paths { visit(path, &user, &mut remaining, 0)?; }
    }
    #[cfg(not(windows))]
    { let _ = paths; }
    Ok(())
}

fn safe_component(value: &str) -> bool {
    !value.is_empty() && value.len() <= 255 && value != "." && value != ".."
        && !value.ends_with(['.', ' '])
        && !value.chars().any(|ch| ch.is_control() || matches!(ch, '/' | '\\' | ':' | '<' | '>' | '"' | '|' | '?' | '*'))
}

fn valid_path(path: &str) -> bool {
    path.len() <= 1024 && path.split('/').count() <= 32 && path.split('/').all(safe_component)
        && ROOTS.contains(&path.split('/').next().unwrap_or_default())
}

fn digest_file(path: &Path, expected: u64) -> Result<String, &'static str> {
    if expected > MAX_FILE || metadata(path)?.is_none_or(|meta| !meta.is_file() || meta.len() != expected) {
        return Err(INVALID);
    }
    let mut file = File::open(path).map_err(|_| IO_ERROR)?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    let mut count = 0u64;
    loop {
        let size = file.read(&mut buffer).map_err(|_| IO_ERROR)?;
        if size == 0 { break; }
        count = count.checked_add(size as u64).ok_or(INVALID)?;
        if count > expected { return Err(INVALID); }
        hash.update(&buffer[..size]);
    }
    if count != expected || metadata(path)?.is_none_or(|meta| !meta.is_file() || meta.len() != expected) {
        return Err(INVALID);
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn collect(root: &Path, relative: &str, entries: &mut Vec<Entry>, total: &mut u64) -> Result<(), &'static str> {
    if entries.len() >= MAX_ENTRIES || !valid_path(relative) { return Err(INVALID); }
    let path = root.join(relative);
    let Some(meta) = metadata(&path)? else {
        if !ROOTS.contains(&relative) { return Err(INVALID); }
        entries.push(Entry { path: relative.into(), kind: Kind::Missing, bytes: 0, sha256: String::new() });
        return Ok(());
    };
    if meta.is_file() {
        *total = total.checked_add(meta.len()).ok_or(INVALID)?;
        if *total > MAX_TOTAL || meta.len() > MAX_FILE { return Err("Reader data exceeds the bounded extension recovery limit."); }
        entries.push(Entry { path: relative.into(), kind: Kind::File, bytes: meta.len(), sha256: digest_file(&path, meta.len())? });
    } else {
        entries.push(Entry { path: relative.into(), kind: Kind::Directory, bytes: 0, sha256: String::new() });
        let mut children = Vec::new();
        for child in fs::read_dir(&path).map_err(|_| IO_ERROR)? {
            if children.len() + entries.len() >= MAX_ENTRIES { return Err(INVALID); }
            let name = child.map_err(|_| IO_ERROR)?.file_name().into_string().map_err(|_| INVALID)?;
            if !safe_component(&name) { return Err(INVALID); }
            children.push(name);
        }
        children.sort();
        for child in children { collect(root, &format!("{relative}/{child}"), entries, total)?; }
    }
    Ok(())
}

fn inventory(root: &Path) -> Result<Vec<Entry>, &'static str> {
    directory(root)?;
    let mut entries = Vec::new();
    let mut total = 0;
    for name in ROOTS { collect(root, name, &mut entries, &mut total)?; }
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(entries)
}

fn valid_manifest(manifest: &Manifest) -> bool {
    if manifest.version != 1 || manifest.id.len() != 32
        || !manifest.id.bytes().all(|ch| ch.is_ascii_digit() || (b'a'..=b'f').contains(&ch))
        || manifest.entries.len() < ROOTS.len() || manifest.entries.len() > MAX_ENTRIES { return false; }
    let mut seen = BTreeMap::new();
    let mut total = 0u64;
    let mut previous = "";
    for entry in &manifest.entries {
        if !valid_path(&entry.path) || entry.path.as_str() <= previous { return false; }
        previous = &entry.path;
        if let Some((parent, _)) = entry.path.rsplit_once('/') {
            if seen.get(parent) != Some(&Kind::Directory) { return false; }
        } else if !ROOTS.contains(&entry.path.as_str()) { return false; }
        match entry.kind {
            Kind::Missing if entry.path.contains('/') || entry.bytes != 0 || !entry.sha256.is_empty() => return false,
            Kind::Directory if entry.bytes != 0 || !entry.sha256.is_empty() => return false,
            Kind::File => {
                total = match total.checked_add(entry.bytes) { Some(value) => value, None => return false };
                if entry.bytes > MAX_FILE || total > MAX_TOTAL || entry.sha256.len() != 64
                    || !entry.sha256.bytes().all(|ch| ch.is_ascii_digit() || (b'a'..=b'f').contains(&ch)) { return false; }
            }
            _ => (),
        }
        seen.insert(entry.path.as_str(), entry.kind.clone());
    }
    ROOTS.iter().all(|root| seen.contains_key(root))
        && ["database.mv.db", "server.conf"].iter().all(|name| seen.get(name) != Some(&Kind::Directory))
        && ["extensions", "android-compat"].iter().all(|name| seen.get(name) != Some(&Kind::File))
}

fn write_new(path: &Path, bytes: &[u8]) -> Result<(), &'static str> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path).map_err(|_| IO_ERROR)?;
    file.write_all(bytes).and_then(|_| file.sync_all()).map_err(|_| IO_ERROR)
}

fn copy_entries(source: &Path, destination: &Path, entries: &[Entry]) -> Result<(), &'static str> {
    for entry in entries {
        let target = destination.join(&entry.path);
        match entry.kind {
            Kind::Missing => (),
            Kind::Directory => fs::create_dir(&target).map_err(|_| IO_ERROR)?,
            Kind::File => {
                if metadata(&source.join(&entry.path))?.is_none_or(|meta| !meta.is_file() || meta.len() != entry.bytes) { return Err(INVALID); }
                let input = File::open(source.join(&entry.path)).map_err(|_| IO_ERROR)?;
                let mut output = OpenOptions::new().write(true).create_new(true).open(&target).map_err(|_| IO_ERROR)?;
                let copied = std::io::copy(&mut input.take(entry.bytes + 1), &mut output).map_err(|_| IO_ERROR)?;
                output.sync_all().map_err(|_| IO_ERROR)?;
                if copied != entry.bytes || digest_file(&target, entry.bytes)? != entry.sha256 { return Err(INVALID); }
            }
        }
    }
    Ok(())
}

// Used only beneath the fixed transaction directory, after bounded inspection.
// Inspect every entry again rather than following directory links recursively.
fn remove_checked(path: &Path, budget: &mut usize, depth: usize) -> Result<(), &'static str> {
    if *budget == 0 || depth > 35 { return Err(INVALID); }
    *budget -= 1;
    let Some(meta) = metadata(path)? else { return Ok(()); };
    if meta.is_file() { return fs::remove_file(path).map_err(|_| IO_ERROR); }
    for child in fs::read_dir(path).map_err(|_| IO_ERROR)? {
        remove_checked(&child.map_err(|_| IO_ERROR)?.path(), budget, depth + 1)?;
    }
    fs::remove_dir(path).map_err(|_| IO_ERROR)
}

fn remove_transaction(path: &Path) -> Result<(), &'static str> {
    remove_checked(path, &mut (MAX_ENTRIES * 4 + 20), 0)
}

fn store(data: &Path, create: bool) -> Result<Option<(PathBuf, PathBuf)>, &'static str> {
    directory(data)?;
    #[cfg(windows)]
    crate::read_runtime::private_storage::CurrentUser::get()?.verify(data, true)?;
    let data = data.canonicalize().map_err(|_| IO_ERROR)?;
    let root = data.join("extension-recovery");
    if metadata(&root)?.is_none() {
        if !create { return Ok(None); }
        // ReadStorage has already verified this parent's owner-only ACL. New
        // descendants inherit it, including the DB and extension preferences.
        fs::create_dir(&root).map_err(|_| IO_ERROR)?;
    }
    directory(&root)?;
    verify_privacy(&[&root])?;
    Ok(Some((data, root)))
}

fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>, &'static str> {
    let meta = metadata(path)?.filter(|meta| meta.is_file() && meta.len() <= limit).ok_or(INVALID)?;
    let mut bytes = Vec::with_capacity(meta.len() as usize);
    File::open(path).map_err(|_| IO_ERROR)?.take(limit + 1).read_to_end(&mut bytes).map_err(|_| IO_ERROR)?;
    if bytes.len() as u64 != meta.len() || bytes.len() as u64 > limit { return Err(INVALID); }
    Ok(bytes)
}

fn open_checkpoint(data: PathBuf, pending: PathBuf) -> Result<ReadCheckpoint, &'static str> {
    directory(&pending)?;
    verify_privacy(&[&pending])?;
    let manifest: Manifest = serde_json::from_slice(&read_bounded(&pending.join("manifest.json"), MAX_MANIFEST)?).map_err(|_| INVALID)?;
    if !valid_manifest(&manifest) { return Err(INVALID); }
    Ok(ReadCheckpoint { data, pending, manifest })
}

impl ReadCheckpoint {
    pub fn id(&self) -> &str { &self.manifest.id }

    fn verify(&self) -> Result<(), &'static str> {
        verify_privacy(&[&self.pending])?;
        if inventory(&self.pending.join("snapshot"))? != self.manifest.entries { return Err(INVALID); }
        Ok(())
    }

    fn accepted(&self) -> Result<bool, &'static str> {
        let marker = self.pending.join("accepted");
        if metadata(&marker)?.is_none() { return Ok(false); }
        if read_bounded(&marker, 32)? != self.manifest.id.as_bytes() { return Err(INVALID); }
        Ok(true)
    }

    fn accept(&self) -> Result<(), &'static str> {
        // Publish a flushed marker for process-interruption recovery. No cleanup after rename:
        // callers can distinguish committed state from a pending rollback.
        if self.accepted()? { return Ok(()); }
        let stage = self.pending.join("accepted.tmp");
        remove_transaction(&stage)?;
        write_new(&stage, self.manifest.id.as_bytes())?;
        fs::rename(stage, self.pending.join("accepted")).map_err(|_| IO_ERROR)
    }

    pub fn commit(self) -> Result<(), &'static str> {
        self.verify()?;
        self.accept()
    }

    pub fn rollback(self) -> Result<(), &'static str> {
        if self.accepted()? { return Err("A completed extension checkpoint cannot be replayed."); }
        self.verify()?;
        // Fully materialize and verify the replacement before moving anything
        // out of live storage. Re-entry discards only an incomplete staging copy.
        let stage = self.pending.join("restore");
        remove_transaction(&stage)?;
        fs::create_dir(&stage).map_err(|_| IO_ERROR)?;
        copy_entries(&self.pending.join("snapshot"), &stage, &self.manifest.entries)?;
        if inventory(&stage)? != self.manifest.entries { return Err(INVALID); }
        // Refuse redirected/unbounded live paths before the first replacement.
        inventory(&self.data)?;
        let displaced = self.pending.join("displaced");
        if metadata(&displaced)?.is_none() { fs::create_dir(&displaced).map_err(|_| IO_ERROR)?; }
        directory(&displaced)?;
        for root in ROOTS {
            let original = self.data.join(root);
            let old = displaced.join(root);
            remove_transaction(&old)?;
            if metadata(&original)?.is_some() { fs::rename(&original, &old).map_err(|_| IO_ERROR)?; }
            let replacement = stage.join(root);
            if metadata(&replacement)?.is_some() { fs::rename(&replacement, &original).map_err(|_| IO_ERROR)?; }
        }
        if inventory(&self.data)? != self.manifest.entries { return Err(INVALID); }
        self.accept()
    }
}

pub fn create(data: &Path) -> Result<ReadCheckpoint, &'static str> {
    let (data, root) = store(data, true)?.ok_or(IO_ERROR)?;
    let sources: Vec<PathBuf> = ROOTS.iter().map(|name| data.join(name)).collect();
    verify_privacy(&sources.iter().map(PathBuf::as_path).collect::<Vec<_>>())?;
    let pending = root.join("pending");
    if metadata(&pending)?.is_some() {
        let prior = open_checkpoint(data.clone(), pending.clone())?;
        if !prior.accepted()? { return Err("An unfinished extension update must be recovered before another update."); }
        // Keep the most recent verified copy until preparing the next update.
        remove_transaction(&pending)?;
    }
    let stage = root.join("preparing");
    remove_transaction(&stage)?;
    fs::create_dir(&stage).map_err(|_| IO_ERROR)?;
    let snapshot = stage.join("snapshot");
    fs::create_dir(&snapshot).map_err(|_| IO_ERROR)?;
    let entries = inventory(&data)?;
    let mut nonce = [0u8; 16];
    getrandom::fill(&mut nonce).map_err(|_| IO_ERROR)?;
    let manifest = Manifest { version: 1, id: nonce.iter().map(|byte| format!("{byte:02x}")).collect(), entries };
    if !valid_manifest(&manifest) { return Err(INVALID); }
    copy_entries(&data, &snapshot, &manifest.entries)?;
    if inventory(&snapshot)? != manifest.entries || inventory(&data)? != manifest.entries { return Err(INVALID); }
    let bytes = serde_json::to_vec(&manifest).map_err(|_| INVALID)?;
    if bytes.len() as u64 > MAX_MANIFEST { return Err(INVALID); }
    write_new(&stage.join("manifest.json"), &bytes)?;
    fs::rename(&stage, &pending).map_err(|_| IO_ERROR)?;
    Ok(ReadCheckpoint { data, pending, manifest })
}

/// Run after taking the private storage lock and before starting Java. A copy
/// whose final accepted marker is absent always returns to its previous state.
pub fn recover_pending(data: &Path) -> Result<Option<String>, &'static str> {
    let Some((data, root)) = store(data, false)? else { return Ok(None); };
    let pending = root.join("pending");
    if metadata(&pending)?.is_none() { return Ok(None); }
    let checkpoint = open_checkpoint(data, pending)?;
    if checkpoint.accepted()? { return Ok(None); }
    let id = checkpoint.id().to_owned();
    checkpoint.rollback()?;
    Ok(Some(id))
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let mut nonce = [0u8; 16]; getrandom::fill(&mut nonce).unwrap();
            let root = std::env::temp_dir().join(format!("tsugi-recovery-{:x}", u128::from_le_bytes(nonce)));
            #[cfg(windows)]
            { crate::read_runtime::private_storage::CurrentUser::get().unwrap().create_root(&root).unwrap(); }
            #[cfg(not(windows))]
            { fs::create_dir(&root).unwrap(); }
            fs::write(root.join("database.mv.db"), b"original library and progress").unwrap();
            fs::create_dir(root.join("extensions")).unwrap();
            fs::write(root.join("extensions/old.jar"), b"original extension").unwrap();
            fs::create_dir(root.join("android-compat")).unwrap();
            fs::create_dir(root.join("android-compat/shared_prefs")).unwrap();
            fs::write(root.join("android-compat/shared_prefs/preferences.xml"), b"pending file deletion metadata").unwrap();
            Self(root)
        }
    }
    impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }

    #[test]
    fn interrupted_update_restores_database_extensions_preferences_and_absent_roots() {
        let fixture = Fixture::new(); let original = inventory(&fixture.0).unwrap();
        let checkpoint = create(&fixture.0).unwrap(); let id = checkpoint.id().to_owned(); drop(checkpoint);
        fs::write(fixture.0.join("database.mv.db"), b"new incompatible DB").unwrap();
        fs::remove_file(fixture.0.join("extensions/old.jar")).unwrap();
        fs::write(fixture.0.join("extensions/new.jar"), b"candidate").unwrap();
        fs::write(fixture.0.join("server.conf"), b"new config").unwrap();
        fs::write(fixture.0.join("android-compat/shared_prefs/preferences.xml"), b"changed").unwrap();
        assert_eq!(recover_pending(&fixture.0).unwrap(), Some(id));
        assert_eq!(inventory(&fixture.0).unwrap(), original);
        assert_eq!(recover_pending(&fixture.0).unwrap(), None);
    }

    #[test]
    fn successful_update_survives_restart_and_next_checkpoint() {
        let fixture = Fixture::new(); let checkpoint = create(&fixture.0).unwrap();
        fs::write(fixture.0.join("database.mv.db"), b"new compatible DB").unwrap();
        checkpoint.commit().unwrap();
        assert_eq!(recover_pending(&fixture.0).unwrap(), None);
        assert_eq!(fs::read(fixture.0.join("database.mv.db")).unwrap(), b"new compatible DB");
        let next = create(&fixture.0).unwrap(); next.rollback().unwrap();
        assert_eq!(fs::read(fixture.0.join("database.mv.db")).unwrap(), b"new compatible DB");
    }

    #[test]
    fn corrupt_copy_never_mutates_live_data_or_marks_recovery_done() {
        let fixture = Fixture::new(); let checkpoint = create(&fixture.0).unwrap();
        fs::write(checkpoint.pending.join("snapshot/database.mv.db"), b"corrupt").unwrap();
        fs::write(fixture.0.join("database.mv.db"), b"current DB").unwrap();
        assert!(checkpoint.rollback().is_err());
        assert_eq!(fs::read(fixture.0.join("database.mv.db")).unwrap(), b"current DB");
        assert!(recover_pending(&fixture.0).is_err());
    }

    #[test]
    fn recovery_restarts_after_interrupted_root_replacement() {
        let fixture = Fixture::new(); let original = inventory(&fixture.0).unwrap();
        let checkpoint = create(&fixture.0).unwrap();
        let displaced = checkpoint.pending.join("displaced"); fs::create_dir(&displaced).unwrap();
        fs::rename(fixture.0.join("database.mv.db"), displaced.join("database.mv.db")).unwrap();
        fs::write(fixture.0.join("extensions/partial.jar"), b"half applied").unwrap();
        drop(checkpoint);
        assert!(recover_pending(&fixture.0).unwrap().is_some());
        assert_eq!(inventory(&fixture.0).unwrap(), original);
    }

    #[test]
    fn pending_update_blocks_another_and_corrupt_markers_fail_closed() {
        let fixture = Fixture::new(); let checkpoint = create(&fixture.0).unwrap();
        assert!(create(&fixture.0).is_err());
        fs::write(checkpoint.pending.join("accepted"), b"unexpected").unwrap();
        assert!(recover_pending(&fixture.0).is_err());
    }

    #[test]
    fn path_traversal_duplicate_paths_and_wrong_root_types_reject() {
        let fixture = Fixture::new(); let mut checkpoint = create(&fixture.0).unwrap();
        checkpoint.manifest.entries[0].path = "../outside".into(); assert!(!valid_manifest(&checkpoint.manifest));
        checkpoint.manifest.entries = inventory(&fixture.0).unwrap();
        checkpoint.manifest.entries.push(checkpoint.manifest.entries[0].clone()); assert!(!valid_manifest(&checkpoint.manifest));
        checkpoint.manifest.entries = inventory(&fixture.0).unwrap();
        let db = checkpoint.manifest.entries.iter_mut().find(|entry| entry.path == "database.mv.db").unwrap();
        db.kind = Kind::Directory; db.bytes = 0; db.sha256.clear(); assert!(!valid_manifest(&checkpoint.manifest));
        for path in ["extensions/../secret", "extensions\\..\\secret", "extensions/a:stream", "extensions/name.", "/extensions/test"] { assert!(!valid_path(path)); }
    }

    #[test]
    fn unexpected_snapshot_content_is_rejected_before_restore() {
        let fixture = Fixture::new(); let checkpoint = create(&fixture.0).unwrap();
        fs::write(checkpoint.pending.join("snapshot/extensions/unrecorded.jar"), b"extra").unwrap();
        assert!(checkpoint.rollback().is_err());
    }

    #[cfg(windows)]
    #[test]
    fn weakened_checkpoint_permissions_refuse_sensitive_recovery() {
        use crate::read_runtime::private_storage::{CurrentUser, create_public_fixture};
        let fixture = Fixture::new(); let checkpoint = create(&fixture.0).unwrap();
        let snapshot = checkpoint.pending.join("snapshot");
        let user = CurrentUser::get().unwrap();
        create_public_fixture(&snapshot.join("public"), &user);
        assert!(checkpoint.rollback().is_err());
        assert!(recover_pending(&fixture.0).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn redirected_source_and_recovery_paths_are_rejected() {
        use std::os::unix::fs::symlink;
        let fixture = Fixture::new();
        symlink(fixture.0.join("database.mv.db"), fixture.0.join("extensions/linked.jar")).unwrap();
        assert!(create(&fixture.0).is_err());
        fs::remove_file(fixture.0.join("extensions/linked.jar")).unwrap();
        let checkpoint = create(&fixture.0).unwrap();
        let copy = checkpoint.pending.join("snapshot/database.mv.db"); fs::remove_file(&copy).unwrap();
        symlink(fixture.0.join("database.mv.db"), &copy).unwrap();
        assert!(checkpoint.rollback().is_err());
    }
}
