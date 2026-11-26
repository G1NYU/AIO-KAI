//! Exact-byte extension updates for the pinned runtime. The public API never
//! accepts an archive path, GraphQL document or web-supplied review object.
use super::*;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::path::PathBuf;

const MAX_EXTENSION: u64 = 32 * 1024 * 1024;
const REVIEW_LIFETIME: Duration = Duration::from_secs(600);

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Manifest {
    package: String,
    version_name: String,
    version_code: i64,
    source_class: String,
}

/// Private capability retained by native code across its owned confirmation.
/// The bytes described by the hash are the bytes sent to the runtime.
pub struct ExtensionUpdateReview {
    package: String,
    installed: Value,
    store: Value,
    manifest: Manifest,
    artifact: Vec<u8>,
    sha256: String,
    installed_sha256: String,
    download: String,
    suffix: &'static str,
    created: Instant,
    description: String,
}

impl ExtensionUpdateReview {
    pub fn description(&self) -> &str { &self.description }
}

fn digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

/// Accept only the two host-only session cookies issued by the pinned engine.
/// This value is operation-local and is never stored in a general cookie jar.
fn upload_session_cookies<'a>(headers: impl IntoIterator<Item = &'a str>) -> Result<String, &'static str> {
    let invalid = "The reading engine returned an invalid extension upload session.";
    let mut session = None;
    let mut csrf = None;
    for (index, header) in headers.into_iter().enumerate() {
        if index >= 2 || header.len() > 1024 || !header.is_ascii() || header.bytes().any(|b| b.is_ascii_control()) {
            return Err(invalid);
        }
        let mut parts = header.split(';');
        let (name, value) = parts.next().and_then(|part| part.trim().split_once('=')).ok_or(invalid)?;
        if value.is_empty() || value.len() > 256 || !value.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b)) {
            return Err(invalid);
        }
        let mut path = false;
        let mut http_only = false;
        let mut strict = false;
        for part in parts {
            let part = part.trim();
            match part.split_once('=') {
                Some((name, "/")) if name.eq_ignore_ascii_case("Path") && !path => path = true,
                Some((name, value)) if name.eq_ignore_ascii_case("SameSite") && value.eq_ignore_ascii_case("Strict") && !strict => strict = true,
                None if part.eq_ignore_ascii_case("HttpOnly") && !http_only => http_only = true,
                // No Domain, Secure, expiry, duplicate or unknown attributes:
                // the reviewed runtime uses HTTP on the exact loopback origin.
                _ => return Err(invalid),
            }
        }
        if !path || !http_only || !strict { return Err(invalid); }
        match name {
            "JSESSIONID" if session.is_none() => session = Some(value),
            "suwayomi-basic-csrf" if csrf.is_none() && value.len() == 36 && value.bytes().enumerate().all(|(index, b)| {
                if matches!(index, 8 | 13 | 18 | 23) { b == b'-' } else { b.is_ascii_digit() || (b'a'..=b'f').contains(&b) }
            }) => csrf = Some(value),
            _ => return Err(invalid),
        }
    }
    Ok(format!("JSESSIONID={}; suwayomi-basic-csrf={}", session.ok_or(invalid)?, csrf.ok_or(invalid)?))
}

fn printable(value: &Value, max: usize) -> Result<&str, &'static str> {
    value.as_str().filter(|s| !s.is_empty() && s.len() <= max && !s.chars().any(char::is_control))
        .ok_or("Invalid extension update metadata.")
}

fn number(value: &Value) -> Result<i64, &'static str> {
    value.as_i64().or_else(|| value.as_str().and_then(|s| s.parse().ok()))
        .filter(|v| *v > 0).ok_or("Invalid extension version code.")
}

fn candidate_url(installed: &Value) -> Result<(&str, &'static str), &'static str> {
    if let Some(jar) = installed["jarUrl"].as_str() {
        Ok((jar, ".jar"))
    } else {
        Ok((installed["apkUrl"].as_str().ok_or("Extension has no update download.")?, ".apk"))
    }
}

fn download_candidate(download: &str, suffix: &str) -> Result<Vec<u8>, &'static str> {
    extension_download(download, suffix)?;
    // A redirect is a new download origin and requires a new review. Never
    // forward runtime credentials or the system proxy to a repository.
    let agent: ureq::Agent = ureq::Agent::config_builder().proxy(None).max_redirects(0)
        .http_status_as_error(false).timeout_global(Some(Duration::from_secs(45)))
        .build().into();
    let mut response = agent.get(download).header("Accept", "application/octet-stream")
        .header("Connection", "close").call().map_err(|_| "Could not download the extension update.")?;
    if response.status().as_u16() != 200 {
        return Err("Extension update download is unavailable or redirects to another location.");
    }
    let mut bytes = Vec::new();
    response.body_mut().as_reader().take(MAX_EXTENSION + 1).read_to_end(&mut bytes)
        .map_err(|_| "Could not read the extension update.")?;
    if bytes.len() < 4 || bytes.len() as u64 > MAX_EXTENSION || !bytes.starts_with(b"PK\x03\x04") {
        return Err("Extension update is not a supported bounded archive.");
    }
    Ok(bytes)
}

fn source_ids(record: &Value) -> Result<BTreeSet<String>, &'static str> {
    let source = &record["source"];
    let rows = source["nodes"].as_array().ok_or("Could not verify extension sources.")?;
    if rows.len() > 1000 || source["totalCount"].as_u64() != Some(rows.len() as u64) {
        return Err("Extension source inventory is incomplete.");
    }
    let mut ids = BTreeSet::new();
    for row in rows {
        let id = row["id"].as_str().filter(|s| s.parse::<i64>().is_ok())
            .ok_or("Invalid extension source identity.")?;
        if !ids.insert(id.to_owned()) { return Err("Duplicate extension source identity."); }
    }
    Ok(ids)
}

fn canonical_extension_record(mut record: Value) -> Result<Value, &'static str> {
    source_ids(&record)?;
    // The pinned extension-source loader has no orderBy. Normalize only that
    // list; every source identity, count and other metadata remains exact.
    record["source"]["nodes"].as_array_mut().ok_or("Could not verify extension sources.")?
        .sort_by(|left, right| left["id"].as_str().cmp(&right["id"].as_str()));
    Ok(record)
}

fn verified_source_ids(installed: &Value, inventory: &Value) -> Result<BTreeSet<String>, &'static str> {
    let rows = inventory["nodes"].as_array().ok_or("Invalid extension source inventory.")?;
    if rows.len() > 1000 || inventory["totalCount"].as_u64() != Some(rows.len() as u64) {
        return Err("The Reader source inventory is incomplete. Resolve unavailable sources before updating.");
    }
    let mut seen = BTreeSet::new();
    let mut owned = BTreeSet::new();
    for row in rows {
        let id = row["id"].as_str().filter(|id| id.parse::<i64>().is_ok()).ok_or("Invalid extension source identity.")?;
        if !seen.insert(id) { return Err("Duplicate extension source identity."); }
        let package = row["extension"]["pkgName"].as_str().ok_or("Could not verify extension source ownership.")?;
        if installed["pkgName"] == package { owned.insert(id.to_owned()); }
    }
    if owned != source_ids(installed)? { return Err("Extension source ownership changed. Review the update again."); }
    Ok(owned)
}

fn validate_manifest(manifest: &Manifest, installed: &Value) -> Result<(), &'static str> {
    extension_package(&manifest.package)?;
    if installed["pkgName"] != manifest.package || manifest.version_code <= number(&installed["versionCodeLong"])?
        || manifest.version_code > i64::from(i32::MAX) || manifest.version_name.len() > 80
        || !manifest.version_name.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
        || manifest.source_class.len() > 512 {
        return Err("The candidate does not match this package or is not a newer version.");
    }
    // These are the numeric library versions accepted by v2.4.2373. Do not
    // compare display versions lexicographically or load code to inspect it.
    let library = manifest.version_name.rsplit_once('.').map(|(library, _)| library);
    if !matches!(library, Some("1.3" | "1.4" | "1.5" | "1.6")) {
        return Err("The extension update uses an unsupported library version.");
    }
    let class = manifest.source_class.strip_prefix('.').unwrap_or(&manifest.source_class);
    if class.is_empty() || !class.split('.').all(|part| !part.is_empty() &&
        part.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'$')) {
        return Err("Invalid extension entry point.");
    }
    Ok(())
}

/// Always remove the private metadata inspection file, including failures.
struct InspectionFile(PathBuf);
impl Drop for InspectionFile {
    fn drop(&mut self) { let _ = fs::remove_file(&self.0); }
}

impl ReadRuntime {
    fn inspect_extension_bytes(&self, bytes: &[u8], suffix: &str) -> Result<Manifest, &'static str> {
        if !matches!(suffix, ".jar" | ".apk") || bytes.len() as u64 > MAX_EXTENSION || !bytes.starts_with(b"PK\x03\x04") {
            return Err("Invalid extension inspection archive.");
        }
        let user = private_storage::CurrentUser::get()?;
        user.verify(&self._storage.temp_dir, true)?;
        let mut nonce = [0u8; 16];
        getrandom::fill(&mut nonce).map_err(|_| "Could not prepare extension inspection.")?;
        let name: String = nonce.iter().map(|b| format!("{b:02x}")).collect();
        let path = self._storage.temp_dir.join(format!("tsugi-inspect-{name}{suffix}"));
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&path)
            .map_err(|_| "Could not prepare extension inspection.")?;
        let cleanup = InspectionFile(path);
        let staged = file.write_all(bytes).and_then(|_| file.sync_all());
        drop(file);
        staged.map_err(|_| "Could not stage extension inspection.")?;
        user.verify(&cleanup.0, false)?;
        let classpath = std::env::join_paths([self.runtime_path.join("launcher"), self.runtime_path.join("bin/Suwayomi-Server.jar")])
            .map_err(|_| "Invalid reading runtime path.")?;
        let job = ReadJob::new()?;
        let mut child = Command::new(self.runtime_path.join("jre/bin/java.exe"))
            .arg(format!("-Djava.io.tmpdir={}", self._storage.temp_dir.display()))
            .args(["-Xmx128m", "-cp"]).arg(classpath)
            .args(["TsugiReadLauncher", "--inspect-extension"]).arg(&cleanup.0)
            .env_remove("JAVA_TOOL_OPTIONS").env_remove("JDK_JAVA_OPTIONS").env_remove("_JAVA_OPTIONS")
            .creation_flags(NO_WINDOW).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null())
            .spawn().map_err(|_| "Could not inspect extension metadata.")?;
        if let Err(error) = job.attach_and_release(&mut child) {
            let _ = child.kill(); let _ = child.wait(); return Err(error);
        }
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            match child.try_wait() {
                Ok(Some(status)) if status.success() => break,
                Ok(Some(_)) => return Err("Extension metadata could not be verified."),
                Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(25)),
                _ => {
                    drop(job); let _ = child.kill(); let _ = child.wait();
                    return Err("Extension metadata inspection timed out.");
                }
            }
        }
        let mut output = Vec::new();
        child.stdout.take().ok_or("Missing extension inspection result.")?.take(8193).read_to_end(&mut output)
            .map_err(|_| "Could not read extension metadata.")?;
        if output.len() > 8192 { return Err("Extension metadata exceeded its limit."); }
        serde_json::from_slice(&output).map_err(|_| "Invalid extension metadata inspection result.")
    }

    pub(super) fn installed_artifact_hash(&self, record: &Value) -> Result<String, &'static str> {
        let name = printable(&record["apkName"], 220)?;
        let stem = name.strip_suffix(".apk").filter(|s| !s.is_empty())
            .ok_or("Installed extension artifact is unknown.")?;
        if !name.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b)) {
            return Err("Invalid installed extension artifact name.");
        }
        let directory = self.data_path.join("extensions");
        let path = directory.join(format!("{stem}.jar"));
        let user = private_storage::CurrentUser::get()?;
        user.verify_descendant(&directory, true)?;
        user.verify_descendant(&path, false)?;
        let mut bytes = Vec::new();
        fs::File::open(&path).map_err(|_| "Installed extension artifact is unavailable.")?
            .take(MAX_EXTENSION + 1).read_to_end(&mut bytes).map_err(|_| "Could not verify installed extension.")?;
        if bytes.is_empty() || bytes.len() as u64 > MAX_EXTENSION { return Err("Installed extension exceeds the supported limit."); }
        Ok(digest(&bytes))
    }

    fn update_store(&self, installed: &Value) -> Result<Value, &'static str> {
        let index = installed["storeIndexUrl"].as_str().ok_or("Extension update has no registered repository.")?;
        let stores = self.query(ReadOperation::Stores)?;
        let nodes = stores["nodes"].as_array().ok_or("Invalid extension repository inventory.")?;
        if stores["totalCount"].as_u64() != Some(nodes.len() as u64) { return Err("Extension repository inventory is incomplete."); }
        let mut matching = nodes.iter().filter(|node| node["indexUrl"] == index);
        let store = matching.next().ok_or("Extension update repository is no longer registered.")?.clone();
        if matching.next().is_some() { return Err("Ambiguous extension update repository."); }
        Ok(store)
    }

    pub(super) fn verified_extension_sources(&self, installed: &Value) -> Result<BTreeSet<String>, &'static str> {
        // Extension.source counts only sources that successfully loaded. The
        // global query retains the database count before filtering unloadable
        // rows, so completeness here detects hidden affected source identities.
        let inventory = self.client.document(
            "query TsugiUpdateSources { sources(first: 1001, order: [{ by: ID, byType: ASC }]) { nodes { id extension { pkgName } } totalCount } }",
            "sources", json!({}))?;
        verified_source_ids(installed, &inventory)
    }

    fn build_update_review(&self, installed: Value, store: Value, artifact: Vec<u8>) -> Result<ExtensionUpdateReview, &'static str> {
        let installed = canonical_extension_record(installed)?;
        if installed["isInstalled"] != true || installed["hasUpdate"] != true || installed["isObsolete"] != false {
            return Err("This installed extension has no supported update.");
        }
        let package = printable(&installed["pkgName"], 200)?.to_owned();
        extension_package(&package)?;
        let (download, suffix) = candidate_url(&installed)?;
        let download = download.to_owned();
        let manifest = self.inspect_extension_bytes(&artifact, suffix)?;
        validate_manifest(&manifest, &installed)?;
        let ids = self.verified_extension_sources(&installed)?;
        let installed_sha256 = self.installed_artifact_hash(&installed)?;
        let sha256 = digest(&artifact);
        let current_version = printable(&installed["versionName"], 80)?;
        let index = printable(&store["indexUrl"], 2048)?;
        let signing = match store["signingKey"].as_str() {
            Some(value) if !value.is_empty() => printable(&store["signingKey"], 2048)?,
            _ => "not published",
        };
        let description = format!("Package: {package}\nInstalled: {current_version} (code {})\nUpdate: {} (code {})\nCandidate repository: {index}\nRepository signing metadata: {signing}\nDownload: {download}\nCandidate SHA-256: {sha256}\nInstalled SHA-256: {installed_sha256}\n\nInstalled repository provenance is unknown. The runtime does not retain it. This confirmation trusts the candidate repository shown above. Artifact signatures are not independently verified.\n\n{} existing source identities and their saved library/progress will be checked. A private recovery checkpoint will be created before applying the update.",
            number(&installed["versionCodeLong"])?, manifest.version_name, manifest.version_code, ids.len());
        let description = if suffix == ".apk" {
            format!("{description}\n\nThe reviewed APK is converted to a JAR by the reading engine, so its installed hash will differ from the candidate hash.")
        } else { description };
        Ok(ExtensionUpdateReview { package, installed, store, manifest, artifact, sha256,
            installed_sha256, download, suffix, created: Instant::now(), description })
    }

    pub fn review_extension_update(&self, package: &str) -> Result<ExtensionUpdateReview, &'static str> {
        self.require_empty_download_queue()?;
        extension_package(package)?;
        self.refresh_extensions()?;
        let installed = self.extension_record(package)?;
        let index = installed["storeIndexUrl"].as_str().ok_or("Extension update has no registered repository.")?;
        repository_index(index)?;
        let store = self.update_store(&installed)?;
        let (download, suffix) = candidate_url(&installed)?;
        let artifact = download_candidate(download, suffix)?;
        self.build_update_review(installed, store, artifact)
    }

    fn recheck_update(&self, review: &ExtensionUpdateReview) -> Result<(), &'static str> {
        if review.created.elapsed() > REVIEW_LIFETIME { return Err("Extension update review expired. Review it again."); }
        let installed = canonical_extension_record(self.extension_record(&review.package)?)?;
        if installed != review.installed || self.update_store(&installed)? != review.store
            || self.installed_artifact_hash(&installed)? != review.installed_sha256
            || digest(&review.artifact) != review.sha256
            || self.verified_extension_sources(&installed)? != source_ids(&review.installed)? {
            return Err("The extension or repository changed. Review the update again.");
        }
        Ok(())
    }

    /// Complete cached identities/progress for this extension only; no source
    /// network requests. Fail closed on incomplete or excessively large state.
    pub(super) fn update_invariants(&self, sources: &BTreeSet<String>) -> Result<String, &'static str> {
        let mut state = Sha256::new();
        state.update(b"tsugi-extension-state-v1");
        let mut record_count = 0usize;
        let mut state_bytes = 0usize;
        for source in sources {
            let mut offset = 0u32;
            let mut expected = None;
            loop {
                let page = self.client.document(
                    "query TsugiExtensionState($source: LongString!, $offset: Int!) { mangas(condition: { sourceId: $source }, first: 20, offset: $offset, order: [{ by: ID, byType: ASC }]) { nodes { id sourceId url inLibrary categories { nodes { id } totalCount } chapters { nodes { id url pageCount isRead isBookmarked lastPageRead lastReadAt } totalCount } } totalCount } }",
                    "mangas", json!({"source": source, "offset": offset}))?;
                let rows = page["nodes"].as_array().ok_or("Invalid saved extension state.")?;
                let total = page["totalCount"].as_u64().filter(|n| *n <= 5000).ok_or("Extension state exceeds the supported limit.")?;
                if expected.replace(total).is_some_and(|n| n != total) || rows.len() > 20
                    || (rows.is_empty() && u64::from(offset) < total) {
                    return Err("Saved extension state changed during review.");
                }
                for row in rows {
                    let mut row = row.clone();
                    if row["sourceId"] != *source { return Err("Saved extension source identity did not match."); }
                    for key in ["categories", "chapters"] {
                        let count = row[key]["totalCount"].as_u64().ok_or("Incomplete saved extension state.")?;
                        let nodes = row[key]["nodes"].as_array_mut().ok_or("Invalid saved extension state.")?;
                        if nodes.len() > 10_000 || count != nodes.len() as u64 { return Err("Incomplete saved extension state."); }
                        nodes.sort_by_key(|node| node["id"].to_string());
                    }
                    let bytes = serde_json::to_vec(&row).map_err(|_| "Invalid saved extension state.")?;
                    state_bytes += bytes.len();
                    record_count += 1;
                    if record_count > 5000 || state_bytes > 32 * 1024 * 1024 { return Err("Extension state exceeds the supported limit."); }
                    state.update((bytes.len() as u64).to_le_bytes());
                    state.update(bytes);
                }
                offset += rows.len() as u32;
                if u64::from(offset) == total { break; }
                if u64::from(offset) > total { return Err("Invalid saved extension state count."); }
            }
        }
        Ok(state.finalize().iter().map(|b| format!("{b:02x}")).collect())
    }

    /// The caller must obtain native-owned confirmation of description().
    /// Revalidate the repository and re-download its candidate before stopping
    /// the runtime; install the exact reviewed bytes only after a checkpoint.
    pub fn apply_reviewed_extension_update(&mut self, review: ExtensionUpdateReview) -> Result<Value, &'static str> {
        self.require_empty_download_queue()?;
        self.refresh_extensions()?;
        self.recheck_update(&review)?;
        let fresh = download_candidate(&review.download, review.suffix)?;
        if digest(&fresh) != review.sha256 {
            return Err("The extension download changed. Review the update again.");
        }
        self.apply_update_with_checkpoint(review)
    }

    fn apply_update_with_checkpoint(&mut self, review: ExtensionUpdateReview) -> Result<Value, &'static str> {
        self.require_empty_download_queue()?;
        self.recheck_update(&review)?;
        self.reject_update_artifact_collision(&review)?;
        let sources = self.verified_extension_sources(&review.installed)?;
        let before = self.update_invariants(&sources)?;
        self.require_empty_download_queue()?;
        self.shutdown()?;
        let checkpoint = match crate::read_checkpoint::create(&self.data_path) {
            Ok(checkpoint) => checkpoint,
            Err(error) => {
                self.restart_after_stop().map_err(|_| "Could not create an extension recovery checkpoint. Restart the Reader.")?;
                return Err(error);
            }
        };
        let checkpoint_id = checkpoint.id().to_owned();
        let applied = (|| {
            self.restart_after_stop()?;
            self.require_empty_download_queue()?;
            self.recheck_update(&review)?;
            if self.update_invariants(&sources)? != before { return Err("Saved extension state changed before the update."); }
            self.reject_update_artifact_collision(&review)?;
            self.upload_reviewed_extension(&review)?;
            // Verify the persisted extension, deferred artifact deletion and
            // actual startup loader before accepting the recovery checkpoint.
            self.shutdown()?;
            self.restart_after_stop()?;
            self.require_empty_download_queue()?;
            let updated = self.extension_record(&review.package)?;
            if updated["isInstalled"] != true || updated["versionName"] != review.manifest.version_name
                || number(&updated["versionCodeLong"])? != review.manifest.version_code
                || self.verified_extension_sources(&updated)? != sources || self.update_invariants(&sources)? != before {
                return Err("The update changed a saved source, library or progress identity.");
            }
            let installed_sha256 = self.installed_artifact_hash(&updated)?;
            if review.suffix == ".jar" && installed_sha256 != review.sha256 {
                return Err("The installed extension bytes did not match the reviewed update.");
            }
            Ok(installed_sha256)
        })();
        match applied {
            Ok(installed_sha256) => {
                if checkpoint.commit().is_err() {
                    // A commit that could not be made durable is unfinished.
                    // Recover through the same journal used after a crash.
                    let _ = self.shutdown();
                    if self.child.try_wait().ok().flatten().is_none() { return Err("Could not stop Reader for extension recovery."); }
                    let recovered = crate::read_checkpoint::recover_pending(&self.data_path)
                        .map_err(|_| "The update could not be committed and recovery is pending. Restart Tsugi.")?;
                    if recovered.as_deref() != Some(checkpoint_id.as_str()) {
                        return Err("The extension update recovery status could not be confirmed. Restart Tsugi.");
                    }
                    self.restart_after_stop().map_err(|_| "Extension recovery completed. Restart the Reader to continue.")?;
                    self.verify_restored_update(&review, &sources, &before)?;
                    return Ok(json!({"package": review.package, "status": "rolled-back", "checkpointId": checkpoint_id,
                        "versionName": review.installed["versionName"], "error": "The update could not be committed; the previous extension was restored."}));
                }
                Ok(json!({"package": review.package, "status": "updated", "versionName": review.manifest.version_name,
                    "versionCode": review.manifest.version_code, "sha256": review.sha256, "installedSha256": installed_sha256,
                    "inputFormat": review.suffix.trim_start_matches('.'), "checkpointId": checkpoint_id}))
            }
            Err(error) => {
                let _ = self.shutdown();
                if self.child.try_wait().ok().flatten().is_none() { return Err("Could not stop Reader for extension recovery."); }
                checkpoint.rollback().map_err(|_| "The extension update failed and recovery is pending. Restart Tsugi before retrying.")?;
                self.restart_after_stop().map_err(|_| "The previous extension was restored. Restart the Reader to continue.")?;
                self.verify_restored_update(&review, &sources, &before)?;
                Ok(json!({"package": review.package, "status": "rolled-back", "checkpointId": checkpoint_id,
                    "versionName": review.installed["versionName"], "error": error}))
            }
        }
    }

    fn verify_restored_update(&self, review: &ExtensionUpdateReview, sources: &BTreeSet<String>, before: &str) -> Result<(), &'static str> {
        let restored = self.extension_record(&review.package)?;
        if restored["isInstalled"] != true || restored["versionName"] != review.installed["versionName"]
            || restored["versionCodeLong"] != review.installed["versionCodeLong"]
            || self.installed_artifact_hash(&restored)? != review.installed_sha256
            || self.verified_extension_sources(&restored)? != *sources || self.update_invariants(sources)? != before {
            return Err("The previous extension was restored but its saved state could not be confirmed. Restart Tsugi.");
        }
        Ok(())
    }

    fn reject_update_artifact_collision(&self, review: &ExtensionUpdateReview) -> Result<(), &'static str> {
        // ExtensionPackage.getApkName appends -v<versionName> when the
        // uploaded basename does not contain that version. Our hash-only
        // name contains no dots, so this target is deterministic for JAR/APK.
        // APK conversion writes a different JAR; refusing any pre-existing
        // target prevents reuse of an unrelated/locked converted artifact.
        let target = self.data_path.join("extensions").join(format!("tsugi-update-{}-v{}.jar", review.sha256, review.manifest.version_name));
        match fs::symlink_metadata(target) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            _ => Err("An extension update artifact already occupies the reviewed target. The update was not applied."),
        }
    }

    fn upload_reviewed_extension(&self, review: &ExtensionUpdateReview) -> Result<Value, &'static str> {
        let mut entropy = [0u8; 16];
        getrandom::fill(&mut entropy).map_err(|_| "Could not prepare extension update.")?;
        let nonce: String = entropy.iter().map(|b| format!("{b:02x}")).collect();
        let boundary = format!("TsugiExtension{nonce}");
        // Generated ASCII basename: never expose a local path or trust a
        // repository-supplied filename in multipart headers or runtime storage.
        let filename = format!("tsugi-update-{}{}", review.sha256, review.suffix);
        // The pinned parser supports top-level upload variables only. Embed
        // the input object in the fixed query instead of a nested upload map.
        let operation = json!({"query": "mutation TsugiInstallReviewedExtension($file: Upload!) { installExternalExtension(input: { extensionFile: $file }) { extension { pkgName isInstalled versionName versionCodeLong } } }", "variables": {"file": null}});
        let map = json!({"0": ["variables.file"]});
        let mut body = format!("--{boundary}\r\nContent-Disposition: form-data; name=\"operations\"\r\n\r\n{operation}\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"map\"\r\n\r\n{map}\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"0\"; filename=\"{filename}\"\r\nContent-Type: application/octet-stream\r\n\r\n").into_bytes();
        body.extend_from_slice(&review.artifact);
        body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
        // Basic authentication alone intentionally cannot authorize a form
        // upload. Bootstrap the pinned engine's session/CSRF pair using its
        // ordinary authenticated JSON endpoint, then retain it only here.
        let cookies = self.extension_upload_session()?;
        verify_listener(self.client.port, self.client.owner_pid)?;
        let mut response = self.client.slow().agent.post(format!("http://127.0.0.1:{}/api/graphql", self.client.port))
            .header("Authorization", &self.client.authorization).header("Accept", "application/json")
            .header("Cookie", &cookies)
            .header("Connection", "close").header("Content-Type", format!("multipart/form-data; boundary={boundary}"))
            .send(body).map_err(|_| "The reading engine did not confirm the extension update.")?;
        let mut bytes = Vec::new();
        response.body_mut().as_reader().take(MAX_RESPONSE + 1).read_to_end(&mut bytes)
            .map_err(|_| "Could not read extension update result.")?;
        if response.status().as_u16() != 200 || bytes.len() as u64 > MAX_RESPONSE { return Err("The reading engine rejected the extension update."); }
        let result: Value = serde_json::from_slice(&bytes).map_err(|_| "Invalid extension update result.")?;
        if result.get("errors").is_some_and(|v| !v.is_null()) { return Err("The reading engine rejected the extension update."); }
        let extension = &result["data"]["installExternalExtension"]["extension"];
        if extension["pkgName"] != review.package || extension["isInstalled"] != true
            || extension["versionName"] != review.manifest.version_name || number(&extension["versionCodeLong"])? != review.manifest.version_code {
            return Err("The extension update result did not match the reviewed package.");
        }
        Ok(extension.clone())
    }

    fn extension_upload_session(&self) -> Result<String, &'static str> {
        verify_listener(self.client.port, self.client.owner_pid)?;
        let mut response = self.client.agent.post(format!("http://127.0.0.1:{}/api/graphql", self.client.port))
            .header("Authorization", &self.client.authorization).header("Accept", "application/json")
            .header("Connection", "close").header("Content-Type", "application/json")
            .send(json!({"query": ReadOperation::Status.query(), "variables": {}}).to_string())
            .map_err(|_| "Could not establish an authenticated extension upload session.")?;
        if response.status().as_u16() != 200 { return Err("The reading engine rejected extension upload authentication."); }
        let mut headers = Vec::new();
        for value in response.headers().get_all("set-cookie").iter() {
            if headers.len() >= 2 { return Err("The reading engine returned an invalid extension upload session."); }
            headers.push(value.to_str().map_err(|_| "The reading engine returned an invalid extension upload session.")?);
        }
        let cookies = upload_session_cookies(headers)?;
        let mut bytes = Vec::new();
        response.body_mut().as_reader().take(8193).read_to_end(&mut bytes)
            .map_err(|_| "Could not verify the extension upload session.")?;
        if bytes.len() > 8192 { return Err("The extension upload session response exceeded its limit."); }
        let body = serde_json::from_slice(&bytes).map_err(|_| "Invalid extension upload session response.")?;
        decode(ReadOperation::Status, Reply { status: 200, challenge: false, body })?;
        Ok(cookies)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::tests::FixtureStore;

    const ORIGINAL_SOURCE_PREFERENCE: &str = "tsugi-ci-original-source-preference";
    const UPDATED_SOURCE_PREFERENCE: &str = "tsugi-ci-v2-source-preference";

    // Fixed, test-only documents. The production bridge exposes no preference
    // document or arbitrary setting write. Never print preference responses.
    fn fixture_source_preference(managed: &ReadRuntime) -> Value {
        managed.client.document(
            "query TsugiFixtureSourcePreference($id: LongString!) { source(id: $id) { id preferences { __typename ... on EditTextPreference { key currentValue } } } }",
            "source", json!({"id": "12345"}),
        ).expect("read the original configurable source setting")
    }

    fn fixture_preference_matches(value: &Value, expected: &str) -> bool {
        value["preferences"].as_array().is_some_and(|preferences| preferences.len() == 1
            && preferences[0]["__typename"] == "EditTextPreference"
            && preferences[0]["key"] == "fixture_secret"
            && preferences[0]["currentValue"] == expected)
    }

    fn seed_fixture_source_preference(managed: &ReadRuntime, value: &str) {
        // Source.setSourcePreference requires the positional screen to be
        // initialized by an earlier source.preferences query.
        let source = fixture_source_preference(managed);
        assert!(source["id"] == "12345" && source["preferences"].as_array().is_some_and(|rows| rows.len() == 1),
            "the original source must expose exactly one authored setting");
        let result = managed.client.document(
            "mutation TsugiFixtureSetSourcePreference($input: UpdateSourcePreferenceInput!) { updateSourcePreference(input: $input) { preferences { __typename ... on EditTextPreference { key currentValue } } } }",
            "updateSourcePreference", json!({"input": {"source": "12345", "change": {"position": 0, "editTextState": value}}}),
        ).expect("set only the synthetic original source value");
        assert!(fixture_preference_matches(&result, value), "the runtime must acknowledge the synthetic setting without exposing its value");
    }

    fn fixture_preference_file(path: &Path) -> Option<Vec<u8>> {
        let file = match fs::File::open(path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return None,
            Err(_) => panic!("could not read the isolated source preference fixture"),
        };
        let mut bytes = Vec::new();
        file.take(16 * 1024 + 1).read_to_end(&mut bytes).expect("read bounded original source setting");
        assert!(bytes.len() <= 16 * 1024, "the authored settings fixture must remain bounded");
        Some(bytes)
    }

    fn fixture_xml_contains(bytes: &[u8], value: &str) -> bool {
        bytes.starts_with(b"<?xml") && bytes.windows(b"</properties>".len()).any(|part| part == b"</properties>")
            && bytes.windows(value.len()).any(|part| part == value.as_bytes())
    }

    fn wait_for_fixture_preference(path: &Path, value: &str) -> Vec<u8> {
        // Preference.saveNewValue uses asynchronous apply(). A GraphQL reply
        // alone is not evidence that the real settings XML reached disk.
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if let Some(bytes) = fixture_preference_file(path) {
                if fixture_xml_contains(&bytes, value) { return bytes; }
            }
            assert!(Instant::now() < deadline, "the JVM did not persist the synthetic preference within the bounded wait");
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    #[test]
    fn extension_upload_cookies_accept_only_the_pinned_private_session_pair() {
        const SESSION: &str = "JSESSIONID=node0123456789.node0; Path=/; HttpOnly; SameSite=Strict";
        const CSRF: &str = "suwayomi-basic-csrf=123e4567-e89b-42d3-a456-426614174000; Path=/; HttpOnly; SameSite=Strict";
        let expected = "JSESSIONID=node0123456789.node0; suwayomi-basic-csrf=123e4567-e89b-42d3-a456-426614174000";
        assert_eq!(upload_session_cookies([SESSION, CSRF]).unwrap(), expected);
        assert_eq!(upload_session_cookies([CSRF, SESSION]).unwrap(), expected);
        for missing_or_duplicate in [vec![], vec![SESSION], vec![CSRF], vec![SESSION, SESSION], vec![CSRF, CSRF], vec![SESSION, CSRF, SESSION]] {
            assert!(upload_session_cookies(missing_or_duplicate).is_err(), "session pair must be complete and unique");
        }
        let invalid_sessions = [
            SESSION.replace("node0123456789.node0", ""),
            SESSION.replace("node0123456789.node0", &"a".repeat(257)),
            SESSION.replace("node0123456789.node0", "bad value"),
            SESSION.replace("node0123456789.node0", "bad,value"),
            SESSION.replace("node0123456789.node0", "bad=value"),
            SESSION.replace("node0123456789.node0", "bad\r\nvalue"),
            SESSION.replace("JSESSIONID", "another-session"),
            SESSION.replace("Path=/", "Path=/api"),
            SESSION.replace("HttpOnly", "Secure"),
            SESSION.replace("SameSite=Strict", "SameSite=Lax"),
            format!("{SESSION}; Domain=127.0.0.1"),
            format!("{SESSION}; Secure"),
            format!("{SESSION}; Max-Age=3600"),
            format!("{SESSION}; Expires=Wed, 01 Jan 2031 00:00:00 GMT"),
            format!("{SESSION}; Path=/"),
            format!("{SESSION}; HttpOnly"),
            format!("{SESSION}; SameSite=Strict"),
            format!("{SESSION}; Unknown=value"),
            format!("{SESSION}{}", " ".repeat(1024)),
        ];
        for invalid in &invalid_sessions {
            assert!(upload_session_cookies([invalid.as_str(), CSRF]).is_err(), "unsafe cookie syntax or scope must be rejected");
        }
        for invalid in [
            CSRF.replace("123e4567-e89b-42d3-a456-426614174000", "arbitrary-token"),
            CSRF.replace("123e4567-e89b-42d3-a456-426614174000", "123e4567_e89b_42d3_a456_426614174000"),
            CSRF.replace("123e4567", "123z4567"),
        ] {
            assert!(upload_session_cookies([SESSION, invalid.as_str()]).is_err(), "CSRF token must have the runtime UUID shape");
        }
    }

    #[test]
    fn update_manifest_requires_exact_package_and_numeric_upgrade() {
        let installed = json!({"pkgName": "org.tsugi.fixture", "versionCodeLong": 9});
        let mut manifest = Manifest { package: "org.tsugi.fixture".into(), version_name: "1.6.10".into(), version_code: 10, source_class: ".FixtureSource".into() };
        assert!(validate_manifest(&manifest, &installed).is_ok());
        manifest.version_code = 9;
        assert!(validate_manifest(&manifest, &installed).is_err());
        manifest.version_code = 8;
        assert!(validate_manifest(&manifest, &installed).is_err());
        manifest.version_code = 10;
        manifest.package = "org.tsugi.other".into();
        assert!(validate_manifest(&manifest, &installed).is_err());
        manifest.package = "org.tsugi.fixture".into();
        manifest.version_name = "1.7.10".into();
        assert!(validate_manifest(&manifest, &installed).is_err());
    }

    #[test]
    fn update_source_inventory_requires_complete_unique_exact_longs() {
        let record = json!({"source": {"nodes": [{"id": "-9223372036854775808"}], "totalCount": 1}});
        assert_eq!(source_ids(&record).unwrap().into_iter().next().unwrap(), "-9223372036854775808");
        assert!(source_ids(&json!({"source": {"nodes": [], "totalCount": 1}})).is_err());
        assert!(source_ids(&json!({"source": {"nodes": [{"id": "7"}, {"id": "7"}], "totalCount": 2}})).is_err());
        assert!(source_ids(&json!({"source": {"nodes": [{"id": 7}], "totalCount": 1}})).is_err());
    }

    #[test]
    fn update_review_normalizes_only_source_order() {
        let record = json!({"pkgName": "org.tsugi.fixture", "versionName": "1.6.1",
            "source": {"nodes": [{"id": "12345"}, {"id": "-9223372036854775808"}], "totalCount": 2}});
        let mut reordered = record.clone();
        reordered["source"]["nodes"].as_array_mut().unwrap().reverse();
        assert_eq!(canonical_extension_record(record.clone()).unwrap(), canonical_extension_record(reordered.clone()).unwrap());
        let mut changed_id = reordered.clone();
        changed_id["source"]["nodes"][0]["id"] = json!("54321");
        assert_ne!(canonical_extension_record(record.clone()).unwrap(), canonical_extension_record(changed_id).unwrap());
        reordered["versionName"] = json!("1.6.2");
        assert_ne!(canonical_extension_record(record).unwrap(), canonical_extension_record(reordered).unwrap());
    }

    #[test]
    fn update_inventory_rejects_unloadable_or_misowned_sources() {
        let installed = json!({"pkgName": "org.tsugi.fixture", "source": {"nodes": [{"id": "12345"}], "totalCount": 1}});
        let complete = json!({"nodes": [
            {"id": "12345", "extension": {"pkgName": "org.tsugi.fixture"}},
            {"id": "-9223372036854775808", "extension": {"pkgName": "org.tsugi.other"}}
        ], "totalCount": 2});
        assert_eq!(verified_source_ids(&installed, &complete).unwrap(), BTreeSet::from(["12345".to_owned()]));
        let mut hidden = complete.clone();
        hidden["totalCount"] = json!(3);
        assert!(verified_source_ids(&installed, &hidden).is_err(), "DB sources absent from the loaded list cannot be ignored");
        let mut changed_owner = complete.clone();
        changed_owner["nodes"][0]["extension"]["pkgName"] = json!("org.tsugi.other");
        assert!(verified_source_ids(&installed, &changed_owner).is_err());
        let mut duplicate = complete;
        duplicate["nodes"][1]["id"] = json!("12345");
        assert!(verified_source_ids(&installed, &duplicate).is_err());
    }

    #[test]
    #[ignore = "requires the pinned Windows runtime and original versioned CI fixtures"]
    fn packaged_runtime_extension_update() {
        let runtime = PathBuf::from(std::env::var_os("TSUGI_READ_RUNTIME").unwrap());
        let data = PathBuf::from(std::env::var_os("TSUGI_READ_FIXTURE").unwrap()).join("extension-update");
        assert!(!data.try_exists().expect("inspect isolated extension update fixture root"), "extension update requires a fresh isolated directory");
        let fixture = |version| fs::read(runtime.join(format!("test-fixtures/tsugi-fixture-v1.6.{version}.jar"))).unwrap();
        let store = FixtureStore::with_jar(Some(fixture(1)));
        let mut managed = ReadRuntime::start(&runtime, &data).expect("start update fixture");
        managed.add_store_inner(&store.url).expect("register authored loopback fixture");
        managed.refresh_extensions().unwrap();
        managed.mutate_extension("org.tsugi.fixture", true).expect("install original v1 fixture");
        let catalogue = managed.catalogue("12345", 1, CatalogueMode::Popular).unwrap();
        let manga = number(&catalogue["mangas"][0]["id"]).unwrap() as i32;
        managed.set_library(manga, true).unwrap();
        let details = managed.manga(manga).expect("original cached chapter without network");
        let chapter = number(&details["chapters"][0]["id"]).unwrap() as i32;
        managed.update_chapter_flags(&[chapter], Some(true), Some(true)).unwrap();
        let category = managed.save_category(None, "Update fixture").unwrap();
        let category_id = number(&category["category"]["id"]).unwrap() as i32;
        managed.assign_category(manga, category_id, true).unwrap();

        let preference_file = data.join("settings/source_12345.xml");
        let new_preference_file = data.join("settings/source_54321.xml");
        assert!(fixture_preference_matches(&fixture_source_preference(&managed), ""), "the new authored source starts with its empty setting");
        seed_fixture_source_preference(&managed, ORIGINAL_SOURCE_PREFERENCE);
        let original_preference_hash = digest(&wait_for_fixture_preference(&preference_file, ORIGINAL_SOURCE_PREFERENCE));
        managed.shutdown().unwrap();
        drop(managed);
        managed = ReadRuntime::start(&runtime, &data).expect("restart the runtime after flushing the authored setting");
        assert!(fixture_preference_matches(&fixture_source_preference(&managed), ORIGINAL_SOURCE_PREFERENCE),
            "a fresh JVM must read the synthetic setting from its real XML store");
        assert!(digest(&fixture_preference_file(&preference_file).unwrap()) == original_preference_hash,
            "reading the saved source setting must preserve its exact bytes");
        assert!(!new_preference_file.try_exists().unwrap(), "the incompatible source must not exist before updating");

        // A harmless multipart status request proves the engine still enforces
        // its CSRF guard. This sends no file and performs no extension change.
        verify_listener(managed.client.port, managed.client.owner_pid).unwrap();
        let operation = json!({"query": ReadOperation::Status.query(), "variables": {}});
        let probe = format!("--TsugiCsrfProbe\r\nContent-Disposition: form-data; name=\"operations\"\r\n\r\n{operation}\r\n--TsugiCsrfProbe\r\nContent-Disposition: form-data; name=\"map\"\r\n\r\n{{}}\r\n--TsugiCsrfProbe--\r\n");
        let response = managed.client.agent.post(format!("http://127.0.0.1:{}/api/graphql", managed.client.port))
            .header("Authorization", &managed.client.authorization).header("Accept", "application/json")
            .header("Connection", "close").header("Content-Type", "multipart/form-data; boundary=TsugiCsrfProbe")
            .send(probe).expect("probe fixed multipart authentication contract");
        assert_eq!(response.status().as_u16(), 401, "Basic-only multipart must retain the runtime CSRF guard");
        drop(response);
        eprintln!("PASS: Basic-only multipart status request was rejected by the runtime CSRF guard.");

        store.replace_jar(2, fixture(2));
        managed.refresh_extensions().unwrap();
        let installed = managed.extension_record("org.tsugi.fixture").unwrap();
        assert_eq!(installed["hasUpdate"], true);
        assert_eq!(installed["versionName"], "1.6.1");
        assert!(managed.review_extension_update("org.tsugi.fixture").is_err(), "production rejects loopback repositories");
        let source_ids = source_ids(&installed).unwrap();
        let before = managed.update_invariants(&source_ids).unwrap();
        let review = managed.build_update_review(installed.clone(), managed.update_store(&installed).unwrap(), fixture(2)).unwrap();
        assert!(review.description().contains("Installed repository provenance is unknown"));
        assert_eq!(review.manifest.version_name, "1.6.2");
        let collision = data.join("extensions").join(format!("tsugi-update-{}-v1.6.2.jar", review.sha256));
        let mut occupied = fs::OpenOptions::new().write(true).create_new(true).open(&collision).unwrap();
        occupied.write_all(b"original conflicting fixture").unwrap();
        drop(occupied);
        assert!(managed.apply_update_with_checkpoint(review).is_err(), "a stale artifact cannot be reused by the runtime");
        assert_eq!(fs::read(&collision).unwrap(), b"original conflicting fixture");
        assert_eq!(managed.extension_record("org.tsugi.fixture").unwrap()["versionName"], "1.6.1");
        assert!(!data.join("extension-recovery/pending").exists(), "collision is rejected before checkpoint or mutation");
        fs::remove_file(collision).unwrap();
        let review = managed.build_update_review(installed.clone(), managed.update_store(&installed).unwrap(), fixture(2)).unwrap();
        // Only this test bypasses public HTTPS fetching, with authored local
        // bytes. The production method cannot accept this private capability.
        let result = managed.apply_update_with_checkpoint(review).expect("apply original v2 fixture");
        assert_eq!(result["status"], "updated", "{}", result["error"].as_str().unwrap_or("No broker error was returned."));
        assert_eq!(result["sha256"], result["installedSha256"]);
        assert_eq!(result["inputFormat"], "jar");
        assert!(result["checkpointId"].is_string());
        assert_eq!(managed.extension_record("org.tsugi.fixture").unwrap()["versionName"], "1.6.2");
        assert_eq!(managed.update_invariants(&source_ids).unwrap(), before);
        assert!(fixture_preference_matches(&fixture_source_preference(&managed), ORIGINAL_SOURCE_PREFERENCE),
            "a successful update must preserve existing source settings");
        assert!(digest(&fixture_preference_file(&preference_file).unwrap()) == original_preference_hash,
            "the successful v2 update must preserve the existing settings file");
        let v2_artifact_hash = managed.installed_artifact_hash(&managed.extension_record("org.tsugi.fixture").unwrap()).unwrap();

        // Change the authored value under v2 so recovery must use the latest
        // checkpoint, rather than accidentally replaying the earlier v1 copy.
        seed_fixture_source_preference(&managed, UPDATED_SOURCE_PREFERENCE);
        let v2_preference_hash = digest(&wait_for_fixture_preference(&preference_file, UPDATED_SOURCE_PREFERENCE));
        assert!(v2_preference_hash != original_preference_hash, "v2 has an independently changed synthetic setting");

        store.replace_jar(3, fixture(3));
        managed.refresh_extensions().unwrap();
        let installed = managed.extension_record("org.tsugi.fixture").unwrap();
        let mut review = managed.build_update_review(installed.clone(), managed.update_store(&installed).unwrap(), fixture(3)).unwrap();
        review.artifact.push(0);
        assert!(managed.recheck_update(&review).is_err(), "changed bytes invalidate capability");
        let review = managed.build_update_review(installed.clone(), managed.update_store(&installed).unwrap(), fixture(3)).unwrap();
        let result = managed.apply_update_with_checkpoint(review).expect("recover incompatible source update");
        assert_eq!(result["status"], "rolled-back");
        assert_eq!(result["error"], "The update changed a saved source, library or progress identity.");
        assert_eq!(managed.extension_record("org.tsugi.fixture").unwrap()["versionName"], "1.6.2");
        assert!(managed.installed_artifact_hash(&managed.extension_record("org.tsugi.fixture").unwrap()).unwrap() == v2_artifact_hash,
            "rollback must restore the exact successful v2 artifact");
        assert_eq!(managed.update_invariants(&source_ids).unwrap(), before);
        let recovery = data.join("extension-recovery/pending");
        let displaced_old = fixture_preference_file(&recovery.join("displaced/settings/source_12345.xml"))
            .expect("retain evidence of the actual v3 existing-setting write");
        let displaced_new = fixture_preference_file(&recovery.join("displaced/settings/source_54321.xml"))
            .expect("retain evidence of the actual v3 new-setting write");
        assert!(fixture_xml_contains(&displaced_old, "tsugi-ci-rejected-old-source-preference"),
            "the loaded v3 must have really changed the old source setting before rollback");
        assert!(fixture_xml_contains(&displaced_new, "tsugi-ci-rejected-new-source-preference"),
            "the loaded v3 must have really created a new source settings file before rollback");
        assert!(digest(&fixture_preference_file(&recovery.join("snapshot/settings/source_12345.xml")).unwrap()) == v2_preference_hash,
            "the recovery snapshot must contain the latest v2 settings bytes");
        assert!(digest(&fixture_preference_file(&preference_file).unwrap()) == v2_preference_hash,
            "rollback must restore the exact old source settings file");
        assert!(!new_preference_file.try_exists().unwrap(), "rollback must remove a settings file absent from the checkpoint");
        assert!(fixture_preference_matches(&fixture_source_preference(&managed), UPDATED_SOURCE_PREFERENCE),
            "the recovered JVM must expose the restored v2 source value");
        assert!(managed.catalogue("12345", 1, CatalogueMode::Popular).is_ok(), "restored executable source works");
        managed.shutdown().unwrap();
        drop(managed);
        let mut managed = ReadRuntime::start(&runtime, &data).unwrap();
        assert_eq!(managed.extension_record("org.tsugi.fixture").unwrap()["versionName"], "1.6.2");
        assert!(managed.installed_artifact_hash(&managed.extension_record("org.tsugi.fixture").unwrap()).unwrap() == v2_artifact_hash,
            "the restored v2 artifact must survive another restart");
        assert_eq!(managed.update_invariants(&source_ids).unwrap(), before);
        assert!(fixture_preference_matches(&fixture_source_preference(&managed), UPDATED_SOURCE_PREFERENCE),
            "the restored source value must survive another JVM restart");
        assert!(digest(&fixture_preference_file(&preference_file).unwrap()) == v2_preference_hash,
            "the restored settings bytes must survive another JVM restart");
        assert!(!new_preference_file.try_exists().unwrap(), "the rejected source's new file must remain absent after restart");
        managed.shutdown().unwrap();
        drop(managed);
        fs::remove_dir_all(data).unwrap();
        eprintln!("PASS: exact reviewed v2 update preserved source/library/chapter/category state and real JVM settings; incompatible v3 settings writes were proven, rolled back exactly, and restored v2 state survived restart.");
    }
}
