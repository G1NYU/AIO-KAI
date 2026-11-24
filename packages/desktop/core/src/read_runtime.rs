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
            .send(json!({ "query": operation.query() }).to_string())
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
