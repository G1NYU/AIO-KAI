//! Actual pinned-runtime metadata and filtering tests with authored sources.
//! No external repository, provider media or user credentials are involved.
use super::*;
use crate::bridge::ReadContentWarning;
use std::collections::BTreeSet;
use std::net::{Ipv4Addr, TcpListener};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, atomic::{AtomicBool, AtomicUsize, Ordering}};
use std::thread::JoinHandle;

const PRIMARY: &str = "org.tsugi.fixture";
const PREFIX: &str = "org.tsugi.metadata.";
const LARGE_SOURCE: &str = "9007199254740993";

fn varint(mut value: u64, out: &mut Vec<u8>) {
    while value >= 128 { out.push((value as u8 & 127) | 128); value >>= 7; }
    out.push(value as u8);
}
fn field(out: &mut Vec<u8>, number: u64, value: &[u8]) {
    varint(number << 3 | 2, out); varint(value.len() as u64, out); out.extend_from_slice(value);
}
fn scalar(out: &mut Vec<u8>, number: u64, value: u64) { varint(number << 3, out); varint(value, out); }

fn source(id: u64, name: &str, language: &str) -> Vec<u8> {
    let mut source = Vec::new();
    scalar(&mut source, 1, id); field(&mut source, 2, name.as_bytes()); field(&mut source, 3, language.as_bytes());
    source
}

fn extension(name: &str, package: &str, rating: u64, sources: Vec<Vec<u8>>, version: u64, jar: Option<&str>, base: &str) -> Vec<u8> {
    let mut resources = Vec::new();
    field(&mut resources, 1, format!("{base}/metadata-only.apk").as_bytes());
    field(&mut resources, 2, format!("{base}/original.png").as_bytes());
    if let Some(jar) = jar { field(&mut resources, 501, jar.as_bytes()); }
    let mut extension = Vec::new();
    field(&mut extension, 1, name.as_bytes()); field(&mut extension, 2, package.as_bytes());
    field(&mut extension, 3, &resources); field(&mut extension, 4, b"1.6");
    scalar(&mut extension, 5, version); field(&mut extension, 6, format!("1.6.{version}").as_bytes());
    // Protobuf ratings are wire values: unspecified=0, SAFE=1, MIXED=2, NSFW=3.
    scalar(&mut extension, 7, rating);
    for source in sources { field(&mut extension, 8, &source); }
    extension
}

fn metadata_index(base: &str, version: Option<u64>) -> Vec<u8> {
    let mut list = Vec::new();
    for index in 0..120 {
        let package = format!("{PREFIX}general{index:03}");
        field(&mut list, 1, &extension(&format!("Original General {index:03}"), &package, 1,
            vec![source(1_000_000 + index, "Original English", "en")], 1, None, base));
    }
    for (suffix, name, rating, id, language) in [
        ("unspecified", "Original Unspecified", 0, 1_200_000, "fr"),
        ("mixed", "Original Mixed", 2, 1_200_001, "fr"),
        ("adult", "Original Adult", 3, 1_200_002, "ja"),
    ] {
        field(&mut list, 1, &extension(name, &format!("{PREFIX}{suffix}"), rating,
            vec![source(id, name, language)], 1, None, base));
    }
    field(&mut list, 1, &extension("Original Multilingual", &format!("{PREFIX}multilingual"), 1,
        vec![source(1_300_000, "Original English", "en"), source(1_300_001, "Original Japanese", "ja")], 1, None, base));
    if let Some(version) = version {
        let mut sources = (0..102).map(|index| source(20_000 + index, &format!("Tsugi Metadata English {index:03}"), "en")).collect::<Vec<_>>();
        sources.push(source(20_102, "Tsugi Metadata French", "fr"));
        sources.push(source(20_103, "Tsugi Metadata Japanese", "ja"));
        sources.push(source(9_007_199_254_740_993, "Tsugi Metadata All languages", "all"));
        field(&mut list, 1, &extension("Tsugi Metadata Fixture", PRIMARY, 2, sources, version,
            Some(&format!("{base}/tsugi-metadata-fixture-v1.6.1.jar")), base));
    }
    let mut contact = Vec::new(); field(&mut contact, 1, b"https://example.invalid");
    let mut store = Vec::new();
    field(&mut store, 1, b"Original Metadata Store"); field(&mut store, 2, b"Fixture");
    field(&mut store, 3, b"0000000000000000000000000000000000000000000000000000000000000000");
    field(&mut store, 4, &contact); field(&mut store, 101, &list);
    store
}

struct MetadataStore {
    url: String,
    body: Arc<Mutex<Vec<u8>>>,
    stop: Arc<AtomicBool>,
    artifacts: Arc<AtomicUsize>,
    worker: Option<JoinHandle<()>>,
}
impl MetadataStore {
    fn start(jar: Vec<u8>) -> Self {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let body = Arc::new(Mutex::new(metadata_index(&base, Some(1))));
        let stop = Arc::new(AtomicBool::new(false));
        let artifacts = Arc::new(AtomicUsize::new(0));
        let (published, stopped, served) = (Arc::clone(&body), Arc::clone(&stop), Arc::clone(&artifacts));
        let worker = std::thread::spawn(move || {
            while !stopped.load(Ordering::Acquire) {
                let Ok((mut stream, _)) = listener.accept() else { std::thread::sleep(Duration::from_millis(20)); continue; };
                // Accepted Winsock sockets may inherit the listener's mode.
                stream.set_nonblocking(false).expect("blocking original metadata fixture connection");
                stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
                stream.set_write_timeout(Some(Duration::from_secs(2))).unwrap();
                let mut request = Vec::new();
                for byte in (&mut stream).bytes().take(8192) {
                    let Ok(byte) = byte else { break }; request.push(byte);
                    if request.ends_with(b"\r\n\r\n") { break; }
                }
                let body = published.lock().unwrap();
                let response = if request.starts_with(b"GET /index.pb HTTP/1.") { Some(body.as_slice()) }
                    else if request.starts_with(b"GET /tsugi-metadata-fixture-v1.6.1.jar HTTP/1.") {
                        served.fetch_add(1, Ordering::Relaxed); Some(jar.as_slice())
                    } else { None };
                if let Some(response) = response {
                    let header = format!("HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", response.len());
                    let _ = stream.write_all(header.as_bytes()); let _ = stream.write_all(response);
                } else { let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"); }
            }
        });
        Self { url: format!("{base}/index.pb"), body, stop, artifacts, worker: Some(worker) }
    }
    fn publish(&self, version: Option<u64>) {
        *self.body.lock().unwrap() = metadata_index(self.url.strip_suffix("/index.pb").unwrap(), version);
    }
}
impl Drop for MetadataStore {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() { worker.join().unwrap(); }
    }
}

fn rows(page: &Value, total: u64, count: usize) -> &[Value] {
    assert_eq!(page["totalCount"].as_u64(), Some(total));
    let rows = page["nodes"].as_array().expect("bounded original metadata rows");
    assert_eq!(rows.len(), count);
    rows
}
fn packages(page: &Value) -> BTreeSet<String> {
    page["nodes"].as_array().unwrap().iter().map(|row| row["pkgName"].as_str().unwrap().to_owned()).collect()
}

fn inventory(managed: &ReadRuntime, store: &MetadataStore, updates: bool, obsolete: bool) -> Value {
    let inventory = managed.source_inventory().expect("complete original installed-source metadata");
    assert_eq!(inventory["complete"], true);
    let nodes = inventory["nodes"].as_array().unwrap();
    assert!(inventory["totalCount"].as_u64().unwrap() >= 105 && nodes.len() > 100);
    let owned = nodes.iter().filter(|row| row["extension"]["pkgName"] == PRIMARY).collect::<Vec<_>>();
    assert_eq!(owned.len(), 105);
    let expected = (20_000..20_104).map(|id| id.to_string()).chain(std::iter::once(LARGE_SOURCE.to_owned())).collect::<BTreeSet<_>>();
    assert_eq!(owned.iter().map(|row| row["id"].as_str().unwrap().to_owned()).collect::<BTreeSet<_>>(), expected);
    for (language, count) in [("en", 102), ("fr", 1), ("ja", 1), ("all", 1)] {
        assert_eq!(owned.iter().filter(|row| row["lang"] == language).count(), count);
    }
    for source in &owned {
        assert_eq!(source["contentWarning"], "MIXED");
        assert_eq!(source["isConfigurable"], true);
        assert_eq!(source["supportsLatest"], source["id"] == "20000");
        let extension = &source["extension"];
        assert_eq!(extension["name"], "Tsugi Metadata Fixture");
        assert_eq!(extension["versionName"], "1.6.1");
        assert_eq!(extension["versionCodeLong"], "1");
        assert!(extension["storeIndexUrl"] == store.url, "the installed source retains its registered store identity");
        assert_eq!(extension["isInstalled"], true);
        assert_eq!(extension["hasUpdate"], updates);
        assert_eq!(extension["isObsolete"], obsolete);
    }
    assert_eq!(owned.iter().find(|row| row["id"] == LARGE_SOURCE).unwrap()["lang"], "all");
    inventory
}

fn saved_state(managed: &ReadRuntime, manga: i32) -> Value {
    json!({"details": managed.cached_manga(manga).unwrap(), "library": managed.library_page(0).unwrap(),
        "categories": managed.query(ReadOperation::Categories).unwrap()})
}

#[test]
#[ignore = "requires the pinned Windows runtime and original metadata fixture"]
fn packaged_runtime_metadata_filters_preserve_reading_state() {
    let runtime = PathBuf::from(std::env::var_os("TSUGI_READ_RUNTIME").unwrap());
    let data = PathBuf::from(std::env::var_os("TSUGI_READ_FIXTURE").unwrap()).join("metadata");
    assert!(!data.try_exists().unwrap(), "metadata fixture requires a fresh isolated directory");
    let jar = fs::read(runtime.join("test-fixtures/tsugi-metadata-fixture-v1.6.1.jar")).unwrap();
    assert!(jar.starts_with(b"PK") && jar.len() < 1024 * 1024);
    let store = MetadataStore::start(jar);
    let mut managed = ReadRuntime::start(&runtime, &data).expect("start isolated metadata runtime");
    managed.add_store_inner(&store.url).unwrap(); managed.refresh_extensions().unwrap();
    let first = managed.filter_extensions_with_metadata(0, "", Some(&store.url), None, None, false, false, None).unwrap();
    rows(&first, 125, 100);
    let second = managed.filter_extensions_with_metadata(100, "", Some(&store.url), None, None, false, false, None).unwrap();
    rows(&second, 125, 25);
    assert!(packages(&first).is_disjoint(&packages(&second)), "raw extension pages must not overlap");
    assert_eq!(packages(&first).union(&packages(&second)).count(), 125);
    assert_eq!(store.artifacts.load(Ordering::Acquire), 0, "metadata queries must not download executable artifacts");

    let safe_first = managed.filter_extensions_with_metadata(0, "", Some(&store.url), Some("en"), Some(false), false, false, Some(ReadContentWarning::Safe)).unwrap();
    rows(&safe_first, 120, 100);
    assert_eq!(packages(&safe_first), (0..100).map(|index| format!("{PREFIX}general{index:03}")).collect());
    let safe_second = managed.filter_extensions_with_metadata(100, "", Some(&store.url), Some("en"), Some(false), false, false, Some(ReadContentWarning::Safe)).unwrap();
    rows(&safe_second, 120, 20);
    assert_eq!(packages(&safe_second), (100..120).map(|index| format!("{PREFIX}general{index:03}")).collect());
    rows(&managed.filter_extensions_with_metadata(200, "", Some(&store.url), Some("en"), Some(false), false, false, Some(ReadContentWarning::Safe)).unwrap(), 120, 0);
    let unspecified = managed.filter_extensions_with_metadata(0, "", Some(&store.url), Some("fr"), None, false, false, Some(ReadContentWarning::Safe)).unwrap();
    assert_eq!(rows(&unspecified, 1, 1)[0]["pkgName"], format!("{PREFIX}unspecified"));
    assert_eq!(unspecified["nodes"][0]["contentWarning"], "SAFE", "the pinned importer normalizes an unspecified wire rating; original rating provenance is unavailable");
    let mixed = managed.filter_extensions_with_metadata(0, "", Some(&store.url), Some("fr"), None, false, false, Some(ReadContentWarning::Mixed)).unwrap();
    assert_eq!(rows(&mixed, 1, 1)[0]["pkgName"], format!("{PREFIX}mixed"));
    let nsfw = managed.filter_extensions_with_metadata(0, "", Some(&store.url), Some("ja"), None, false, false, Some(ReadContentWarning::Nsfw)).unwrap();
    assert_eq!(rows(&nsfw, 1, 1)[0]["pkgName"], format!("{PREFIX}adult"));
    let multilingual = managed.filter_extensions_with_metadata(0, "", Some(&store.url), Some("all"), None, false, false, Some(ReadContentWarning::Safe)).unwrap();
    assert_eq!(rows(&multilingual, 1, 1)[0]["pkgName"], format!("{PREFIX}multilingual"));
    rows(&managed.filter_extensions_with_metadata(0, "oRiGiNaL gEnErAl 119", Some(&store.url), Some("en"), None, false, false, Some(ReadContentWarning::Safe)).unwrap(), 1, 1);
    rows(&managed.filter_extensions_with_metadata(0, "metadata.general119", Some(&store.url), None, None, false, false, Some(ReadContentWarning::Safe)).unwrap(), 1, 1);
    rows(&managed.filter_extensions_with_metadata(0, "fr", Some(&store.url), None, None, false, false, None).unwrap(), 2, 2);
    rows(&managed.filter_extensions_with_metadata(0, "", Some(&store.url), Some("zz"), None, false, false, None).unwrap(), 0, 0);
    rows(&managed.filter_extensions_with_metadata(0, "", Some(&store.url), Some("en"), None, false, false, Some(ReadContentWarning::Nsfw)).unwrap(), 0, 0);
    assert!(managed.filter_extensions_with_metadata(0, "", Some("https://example.invalid/unregistered/index.pb"), None, None, false, false, None).is_err());

    managed.mutate_extension(PRIMARY, true).expect("install only the authored metadata source factory");
    inventory(&managed, &store, false, false);
    let downloaded = store.artifacts.load(Ordering::Acquire);
    assert!(downloaded > 0);
    let catalogue = managed.catalogue("20000", 1, CatalogueMode::Popular).unwrap();
    let manga = catalogue["mangas"][0]["id"].as_i64().unwrap() as i32;
    managed.set_library(manga, true).unwrap();
    let details = managed.manga(manga).unwrap();
    let chapter = details["chapters"].as_array().unwrap().iter().find(|row| row["name"] == "Cleanup chapter 01").unwrap()["id"].as_i64().unwrap() as i32;
    let pages = managed.chapter(chapter).unwrap();
    assert_eq!(pages.len(), 2);
    assert_eq!(managed.page(&pages, 1).unwrap().mime, "image/png");
    managed.save_progress(&pages, 1, true).unwrap(); drop(pages);
    managed.update_chapter_flags(&[chapter], None, Some(true)).unwrap();
    let category = managed.save_category(None, "Original metadata shelf").unwrap();
    managed.assign_category(manga, category["category"]["id"].as_i64().unwrap() as i32, true).unwrap();
    let before = saved_state(&managed, manga);

    rows(&managed.filter_extensions_with_metadata(0, "", None, Some("all"), Some(true), false, false, Some(ReadContentWarning::Mixed)).unwrap(), 1, 1);
    rows(&managed.filter_extensions_with_metadata(0, "", None, None, Some(false), false, false, None).unwrap(), 124, 100);
    rows(&managed.filter_extensions_with_metadata(0, "", None, None, None, true, false, None).unwrap(), 0, 0);
    store.publish(Some(2)); managed.refresh_extensions().unwrap();
    let update = managed.filter_extensions_with_metadata(0, "metadata", Some(&store.url), Some("all"), Some(false), true, false, Some(ReadContentWarning::Mixed)).unwrap();
    let update_rows = rows(&update, 1, 1);
    assert_eq!(update_rows[0]["pkgName"], PRIMARY);
    assert_eq!(update_rows[0]["versionName"], "1.6.1", "installed metadata retains the actual installed version");
    assert_eq!(update_rows[0]["hasUpdate"], true);
    rows(&managed.filter_extensions_with_metadata(0, "", Some(&store.url), None, None, true, false, Some(ReadContentWarning::Safe)).unwrap(), 0, 0);
    rows(&managed.filter_extensions_with_metadata(0, "", Some(&store.url), None, None, true, true, None).unwrap(), 0, 0);
    inventory(&managed, &store, true, false);
    assert!(saved_state(&managed, manga) == before, "metadata filters and update discovery preserve exact reading state");

    store.publish(None); managed.refresh_extensions().unwrap();
    let obsolete = managed.filter_extensions_with_metadata(0, "", Some(&store.url), Some("all"), Some(false), false, true, Some(ReadContentWarning::Mixed)).unwrap();
    assert_eq!(rows(&obsolete, 1, 1)[0]["pkgName"], PRIMARY);
    assert_eq!(obsolete["nodes"][0]["isObsolete"], true);
    // Pinned refresh retains an existing update flag when a package disappears;
    // both enabled status filters must therefore return their intersection.
    rows(&managed.filter_extensions_with_metadata(0, "", Some(&store.url), None, None, true, true, Some(ReadContentWarning::Mixed)).unwrap(), 1, 1);
    rows(&managed.filter_extensions_with_metadata(0, "", Some(&store.url), None, None, false, true, Some(ReadContentWarning::Safe)).unwrap(), 0, 0);
    inventory(&managed, &store, true, true);
    assert!(saved_state(&managed, manga) == before, "obsolete metadata must not remove a source or its saved reading state");
    store.publish(Some(1)); managed.refresh_extensions().unwrap();
    let settled_inventory = inventory(&managed, &store, false, false);
    rows(&managed.filter_extensions_with_metadata(0, "", None, None, None, true, false, None).unwrap(), 0, 0);
    rows(&managed.filter_extensions_with_metadata(0, "", None, None, None, false, true, None).unwrap(), 0, 0);
    assert_eq!(store.artifacts.load(Ordering::Acquire), downloaded, "filtering and refreshing metadata must not install or update code");
    managed.shutdown().unwrap(); drop(managed);
    let mut managed = ReadRuntime::start(&runtime, &data).unwrap();
    assert!(inventory(&managed, &store, false, false) == settled_inventory);
    assert!(saved_state(&managed, manga) == before, "metadata and protected reading state survive restart");
    rows(&managed.filter_extensions_with_metadata(100, "", Some(&store.url), Some("en"), None, false, false, Some(ReadContentWarning::Safe)).unwrap(), 120, 20);
    assert_eq!(store.artifacts.load(Ordering::Acquire), downloaded);
    managed.shutdown().unwrap(); drop(managed); drop(store);
    fs::remove_dir_all(data).unwrap();
    eprintln!("PASS: richer metadata crossed source and filtered-extension page boundaries; exact language/rating/status filters, unspecified-rating normalization and restart preserved saved reading state without updating code.");
}
