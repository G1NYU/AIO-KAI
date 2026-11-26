//! Explicit, native-reviewed source settings. No text credentials, raw keys,
//! positional writes or list values cross the page bridge.
use super::*;
use crate::bridge::SourcePreferenceValue;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

const INVALID: &str = "These source settings could not be verified.";
const STALE: &str = "The source settings review expired or changed. Load settings again.";
const UNSUPPORTED: &str = "This source setting cannot be changed in Tsugi.";
const RECOVERY: &str = "Source settings recovery is pending. Restart Tsugi before changing settings again.";
const LIFETIME: Duration = Duration::from_secs(10 * 60);
const SCREEN_QUERY: &str = "query TsugiSourcePreferences($id: LongString!) { source(id: $id) { id name isConfigurable extension { pkgName } preferences { __typename ... on SwitchPreference { key title visible enabled boolValue: currentValue boolDefault: default } ... on CheckBoxPreference { key title visible enabled boolValue: currentValue boolDefault: default } ... on ListPreference { key title visible enabled listValue: currentValue listDefault: default entries entryValues } ... on EditTextPreference { key title visible enabled } ... on MultiSelectListPreference { key title visible enabled } } } }";

struct Control { id: String, position: usize, kind: &'static str, enabled: bool, title: String, value: Option<Value>, options: Option<Vec<String>>, reason: Option<&'static str> }

pub struct SourcePreferencesReview {
    id: String, source: String, name: String, extension_name: String, version_name: String,
    package: String, identity: Value, artifact: String, sources: BTreeSet<String>,
    screen: Vec<Value>, controls: Vec<Control>, settings: BTreeMap<String, String>,
    created: Instant, pid: u32, port: u16,
}

pub struct SourcePreferenceChangeReview {
    preview: SourcePreferencesReview, control_id: String, position: usize, field: &'static str,
    desired: Value, stored: String, description: String,
}

impl SourcePreferencesReview {
    pub fn id(&self) -> &str { &self.id }
    pub fn preview(&self) -> Value {
        let controls = self.controls.iter().map(|control| {
            let mut value = json!({"id": control.id, "title": control.title, "kind": control.kind, "enabled": control.enabled});
            if let Some(current) = &control.value { value["value"] = current.clone(); }
            if let Some(options) = &control.options { value["options"] = json!(options); }
            if let Some(reason) = control.reason { value["reason"] = json!(reason); }
            value
        }).collect::<Vec<_>>();
        json!({"reviewId": self.id, "sourceId": self.source, "sourceName": self.name,
            "extensionName": self.extension_name, "versionName": self.version_name, "controls": controls})
    }
}

impl SourcePreferenceChangeReview {
    pub fn description(&self) -> &str { &self.description }
}

fn capability() -> Result<String, &'static str> {
    let mut bytes = [0u8; 16]; getrandom::fill(&mut bytes).map_err(|_| INVALID)?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn label(value: &Value, limit: usize) -> Result<&str, &'static str> {
    source_inventory_text(value, limit).map_err(|_| INVALID)
}

fn screen_controls(screen: &[Value]) -> Result<Vec<Control>, &'static str> {
    if screen.len() > 100 { return Err(INVALID); }
    let mut keys = BTreeSet::new(); let mut result = Vec::new();
    for (position, row) in screen.iter().enumerate() {
        let kind = match row["__typename"].as_str() {
            Some("SwitchPreference") => "switch", Some("CheckBoxPreference") => "checkbox",
            Some("ListPreference") => "select", Some("EditTextPreference" | "MultiSelectListPreference") => "unsupported",
            _ => return Err(INVALID),
        };
        let visible = row["visible"].as_bool().ok_or(INVALID)?;
        let allowed = row["enabled"].as_bool().ok_or(INVALID)?;
        let key = match row.get("key") {
            Some(Value::Null) => None,
            Some(value) => Some(label(value, 512)?),
            None => return Err(INVALID),
        };
        if let Some(key) = key.filter(|key| !key.is_empty()) { if !keys.insert(key) { return Err(INVALID); } }
        let title = match row.get("title") {
            Some(Value::Null) => "Untitled setting",
            Some(value) => label(value, 200)?,
            None => return Err(INVALID),
        };
        let mut value = None; let mut options = None;
        let mut reason = if kind == "unsupported" { Some("unsupported-type") }
            else if !allowed { Some("disabled") } else if key.is_none_or(str::is_empty) { Some("missing-key") } else { None };
        if kind == "switch" || kind == "checkbox" {
            if !row["boolDefault"].is_boolean() { return Err(INVALID); }
            if let Some(current) = row["boolValue"].as_bool() { value = Some(json!(current)); }
            else { reason.get_or_insert("unavailable-value"); }
        } else if kind == "select" {
            let entries = row["entries"].as_array().ok_or(INVALID)?;
            let values = row["entryValues"].as_array().ok_or(INVALID)?;
            let parsed = (|| {
                if entries.is_empty() || entries.len() > 64 || entries.len() != values.len() { return Err(INVALID); }
                let labels = entries.iter().map(|entry| label(entry, 200).map(str::to_owned)).collect::<Result<Vec<_>, _>>()?;
                if labels.iter().any(|label| label.trim().is_empty()) { return Err(INVALID); }
                let values = values.iter().map(|entry| label(entry, 4096)).collect::<Result<Vec<_>, _>>()?;
                if values.iter().copied().collect::<BTreeSet<_>>().len() != values.len() { return Err(INVALID); }
                let current = row["listValue"].as_str().and_then(|current| values.iter().position(|value| *value == current)).ok_or(INVALID)?;
                if let Some(default) = row["listDefault"].as_str() {
                    if !values.contains(&default) { return Err(INVALID); }
                } else if !row["listDefault"].is_null() { return Err(INVALID); }
                Ok((labels, current))
            })();
            match parsed {
                Ok((labels, current)) => { value = Some(json!(current)); options = Some(labels); }
                Err(_) => { reason.get_or_insert("invalid-options"); }
            }
        }
        if visible {
            result.push(Control { id: capability()?, position, kind, enabled: reason.is_none(), title: title.into(), value, options, reason });
        }
    }
    Ok(result)
}

fn installed_identity(record: &Value) -> Result<Value, &'static str> {
    if record["isInstalled"] != true { return Err(STALE); }
    let metadata = extension_metadata(record).map_err(|_| INVALID)?;
    let mut ids = record["source"]["nodes"].as_array().ok_or(INVALID)?.iter().map(|row|
        metadata_i64(&row["id"]).map(|id| id.to_string()).ok_or(INVALID)).collect::<Result<Vec<_>, _>>()?;
    if record["source"]["totalCount"].as_u64() != Some(ids.len() as u64) { return Err(INVALID); }
    ids.sort();
    Ok(json!({"pkgName": metadata["pkgName"], "versionName": metadata["versionName"], "versionCodeLong": metadata["versionCodeLong"],
        "apkName": label(&record["apkName"], 220)?, "sources": ids}))
}

// The shared-preference tree is private and small. Keep both original bytes and
// candidate-only paths out of the bridge; hashes are operation-local only.
fn settings_files(root: &Path) -> Result<BTreeMap<String, String>, &'static str> {
    let user = private_storage::CurrentUser::get()?;
    fn walk(path: &Path, relative: &str, user: &private_storage::CurrentUser, result: &mut BTreeMap<String, String>, bytes: &mut u64, depth: usize) -> Result<(), &'static str> {
        use std::os::windows::fs::MetadataExt;
        if result.len() >= 2000 || depth > 16 { return Err(INVALID); }
        let meta = match fs::symlink_metadata(path) {
            Ok(meta) => meta,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && relative.is_empty() => return Ok(()),
            Err(_) => return Err(INVALID),
        };
        if meta.file_type().is_symlink() || meta.file_attributes() & 0x400 != 0 || (!meta.is_dir() && !meta.is_file()) { return Err(INVALID); }
        user.verify_descendant(path, meta.is_dir())?;
        if meta.is_dir() {
            result.insert(relative.into(), "directory".into());
            for child in fs::read_dir(path).map_err(|_| INVALID)? {
                let child = child.map_err(|_| INVALID)?;
                let name = child.file_name().into_string().map_err(|_| INVALID)?;
                if name.is_empty() || name.len() > 255 || name.chars().any(|ch| ch.is_control() || matches!(ch, '/' | '\\' | ':')) { return Err(INVALID); }
                let relative = if relative.is_empty() { name } else { format!("{relative}/{name}") };
                walk(&child.path(), &relative, user, result, bytes, depth + 1)?;
            }
        } else {
            *bytes = bytes.checked_add(meta.len()).ok_or(INVALID)?;
            if meta.len() > 1024 * 1024 || *bytes > 16 * 1024 * 1024 { return Err(INVALID); }
            let mut data = Vec::new(); fs::File::open(path).map_err(|_| INVALID)?.take(1024 * 1024 + 1).read_to_end(&mut data).map_err(|_| INVALID)?;
            if data.len() as u64 != meta.len() { return Err(INVALID); }
            result.insert(relative.into(), format!("{:x}", Sha256::digest(data)));
        }
        Ok(())
    }
    let mut result = BTreeMap::new(); walk(root, "", &user, &mut result, &mut 0, 0)?; Ok(result)
}

fn expected_settings_files(before: &BTreeMap<String, String>, after: &BTreeMap<String, String>, source: &str) -> bool {
    let target = format!("source_{source}.xml");
    let without_target = |files: &BTreeMap<String, String>| files.iter().filter(|(name, _)| !name.is_empty() && **name != target)
        .map(|(name, hash)| (name.clone(), hash.clone())).collect::<BTreeMap<_, _>>();
    after.contains_key(&target) && without_target(before) == without_target(after)
}

impl ReadRuntime {
    fn source_settings_files(&self, snapshot: bool) -> Result<BTreeMap<String, String>, &'static str> {
        let user = private_storage::CurrentUser::get()?;
        user.verify(&self.data_path, true)?;
        if snapshot {
            // Check each fixed ancestor itself before traversing the private
            // snapshot; checking only its settings child could miss a junction.
            for path in ["extension-recovery", "extension-recovery/pending", "extension-recovery/pending/snapshot"] {
                user.verify_descendant(&self.data_path.join(path), true)?;
            }
        }
        settings_files(&self.data_path.join(if snapshot { "extension-recovery/pending/snapshot/settings" } else { "settings" }))
    }

    fn preference_screen(&self, source: &str) -> Result<(Value, Vec<Value>), &'static str> {
        let value = self.client.document(SCREEN_QUERY, "source", json!({"id": source})).map_err(|_| INVALID)?;
        if value["id"] != source || value["isConfigurable"] != true { return Err(INVALID); }
        let screen = value["preferences"].as_array().filter(|rows| rows.len() <= 100).ok_or(INVALID)?.clone();
        screen_controls(&screen)?;
        Ok((value, screen))
    }

    pub fn load_source_preferences(&self, source: &str) -> Result<SourcePreferencesReview, &'static str> {
        if source == "0" || source.parse::<i64>().ok().is_none_or(|id| id.to_string() != source) { return Err(INVALID); }
        let (value, screen) = self.preference_screen(source)?;
        let package = label(&value["extension"]["pkgName"], 200)?.to_owned(); extension_package(&package)?;
        let record = self.extension_record(&package)?;
        let identity = installed_identity(&record)?;
        let sources = self.verified_extension_sources(&record)?;
        if !sources.contains(source) { return Err(INVALID); }
        Ok(SourcePreferencesReview { id: capability()?, source: source.into(), name: label(&value["name"], 500)?.into(),
            extension_name: label(&record["name"], 500)?.into(), version_name: label(&record["versionName"], 200)?.into(),
            artifact: self.installed_artifact_hash(&record)?, package, identity, sources,
            controls: screen_controls(&screen)?, screen, settings: self.source_settings_files(false)?,
            created: Instant::now(), pid: self.client.owner_pid, port: self.client.port })
    }

    fn recheck_source_preferences(&self, review: &SourcePreferencesReview, require_process: bool, expected: Option<(usize, &'static str, &Value)>) -> Result<(), &'static str> {
        if require_process && (review.created.elapsed() > LIFETIME || review.pid != self.client.owner_pid || review.port != self.client.port) { return Err(STALE); }
        let record = self.extension_record(&review.package)?;
        if installed_identity(&record)? != review.identity || self.installed_artifact_hash(&record)? != review.artifact
            || self.verified_extension_sources(&record)? != review.sources { return Err(STALE); }
        let (value, screen) = self.preference_screen(&review.source)?;
        let mut expected_screen = review.screen.clone();
        if let Some((position, field, value)) = expected { expected_screen[position][field] = value.clone(); }
        if value["extension"]["pkgName"] != review.package || screen != expected_screen { return Err(STALE); }
        Ok(())
    }

    pub fn review_source_preference_change(&self, preview: SourcePreferencesReview, control_id: &str, value: SourcePreferenceValue) -> Result<SourcePreferenceChangeReview, &'static str> {
        self.source_preferences_idle()?;
        self.recheck_source_preferences(&preview, true, None)?;
        if self.source_settings_files(false)? != preview.settings { return Err(STALE); }
        let control = preview.controls.iter().find(|control| control.id == control_id && control.enabled).ok_or(UNSUPPORTED)?;
        let (field, desired, stored, display) = match (control.kind, value) {
            ("switch" | "checkbox", SourcePreferenceValue::Bool(value)) => ("boolValue", json!(value), value.to_string(), if value { "On".into() } else { "Off".into() }),
            ("select", SourcePreferenceValue::Choice(index)) => {
                let label = control.options.as_ref().and_then(|options| options.get(index as usize)).ok_or(UNSUPPORTED)?.clone();
                let raw = preview.screen[control.position]["entryValues"][index as usize].as_str().ok_or(INVALID)?.to_owned();
                ("listValue", json!(raw), raw, label)
            }
            _ => return Err(UNSUPPORTED),
        };
        if preview.screen[control.position][field] == desired { return Err("The selected source setting has not changed."); }
        let position = control.position;
        let description = format!("Change this source setting?\n\nSource: {}\nExtension: {} ({})\nSetting: {}\nNew selection: {}\n\nReader will restart to verify the saved change. A private recovery copy protects the previous settings and reading state.",
            preview.name, preview.extension_name, preview.version_name, control.title, display);
        Ok(SourcePreferenceChangeReview { preview, control_id: control_id.into(), position, field, desired, stored, description })
    }

    fn all_preference_sources(&self) -> Result<BTreeSet<String>, &'static str> {
        let value = self.client.document("query TsugiPreferenceSources { sources(first: 1001, order: [{ by: ID, byType: ASC }]) { nodes { id } totalCount } }", "sources", json!({}))?;
        let rows = value["nodes"].as_array().ok_or(INVALID)?;
        if rows.len() > 1000 || value["totalCount"].as_u64() != Some(rows.len() as u64) { return Err(INVALID); }
        let ids = rows.iter().map(|row| metadata_i64(&row["id"]).map(|id| id.to_string()).ok_or(INVALID)).collect::<Result<BTreeSet<_>, _>>()?;
        if ids.len() != rows.len() { return Err(INVALID); } Ok(ids)
    }

    fn source_preferences_idle(&self) -> Result<(), &'static str> {
        let settings = self.client.document("query TsugiPreferenceSchedules { settings { autoDownloadNewChapters globalUpdateInterval } }", "settings", json!({}))?;
        if settings["autoDownloadNewChapters"] != false || settings["globalUpdateInterval"].as_f64() != Some(0.0) {
            return Err("Pause automatic downloads and scheduled library updates before changing source settings.");
        }
        let queue = self.client.document("query TsugiPreferenceQueue { downloadStatus { state queue { chapter { id } } } }", "downloadStatus", json!({}))?;
        if queue["state"] != "STOPPED" || !queue["queue"].as_array().is_some_and(Vec::is_empty)
            || self.library_update_status()?["jobsInfo"]["isRunning"] != false {
            return Err("Wait for downloads and library updates to stop before changing source settings.");
        }
        Ok(())
    }

    fn verify_persisted_preference(&self, change: &SourcePreferenceChangeReview) -> Result<bool, &'static str> {
        let before = self.source_settings_files(true)?;
        let after = self.source_settings_files(false)?;
        if before != change.preview.settings || !expected_settings_files(&before, &after, &change.preview.source) { return Ok(false); }
        let key = change.preview.screen[change.position]["key"].as_str().ok_or(INVALID)?;
        let job = ReadJob::new()?;
        let mut child = Command::new(self.runtime_path.join("jre/bin/java.exe"))
            .arg(format!("-Djava.io.tmpdir={}", self._storage.temp_dir.display()))
            .args(["-Xmx64m", "-cp"]).arg(self.runtime_path.join("launcher"))
            .args(["TsugiReadLauncher", "--verify-source-preference"]).arg(&self.data_path)
            .env_remove("JAVA_TOOL_OPTIONS").env_remove("JDK_JAVA_OPTIONS").env_remove("_JAVA_OPTIONS")
            .creation_flags(NO_WINDOW).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null())
            .spawn().map_err(|_| INVALID)?;
        if let Err(error) = job.attach_and_release(&mut child) { let _ = child.kill(); let _ = child.wait(); return Err(error); }
        let sent = (|| {
            let mut input = child.stdin.take().ok_or(INVALID)?;
            for value in [&change.preview.source, &key.to_owned(), &change.stored] {
                input.write_all(&(value.len() as u32).to_be_bytes()).and_then(|()| input.write_all(value.as_bytes())).map_err(|_| INVALID)?;
            }
            Ok::<_, &'static str>(())
        })();
        if sent.is_err() { drop(job); let _ = child.kill(); let _ = child.wait(); return Err(INVALID); }
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            match child.try_wait() {
                Ok(Some(status)) if status.success() => break,
                Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(25)),
                _ => { drop(job); let _ = child.kill(); let _ = child.wait(); return Err(INVALID); }
            }
        }
        let mut output = Vec::new(); child.stdout.take().ok_or(INVALID)?.take(2).read_to_end(&mut output).map_err(|_| INVALID)?;
        if self.source_settings_files(false)? != after || self.source_settings_files(true)? != before { return Ok(false); }
        match output.as_slice() { b"1" => Ok(true), b"0" => Ok(false), _ => Err(INVALID) }
    }

    pub fn apply_reviewed_source_preference(&mut self, change: SourcePreferenceChangeReview) -> Result<Value, &'static str> {
        self.source_preferences_idle()?;
        self.recheck_source_preferences(&change.preview, true, None)?;
        if self.source_settings_files(false)? != change.preview.settings { return Err(STALE); }
        let sources = self.all_preference_sources()?;
        let state = self.update_invariants(&sources)?;
        self.shutdown()?;
        if self.source_settings_files(false)? != change.preview.settings {
            self.restart_after_stop()?; return Err(STALE);
        }
        let checkpoint = match crate::read_checkpoint::create(&self.data_path) {
            Ok(checkpoint) => checkpoint,
            Err(error) => { self.restart_after_stop()?; return Err(error); }
        };
        let checkpoint_id = checkpoint.id().to_owned();
        let applied = (|| {
            self.restart_after_stop()?;
            self.source_preferences_idle()?;
            self.recheck_source_preferences(&change.preview, false, None)?;
            if self.all_preference_sources()? != sources || self.update_invariants(&sources)? != state { return Err(STALE); }
            if self.source_settings_files(false)? != change.preview.settings { return Err(STALE); }
            let row = &change.preview.screen[change.position];
            let field = match row["__typename"].as_str() {
                Some("SwitchPreference") => "switchState", Some("CheckBoxPreference") => "checkBoxState", Some("ListPreference") => "listState", _ => return Err(UNSUPPORTED),
            };
            let mut mutation = json!({"position": change.position}); mutation[field] = change.desired.clone();
            self.client.document("mutation TsugiSetSourcePreference($input: UpdateSourcePreferenceInput!) { updateSourcePreference(input: $input) { source { id } } }",
                "updateSourcePreference", json!({"input": {"source": change.preview.source, "change": mutation}})).map_err(|_| "The reading engine could not confirm the source setting change.")?;
            let deadline = Instant::now() + Duration::from_secs(5);
            while !self.verify_persisted_preference(&change)? {
                if Instant::now() >= deadline { return Err("The saved source setting or unrelated settings did not match the reviewed change."); }
                std::thread::sleep(Duration::from_millis(100));
            }
            self.shutdown()?;
            if !self.verify_persisted_preference(&change)? { return Err(INVALID); }
            self.restart_after_stop()?;
            self.recheck_source_preferences(&change.preview, false, Some((change.position, change.field, &change.desired)))?;
            if self.all_preference_sources()? != sources || self.update_invariants(&sources)? != state || !self.verify_persisted_preference(&change)? { return Err(INVALID); }
            Ok::<_, &'static str>(())
        })();
        let error = match applied {
            Ok(()) => match checkpoint.commit() {
                Ok(()) => return Ok(json!({"reviewId": change.preview.id, "controlId": change.control_id, "status": "applied", "checkpointId": checkpoint_id})),
                Err(_) => {
                    let _ = self.shutdown();
                    if self.child.try_wait().ok().flatten().is_none() { return Err(RECOVERY); }
                    if crate::read_checkpoint::recover_pending(&self.data_path).map_err(|_| RECOVERY)?.as_deref() != Some(checkpoint_id.as_str()) { return Err(RECOVERY); }
                    "The source setting could not be committed. The previous state was restored."
                }
            },
            Err(error) => {
                let _ = self.shutdown();
                if self.child.try_wait().ok().flatten().is_none() { return Err(RECOVERY); }
                checkpoint.rollback().map_err(|_| RECOVERY)?; error
            }
        };
        let recovered = (|| {
            if self.source_settings_files(false)? != change.preview.settings { return Err(INVALID); }
            self.restart_after_stop()?;
            self.recheck_source_preferences(&change.preview, false, None)?;
            if self.all_preference_sources()? != sources || self.update_invariants(&sources)? != state
                || self.source_settings_files(false)? != change.preview.settings { return Err(INVALID); }
            Ok::<_, &'static str>(())
        })();
        if recovered.is_err() {
            let _ = self.shutdown();
            if self.child.try_wait().ok().flatten().is_none() {
                return Err("Source settings recovery could not be verified. Close and restart Tsugi.");
            }
            return Err("Source settings recovery could not be verified. Reader is stopped. Restart Tsugi.");
        }
        Ok(json!({"reviewId": change.preview.id, "controlId": change.control_id, "status": "rolled-back", "checkpointId": checkpoint_id, "error": error}))
    }
}

#[cfg(test)]
#[path = "read_source_preferences_tests.rs"]
mod tests;

#[cfg(test)]
mod projection_tests {
    use super::*;

    fn rows() -> Vec<Value> {
        vec![
            json!({"__typename":"EditTextPreference","key":"private_key","title":"Text setting","visible":true,"enabled":true}),
            json!({"__typename":"SwitchPreference","key":"hidden","title":"Hidden setting","visible":false,"enabled":true,"boolValue":true,"boolDefault":false}),
            json!({"__typename":"CheckBoxPreference","key":"disabled","title":"Disabled setting","visible":true,"enabled":false,"boolValue":false,"boolDefault":false}),
            json!({"__typename":"SwitchPreference","key":null,"title":"Keyless setting","visible":true,"enabled":true,"boolValue":false,"boolDefault":false}),
            json!({"__typename":"SwitchPreference","key":"original_boolean_key","title":"Boolean setting","visible":true,"enabled":true,"boolValue":false,"boolDefault":true}),
            json!({"__typename":"ListPreference","key":"original_choice_key","title":"Choice setting","visible":true,"enabled":true,"listValue":"private-option-b","listDefault":"private-option-a","entries":["First option","Second option"],"entryValues":["private-option-a","private-option-b"]}),
        ]
    }

    #[test]
    fn preview_keeps_raw_positions_private_and_retains_false_and_choice_index() {
        let screen = rows(); let controls = screen_controls(&screen).unwrap();
        assert_eq!(controls.len(), 5);
        assert_eq!(controls.iter().map(|control| control.position).collect::<Vec<_>>(), [0, 2, 3, 4, 5]);
        assert_eq!(controls.iter().filter(|control| control.enabled).count(), 2);
        assert_eq!(controls[3].value, Some(json!(false)));
        assert_eq!(controls[4].value, Some(json!(1)));
        let review = SourcePreferencesReview { id: capability().unwrap(), source:"12345".into(), name:"Original source".into(),
            extension_name:"Original extension".into(), version_name:"1.6.1".into(), package:"org.tsugi.fixture".into(),
            identity:Value::Null, artifact:String::new(), sources:BTreeSet::new(), screen, controls,
            settings:BTreeMap::new(), created:Instant::now(), pid:1, port:1 };
        let preview = review.preview(); let text = preview.to_string();
        for private in ["private_key", "original_boolean_key", "original_choice_key", "private-option-", "Hidden setting", "position", "boolDefault", "entryValues"] {
            assert!(!text.contains(private), "the public preview excludes private preference identity and values");
        }
        assert_eq!(preview["controls"][4]["options"], json!(["First option","Second option"]));
        assert!(review.controls.iter().all(|control| control.id.len() == 32));
        assert_eq!(review.controls.iter().map(|control| &control.id).collect::<BTreeSet<_>>().len(), review.controls.len());
        for omitted in ["summary", "dialogMessage", "dialogTitle", "editTextState", "multiSelectState"] { assert!(!SCREEN_QUERY.contains(omitted)); }
    }

    #[test]
    fn malformed_or_ambiguous_definitions_cannot_offer_a_write() {
        let mut screen = rows(); screen[4]["key"] = screen[2]["key"].clone();
        assert!(screen_controls(&screen).is_err());
        let mut screen = rows(); screen[4]["title"] = json!("x".repeat(201));
        assert!(screen_controls(&screen).is_err());
        let mut screen = rows(); screen[4]["boolDefault"] = Value::Null;
        assert!(screen_controls(&screen).is_err());
        for (field, value) in [("entries", json!(["One"])), ("entryValues", json!(["same","same"])),
            ("listValue", json!("unmapped")), ("listDefault", json!("unmapped"))] {
            let mut screen = rows(); screen[5][field] = value;
            let controls = screen_controls(&screen).unwrap();
            assert!(!controls.last().unwrap().enabled);
            assert_eq!(controls.last().unwrap().reason, Some("invalid-options"));
        }
        let mut screen = rows(); screen[4]["boolValue"] = Value::Null;
        let controls = screen_controls(&screen).unwrap();
        assert_eq!(controls[3].reason, Some("unavailable-value"));
        assert!(screen_controls(&vec![rows()[0].clone();101]).is_err());
    }

    #[test]
    fn file_verification_allows_only_the_selected_file_and_rejects_candidate_only_paths() {
        let before = BTreeMap::from([("".into(),"directory".into()), ("source_12345.xml".into(),"old".into()), ("other.xml".into(),"private".into())]);
        let mut after = before.clone(); after.insert("source_12345.xml".into(),"new".into());
        assert!(expected_settings_files(&before,&after,"12345"));
        after.insert("candidate.xml".into(),"new".into());
        assert!(!expected_settings_files(&before,&after,"12345"));
        after.remove("candidate.xml"); after.insert("other.xml".into(),"changed".into());
        assert!(!expected_settings_files(&before,&after,"12345"));
        after = before.clone(); after.remove("other.xml");
        assert!(!expected_settings_files(&before,&after,"12345"));
        let created = BTreeMap::from([("".into(),"directory".into()), ("source_12345.xml".into(),"new".into())]);
        assert!(expected_settings_files(&BTreeMap::new(),&created,"12345"));
    }
}
