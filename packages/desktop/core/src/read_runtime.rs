//! Isolated Windows reading runtime broker. No arbitrary GraphQL or
//! webview-visible credentials. Explicit repository metadata operations only;
//! executable extensions are not installed yet. Not wired to the app.
use std::fs;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, TcpListener};
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
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
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(15);

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
mod private_storage {
    use super::*;
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
    use std::ptr::{null, null_mut};

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

    pub(super) struct CurrentUser {
        // TOKEN_USER begins with a SID_AND_ATTRIBUTES, whose first field
        // is a pointer into this aligned, owned token-information buffer.
        buffer: Vec<usize>,
    }

    impl CurrentUser {
        pub(super) fn get() -> Result<Self, &'static str> {
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

        pub(super) fn create_root(&self, path: &Path) -> Result<bool, &'static str> {
            let sid = self.sid_string()?;
            // Explicit owner and one inheritable full-access ACE for the
            // current user only. P prevents inheritance from the parent.
            let descriptor = format!("O:{sid}D:P(A;OICI;FA;;;{sid})");
            create_with_descriptor(path, &descriptor)
        }

        pub(super) fn verify(&self, path: &Path, directory: bool) -> Result<(), &'static str> {
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
            let admin_owned_file = !directory && unsafe { IsWellKnownSid(owner, 26) } != 0;
            if !user_owned && !admin_owned_file {
                return Err("Reading storage owner is not permitted.");
            }
            if unsafe { GetSecurityDescriptorControl(raw, &mut control, &mut revision) } == 0 {
                return Err("Could not inspect reading storage DACL control flags.");
            }
            if control & 0x0004 == 0 || (directory && control & 0x1000 == 0) {
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
                    && if directory { (*ace).flags == 3 } else { matches!((*ace).flags, 0 | 16) }
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
    pub(super) fn create_public_fixture(path: &Path, user: &CurrentUser) {
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
            for path in [&lock_path, &key_path, &config_path] {
                user.verify(path, false)?;
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
        Ok(Self { _lock: lock, password })
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

/// Owns the launched process, private client, kill-on-close job and exclusive storage lock.
pub struct ReadRuntime {
    child: Child,
    client: ReadClient,
    job: Option<ReadJob>,
    _storage: ReadStorage,
}

impl ReadRuntime {
    pub fn start(runtime: &Path, data: &Path) -> Result<Self, &'static str> {
        let runtime = std::path::absolute(runtime)
            .map_err(|_| "Reading runtime is missing.")?;
        let java = runtime.join("jre/bin/java.exe");
        let jar = runtime.join("bin/Suwayomi-Server.jar");
        let launcher = runtime.join("launcher");
        if !java.is_file() || !jar.is_file()
            || !launcher.join("TsugiReadLauncher.class").is_file()
        {
            return Err("Reading runtime is incomplete.");
        }
        let classpath = std::env::join_paths([&launcher, &jar])
            .map_err(|_| "Invalid reading runtime path.")?;
        let data = std::path::absolute(data)
            .map_err(|_| "Could not locate reading data directory.")?;
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .map_err(|_| "Could not allocate reading port.")?;
        let port = listener
            .local_addr()
            .map_err(|_| "Could not allocate reading port.")?
            .port();
        let storage = ReadStorage::open(&data, port)?;
        drop(listener);
        let job = ReadJob::new()?;
        let mut child = Command::new(java)
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
        let mut managed = Self {
            child,
            client,
            job: Some(job),
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
        if offset > 100_000 || term.chars().count() > 200 || term.chars().any(char::is_control) {
            return Err("Invalid extension catalogue request.");
        }
        if let Some(index) = store {
            if index.len() > 2048 || index.chars().any(char::is_control)
                || !self.query(ReadOperation::Stores)?["nodes"].as_array().is_some_and(|nodes| nodes.iter().any(|node| node["indexUrl"] == index))
            {
                return Err("Extension repository is not registered.");
            }
        }
        let term = term.trim();
        let filter = if term.is_empty() { Value::Null } else {
            json!({"or": [{"name": {"includesInsensitive": term}}, {"pkgName": {"includesInsensitive": term}}, {"lang": {"equalTo": term}}]})
        };
        let condition = store.map(|index| json!({"storeIndexUrl": index}));
        let result = self.client.document(
            "query TsugiExtensions($offset: Int!, $filter: ExtensionFilter, $condition: ExtensionCondition) { extensions(first: 100, offset: $offset, filter: $filter, condition: $condition) { nodes { name pkgName storeIndexUrl versionName versionCodeLong extensionLib lang contentWarning isInstalled hasUpdate isObsolete } totalCount } }",
            "extensions",
            json!({ "offset": offset, "filter": filter, "condition": condition }),
        )?;
        let nodes = result["nodes"].as_array().ok_or("Invalid extension catalogue.")?;
        if nodes.len() > 100 || !result["totalCount"].is_u64() {
            return Err("Invalid extension catalogue.");
        }
        Ok(result)
    }

    fn extension_record(&self, package: &str) -> Result<Value, &'static str> {
        extension_package(package)?;
        let value = self.client.document(
            "query TsugiExtension($pkg: String!) { extension(pkgName: $pkg) { pkgName name storeIndexUrl versionName versionCodeLong isInstalled isObsolete apkUrl jarUrl } }",
            "extension",
            json!({"pkg": package}),
        )?;
        if value["pkgName"] != package {
            return Err("Extension identity did not match.");
        }
        Ok(value)
    }

    pub fn review_extension(&self, package: &str) -> Result<ExtensionReview, &'static str> {
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
        let current = self.extension_record(package)?;
        if current["isInstalled"] != true {
            return Err("Extension is not installed.");
        }
        self.mutate_extension(package, false)
    }

    fn mutate_extension(&self, package: &str, install: bool) -> Result<Value, &'static str> {
        extension_package(package)?;
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
        self.client.slow().mutation(
            "mutation TsugiCatalogue($input: FetchSourceMangaInput!) { fetchSourceManga(input: $input) { hasNextPage mangas { id sourceId title author thumbnailUrl inLibrary } } }",
            "fetchSourceManga",
            json!({ "source": source, "page": page, "type": kind, "query": query }),
        )
    }

    pub fn manga(&self, id: i32) -> Result<Value, &'static str> {
        if id <= 0 {
            return Err("Invalid manga identifier.");
        }
        self.client.slow().mutation(
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
        fs::remove_dir_all(&probe).unwrap();
        let first = ReadStorage::open(&data, 12345).expect("initialize private reading storage");
        user.verify(&data, true).unwrap();
        for name in [".tsugi-read.lock", ".tsugi-read.key", "server.conf"] {
            user.verify(&data.join(name), false).unwrap();
        }
        assert!(ReadStorage::open(&data, 12346).is_err());
        let password = first.password.clone();
        drop(first);
        let reopened = ReadStorage::open(&data, 12346).unwrap();
        assert!(reopened.password == password);
        drop(reopened);
        let public = parent.join("public");
        private_storage::create_public_fixture(&public, &user);
        assert!(ReadStorage::open(&public, 12345).is_err());
        assert!(!public.join(".tsugi-read.key").exists());
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
        requests: Arc<AtomicUsize>,
        worker: Option<JoinHandle<()>>,
    }

    impl FixtureStore {
        fn start() -> Self {
            Self::with_jar(None)
        }

        fn with_jar(jar: Option<Vec<u8>>) -> Self {
            let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
            let port = listener.local_addr().unwrap().port();
            listener.set_nonblocking(true).unwrap();
            let stop = Arc::new(AtomicBool::new(false));
            let stopped = Arc::clone(&stop);
            let requests = Arc::new(AtomicUsize::new(0));
            let served = Arc::clone(&requests);
            let worker = std::thread::spawn(move || {
                let jar_url = format!("http://127.0.0.1:{port}/tsugi-fixture-v1.6.1.jar");
                let body = fixture_index_with_jar(jar.as_ref().map(|_| jar_url.as_str()));
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
        let details = managed.manga(manga_id).expect("persisted reading progress");
        assert_eq!(details["chapters"][0]["id"], id);
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
}
