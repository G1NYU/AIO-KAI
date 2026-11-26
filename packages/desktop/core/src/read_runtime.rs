//! Isolated Windows reading runtime broker. No arbitrary GraphQL or
//! webview-visible credentials. Executable extension changes require a
//! native-owned trust review and exact runtime/storage ownership checks.
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::net::{Ipv4Addr, TcpListener};
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use crate::bridge::{MangaProgressPatch, ReadContentWarning};

#[path = "read_extension_update.rs"]
mod extension_update;
pub use extension_update::ExtensionUpdateReview;

#[path = "read_download_cleanup.rs"]
mod download_cleanup;
pub use download_cleanup::DownloadCleanupReview;

#[path = "read_image_cache.rs"]
mod image_cache;
pub use image_cache::ImageCacheCleanupReview;

#[path = "read_source_preferences.rs"]
mod source_preferences;
pub use source_preferences::{SourcePreferencesReview, SourcePreferenceChangeReview};
pub use crate::bridge::SourcePreferenceValue;

#[path = "read_icons.rs"]
mod icons;

#[path = "read_downloads.rs"]
mod downloads;

#[path = "read_local_import.rs"]
mod local_import;
pub use local_import::LocalImportReview;

#[path = "read_mihon_import.rs"]
mod mihon_import;
pub use mihon_import::MihonImportReview;

#[cfg(test)]
#[path = "read_feed_tests.rs"]
mod feed_tests;

#[cfg(test)]
#[path = "read_metadata_tests.rs"]
mod metadata_tests;

const VERSION: &str = "v2.4.2373";
const USER: &str = "tsugi-read";
const MAX_RESPONSE: u64 = 2 * 1024 * 1024;
const MAX_PAGE: u64 = 24 * 1024 * 1024;
const MAX_PAGES: usize = 2000;
const READY_TIMEOUT: Duration = Duration::from_secs(90);
const NO_WINDOW: u32 = 0x08000000;
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Clone, Copy)]
pub enum ReadOperation {
    Status,
    Sources,
    Stores,
    Library,
    History,
    Updates,
    Categories,
    Trackers,
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
            Self::Trackers => "query TsugiTrackers { trackers(first: 50) { nodes { id name isLoggedIn supportsReadingDates supportsPrivateTracking } totalCount } }",
            Self::Library => {
                "query TsugiLibrary { mangas(condition: { inLibrary: true }, first: 100, order: [{ by: ID, byType: ASC }]) { nodes { id sourceId title author thumbnailUrl inLibrary unreadCount categories { nodes { id } } lastReadChapter { id name lastPageRead pageCount isRead lastReadAt } } totalCount } }"
            }
            Self::History => "query TsugiHistory { chapters(filter: { lastReadAt: { greaterThan: \"0\" } }, order: [{ by: LAST_READ_AT, byType: DESC }], first: 100) { nodes { id name lastReadAt lastPageRead pageCount isRead manga { id title author thumbnailUrl inLibrary } } totalCount } }",
            Self::Updates => "query TsugiUpdates { chapters(filter: { inLibrary: { equalTo: true }, isRead: { equalTo: false } }, order: [{ by: FETCHED_AT, byType: DESC }], first: 100) { nodes { id name fetchedAt uploadDate lastPageRead pageCount isRead manga { id title author thumbnailUrl inLibrary } } totalCount } }",
            Self::Categories => "query TsugiCategories { categories(first: 100) { nodes { id name order } totalCount } }",
        }
    }

    fn key(self) -> &'static str {
        match self {
            Self::Status => "aboutServer",
            Self::Sources => "sources",
            Self::Stores => "extensionStores",
            Self::Library => "mangas",
            Self::History | Self::Updates => "chapters",
            Self::Categories => "categories",
            Self::Trackers => "trackers",
        }
    }
}

// GetExtendedTcpTable (iphlpapi.h): IPv4 MIB_TCPTABLE_OWNER_PID.
// A DWORD count followed by rows of six DWORDs, including owning PID.
// Use a DWORD-aligned buffer; cap allocation and retry only if it grows.
#[link(name = "iphlpapi")]
unsafe extern "system" {
    fn GetExtendedTcpTable(
        table: *mut std::ffi::c_void,
        size: *mut u32,
        ordered: i32,
        family: u32,
        class: i32,
        reserved: u32,
    ) -> u32;
}

fn verify_listener(port: u16, pid: u32) -> Result<(), &'static str> {
    const ERROR_INSUFFICIENT_BUFFER: u32 = 122;
    const AF_INET: u32 = 2;
    const TCP_TABLE_OWNER_PID_LISTENER: i32 = 3;
    const MAX_TABLE_BYTES: u32 = 16 * 1024 * 1024;
    let invalid = "Could not verify reading listener ownership.";
    let mut size = 0u32;
    // SAFETY: null buffer with a valid size pointer is the documented size query.
    let result = unsafe {
        GetExtendedTcpTable(
            std::ptr::null_mut(),
            &mut size,
            0,
            AF_INET,
            TCP_TABLE_OWNER_PID_LISTENER,
            0,
        )
    };
    if result != ERROR_INSUFFICIENT_BUFFER {
        return Err(invalid);
    }
    for _ in 0..3 {
        if !(4..=MAX_TABLE_BYTES).contains(&size) {
            return Err(invalid);
        }
        let mut words = vec![0u32; (size as usize).div_ceil(4)];
        let capacity = (words.len() * 4) as u32;
        size = capacity;
        // SAFETY: aligned, initialized writable buffer of size bytes; size is
        // a separate valid out pointer. No references are retained by the API.
        let result = unsafe {
            GetExtendedTcpTable(
                words.as_mut_ptr().cast(),
                &mut size,
                0,
                AF_INET,
                TCP_TABLE_OWNER_PID_LISTENER,
                0,
            )
        };
        if result == ERROR_INSUFFICIENT_BUFFER {
            continue;
        }
        if result != 0 || size > capacity || size < 4 {
            return Err(invalid);
        }
        return verify_listener_rows(&words[..size as usize / 4], port, pid);
    }
    Err(invalid)
}

fn verify_listener_rows(words: &[u32], port: u16, pid: u32) -> Result<(), &'static str> {
    let invalid = "Could not verify reading listener ownership.";
    let (&count, rows) = words.split_first().ok_or(invalid)?;
    let needed = (count as usize).checked_mul(6).ok_or(invalid)?;
    let rows = rows.get(..needed).ok_or(invalid)?;
    let mut matched = false;
    for row in rows.chunks_exact(6) {
        if u16::from_be(row[2] as u16) != port {
            continue;
        }
        // Reject other IPv4 listeners on the allocated port, including a
        // wildcard bind. The JVM must own the unique exact loopback listener.
        if matched || row[0] != 2 || row[1].to_ne_bytes() != [127, 0, 0, 1]
            || row[5] != pid
        {
            return Err(invalid);
        }
        matched = true;
    }
    if matched { Ok(()) } else { Err(invalid) }
}

struct ReadClient {
    owner_pid: u32,
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
    fn new(port: u16, owner_pid: u32, password: &str) -> Self {
        Self {
            owner_pid,
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

    fn slow(&self) -> Self {
        Self {
            owner_pid: self.owner_pid,
            agent: ureq::Agent::config_builder()
                .proxy(None)
                .max_redirects(0)
                .http_status_as_error(false)
                .timeout_global(Some(Duration::from_secs(90)))
                .build().into(),
            port: self.port,
            authorization: self.authorization.clone(),
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
        verify_listener(self.port, self.owner_pid)?;
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
            #[cfg(test)]
            {
                // Classify only fixed markers, never log the raw response.
                let errors = reply.body["errors"].to_string();
                let markers = ["ConnectException", "SocketTimeoutException", "UnknownHostException",
                    "SerializationException", "MissingFieldException", "IllegalArgumentException",
                    "ConfigException", "Unauthorized", "Forbidden", "Exception while fetching data",
                    "Failed to fetch extension store", "Invalid store", "404", "Connection refused"];
                let found: Vec<_> = markers.into_iter().filter(|marker| errors.contains(marker)).collect();
                eprintln!("Reading operation {key}: HTTP {}; error count {}; classes/markers {:?}",
                    reply.status, reply.body["errors"].as_array().map_or(0, Vec::len), found);
            }
            if key == "updateExtension" {
                return Err("The reading engine rejected the extension operation. The package may be incompatible or its download unavailable.");
            }
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
        verify_listener(self.port, self.owner_pid)?;
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

const EXTENSION_CATALOGUE_INVALID: &str = "Invalid extension catalogue.";

fn metadata_i64(value: &Value) -> Option<i64> {
    value.as_i64().or_else(|| value.as_str().and_then(|value|
        value.parse::<i64>().ok().filter(|number| number.to_string() == value)))
}

fn metadata_content_warning(value: &Value) -> Result<&str, &'static str> {
    value.as_str().filter(|value| matches!(*value, "SAFE" | "MIXED" | "NSFW")).ok_or(EXTENSION_CATALOGUE_INVALID)
}

fn extension_metadata(value: &Value) -> Result<Value, &'static str> {
    let text = |value, limit| source_inventory_text(value, limit).map_err(|_| EXTENSION_CATALOGUE_INVALID);
    let package = text(&value["pkgName"], 200)?;
    extension_package(package).map_err(|_| EXTENSION_CATALOGUE_INVALID)?;
    let store = match value.get("storeIndexUrl") {
        Some(Value::Null) => None,
        Some(value) => Some(text(value, 2048)?),
        None => return Err(EXTENSION_CATALOGUE_INVALID),
    };
    Ok(json!({"name": text(&value["name"], 500)?, "pkgName": package,
        "versionName": text(&value["versionName"], 200)?,
        "versionCodeLong": metadata_i64(&value["versionCodeLong"]).ok_or(EXTENSION_CATALOGUE_INVALID)?.to_string(),
        "storeIndexUrl": store,
        "isInstalled": value["isInstalled"].as_bool().ok_or(EXTENSION_CATALOGUE_INVALID)?,
        "hasUpdate": value["hasUpdate"].as_bool().ok_or(EXTENSION_CATALOGUE_INVALID)?,
        "isObsolete": value["isObsolete"].as_bool().ok_or(EXTENSION_CATALOGUE_INVALID)?}))
}

fn extension_catalogue_request(offset: u32, term: &str, store: Option<&str>, language: Option<&str>, installed: Option<bool>,
    updates_only: bool, obsolete_only: bool, content_warning: Option<ReadContentWarning>) -> Result<(&'static str, Value), &'static str>
{
    if offset > 100_000 || term.chars().count() > 200 || term.chars().any(char::is_control) {
        return Err("Invalid extension catalogue request.");
    }
    if language.is_some_and(|lang| lang.is_empty() || lang.len() > 24 || !lang.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')) {
        return Err("Invalid extension language.");
    }
    let installed = if updates_only || obsolete_only { Some(true) } else { installed };
    let term = term.trim();
    let mut variables = json!({"offset": offset, "store": store, "lang": language, "installed": installed,
        "hasUpdate": updates_only.then_some(true), "isObsolete": obsolete_only.then_some(true), "contentWarning": content_warning});
    // All conditions are applied to database rows before the engine computes
    // totalCount and limits the page. "all" is an exact multilingual language
    // value; omitted language/content filters mean no corresponding condition.
    // ContentWarning is the pinned enum, not the inconsistent isNsfw adapter.
    let document = if term.is_empty() {
        "query TsugiExtensions($offset: Int!, $store: String, $lang: String, $installed: Boolean, $hasUpdate: Boolean, $isObsolete: Boolean, $contentWarning: ContentWarning) { extensions(first: 100, offset: $offset, order: [{ by: PKG_NAME, byType: ASC }], condition: {storeIndexUrl: $store, lang: $lang, isInstalled: $installed, hasUpdate: $hasUpdate, isObsolete: $isObsolete, contentWarning: $contentWarning}) { nodes { name pkgName storeIndexUrl versionName versionCodeLong extensionLib lang contentWarning isInstalled hasUpdate isObsolete } totalCount } }"
    } else {
        variables["term"] = json!(term);
        "query TsugiExtensions($offset: Int!, $term: String!, $store: String, $lang: String, $installed: Boolean, $hasUpdate: Boolean, $isObsolete: Boolean, $contentWarning: ContentWarning) { extensions(first: 100, offset: $offset, order: [{ by: PKG_NAME, byType: ASC }], condition: {storeIndexUrl: $store, lang: $lang, isInstalled: $installed, hasUpdate: $hasUpdate, isObsolete: $isObsolete, contentWarning: $contentWarning}, filter: {or: [{name: {includesInsensitive: $term}}, {pkgName: {includesInsensitive: $term}}, {lang: {equalTo: $term}}]}) { nodes { name pkgName storeIndexUrl versionName versionCodeLong extensionLib lang contentWarning isInstalled hasUpdate isObsolete } totalCount } }"
    };
    Ok((document, variables))
}

fn extension_catalogue_page(value: &Value, offset: u32) -> Result<Value, &'static str> {
    let total = value["totalCount"].as_u64().filter(|total| *total <= i32::MAX as u64).ok_or(EXTENSION_CATALOGUE_INVALID)?;
    let nodes = value["nodes"].as_array().ok_or(EXTENSION_CATALOGUE_INVALID)?;
    if nodes.len() > 100 || nodes.len() as u64 > total.saturating_sub(u64::from(offset)) { return Err(EXTENSION_CATALOGUE_INVALID); }
    let mut rows = Vec::with_capacity(nodes.len());
    let mut previous = None;
    for node in nodes {
        let mut row = extension_metadata(node)?;
        let package = node["pkgName"].as_str().ok_or(EXTENSION_CATALOGUE_INVALID)?;
        if previous.is_some_and(|prior| package <= prior) { return Err(EXTENSION_CATALOGUE_INVALID); }
        previous = Some(package);
        row["lang"] = json!(source_inventory_text(&node["lang"], 64).map_err(|_| EXTENSION_CATALOGUE_INVALID)?);
        row["contentWarning"] = json!(metadata_content_warning(&node["contentWarning"])?);
        row["extensionLib"] = match node.get("extensionLib") {
            Some(Value::Null) => Value::Null,
            Some(value) => json!(source_inventory_text(value, 64).map_err(|_| EXTENSION_CATALOGUE_INVALID)?),
            None => return Err(EXTENSION_CATALOGUE_INVALID),
        };
        rows.push(row);
    }
    Ok(json!({"nodes": rows, "totalCount": total}))
}

#[cfg(test)]
mod extension_metadata_tests {
    use super::*;

    fn extension(package: &str) -> Value {
        json!({"pkgName": package, "name": "Original extension", "versionName": "1.6.1", "versionCodeLong": "1",
            "storeIndexUrl": "https://example.invalid/index.pb", "isInstalled": true, "hasUpdate": true,
            "isObsolete": false, "lang": "all", "contentWarning": "MIXED", "extensionLib": "1.6"})
    }

    #[test]
    fn typed_filters_keep_exact_language_and_combine_installed_status_constraints() {
        for language in [None, Some("all"), Some("en"), Some("pt-BR")] {
            for (updates, obsolete) in [(false, false), (true, false), (false, true), (true, true)] {
                let (_, variables) = extension_catalogue_request(100, " original ", Some("https://example.invalid/index.pb"),
                    language, Some(false), updates, obsolete, Some(ReadContentWarning::Nsfw)).unwrap();
                assert_eq!(variables["offset"], 100);
                assert_eq!(variables["lang"], json!(language));
                assert_eq!(variables["installed"], updates || obsolete);
                assert_eq!(variables["hasUpdate"], json!(updates.then_some(true)));
                assert_eq!(variables["isObsolete"], json!(obsolete.then_some(true)));
                assert_eq!(variables["contentWarning"], "NSFW");
                assert_eq!(variables["term"], "original");
                assert_eq!(variables["store"], "https://example.invalid/index.pb");
            }
        }
        let (_, variables) = extension_catalogue_request(0, "", None, None, None, false, false, None).unwrap();
        assert!(variables["installed"].is_null() && variables["contentWarning"].is_null());
        assert!(variables.get("term").is_none());
    }

    #[test]
    fn search_remains_data_and_invalid_limits_fail_before_request_dispatch() {
        let injected = "x\") { preferences { text } } #";
        let (document, variables) = extension_catalogue_request(0, injected, None, None, None, false, false, None).unwrap();
        assert!(!document.contains(injected));
        assert!(!document.contains("isNsfw") && !document.contains("preferences"));
        assert_eq!(variables["term"], injected);
        for (offset, term, language) in [(100_001, "valid", None), (0, "bad\nterm", None), (0, "valid", Some("")),
            (0, "valid", Some("en\"")), (0, "valid", Some("en us"))] {
            assert!(extension_catalogue_request(offset, term, None, language, None, false, false, None).is_err());
        }
        assert!(extension_catalogue_request(0, &"x".repeat(201), None, None, None, false, false, None).is_err());
    }

    #[test]
    fn metadata_preserves_exact_versions_and_states_without_returning_unrequested_fields() {
        let mut original = extension("org.tsugi.fixture");
        original["versionCodeLong"] = json!(i64::MAX);
        original["isObsolete"] = json!(true);
        original["apkUrl"] = json!("https://example.invalid/unrequested.apk");
        let page = extension_catalogue_page(&json!({"nodes": [original], "totalCount": 101}), 100).unwrap();
        assert_eq!(page["totalCount"], 101);
        let row = &page["nodes"][0];
        assert_eq!(row["versionCodeLong"], "9223372036854775807");
        assert_eq!(row["versionName"], "1.6.1");
        assert_eq!(row["isInstalled"], true);
        assert_eq!(row["hasUpdate"], true);
        assert_eq!(row["isObsolete"], true);
        assert_eq!(row["contentWarning"], "MIXED");
        assert!(row.get("apkUrl").is_none());
        let mut local = extension("eu.kanade.tachiyomi.source.local");
        local["versionCodeLong"] = json!(0);
        local["storeIndexUrl"] = Value::Null;
        assert_eq!(extension_metadata(&local).unwrap()["versionCodeLong"], "0");
        assert!(extension_metadata(&local).unwrap()["storeIndexUrl"].is_null());
    }

    #[test]
    fn metadata_and_paging_reject_unknown_ratings_ambiguous_versions_duplicates_and_invalid_counts() {
        for (field, value) in [("contentWarning", Value::Null), ("contentWarning", json!("UNKNOWN")),
            ("isInstalled", json!("true")), ("versionCodeLong", json!("01")), ("versionCodeLong", json!("9223372036854775808")),
            ("versionCodeLong", json!(1.5)), ("name", json!("bad\nlabel")), ("name", json!("x".repeat(501))),
            ("pkgName", json!("../unowned")), ("extensionLib", json!(true))] {
            let mut row = extension("org.tsugi.fixture"); row[field] = value;
            assert!(extension_catalogue_page(&json!({"nodes": [row], "totalCount": 1}), 0).is_err());
        }
        for total in [json!(-1), json!("1"), json!(1.5), json!(u64::MAX)] {
            assert!(extension_catalogue_page(&json!({"nodes": [], "totalCount": total}), 0).is_err());
        }
        for nodes in [vec![extension("org.tsugi.fixture"), extension("org.tsugi.fixture")],
            vec![extension("org.tsugi.z"), extension("org.tsugi.a")]] {
            assert!(extension_catalogue_page(&json!({"nodes": nodes, "totalCount": 2}), 0).is_err());
        }
        assert!(extension_catalogue_page(&json!({"nodes": [extension("org.tsugi.fixture")], "totalCount": 1}), 100).is_err());
        let too_many = (0..101).map(|index| extension(&format!("org.tsugi.fixture{index:03}"))).collect::<Vec<_>>();
        assert!(extension_catalogue_page(&json!({"nodes": too_many, "totalCount": 101}), 0).is_err());
        assert!(extension_catalogue_page(&json!({"nodes": [], "totalCount": 101}), 200).is_ok());
    }
}

const SOURCE_INVENTORY_LIMIT: u32 = 1000;
const SOURCE_INVENTORY_PAGE: u32 = 100;
const SOURCE_INVENTORY_INVALID: &str = "The complete Reader source inventory could not be verified.";
const SOURCE_INVENTORY_CHANGED: &str = "Reader sources changed during discovery. Refresh the source inventory again.";

#[derive(PartialEq)]
struct SourceInventoryPass { nodes: Vec<Value>, total: u32 }

fn source_inventory_text(value: &Value, limit: usize) -> Result<&str, &'static str> {
    value.as_str().filter(|value| value.len() <= limit * 4 && value.chars().count() <= limit && !value.chars().any(char::is_control))
        .ok_or(SOURCE_INVENTORY_INVALID)
}

fn source_inventory_pass(fetch: &mut impl FnMut(u32) -> Result<Value, &'static str>) -> Result<SourceInventoryPass, &'static str> {
    let mut expected_total = None;
    let mut offset = 0;
    let mut previous_id = None;
    let mut result = Vec::new();
    loop {
        let page = fetch(offset)?;
        let total = page["totalCount"].as_u64().filter(|total| *total <= u64::from(SOURCE_INVENTORY_LIMIT))
            .ok_or("The Reader source inventory exceeds the supported 1,000-source limit or returned an invalid count.")? as u32;
        if expected_total.replace(total).is_some_and(|expected| expected != total) { return Err(SOURCE_INVENTORY_CHANGED); }
        let nodes = page["nodes"].as_array().ok_or(SOURCE_INVENTORY_INVALID)?;
        if nodes.len() > SOURCE_INVENTORY_PAGE.min(total.saturating_sub(offset)) as usize { return Err(SOURCE_INVENTORY_INVALID); }
        for node in nodes {
            // Native JSON can represent i64 numbers exactly; every public ID
            // becomes a canonical decimal string before entering JavaScript.
            let id = metadata_i64(&node["id"]).ok_or(SOURCE_INVENTORY_INVALID)?;
            if previous_id.is_some_and(|previous| id <= previous) { return Err(SOURCE_INVENTORY_CHANGED); }
            previous_id = Some(id);
            let mut row = json!({"id": id.to_string(), "name": source_inventory_text(&node["name"], 500)?,
                "lang": source_inventory_text(&node["lang"], 64)?,
                "supportsLatest": node["supportsLatest"].as_bool().ok_or(SOURCE_INVENTORY_INVALID)?,
                "isConfigurable": node["isConfigurable"].as_bool().ok_or(SOURCE_INVENTORY_INVALID)?,
                "contentWarning": metadata_content_warning(&node["contentWarning"]).map_err(|_| SOURCE_INVENTORY_INVALID)?,
                "extension": extension_metadata(&node["extension"]).map_err(|_| SOURCE_INVENTORY_INVALID)?});
            if let Some(display_name) = node.get("displayName").filter(|value| !value.is_null()) {
                row["displayName"] = json!(source_inventory_text(display_name, 500)?);
            }
            result.push(row);
        }
        // Pinned SourceQuery paginates database rows before mapNotNull omits
        // unloadable sources. Short or empty visible pages are not the end.
        offset += SOURCE_INVENTORY_PAGE;
        if offset >= total { return Ok(SourceInventoryPass { nodes: result, total }); }
    }
}

fn complete_source_inventory(mut fetch: impl FnMut(u32) -> Result<Value, &'static str>) -> Result<Value, &'static str> {
    let first = source_inventory_pass(&mut fetch)?;
    let second = source_inventory_pass(&mut fetch)?;
    if first != second { return Err(SOURCE_INVENTORY_CHANGED); }
    // Complete means every raw page was observed twice with the same visible
    // rows/count, not that every database source loaded. No transaction token
    // is available across upstream requests. Preserve the raw database count.
    Ok(json!({"nodes": second.nodes, "totalCount": second.total, "complete": true}))
}

#[cfg(test)]
mod source_inventory_tests {
    use super::*;

    fn source(id: Value) -> Value {
        json!({"id": id, "name": "Original source", "lang": "en", "displayName": "Original source (EN)",
            "supportsLatest": true, "isConfigurable": false, "contentWarning": "MIXED",
            "extension": {"name": "Original extension", "pkgName": "org.tsugi.fixture", "versionName": "1.6.1",
                "versionCodeLong": "1", "storeIndexUrl": null, "isInstalled": true, "hasUpdate": false, "isObsolete": false}})
    }

    #[test]
    fn sparse_raw_pages_do_not_hide_later_sources_or_round_signed_ids() {
        for empty_first in [false, true] {
            let mut requests = Vec::new();
            let result = complete_source_inventory(|offset| {
                requests.push(offset);
                let mut first = source(json!(i64::MIN));
                first["unrequested"] = json!("must not enter the webview");
                let nodes = match offset {
                    0 if !empty_first => vec![first],
                    100 if empty_first => vec![source(json!("-9007199254740993"))],
                    200 => vec![source(json!(i64::MAX))],
                    0 | 100 => Vec::new(),
                    _ => panic!("inventory requested an invalid raw page"),
                };
                Ok(json!({"nodes": nodes, "totalCount": 201}))
            }).unwrap();
            assert_eq!(requests, [0, 100, 200, 0, 100, 200]);
            assert_eq!(result["totalCount"], 201);
            assert_eq!(result["complete"], true);
            let rows = result["nodes"].as_array().unwrap();
            assert_eq!(rows.len(), 2);
            assert_eq!(rows[0]["id"], if empty_first { "-9007199254740993" } else { "-9223372036854775808" });
            assert_eq!(rows[1]["id"], "9223372036854775807");
            assert!(rows.iter().all(|row| row.get("unrequested").is_none()));
        }
    }

    #[test]
    fn empty_inventory_and_local_source_remain_valid_complete_results() {
        for nodes in [json!([]), json!([source(json!(0))])] {
            let mut requests = Vec::new();
            let result = complete_source_inventory(|offset| {
                requests.push(offset);
                Ok(json!({"nodes": nodes, "totalCount": nodes.as_array().unwrap().len()}))
            }).unwrap();
            assert_eq!(requests, [0, 0]);
            assert_eq!(result["complete"], true);
            if !nodes.as_array().unwrap().is_empty() { assert_eq!(result["nodes"][0]["id"], "0"); }
        }
    }

    #[test]
    fn inventory_accepts_the_bound_without_skipping_or_repeating_pages() {
        let mut requests = Vec::new();
        let result = complete_source_inventory(|offset| {
            requests.push(offset);
            let nodes = (offset..offset + 100).map(|id| source(json!(i64::from(id) - 500))).collect::<Vec<_>>();
            Ok(json!({"nodes": nodes, "totalCount": 1000}))
        }).unwrap();
        assert_eq!(result["nodes"].as_array().unwrap().len(), 1000);
        assert_eq!(requests, (0..2).flat_map(|_| (0..1000).step_by(100)).collect::<Vec<_>>());
    }

    #[test]
    fn inventory_rejects_unbounded_invalid_and_overfull_raw_pages() {
        for count in [json!(1001), json!(-1), json!(1.5), json!("1"), Value::Null] {
            assert!(complete_source_inventory(|_| Ok(json!({"nodes": [], "totalCount": count}))).is_err());
        }
        assert!(complete_source_inventory(|_| Ok(json!({"nodes": [source(json!(1))], "totalCount": 0}))).is_err());
        assert!(complete_source_inventory(|_| Ok(json!({"nodes": {}, "totalCount": 1}))).is_err());
        assert!(complete_source_inventory(|offset| {
            let nodes = if offset == 0 { Vec::new() } else { vec![source(json!(1)), source(json!(2))] };
            Ok(json!({"nodes": nodes, "totalCount": 101}))
        }).is_err());
        let oversized = (0..101).map(|id| source(json!(id))).collect::<Vec<_>>();
        assert!(complete_source_inventory(|_| Ok(json!({"nodes": oversized, "totalCount": 1000}))).is_err());
    }

    #[test]
    fn inventory_rejects_ambiguous_out_of_range_or_nonascending_source_ids() {
        for id in [Value::Null, json!({}), json!(1.5), json!(u64::MAX), json!("9223372036854775808"),
            json!("-9223372036854775809"), json!("+1"), json!("01"), json!("-0"), json!("1 ")] {
            assert!(complete_source_inventory(|_| Ok(json!({"nodes": [source(id.clone())], "totalCount": 1}))).is_err());
        }
        for ids in [[json!(0), json!("0")], [json!("2"), json!("1")]] {
            assert!(complete_source_inventory(|_| Ok(json!({"nodes": ids.iter().cloned().map(source).collect::<Vec<_>>(), "totalCount": 2}))).is_err());
        }
        assert!(complete_source_inventory(|offset| Ok(json!({"nodes": [source(json!(if offset == 0 { 2 } else { 1 }))], "totalCount": 101}))).is_err());
    }

    #[test]
    fn inventory_rejects_changes_within_and_between_complete_passes() {
        assert_eq!(complete_source_inventory(|offset| Ok(json!({"nodes": [], "totalCount": if offset == 0 { 101 } else { 100 }}))).unwrap_err(), SOURCE_INVENTORY_CHANGED);
        for (field, change) in [("id", json!(2)), ("name", json!("Changed")), ("lang", json!("fr")),
            ("displayName", json!("Changed (EN)")), ("supportsLatest", json!(false)), ("isConfigurable", json!(true)),
            ("contentWarning", json!("NSFW"))] {
            let mut requests = 0;
            assert_eq!(complete_source_inventory(|_| {
                requests += 1;
                let mut row = source(json!(1));
                if requests == 2 { row[field] = change.clone(); }
                Ok(json!({"nodes": [row], "totalCount": 1}))
            }).unwrap_err(), SOURCE_INVENTORY_CHANGED);
        }
        let mut requests = 0;
        assert_eq!(complete_source_inventory(|_| {
            requests += 1;
            Ok(json!({"nodes": [], "totalCount": if requests == 1 { 1 } else { 0 }}))
        }).unwrap_err(), SOURCE_INVENTORY_CHANGED);
    }

    #[test]
    fn inventory_projects_owning_extension_metadata_and_rejects_changes_between_scans() {
        let mut original = source(json!("9007199254740993"));
        original["extension"]["versionCodeLong"] = json!(i64::MAX);
        original["extension"]["unrequested"] = json!("must not enter the webview");
        let result = complete_source_inventory(|_| Ok(json!({"nodes": [original], "totalCount": 1}))).unwrap();
        let row = &result["nodes"][0];
        assert_eq!(row["id"], "9007199254740993");
        assert_eq!(row["contentWarning"], "MIXED");
        assert_eq!(row["isConfigurable"], false);
        assert_eq!(row["extension"]["versionCodeLong"], "9223372036854775807");
        assert!(row["extension"].get("unrequested").is_none());
        for (field, value) in [("hasUpdate", json!(true)), ("isObsolete", json!(true)), ("versionCodeLong", json!("2")),
            ("storeIndexUrl", json!("https://example.invalid/index.pb"))] {
            let mut count = 0;
            assert_eq!(complete_source_inventory(|_| {
                let mut row = source(json!(1)); count += 1;
                if count == 2 { row["extension"][field] = value.clone(); }
                Ok(json!({"nodes": [row], "totalCount": 1}))
            }).unwrap_err(), SOURCE_INVENTORY_CHANGED);
        }
    }

    #[test]
    fn inventory_requires_bounded_metadata_and_preserves_upstream_failure() {
        for (field, value) in [("name", json!("x".repeat(501))), ("lang", json!("x".repeat(65))),
            ("displayName", json!("bad\nlabel")), ("supportsLatest", json!("true")), ("isConfigurable", Value::Null),
            ("contentWarning", json!("UNKNOWN")), ("extension", Value::Null)] {
            let mut row = source(json!(1));
            row[field] = value;
            assert!(complete_source_inventory(|_| Ok(json!({"nodes": [row.clone()], "totalCount": 1}))).is_err());
        }
        let mut requests = 0;
        assert_eq!(complete_source_inventory(|offset| {
            requests += 1;
            if offset == 100 { return Err("Owned runtime unavailable."); }
            Ok(json!({"nodes": [], "totalCount": 101}))
        }).unwrap_err(), "Owned runtime unavailable.");
        assert_eq!(requests, 2);
    }
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

fn extension_package(value: &str) -> Result<(), &'static str> {
    if value.len() > 200 || !value.contains('.') || value.split('.').any(|part| {
        part.is_empty() || !part.bytes().next().is_some_and(|b| b.is_ascii_alphabetic())
            || !part.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
    }) {
        return Err("Invalid extension package identifier.");
    }
    Ok(())
}

fn extension_download(value: &str, suffix: &str) -> Result<(), &'static str> {
    let invalid = "Invalid extension download URL.";
    if value.len() > 2048 || value.trim() != value || value.chars().any(char::is_control) {
        return Err(invalid);
    }
    let parsed = url::Url::parse(value).map_err(|_| invalid)?;
    let Some(url::Host::Domain(host)) = parsed.host() else { return Err(invalid) };
    let name = parsed.path_segments().and_then(|mut segments| segments.next_back()).ok_or(invalid)?;
    if parsed.scheme() != "https" || !parsed.username().is_empty() || parsed.password().is_some()
        || parsed.port().is_some() || parsed.query().is_some() || parsed.fragment().is_some()
        || !host.contains('.') || host.ends_with(".localhost") || host.ends_with(".local")
        || name.len() > 220 || !name.ends_with(suffix)
        || !name.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
    {
        return Err(invalid);
    }
    Ok(())
}

/// Native-only review snapshot. Its private fields cannot be assembled by
/// the web page. The caller must display it in a native confirmation before
/// invoking installation; this is trust in the publisher, not signature proof.
pub struct ExtensionReview {
    package: String,
    metadata: Value,
    store: Value,
    description: String,
}

impl ExtensionReview {
    pub fn description(&self) -> &str {
        &self.description
    }
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

// Create the reading root with a protected DACL before any credential is
// written. Inspect real filesystem handles (including reparse-point checks)
// rather than parsing localized command output or trusting an inherited ACL.
pub(crate) mod private_storage {
    use super::*;
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
    use std::ptr::null_mut;

    const INVALID: &str = "Reading storage permissions are not private.";
    const FILE_ALL_ACCESS: u32 = 0x001f01ff;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    const READ_CONTROL: u32 = 0x00020000;
    const FILE_READ_ATTRIBUTES: u32 = 0x80;
    const OPEN_REPARSE_POINT: u32 = 0x00200000;
    const BACKUP_SEMANTICS: u32 = 0x02000000;

    #[repr(C)]
    struct SecurityAttributes {
        length: u32,
        descriptor: *mut c_void,
        inherit: i32,
    }

    #[repr(C)]
    struct Acl {
        revision: u8,
        reserved: u8,
        size: u16,
        count: u16,
        reserved2: u16,
    }

    #[repr(C)]
    struct AllowedAce {
        kind: u8,
        flags: u8,
        size: u16,
        mask: u32,
        sid_start: u32,
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetCurrentProcess() -> *mut c_void;
        fn LocalFree(memory: *mut c_void) -> *mut c_void;
        fn CreateDirectoryW(path: *const u16, attributes: *const SecurityAttributes) -> i32;
    }

    #[link(name = "advapi32")]
    unsafe extern "system" {
        fn OpenProcessToken(process: *mut c_void, access: u32, token: *mut *mut c_void) -> i32;
        fn GetTokenInformation(token: *mut c_void, class: i32, buffer: *mut c_void, length: u32, needed: *mut u32) -> i32;
        fn ConvertSidToStringSidW(sid: *mut c_void, text: *mut *mut u16) -> i32;
        fn ConvertStringSecurityDescriptorToSecurityDescriptorW(text: *const u16, revision: u32, descriptor: *mut *mut c_void, size: *mut u32) -> i32;
        fn GetSecurityInfo(handle: *mut c_void, object: i32, info: u32, owner: *mut *mut c_void, group: *mut *mut c_void, dacl: *mut *mut Acl, sacl: *mut *mut Acl, descriptor: *mut *mut c_void) -> u32;
        fn GetSecurityDescriptorControl(descriptor: *mut c_void, control: *mut u16, revision: *mut u32) -> i32;
        fn GetAce(acl: *mut Acl, index: u32, ace: *mut *mut c_void) -> i32;
        fn EqualSid(first: *mut c_void, second: *mut c_void) -> i32;
        fn IsWellKnownSid(sid: *mut c_void, kind: i32) -> i32;
    }

    struct LocalAllocation(*mut c_void);
    impl Drop for LocalAllocation {
        fn drop(&mut self) {
            if !self.0.is_null() {
                // SAFETY: this pointer is owned and was allocated by a Win32
                // API documented to return memory freed by LocalFree.
                unsafe { LocalFree(self.0); }
            }
        }
    }

    pub(crate) struct CurrentUser {
        // TOKEN_USER begins with a SID_AND_ATTRIBUTES, whose first field
        // is a pointer into this aligned, owned token-information buffer.
        buffer: Vec<usize>,
    }

    impl CurrentUser {
        pub(crate) fn get() -> Result<Self, &'static str> {
            let mut raw = null_mut();
            // SAFETY: the process pseudo-handle is valid; raw is an out pointer.
            if unsafe { OpenProcessToken(GetCurrentProcess(), 0x0008, &mut raw) } == 0
                || raw.is_null()
            {
                return Err(INVALID);
            }
            // SAFETY: successful OpenProcessToken gives us an owned handle.
            let token = unsafe { OwnedHandle::from_raw_handle(raw) };
            let mut size = 0;
            // SAFETY: documented size query for TokenUser (1).
            unsafe { GetTokenInformation(token.as_raw_handle(), 1, null_mut(), 0, &mut size); }
            if !(16..=65536).contains(&size) {
                return Err(INVALID);
            }
            let mut buffer = vec![0usize; (size as usize).div_ceil(std::mem::size_of::<usize>())];
            let capacity = (buffer.len() * std::mem::size_of::<usize>()) as u32;
            // SAFETY: buffer is aligned and writable for capacity bytes.
            if unsafe { GetTokenInformation(token.as_raw_handle(), 1, buffer.as_mut_ptr().cast(), capacity, &mut size) } == 0
                || size > capacity || buffer[0] == 0
            {
                return Err(INVALID);
            }
            Ok(Self { buffer })
        }

        fn sid(&self) -> *mut c_void {
            self.buffer[0] as *mut c_void
        }

        fn sid_string(&self) -> Result<String, &'static str> {
            let mut raw = null_mut();
            // SAFETY: SID is backed by the live TOKEN_USER buffer.
            if unsafe { ConvertSidToStringSidW(self.sid(), &mut raw) } == 0 || raw.is_null() {
                return Err(INVALID);
            }
            let _allocation = LocalAllocation(raw.cast());
            // SAFETY: successful conversion returns a NUL-terminated string.
            let mut len = 0;
            while len < 256 && unsafe { *raw.add(len) } != 0 {
                len += 1;
            }
            if len == 256 {
                return Err(INVALID);
            }
            // SAFETY: len was obtained from the allocated string.
            String::from_utf16(unsafe { std::slice::from_raw_parts(raw, len) }).map_err(|_| INVALID)
        }

        pub(crate) fn create_root(&self, path: &Path) -> Result<bool, &'static str> {
            let sid = self.sid_string()?;
            // Explicit owner and one inheritable full-access ACE for the
            // current user only. P prevents inheritance from the parent.
            let descriptor = format!("O:{sid}D:P(A;OICI;FA;;;{sid})");
            create_with_descriptor(path, &descriptor)
        }

        pub(crate) fn verify(&self, path: &Path, directory: bool) -> Result<(), &'static str> {
            self.verify_policy(path, directory, false)
        }

        /// Descendants may inherit the verified root's single private ACE.
        /// Keep the protected, explicit-user root policy separate so an
        /// inherited application-data directory can never become our root.
        pub(crate) fn verify_descendant(&self, path: &Path, directory: bool) -> Result<(), &'static str> {
            self.verify_policy(path, directory, true)
        }

        fn verify_policy(&self, path: &Path, directory: bool, descendant: bool) -> Result<(), &'static str> {
            let file = fs::OpenOptions::new()
                .access_mode(READ_CONTROL | FILE_READ_ATTRIBUTES)
                .custom_flags(OPEN_REPARSE_POINT | BACKUP_SEMANTICS)
                .open(path).map_err(|_| "Could not open reading storage for security inspection.")?;
            let info = file.metadata().map_err(|_| "Could not inspect reading storage attributes.")?;
            if info.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
                || (directory && !info.is_dir()) || (!directory && !info.is_file())
            {
                return Err(INVALID);
            }
            let mut owner = null_mut();
            let mut acl = null_mut();
            let mut raw = null_mut();
            // SAFETY: file handle stays live and all output pointers are valid.
            // SE_FILE_OBJECT=1, OWNER_SECURITY_INFORMATION|DACL_SECURITY_INFORMATION=5.
            let status = unsafe {
                GetSecurityInfo(file.as_raw_handle(), 1, 5, &mut owner, null_mut(), &mut acl, null_mut(), &mut raw)
            };
            let _allocation = LocalAllocation(raw);
            if status != 0 || raw.is_null() || owner.is_null() || acl.is_null() {
                return Err("Reading storage security descriptor is unavailable.");
            }
            let mut control = 0;
            let mut revision = 0;
            // SAFETY: owner, ACL and descriptor are owned by the live allocation.
            // The root is explicitly user-owned. Files created without an
            // explicit owner (including JVM config replacements) may instead
            // be owned by Builtin Administrators under an elevated token.
            // Administrators already have privileged access; never add an
            // Administrators ACE or accept arbitrary group ownership.
            // WinBuiltinAdministratorsSid = 26.
            let user_owned = unsafe { EqualSid(owner, self.sid()) } != 0;
            let admin_owned = (!directory || descendant) && unsafe { IsWellKnownSid(owner, 26) } != 0;
            if !user_owned && !admin_owned {
                return Err("Reading storage owner is not permitted.");
            }
            if unsafe { GetSecurityDescriptorControl(raw, &mut control, &mut revision) } == 0 {
                return Err("Could not inspect reading storage DACL control flags.");
            }
            if control & 0x0004 == 0 || (directory && !descendant && control & 0x1000 == 0) {
                return Err("Reading storage DACL protection flags are invalid.");
            }
            if unsafe { (*acl).count } != 1 {
                return Err("Reading storage DACL must contain exactly one ACE.");
            }
            let mut ace = null_mut();
            // SAFETY: the OS returned this ACL; the single ACE is within it.
            if unsafe { GetAce(acl, 0, &mut ace) } == 0 || ace.is_null() {
                return Err(INVALID);
            }
            let ace = ace.cast::<AllowedAce>();
            // SAFETY: inspect the OS-provided ACE header; only accept ordinary
            // access-allowed ACEs with sufficient space for a SID.
            let valid = unsafe {
                (*ace).kind == 0 && (*ace).size >= 16
                    && (*ace).mask == FILE_ALL_ACCESS
                    && if directory {
                        (*ace).flags == 3 || (descendant && (*ace).flags == 19)
                    } else { matches!((*ace).flags, 0 | 16) }
            };
            if !valid {
                return Err("Reading storage ACE type, mask or inheritance flags are invalid.");
            }
            if unsafe { EqualSid(std::ptr::addr_of_mut!((*ace).sid_start).cast(), self.sid()) } == 0 {
                return Err("Reading storage ACE does not identify the current user.");
            }
            Ok(())
        }
    }

    fn create_with_descriptor(path: &Path, descriptor: &str) -> Result<bool, &'static str> {
        let wide: Vec<u16> = descriptor.encode_utf16().chain([0]).collect();
        let mut raw = null_mut();
        // SAFETY: input is NUL-terminated, raw is a valid out pointer.
        if unsafe { ConvertStringSecurityDescriptorToSecurityDescriptorW(wide.as_ptr(), 1, &mut raw, null_mut()) } == 0
            || raw.is_null()
        {
            return Err(INVALID);
        }
        let _allocation = LocalAllocation(raw);
        let attributes = SecurityAttributes {
            length: std::mem::size_of::<SecurityAttributes>() as u32,
            descriptor: raw,
            inherit: 0,
        };
        let mut path: Vec<u16> = path.as_os_str().encode_wide().collect();
        if path.contains(&0) {
            return Err(INVALID);
        }
        path.push(0);
        // SAFETY: path and security descriptor remain live through the call.
        if unsafe { CreateDirectoryW(path.as_ptr(), &attributes) } != 0 {
            Ok(true)
        } else if std::io::Error::last_os_error().raw_os_error() == Some(183) {
            Ok(false)
        } else {
            Err(INVALID)
        }
    }

    #[cfg(test)]
    pub(crate) fn create_public_fixture(path: &Path, user: &CurrentUser) {
        let sid = user.sid_string().unwrap();
        assert!(create_with_descriptor(path, &format!("O:{sid}D:P(A;OICI;FA;;;WD)")).unwrap());
    }
}

/// A native-owned reading data directory. Hold an exclusive OS file lock
/// throughout the child lifetime. Never rewrite an existing server config:
/// it contains the extension store preferences maintained by Suwayomi.
/// The caller must supply a trusted, current-user app-data parent path.
/// Root and sensitive files must pass the owner-only ACL checks.
struct ReadStorage {
    temp_dir: std::path::PathBuf,
    _lock: fs::File,
    password: String,
}

impl ReadStorage {
    fn open(data: &Path, port: u16) -> Result<Self, &'static str> {
        let user = private_storage::CurrentUser::get()?;
        let fresh = user.create_root(data)?;
        user.verify(data, true)?;
        let lock_path = data.join(".tsugi-read.lock");
        let key_path = data.join(".tsugi-read.key");
        let config_path = data.join("server.conf");
        let lock = if fresh {
            fs::OpenOptions::new().read(true).write(true).create_new(true).open(&lock_path)
        } else {
            // Do not adopt an arbitrary existing Suwayomi directory.
            // A crash during checkpoint recovery can temporarily displace
            // server.conf. Authenticate storage through the lock/key first.
            for path in [&lock_path, &key_path] {
                user.verify(path, false)?;
            }
            fs::OpenOptions::new().read(true).write(true).open(&lock_path)
        }.map_err(|_| "Could not open reading storage lock.")?;
        lock.try_lock().map_err(|_| "Reading data is already in use.")?;
        // Recover before requiring server.conf, while still refusing foreign
        // storage and retaining the exclusive lock through every replacement.
        crate::read_checkpoint::recover_pending(data)?;
        let password = if fresh {
            let mut entropy = [0u8; 32];
            getrandom::fill(&mut entropy).map_err(|_| "Could not secure reading runtime.")?;
            let password = entropy.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
            let mut key = fs::OpenOptions::new().write(true).create_new(true).open(&key_path)
                .map_err(|_| "Could not initialize reading credentials.")?;
            key.write_all(password.as_bytes()).and_then(|_| key.sync_all())
                .map_err(|_| "Could not save reading credentials.")?;
            // Preserve the original, smoke-tested config shape on first launch.
            // Suwayomi migrates extensionRepos to extensionStores; do not
            // overwrite either field when reopening the database.
            let config = format!(
                "server.ip = \"127.0.0.1\"\nserver.port = {port}\nserver.webUIEnabled = false\nserver.initialOpenInBrowserEnabled = false\nserver.systemTrayEnabled = false\nserver.kcefEnabled = false\nserver.authMode = \"basic_auth\"\nserver.authUsername = \"{USER}\"\nserver.authPassword = \"{password}\"\nserver.extensionRepos = []\nserver.globalUpdateInterval = 0\n"
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
        // Inheritance must also have protected all newly created files.
        for path in [&lock_path, &key_path, &config_path] {
            user.verify(path, false)?;
        }
        // Java and Suwayomi otherwise share TEMP/Tachidesk across portable installations.
        let temp_dir = data.join("runtime-temp");
        user.create_root(&temp_dir)?;
        user.verify(&temp_dir, true)?;
        Ok(Self { _lock: lock, password, temp_dir })
    }
}

// Unnamed, non-inheritable Windows Job Object. No breakaway flags are set.
// Layouts match winnt.h on Windows, including pointer-sized SIZE_T/ULONG_PTR.
#[repr(C)]
#[derive(Default)]
struct JobBasicLimits {
    per_process_user_time_limit: i64,
    per_job_user_time_limit: i64,
    limit_flags: u32,
    minimum_working_set_size: usize,
    maximum_working_set_size: usize,
    active_process_limit: u32,
    affinity: usize,
    priority_class: u32,
    scheduling_class: u32,
}

#[repr(C)]
#[derive(Default)]
struct JobExtendedLimits {
    basic: JobBasicLimits,
    io_counters: [u64; 6],
    process_memory_limit: usize,
    job_memory_limit: usize,
    peak_process_memory_used: usize,
    peak_job_memory_used: usize,
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn CreateJobObjectW(attributes: *const std::ffi::c_void, name: *const u16) -> *mut std::ffi::c_void;
    fn SetInformationJobObject(job: *mut std::ffi::c_void, class: i32, info: *const std::ffi::c_void, len: u32) -> i32;
    fn AssignProcessToJobObject(job: *mut std::ffi::c_void, process: *mut std::ffi::c_void) -> i32;
}

pub struct ReadJob(OwnedHandle);

impl ReadJob {
    pub fn new() -> Result<Self, &'static str> {
        const EXTENDED_LIMIT_INFORMATION: i32 = 9;
        const KILL_ON_JOB_CLOSE: u32 = 0x2000;
        // SAFETY: null attributes and name create a non-inheritable unnamed job.
        let raw = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if raw.is_null() {
            return Err("Could not create reading process job.");
        }
        // SAFETY: successful CreateJobObjectW returns a new owned handle.
        let job = Self(unsafe { OwnedHandle::from_raw_handle(raw) });
        let mut limits = JobExtendedLimits::default();
        limits.basic.limit_flags = KILL_ON_JOB_CLOSE;
        // SAFETY: correct C layout and size for JobObjectExtendedLimitInformation.
        let ok = unsafe {
            SetInformationJobObject(
                job.0.as_raw_handle(),
                EXTENDED_LIMIT_INFORMATION,
                (&limits as *const JobExtendedLimits).cast(),
                std::mem::size_of::<JobExtendedLimits>() as u32,
            )
        };
        if ok == 0 {
            return Err("Could not configure reading process job.");
        }
        Ok(job)
    }

    pub fn attach(&self, child: &Child) -> Result<(), &'static str> {
        // SAFETY: both owned handles remain live throughout this call.
        let assigned = unsafe {
            AssignProcessToJobObject(self.0.as_raw_handle(), child.as_raw_handle())
        };
        if assigned == 0 {
            return Err("Could not contain reading process.");
        }
        Ok(())
    }

    fn attach_and_release(&self, child: &mut Child) -> Result<(), &'static str> {
        self.attach(child)?;
        // The Java bootstrap waits for this one byte before loading upstream code.
        child.stdin.as_mut().ok_or("Reading startup pipe is missing.")?
            .write_all(&[1]).map_err(|_| "Could not release reading startup gate.")
    }
}

// Suwayomi's documented OAuth relay returns the provider callback to the
// redirectUrl in state. Keep the listener, nonce, callback and provider token
// in native code; never send an authorization URL or callback to the webview.
fn tracker_callback(target: &str, redirect: &url::Url, state: &Value, id: i32) -> Option<String> {
    if target.len() > 16_384 || !target.starts_with("/tracker/oauth/") || target.starts_with("//") {
        return None;
    }
    let callback = redirect.join(target).ok()?;
    if callback.origin() != redirect.origin() || callback.path() != redirect.path() || callback.fragment().is_some() {
        return None;
    }
    let params: Vec<_> = callback.query_pairs().collect();
    let one = |key: &str| {
        let mut matches = params.iter().filter(|(k, _)| k == key);
        let value = matches.next()?.1.as_ref();
        if value.is_empty() || matches.next().is_some() { None } else { Some(value) }
    };
    if serde_json::from_str::<Value>(one("state")?).ok()?.ne(state) {
        return None;
    }
    let key = if id == 1 { "code" } else if id == 2 { "access_token" } else { return None };
    if params.iter().any(|(k, _)| k == "error") || one(key)?.len() > 8192 {
        return None;
    }
    Some(callback.to_string())
}

fn tracker_auth_url(id: i32, raw: &str, state: &Value) -> Result<url::Url, &'static str> {
    let (host, path) = match id {
        1 => ("myanimelist.net", "/v1/oauth2/authorize"),
        2 => ("anilist.co", "/api/v2/oauth/authorize"),
        _ => return Err("This tracker login is not enabled yet."),
    };
    let mut url = url::Url::parse(raw).map_err(|_| "Invalid tracker authorization URL.")?;
    if url.scheme() != "https" || url.host_str() != Some(host) || url.port().is_some()
        || !url.username().is_empty() || url.password().is_some() || url.path() != path
        || url.fragment().is_some() || url.query_pairs().any(|(key, _)| key == "state") {
        return Err("Invalid tracker authorization URL.");
    }
    url.query_pairs_mut().append_pair("state", &state.to_string());
    Ok(url)
}

fn await_tracker_callback(listener: TcpListener, redirect: &url::Url, state: &Value, id: i32, stop: &AtomicBool) -> Result<String, &'static str> {
    listener.set_nonblocking(true).map_err(|_| "Could not prepare tracker callback.")?;
    let deadline = Instant::now() + Duration::from_secs(110);
    while Instant::now() < deadline && !stop.load(Ordering::Acquire) {
        match listener.accept() {
            Ok((mut stream, peer)) => {
                if !peer.ip().is_loopback() { continue; }
                let _ = stream.set_nonblocking(false);
                let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
                let _ = stream.set_write_timeout(Some(Duration::from_secs(1)));
                let mut first = String::new();
                // Bound both the request size and processing time. No request
                // logging, referrer, remote script or echo of the callback.
                let received = BufReader::new((&mut stream).take(16_385)).read_line(&mut first).is_ok();
                let mut words = first.split_whitespace();
                let callback = if received && words.next() == Some("GET") {
                    words.next().and_then(|target| tracker_callback(target, redirect, state, id))
                } else { None };
                let (status, body) = if callback.is_some() {
                    ("200 OK", "Authorization received. Return to Tsugi to see the connection result.")
                } else {
                    ("400 Bad Request", "Invalid or expired Tsugi authorization request.")
                };
                let reply = format!("HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}", body.len());
                let _ = stream.write_all(reply.as_bytes());
                if let Some(callback) = callback { return Ok(callback); }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(100)),
            Err(_) => return Err("Tracker callback listener failed."),
        }
    }
    Err("Tracker authorization expired or was cancelled. Try again.")
}

/// Owns the launched process, private client, kill-on-close job and exclusive storage lock.
pub struct ReadRuntime {
    child: Child,
    client: ReadClient,
    job: Option<ReadJob>,
    _storage: ReadStorage,
    runtime_path: std::path::PathBuf,
    data_path: std::path::PathBuf,
}

impl ReadRuntime {
    pub fn start(runtime: &Path, data: &Path) -> Result<Self, &'static str> {
        let runtime = std::path::absolute(runtime)
            .map_err(|_| "Reading runtime is missing.")?;
        let data = std::path::absolute(data)
            .map_err(|_| "Could not locate reading data directory.")?;
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .map_err(|_| "Could not allocate reading port.")?;
        let port = listener
            .local_addr()
            .map_err(|_| "Could not allocate reading port.")?
            .port();
        let storage = ReadStorage::open(&data, port)?;
        local_import::remove_abandoned_stages(&data);
        drop(listener);
        let (child, client, job) = Self::spawn(&runtime, &data, &storage, port)?;
        let mut managed = Self {
            child,
            client,
            job: Some(job),
            _storage: storage,
            runtime_path: runtime,
            data_path: data,
        };
        managed.await_ready()?;
        Ok(managed)
    }

    /// Launch or restart while the caller retains the same exclusive data lock.
    fn spawn(runtime: &Path, data: &Path, storage: &ReadStorage, port: u16) -> Result<(Child, ReadClient, ReadJob), &'static str> {
        let java = runtime.join("jre/bin/java.exe");
        let jar = runtime.join("bin/Suwayomi-Server.jar");
        let launcher = runtime.join("launcher");
        if !java.is_file() || !jar.is_file() || !launcher.join("TsugiReadLauncher.class").is_file() {
            return Err("Reading runtime is incomplete.");
        }
        let classpath = std::env::join_paths([&launcher, &jar])
            .map_err(|_| "Invalid reading runtime path.")?;
        let job = ReadJob::new()?;
        let mut child = Command::new(java)
            .arg(format!("-Djava.io.tmpdir={}", storage.temp_dir.display()))
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
                "-cp",
            ])
            .arg(classpath)
            .arg("TsugiReadLauncher")
            // Do not allow inherited Java option variables to inject code before the gate.
            .env_remove("JAVA_TOOL_OPTIONS")
            .env_remove("JDK_JAVA_OPTIONS")
            .env_remove("_JAVA_OPTIONS")
            .current_dir(runtime)
            .creation_flags(NO_WINDOW)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "Could not start reading runtime.")?;
        if let Err(error) = job.attach_and_release(&mut child) {
            drop(child.stdin.take());
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
        let client = ReadClient::new(port, child.id(), &storage.password);
        Ok((child, client, job))
    }

    fn await_ready(&mut self) -> Result<(), &'static str> {
        let deadline = Instant::now() + READY_TIMEOUT;
        while Instant::now() < deadline {
            if self
                .child
                .try_wait()
                .map_err(|_| "Could not check reading runtime.")?
                .is_some()
            {
                return Err("Reading runtime exited during startup.");
            }
            if self.client.query(ReadOperation::Status).is_ok() {
                self.client.verify_authentication()?;
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        Err("Reading runtime did not become ready.")
    }

    fn restart_after_stop(&mut self) -> Result<(), &'static str> {
        if self.child.try_wait().map_err(|_| "Could not check reading runtime.")?.is_none() {
            return Err("Reading runtime must be stopped before recovery.");
        }
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).map_err(|_| "Could not allocate reading port.")?;
        let port = listener.local_addr().map_err(|_| "Could not allocate reading port.")?.port();
        drop(listener);
        let (child, client, job) = Self::spawn(&self.runtime_path, &self.data_path, &self._storage, port)?;
        self.child = child;
        self.client = client;
        self.job = Some(job);
        if let Err(error) = self.await_ready() {
            let _ = self.shutdown();
            return Err(error);
        }
        Ok(())
    }

    pub fn query(&self, operation: ReadOperation) -> Result<Value, &'static str> {
        self.client.query(operation)
    }

    /// Bounded discovery of loaded sources. No catalogue, chapter or image
    /// fetch is issued; local source 0 remains in the raw inventory contract.
    pub fn source_inventory(&self) -> Result<Value, &'static str> {
        complete_source_inventory(|offset| self.client.document(
            "query TsugiSourceInventory($offset: Int!) { sources(first: 100, offset: $offset, order: [{ by: ID, byType: ASC }]) { nodes { id name lang displayName supportsLatest contentWarning isConfigurable extension { name pkgName versionName versionCodeLong storeIndexUrl isInstalled hasUpdate isObsolete } } totalCount } }",
            "sources", json!({"offset": offset})))
    }

    pub fn login_tracker(&self, id: i32, open: impl FnOnce(&str), stop: &AtomicBool) -> Result<Value, &'static str> {
        if !matches!(id, 1 | 2) { return Err("This tracker login is not enabled yet."); }
        let tracker = self.client.document(
            "query TsugiTrackerAuth($id: Int!) { tracker(id: $id) { id isLoggedIn authUrl } }",
            "tracker", json!({"id": id}))?;
        if tracker["isLoggedIn"] == true { return Err("Tracker is already connected."); }
        let raw = tracker["authUrl"].as_str().ok_or("Tracker authorization is unavailable.")?;
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).map_err(|_| "Could not open tracker callback.")?;
        let port = listener.local_addr().map_err(|_| "Could not open tracker callback.")?.port();
        let mut nonce = [0u8; 32];
        getrandom::fill(&mut nonce).map_err(|_| "Could not secure tracker authorization.")?;
        let nonce: String = nonce.iter().map(|b| format!("{b:02x}")).collect();
        let redirect = url::Url::parse(&format!("http://127.0.0.1:{port}/tracker/oauth/{nonce}")).map_err(|_| "Invalid tracker callback.")?;
        let state = json!({"redirectUrl": redirect.as_str(), "trackerId": id, "clientName": "Tsugi", "nonce": nonce});
        let auth = tracker_auth_url(id, raw, &state)?;
        open(auth.as_str());
        let callback = await_tracker_callback(listener, &redirect, &state, id, stop)?;
        let result = self.client.slow().mutation(
            "mutation TsugiTrackerLogin($input: LoginTrackerOAuthInput!) { loginTrackerOAuth(input: $input) { isLoggedIn } }",
            "loginTrackerOAuth", json!({"trackerId": id, "callbackUrl": callback}))?;
        if result["isLoggedIn"] != true { return Err("Tracker did not confirm the connection."); }
        Ok(result)
    }

    pub fn logout_tracker(&self, id: i32) -> Result<Value, &'static str> {
        if !matches!(id, 1 | 2) { return Err("This tracker logout is not enabled yet."); }
        self.client.slow().mutation(
            "mutation TsugiTrackerLogout($input: LogoutTrackerInput!) { logoutTracker(input: $input) { isLoggedIn } }",
            "logoutTracker", json!({"trackerId": id}))
    }

    pub fn track_records(&self, manga_id: i32) -> Result<Value, &'static str> {
        if manga_id <= 0 { return Err("Invalid manga identifier."); }
        self.client.document(
            "query TsugiTrackRecords($id: Int!) { trackRecords(condition: {mangaId: $id}, first: 20) { nodes { id trackerId title lastChapterRead totalChapters } totalCount } }",
            "trackRecords", json!({"id": manga_id}))
    }

    pub fn search_tracker(&self, id: i32, query: &str) -> Result<Value, &'static str> {
        if !matches!(id, 1 | 2) || query.trim().is_empty() || query.chars().count() > 200 || query.chars().any(char::is_control) {
            return Err("Invalid tracker search.");
        }
        self.client.slow().mutation(
            "query TsugiTrackerSearch($input: SearchTrackerInput!) { searchTracker(input: $input) { trackSearches { remoteId title totalChapters publishingType publishingStatus startDate } } }",
            "searchTracker", json!({"trackerId": id, "query": query.trim()}))
    }

    pub fn bind_tracker(&self, manga_id: i32, id: i32, remote_id: i64) -> Result<Value, &'static str> {
        if manga_id <= 0 || !matches!(id, 1 | 2) || remote_id <= 0 { return Err("Invalid tracker match."); }
        // Upstream binds only a previously searched record. Never silently
        // replace an existing link or guess a match from the manga title.
        let records = self.track_records(manga_id)?;
        if records["nodes"].as_array().is_some_and(|nodes| nodes.iter().any(|node| node["trackerId"] == id)) {
            return Err("Unlink the existing tracker match before linking another.");
        }
        self.client.slow().mutation(
            "mutation TsugiBindTrack($input: BindTrackInput!) { bindTrack(input: $input) { trackRecord { id trackerId title lastChapterRead totalChapters } } }",
            "bindTrack", json!({"mangaId": manga_id, "trackerId": id, "remoteId": remote_id.to_string()}))
    }

    pub fn unbind_tracker(&self, manga_id: i32, record_id: i32) -> Result<Value, &'static str> {
        let records = self.track_records(manga_id)?;
        if record_id <= 0 || !records["nodes"].as_array().is_some_and(|nodes| nodes.iter().any(|node| node["id"] == record_id)) {
            return Err("Tracker match not found.");
        }
        self.client.slow().mutation(
            "mutation TsugiUnbindTrack($input: UnbindTrackInput!) { unbindTrack(input: $input) { clientMutationId } }",
            "unbindTrack", json!({"recordId": record_id, "deleteRemoteTrack": false}))
    }

    pub fn sync_tracker_progress(&self, manga_id: i32) -> Result<Value, &'static str> {
        let records = self.track_records(manga_id)?;
        if records["totalCount"].as_u64().unwrap_or(0) == 0 { return Err("Link this manga to a tracker first."); }
        self.client.slow().mutation(
            "mutation TsugiTrackProgress($input: TrackProgressInput!) { trackProgress(input: $input) { trackRecords { id trackerId title lastChapterRead totalChapters } } }",
            "trackProgress", json!({"mangaId": manga_id}))
    }

    /// Explicitly added by a trusted native caller after user confirmation.
    /// This validates the initial index URL only; it is not an SSRF sandbox
    /// for the upstream engine or a signature/trust check for executable code.
    pub fn add_store(&self, index: &str) -> Result<Value, &'static str> {
        let index = repository_index(index)?;
        self.add_store_inner(index.as_str())
    }

    fn add_store_inner(&self, index: &str) -> Result<Value, &'static str> {
        self.client.slow().mutation(
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
        self.client.slow().mutation(
            "mutation TsugiRefreshExtensions($input: FetchExtensionsInput!) { fetchExtensions(input: $input) { __typename } }",
            "fetchExtensions",
            json!({}),
        )?;
        Ok(())
    }

    pub fn extensions(&self, offset: u32) -> Result<Value, &'static str> {
        self.search_extensions(offset, "", None)
    }

    pub fn search_extensions(&self, offset: u32, term: &str, store: Option<&str>) -> Result<Value, &'static str> {
        self.filter_extensions(offset, term, store, None, None)
    }

    pub fn filter_extensions(&self, offset: u32, term: &str, store: Option<&str>, language: Option<&str>, installed: Option<bool>) -> Result<Value, &'static str> {
        self.filter_extensions_with_updates(offset, term, store, language, installed, false)
    }

    pub fn filter_extensions_with_updates(&self, offset: u32, term: &str, store: Option<&str>, language: Option<&str>, installed: Option<bool>, updates_only: bool) -> Result<Value, &'static str> {
        self.filter_extensions_with_metadata(offset, term, store, language, installed, updates_only, false, None)
    }

    pub fn filter_extensions_with_metadata(&self, offset: u32, term: &str, store: Option<&str>, language: Option<&str>, installed: Option<bool>,
        updates_only: bool, obsolete_only: bool, content_warning: Option<ReadContentWarning>) -> Result<Value, &'static str>
    {
        let (document, variables) = extension_catalogue_request(offset, term, store, language, installed, updates_only, obsolete_only, content_warning)?;
        if let Some(index) = store {
            if index.len() > 2048 || index.chars().any(char::is_control)
                || !self.query(ReadOperation::Stores)?["nodes"].as_array().is_some_and(|nodes| nodes.iter().any(|node| node["indexUrl"] == index))
            {
                return Err("Extension repository is not registered.");
            }
        }
        let result = self.client.document(document, "extensions", variables)?;
        extension_catalogue_page(&result, offset)
    }

    fn extension_record(&self, package: &str) -> Result<Value, &'static str> {
        extension_package(package)?;
        let value = self.client.document(
            "query TsugiExtension($pkg: String!) { extension(pkgName: $pkg) { pkgName name storeIndexUrl apkName versionName versionCodeLong isInstalled hasUpdate isObsolete apkUrl jarUrl source { nodes { id } totalCount } } }",
            "extension",
            json!({"pkg": package}),
        )?;
        if value["pkgName"] != package {
            return Err("Extension identity did not match.");
        }
        Ok(value)
    }

    pub fn review_extension(&self, package: &str) -> Result<ExtensionReview, &'static str> {
        self.require_empty_download_queue()?;
        let metadata = self.extension_record(package)?;
        if metadata["isInstalled"] != false || metadata["isObsolete"] != false {
            return Err("Extension is already installed or obsolete.");
        }
        let index = metadata["storeIndexUrl"].as_str().ok_or("Extension has no registered store.")?;
        repository_index(index)?;
        let stores = self.query(ReadOperation::Stores)?;
        let store = stores["nodes"].as_array().and_then(|nodes| nodes.iter().find(|node| node["indexUrl"] == index))
            .ok_or("Extension store is not registered.")?.clone();
        let (download, suffix) = if let Some(jar) = metadata["jarUrl"].as_str() {
            (jar, ".jar")
        } else {
            (metadata["apkUrl"].as_str().ok_or("Extension has no download.")?, ".apk")
        };
        extension_download(download, suffix)?;
        let version = metadata["versionName"].as_str().filter(|v| !v.is_empty() && v.len() <= 80 && !v.chars().any(char::is_control))
            .ok_or("Invalid extension version.")?;
        let description = format!("Package: {package}\nVersion: {version}\nRepository: {index}\nDownload: {download}");
        Ok(ExtensionReview { package: package.to_owned(), metadata, store, description })
    }

    /// The native caller must obtain explicit user approval of review.description().
    /// Recheck the exact metadata and store identity before loading code.
    /// Upstream may follow download redirects and does not guarantee byte-level
    /// signature verification. Never invoke automatically or from an untrusted page.
    pub fn install_reviewed_extension(&self, review: ExtensionReview) -> Result<Value, &'static str> {
        let current = self.review_extension(&review.package)?;
        if current.metadata != review.metadata || current.store != review.store {
            return Err("Extension or repository changed. Review it again.");
        }
        let result = self.mutate_extension(&review.package, true)?;
        if result["extension"]["pkgName"] != review.package || result["extension"]["isInstalled"] != true {
            return Err("Extension installation could not be confirmed.");
        }
        Ok(result)
    }

    pub fn uninstall_extension(&self, package: &str) -> Result<Value, &'static str> {
        self.require_empty_download_queue()?;
        let current = self.extension_record(package)?;
        if current["isInstalled"] != true {
            return Err("Extension is not installed.");
        }
        self.mutate_extension(package, false)
    }

    fn mutate_extension(&self, package: &str, install: bool) -> Result<Value, &'static str> {
        extension_package(package)?;
        self.require_empty_download_queue()?;
        let patch = if install { json!({"install": true}) } else { json!({"uninstall": true}) };
        self.client.slow().mutation(
            "mutation TsugiChangeExtension($input: UpdateExtensionInput!) { updateExtension(input: $input) { extension { pkgName isInstalled versionName } } }",
            "updateExtension",
            json!({"id": package, "patch": patch}),
        )
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
        if source == "0" { self.preflight_local_import_catalogue(query)?; }
        let mut result = self.client.slow().mutation(
            "mutation TsugiCatalogue($input: FetchSourceMangaInput!) { fetchSourceManga(input: $input) { hasNextPage mangas { id sourceId url title author thumbnailUrl inLibrary } } }",
            "fetchSourceManga",
            json!({ "source": source, "page": page, "type": kind, "query": query }),
        )?;
        if source == "0" { self.complete_local_import_catalogue(&mut result, query)?; }
        // URL is used only for native local-import ownership checks. Preserve
        // the existing public catalogue shape for local and provider results.
        for row in result["mangas"].as_array_mut().ok_or("Invalid reading catalogue response.")? {
            row.as_object_mut().ok_or("Invalid reading catalogue response.")?.remove("url");
        }
        Ok(result)
    }

    pub fn manga(&self, id: i32) -> Result<Value, &'static str> {
        if id <= 0 {
            return Err("Invalid manga identifier.");
        }
        let value = self.client.slow().mutation(
            "mutation TsugiManga($input: FetchMangaAndChaptersInput!) { fetchMangaAndChapters(input: $input) { manga { id sourceId title author artist description genre thumbnailUrl inLibrary } chapters { id name mangaId chapterNumber sourceOrder scanlator pageCount isRead isBookmarked lastPageRead isDownloaded } } }",
            "fetchMangaAndChapters",
            json!({ "id": id, "fetchManga": true, "fetchChapters": true }),
        )?;
        downloads::validate_chapter_download_flags(&value["chapters"])?;
        Ok(value)
    }

    /// Read persisted metadata and chapters without contacting the extension.
    /// Essential for reading history and migration away from a dead source.
    /// Bounded page of the same library query. Stable ID order prevents
    /// missing entries merely because titles are duplicated.
    pub fn library_page(&self, offset: u32) -> Result<Value, &'static str> {
        if offset > 100_000 { return Err("Library offset exceeds the supported limit."); }
        let reply = self.client.send_document(
            "query TsugiLibraryPage($offset: Int!) { mangas(condition: { inLibrary: true }, first: 100, offset: $offset, order: [{ by: ID, byType: ASC }]) { nodes { id sourceId title author thumbnailUrl inLibrary unreadCount categories { nodes { id } } lastReadChapter { id name lastPageRead pageCount isRead lastReadAt } } totalCount } }",
            json!({"offset": offset}), Some(&self.client.authorization))?;
        decode(ReadOperation::Library, reply)
    }

    pub fn cached_manga(&self, id: i32) -> Result<Value, &'static str> {
        if id <= 0 { return Err("Invalid manga identifier."); }
        let mut manga = self.client.document(
            "query TsugiCachedManga($id: Int!) { manga(id: $id) { id sourceId title author artist description genre thumbnailUrl inLibrary categories { nodes { id } } chapters { nodes { id name mangaId chapterNumber sourceOrder scanlator pageCount isRead isBookmarked lastPageRead isDownloaded } } } }",
            "manga", json!({"id": id}))?;
        let chapters = manga.as_object_mut().and_then(|value| value.remove("chapters"))
            .and_then(|value| value.get("nodes").cloned())
            .filter(Value::is_array).ok_or("Invalid cached chapters.")?;
        downloads::validate_chapter_download_flags(&chapters)?;
        Ok(json!({"manga": manga, "chapters": chapters}))
    }

    /// Cached-only semantic backup. Hash source identities before returning
    /// any data to the WebView; do not export raw URLs or client metadata.
    pub fn backup_manga(&self, id: i32) -> Result<Value, &'static str> {
        project_manga_backup(&self.backup_manga_raw(id)?, id)
    }

    // Native import verification also needs the exact runtime page-count
    // sentinel. Keep this raw response private to the reading broker.
    fn backup_manga_raw(&self, id: i32) -> Result<Value, &'static str> {
        if id <= 0 { return Err("Invalid manga identifier."); }
        self.client.document(
            "query TsugiBackupManga($id: Int!) { manga(id: $id) { id sourceId url title inLibrary categories { nodes { id name } totalCount } chapters { nodes { id url name pageCount isRead isBookmarked lastPageRead lastReadAt } totalCount } } }",
            "manga", json!({"id": id}))
    }

    /// Recheck all reviewed identities and local state before any write.
    /// Additive changes are grouped into upstream transactions. If a later
    /// group fails, report only confirmed changes; never claim an atomic
    /// cross-group restore or erase newer data to simulate rollback.
    pub fn restore_manga_progress(&self, id: i32, identity: &str, changes: &[MangaProgressPatch]) -> Result<Value, &'static str> {
        let snapshot = self.backup_manga(id)?;
        let groups = reviewed_progress_groups(&snapshot, identity, changes)?;
        let mut confirmed = 0usize;
        for ((read, bookmark, page), ids) in groups {
            let mut patch = json!({});
            if read { patch["isRead"] = json!(true); }
            if bookmark { patch["isBookmarked"] = json!(true); }
            if let Some(page) = page { patch["lastPageRead"] = json!(page); }
            let result = self.client.mutation(
                "mutation TsugiRestoreProgress($input: UpdateChaptersInput!) { updateChapters(input: $input) { chapters { id isRead isBookmarked lastPageRead } } }",
                "updateChapters", json!({"ids": ids, "patch": patch}));
            let verified = result.ok().and_then(|value| value["chapters"].as_array().cloned())
                .is_some_and(|rows| rows.len() == ids.len() && ids.iter().all(|id| {
                    rows.iter().any(|row| row["id"].as_i64() == Some(*id as i64)
                        && (!read || row["isRead"] == true)
                        && (!bookmark || row["isBookmarked"] == true)
                        && page.is_none_or(|value| row["lastPageRead"].as_u64() == Some(value as u64)))
                }));
            if !verified {
                return Ok(json!({"confirmed": confirmed, "total": changes.len(), "complete": false}));
            }
            confirmed += ids.len();
        }
        Ok(json!({"confirmed": confirmed, "total": changes.len(), "complete": true}))
    }

    pub fn save_category(&self, id: Option<i32>, name: &str) -> Result<Value, &'static str> {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control)
            || name.eq_ignore_ascii_case("default") || id.is_some_and(|value| value <= 0) {
            return Err("Invalid category name or identifier.");
        }
        if let Some(id) = id {
            self.client.mutation(
                "mutation TsugiRenameCategory($input: UpdateCategoryInput!) { updateCategory(input: $input) { category { id name order } } }",
                "updateCategory", json!({"id": id, "patch": {"name": name}}))
        } else {
            self.client.mutation(
                "mutation TsugiCreateCategory($input: CreateCategoryInput!) { createCategory(input: $input) { category { id name order } } }",
                "createCategory", json!({"name": name}))
        }
    }

    pub fn delete_category(&self, id: i32) -> Result<Value, &'static str> {
        if id <= 0 { return Err("The default category cannot be removed."); }
        self.client.mutation(
            "mutation TsugiDeleteCategory($input: DeleteCategoryInput!) { deleteCategory(input: $input) { category { id } } }",
            "deleteCategory", json!({"categoryId": id}))
    }

    pub fn assign_category(&self, manga_id: i32, category_id: i32, assigned: bool) -> Result<Value, &'static str> {
        if manga_id <= 0 || category_id <= 0 { return Err("Invalid category assignment."); }
        let patch = if assigned { json!({"addToCategories": [category_id]}) }
            else { json!({"removeFromCategories": [category_id]}) };
        self.client.mutation(
            "mutation TsugiAssignCategory($input: UpdateMangaCategoriesInput!) { updateMangaCategories(input: $input) { manga { id categories { nodes { id } } } } }",
            "updateMangaCategories", json!({"id": manga_id, "patch": patch}))
    }

    pub fn library_update_status(&self) -> Result<Value, &'static str> {
        self.client.document(
            "query TsugiLibraryUpdateStatus { libraryUpdateStatus { jobsInfo { isRunning totalJobs finishedJobs skippedCategoriesCount skippedMangasCount } } }",
            "libraryUpdateStatus", json!({}))
    }

    pub fn start_library_update(&self) -> Result<Value, &'static str> {
        // Do not clear an existing update queue or start two jobs.
        let status = self.library_update_status()?;
        if status["jobsInfo"]["isRunning"] == true { return Ok(status); }
        let result = self.client.slow().mutation(
            "mutation TsugiStartLibraryUpdate($input: UpdateLibraryInput!) { updateLibrary(input: $input) { updateStatus { jobsInfo { isRunning totalJobs finishedJobs skippedCategoriesCount skippedMangasCount } } } }",
            "updateLibrary", json!({"categories": null}))?;
        result.get("updateStatus").cloned().filter(Value::is_object)
            .ok_or("Invalid library update status.")
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
        let value = self.client.slow().mutation(
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

    /// Fetch only the fixed, authenticated upstream manga-thumbnail endpoint.
    /// No source-controlled image URL or arbitrary path enters the broker.
    pub fn thumbnail(&self, id: i32) -> Result<PageImage, &'static str> {
        if id <= 0 {
            return Err("Invalid manga identifier.");
        }
        let image = self.client.page(&PagePath(format!("/api/v1/manga/{id}/thumbnail")))?;
        if image.bytes.len() > 4 * 1024 * 1024 {
            return Err("Reading cover exceeded its size limit.");
        }
        Ok(image)
    }

    pub fn page(&self, chapter: &ChapterPages, index: usize) -> Result<PageImage, &'static str> {
        self.client.page(chapter.paths.get(index).ok_or("Reading page is out of range.")?)
    }

    /// Explicit local chapter-management actions; never fetch remote images
    /// merely to mark a chapter or set its bookmark.
    pub fn update_chapter_flags(&self, ids: &[i32], read: Option<bool>, bookmarked: Option<bool>) -> Result<Value, &'static str> {
        if ids.is_empty() || ids.len() > 2000 || ids.iter().any(|id| *id <= 0)
            || (read.is_none() && bookmarked.is_none()) {
            return Err("Invalid chapter selection.");
        }
        let mut ids = ids.to_vec();
        ids.sort_unstable();
        ids.dedup();
        let mut patch = json!({});
        if let Some(read) = read {
            patch["isRead"] = json!(read);
            if !read { patch["lastPageRead"] = json!(0); }
        }
        if let Some(bookmarked) = bookmarked { patch["isBookmarked"] = json!(bookmarked); }
        self.client.mutation(
            "mutation TsugiChapterFlags($input: UpdateChaptersInput!) { updateChapters(input: $input) { chapters { id isRead isBookmarked lastPageRead } } }",
            "updateChapters",
            json!({"ids": ids, "patch": patch}),
        )
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


fn backup_text(value: &Value, max: usize) -> Result<&str, &'static str> {
    value.as_str().filter(|v| !v.trim().is_empty() && v.chars().count() <= max &&
        !v.chars().any(char::is_control) && !v.contains("://"))
        .ok_or("Invalid manga backup metadata.")
}

fn backup_url(value: &Value) -> Result<&str, &'static str> {
    // The raw identity never crosses the native bridge or enters a backup.
    value.as_str().filter(|v| !v.is_empty() && v.len() <= 16_384)
        .ok_or("Invalid manga backup identity.")
}

fn backup_long(value: &Value) -> Result<i64, &'static str> {
    value.as_i64().or_else(|| value.as_str().and_then(|v| v.parse::<i64>().ok()))
        .ok_or("Invalid manga backup numeric identity.")
}

fn backup_nodes(value: &Value, max: usize) -> Result<&Vec<Value>, &'static str> {
    let nodes = value["nodes"].as_array().ok_or("Invalid manga backup response.")?;
    if nodes.len() > max || value["totalCount"].as_u64() != Some(nodes.len() as u64) {
        return Err("Manga backup response was incomplete or exceeded its limit.");
    }
    Ok(nodes)
}

fn backup_identity(domain: &str, first: &str, second: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hash = Sha256::new();
    for part in [domain, first, second] {
        hash.update((part.len() as u64).to_be_bytes());
        hash.update(part.as_bytes());
    }
    hash.finalize().iter().map(|byte| format!("{byte:02x}")).collect()
}

fn backup_page_count(value: &Value) -> Result<i32, &'static str> {
    // Pinned Suwayomi uses -1 until chapter pages have been fetched. No other
    // negative value, fraction, string or out-of-range count is valid.
    value.as_i64().and_then(|count| i32::try_from(count).ok()).filter(|count| *count >= -1)
        .ok_or("Invalid chapter page count.")
}

fn project_manga_backup(raw: &Value, id: i32) -> Result<Value, &'static str> {
    if id <= 0 || raw["id"].as_i64() != Some(id as i64) || raw["inLibrary"] != true {
        return Err("Manga is not in the local library.");
    }
    let source = backup_long(&raw["sourceId"])?.to_string();
    let identity = backup_identity("tsugi-manga-v1", &source, backup_url(&raw["url"])?);
    let title = backup_text(&raw["title"], 500)?;
    let mut categories = Vec::new();
    for category in backup_nodes(&raw["categories"], 100)? {
        let category_id = category["id"].as_i64().ok_or("Invalid manga category.")?;
        if category_id < 0 { return Err("Invalid manga category."); }
        if category_id > 0 { categories.push(backup_text(&category["name"], 80)?); }
    }
    categories.sort_unstable();
    categories.dedup();

    let mut chapters = Vec::new();
    let mut ids = std::collections::HashSet::new();
    let mut identities = std::collections::HashSet::new();
    for chapter in backup_nodes(&raw["chapters"], 10_000)? {
        let chapter_id = chapter["id"].as_i64().filter(|v| *v > 0 && *v <= i32::MAX as i64)
            .ok_or("Invalid backup chapter identifier.")?;
        let chapter_identity = backup_identity("tsugi-chapter-v1", &identity, backup_url(&chapter["url"])?);
        if !ids.insert(chapter_id) || !identities.insert(chapter_identity.clone()) {
            return Err("Duplicate chapter identity prevents a safe backup.");
        }
        let read = chapter["isRead"].as_bool().ok_or("Invalid chapter read state.")?;
        let bookmarked = chapter["isBookmarked"].as_bool().ok_or("Invalid chapter bookmark.")?;
        let page = chapter["lastPageRead"].as_u64().filter(|v| *v <= i32::MAX as u64)
            .ok_or("Invalid chapter progress.")?;
        // Portable backups represent an unknown count as zero. This cannot
        // authorize any partial-page restore; the reviewed bound must be > 0.
        let count = backup_page_count(&chapter["pageCount"])?.max(0);
        let last_read = backup_long(&chapter["lastReadAt"])?;
        if last_read < 0 { return Err("Invalid chapter history."); }
        chapters.push(json!({
            "id": chapter_id, "identity": chapter_identity,
            "name": backup_text(&chapter["name"], 500)?,
            "isRead": read, "isBookmarked": bookmarked,
            "lastPageRead": page, "pageCount": count, "lastReadAt": last_read.to_string()
        }));
    }
    Ok(json!({"id": id, "identity": identity, "sourceId": source, "title": title,
        "categories": categories, "chapters": chapters}))
}

type MangaPatchGroups = std::collections::BTreeMap<(bool, bool, Option<u32>), Vec<i32>>;

fn reviewed_progress_groups(snapshot: &Value, identity: &str, changes: &[MangaProgressPatch]) -> Result<MangaPatchGroups, &'static str> {
    if snapshot["identity"].as_str() != Some(identity) || changes.is_empty() || changes.len() > 2000 {
        return Err("Invalid or changed manga restore preview.");
    }
    let chapters = snapshot["chapters"].as_array().ok_or("Invalid manga snapshot.")?;
    let by_identity: std::collections::HashMap<_, _> = chapters.iter()
        .filter_map(|chapter| chapter["identity"].as_str().map(|key| (key, chapter))).collect();
    let mut used = std::collections::HashSet::new();
    let mut groups = MangaPatchGroups::new();
    for change in changes {
        if !used.insert(change.identity.as_str()) { return Err("Duplicate restore chapter."); }
        let chapter = by_identity.get(change.identity.as_str()).ok_or("Restore chapter no longer matches.")?;
        if chapter["isRead"].as_bool() != Some(change.expected_read)
            || chapter["isBookmarked"].as_bool() != Some(change.expected_bookmarked)
            || chapter["lastPageRead"].as_u64() != Some(change.expected_last_page as u64)
            || chapter["pageCount"].as_u64() != Some(change.expected_page_count as u64)
            || chapter["lastReadAt"].as_str() != Some(change.expected_last_read_at.as_str()) {
            return Err("Reading progress changed since the preview.");
        }
        if (!change.mark_read && !change.bookmark && change.page.is_none())
            || (change.mark_read && change.expected_read)
            || (change.bookmark && change.expected_bookmarked)
            || change.page.is_some_and(|page| change.expected_read || change.mark_read
                || page <= change.expected_last_page || page >= change.expected_page_count) {
            return Err("Restore would overwrite or exceed existing progress.");
        }
        let id = chapter["id"].as_i64().and_then(|v| i32::try_from(v).ok())
            .filter(|v| *v > 0).ok_or("Invalid restore chapter.")?;
        groups.entry((change.mark_read, change.bookmark, change.page)).or_default().push(id);
    }
    Ok(groups)
}

impl ReadRuntime {
    /// Closing the private stdin pipe requests normal JVM shutdown. Suwayomi
    /// registers a hook that closes HikariCP. A timeout is a failure, even if
    /// the fallback successfully terminates the child.
    pub fn shutdown(&mut self) -> Result<(), &'static str> {
        drop(self.child.stdin.take());
        let deadline = Instant::now() + SHUTDOWN_TIMEOUT;
        loop {
            match self.child.try_wait() {
                Ok(Some(status)) if status.success() => {
                    drop(self.job.take());
                    return Ok(());
                }
                Ok(Some(_)) => {
                    drop(self.job.take());
                    return Err("Reading runtime exited unsuccessfully.");
                }
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(100));
                }
                _ => {
                    drop(self.job.take());
                    let _ = self.child.kill();
                    let _ = self.child.wait();
                    return Err("Reading runtime did not shut down cleanly.");
                }
            }
        }
    }
}

impl Drop for ReadRuntime {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpStream;
    use std::path::PathBuf;
    use std::sync::{Arc, atomic::{AtomicBool, AtomicUsize, Ordering}};
    use std::thread::JoinHandle;


    fn backup_fixture() -> Value {
        json!({"id": 7, "sourceId": "-9223372036854775808", "url": "https://private.example/secret",
            "title": "Original fixture", "inLibrary": true, "thumbnailUrl": "https://private.example/art",
            "categories": {"nodes": [{"id": 1, "name": "Reading"}], "totalCount": 1},
            "chapters": {"nodes": [{"id": 9, "url": "https://private.example/chapter-token", "name": "Chapter 1",
                "pageCount": 20, "lastPageRead": 2, "isRead": false, "isBookmarked": false, "lastReadAt": "12"}], "totalCount": 1}})
    }

    #[test]
    fn backup_projection_hides_raw_urls_and_preserves_long_source_identity() {
        let raw = backup_fixture();
        let snapshot = project_manga_backup(&raw, 7).unwrap();
        assert_eq!(snapshot["sourceId"], "-9223372036854775808");
        assert_eq!(snapshot["chapters"][0]["lastReadAt"], "12");
        assert_eq!(snapshot["identity"].as_str().unwrap().len(), 64);
        assert!(!snapshot.to_string().contains("private.example"));
        let mut incomplete = raw.clone();
        incomplete["chapters"]["totalCount"] = json!(2);
        assert!(project_manga_backup(&incomplete, 7).is_err());
    }

    #[test]
    fn backup_projection_normalizes_only_the_unknown_page_count_sentinel() {
        let mut raw = backup_fixture();
        for count in [-1, 0, 20, i32::MAX] {
            raw["chapters"]["nodes"][0]["pageCount"] = json!(count);
            let snapshot = project_manga_backup(&raw, 7).unwrap();
            assert_eq!(snapshot["chapters"][0]["pageCount"], count.max(0));
            assert_eq!(snapshot["chapters"][0]["lastPageRead"], 2);
            assert_eq!(backup_page_count(&json!(count)).unwrap(), count);
        }
        for invalid in [json!(-2), json!(i32::MIN), json!(i64::from(i32::MAX) + 1), json!(1.5), json!("20"), Value::Null] {
            raw["chapters"]["nodes"][0]["pageCount"] = invalid;
            assert!(project_manga_backup(&raw, 7).is_err());
        }
    }

    #[test]
    fn restore_groups_never_apply_partial_progress_with_unknown_page_count() {
        let mut raw = backup_fixture();
        raw["chapters"]["nodes"][0]["pageCount"] = json!(-1);
        raw["chapters"]["nodes"][0]["lastPageRead"] = json!(0);
        let snapshot = project_manga_backup(&raw, 7).unwrap();
        let identity = snapshot["identity"].as_str().unwrap();
        let mut patch: MangaProgressPatch = serde_json::from_value(json!({
            "identity": snapshot["chapters"][0]["identity"], "expectedRead": false, "expectedBookmarked": false,
            "expectedLastPage": 0, "expectedPageCount": 0, "expectedLastReadAt": "12",
            "markRead": false, "bookmark": true, "page": 1
        })).unwrap();
        assert!(reviewed_progress_groups(&snapshot, identity, std::slice::from_ref(&patch)).is_err());
        patch.page = None;
        assert_eq!(reviewed_progress_groups(&snapshot, identity, std::slice::from_ref(&patch)).unwrap()
            .get(&(false, true, None)).unwrap(), &vec![9]);
    }

    #[test]
    fn restore_groups_require_exact_identity_and_non_destructive_progress() {
        let snapshot = project_manga_backup(&backup_fixture(), 7).unwrap();
        let identity = snapshot["identity"].as_str().unwrap();
        let mut patch: MangaProgressPatch = serde_json::from_value(json!({
            "identity": snapshot["chapters"][0]["identity"], "expectedRead": false, "expectedBookmarked": false,
            "expectedLastPage": 2, "expectedPageCount": 20, "expectedLastReadAt": "12",
            "markRead": false, "bookmark": true, "page": 5
        })).unwrap();
        assert_eq!(reviewed_progress_groups(&snapshot, identity, std::slice::from_ref(&patch)).unwrap()
            .get(&(false, true, Some(5))).unwrap(), &vec![9]);
        patch.page = Some(2);
        assert!(reviewed_progress_groups(&snapshot, identity, std::slice::from_ref(&patch)).is_err());
        patch.page = Some(5);
        patch.expected_last_read_at = "13".to_owned();
        assert!(reviewed_progress_groups(&snapshot, identity, std::slice::from_ref(&patch)).is_err());
    }

    // Exercise the real kernel job without third-party executables or network.
    // The test subprocess waits for the same byte as the JVM launcher.
    #[test]
    #[ignore = "subprocess fixture only"]
    fn job_fixture_process() {
        let Ok(role) = std::env::var("TSUGI_READ_JOB_FIXTURE_ROLE") else { return };
        if role == "parent" {
            let mut gate = [0];
            std::io::stdin().read_exact(&mut gate).unwrap();
            assert_eq!(gate, [1]);
            let mut leaf = Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "read_runtime::tests::job_fixture_process", "--ignored"])
                .env("TSUGI_READ_JOB_FIXTURE_ROLE", "leaf")
                .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
                .creation_flags(NO_WINDOW)
                .spawn().unwrap();
            fs::write(std::env::var_os("TSUGI_READ_JOB_FIXTURE_READY").unwrap(), leaf.id().to_string()).unwrap();
            let _ = leaf.wait();
        } else if role == "leaf" {
            std::thread::sleep(Duration::from_secs(60));
        } else {
            panic!("unknown job fixture role");
        }
    }

    #[test]
    fn closing_read_job_terminates_parent_and_descendant() {
        use std::ffi::c_void;
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut c_void;
            fn WaitForSingleObject(handle: *mut c_void, milliseconds: u32) -> u32;
        }
        const SYNCHRONIZE: u32 = 0x00100000;
        const WAIT_OBJECT_0: u32 = 0;
        const WAIT_TIMEOUT: u32 = 258;
        let mut entropy = [0u8; 16];
        getrandom::fill(&mut entropy).unwrap();
        let unique = entropy.iter().map(|b| format!("{b:02x}")).collect::<String>();
        let dir = std::env::temp_dir().join(format!("tsugi-read-job-{unique}"));
        fs::create_dir(&dir).unwrap();
        let ready = dir.join("descendant.pid");
        let job = ReadJob::new().unwrap();
        let mut parent = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "read_runtime::tests::job_fixture_process", "--ignored"])
            .env("TSUGI_READ_JOB_FIXTURE_ROLE", "parent")
            .env("TSUGI_READ_JOB_FIXTURE_READY", &ready)
            .stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null())
            .creation_flags(NO_WINDOW)
            .spawn().unwrap();
        if let Err(error) = job.attach_and_release(&mut parent) {
            drop(parent.stdin.take());
            let _ = parent.kill();
            let _ = parent.wait();
            panic!("{error}");
        }
        let deadline = Instant::now() + Duration::from_secs(10);
        let pid = loop {
            if let Some(pid) = fs::read_to_string(&ready).ok().and_then(|s| s.parse::<u32>().ok()) {
                break pid;
            }
            assert!(Instant::now() < deadline, "job descendant did not start");
            std::thread::sleep(Duration::from_millis(20));
        };
        // SAFETY: OpenProcess returns a new handle for the reported live descendant.
        let raw = unsafe { OpenProcess(SYNCHRONIZE, 0, pid) };
        assert!(!raw.is_null(), "could not open job descendant");
        let leaf = unsafe { OwnedHandle::from_raw_handle(raw) };
        // SAFETY: the owned process handles remain live during each wait.
        assert_eq!(unsafe { WaitForSingleObject(leaf.as_raw_handle(), 0) }, WAIT_TIMEOUT);
        assert!(parent.try_wait().unwrap().is_none());
        drop(job);
        assert_eq!(unsafe { WaitForSingleObject(parent.as_raw_handle(), 10_000) }, WAIT_OBJECT_0);
        assert_eq!(unsafe { WaitForSingleObject(leaf.as_raw_handle(), 10_000) }, WAIT_OBJECT_0);
        parent.wait().unwrap();
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn reading_storage_requires_private_acl_and_preserves_existing_data() {
        let mut entropy = [0u8; 16];
        getrandom::fill(&mut entropy).unwrap();
        let unique = entropy.iter().map(|b| format!("{b:02x}")).collect::<String>();
        let parent = std::env::temp_dir().join(format!("tsugi-read-acl-{unique}"));
        fs::create_dir(&parent).unwrap();
        let data = parent.join("private");
        let user = private_storage::CurrentUser::get().unwrap();
        // Isolate root creation/verification from inherited file checks.
        // No real credentials or raw ACL/SID values are printed.
        let probe = parent.join("probe");
        assert!(user.create_root(&probe).expect("create private root"));
        user.verify(&probe, true).expect("verify private root");
        let probe_file = probe.join("probe.txt");
        fs::write(&probe_file, b"fixture").unwrap();
        user.verify(&probe_file, false).expect("verify inherited file permissions");
        let descendant = probe.join("inherited");
        fs::create_dir(&descendant).unwrap();
        assert!(user.verify(&descendant, true).is_err(), "inherited directory cannot replace the protected root policy");
        user.verify_descendant(&descendant, true).expect("private inherited child directory is supported");
        fs::write(descendant.join("fixture"), b"private").unwrap();
        user.verify_descendant(&descendant.join("fixture"), false).unwrap();
        let weakened = probe.join("public-child");
        private_storage::create_public_fixture(&weakened, &user);
        assert!(user.verify_descendant(&weakened, true).is_err(), "public child ACL must be rejected");
        fs::remove_dir_all(&probe).unwrap();
        let first = ReadStorage::open(&data, 12345).expect("initialize private reading storage");
        user.verify(&data, true).unwrap();
        for name in [".tsugi-read.lock", ".tsugi-read.key", "server.conf"] {
            user.verify(&data.join(name), false).unwrap();
        }
        assert!(ReadStorage::open(&data, 12346).is_err());
        user.verify(&first.temp_dir, true).unwrap();
        fs::write(first.temp_dir.join("fixture"), b"one").unwrap();
        let other = ReadStorage::open(&parent.join("second"), 12347).unwrap();
        assert!(!other.temp_dir.join("fixture").exists());
        drop(other);
        let password = first.password.clone();
        drop(first);
        let reopened = ReadStorage::open(&data, 12346).unwrap();
        assert!(reopened.password == password);
        assert_eq!(fs::read(reopened.temp_dir.join("fixture")).unwrap(), b"one");
        drop(reopened);
        let public = parent.join("public");
        private_storage::create_public_fixture(&public, &user);
        assert!(ReadStorage::open(&public, 12345).is_err());
        assert!(!public.join(".tsugi-read.key").exists());
        fs::remove_dir_all(parent).unwrap();
    }

    #[test]
    fn reading_storage_recovers_displaced_config_before_validation() {
        let mut entropy = [0u8; 16];
        getrandom::fill(&mut entropy).unwrap();
        let unique: String = entropy.iter().map(|b| format!("{b:02x}")).collect();
        let parent = std::env::temp_dir().join(format!("tsugi-read-config-recovery-{unique}"));
        fs::create_dir(&parent).unwrap();
        let data = parent.join("private");
        let storage = ReadStorage::open(&data, 12345).unwrap();
        let original = fs::read(data.join("server.conf")).unwrap();
        let password = storage.password.clone();
        let checkpoint = crate::read_checkpoint::create(&data).unwrap();
        let displaced = data.join("extension-recovery/pending/displaced");
        fs::create_dir(&displaced).unwrap();
        fs::rename(data.join("server.conf"), displaced.join("server.conf")).unwrap();
        drop(checkpoint);
        drop(storage);
        let restored = ReadStorage::open(&data, 12346).expect("restore config under lock before verifying it");
        assert!(restored.password == password);
        assert!(fs::read(data.join("server.conf")).unwrap() == original);
        private_storage::CurrentUser::get().unwrap().verify(&data.join("server.conf"), false).unwrap();
        assert!(ReadStorage::open(&data, 12347).is_err(), "exclusive lock remains held after recovery");
        drop(restored);
        fs::remove_dir_all(parent).unwrap();
    }

    #[test]
    fn listener_rows_require_unique_owned_loopback() {
        let port = 12345u16;
        let pid = 123u32;
        let row = [2, u32::from_ne_bytes([127, 0, 0, 1]), u32::from(port.to_be()), 0, 0, pid];
        let mut table = vec![1];
        table.extend(row);
        assert!(verify_listener_rows(&table, port, pid).is_ok());
        assert!(verify_listener_rows(&table, port, pid + 1).is_err());
        assert!(verify_listener_rows(&table, port + 1, pid).is_err());
        assert!(verify_listener_rows(&table[..6], port, pid).is_err());
        table[2] = 0;
        assert!(verify_listener_rows(&table, port, pid).is_err());
        table[2] = row[1];
        table[0] = 2;
        table.extend(row);
        assert!(verify_listener_rows(&table, port, pid).is_err());
    }

    #[test]
    fn listener_check_rejects_wrong_owner_before_http() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(verify_listener(port, std::process::id()).is_ok());
        let client = ReadClient::new(port, 0, "fixture-not-a-real-credential");
        assert!(client.query(ReadOperation::Status).is_err());
        listener.set_nonblocking(true).unwrap();
        assert_eq!(listener.accept().unwrap_err().kind(), std::io::ErrorKind::WouldBlock);
    }

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
    fn extension_review_requires_safe_package_and_https_artifact() {
        assert!(extension_package("eu.kanade.tachiyomi.extension.en.example").is_ok());
        for value in ["", "a..b", "../example", "a b.c", "1a.b", "a/b.c"] {
            assert!(extension_package(value).is_err());
        }
        assert!(extension_download("https://example.test/extension-v1.6.1.jar", ".jar").is_ok());
        assert!(extension_download("https://example.test/extension.apk", ".apk").is_ok());
        for value in [
            "http://example.test/a.jar", "https://127.0.0.1/a.jar",
            "https://a.local/a.jar", "https://user@example.test/a.jar",
            "https://example.test/a.jar?token=x", "https://example.test/a%2Fb.jar",
            "https://example.test/a.apk", "https://example.test/a.jar#x",
        ] {
            assert!(extension_download(value, ".jar").is_err());
        }
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
        fixture_index_with_jar(None)
    }

    fn fixture_index_with_jar(jar_url: Option<&str>) -> Vec<u8> {
        fixture_index_version(jar_url, 1)
    }

    fn fixture_index_version(jar_url: Option<&str>, version: u64) -> Vec<u8> {
        let mut resources = Vec::new();
        field(&mut resources, 1, b"https://example.invalid/fixture.apk");
        field(&mut resources, 2, b"https://example.invalid/fixture.png");
        if let Some(url) = jar_url {
            field(&mut resources, 501, url.as_bytes());
        }
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
        varint(version, &mut extension);
        field(&mut extension, 6, format!("1.6.{version}").as_bytes());
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

    pub(super) struct FixtureStore {
        pub(super) url: String,
        stop: Arc<AtomicBool>,
        requests: Arc<AtomicUsize>,
        worker: Option<JoinHandle<()>>,
        release: Arc<std::sync::Mutex<(Vec<u8>, Option<Vec<u8>>)>>,
    }

    impl FixtureStore {
        fn start() -> Self {
            Self::with_jar(None)
        }

        pub(super) fn with_jar(jar: Option<Vec<u8>>) -> Self {
            let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
            let port = listener.local_addr().unwrap().port();
            listener.set_nonblocking(true).unwrap();
            let stop = Arc::new(AtomicBool::new(false));
            let stopped = Arc::clone(&stop);
            let requests = Arc::new(AtomicUsize::new(0));
            let served = Arc::clone(&requests);
            let jar_url = format!("http://127.0.0.1:{port}/tsugi-fixture-v1.6.1.jar");
            let body = fixture_index_with_jar(jar.as_ref().map(|_| jar_url.as_str()));
            let release = Arc::new(std::sync::Mutex::new((body, jar)));
            let published = Arc::clone(&release);
            let worker = std::thread::spawn(move || {
                while !stopped.load(Ordering::Acquire) {
                    let Ok((mut stream, _)) = listener.accept() else {
                        std::thread::sleep(Duration::from_millis(20));
                        continue;
                    };
                    // Accepted Winsock sockets can inherit the listener's nonblocking mode.
                    stream.set_nonblocking(false).expect("blocking fixture connection");
                    stream.set_read_timeout(Some(Duration::from_secs(2))).expect("fixture read timeout");
                    stream.set_write_timeout(Some(Duration::from_secs(2))).expect("fixture write timeout");
                    let mut request = Vec::new();
                    for byte in (&mut stream).bytes().take(8192) {
                        let Ok(byte) = byte else { break };
                        request.push(byte);
                        if request.ends_with(b"\r\n\r\n") { break; }
                    }
                    let (body, jar) = &*published.lock().unwrap();
                    if request.starts_with(b"GET /tsugi-fixture-v1.6.1.jar HTTP/1.") && jar.is_some() {
                        let jar = jar.as_ref().unwrap();
                        let header = format!("HTTP/1.1 200 OK\r\nContent-Type: application/java-archive\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", jar.len());
                        let _ = stream.write_all(header.as_bytes());
                        let _ = stream.write_all(jar);
                    } else if request.starts_with(b"GET /index.pb HTTP/1.") {
                        served.fetch_add(1, Ordering::Relaxed);
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
                requests,
                worker: Some(worker),
                release,
            }
        }

        pub(super) fn replace_jar(&self, version: u64, jar: Vec<u8>) {
            let url = self.url.replace("/index.pb", "/tsugi-fixture-v1.6.1.jar");
            *self.release.lock().unwrap() = (fixture_index_version(Some(&url), version), Some(jar));
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
    fn fixture_store_serves_complete_index() {
        let store = FixtureStore::start();
        let probe: ureq::Agent = ureq::Agent::config_builder()
            .proxy(None)
            .timeout_global(Some(Duration::from_secs(3)))
            .build().into();
        let mut response = probe.get(&store.url).call().expect("fixture HTTP readiness");
        assert_eq!(response.status().as_u16(), 200);
        let mut body = Vec::new();
        response.body_mut().as_reader().read_to_end(&mut body).unwrap();
        assert_eq!(body, fixture_index());
        assert_eq!(store.requests.load(Ordering::Relaxed), 1);
    }

    #[test]
    #[ignore = "requires the pinned Windows reading runtime"]
    fn packaged_runtime() {
        let runtime = PathBuf::from(std::env::var_os("TSUGI_READ_RUNTIME").unwrap());
        let data = PathBuf::from(std::env::var_os("TSUGI_READ_FIXTURE").unwrap()).join("library");
        let mut managed = ReadRuntime::start(&runtime, &data).expect("native runtime startup");
        assert_eq!(
            managed.query(ReadOperation::Status).unwrap()["version"],
            VERSION
        );
        for operation in [
            ReadOperation::Sources,
            ReadOperation::Stores,
            ReadOperation::Library,
            ReadOperation::Trackers,
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
        fs::write(fixture.parent().unwrap().join("cover.png"), &png).expect("fixture cover");
        let catalog = managed.catalogue("0", 1, CatalogueMode::Search("Tsugi Fixture")).expect("local catalogue search");
        let manga = catalog["mangas"].as_array().unwrap().iter().find(|item| item["title"] == "Tsugi Fixture").expect("fixture manga");
        let manga_id = manga["id"].as_i64().unwrap() as i32;
        let details = managed.manga(manga_id).expect("fixture chapters");
        assert!(details["chapters"][0].get("scanlator").is_some());
        assert!(managed.thumbnail(0).is_err());
        let cover = managed.thumbnail(manga_id).expect("authenticated local manga thumbnail");
        assert!(matches!(cover.mime, "image/png" | "image/jpeg" | "image/webp" | "image/gif"));
        assert!(!cover.bytes.is_empty());
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
        assert!(managed.update_chapter_flags(&[], Some(true), None).is_err());
        assert!(managed.update_chapter_flags(&[id], None, None).is_err());
        let flags = managed.update_chapter_flags(&[id], Some(false), Some(true)).expect("mark unread and bookmark");
        assert_eq!(flags["chapters"][0]["isRead"], false);
        assert_eq!(flags["chapters"][0]["isBookmarked"], true);
        assert_eq!(flags["chapters"][0]["lastPageRead"], 0);
        managed.save_progress(&pages, 1, true).expect("restore completed progress");
        let trackers = managed.query(ReadOperation::Trackers).expect("available native trackers");
        assert!(trackers["nodes"].as_array().unwrap().iter().any(|tracker| tracker["id"] == 1 && tracker["isLoggedIn"] == false));
        // Validate the actual generated GraphQL schema without contacting a
        // provider or mutating account data. Skip directives prevent execution
        // but the engine still validates field, argument and input types.
        for (document, variables) in [
            ("query TsugiTrackerSearchContract($input: SearchTrackerInput!) { searchTracker(input: $input) @skip(if: true) { trackSearches { remoteId title totalChapters publishingType publishingStatus startDate } } }", json!({"input": {"trackerId": 1, "query": "original fixture"}})),
            ("mutation TsugiTrackerLoginContract($input: LoginTrackerOAuthInput!) { loginTrackerOAuth(input: $input) @skip(if: true) { isLoggedIn } }", json!({"input": {"trackerId": 1, "callbackUrl": "http://127.0.0.1/fixture"}})),
            ("mutation TsugiTrackerLogoutContract($input: LogoutTrackerInput!) { logoutTracker(input: $input) @skip(if: true) { isLoggedIn } }", json!({"input": {"trackerId": 1}})),
            ("mutation TsugiTrackerBindContract($input: BindTrackInput!) { bindTrack(input: $input) @skip(if: true) { trackRecord { id trackerId title lastChapterRead totalChapters } } }", json!({"input": {"mangaId": manga_id, "trackerId": 1, "remoteId": "44"}})),
            ("mutation TsugiTrackerUnbindContract($input: UnbindTrackInput!) { unbindTrack(input: $input) @skip(if: true) { clientMutationId } }", json!({"input": {"recordId": 1, "deleteRemoteTrack": false}})),
            ("mutation TsugiTrackerSyncContract($input: TrackProgressInput!) { trackProgress(input: $input) @skip(if: true) { trackRecords { id trackerId title lastChapterRead totalChapters } } }", json!({"input": {"mangaId": manga_id}})),
        ] {
            let response = managed.client.send_document(document, variables, Some(&managed.client.authorization)).expect("tracker GraphQL contract response");
            assert_eq!(response.status, 200);
            assert!(response.body.get("errors").is_none_or(Value::is_null), "tracker GraphQL schema contract: {}", document);
        }
        let records = managed.track_records(manga_id).expect("real tracker records query");
        assert_eq!(records["totalCount"], 0);
        assert!(managed.sync_tracker_progress(manga_id).is_err());
        assert!(managed.search_tracker(1, "").is_err());
        assert!(managed.bind_tracker(manga_id, 0, 1).is_err());
        assert!(managed.unbind_tracker(manga_id, 123).is_err());
        let library = managed.set_library(manga_id, true).expect("add fixture to library");
        assert_eq!(library["manga"]["inLibrary"], true);
        let list = managed.query(ReadOperation::Library).expect("library query");
        assert!(list["nodes"].as_array().unwrap().iter().any(|item| item["id"] == manga_id.to_string()));
        let paged = managed.library_page(0).expect("native library page");
        assert_eq!(paged["nodes"], list["nodes"]);
        assert!(managed.library_page(100_001).is_err());
        let history = managed.query(ReadOperation::History).expect("native reading history");
        assert!(history["nodes"].as_array().unwrap().iter().any(|item| item["id"] == id && item["manga"]["id"] == manga_id));
        let updates = managed.query(ReadOperation::Updates).expect("native unread chapter feed");
        assert!(updates["nodes"].as_array().unwrap().iter().all(|item| item["isRead"] == false));
        let status = managed.library_update_status().expect("native update queue status");
        assert!(status["jobsInfo"]["isRunning"].is_boolean());
        // Validate the generated input without starting remote work.
        let response = managed.client.send_document(
            "mutation TsugiUpdateContract($input: UpdateLibraryInput!) { updateLibrary(input: $input) @skip(if: true) { updateStatus { jobsInfo { isRunning totalJobs finishedJobs skippedCategoriesCount skippedMangasCount } } } }",
            json!({"input": {"categories": null}}), Some(&managed.client.authorization),
        ).expect("update queue GraphQL contract");
        assert_eq!(response.status, 200);
        assert!(response.body.get("errors").is_none_or(Value::is_null));
        let cached = managed.cached_manga(manga_id).expect("cached manga without source refresh");
        assert_eq!(cached["chapters"][0]["lastPageRead"], 1);
        assert!(managed.save_category(None, "default").is_err());
        let category = managed.save_category(None, "Fixture shelf").expect("create native category");
        let category_id = category["category"]["id"].as_i64().unwrap() as i32;
        managed.assign_category(manga_id, category_id, true).expect("assign native shelf");
        let category = managed.save_category(Some(category_id), "Renamed fixture shelf").expect("rename native shelf");
        assert_eq!(category["category"]["name"], "Renamed fixture shelf");
        let categories = managed.query(ReadOperation::Categories).expect("native category list");
        assert!(categories["nodes"].as_array().unwrap().iter().any(|item| item["id"] == category_id && item["name"] == "Renamed fixture shelf"));
        let assigned = managed.query(ReadOperation::Library).expect("native category membership");
        assert!(assigned["nodes"].as_array().unwrap().iter().any(|item| item["id"] == manga_id.to_string() && item["categories"]["nodes"].as_array().unwrap().iter().any(|category| category["id"] == category_id)));
        let details = managed.manga(manga_id).expect("retrieve saved progress");
        assert_eq!(details["chapters"][0]["isRead"], true);
        assert_eq!(details["chapters"][0]["lastPageRead"], 1);
        // A second broker cannot start on the same live data directory.
        assert!(ReadRuntime::start(&runtime, &data).is_err());
        let first_port = managed.client.port;
        managed.shutdown().expect("normal JVM shutdown before reopen");
        eprintln!("PASS: normal JVM shutdown before reopening library.");
        drop(managed);
        assert!(TcpStream::connect_timeout(
            &std::net::SocketAddr::from((Ipv4Addr::LOCALHOST, first_port)),
            Duration::from_secs(2)
        ).is_err());
        // Reopen using the durable native credential and existing config/DB,
        // not an in-memory copy of the previous broker's state.
        let mut managed = ReadRuntime::start(&runtime, &data).expect("reopen reading library");
        let list = managed.query(ReadOperation::Library).expect("persisted library");
        assert!(list["nodes"].as_array().unwrap().iter().any(|item| item["id"] == manga_id.to_string()));
        let categories = managed.query(ReadOperation::Categories).expect("persisted categories");
        assert!(categories["nodes"].as_array().unwrap().iter().any(|item| item["id"] == category_id && item["name"] == "Renamed fixture shelf"));
        let cached = managed.cached_manga(manga_id).expect("persisted cached chapter state");
        assert_eq!(cached["chapters"][0]["lastPageRead"], 1);
        managed.assign_category(manga_id, category_id, false).expect("remove category membership");
        managed.delete_category(category_id).expect("remove category only");
        let list = managed.query(ReadOperation::Library).expect("library after category removal");
        assert!(list["nodes"].as_array().unwrap().iter().any(|item| item["id"] == manga_id.to_string()));
        let details = managed.manga(manga_id).expect("persisted reading progress");
        assert_eq!(details["chapters"][0]["id"], id);
        assert_eq!(details["chapters"][0]["isBookmarked"], true);
        assert_eq!(details["chapters"][0]["isRead"], true);
        assert_eq!(details["chapters"][0]["lastPageRead"], 1);
        let reopened = managed.chapter(id).expect("reopened chapter");
        assert_eq!(reopened.len(), 2);
        assert_eq!(managed.page(&reopened, 1).unwrap().mime, "image/png");
        eprintln!("PASS: manga library, chapter progress and images survived normal JVM restart.");
        let port = managed.client.port;
        managed.shutdown().expect("normal JVM shutdown after restart");
        drop(managed);
        assert!(TcpStream::connect_timeout(
            &std::net::SocketAddr::from((Ipv4Addr::LOCALHOST, port)),
            Duration::from_secs(2)
        )
        .is_err());
        fs::remove_dir_all(data).expect("clean disposable reading data");
    }

    #[test]
    #[ignore = "requires the pinned Windows reading runtime and original CI fixture"]
    fn packaged_runtime_extension() {
        let runtime = PathBuf::from(std::env::var_os("TSUGI_READ_RUNTIME").unwrap());
        let data = PathBuf::from(std::env::var_os("TSUGI_READ_FIXTURE").unwrap()).join("extension");
        let jar = fs::read(runtime.join("test-fixtures/tsugi-fixture-v1.6.1.jar"))
            .expect("compiled original extension fixture");
        assert!(jar.starts_with(b"PK") && jar.len() < 1024 * 1024);
        let store = FixtureStore::with_jar(Some(jar));
        let mut managed = ReadRuntime::start(&runtime, &data).expect("native extension runtime startup");
        managed.add_store_inner(&store.url).expect("add fixture store");
        managed.refresh_extensions().expect("refresh fixture catalogue");
        let entry = managed.client.document(
            "query TsugiExtension($pkg: String!) { extension(pkgName: $pkg) { pkgName storeIndexUrl versionName isInstalled jarUrl } }",
            "extension",
            json!({"pkg": "org.tsugi.fixture"}),
        ).expect("read exact extension metadata");
        assert_eq!(entry["storeIndexUrl"], store.url);
        assert_eq!(entry["versionName"], "1.6.1");
        assert_eq!(entry["isInstalled"], false);
        assert_eq!(entry["jarUrl"], store.url.replace("/index.pb", "/tsugi-fixture-v1.6.1.jar"));
        // Test-only executable operation; never execute arbitrary repository code.
        // The production review rejects the loopback repository. Only the
        // test itself calls the private mutation for this authored fixture.
        assert!(managed.review_extension("org.tsugi.fixture").is_err());
        let installed = managed.mutate_extension("org.tsugi.fixture", true).expect("install original fixture");
        assert_eq!(installed["extension"]["pkgName"], "org.tsugi.fixture");
        assert_eq!(installed["extension"]["isInstalled"], true);
        let assert_catalogue = |runtime: &ReadRuntime| {
            let sources = runtime.query(ReadOperation::Sources).unwrap();
            assert!(sources["nodes"].as_array().unwrap().iter().any(|source| source["id"] == "12345"));
            let popular = runtime.catalogue("12345", 1, CatalogueMode::Popular).expect("execute fixture source");
            assert_eq!(popular["mangas"][0]["title"], "Tsugi Original Comic");
            let search = runtime.catalogue("12345", 1, CatalogueMode::Search("original")).unwrap();
            assert_eq!(search["mangas"][0]["title"], "Tsugi Original Comic");
            let empty = runtime.catalogue("12345", 1, CatalogueMode::Search("not present")).unwrap();
            assert!(empty["mangas"].as_array().unwrap().is_empty());
        };
        assert_catalogue(&managed);
        managed.shutdown().expect("shutdown installed fixture");
        drop(managed);
        let mut managed = ReadRuntime::start(&runtime, &data).expect("reopen installed fixture");
        assert_catalogue(&managed);
        managed.uninstall_extension("org.tsugi.fixture").expect("uninstall original fixture");
        assert!(!managed.query(ReadOperation::Sources).unwrap()["nodes"].as_array().unwrap().iter().any(|source| source["id"] == "12345"));
        managed.shutdown().expect("shutdown after uninstall");
        drop(managed);
        let mut managed = ReadRuntime::start(&runtime, &data).expect("reopen after uninstall");
        assert!(!managed.query(ReadOperation::Sources).unwrap()["nodes"].as_array().unwrap().iter().any(|source| source["id"] == "12345"));
        managed.shutdown().expect("shutdown fixture runtime");
        drop(managed);
        fs::remove_dir_all(data).expect("clean disposable extension fixture");
        eprintln!("PASS: original extension installed, executed catalogue and search, survived restart, uninstalled and remained absent.");
    }

    #[test]
    #[ignore = "requires the pinned Windows reading runtime"]
    fn packaged_runtime_store() {
        let runtime = PathBuf::from(std::env::var_os("TSUGI_READ_RUNTIME").unwrap());
        let data = PathBuf::from(std::env::var_os("TSUGI_READ_FIXTURE").unwrap()).join("stores");
        let mut managed = ReadRuntime::start(&runtime, &data).expect("native store runtime startup");
        // Private test-only path: production add_store accepts HTTPS only.
        let store = FixtureStore::start();
        // Confirm the fixture is reachable from the Rust process before
        // asking the Java runtime to fetch it. This does not retry the mutation.
        let probe: ureq::Agent = ureq::Agent::config_builder()
            .proxy(None)
            .timeout_global(Some(Duration::from_secs(3)))
            .build().into();
        let response = probe.get(&store.url).call().expect("fixture HTTP readiness");
        assert_eq!(response.status().as_u16(), 200);
        drop(response);
        let before = store.requests.load(Ordering::Relaxed);
        let added = managed.add_store_inner(&store.url);
        eprintln!("Fixture index requests from Java: {}", store.requests.load(Ordering::Relaxed).saturating_sub(before));
        let added = added.expect("protobuf store metadata");
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
        let matching = managed.search_extensions(0, "FIXTURE", Some(&store.url)).expect("search whole store");
        assert_eq!(matching["totalCount"], 1);
        assert_eq!(matching["nodes"][0]["pkgName"], "org.tsugi.fixture");
        assert_eq!(managed.search_extensions(0, "", Some(&store.url)).unwrap()["totalCount"], 1);
        assert_eq!(managed.search_extensions(0, "fixture", None).unwrap()["totalCount"], 1);
        assert_eq!(managed.filter_extensions(0, "fixture", Some(&store.url), Some("en"), Some(false)).unwrap()["totalCount"], 1);
        assert_eq!(managed.filter_extensions(0, "", None, Some("fr"), None).unwrap()["totalCount"], 0);
        assert_eq!(managed.filter_extensions(0, "", None, None, Some(true)).unwrap()["totalCount"], 0);
        assert_eq!(managed.filter_extensions_with_updates(0, "", None, None, None, true).unwrap()["totalCount"], 0);
        assert_eq!(managed.filter_extensions_with_updates(0, "fixture", Some(&store.url), Some("en"), None, true).unwrap()["totalCount"], 0);
        assert!(managed.filter_extensions(0, "", None, Some("en\n"), None).is_err());
        assert_eq!(managed.search_extensions(0, "no matching extension", None).unwrap()["totalCount"], 0);
        assert!(managed.search_extensions(0, "", Some("https://example.invalid/repo.json")).is_err());
        assert!(managed.extensions(100).unwrap()["nodes"].as_array().unwrap().is_empty());
        // Upstream settings persistence is asynchronous (SettingDelegate
        // launches a StateFlow collector). Verify the config write before
        // terminating the child. Never print the config or its contents.
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let config = fs::read_to_string(data.join("server.conf")).unwrap_or_default();
            if config.contains(&store.url) { break; }
            assert!(Instant::now() < deadline, "Store preference was not persisted");
            std::thread::sleep(Duration::from_millis(100));
        }
        let first_port = managed.client.port;
        managed.shutdown().expect("normal JVM shutdown before reopening stores");
        drop(managed);
        assert!(TcpStream::connect_timeout(
            &std::net::SocketAddr::from((Ipv4Addr::LOCALHOST, first_port)),
            Duration::from_secs(2)
        ).is_err());
        let mut managed = ReadRuntime::start(&runtime, &data).expect("reopen extension stores");
        let stores = managed.query(ReadOperation::Stores).expect("persisted extension stores");
        assert!(stores["nodes"].as_array().unwrap().iter().any(|node| node["indexUrl"] == store.url));
        managed.refresh_extensions().expect("refresh persisted store");
        assert!(managed.extensions(0).unwrap()["nodes"].as_array().unwrap().iter().any(|node| node["pkgName"] == "org.tsugi.fixture"));
        managed.remove_store(&store.url).expect("remove fixture store");
        assert!(managed.query(ReadOperation::Stores).unwrap()["nodes"].as_array().unwrap().is_empty());
        managed.refresh_extensions().expect("refresh removed store");
        assert!(managed.extensions(0).unwrap()["nodes"].as_array().unwrap().is_empty());
        eprintln!("PASS: extension store persisted across restart and removal refreshed the catalogue.");
        let port = managed.client.port;
        managed.shutdown().expect("normal JVM shutdown after restart");
        drop(managed);
        assert!(TcpStream::connect_timeout(
            &std::net::SocketAddr::from((Ipv4Addr::LOCALHOST, port)),
            Duration::from_secs(2)
        )
        .is_err());
        fs::remove_dir_all(data).expect("clean disposable reading data");
    }

    #[test]
    fn oauth_callback_requires_matching_state_path_and_provider() {
        let redirect = url::Url::parse("http://127.0.0.1:12345/tracker/oauth/fixture").unwrap();
        let state = json!({"redirectUrl": redirect.as_str(), "trackerId": 1, "nonce": "fixture"});
        let mut callback = redirect.clone();
        callback.query_pairs_mut().append_pair("code", "fixture-code").append_pair("state", &state.to_string());
        let target = format!("{}?{}", callback.path(), callback.query().unwrap());
        assert!(tracker_callback(&target, &redirect, &state, 1).is_some());
        assert!(tracker_callback(&target, &redirect, &state, 2).is_none());
        assert!(tracker_callback(&target, &redirect, &json!({"nonce": "different"}), 1).is_none());
        assert!(tracker_callback(&target.replace("/fixture?", "/wrong?"), &redirect, &state, 1).is_none());
        assert!(tracker_callback(&(target + "&code=second"), &redirect, &state, 1).is_none());
        assert!(tracker_auth_url(1, "https://myanimelist.net/v1/oauth2/authorize?response_type=code", &state).is_ok());
        assert!(tracker_auth_url(1, "https://myanimelist.net.example.test/v1/oauth2/authorize", &state).is_err());
    }

    #[test]
    fn tracker_callback_accepts_one_loopback_request_without_echoing_secret() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let redirect = url::Url::parse(&format!("http://{address}/tracker/oauth/fixture")).unwrap();
        let state = json!({"redirectUrl": redirect.as_str(), "trackerId": 2, "nonce": "fixture"});
        let mut callback = redirect.clone();
        callback.query_pairs_mut().append_pair("access_token", "fixture-token").append_pair("state", &state.to_string());
        let target = format!("{}?{}", callback.path(), callback.query().unwrap());
        let client = std::thread::spawn(move || {
            let mut connection = std::net::TcpStream::connect(address).unwrap();
            connection.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
            connection.write_all(format!("GET {target} HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\n\r\n").as_bytes()).unwrap();
            let mut response = String::new();
            connection.read_to_string(&mut response).unwrap();
            assert!(response.starts_with("HTTP/1.1 200 OK"));
            assert!(!response.contains("fixture-token"));
        });
        let value = await_tracker_callback(listener, &redirect, &state, 2, &AtomicBool::new(false)).unwrap();
        assert_eq!(value, callback.to_string());
        client.join().unwrap();
    }
}
