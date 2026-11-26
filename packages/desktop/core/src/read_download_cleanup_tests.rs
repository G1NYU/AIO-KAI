//! Real download-provider regression coverage using only original CI pages.
//! The parent module owns pure path/namespace validator tests. Reader-session
//! exclusion belongs to the desktop worker and its browser integration tests.
use super::*;
use super::super::tests::FixtureStore;
use std::collections::BTreeMap;
use std::os::windows::fs::OpenOptionsExt;

const FIXTURE_SOURCE: &str = "12345";
const FIXTURE_PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAYCAIAAAB8wupbAAAAHUlEQVR4nGOsqF3FQApgIkn1qIZRDaMaRjWQrAEA4jkBz8UryC4AAAAASUVORK5CYII=";

fn fixture_id(value: &Value) -> i32 {
    value.as_i64().or_else(|| value.as_str().and_then(|value| value.parse().ok()))
        .and_then(|value| i32::try_from(value).ok()).filter(|value| *value > 0)
        .expect("positive original fixture ID")
}

fn fixture_settings(managed: &ReadRuntime, settings: Value) {
    managed.client.mutation(
        "mutation TsugiCleanupFixtureSettings($input: SetSettingsInput!) { setSettings(input: $input) { settings { downloadsPath downloadAsCbz autoDownloadNewChapters globalUpdateInterval } } }",
        "setSettings", json!({"settings": settings}),
    ).expect("set isolated fixture download settings");
}

fn fixture_snapshot(managed: &ReadRuntime, manga: i32) -> Value {
    let mut snapshot = managed.client.document(
        "query TsugiCleanupFixtureState($id: Int!) { manga(id: $id) { id sourceId url title inLibrary categories { nodes { id name } totalCount } chapters { nodes { id url name scanlator pageCount isRead isBookmarked lastPageRead lastReadAt isDownloaded } totalCount } } }",
        "manga", json!({"id": manga}),
    ).expect("read original fixture state without fetching pages");
    for field in ["categories", "chapters"] {
        let count = snapshot[field]["totalCount"].as_u64().unwrap();
        let rows = snapshot[field]["nodes"].as_array_mut().unwrap();
        assert_eq!(rows.len() as u64, count);
        rows.sort_by_key(|row| fixture_id(&row["id"]));
    }
    snapshot
}

fn protected_fixture_state(mut snapshot: Value) -> Value {
    for row in snapshot["chapters"]["nodes"].as_array_mut().unwrap() {
        row.as_object_mut().unwrap().remove("isDownloaded");
    }
    snapshot
}

fn fixture_chapter<'a>(snapshot: &'a Value, id: i32) -> &'a Value {
    snapshot["chapters"]["nodes"].as_array().unwrap().iter()
        .find(|row| fixture_id(&row["id"]) == id).expect("original chapter remains in database")
}

fn fixture_queue(managed: &ReadRuntime) -> Value {
    managed.client.document(
        "query TsugiCleanupFixtureQueue { downloadStatus { state queue { state chapter { id } } } }",
        "downloadStatus", json!({}),
    ).expect("read real download queue")
}

fn enqueue_fixture(managed: &ReadRuntime, ids: &[i32]) {
    managed.client.slow().mutation(
        "mutation TsugiCleanupFixtureEnqueue($input: EnqueueChapterDownloadsInput!) { enqueueChapterDownloads(input: $input) { downloadStatus { state queue { state chapter { id } } } } }",
        "enqueueChapterDownloads", json!({"ids": ids}),
    ).expect("enqueue original source pages through the real downloader");
}

fn await_downloaded(managed: &ReadRuntime, manga: i32, ids: &[i32]) {
    let deadline = Instant::now() + Duration::from_secs(45);
    loop {
        let state = fixture_snapshot(managed, manga);
        let queue = fixture_queue(managed);
        let rows = queue["queue"].as_array().unwrap();
        assert!(rows.iter().all(|row| row["state"] != "ERROR"), "original PNG download must not enter an error state");
        if ids.iter().all(|id| fixture_chapter(&state, *id)["isDownloaded"] == true)
            && rows.is_empty() && queue["state"] == "STOPPED" {
            for id in ids { assert_eq!(fixture_chapter(&state, *id)["pageCount"], 2); }
            return;
        }
        assert!(Instant::now() < deadline, "original downloads did not complete and stop within the bounded wait");
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn fixture_page_port(managed: &ReadRuntime) -> u16 {
    let source = managed.client.document(
        "query TsugiCleanupFixtureSource($id: LongString!) { source(id: $id) { id homeUrl } }",
        "source", json!({"id": FIXTURE_SOURCE}),
    ).expect("read owned original page server address");
    let url = url::Url::parse(source["homeUrl"].as_str().unwrap()).unwrap();
    assert_eq!(url.scheme(), "http");
    assert_eq!(url.host_str(), Some("127.0.0.1"));
    assert!(url.username().is_empty() && url.password().is_none() && url.query().is_none());
    let port = url.port().unwrap();
    verify_listener(port, managed.client.owner_pid).expect("page server must belong to this fixture JVM");
    port
}

fn page_control(port: u16, pid: u32, action: &str) -> Result<Vec<u8>, &'static str> {
    verify_listener(port, pid)?;
    let agent: ureq::Agent = ureq::Agent::config_builder().proxy(None).max_redirects(0)
        .http_status_as_error(false).timeout_global(Some(Duration::from_secs(3))).build().into();
    let endpoint = format!("http://127.0.0.1:{port}/fixture/{action}");
    let mut response = match action {
        "pause" | "resume" => agent.post(endpoint).header("Connection", "close").send(""),
        "requests" => agent.get(endpoint).header("Connection", "close").call(),
        _ => return Err("Invalid original fixture action."),
    }.map_err(|_| "Original page server did not respond.")?;
    if response.status().as_u16() != 200 { return Err("Original page server rejected its test action."); }
    let mut bytes = Vec::new();
    response.body_mut().as_reader().take(65).read_to_end(&mut bytes)
        .map_err(|_| "Could not read original fixture response.")?;
    if bytes.len() > 64 { return Err("Original fixture response exceeded its bound."); }
    Ok(bytes)
}

struct PausedImages { port: u16, pid: u32 }

impl PausedImages {
    fn new(managed: &ReadRuntime) -> Self {
        let gate = Self { port: fixture_page_port(managed), pid: managed.client.owner_pid };
        page_control(gate.port, gate.pid, "pause").expect("pause only authored fixture pages");
        gate
    }
}

impl Drop for PausedImages {
    fn drop(&mut self) { let _ = page_control(self.port, self.pid, "resume"); }
}

fn fixture_paths(data: &Path, chapter: usize) -> (PathBuf, PathBuf) {
    let base = data.join("downloads/mangas/Tsugi Download Fixture (EN)/Tsugi Original Comic");
    (base.join(format!("Cleanup chapter 0{chapter}")), base.join(format!("Cleanup chapter 0{chapter}.cbz")))
}

fn stored_fixture(path: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    let mut result = BTreeMap::new();
    if path.is_file() {
        let bytes = fs::read(path).unwrap();
        assert!(!bytes.is_empty() && bytes.len() <= 64 * 1024);
        result.insert(PathBuf::new(), bytes);
    } else {
        for entry in fs::read_dir(path).expect("original chapter folder") {
            let entry = entry.unwrap();
            assert!(entry.file_type().unwrap().is_file(), "fixture chapter has no nested path");
            let bytes = fs::read(entry.path()).unwrap();
            assert!(!bytes.is_empty() && bytes.len() <= 64 * 1024);
            result.insert(entry.file_name().into(), bytes);
            assert!(result.len() <= 8);
        }
        assert_eq!(result.keys().filter(|path| path.extension().is_some_and(|extension| extension == "png")).count(), 2);
    }
    result
}

fn fixture_setup(kind: &str, cbz: bool) -> (ReadRuntime, FixtureStore, PathBuf, PathBuf, i32, [i32; 3]) {
    let runtime = PathBuf::from(std::env::var_os("TSUGI_READ_RUNTIME").unwrap());
    let data = PathBuf::from(std::env::var_os("TSUGI_READ_FIXTURE").unwrap()).join(kind);
    assert!(!data.exists(), "cleanup tests require a new isolated data directory");
    let artifact = fs::read(runtime.join("test-fixtures/tsugi-download-fixture-v1.6.1.jar")).unwrap();
    let store = FixtureStore::with_jar(Some(artifact));
    let managed = ReadRuntime::start(&runtime, &data).expect("start original download fixture");
    managed.add_store_inner(&store.url).unwrap();
    managed.refresh_extensions().unwrap();
    managed.mutate_extension("org.tsugi.fixture", true).expect("install separate original download source");
    fixture_settings(&managed, json!({"downloadAsCbz": cbz, "autoDownloadNewChapters": false, "globalUpdateInterval": 0.0}));
    let catalogue = managed.catalogue(FIXTURE_SOURCE, 1, CatalogueMode::Popular).unwrap();
    let manga = fixture_id(&catalogue["mangas"][0]["id"]);
    managed.manga(manga).expect("fetch three authored chapter identities");
    managed.set_library(manga, true).unwrap();
    let initial = fixture_snapshot(&managed, manga);
    let ids = [1, 2, 3].map(|number| fixture_id(&initial["chapters"]["nodes"].as_array().unwrap().iter()
        .find(|row| row["url"] == format!("/original-comic/chapter-{number}")).unwrap()["id"]));
    enqueue_fixture(&managed, &ids[..2]);
    await_downloaded(&managed, manga, &ids[..2]);
    // Update progress through the supported metadata mutation. Opening a CBZ
    // reader here would introduce an unrelated upstream archive file handle.
    for (id, bookmarked) in [(ids[0], false), (ids[1], true)] {
        managed.client.mutation(
            "mutation TsugiCleanupFixtureProgress($input: UpdateChapterInput!) { updateChapter(input: $input) { chapter { id isRead isBookmarked lastPageRead lastReadAt } } }",
            "updateChapter", json!({"id": id, "patch": {"isRead": true, "isBookmarked": bookmarked, "lastPageRead": 1}}),
        ).unwrap();
    }
    let category = managed.save_category(None, "Original cleanup shelf").unwrap();
    managed.assign_category(manga, fixture_id(&category["category"]["id"]), true).unwrap();
    let page_port = fixture_page_port(&managed);
    let requests = page_control(page_port, managed.client.owner_pid, "requests").unwrap();
    assert!(std::str::from_utf8(&requests).unwrap().parse::<usize>().unwrap() >= 4, "actual HTTP source PNG requests must have completed");
    let candidates = managed.download_cleanup_candidates(0).expect("review managed downloaded chapters");
    assert_eq!(candidates["totalCount"], 1);
    assert_eq!(candidates["items"].as_array().unwrap().len(), 1);
    assert_eq!(fixture_id(&candidates["items"][0]["chapterId"]), ids[0]);
    assert!(candidates["totalBytes"].as_u64().unwrap() > 0);
    assert!(managed.review_download_cleanup(&[ids[1]]).is_err(), "bookmarked downloads must not enter cleanup");
    for number in [1, 2] {
        let (folder, archive) = fixture_paths(&data, number);
        assert_eq!(folder.is_dir(), !cbz);
        assert_eq!(archive.is_file(), cbz);
        if cbz { assert!(fs::read(&archive).unwrap().starts_with(b"PK\x03\x04")); }
        else { stored_fixture(&folder); }
    }
    (managed, store, runtime, data, manga, ids)
}

fn assert_no_download_change(managed: &ReadRuntime, manga: i32, selected: i32, path: &Path, bytes: &BTreeMap<PathBuf, Vec<u8>>) {
    assert_eq!(stored_fixture(path), *bytes);
    assert_eq!(fixture_chapter(&fixture_snapshot(managed, manga), selected)["isDownloaded"], true);
}

#[test]
#[ignore = "requires the pinned Windows runtime and original HTTP PNG fixture"]
fn packaged_runtime_download_cleanup_providers() {
    for cbz in [false, true] {
        let kind = if cbz { "download-cleanup-cbz" } else { "download-cleanup-folder" };
        let (mut managed, store, runtime, data, manga, ids) = fixture_setup(kind, cbz);
        let (selected_folder, selected_archive) = fixture_paths(&data, 1);
        let (kept_folder, kept_archive) = fixture_paths(&data, 2);
        let selected_path = if cbz { &selected_archive } else { &selected_folder };
        let kept_path = if cbz { &kept_archive } else { &kept_folder };
        let selected_bytes = stored_fixture(selected_path);
        let kept_bytes = stored_fixture(kept_path);

        let stale = managed.review_download_cleanup(&[ids[0]]).unwrap();
        managed.update_chapter_flags(&[ids[0]], None, Some(true)).unwrap();
        assert!(managed.apply_reviewed_download_cleanup(stale).is_err(), "changed bookmark invalidates reviewed cleanup before any deletion");
        assert_no_download_change(&managed, manga, ids[0], selected_path, &selected_bytes);
        managed.update_chapter_flags(&[ids[0]], None, Some(false)).unwrap();

        let stale = managed.review_download_cleanup(&[ids[0]]).unwrap();
        let changed_file = if cbz { selected_archive.clone() } else {
            selected_folder.join(selected_bytes.keys().find(|path| path.extension().is_some_and(|extension| extension == "png")).unwrap())
        };
        let original = fs::read(&changed_file).unwrap();
        let mut changed = original.clone();
        changed.push(0);
        fs::write(&changed_file, &changed).unwrap();
        assert!(managed.apply_reviewed_download_cleanup(stale).is_err(), "changed stored bytes invalidate the reviewed fingerprint");
        assert_eq!(fs::read(&changed_file).unwrap(), changed);
        fs::write(&changed_file, original).unwrap();
        assert_no_download_change(&managed, manga, ids[0], selected_path, &selected_bytes);

        if !cbz {
            let external = data.join("original-custom-download-root");
            fs::create_dir(&external).unwrap();
            fs::write(external.join("keep.bin"), b"original external-root fixture").unwrap();
            fixture_settings(&managed, json!({"downloadsPath": external.to_str().unwrap()}));
            assert!(managed.download_cleanup_candidates(0).is_err(), "custom download roots are outside managed cleanup");
            assert_eq!(fs::read(external.join("keep.bin")).unwrap(), b"original external-root fixture");
            fixture_settings(&managed, json!({"downloadsPath": ""}));
            fixture_settings(&managed, json!({"autoDownloadNewChapters": true}));
            assert!(managed.download_cleanup_candidates(0).is_err(), "automatic downloads must be disabled before cleanup");
            fixture_settings(&managed, json!({"autoDownloadNewChapters": false}));

            let stale = managed.review_download_cleanup(&[ids[0]]).unwrap();
            let gate = PausedImages::new(&managed);
            enqueue_fixture(&managed, &ids[2..]);
            assert!(!fixture_queue(&managed)["queue"].as_array().unwrap().is_empty());
            assert!(managed.download_cleanup_candidates(0).is_err(), "an active real download blocks cleanup");
            assert!(managed.apply_reviewed_download_cleanup(stale).is_err(), "a download started after review prevents deletion");
            assert_no_download_change(&managed, manga, ids[0], selected_path, &selected_bytes);
            drop(gate);
            await_downloaded(&managed, manga, &ids);

            let stale = managed.review_download_cleanup(&[ids[0]]).unwrap();
            fs::write(&selected_archive, b"original conflicting fixture").unwrap();
            assert!(managed.apply_reviewed_download_cleanup(stale).is_err(), "simultaneous folder and CBZ paths are ambiguous");
            assert_eq!(fs::read(&selected_archive).unwrap(), b"original conflicting fixture");
            assert_no_download_change(&managed, manga, ids[0], selected_path, &selected_bytes);
            fs::remove_file(&selected_archive).unwrap();

            let stale = managed.review_download_cleanup(&[ids[0]]).unwrap();
            let held = data.join("original-junction-target");
            fs::rename(&selected_folder, &held).unwrap();
            // Match the existing storage junction fixture: cmd built-ins need
            // Windows separators, while the CI data-root env uses forward slashes.
            let status = Command::new("cmd.exe").current_dir(&data)
                .args(["/d", "/c", "mklink", "/J",
                    r"downloads\mangas\Tsugi Download Fixture (EN)\Tsugi Original Comic\Cleanup chapter 01",
                    "original-junction-target"])
                .stdout(Stdio::null()).stderr(Stdio::null()).status().unwrap();
            assert!(status.success(), "original fixture junction creation failed (exit {:?})", status.code());
            assert!(managed.apply_reviewed_download_cleanup(stale).is_err(), "a reparse point cannot replace a reviewed download");
            assert_eq!(stored_fixture(&held), selected_bytes);
            fs::remove_dir(&selected_folder).expect("remove only the original test junction");
            assert!(held.is_dir(), "junction removal must retain its target");
            fs::rename(&held, &selected_folder).unwrap();
        }

        let before = protected_fixture_state(fixture_snapshot(&managed, manga));
        let review = managed.review_download_cleanup(&[ids[0]]).unwrap();
        let expected_bytes: u64 = selected_bytes.values().map(|bytes| bytes.len() as u64).sum();
        let result = managed.apply_reviewed_download_cleanup(review).expect("apply reviewed original chapter cleanup");
        assert_eq!(result["removedCount"], 1);
        assert_eq!(result["removedBytes"], expected_bytes);
        assert_eq!(result["metadataPreserved"], true);
        assert_eq!(result["items"][0]["status"], "removed");
        assert!(!selected_folder.exists() && !selected_archive.exists());
        assert_eq!(stored_fixture(kept_path), kept_bytes);
        let after = fixture_snapshot(&managed, manga);
        assert_eq!(fixture_chapter(&after, ids[0])["isDownloaded"], false);
        assert_eq!(fixture_chapter(&after, ids[1])["isDownloaded"], true);
        assert_eq!(protected_fixture_state(after), before);

        managed.shutdown().unwrap();
        drop(managed);
        managed = ReadRuntime::start(&runtime, &data).expect("reopen real downloaded-chapter database");
        let after_restart = fixture_snapshot(&managed, manga);
        assert_eq!(fixture_chapter(&after_restart, ids[0])["isDownloaded"], false);
        assert_eq!(fixture_chapter(&after_restart, ids[1])["isDownloaded"], true);
        assert_eq!(protected_fixture_state(after_restart), before);
        assert_eq!(stored_fixture(kept_path), kept_bytes);
        let pages = managed.chapter(ids[1]).expect("retained original download remains readable after restart");
        for index in 0..2 {
            let image = managed.page(&pages, index).unwrap();
            assert_eq!(image.mime, "image/png");
            assert_eq!(image.bytes, STANDARD.decode(FIXTURE_PNG).unwrap());
        }
        let requests = page_control(fixture_page_port(&managed), managed.client.owner_pid, "requests").unwrap();
        assert_eq!(requests, b"0", "retained pages must come from the real download, with no source fallback");
        drop(pages);

        if cbz {
            // Probe the actual Windows lifetime of upstream archive handles
            // after closing our reader capability. Both possible provider
            // outcomes must preserve metadata and report reclaimed bytes honestly.
            enqueue_fixture(&managed, &ids[..1]);
            await_downloaded(&managed, manga, &ids[..2]);
            let pages = managed.chapter(ids[0]).expect("open the re-downloaded original CBZ");
            for index in 0..2 {
                let image = managed.page(&pages, index).unwrap();
                assert_eq!(image.mime, "image/png");
                assert_eq!(image.bytes, STANDARD.decode(FIXTURE_PNG).unwrap());
            }
            drop(pages);
            let before_probe = protected_fixture_state(fixture_snapshot(&managed, manga));
            let probe_bytes = stored_fixture(&selected_archive);
            let expected_bytes: u64 = probe_bytes.values().map(|bytes| bytes.len() as u64).sum();
            let review = managed.review_download_cleanup(&[ids[0]])
                .expect("review the closed original CBZ after actual page reads");
            let result = managed.apply_reviewed_download_cleanup(review)
                .expect("report the actual post-read CBZ provider outcome");
            assert_eq!(result["items"].as_array().unwrap().len(), 1);
            assert_eq!(result["metadataPreserved"], true);
            assert!(!selected_folder.exists());
            if selected_archive.exists() {
                assert_eq!(result["items"][0]["status"], "failed");
                assert_eq!(result["items"][0]["bytes"], 0);
                assert_eq!(result["removedCount"], 0);
                assert_eq!(result["removedBytes"], 0);
                assert_eq!(stored_fixture(&selected_archive), probe_bytes);
                eprintln!("PASS: post-read CBZ removal remained blocked; cleanup reported failed and zero reclaimed bytes.");
            } else {
                assert_eq!(result["items"][0]["status"], "removed");
                assert_eq!(result["items"][0]["bytes"], expected_bytes);
                assert_eq!(result["removedCount"], 1);
                assert_eq!(result["removedBytes"], expected_bytes);
                eprintln!("PASS: post-read CBZ removal succeeded; cleanup verified the archive absent and reported its exact logical bytes.");
            }
            let after_probe = fixture_snapshot(&managed, manga);
            assert_eq!(fixture_chapter(&after_probe, ids[0])["isDownloaded"], false);
            assert_eq!(fixture_chapter(&after_probe, ids[1])["isDownloaded"], true);
            assert_eq!(protected_fixture_state(after_probe), before_probe);
            assert_eq!(stored_fixture(kept_path), kept_bytes);
        }
        managed.shutdown().unwrap();
        drop(managed);
        drop(store);
        fs::remove_dir_all(data).unwrap();
    }
    eprintln!("PASS: original folder/CBZ cleanup preserved library, categories, progress and bookmarked downloads across restart; stale, custom-root, active-queue, dual-path and junction guards refused deletion.");
}

#[test]
#[ignore = "requires the pinned Windows runtime and original HTTP PNG fixture"]
fn packaged_runtime_download_cleanup_locked_file() {
    let (mut managed, store, runtime, data, manga, ids) = fixture_setup("download-cleanup-locked", false);
    enqueue_fixture(&managed, &ids[2..]);
    await_downloaded(&managed, manga, &ids);
    managed.update_chapter_flags(&[ids[2]], Some(true), Some(false)).unwrap();
    let (selected_folder, _) = fixture_paths(&data, 1);
    let (kept_folder, _) = fixture_paths(&data, 2);
    let (remaining_folder, _) = fixture_paths(&data, 3);
    let kept_bytes = stored_fixture(&kept_folder);
    let remaining_bytes = stored_fixture(&remaining_folder);
    let before = protected_fixture_state(fixture_snapshot(&managed, manga));
    let selected = stored_fixture(&selected_folder);
    let locked_path = selected_folder.join(selected.keys().find(|path| path.extension().is_some_and(|extension| extension == "png")).unwrap());
    let review = managed.review_download_cleanup(&[ids[0], ids[2]]).unwrap();
    // Permit reads and writes for fingerprinting, but deny FILE_SHARE_DELETE.
    let locked = fs::OpenOptions::new().read(true).share_mode(1 | 2).open(&locked_path).unwrap();
    let result = managed.apply_reviewed_download_cleanup(review).expect("report the actual upstream deletion failure");
    assert_eq!(result["removedCount"], 0);
    assert_eq!(result["removedBytes"], 0);
    assert_eq!(result["items"][0]["status"], "failed");
    assert_eq!(result["items"][1]["status"], "not-attempted");
    assert_eq!(result["items"][1]["bytes"], 0);
    assert_eq!(result["metadataPreserved"], true);
    assert!(locked_path.is_file(), "the locked original file was not removed");
    assert_eq!(stored_fixture(&kept_folder), kept_bytes);
    assert_eq!(stored_fixture(&remaining_folder), remaining_bytes);
    let after = fixture_snapshot(&managed, manga);
    assert_eq!(fixture_chapter(&after, ids[0])["isDownloaded"], false,
        "pinned upstream clears its flag even when provider deletion returns false");
    assert_eq!(fixture_chapter(&after, ids[2])["isDownloaded"], true,
        "cleanup must not attempt the next selected chapter after the locked-file failure");
    assert_eq!(protected_fixture_state(after), before);
    drop(locked);
    managed.shutdown().unwrap();
    drop(managed);
    managed = ReadRuntime::start(&runtime, &data).unwrap();
    assert!(locked_path.is_file(), "restart must not silently finish an unconfirmed deletion");
    assert_eq!(protected_fixture_state(fixture_snapshot(&managed, manga)), before);
    assert_eq!(stored_fixture(&kept_folder), kept_bytes);
    assert_eq!(stored_fixture(&remaining_folder), remaining_bytes);
    managed.shutdown().unwrap();
    drop(managed);
    drop(store);
    fs::remove_dir_all(data).unwrap();
    eprintln!("PASS: a Windows-locked original page produced failed/zero freed bytes despite upstream clearing its flag; the next selected chapter was not attempted, and bookmarked files and protected metadata survived restart.");
}
