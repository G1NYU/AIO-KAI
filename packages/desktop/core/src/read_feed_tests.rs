//! Real Feed catalogue and complete source-inventory regression coverage.
//! All sources and pages are authored fixtures in a new disposable runtime.
use super::*;
use super::tests::FixtureStore;
use std::collections::BTreeSet;
use std::path::PathBuf;

const FEED_SOURCE: &str = "12345";
const LAST_FEED_SOURCE: &str = "9007199254740993";
const ORIGINAL_PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAYCAIAAAB8wupbAAAAHUlEQVR4nGOsqF3FQApgIkn1qIZRDaMaRjWQrAEA4jkBz8UryC4AAAAASUVORK5CYII=";

fn feed_id(value: &Value) -> i32 {
    value.as_i64().and_then(|value| i32::try_from(value).ok()).filter(|value| *value > 0)
        .expect("positive original Feed fixture ID")
}

fn feed_inventory(managed: &ReadRuntime) -> Value {
    let inventory = managed.source_inventory().expect("scan the complete authored source inventory");
    assert_eq!(inventory["complete"], true);
    let rows = inventory["nodes"].as_array().unwrap();
    assert!(inventory["totalCount"].as_u64().unwrap() >= 101);
    assert!(rows.len() > 100, "the fixture must cross the actual raw source page boundary");
    let expected = (12345..12445).map(|id| id.to_string())
        .chain(std::iter::once(LAST_FEED_SOURCE.to_owned())).collect::<BTreeSet<_>>();
    let actual = rows.iter().filter(|row| row["name"].as_str().is_some_and(|name| name.starts_with("Tsugi Feed Fixture")))
        .map(|row| row["id"].as_str().unwrap().to_owned()).collect::<BTreeSet<_>>();
    assert_eq!(actual, expected);
    for (id, latest) in [(FEED_SOURCE, true), (LAST_FEED_SOURCE, false)] {
        let source = rows.iter().find(|row| row["id"] == id).expect("installed source remains visible by exact string ID");
        assert_eq!(source["lang"], "en");
        assert_eq!(source["supportsLatest"], latest);
        assert!(source["displayName"].as_str().unwrap().ends_with(" (EN)"));
    }
    inventory
}

fn feed_page(managed: &ReadRuntime, mode: CatalogueMode<'_>, page: u32, title: Option<&str>) -> Option<i32> {
    let catalogue = managed.catalogue(FEED_SOURCE, page, mode).expect("fetch only the requested original Feed page");
    assert_eq!(catalogue["hasNextPage"], page == 1);
    let rows = catalogue["mangas"].as_array().unwrap();
    match title {
        Some(title) => {
            assert_eq!(rows.len(), 1);
            assert_eq!(rows[0]["title"], title);
            assert_eq!(rows[0]["sourceId"], FEED_SOURCE);
            Some(feed_id(&rows[0]["id"]))
        }
        None => {
            assert!(rows.is_empty());
            None
        }
    }
}

fn feed_state(managed: &ReadRuntime, manga: i32) -> Value {
    let mut snapshot = managed.client.document(
        "query TsugiFeedFixtureState($id: Int!) { manga(id: $id) { id sourceId url title inLibrary categories { nodes { id name order } totalCount } chapters { nodes { id url name pageCount isRead isBookmarked lastPageRead lastReadAt isDownloaded } totalCount } } }",
        "manga", json!({"id": manga}),
    ).expect("read cached Feed fixture state without source work");
    for field in ["categories", "chapters"] {
        let count = snapshot[field]["totalCount"].as_u64().unwrap();
        let rows = snapshot[field]["nodes"].as_array_mut().unwrap();
        assert_eq!(rows.len() as u64, count);
        rows.sort_by_key(|row| feed_id(&row["id"]));
    }
    snapshot
}

#[test]
#[ignore = "requires the pinned Windows runtime and original Feed fixture"]
fn packaged_runtime_feed_catalogues_preserve_reading_state() {
    let runtime = PathBuf::from(std::env::var_os("TSUGI_READ_RUNTIME").unwrap());
    let data = PathBuf::from(std::env::var_os("TSUGI_READ_FIXTURE").unwrap()).join("feed");
    assert!(!data.try_exists().expect("inspect new Feed fixture root"), "Feed requires a fresh isolated data directory");
    let jar = fs::read(runtime.join("test-fixtures/tsugi-feed-fixture-v1.6.1.jar"))
        .expect("compiled original Feed extension fixture");
    assert!(jar.starts_with(b"PK") && jar.len() < 1024 * 1024);
    let store = FixtureStore::with_jar(Some(jar));
    let mut managed = ReadRuntime::start(&runtime, &data).expect("start isolated Feed runtime");
    managed.add_store_inner(&store.url).unwrap();
    managed.refresh_extensions().unwrap();
    managed.mutate_extension("org.tsugi.fixture", true).expect("install original Feed source factory");
    let inventory = feed_inventory(&managed);
    let searchable = managed.query(ReadOperation::Sources).expect("discover global search sources without management metadata");
    assert_eq!(searchable["complete"], true);
    assert_eq!(searchable["totalCount"], inventory["totalCount"]);
    let ids = |value: &Value| value["nodes"].as_array().unwrap().iter()
        .map(|row| row["id"].as_str().unwrap().to_owned()).collect::<BTreeSet<_>>();
    assert_eq!(ids(&searchable), ids(&inventory));
    assert!(searchable["nodes"].as_array().unwrap().iter().all(|row| row.get("extension").is_none()));
    assert!(ids(&searchable).contains(LAST_FEED_SOURCE), "global search must include sources beyond the first 100 rows");

    let manga = feed_page(&managed, CatalogueMode::Popular, 1, Some("Tsugi Original Comic")).unwrap();
    let details = managed.manga(manga).expect("fetch authored chapter identities before saving progress");
    let chapter = details["chapters"].as_array().unwrap().iter()
        .find(|row| row["name"] == "Cleanup chapter 01").map(|row| feed_id(&row["id"])).unwrap();
    managed.set_library(manga, true).unwrap();
    let pages = managed.chapter(chapter).expect("open two real authored pages");
    assert_eq!(pages.len(), 2);
    for index in 0..2 {
        let image = managed.page(&pages, index).unwrap();
        assert_eq!(image.mime, "image/png");
        assert_eq!(image.bytes, STANDARD.decode(ORIGINAL_PNG).unwrap());
    }
    managed.save_progress(&pages, 1, true).unwrap();
    drop(pages);
    managed.update_chapter_flags(&[chapter], None, Some(true)).unwrap();
    let category = managed.save_category(None, "Original Feed shelf").unwrap();
    managed.assign_category(manga, feed_id(&category["category"]["id"]), true).unwrap();
    let before = feed_state(&managed, manga);
    let chapter_state = before["chapters"]["nodes"].as_array().unwrap().iter()
        .find(|row| feed_id(&row["id"]) == chapter).unwrap();
    assert_eq!(before["inLibrary"], true);
    assert_eq!(before["categories"]["nodes"][0]["name"], "Original Feed shelf");
    assert_eq!(chapter_state["isRead"], true);
    assert_eq!(chapter_state["isBookmarked"], true);
    assert_eq!(chapter_state["lastPageRead"], 1);
    assert_eq!(chapter_state["pageCount"], 2);
    let library_before = managed.library_page(0).unwrap();

    let cases = [
        (CatalogueMode::Popular, 1, Some("Tsugi Original Comic")),
        (CatalogueMode::Popular, 2, Some("Tsugi Feed Popular 2")),
        (CatalogueMode::Popular, 3, None),
        (CatalogueMode::Latest, 1, Some("Tsugi Feed Latest 1")),
        (CatalogueMode::Latest, 2, Some("Tsugi Feed Latest 2")),
        (CatalogueMode::Latest, 3, None),
    ];
    let mut discovered = BTreeSet::new();
    for (mode, page, title) in cases {
        if let Some(id) = feed_page(&managed, mode, page, title) { assert!(discovered.insert(id)); }
        assert_eq!(feed_state(&managed, manga), before, "each discovery page preserves exact stored reading state");
        assert_eq!(managed.library_page(0).unwrap(), library_before, "Feed discovery must not add new library entries");
    }
    assert_eq!(discovered.len(), 4);
    assert!(discovered.contains(&manga));
    assert_eq!(feed_inventory(&managed), inventory);

    managed.shutdown().unwrap();
    drop(managed);
    managed = ReadRuntime::start(&runtime, &data).expect("reopen persisted Feed source and reading state");
    assert_eq!(feed_inventory(&managed), inventory);
    assert_eq!(feed_state(&managed, manga), before);
    assert_eq!(managed.library_page(0).unwrap(), library_before);
    assert_eq!(feed_page(&managed, CatalogueMode::Popular, 1, Some("Tsugi Original Comic")), Some(manga));
    assert_eq!(feed_state(&managed, manga), before);
    managed.shutdown().unwrap();
    drop(managed);
    drop(store);
    fs::remove_dir_all(data).expect("remove only the disposable authored Feed fixture");
    eprintln!("PASS: complete source inventory crossed 100 rows with exact LongString IDs; distinct Popular/Latest pages preserved library, categories, bookmarks and page progress across restart.");
}
