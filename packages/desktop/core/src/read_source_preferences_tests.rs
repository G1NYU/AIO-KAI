//! Pinned-JVM source-setting transactions with authored controls and pages.
//! Raw GraphQL seeding is test-only; no arbitrary preference action is exposed.
use super::*;
use super::super::tests::FixtureStore;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

const SOURCE: &str = "12345";
const PRIVATE_VALUE: &str = "tsugi-ci-original-private-text";
const MUTATED_PRIVATE_VALUE: &str = "tsugi-ci-listener-mutated-private-text";
const SIDE_EFFECT: &str = "tsugi-ci-persisted-listener-side-effect";

fn nonce(value: &str) -> bool {
    value.len() == 32 && value.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn raw_preferences(managed: &ReadRuntime) -> Value {
    managed.client.document(
        "query TsugiSettingsFixture($id: LongString!) { source(id: $id) { id preferences { __typename ... on SwitchPreference { key boolValue: currentValue } ... on CheckBoxPreference { key boolValue: currentValue } ... on ListPreference { key listValue: currentValue } } } }",
        "source", json!({"id": SOURCE}),
    ).expect("read only authored nontext fixture values")
}

fn set_fixture_preference(managed: &ReadRuntime, change: Value) {
    // Populate the engine's positional screen before its test-only mutation.
    raw_preferences(managed);
    managed.client.document(
        "mutation TsugiSetSettingsFixture($input: UpdateSourcePreferenceInput!) { updateSourcePreference(input: $input) { preferences { __typename } } }",
        "updateSourcePreference", json!({"input": {"source": SOURCE, "change": change}}),
    ).expect("set only an authored fixture value through the actual engine");
}

fn setting_xml(path: &Path) -> Option<Vec<u8>> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return None,
        Err(_) => panic!("could not inspect isolated source settings"),
    };
    let mut bytes = Vec::new();
    file.take(16 * 1024 + 1).read_to_end(&mut bytes).expect("read bounded original source setting");
    assert!(bytes.len() <= 16 * 1024, "original source settings must remain bounded");
    Some(bytes)
}

fn has_entry(bytes: &[u8], key: &str, value: &str) -> bool {
    let entry = format!("<entry key=\"{key}\">{value}</entry>");
    bytes.starts_with(b"<?xml") && bytes.windows(b"</properties>".len()).any(|part| part == b"</properties>")
        && bytes.windows(entry.len()).any(|part| part == entry.as_bytes())
}

fn wait_for_setting(path: &Path, key: &str, value: &str) -> Vec<u8> {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if let Some(bytes) = setting_xml(path) {
            if has_entry(&bytes, key, value) { return bytes; }
        }
        assert!(Instant::now() < deadline, "the original setting did not reach XML within the bounded wait");
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn hash(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }

fn assert_redacted(value: &str) {
    for marker in [PRIVATE_VALUE, MUTATED_PRIVATE_VALUE, SIDE_EFFECT,
        "tsugi-ci-private-text-default", "tsugi-ci-private-text-summary", "fixture_",
        "\"position\"", "\"default\"", "\"entryValues\"", "\"summary\"", "\"dialogMessage\"", "\"text\"", "\"first\"", "\"second\""] {
        assert!(!value.contains(marker), "source-setting responses must omit private values and raw engine fields");
    }
}

fn load(managed: &ReadRuntime) -> SourcePreferencesReview {
    let review = managed.load_source_preferences(SOURCE).expect("explicitly load authored source controls");
    let preview = review.preview();
    assert!(nonce(review.id()));
    assert_eq!(preview["reviewId"], review.id());
    assert_eq!(preview["sourceId"], SOURCE);
    assert_eq!(preview["sourceName"], "Tsugi Settings Fixture");
    assert_eq!(preview["versionName"], "1.6.1");
    assert_redacted(&preview.to_string());
    let controls = preview["controls"].as_array().unwrap();
    assert_eq!(controls.len(), 7, "two hidden rows are omitted without renumbering the engine's positions");
    assert_eq!(controls.iter().filter(|control| control["enabled"] == true).count(), 4);
    let ids = controls.iter().map(|control| control["id"].as_str().unwrap()).collect::<BTreeSet<_>>();
    assert_eq!(ids.len(), controls.len());
    assert!(ids.iter().all(|id| nonce(id)), "control handles are opaque native identities");
    assert!(controls.iter().any(|control| control["reason"] == "unsupported-type" && control["enabled"] == false));
    assert!(controls.iter().any(|control| control["title"] == "Original disabled checkbox" && control["reason"] == "disabled" && control["enabled"] == false));
    assert!(controls.iter().any(|control| control["title"] == "Original keyless switch" && control["reason"] == "missing-key" && control["enabled"] == false));
    assert!(!preview.to_string().contains("Original hidden"), "hidden controls are absent from the bridge projection");
    review
}

fn control(review: &SourcePreferencesReview, title: &str) -> Value {
    review.preview()["controls"].as_array().unwrap().iter().find(|control| control["title"] == title)
        .expect("authored public source control").clone()
}

fn prepare(managed: &ReadRuntime, title: &str, value: SourcePreferenceValue) -> SourcePreferenceChangeReview {
    let preview = load(managed);
    let id = control(&preview, title)["id"].as_str().unwrap().to_owned();
    let review = managed.review_source_preference_change(preview, &id, value).expect("review the exact original setting change");
    assert_redacted(review.description());
    assert!(review.description().contains(title), "native confirmation identifies the selected public setting");
    review
}

fn apply(managed: &mut ReadRuntime, title: &str, value: SourcePreferenceValue) -> Value {
    let change = prepare(managed, title, value);
    let result = managed.apply_reviewed_source_preference(change).expect("apply the authored setting transaction");
    assert_redacted(&result.to_string());
    assert_eq!(result["status"], "applied", "source setting transaction failed: {}",
        result["error"].as_str().unwrap_or("no static broker reason"));
    assert!(result["checkpointId"].as_str().is_some_and(nonce));
    result
}

fn reading_state(managed: &ReadRuntime, manga: i32) -> Value {
    json!({"manga": managed.cached_manga(manga).unwrap(), "library": managed.library_page(0).unwrap(),
        "categories": managed.query(ReadOperation::Categories).unwrap()})
}

fn assert_saved_controls(managed: &ReadRuntime, checkbox: bool) {
    let review = load(managed);
    assert_eq!(control(&review, "Original switch")["kind"], "switch");
    assert_eq!(control(&review, "Original switch")["value"], false);
    assert_eq!(control(&review, "Original checkbox")["kind"], "checkbox");
    assert_eq!(control(&review, "Original checkbox")["value"], checkbox);
    let selection = control(&review, "Original list");
    assert_eq!(selection["kind"], "select");
    assert_eq!(selection["value"], 1);
    assert_eq!(selection["options"], json!(["Original first option", "Original second option"]));
    assert_eq!(control(&review, "Original failing listener")["value"], false);
    let raw = raw_preferences(managed);
    let values = raw["preferences"].as_array().unwrap();
    for (key, expected) in [("fixture_hidden", true), ("fixture_disabled", true), ("fixture_switch", false),
        ("fixture_checkbox", checkbox), ("fixture_throw", false)] {
        assert!(values.iter().any(|value| value["key"] == key && value["boolValue"] == expected),
            "the selected raw Boolean changed without remapping skipped positions");
    }
    assert!(values.iter().any(|value| value["key"] == "fixture_list" && value["listValue"] == "second"));
}

#[test]
#[ignore = "requires the pinned Windows runtime and original source settings fixture"]
fn packaged_runtime_source_preferences_preserve_secrets_and_recover_listener_failure() {
    let runtime = PathBuf::from(std::env::var_os("TSUGI_READ_RUNTIME").unwrap());
    let data = PathBuf::from(std::env::var_os("TSUGI_READ_FIXTURE").unwrap()).join("source-settings");
    assert!(!data.try_exists().unwrap(), "source settings require a fresh isolated fixture directory");
    let jar = fs::read(runtime.join("test-fixtures/tsugi-settings-fixture-v1.6.1.jar")).unwrap();
    assert!(jar.starts_with(b"PK") && jar.len() < 1024 * 1024);
    let store = FixtureStore::with_jar(Some(jar));
    let mut managed = ReadRuntime::start(&runtime, &data).expect("start isolated settings runtime");
    managed.add_store_inner(&store.url).unwrap(); managed.refresh_extensions().unwrap();
    managed.mutate_extension("org.tsugi.fixture", true).expect("install only the original settings fixture");
    let settings = data.join("settings/source_12345.xml");
    let side_effect = data.join("settings/tsugi_settings_listener.xml");
    set_fixture_preference(&managed, json!({"position": 0, "editTextState": PRIVATE_VALUE}));
    wait_for_setting(&settings, "fixture_secret", PRIVATE_VALUE);
    set_fixture_preference(&managed, json!({"position": 1, "editTextState": "normal"}));
    let original_hash = hash(&wait_for_setting(&settings, "fixture_layout", "normal"));
    assert!(!side_effect.try_exists().unwrap());
    let catalogue = managed.catalogue(SOURCE, 1, CatalogueMode::Popular).unwrap();
    let manga = catalogue["mangas"][0]["id"].as_i64().unwrap() as i32;
    managed.set_library(manga, true).unwrap();
    let details = managed.manga(manga).unwrap();
    let chapter = details["chapters"].as_array().unwrap().iter().find(|chapter| chapter["name"] == "Cleanup chapter 01").unwrap()["id"].as_i64().unwrap() as i32;
    let pages = managed.chapter(chapter).unwrap(); assert_eq!(pages.len(), 2);
    assert_eq!(managed.page(&pages, 1).unwrap().mime, "image/png");
    managed.save_progress(&pages, 1, true).unwrap(); drop(pages);
    managed.update_chapter_flags(&[chapter], None, Some(true)).unwrap();
    let category = managed.save_category(None, "Original settings shelf").unwrap();
    managed.assign_category(manga, category["category"]["id"].as_i64().unwrap() as i32, true).unwrap();
    let before_reading = reading_state(&managed, manga);

    let initial = load(&managed);
    assert_eq!(control(&initial, "Original switch")["value"], true);
    assert_eq!(control(&initial, "Original checkbox")["value"], false);
    assert_eq!(control(&initial, "Original list")["value"], 0);
    drop(initial);
    for reason in ["unsupported-type", "disabled", "missing-key"] {
        let preview = load(&managed);
        let view = preview.preview();
        let id = view["controls"].as_array().unwrap().iter().find(|row| row["reason"] == reason).unwrap()["id"].as_str().unwrap().to_owned();
        assert!(managed.review_source_preference_change(preview, &id, SourcePreferenceValue::Bool(false)).is_err(),
            "non-actionable preview rows cannot create a setting mutation");
    }
    let invalid_choice = load(&managed);
    let id = control(&invalid_choice, "Original list")["id"].as_str().unwrap().to_owned();
    assert!(managed.review_source_preference_change(invalid_choice, &id, SourcePreferenceValue::Choice(2)).is_err());
    assert!(hash(&setting_xml(&settings).unwrap()) == original_hash, "loading and rejected reviews do not modify source settings");
    assert!(!data.join("extension-recovery/pending").try_exists().unwrap(), "no checkpoint or write is created by loading or an invalid review");

    apply(&mut managed, "Original switch", SourcePreferenceValue::Bool(false));
    assert!(has_entry(&setting_xml(&settings).unwrap(), "fixture_switch", "false"), "a stored false must survive the real JVM transaction");
    apply(&mut managed, "Original checkbox", SourcePreferenceValue::Bool(true));
    apply(&mut managed, "Original list", SourcePreferenceValue::Choice(1));
    assert_saved_controls(&managed, true);
    assert!(has_entry(&setting_xml(&settings).unwrap(), "fixture_secret", PRIVATE_VALUE), "unrelated private text survives supported edits");
    assert!(reading_state(&managed, manga) == before_reading, "supported source edits preserve saved reading state");
    managed.shutdown().unwrap(); drop(managed);
    managed = ReadRuntime::start(&runtime, &data).expect("restart after the supported setting transactions");
    assert_saved_controls(&managed, true);
    assert!(reading_state(&managed, manga) == before_reading);

    let stale = prepare(&managed, "Original checkbox", SourcePreferenceValue::Bool(false));
    set_fixture_preference(&managed, json!({"position": 6, "checkBoxState": false}));
    let newer_hash = hash(&wait_for_setting(&settings, "fixture_checkbox", "false"));
    assert!(managed.apply_reviewed_source_preference(stale).is_err(), "a changed reviewed value requires a fresh review");
    assert!(hash(&setting_xml(&settings).unwrap()) == newer_hash, "stale review refusal must preserve the newer external setting");

    let reordered = prepare(&managed, "Original switch", SourcePreferenceValue::Bool(true));
    set_fixture_preference(&managed, json!({"position": 1, "editTextState": "reordered"}));
    let reordered_hash = hash(&wait_for_setting(&settings, "fixture_layout", "reordered"));
    let raw = raw_preferences(&managed);
    assert_eq!(raw["preferences"][5]["__typename"], "ListPreference");
    assert_eq!(raw["preferences"][7]["__typename"], "SwitchPreference");
    assert!(managed.apply_reviewed_source_preference(reordered).is_err(), "reordered engine positions invalidate the held change review");
    assert!(hash(&setting_xml(&settings).unwrap()) == reordered_hash, "position refusal must not roll back unrelated newer state");
    set_fixture_preference(&managed, json!({"position": 1, "editTextState": "normal"}));
    wait_for_setting(&settings, "fixture_layout", "normal");
    assert_saved_controls(&managed, false);
    assert!(reading_state(&managed, manga) == before_reading);

    let before_failure = hash(&setting_xml(&settings).unwrap());
    let failing = prepare(&managed, "Original failing listener", SourcePreferenceValue::Bool(true));
    let result = managed.apply_reviewed_source_preference(failing).expect("recover the original listener failure");
    assert_eq!(result["status"], "rolled-back"); assert_redacted(&result.to_string());
    assert!(result["checkpointId"].as_str().is_some_and(nonce));
    let recovery = data.join("extension-recovery/pending");
    let displaced = setting_xml(&recovery.join("displaced/settings/source_12345.xml")).expect("retain actual failed-setting evidence");
    assert!(has_entry(&displaced, "fixture_throw", "true"), "the throwing listener case must have persisted the target before rollback");
    let displaced_side_effect = setting_xml(&recovery.join("displaced/settings/tsugi_settings_listener.xml")).expect("retain the listener's real independent side effect");
    assert!(has_entry(&displaced_side_effect, "fixture_side_effect", SIDE_EFFECT));
    assert!(hash(&setting_xml(&recovery.join("snapshot/settings/source_12345.xml")).unwrap()) == before_failure);
    assert!(hash(&setting_xml(&settings).unwrap()) == before_failure, "recovery restores exact original source XML including the private text");
    assert!(!side_effect.try_exists().unwrap(), "recovery removes the listener file absent from the checkpoint");
    assert_saved_controls(&managed, false);
    assert!(reading_state(&managed, manga) == before_reading);
    managed.shutdown().unwrap(); drop(managed);
    let mut managed = ReadRuntime::start(&runtime, &data).expect("restart after source-setting rollback");
    assert_saved_controls(&managed, false);
    assert!(hash(&setting_xml(&settings).unwrap()) == before_failure);
    assert!(!side_effect.try_exists().unwrap());
    assert!(reading_state(&managed, manga) == before_reading, "private settings and protected reading state survive recovery and restart");

    // Exercise the shipped verifier against real JVM-produced XML while the
    // engine is stopped. Only this isolated fixture is changed, then restored.
    let verified_change = prepare(&managed, "Original checkbox", SourcePreferenceValue::Bool(true));
    managed.shutdown().unwrap();
    let checkpoint = crate::read_checkpoint::create(&data).expect("protect the original verifier fixture");
    let original_xml = String::from_utf8(setting_xml(&settings).unwrap()).expect("original fixture XML is UTF-8");
    let prior_entry = "<entry key=\"fixture_checkbox\">false</entry>";
    assert_eq!(original_xml.matches(prior_entry).count(), 1, "the fixture has exactly one stored checkbox value");
    let changed_xml = original_xml.replacen(prior_entry, "<entry key=\"fixture_checkbox\">true</entry>", 1);
    fs::write(&settings, &changed_xml).unwrap();
    assert!(managed.verify_persisted_preference(&verified_change).unwrap(), "the shipped verifier accepts the exact reviewed change");
    assert_eq!(changed_xml.matches(PRIVATE_VALUE).count(), 1, "the fixture has one original private value");
    fs::write(&settings, changed_xml.replacen(PRIVATE_VALUE, MUTATED_PRIVATE_VALUE, 1)).unwrap();
    assert!(!managed.verify_persisted_preference(&verified_change).unwrap(), "the verifier rejects an unrelated private-property change");
    fs::write(&settings, &changed_xml).unwrap();
    fs::write(&side_effect, &changed_xml).unwrap();
    assert!(!managed.verify_persisted_preference(&verified_change).unwrap(), "the verifier rejects a candidate-only settings file");
    fs::remove_file(&side_effect).unwrap();
    let standard_doctype = "<!DOCTYPE properties SYSTEM \"http://java.sun.com/dtd/properties.dtd\">";
    assert_eq!(changed_xml.matches(standard_doctype).count(), 1, "the actual JVM uses the standard Properties XML declaration");
    let internal_doctype = "<!DOCTYPE properties SYSTEM \"http://java.sun.com/dtd/properties.dtd\" [<!ENTITY fixture \"original\">]>";
    fs::write(&settings, changed_xml.replacen(standard_doctype, internal_doctype, 1)).unwrap();
    assert!(!managed.verify_persisted_preference(&verified_change).unwrap(), "the verifier rejects internal DTD declarations");
    checkpoint.rollback().expect("restore the original verifier fixture before cleanup");
    assert!(hash(&setting_xml(&settings).unwrap()) == before_failure);
    assert!(!side_effect.try_exists().unwrap());
    drop(managed); drop(store);
    fs::remove_dir_all(data).unwrap();
    eprintln!("PASS: opaque source settings preserved original positions and private text; false/list edits and ignored false-listener return survived restart; stale/reordered changes refused and an actual saved listener failure rolled back exactly; the shipped verifier accepted only the exact property change.");
}
