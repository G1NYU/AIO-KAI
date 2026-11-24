//! Isolated Windows reading runtime broker. No arbitrary GraphQL or
//! webview-visible credentials. Explicit repository metadata operations only;
//! executable extensions are not installed yet. Not wired to the app.
use std::fs;
use std::io::{Read, Write};
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
                "query TsugiStores { extensionStores(first: 100) { nodes { name badgeLabel indexUrl signingKey isLegacy } totalCount } }"
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

    fn document(
        &self,
        document: &'static str,
        key: &'static str,
        variables: Value,
    ) -> Result<Value, &'static str> {
        let reply = self.send_document(document, variables, Some(&self.authorization))?;
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

    fn mutation(
        &self,
        document: &'static str,
        key: &'static str,
        input: Value,
    ) -> Result<Value, &'static str> {
        self.document(document, key, json!({ "input": input }))
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

/// The native repository input accepts the current index.pb format and
/// legacy indexes. Do not accept credentials, queries, local paths or IPs.
fn repository_index(value: &str) -> Result<url::Url, &'static str> {
    let invalid = "Invalid reading repository URL.";
    if value.len() > 2048 || value.trim() != value || value.chars().any(char::is_control) {
        return Err(invalid);
    }
    let parsed = url::Url::parse(value).map_err(|_| invalid)?;
    let Some(url::Host::Domain(host)) = parsed.host() else {
        return Err(invalid);
    };
    if parsed.scheme() != "https"
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || parsed.port().is_some()
        || !host.contains('.')
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || !["/index.pb", "/repo.json", "/index.min.json"].iter().any(|suffix| parsed.path().ends_with(suffix))
    {
        return Err(invalid);
    }
    Ok(parsed)
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

/// A native-owned reading data directory. Hold an exclusive OS file lock
/// throughout the child lifetime. Never rewrite an existing server config:
/// it contains the extension store preferences maintained by Suwayomi.
/// The caller must supply a private, trusted app-data path. Production ACL,
/// job-object ownership and graceful shutdown remain separate requirements.
struct ReadStorage {
    _lock: fs::File,
    password: String,
}

impl ReadStorage {
    fn open(data: &Path) -> Result<Self, &'static str> {
        let fresh = match fs::create_dir(data) {
            Ok(()) => true,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => false,
            Err(_) => return Err("Could not create reading data directory."),
        };
        let metadata = fs::symlink_metadata(data)
            .map_err(|_| "Could not inspect reading data directory.")?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err("Invalid reading data directory.");
        }
        let lock_path = data.join(".tsugi-read.lock");
        let key_path = data.join(".tsugi-read.key");
        let config_path = data.join("server.conf");
        let lock = if fresh {
            fs::OpenOptions::new().read(true).write(true).create_new(true).open(&lock_path)
        } else {
            // Do not adopt an arbitrary existing Suwayomi directory.
            for path in [&lock_path, &key_path, &config_path] {
                let info = fs::symlink_metadata(path).map_err(|_| "Reading data is not initialized.")?;
                if !info.is_file() || info.file_type().is_symlink() {
                    return Err("Invalid reading storage file.");
                }
            }
            fs::OpenOptions::new().read(true).write(true).open(&lock_path)
        }.map_err(|_| "Could not open reading storage lock.")?;
        lock.try_lock().map_err(|_| "Reading data is already in use.")?;
        let password = if fresh {
            let mut entropy = [0u8; 32];
            getrandom::fill(&mut entropy).map_err(|_| "Could not secure reading runtime.")?;
            let password = entropy.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
            let mut key = fs::OpenOptions::new().write(true).create_new(true).open(&key_path)
                .map_err(|_| "Could not initialize reading credentials.")?;
            key.write_all(password.as_bytes()).and_then(|_| key.sync_all())
                .map_err(|_| "Could not save reading credentials.")?;
            // The chosen port is supplied on every launch as a JVM property;
            // this config is created once and then managed by Suwayomi.
            let config = format!(
                "server.ip = \"127.0.0.1\"\nserver.webUIEnabled = false\nserver.initialOpenInBrowserEnabled = false\nserver.systemTrayEnabled = false\nserver.kcefEnabled = false\nserver.authMode = \"basic_auth\"\nserver.authUsername = \"{USER}\"\nserver.authPassword = \"{password}\"\nserver.extensionStores = []\nserver.globalUpdateInterval = 0\n"
            );
            let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&config_path)
                .map_err(|_| "Could not initialize reading configuration.")?;
            file.write_all(config.as_bytes()).and_then(|_| file.sync_all())
                .map_err(|_| "Could not save reading configuration.")?;
            password
        } else {
            let mut bytes = Vec::new();
            fs::File::open(&key_path).map_err(|_| "Could not open reading credentials.")?
                .take(65).read_to_end(&mut bytes).map_err(|_| "Could not read reading credentials.")?;
            if bytes.len() != 64 || !bytes.iter().all(u8::is_ascii_hexdigit) {
                return Err("Invalid reading credentials.");
            }
            String::from_utf8(bytes).map_err(|_| "Invalid reading credentials.")?
        };
        Ok(Self { _lock: lock, password })
    }
}

/// Owns the launched process, private client and exclusive storage lock.
pub struct ReadRuntime {
    child: Child,
    client: ReadClient,
    _storage: ReadStorage,
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
        let data = std::path::absolute(data)
            .map_err(|_| "Could not locate reading data directory.")?;
        let storage = ReadStorage::open(&data)?;
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .map_err(|_| "Could not allocate reading port.")?;
        let port = listener
            .local_addr()
            .map_err(|_| "Could not allocate reading port.")?
            .port();
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
                "-Dsuwayomi.tachidesk.config.server.authMode=basic_auth",
                "-Dsuwayomi.tachidesk.config.server.authUsername=tsugi-read",
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
            client: ReadClient::new(port, &storage.password),
            _storage: storage,
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

    /// Explicitly added by a trusted native caller after user confirmation.
    /// This validates the initial index URL only; it is not an SSRF sandbox
    /// for the upstream engine or a signature/trust check for executable code.
    pub fn add_store(&self, index: &str) -> Result<Value, &'static str> {
        let index = repository_index(index)?;
        self.add_store_inner(index.as_str())
    }

    fn add_store_inner(&self, index: &str) -> Result<Value, &'static str> {
        self.client.mutation(
            "mutation TsugiAddStore($input: AddExtensionStoreInput!) { addExtensionStore(input: $input) { extensionStore { name badgeLabel indexUrl signingKey isLegacy } } }",
            "addExtensionStore",
            json!({ "indexUrl": index }),
        )
    }

    /// Remove an existing registered store, not an arbitrary remote endpoint.
    /// This does not uninstall any previously installed extensions.
    pub fn remove_store(&self, index: &str) -> Result<Value, &'static str> {
        let stores = self.query(ReadOperation::Stores)?;
        if !stores["nodes"].as_array().is_some_and(|nodes| {
            nodes.iter().any(|node| node["indexUrl"] == index)
        }) {
            return Err("Reading repository is not registered.");
        }
        self.client.mutation(
            "mutation TsugiRemoveStore($input: RemoveExtensionStoreInput!) { removeExtensionStore(input: $input) { extensionStore { name indexUrl } } }",
            "removeExtensionStore",
            json!({ "indexUrl": index }),
        )
    }

    pub fn refresh_extensions(&self) -> Result<(), &'static str> {
        // Refresh can involve thousands of entries. Do not fetch an unbounded
        // response; read the actual list with the paginated query below.
        self.client.mutation(
            "mutation TsugiRefreshExtensions($input: FetchExtensionsInput!) { fetchExtensions(input: $input) { __typename } }",
            "fetchExtensions",
            json!({}),
        )?;
        Ok(())
    }

    pub fn extensions(&self, offset: u32) -> Result<Value, &'static str> {
        if offset > 100_000 {
            return Err("Invalid extension catalogue offset.");
        }
        let result = self.client.document(
            "query TsugiExtensions($offset: Int!) { extensions(first: 100, offset: $offset) { nodes { name pkgName storeIndexUrl versionName versionCodeLong extensionLib lang contentWarning isInstalled hasUpdate isObsolete } totalCount } }",
            "extensions",
            json!({ "offset": offset }),
        )?;
        let nodes = result["nodes"].as_array().ok_or("Invalid extension catalogue.")?;
        if nodes.len() > 100 || !result["totalCount"].is_u64() {
            return Err("Invalid extension catalogue.");
        }
        Ok(result)
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
    use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
    use std::thread::JoinHandle;

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
    fn rejects_non_repository_urls() {
        for url in [
            "https://example.test/mihon/index.pb",
            "https://example.test/repo.json",
            "https://example.test/index.min.json",
        ] {
            assert!(repository_index(url).is_ok());
        }
        for url in [
            "http://example.test/index.pb",
            "https://127.0.0.1/index.pb",
            "https://localhost/index.pb",
            "https://host.local/index.pb",
            "https://example.test:444/index.pb",
            "https://user@example.test/index.pb",
            "https://example.test/index.pb?token=x",
            "https://example.test/index.pb#part",
            "file:///index.pb",
            "https://example.test/other",
        ] {
            assert!(repository_index(url).is_err());
        }
    }

    // Encode the documented upstream 1.6 protobuf fields directly. This
    // fixture is metadata only; its APK/JAR URLs are never fetched.
    fn varint(mut value: u64, out: &mut Vec<u8>) {
        while value >= 128 {
            out.push((value as u8 & 127) | 128);
            value >>= 7;
        }
        out.push(value as u8);
    }

    fn field(out: &mut Vec<u8>, number: u64, bytes: &[u8]) {
        varint(number << 3 | 2, out);
        varint(bytes.len() as u64, out);
        out.extend_from_slice(bytes);
    }

    fn fixture_index() -> Vec<u8> {
        let mut resources = Vec::new();
        field(&mut resources, 1, b"https://example.invalid/fixture.apk");
        field(&mut resources, 2, b"https://example.invalid/fixture.png");
        let mut source = Vec::new();
        varint(8, &mut source);
        varint(12345, &mut source);
        field(&mut source, 2, b"Fixture source");
        field(&mut source, 3, b"en");
        let mut extension = Vec::new();
        field(&mut extension, 1, b"Tsugi Fixture");
        field(&mut extension, 2, b"org.tsugi.fixture");
        field(&mut extension, 3, &resources);
        field(&mut extension, 4, b"1.6");
        varint(40, &mut extension);
        varint(1, &mut extension);
        field(&mut extension, 6, b"1.6.1");
        varint(56, &mut extension);
        varint(1, &mut extension);
        field(&mut extension, 8, &source);
        let mut list = Vec::new();
        field(&mut list, 1, &extension);
        let mut contact = Vec::new();
        field(&mut contact, 1, b"https://example.invalid");
        let mut store = Vec::new();
        field(&mut store, 1, b"Tsugi Fixture Store");
        field(&mut store, 2, b"Fixture");
        field(&mut store, 3, b"0000000000000000000000000000000000000000000000000000000000000000");
        field(&mut store, 4, &contact);
        field(&mut store, 101, &list);
        store
    }

    struct FixtureStore {
        url: String,
        stop: Arc<AtomicBool>,
        worker: Option<JoinHandle<()>>,
    }

    impl FixtureStore {
        fn start() -> Self {
            let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
            let port = listener.local_addr().unwrap().port();
            listener.set_nonblocking(true).unwrap();
            let stop = Arc::new(AtomicBool::new(false));
            let stopped = Arc::clone(&stop);
            let worker = std::thread::spawn(move || {
                let body = fixture_index();
                while !stopped.load(Ordering::Acquire) {
                    let Ok((mut stream, _)) = listener.accept() else {
                        std::thread::sleep(Duration::from_millis(20));
                        continue;
                    };
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
                    let mut request = Vec::new();
                    for byte in (&mut stream).bytes().take(8192) {
                        let Ok(byte) = byte else { break };
                        request.push(byte);
                        if request.ends_with(b"\r\n\r\n") { break; }
                    }
                    if request.starts_with(b"GET /index.pb HTTP/1.") {
                        let header = format!("HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                        let _ = stream.write_all(header.as_bytes());
                        let _ = stream.write_all(&body);
                    } else {
                        let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                    }
                }
            });
            Self {
                url: format!("http://127.0.0.1:{port}/index.pb"),
                stop,
                worker: Some(worker),
            }
        }
    }

    impl Drop for FixtureStore {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::Release);
            if let Some(worker) = self.worker.take() {
                let _ = worker.join();
            }
        }
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
        // Private test-only path: production add_store accepts HTTPS only.
        let store = FixtureStore::start();
        let added = managed.add_store_inner(&store.url).expect("protobuf store metadata");
        assert_eq!(added["extensionStore"]["name"], "Tsugi Fixture Store");
        assert_eq!(added["extensionStore"]["isLegacy"], false);
        let stores = managed.query(ReadOperation::Stores).unwrap();
        assert!(stores["nodes"].as_array().unwrap().iter().any(|node| node["indexUrl"] == store.url));
        managed.refresh_extensions().expect("refresh protobuf extension catalogue");
        let extensions = managed.extensions(0).expect("extension catalogue");
        let entry = extensions["nodes"].as_array().unwrap().iter().find(|node| node["pkgName"] == "org.tsugi.fixture").expect("fixture extension metadata");
        assert_eq!(entry["extensionLib"], "1.6");
        assert_eq!(entry["versionName"], "1.6.1");
        assert_eq!(entry["isInstalled"], false);
        assert!(managed.extensions(100).unwrap()["nodes"].as_array().unwrap().is_empty());
        // A second broker cannot start on the same live data directory.
        assert!(ReadRuntime::start(&runtime, &data).is_err());
        let first_port = managed.client.port;
        drop(managed);
        assert!(TcpStream::connect_timeout(
            &std::net::SocketAddr::from((Ipv4Addr::LOCALHOST, first_port)),
            Duration::from_secs(2)
        ).is_err());
        // Reopen using the durable native credential and existing config/DB,
        // not an in-memory copy of the previous broker's state.
        let managed = ReadRuntime::start(&runtime, &data).expect("reopen reading library");
        let list = managed.query(ReadOperation::Library).expect("persisted library");
        assert!(list["nodes"].as_array().unwrap().iter().any(|item| item["id"] == manga_id.to_string()));
        let details = managed.manga(manga_id).expect("persisted reading progress");
        assert_eq!(details["chapters"][0]["id"], id);
        assert_eq!(details["chapters"][0]["isRead"], true);
        assert_eq!(details["chapters"][0]["lastPageRead"], 1);
        let reopened = managed.chapter(id).expect("reopened chapter");
        assert_eq!(reopened.len(), 2);
        assert_eq!(managed.page(&reopened, 1).unwrap().mime, "image/png");
        let stores = managed.query(ReadOperation::Stores).expect("persisted extension stores");
        assert!(stores["nodes"].as_array().unwrap().iter().any(|node| node["indexUrl"] == store.url));
        managed.refresh_extensions().expect("refresh persisted store");
        assert!(managed.extensions(0).unwrap()["nodes"].as_array().unwrap().iter().any(|node| node["pkgName"] == "org.tsugi.fixture"));
        managed.remove_store(&store.url).expect("remove fixture store");
        assert!(managed.query(ReadOperation::Stores).unwrap()["nodes"].as_array().unwrap().is_empty());
        managed.refresh_extensions().expect("refresh removed store");
        assert!(managed.extensions(0).unwrap()["nodes"].as_array().unwrap().is_empty());
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
