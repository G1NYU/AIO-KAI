//! Isolated Windows reading runtime broker. No arbitrary GraphQL, URLs,
//! extension installation, or webview-visible credentials. Not yet wired to
//! the app: process ownership and the fixed API are tested in CI first.
use std::fs;
use std::io::Read;
use std::net::{Ipv4Addr, TcpListener};
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};

const VERSION: &str = "v2.4.2373";
const USER: &str = "tsugi-read";
const MAX_RESPONSE: u64 = 2 * 1024 * 1024;
const MAX_PAGE: u64 = 24 * 1024 * 1024;
const MAX_PAGES: usize = 2000;
const READY_TIMEOUT: Duration = Duration::from_secs(90);
const NO_WINDOW: u32 = 0x08000000;

#[derive(Clone, Copy)]
pub enum ReadOperation {
    Status,
    Sources,
    Stores,
    Library,
}

impl ReadOperation {
    fn query(self) -> &'static str {
        match self {
            Self::Status => "query TsugiStatus { aboutServer { version } }",
            Self::Sources => {
                "query TsugiSources { sources(first: 100) { nodes { id name lang displayName supportsLatest } totalCount } }"
            }
            Self::Stores => {
                "query TsugiStores { extensionStores(first: 100) { nodes { name isLegacy } totalCount } }"
            }
            Self::Library => {
                "query TsugiLibrary { mangas(condition: { inLibrary: true }, first: 100) { nodes { id title inLibrary } totalCount } }"
            }
        }
    }

    fn key(self) -> &'static str {
        match self {
            Self::Status => "aboutServer",
            Self::Sources => "sources",
            Self::Stores => "extensionStores",
            Self::Library => "mangas",
        }
    }
}

struct ReadClient {
    agent: ureq::Agent,
    port: u16,
    authorization: String,
}

struct Reply {
    status: u16,
    challenge: bool,
    body: Value,
}

impl ReadClient {
    fn new(port: u16, password: &str) -> Self {
        Self {
            agent: ureq::Agent::config_builder()
                .proxy(None)
                .max_redirects(0)
                .http_status_as_error(false)
                .timeout_global(Some(Duration::from_secs(5)))
                .build()
                .into(),
            port,
            authorization: format!("Basic {}", STANDARD.encode(format!("{USER}:{password}"))),
        }
    }

    fn send(
        &self,
        operation: ReadOperation,
        authorization: Option<&str>,
    ) -> Result<Reply, &'static str> {
        self.send_document(operation.query(), json!({}), authorization)
    }

    fn send_document(
        &self,
        document: &'static str,
        variables: Value,
        authorization: Option<&str>,
    ) -> Result<Reply, &'static str> {
        let endpoint = format!("http://127.0.0.1:{}/api/graphql", self.port);
        let mut request = self
            .agent
            .post(&endpoint)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .header("Connection", "close");
        if let Some(value) = authorization {
            request = request.header("Authorization", value);
        }
        let mut response = request
            .send(json!({ "query": document, "variables": variables }).to_string())
            .map_err(|_| "Reading server did not respond.")?;
        let status = response.status().as_u16();
        let challenge = response
            .headers()
            .get("www-authenticate")
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| {
                value
                    .split_ascii_whitespace()
                    .next()
                    .is_some_and(|scheme| scheme.eq_ignore_ascii_case("Basic"))
            });
        let mut bytes = Vec::new();
        response
            .body_mut()
            .as_reader()
            .take(MAX_RESPONSE + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Could not read reading server response.")?;
        if bytes.len() as u64 > MAX_RESPONSE {
            return Err("Reading server response exceeded its limit.");
        }
        let body = if status == 200
            || bytes.iter().find(|byte| !byte.is_ascii_whitespace()) == Some(&b'{')
        {
            serde_json::from_slice(&bytes).map_err(|_| "Invalid reading server response.")?
        } else {
            Value::Null
        };
        Ok(Reply {
            status,
            challenge,
            body,
        })
    }

    fn query(&self, operation: ReadOperation) -> Result<Value, &'static str> {
        let reply = self.send(operation, Some(&self.authorization))?;
        decode(operation, reply)
    }

    fn mutation(
        &self,
        document: &'static str,
        key: &'static str,
        input: Value,
    ) -> Result<Value, &'static str> {
        let reply = self.send_document(document, json!({ "input": input }), Some(&self.authorization))?;
        if reply.status != 200
            || reply.body.get("errors").is_some_and(|errors| !errors.is_null())
        {
            return Err("Reading server rejected the operation.");
        }
        let value = reply.body["data"][key].clone();
        if !value.is_object() {
            return Err("Reading server returned an invalid result.");
        }
        Ok(value)
    }

    fn page(&self, path: &PagePath) -> Result<PageImage, &'static str> {
        let endpoint = format!("http://127.0.0.1:{}{}", self.port, path.0);
        let mut response = self.agent.get(&endpoint)
            .header("Authorization", self.authorization.as_str())
            .header("Connection", "close")
            .call()
            .map_err(|_| "Reading server did not return a page.")?;
        if response.status().as_u16() != 200 {
            return Err("Reading page is unavailable.");
        }
        let mut bytes = Vec::new();
        response.body_mut().as_reader().take(MAX_PAGE + 1)
            .read_to_end(&mut bytes).map_err(|_| "Could not read page image.")?;
        if bytes.len() as u64 > MAX_PAGE {
            return Err("Reading page exceeded its size limit.");
        }
        let mime = image_mime(&bytes).ok_or("Unsupported reading page image.")?;
        Ok(PageImage { bytes, mime })
    }

    fn verify_authentication(&self) -> Result<(), &'static str> {
        let bad = format!("Basic {}", STANDARD.encode(format!("{USER}:invalid")));
        for credential in [None, Some(bad.as_str())] {
            let reply = self.send(ReadOperation::Sources, credential)?;
            if !matches!(reply.status, 401 | 404)
                || !reply.challenge
                || !reply.body["data"].is_null()
            {
                return Err("Reading server failed authentication checks.");
            }
        }
        self.query(ReadOperation::Sources)?;
        Ok(())
    }
}

fn decode(operation: ReadOperation, reply: Reply) -> Result<Value, &'static str> {
    if reply.status != 200
        || reply
            .body
            .get("errors")
            .is_some_and(|errors| !errors.is_null())
    {
        return Err("Reading server rejected the operation.");
    }
    let mut value = reply.body["data"][operation.key()].clone();
    if matches!(operation, ReadOperation::Status) {
        if value["version"] != VERSION {
            return Err("Unexpected reading server version.");
        }
        return Ok(value);
    }
    let nodes = value["nodes"]
        .as_array_mut()
        .ok_or("Reading server returned an invalid list.")?;
    if nodes.len() > 100 {
        return Err("Reading server returned too many entries.");
    }
    // Preserve 64-bit source IDs exactly across the eventual JavaScript bridge.
    // Never use a JS number to identify a source.
    if matches!(operation, ReadOperation::Sources | ReadOperation::Library) {
        for node in nodes {
            let id = match &node["id"] {
                Value::String(value) => value.clone(),
                Value::Number(value) if value.is_i64() || value.is_u64() => value.to_string(),
                _ => return Err("Reading server returned an invalid identifier."),
            };
            if id.parse::<i64>().is_err() {
                return Err("Reading server returned an invalid identifier.");
            }
            node["id"] = Value::String(id);
        }
    }
    Ok(value)
}

/// A page capability derived only from the fixed chapter-pages response.
/// Reject absolute URLs, query strings, traversal, and non-page API routes.
struct PagePath(String);

impl PagePath {
    fn parse(value: &str, manga_id: i32, index: usize) -> Result<Self, &'static str> {
        let rest = value.strip_prefix("/api/v1/manga/")
            .ok_or("Invalid reading page path.")?;
        let parts: Vec<_> = rest.split('/').collect();
        if parts.len() != 5 || parts[1] != "chapter" || parts[3] != "page"
            || parts[0] != manga_id.to_string()
            || parts[4] != index.to_string()
            || parts[2].is_empty()
            || !parts[2].bytes().all(|b| b.is_ascii_digit())
            || parts[2].parse::<u32>().is_err()
        {
            return Err("Invalid reading page path.");
        }
        Ok(Self(value.to_owned()))
    }
}

fn image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else {
        None
    }
}

pub struct PageImage {
    pub bytes: Vec<u8>,
    pub mime: &'static str,
}

pub struct ChapterPages {
    chapter_id: i32,
    paths: Vec<PagePath>,
}

impl ChapterPages {
    pub fn len(&self) -> usize {
        self.paths.len()
    }

    pub fn is_empty(&self) -> bool {
        self.paths.is_empty()
    }
}

#[derive(Clone, Copy)]
pub enum CatalogueMode<'a> {
    Popular,
    Latest,
    Search(&'a str),
}

/// Owns the launched process and private client. The first implementation
/// deliberately accepts only a fresh native-owned data directory. Persistence,
/// Windows job-object ownership, graceful shutdown, and extension trust must
/// be implemented before this is used for a real user library.
pub struct ReadRuntime {
    child: Child,
    client: ReadClient,
}

impl ReadRuntime {
    pub fn start(runtime: &Path, data: &Path) -> Result<Self, &'static str> {
        let runtime = std::path::absolute(runtime)
            .map_err(|_| "Reading runtime is missing.")?;
        let java = runtime.join("jre/bin/java.exe");
        let jar = runtime.join("bin/Suwayomi-Server.jar");
        if !java.is_file() || !jar.is_file() {
            return Err("Reading runtime is incomplete.");
        }
        fs::create_dir(data).map_err(|_| "Reading data directory must be fresh.")?;
        let data = std::path::absolute(data)
            .map_err(|_| "Could not locate reading data directory.")?;
        let mut entropy = [0u8; 32];
        getrandom::fill(&mut entropy).map_err(|_| "Could not secure reading runtime.")?;
        let password = entropy
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .map_err(|_| "Could not allocate reading port.")?;
        let port = listener
            .local_addr()
            .map_err(|_| "Could not allocate reading port.")?
            .port();
        let config = format!(
            "server.ip = \"127.0.0.1\"\nserver.port = {port}\nserver.webUIEnabled = false\nserver.initialOpenInBrowserEnabled = false\nserver.systemTrayEnabled = false\nserver.kcefEnabled = false\nserver.authMode = \"basic_auth\"\nserver.authUsername = \"{USER}\"\nserver.authPassword = \"{password}\"\nserver.extensionRepos = []\nserver.globalUpdateInterval = 0\n"
        );
        fs::write(data.join("server.conf"), config)
            .map_err(|_| "Could not configure reading runtime.")?;
        drop(listener);
        let child = Command::new(java)
            .arg(format!(
                "-Dsuwayomi.tachidesk.config.server.rootDir={}",
                data.display()
            ))
            .arg("-Dsuwayomi.tachidesk.config.server.ip=127.0.0.1")
            .arg(format!("-Dsuwayomi.tachidesk.config.server.port={port}"))
            .args([
                "-Dsuwayomi.tachidesk.config.server.webUIEnabled=false",
                "-Dsuwayomi.tachidesk.config.server.initialOpenInBrowserEnabled=false",
                "-Dsuwayomi.tachidesk.config.server.systemTrayEnabled=false",
                "-Dsuwayomi.tachidesk.config.server.kcefEnabled=false",
                "-jar",
            ])
            .arg(jar)
            .current_dir(runtime)
            .creation_flags(NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "Could not start reading runtime.")?;
        let mut managed = Self {
            child,
            client: ReadClient::new(port, &password),
        };
        let deadline = Instant::now() + READY_TIMEOUT;
        while Instant::now() < deadline {
            if managed
                .child
                .try_wait()
                .map_err(|_| "Could not check reading runtime.")?
                .is_some()
            {
                return Err("Reading runtime exited during startup.");
            }
            if managed.client.query(ReadOperation::Status).is_ok() {
                managed.client.verify_authentication()?;
                return Ok(managed);
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        Err("Reading runtime did not become ready.")
    }

    pub fn query(&self, operation: ReadOperation) -> Result<Value, &'static str> {
        self.client.query(operation)
    }

    /// The backend's source ID is LongString, never a JS number.
    pub fn catalogue(&self, source: &str, page: u32, mode: CatalogueMode<'_>) -> Result<Value, &'static str> {
        if source.parse::<i64>().is_err() || page == 0 || page > 1000 {
            return Err("Invalid reading catalogue request.");
        }
        let (kind, query) = match mode {
            CatalogueMode::Popular => ("POPULAR", None),
            CatalogueMode::Latest => ("LATEST", None),
            CatalogueMode::Search(query) if !query.trim().is_empty() && query.chars().count() <= 200 => ("SEARCH", Some(query)),
            CatalogueMode::Search(_) => return Err("Invalid reading search."),
        };
        self.client.mutation(
            "mutation TsugiCatalogue($input: FetchSourceMangaInput!) { fetchSourceManga(input: $input) { hasNextPage mangas { id sourceId title author thumbnailUrl inLibrary } } }",
            "fetchSourceManga",
            json!({ "source": source, "page": page, "type": kind, "query": query }),
        )
    }

    pub fn manga(&self, id: i32) -> Result<Value, &'static str> {
        if id <= 0 {
            return Err("Invalid manga identifier.");
        }
        self.client.mutation(
            "mutation TsugiManga($input: FetchMangaAndChaptersInput!) { fetchMangaAndChapters(input: $input) { manga { id sourceId title author artist description genre thumbnailUrl inLibrary } chapters { id name mangaId chapterNumber sourceOrder pageCount isRead lastPageRead } } }",
            "fetchMangaAndChapters",
            json!({ "id": id, "fetchManga": true, "fetchChapters": true }),
        )
    }

    pub fn set_library(&self, id: i32, in_library: bool) -> Result<Value, &'static str> {
        if id <= 0 {
            return Err("Invalid manga identifier.");
        }
        self.client.mutation(
            "mutation TsugiLibraryUpdate($input: UpdateMangaInput!) { updateManga(input: $input) { manga { id title inLibrary } } }",
            "updateManga",
            json!({ "id": id, "patch": { "inLibrary": in_library } }),
        )
    }

    pub fn chapter(&self, id: i32) -> Result<ChapterPages, &'static str> {
        if id <= 0 {
            return Err("Invalid chapter identifier.");
        }
        let value = self.client.mutation(
            "mutation TsugiChapter($input: FetchChapterPagesInput!) { fetchChapterPages(input: $input) { pages chapter { id mangaId pageCount lastPageRead isRead } } }",
            "fetchChapterPages",
            json!({ "chapterId": id }),
        )?;
        let chapter = &value["chapter"];
        let manga_id = chapter["mangaId"].as_i64().and_then(|value| i32::try_from(value).ok())
            .filter(|value| *value > 0).ok_or("Invalid reading chapter response.")?;
        let pages = value["pages"].as_array().ok_or("Invalid reading chapter response.")?;
        if chapter["id"].as_i64() != Some(i64::from(id)) || pages.is_empty() || pages.len() > MAX_PAGES
            || chapter["pageCount"].as_u64() != Some(pages.len() as u64) {
            return Err("Invalid reading chapter response.");
        }
        let paths = pages.iter().enumerate().map(|(index, value)| {
            PagePath::parse(value.as_str().ok_or("Invalid reading page path.")?, manga_id, index)
        }).collect::<Result<Vec<_>, _>>()?;
        Ok(ChapterPages { chapter_id: id, paths })
    }

    pub fn page(&self, chapter: &ChapterPages, index: usize) -> Result<PageImage, &'static str> {
        self.client.page(chapter.paths.get(index).ok_or("Reading page is out of range.")?)
    }

    pub fn save_progress(&self, chapter: &ChapterPages, index: usize, finished: bool) -> Result<Value, &'static str> {
        if index >= chapter.len() || (finished && index + 1 != chapter.len()) {
            return Err("Invalid reading progress.");
        }
        let mut patch = json!({ "lastPageRead": index });
        if finished {
            patch["isRead"] = Value::Bool(true);
        }
        self.client.mutation(
            "mutation TsugiProgress($input: UpdateChapterInput!) { updateChapter(input: $input) { chapter { id isRead lastPageRead } } }",
            "updateChapter",
            json!({ "id": chapter.chapter_id, "patch": patch }),
        )
    }
}

impl Drop for ReadRuntime {
    fn drop(&mut self) {
        if !matches!(self.child.try_wait(), Ok(Some(_))) {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpStream;
    use std::path::PathBuf;

    #[test]
    fn large_source_id_survives_without_js_rounding() {
        let reply = Reply {
            status: 200,
            challenge: false,
            body: json!({"data": {"sources": {"nodes": [{"id": 9007199254740993_i64}], "totalCount": 1}}}),
        };
        let value = decode(ReadOperation::Sources, reply).unwrap();
        assert_eq!(value["nodes"][0]["id"], "9007199254740993");
    }

    #[test]
    fn refuses_graphql_errors_and_invalid_lists() {
        for body in [
            json!({"errors": [{"message": "fixture"}]}),
            json!({"data": {"sources": {"nodes": null}}}),
            json!({"data": {"sources": {"nodes": [{"id": "not-an-id"}]}}}),
        ] {
            let reply = Reply {
                status: 200,
                challenge: false,
                body,
            };
            assert!(decode(ReadOperation::Sources, reply).is_err());
        }
    }

    #[test]
    fn page_paths_are_bound_to_the_manga_and_page_index() {
        assert!(PagePath::parse("/api/v1/manga/7/chapter/1/page/0", 7, 0).is_ok());
        for path in [
            "https://example.test/api/v1/manga/7/chapter/1/page/0",
            "/api/v1/manga/8/chapter/1/page/0",
            "/api/v1/manga/7/chapter/../page/0",
            "/api/v1/manga/7/chapter/1/page/0?redirect=x",
            "/api/v1/manga/7/chapter/1/page/1",
            "/api/v1/settings",
        ] {
            assert!(PagePath::parse(path, 7, 0).is_err());
        }
        assert_eq!(image_mime(b"<svg/>"), None);
    }

    #[test]
    #[ignore = "requires the pinned Windows reading runtime"]
    fn packaged_runtime() {
        let runtime = PathBuf::from(std::env::var_os("TSUGI_READ_RUNTIME").unwrap());
        let data = PathBuf::from(std::env::var_os("TSUGI_READ_FIXTURE").unwrap());
        let managed = ReadRuntime::start(&runtime, &data).expect("native runtime startup");
        assert_eq!(
            managed.query(ReadOperation::Status).unwrap()["version"],
            VERSION
        );
        for operation in [
            ReadOperation::Sources,
            ReadOperation::Stores,
            ReadOperation::Library,
        ] {
            let value = managed.query(operation).expect("fixed reading query");
            assert!(value["nodes"].is_array());
        }
        // Original, generated two-page comic, never a remote source or APK.
        let fixture = data.join("local/Tsugi Fixture/Chapter 01");
        fs::create_dir_all(&fixture).expect("fixture chapter");
        let png = STANDARD.decode("iVBORw0KGgoAAAANSUhEUgAAABAAAAAYCAIAAAB8wupbAAAAHUlEQVR4nGOsqF3FQApgIkn1qIZRDaMaRjWQrAEA4jkBz8UryC4AAAAASUVORK5CYII=").unwrap();
        for filename in ["001.png", "002.png"] {
            fs::write(fixture.join(filename), &png).expect("fixture page");
        }
        let catalog = managed.catalogue("0", 1, CatalogueMode::Search("Tsugi Fixture")).expect("local catalogue search");
        let manga = catalog["mangas"].as_array().unwrap().iter().find(|item| item["title"] == "Tsugi Fixture").expect("fixture manga");
        let manga_id = manga["id"].as_i64().unwrap() as i32;
        let details = managed.manga(manga_id).expect("fixture chapters");
        let id = details["chapters"][0]["id"].as_i64().unwrap() as i32;
        let pages = managed.chapter(id).expect("chapter page list");
        assert_eq!(pages.len(), 2);
        for index in 0..pages.len() {
            let image = managed.page(&pages, index).expect("authenticated page image");
            assert_eq!(image.mime, "image/png");
            assert!(!image.bytes.is_empty());
        }
        assert!(managed.page(&pages, 2).is_err());
        let progress = managed.save_progress(&pages, 1, true).expect("save reading progress");
        assert_eq!(progress["chapter"]["lastPageRead"], 1);
        assert_eq!(progress["chapter"]["isRead"], true);
        let library = managed.set_library(manga_id, true).expect("add fixture to library");
        assert_eq!(library["manga"]["inLibrary"], true);
        let list = managed.query(ReadOperation::Library).expect("library query");
        assert!(list["nodes"].as_array().unwrap().iter().any(|item| item["id"] == manga_id.to_string()));
        let details = managed.manga(manga_id).expect("retrieve saved progress");
        assert_eq!(details["chapters"][0]["isRead"], true);
        assert_eq!(details["chapters"][0]["lastPageRead"], 1);
        let port = managed.client.port;
        drop(managed);
        assert!(TcpStream::connect_timeout(
            &std::net::SocketAddr::from((Ipv4Addr::LOCALHOST, port)),
            Duration::from_secs(2)
        )
        .is_err());
        fs::remove_dir_all(data).expect("clean disposable reading data");
    }
}
