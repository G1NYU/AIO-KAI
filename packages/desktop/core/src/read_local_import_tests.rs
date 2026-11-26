//! Packaged-runtime local CBZ imports, using only authored PNG/JPEG fixtures.
//! Source 0 reads generated image folders; no online source is installed.
use super::*;
use std::collections::BTreeMap;

fn fixture_id(value: &Value) -> i32 {
    value.as_i64().and_then(|value| i32::try_from(value).ok()).filter(|value| *value > 0).unwrap()
}

fn local_snapshot(managed: &ReadRuntime, id: i32) -> Value {
    managed.client.document(
        "query TsugiLocalImportFixtureState($id: Int!) { manga(id: $id) { id sourceId url title initialized inLibrary categories { nodes { id name } totalCount } chapters { nodes { id mangaId url name pageCount isRead isBookmarked lastPageRead lastReadAt isDownloaded } totalCount } } }",
        "manga", json!({"id": id}),
    ).expect("read exact local comic identities and saved progress")
}

fn assert_staging_empty(data: &Path) {
    assert_eq!(fs::read_dir(data.join(STAGES)).unwrap().count(), 0, "native-owned staging is removed after each terminal result");
}

fn local_files(data: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    let root = data.join("local");
    let mut pending = vec![PathBuf::new()];
    let mut files = BTreeMap::new();
    while let Some(relative) = pending.pop() {
        for entry in fs::read_dir(root.join(&relative)).unwrap() {
            let entry = entry.unwrap();
            let path = relative.join(entry.file_name());
            let kind = entry.file_type().unwrap();
            assert!(!kind.is_symlink());
            if kind.is_dir() { pending.push(path); }
            else {
                assert!(kind.is_file());
                let bytes = fs::read(entry.path()).unwrap();
                assert!(bytes.len() <= 64 * 1024, "small authored image/metadata fixture only");
                files.insert(path, bytes);
                assert!(files.len() <= 20);
            }
        }
    }
    files
}

fn read_original_pages(managed: &ReadRuntime, manga: i32, expected: &[Vec<u8>]) -> ChapterPages {
    let state = local_snapshot(managed, manga);
    assert_eq!(state["sourceId"], "0");
    assert_eq!(state["chapters"]["totalCount"], 1);
    let chapter = fixture_id(&state["chapters"]["nodes"][0]["id"]);
    let pages = managed.chapter(chapter).expect("open imported local image chapter");
    assert_eq!(pages.len(), expected.len());
    for (index, expected) in expected.iter().enumerate() {
        let image = managed.page(&pages, index).expect("read authored imported page through the existing Reader broker");
        assert_eq!(image.bytes, *expected, "natural 1,2,10 ordering and exact original page bytes");
        assert_eq!(image.mime, if index == 1 { "image/jpeg" } else { "image/png" });
    }
    pages
}

#[test]
#[ignore = "requires the pinned Windows runtime and authored local CBZ fixtures"]
fn packaged_runtime_local_cbz_import() {
    let runtime = PathBuf::from(std::env::var_os("TSUGI_READ_RUNTIME").unwrap());
    let parent = PathBuf::from(std::env::var_os("TSUGI_READ_FIXTURE").unwrap());
    let data = parent.join("local-import");
    let inputs = parent.join("local-import-inputs");
    assert!(!data.exists() && !inputs.exists(), "isolated local import fixture directories");
    fs::create_dir(&inputs).unwrap();
    let fixtures = runtime.join("test-fixtures");
    let selected = inputs.join("Original Local Comic.cbz");
    let renamed = inputs.join("Renamed Same Bytes.cbz");
    let deflated = inputs.join("Deflated Original Comic.cbz");
    let hostile = inputs.join("Hostile Original Fixture.cbz");
    fs::copy(fixtures.join("tsugi-local-import-stored.cbz"), &selected).unwrap();
    fs::copy(&selected, &renamed).unwrap();
    fs::copy(fixtures.join("tsugi-local-import-deflated.cbz"), &deflated).unwrap();
    fs::copy(fixtures.join("tsugi-local-import-traversal.cbz"), &hostile).unwrap();
    let selected_bytes = fs::read(&selected).unwrap();
    let deflated_bytes = fs::read(&deflated).unwrap();
    let expected = ["1.png", "2.jpg", "10.png"].map(|name| fs::read(fixtures.join(format!("tsugi-local-import-page-{name}"))).unwrap());
    let stopped = AtomicBool::new(false);
    let mut managed = ReadRuntime::start(&runtime, &data).expect("start isolated runtime for local source 0");
    let sources = managed.query(ReadOperation::Sources).unwrap();
    assert!(sources["nodes"].as_array().unwrap().iter().all(|source| source["id"] == "0"), "no online fixture or provider source is installed");

    assert!(managed.review_local_import(&hostile, &stopped).is_err(), "hostile paths rejected before publication");
    assert!(!data.join("outside.png").exists() && !inputs.join("outside.png").exists());
    assert_staging_empty(&data);
    assert!(managed.review_local_import(&selected, &AtomicBool::new(true)).is_err(), "cancelled copy cannot publish");
    assert_staging_empty(&data);
    let cancelled = managed.review_local_import(&selected, &stopped).unwrap();
    assert_eq!(cancelled.preview()["pageCount"], 3);
    assert_eq!(cancelled.preview()["duplicate"], false);
    assert!(local_files(&data).is_empty(), "review has not published the comic");
    drop(cancelled);
    assert_staging_empty(&data);
    assert!(local_files(&data).is_empty());

    let stale = managed.review_local_import(&selected, &stopped).unwrap();
    let changed = stale.stage.path().join("book").join(CHAPTER).join("0001.png");
    let mut changed_bytes = fs::read(&changed).unwrap(); changed_bytes.push(0);
    fs::write(&changed, changed_bytes).unwrap();
    assert!(managed.apply_local_import(stale).is_err(), "changed reviewed page cannot be published");
    assert_staging_empty(&data);
    assert!(local_files(&data).is_empty());

    let review = managed.review_local_import(&selected, &stopped).unwrap();
    let preview = review.preview();
    let folder = format!("tsugi-cbz-{}", preview["archiveSha256"].as_str().unwrap());
    let imported = managed.apply_local_import(review).unwrap();
    assert_eq!(imported["status"], "imported", "registration must complete in the pinned GraphQL runtime");
    assert_eq!(imported["title"], "Original Local Comic");
    let manga = fixture_id(&imported["mangaId"]);
    assert_staging_empty(&data);
    let pages = read_original_pages(&managed, manga, &expected);
    managed.save_progress(&pages, 1, false).unwrap();
    let chapter = pages.chapter_id;
    drop(pages);
    managed.update_chapter_flags(&[chapter], None, Some(true)).unwrap();
    let category = managed.save_category(None, "Original local comics").unwrap();
    managed.assign_category(manga, fixture_id(&category["category"]["id"]), true).unwrap();
    let state = local_snapshot(&managed, manga);
    assert_eq!(state["url"], folder);
    assert_eq!(state["title"], "Original Local Comic");
    assert_eq!(state["inLibrary"], true);
    assert_eq!(state["chapters"]["nodes"][0]["pageCount"], 3);
    assert_eq!(state["chapters"]["nodes"][0]["lastPageRead"], 1);
    assert_eq!(state["chapters"]["nodes"][0]["isBookmarked"], true);
    let backup = managed.backup_manga(manga).unwrap();
    assert_eq!(backup["sourceId"], "0", "local identities participate in existing metadata backups");
    let imported_files = local_files(&data);
    assert!(!imported_files.keys().any(|name| name.extension().is_some_and(|extension| extension == "cbz")), "runtime reads generated images rather than retained ZIP handles");
    // Upstream local catalogue discovery starts from folder names. Browsing
    // must retain the reviewed friendly title and all existing reading state;
    // title search must also find it without knowing its generated hash path.
    for mode in [CatalogueMode::Popular, CatalogueMode::Search("lOcAl cOm")] {
        let catalogue = managed.catalogue("0", 1, mode).expect("browse/search imported local title");
        let rows = catalogue["mangas"].as_array().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["id"], manga);
        assert_eq!(rows[0]["title"], "Original Local Comic");
        assert_eq!(rows[0]["sourceId"], "0");
        assert_eq!(catalogue["hasNextPage"], false);
        assert_eq!(local_snapshot(&managed, manga), state, "local catalogue preserves exact identities, title, category, bookmark and progress");
        assert_eq!(managed.backup_manga(manga).unwrap(), backup);
    }
    let missing = managed.catalogue("0", 1, CatalogueMode::Search("no authored title matches this")).unwrap();
    assert!(missing["mangas"].as_array().unwrap().is_empty(), "friendly-title search must keep its filter");
    assert_eq!(local_files(&data), imported_files);
    let duplicate = managed.review_local_import(&renamed, &stopped).unwrap();
    assert_eq!(duplicate.preview()["duplicate"], true);
    assert_eq!(duplicate.preview()["title"], "Original Local Comic", "same bytes retain the first title regardless of selected filename");
    let reused = managed.apply_local_import(duplicate).unwrap();
    assert_eq!(reused["status"], "already-imported");
    assert_eq!(reused["mangaId"], manga);
    assert_eq!(local_snapshot(&managed, manga), state);
    assert_eq!(managed.backup_manga(manga).unwrap(), backup);
    assert_eq!(local_files(&data), imported_files);
    assert_staging_empty(&data);

    // Simulate an interrupted application after immutable media publication,
    // before database registration. Fresh review must finish this exact book.
    let interrupted = managed.review_local_import(&deflated, &stopped).unwrap();
    let second_folder = format!("tsugi-cbz-{}", interrupted.preview()["archiveSha256"].as_str().unwrap());
    assert_ne!(second_folder, folder, "archive-byte identity distinguishes different encodings");
    fs::rename(interrupted.stage.path().join("book"), data.join("local").join(&second_folder)).unwrap();
    drop(interrupted);
    assert_staging_empty(&data);
    let recovery = managed.review_local_import(&deflated, &stopped).unwrap();
    assert_eq!(recovery.preview()["duplicate"], true);
    let recovered = managed.apply_local_import(recovery).unwrap();
    assert_eq!(recovered["status"], "imported", "fresh review registers previously published media");
    let second = fixture_id(&recovered["mangaId"]);
    assert_ne!(second, manga);
    drop(read_original_pages(&managed, second, &expected));
    assert_eq!(local_snapshot(&managed, manga), state);
    let both_files = local_files(&data);

    let custom = inputs.join("custom-local"); fs::create_dir(&custom).unwrap();
    managed.client.mutation(
        "mutation TsugiLocalImportFixtureRoot($input: SetSettingsInput!) { setSettings(input: $input) { settings { localSourcePath } } }",
        "setSettings", json!({"settings": {"localSourcePath": custom.to_str().unwrap()}}),
    ).unwrap();
    assert!(managed.review_local_import(&selected, &stopped).is_err(), "custom source roots remain outside managed import");
    assert_eq!(fs::read_dir(&custom).unwrap().count(), 0);
    managed.client.mutation(
        "mutation TsugiLocalImportFixtureRoot($input: SetSettingsInput!) { setSettings(input: $input) { settings { localSourcePath } } }",
        "setSettings", json!({"settings": {"localSourcePath": ""}}),
    ).unwrap();
    assert_eq!(local_files(&data), both_files);
    assert_staging_empty(&data);
    assert_eq!(fs::read(&selected).unwrap(), selected_bytes);
    assert_eq!(fs::read(&deflated).unwrap(), deflated_bytes);
    managed.shutdown().unwrap();
    managed.restart_after_stop().expect("restart persisted local comic library");
    assert_eq!(local_snapshot(&managed, manga), state);
    assert_eq!(managed.backup_manga(manga).unwrap(), backup);
    drop(read_original_pages(&managed, manga, &expected));
    drop(read_original_pages(&managed, second, &expected));
    let repeated = managed.apply_local_import(managed.review_local_import(&renamed, &stopped).unwrap()).unwrap();
    assert_eq!(repeated["status"], "already-imported");
    assert_eq!(repeated["mangaId"], manga);
    assert_eq!(local_snapshot(&managed, manga), state);
    assert_eq!(local_files(&data), both_files);
    assert_staging_empty(&data);
    managed.shutdown().unwrap();
}
