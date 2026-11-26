//! Exercise the managed download actions against the pinned JVM, using only
//! authored loopback PNG pages. This does not assert offline Reader behavior.
use super::*;
use super::super::tests::FixtureStore;
use std::collections::BTreeMap;
use std::path::PathBuf;

const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAYCAIAAAB8wupbAAAAHUlEQVR4nGOsqF3FQApgIkn1qIZRDaMaRjWQrAEA4jkBz8UryC4AAAAASUVORK5CYII=";
const EXTENSION_QUEUE_ERROR: &str = "Finish or cancel all chapter downloads before changing extensions.";

fn id(value: &Value) -> i32 {
    value.as_i64().or_else(|| value.as_str().and_then(|value| value.parse().ok()))
        .and_then(|value| i32::try_from(value).ok()).filter(|value| *value > 0)
        .expect("positive original fixture ID")
}

fn snapshot(managed: &ReadRuntime, manga: i32) -> Value {
    let mut state = managed.client.document(
        "query TsugiDownloadActionFixtureState($id: Int!) { manga(id: $id) { id sourceId url title inLibrary categories { nodes { id name } totalCount } chapters { nodes { id url name scanlator pageCount isRead isBookmarked lastPageRead lastReadAt isDownloaded } totalCount } } }",
        "manga", json!({"id": manga}),
    ).expect("read saved fixture identities and progress");
    for field in ["categories", "chapters"] {
        let count = state[field]["totalCount"].as_u64().unwrap();
        let rows = state[field]["nodes"].as_array_mut().unwrap();
        assert_eq!(rows.len() as u64, count);
        rows.sort_by_key(|row| id(&row["id"]));
    }
    state
}

fn chapter(state: &Value, chapter_id: i32) -> &Value {
    state["chapters"]["nodes"].as_array().unwrap().iter()
        .find(|row| id(&row["id"]) == chapter_id).expect("original chapter retained")
}

fn protected_state(mut state: Value) -> Value {
    for row in state["chapters"]["nodes"].as_array_mut().unwrap() {
        row.as_object_mut().unwrap().remove("isDownloaded");
    }
    state
}

fn queue_ids(status: &Value) -> Vec<i32> {
    let mut ids: Vec<_> = status["queue"].as_array().unwrap().iter().map(|row| id(&row["id"])).collect();
    ids.sort_unstable();
    ids
}

fn await_status(managed: &ReadRuntime, matches: impl Fn(&Value) -> bool) -> Value {
    let deadline = Instant::now() + Duration::from_secs(45);
    loop {
        let status = managed.download_status().expect("read managed queue status");
        if matches(&status) { return status; }
        assert!(Instant::now() < deadline, "download queue did not reach the expected state: {status}");
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn await_downloaded(managed: &ReadRuntime, manga: i32, ids: &[i32]) {
    await_status(managed, |status| {
        assert!(status["queue"].as_array().unwrap().iter().all(|row| row["state"] != "ERROR"),
            "authored PNG download unexpectedly failed: {status}");
        let state = snapshot(managed, manga);
        ids.iter().all(|id| chapter(&state, *id)["isDownloaded"] == true)
            && status["state"] == "STOPPED" && queue_ids(status).is_empty()
    });
}

struct FixturePages { port: u16, pid: u32 }

impl FixturePages {
    fn new(managed: &ReadRuntime) -> Self {
        let source = managed.client.document(
            "query TsugiDownloadActionFixtureSource($id: LongString!) { source(id: $id) { id homeUrl } }",
            "source", json!({"id": "12345"}),
        ).unwrap();
        let url = url::Url::parse(source["homeUrl"].as_str().unwrap()).unwrap();
        assert_eq!(url.scheme(), "http");
        assert_eq!(url.host_str(), Some("127.0.0.1"));
        assert!(url.username().is_empty() && url.password().is_none() && url.query().is_none());
        let pages = Self { port: url.port().unwrap(), pid: managed.client.owner_pid };
        verify_listener(pages.port, pages.pid).expect("owned fixture JVM page listener");
        pages
    }

    fn request(&self, action: &str) -> Result<Vec<u8>, &'static str> {
        verify_listener(self.port, self.pid)?;
        let agent: ureq::Agent = ureq::Agent::config_builder().proxy(None).max_redirects(0)
            .http_status_as_error(false).timeout_global(Some(Duration::from_secs(3))).build().into();
        let endpoint = format!("http://127.0.0.1:{}/fixture/{action}", self.port);
        let mut response = match action {
            "pause" | "resume" | "fail" | "recover" => agent.post(endpoint).header("Connection", "close").send(""),
            "requests" => agent.get(endpoint).header("Connection", "close").call(),
            _ => return Err("Invalid authored fixture action."),
        }.map_err(|_| "Authored page server did not respond.")?;
        if response.status().as_u16() != 200 { return Err("Authored page server rejected its test action."); }
        let mut bytes = Vec::new();
        response.body_mut().as_reader().take(65).read_to_end(&mut bytes)
            .map_err(|_| "Could not read authored fixture response.")?;
        if bytes.len() > 64 { return Err("Authored fixture response exceeded its bound."); }
        Ok(bytes)
    }

    fn control(&self, action: &str) { self.request(action).expect("control only authored fixture pages"); }

    fn requests(&self) -> usize {
        std::str::from_utf8(&self.request("requests").unwrap()).unwrap().parse().unwrap()
    }
}

impl Drop for FixturePages {
    fn drop(&mut self) {
        let _ = self.request("recover");
        let _ = self.request("resume");
    }
}

fn stored_pages(data: &Path, number: usize) -> BTreeMap<PathBuf, Vec<u8>> {
    use base64::Engine;
    let path = data.join("downloads/mangas/Tsugi Download Fixture (EN)/Tsugi Original Comic")
        .join(format!("Cleanup chapter 0{number}"));
    let png = base64::engine::general_purpose::STANDARD.decode(PNG).unwrap();
    let mut stored = BTreeMap::<PathBuf, Vec<u8>>::new();
    for entry in fs::read_dir(path).expect("real downloader created the chapter folder") {
        let entry = entry.unwrap();
        assert!(entry.file_type().unwrap().is_file());
        let bytes = fs::read(entry.path()).unwrap();
        assert!(!bytes.is_empty() && bytes.len() <= 64 * 1024);
        if entry.path().extension().is_some_and(|extension| extension == "png") { assert_eq!(bytes, png); }
        stored.insert(entry.file_name().into(), bytes);
        assert!(stored.len() <= 8);
    }
    assert_eq!(stored.keys().filter(|path| path.extension().is_some_and(|extension| extension == "png")).count(), 2);
    stored
}

#[test]
#[ignore = "requires the pinned Windows runtime and original HTTP PNG fixture"]
fn packaged_runtime_download_actions() {
    let runtime = PathBuf::from(std::env::var_os("TSUGI_READ_RUNTIME").unwrap());
    let data = PathBuf::from(std::env::var_os("TSUGI_READ_FIXTURE").unwrap()).join("download-actions");
    assert!(!data.exists(), "download action test requires isolated new data");
    let artifact = fs::read(runtime.join("test-fixtures/tsugi-download-fixture-v1.6.1.jar")).unwrap();
    let store = FixtureStore::with_jar(Some(artifact));
    let mut managed = ReadRuntime::start(&runtime, &data).expect("start original download fixture");
    managed.add_store_inner(&store.url).unwrap();
    managed.refresh_extensions().unwrap();
    managed.mutate_extension("org.tsugi.fixture", true).unwrap();
    managed.client.mutation(
        "mutation TsugiDownloadActionFixtureSettings($input: SetSettingsInput!) { setSettings(input: $input) { settings { downloadAsCbz autoDownloadNewChapters globalUpdateInterval } } }",
        "setSettings", json!({"settings": {"downloadAsCbz": false, "autoDownloadNewChapters": false, "globalUpdateInterval": 0.0}}),
    ).unwrap();
    let catalogue = managed.catalogue("12345", 1, CatalogueMode::Popular).unwrap();
    let manga = id(&catalogue["mangas"][0]["id"]);
    managed.manga(manga).unwrap();
    managed.set_library(manga, true).unwrap();
    let initial = snapshot(&managed, manga);
    let ids = [1, 2, 3].map(|number| id(&initial["chapters"]["nodes"].as_array().unwrap().iter()
        .find(|row| row["url"] == format!("/original-comic/chapter-{number}")).unwrap()["id"]));
    for (index, id) in ids.iter().enumerate() {
        // Establish pageCount before the protected snapshot, without fetching
        // image bytes or creating a Reader session.
        managed.chapter(*id).unwrap();
        managed.client.mutation(
            "mutation TsugiDownloadActionFixtureProgress($input: UpdateChapterInput!) { updateChapter(input: $input) { chapter { id isRead isBookmarked lastPageRead lastReadAt } } }",
            "updateChapter", json!({"id": id, "patch": {"isRead": index == 0, "isBookmarked": index == 1, "lastPageRead": 1}}),
        ).unwrap();
    }
    let category = managed.save_category(None, "Original download action shelf").unwrap();
    managed.assign_category(manga, id(&category["category"]["id"]), true).unwrap();
    let protected = protected_state(snapshot(&managed, manga));
    let pages = FixturePages::new(&managed);
    assert_eq!(pages.requests(), 0, "metadata setup must not fetch page bytes");
    assert!(queue_ids(&managed.pause_downloads().unwrap()).is_empty());
    assert!(queue_ids(&managed.resume_downloads().unwrap()).is_empty());

    managed.enqueue_downloads(&ids[..1]).unwrap();
    await_downloaded(&managed, manga, &ids[..1]);
    let completed = stored_pages(&data, 1);
    assert_eq!(chapter(&snapshot(&managed, manga), ids[1])["isDownloaded"], false);
    assert_eq!(chapter(&snapshot(&managed, manga), ids[2])["isDownloaded"], false);
    assert!(managed.enqueue_downloads(&ids[..1]).is_err(), "completed chapters cannot be enqueued again");

    pages.control("pause");
    let prior_requests = pages.requests();
    managed.enqueue_downloads(&ids[1..]).unwrap();
    let mut pending = ids[1..].to_vec();
    pending.sort_unstable();
    await_status(&managed, |status| status["state"] == "STARTED" && queue_ids(status) == pending && pages.requests() > prior_requests);
    let paused = managed.pause_downloads().unwrap();
    assert_eq!(paused["state"], "STOPPED");
    assert_eq!(queue_ids(&paused), pending);
    for (position, row) in paused["queue"].as_array().unwrap().iter().enumerate() {
        assert_eq!(id(&row["mangaId"]), manga);
        assert_eq!(row["mangaTitle"], "Tsugi Original Comic");
        assert_eq!(row["chapterName"], chapter(&initial, id(&row["id"]))["name"]);
        assert_eq!(row["pageCount"], 2);
        assert_eq!(row["isDownloaded"], false);
        assert_eq!(row["state"], "QUEUED");
        assert_eq!(row["tries"], 0);
        assert_eq!(row["position"], position);
        assert_eq!(row["progress"].as_f64(), Some(0.0));
    }
    assert_eq!(queue_ids(&managed.pause_downloads().unwrap()), pending);
    assert_eq!(managed.review_extension_update("org.tsugi.fixture").err(), Some(EXTENSION_QUEUE_ERROR));
    assert_eq!(managed.mutate_extension("org.tsugi.fixture", false).err(), Some(EXTENSION_QUEUE_ERROR));
    assert!(managed.cancel_downloads(&[ids[0], ids[1]]).is_err(), "stale selection must not partially cancel valid jobs");
    assert_eq!(queue_ids(&managed.download_status().unwrap()), pending);
    let cancelled = managed.cancel_downloads(&ids[2..]).unwrap();
    assert_eq!(queue_ids(&cancelled), vec![ids[1]]);
    assert_eq!(cancelled["state"], "STOPPED");
    pages.control("resume");
    assert_eq!(managed.download_status().unwrap()["state"], "STOPPED");
    managed.resume_downloads().unwrap();
    await_downloaded(&managed, manga, &ids[..2]);
    let resumed = stored_pages(&data, 2);
    assert_eq!(stored_pages(&data, 1), completed, "cancel never removes completed media");
    assert_eq!(chapter(&snapshot(&managed, manga), ids[2])["isDownloaded"], false);
    assert_eq!(protected_state(snapshot(&managed, manga)), protected);

    pages.control("fail");
    managed.enqueue_downloads(&ids[2..]).unwrap();
    let failed = await_status(&managed, |status| status["state"] == "STOPPED"
        && queue_ids(status) == vec![ids[2]] && status["queue"][0]["state"] == "ERROR");
    assert_eq!(failed["queue"][0]["tries"], 3, "pinned downloader exhausts its three bounded retries");
    assert_eq!(chapter(&snapshot(&managed, manga), ids[2])["isDownloaded"], false);
    assert!(managed.retry_downloads(&[ids[0], ids[2]]).is_err(), "retry preflight is atomic for stale selections");
    assert_eq!(managed.resume_downloads().unwrap()["queue"][0]["state"], "ERROR", "global resume does not retry failed jobs");
    assert_eq!(managed.review_extension_update("org.tsugi.fixture").err(), Some(EXTENSION_QUEUE_ERROR));
    pages.control("pause");
    pages.control("recover");
    let prior_requests = pages.requests();
    managed.retry_downloads(&ids[2..]).unwrap();
    await_status(&managed, |status| status["state"] == "STARTED" && status["queue"][0]["state"] == "DOWNLOADING"
        && pages.requests() > prior_requests);
    let paused_retry = managed.pause_downloads().unwrap();
    assert_eq!(paused_retry["state"], "STOPPED");
    assert_eq!(queue_ids(&paused_retry), vec![ids[2]]);
    assert_eq!(paused_retry["queue"][0]["state"], "QUEUED");
    assert_eq!(protected_state(snapshot(&managed, manga)), protected);
    assert_eq!(stored_pages(&data, 1), completed);
    assert_eq!(stored_pages(&data, 2), resumed);

    managed.shutdown().expect("clean shutdown with a stopped pending queue");
    drop(pages);
    managed.restart_after_stop().expect("restart the same persisted download state");
    // The pinned runtime persists queue IDs, then automatically resumes them
    // at startup. This deliberately does not promise persistent global pause.
    await_downloaded(&managed, manga, &ids);
    stored_pages(&data, 3);
    assert!(FixturePages::new(&managed).requests() >= 2, "restored queue fetched original pages from the new JVM");
    assert_eq!(stored_pages(&data, 1), completed);
    assert_eq!(stored_pages(&data, 2), resumed);
    assert_eq!(protected_state(snapshot(&managed, manga)), protected, "downloads preserve exact identities, library, categories and reading progress");
    managed.shutdown().unwrap();
}
