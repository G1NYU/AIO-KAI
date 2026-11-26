//! Actual pinned-JVM cache coverage. Images are original fixture PNGs; no
//! public manga, source account, user download or session enters this test.
use super::*;
use super::super::tests::FixtureStore;
use std::collections::BTreeMap;
use std::os::windows::fs::OpenOptionsExt;

const SOURCE: &str = "12345";
const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAYCAIAAAB8wupbAAAAHUlEQVR4nGOsqF3FQApgIkn1qIZRDaMaRjWQrAEA4jkBz8UryC4AAAAASUVORK5CYII=";

fn id(value: &Value) -> i32 {
    value.as_i64().or_else(|| value.as_str().and_then(|value| value.parse().ok()))
        .and_then(|value| i32::try_from(value).ok()).filter(|value| *value > 0)
        .expect("positive original fixture ID")
}

fn settings(managed: &ReadRuntime, settings: Value) {
    managed.client.mutation(
        "mutation TsugiCacheFixtureSettings($input: SetSettingsInput!) { setSettings(input: $input) { settings { downloadAsCbz autoDownloadNewChapters globalUpdateInterval } } }",
        "setSettings", json!({"settings": settings}),
    ).expect("set isolated fixture settings");
}

fn state(managed: &ReadRuntime, manga: i32) -> Value {
    let mut value = managed.client.document(
        "query TsugiCacheFixtureState($id: Int!) { manga(id: $id) { id sourceId url title inLibrary categories { nodes { id name } totalCount } chapters { nodes { id url name scanlator pageCount isRead isBookmarked lastPageRead lastReadAt isDownloaded } totalCount } } }",
        "manga", json!({"id": manga}),
    ).expect("read fixture metadata without fetching images");
    for field in ["categories", "chapters"] {
        let count = value[field]["totalCount"].as_u64().unwrap();
        let rows = value[field]["nodes"].as_array_mut().unwrap();
        assert_eq!(rows.len() as u64, count);
        rows.sort_by_key(|row| id(&row["id"]));
    }
    value
}

fn queue(managed: &ReadRuntime) -> Value {
    managed.client.document(
        "query TsugiCacheFixtureQueue { downloadStatus { state queue { state chapter { id } } } }",
        "downloadStatus", json!({}),
    ).expect("read original download queue")
}

fn download(managed: &ReadRuntime, manga: i32, chapter: i32) {
    managed.client.slow().mutation(
        "mutation TsugiCacheFixtureEnqueue($input: EnqueueChapterDownloadsInput!) { enqueueChapterDownloads(input: $input) { downloadStatus { state queue { state chapter { id } } } } }",
        "enqueueChapterDownloads", json!({"ids": [chapter]}),
    ).expect("download original PNGs through the real provider");
    let deadline = Instant::now() + Duration::from_secs(45);
    loop {
        let current = state(managed, manga);
        let status = queue(managed);
        let queued = status["queue"].as_array().unwrap();
        assert!(queued.iter().all(|row| row["state"] != "ERROR"));
        if current["chapters"]["nodes"].as_array().unwrap().iter()
            .any(|row| id(&row["id"]) == chapter && row["isDownloaded"] == true)
            && status["state"] == "STOPPED" && queued.is_empty() { return; }
        assert!(Instant::now() < deadline, "original download did not complete within its bounded wait");
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn files(root: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    let mut found = BTreeMap::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(path) = pending.pop() {
        for entry in fs::read_dir(path).expect("authored fixture directory") {
            let entry = entry.unwrap();
            let meta = fs::symlink_metadata(entry.path()).unwrap();
            assert!(!meta.file_type().is_symlink());
            if meta.is_dir() {
                assert!(entry.path().strip_prefix(root).unwrap().components().count() <= 8);
                pending.push(entry.path());
            } else {
                assert!(meta.is_file() && meta.len() <= 64 * 1024);
                found.insert(entry.path().strip_prefix(root).unwrap().to_path_buf(), fs::read(entry.path()).unwrap());
                assert!(found.len() <= 100);
            }
        }
    }
    found
}

fn png(image: PageImage) {
    assert_eq!(image.mime, "image/png");
    assert_eq!(image.bytes, STANDARD.decode(PNG).unwrap());
}

#[test]
#[ignore = "requires the pinned Windows runtime and original HTTP image fixture"]
fn packaged_runtime_image_cache_cleanup() {
    let runtime = PathBuf::from(std::env::var_os("TSUGI_READ_RUNTIME").unwrap());
    let data = PathBuf::from(std::env::var_os("TSUGI_READ_FIXTURE").unwrap()).join("image-cache");
    assert!(!data.exists(), "cache test requires a new isolated data directory");
    let artifact = fs::read(runtime.join("test-fixtures/tsugi-image-cache-fixture-v1.6.1.jar")).unwrap();
    let store = FixtureStore::with_jar(Some(artifact));
    let mut managed = ReadRuntime::start(&runtime, &data).expect("start image-cache fixture");
    managed.add_store_inner(&store.url).unwrap();
    managed.refresh_extensions().unwrap();
    managed.mutate_extension("org.tsugi.fixture", true).unwrap();
    settings(&managed, json!({"downloadAsCbz": false, "autoDownloadNewChapters": false, "globalUpdateInterval": 0.0}));
    let catalogue = managed.catalogue(SOURCE, 1, CatalogueMode::Popular).unwrap();
    let manga = id(&catalogue["mangas"][0]["id"]);
    managed.manga(manga).unwrap();
    // A non-library cover uses the disposable cache. Library covers also have
    // a permanent download copy, which must survive this cleanup.
    png(managed.thumbnail(manga).expect("fetch real cached thumbnail"));
    managed.set_library(manga, true).unwrap();
    png(managed.thumbnail(manga).expect("create protected library thumbnail"));
    let initial = state(&managed, manga);
    let chapters = [1, 2, 3].map(|number| id(&initial["chapters"]["nodes"].as_array().unwrap().iter()
        .find(|row| row["url"] == format!("/original-comic/chapter-{number}")).unwrap()["id"]));
    download(&managed, manga, chapters[0]);
    let pages = managed.chapter(chapters[1]).unwrap();
    for index in 0..2 { png(managed.page(&pages, index).unwrap()); }
    managed.save_progress(&pages, 1, false).unwrap();
    drop(pages);
    managed.update_chapter_flags(&[chapters[0]], Some(true), None).unwrap();
    managed.update_chapter_flags(&[chapters[1]], None, Some(true)).unwrap();
    let category = managed.save_category(None, "Original image-cache shelf").unwrap();
    managed.assign_category(manga, id(&category["category"]["id"]), true).unwrap();

    let pages_root = data.join("runtime-temp/Tachidesk/manga-cache");
    let covers_root = data.join("runtime-temp/Tachidesk/thumbnails");
    let cached_pages = files(&pages_root);
    let cached_covers = files(&covers_root);
    assert!(cached_pages.len() >= 2 && !cached_covers.is_empty(), "both actual JVM cache providers must be populated");
    let downloads = files(&data.join("downloads"));
    assert!(downloads.keys().any(|path| path.starts_with("mangas")));
    assert!(downloads.keys().any(|path| path.starts_with("thumbnails")));
    let before = state(&managed, manga);
    let sentinels = [
        "cache/kcef/original-fixture-profile/Cookies",
        "settings/original-cache-fixture.bin",
        "runtime-temp/Tachidesk/keep-original.bin",
        "original-local-media/keep-original.epub",
    ];
    for relative in sentinels {
        let path = data.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b"original preservation fixture, no account data").unwrap();
    }

    let cancelled = managed.review_image_cache_cleanup().unwrap();
    let expected_files = (cached_pages.len() + cached_covers.len()) as u64;
    let expected_bytes = cached_pages.values().chain(cached_covers.values()).map(|bytes| bytes.len() as u64).sum::<u64>();
    assert_eq!(cancelled.preview()["totalFiles"], expected_files);
    assert_eq!(cancelled.preview()["totalBytes"], expected_bytes);
    assert_eq!(cancelled.preview()["groups"][0]["files"], cached_pages.len());
    assert_eq!(cancelled.preview()["groups"][1]["files"], cached_covers.len());
    drop(cancelled);
    assert_eq!(files(&pages_root), cached_pages);
    assert_eq!(files(&covers_root), cached_covers);

    settings(&managed, json!({"autoDownloadNewChapters": true}));
    assert!(managed.review_image_cache_cleanup().is_err(), "automatic jobs must be disabled");
    settings(&managed, json!({"autoDownloadNewChapters": false}));

    let stale = managed.review_image_cache_cleanup().unwrap();
    let added = pages_root.join("original-stale-review.png");
    fs::write(&added, STANDARD.decode(PNG).unwrap()).unwrap();
    let message = managed.apply_reviewed_image_cache_cleanup(stale).expect_err("a changed cache must require a new review");
    assert!(message.contains("No images were removed"));
    assert_eq!(fs::read(&added).unwrap(), STANDARD.decode(PNG).unwrap());
    fs::remove_file(&added).unwrap();
    assert_eq!(files(&pages_root), cached_pages);
    assert_eq!(files(&covers_root), cached_covers);
    assert_eq!(state(&managed, manga), before);

    let locked_path = pages_root.join(cached_pages.keys().next().unwrap());
    let locked = fs::OpenOptions::new().read(true).share_mode(3).open(&locked_path).unwrap();
    let review = managed.review_image_cache_cleanup().unwrap();
    let message = managed.apply_reviewed_image_cache_cleanup(review).expect_err("a file denying delete sharing must refuse before removal");
    assert!(message.contains("No images were removed"));
    assert_eq!(files(&pages_root), cached_pages);
    assert_eq!(files(&covers_root), cached_covers);
    drop(locked);

    let review = managed.review_image_cache_cleanup().unwrap();
    let review_id = review.id().to_owned();
    let result = managed.apply_reviewed_image_cache_cleanup(review).expect("remove reviewed real cached images");
    assert_eq!(result["reviewId"], review_id);
    assert_eq!(result["status"], "removed");
    assert_eq!(result["runtimeReady"], true);
    assert_eq!(result["removedFiles"], expected_files);
    assert_eq!(result["removedBytes"], expected_bytes);
    assert!(files(&pages_root).is_empty() && files(&covers_root).is_empty());
    assert_eq!(files(&data.join("downloads")), downloads);
    assert_eq!(state(&managed, manga), before);
    for relative in sentinels {
        assert_eq!(fs::read(data.join(relative)).unwrap(), b"original preservation fixture, no account data");
    }

    // Retained local pages and covers stay readable. The undownloaded chapter
    // then regenerates its cache through the newly started original server.
    png(managed.thumbnail(manga).unwrap());
    let saved = managed.chapter(chapters[0]).unwrap();
    for index in 0..2 { png(managed.page(&saved, index).unwrap()); }
    drop(saved);
    assert!(files(&pages_root).is_empty() && files(&covers_root).is_empty());
    let fresh = managed.chapter(chapters[1]).unwrap();
    for index in 0..2 { png(managed.page(&fresh, index).unwrap()); }
    drop(fresh);
    assert_eq!(files(&pages_root), cached_pages);
    assert_eq!(files(&data.join("downloads")), downloads);
    assert_eq!(state(&managed, manga), before);

    managed.shutdown().unwrap();
    drop(managed);
    let mut reopened = ReadRuntime::start(&runtime, &data).expect("reopen after cache regeneration");
    assert_eq!(state(&reopened, manga), before);
    assert_eq!(files(&data.join("downloads")), downloads);
    reopened.shutdown().unwrap();
    drop(store);
    eprintln!("PASS: real cached pages/thumbnails, stale and locked refusals, preserved downloads/metadata/sessions, regeneration and restart.");
}
