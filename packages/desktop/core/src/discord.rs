//! Optional Discord Rich Presence over the local desktop client's IPC socket.
//! No account token, provider URL, local filename or remote artwork is accepted.

use std::io::{ErrorKind, Read, Write};
use std::path::PathBuf;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use serde_json::{Value, json};

use crate::bridge::Outbound;

const REPO_URL: &str = "https://github.com/G1NYU/TSUGI";
const RETRY: Duration = Duration::from_secs(30);
/// Discord allows five activity updates in twenty seconds. Privacy clears bypass this gap.
const GAP: Duration = Duration::from_secs(4);
const IO_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_FRAME: usize = 64 * 1024;
const OP_HANDSHAKE: u32 = 0;
const OP_FRAME: u32 = 1;
const OP_CLOSE: u32 = 2;
const OP_PING: u32 = 3;
const OP_PONG: u32 = 4;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Media {
    #[default]
    Video,
    Music,
    Manga,
    Books,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Visibility {
    pub video: bool,
    pub music: bool,
    pub manga: bool,
    pub books: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub enabled: bool,
    pub application_id: String,
    pub private_mode: bool,
    pub media: Visibility,
}

impl Config {
    fn status(&self) -> Option<Status> {
        if !self.enabled {
            Some(Status::Disabled)
        } else if self.private_mode {
            Some(Status::Private)
        } else if !valid_application_id(&self.application_id) {
            Some(Status::NeedsSetup)
        } else {
            None
        }
    }

    fn permits(&self, presence: &Presence) -> bool {
        self.status().is_none() && match presence.media {
            Media::Video => self.media.video,
            Media::Music => self.media.music,
            Media::Manga => self.media.manga,
            Media::Books => self.media.books,
        }
    }
}

fn valid_application_id(value: &str) -> bool {
    (17..=20).contains(&value.len()) && !value.starts_with('0')
        && value.bytes().all(|b| b.is_ascii_digit()) && value.parse::<u64>().is_ok()
}

/// Position and duration are milliseconds. The closed schema excludes private URLs.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Presence {
    #[serde(default)]
    pub media: Media,
    pub title: String,
    pub subtitle: Option<String>,
    pub imdb: Option<String>,
    pub position: i64,
    pub duration: Option<i64>,
    #[serde(default)]
    pub paused: bool,
    #[serde(default)]
    pub browsing: bool,
}

enum Command {
    Configure(Config),
    Set(Option<Presence>),
    Check,
}

static WORKER: OnceLock<Sender<Command>> = OnceLock::new();
/// Interrupt an outstanding IPC read when sharing changes or is cleared.
static CLEAR_GENERATION: AtomicU64 = AtomicU64::new(0);

pub fn start(emit: impl Fn(Outbound) + Send + 'static) {
    WORKER.get_or_init(|| {
        let (tx, rx) = mpsc::channel();
        std::thread::Builder::new().name("discord".into())
            .spawn(move || run(rx, emit)).expect("spawn the discord thread");
        tx
    });
}

pub fn configure(config: Config) {
    CLEAR_GENERATION.fetch_add(1, Ordering::SeqCst);
    send(Command::Configure(config));
}

pub fn set(presence: Option<Presence>) {
    if presence.is_none() { CLEAR_GENERATION.fetch_add(1, Ordering::SeqCst); }
    send(Command::Set(presence));
}

pub fn check() { send(Command::Check); }

fn send(command: Command) {
    if let Some(worker) = WORKER.get() { let _ = worker.send(command); }
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Status { Disabled, Private, NeedsSetup, Idle, Connected, NotFound, Failed, Refused }

struct Reporter<E> { emit: E, last: Option<Status> }
impl<E: Fn(Outbound)> Reporter<E> {
    fn report(&mut self, status: Status, force: bool) {
        if force || self.last != Some(status) {
            let state = match status {
                Status::Disabled => "disabled", Status::Private => "private",
                Status::NeedsSetup => "needs-setup", Status::Idle => "idle",
                Status::Connected => "connected", Status::NotFound => "not-found",
                Status::Failed => "failed", Status::Refused => "refused",
            };
            // Do not forward Discord responses, socket paths, IDs or account information.
            (self.emit)(Outbound::DiscordStatus { state, message: None });
            self.last = Some(status);
        }
    }
    fn open(&mut self, config: &Config, force: bool, connect: &mut impl FnMut(&str) -> Result<Connection, Status>) -> Option<Connection> {
        match connect(&config.application_id) {
            Ok(conn) => { self.report(Status::Connected, force); Some(conn) }
            Err(status) => { self.report(status, force); None }
        }
    }
}

fn run(rx: Receiver<Command>, emit: impl Fn(Outbound)) {
    run_with(rx, emit, Connection::open);
}

fn run_with(rx: Receiver<Command>, emit: impl Fn(Outbound), mut connect: impl FnMut(&str) -> Result<Connection, Status>) {
    let mut reporter = Reporter { emit, last: None };
    let mut config = Config::default();
    let mut conn: Option<Connection> = None;
    let mut desired: Option<Presence> = None;
    let mut pending = false;
    let mut next_send = Instant::now();
    reporter.report(Status::Disabled, false);
    loop {
        let received = if pending {
            rx.recv_timeout(next_send.saturating_duration_since(Instant::now()))
        } else {
            rx.recv().map_err(|_| RecvTimeoutError::Disconnected)
        };
        match received {
            Ok(Command::Configure(next)) => {
                // Close the old application's connection, clear its activity, and cancel retries.
                if let Some(mut old) = conn.take() { let _ = old.set_activity(None); }
                config = next;
                pending = desired.as_ref().is_some_and(|p| config.permits(p));
                next_send = Instant::now();
                reporter.report(config.status().unwrap_or(Status::Idle), true);
                continue;
            }
            Ok(Command::Set(presence)) => {
                desired = presence;
                if desired.as_ref().is_none_or(|p| !config.permits(p)) {
                    // Clearing is never delayed behind a rate-limit or a reconnect timer.
                    if let Some(mut old) = conn.take() { let _ = old.set_activity(None); }
                    pending = false;
                    reporter.report(config.status().unwrap_or(Status::Idle), false);
                } else {
                    pending = true;
                }
                continue;
            }
            Ok(Command::Check) => {
                if let Some(status) = config.status() {
                    reporter.report(status, true);
                } else if conn.is_none() {
                    conn = reporter.open(&config, true, &mut connect);
                    if conn.is_some() { next_send = Instant::now(); }
                } else {
                    // A real round trip detects a Discord restart; no cached 'connected' claim.
                    match conn.as_mut().unwrap().ping() {
                        Ok(()) => reporter.report(Status::Connected, true),
                        Err(_) => { conn = None; reporter.report(Status::Failed, true); }
                    }
                }
                continue;
            }
            Err(RecvTimeoutError::Disconnected) => {
                if let Some(mut old) = conn.take() { let _ = old.set_activity(None); }
                return;
            }
            Err(RecvTimeoutError::Timeout) => {}
        }
        pending = false;
        let Some(presence) = desired.as_ref().filter(|p| config.permits(p)) else { continue; };
        if conn.is_none() { conn = reporter.open(&config, false, &mut connect); }
        match conn.as_mut().map(|c| c.set_activity(Some(presence))) {
            Some(Ok(refused)) => {
                reporter.report(if refused { Status::Refused } else { Status::Connected }, false);
                next_send = Instant::now() + GAP;
            }
            Some(Err(_)) => {
                conn = None;
                reporter.report(Status::Failed, false);
                pending = true;
                next_send = Instant::now() + RETRY;
            }
            None => { pending = true; next_send = Instant::now() + RETRY; }
        }
    }
}

fn clip(text: &str) -> String {
    // Titles may come from local filenames or third parties. Do not expose a path or URL.
    let clean: String = text.chars().filter(|c| !c.is_control()).collect();
    let text = clean.trim();
    let lower = text.to_ascii_lowercase();
    let windows_path = text.as_bytes().windows(3).any(|part| part[0].is_ascii_alphabetic() && part[1] == b':' && part[2] == b'/');
    if text.contains("://") || text.contains("\\\\") || text.contains(":\\")
        || windows_path || text.starts_with('/') || text.starts_with('\\') || lower.contains("token=") || lower.contains("password=") {
        return "Private title".into();
    }
    let text: String = text.chars().take(128).collect();
    if text.chars().count() < 2 { format!("{text}  ") } else { text }
}

fn clock(ms: i64) -> String {
    let s = ms.max(0) / 1000;
    let (h, m, s) = (s / 3600, s / 60 % 60, s % 60);
    if h > 0 { format!("{h}:{m:02}:{s:02}") } else { format!("{m}:{s:02}") }
}

fn activity(p: &Presence) -> Value {
    let media = matches!(p.media, Media::Video | Media::Music);
    let duration = p.duration.filter(|d| *d > 0 && *d <= 7 * 24 * 3600 * 1000);
    let subtitle = p.subtitle.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let state = if p.paused && media {
        Some(match duration {
            Some(d) => format!("Paused at {} of {}", clock(p.position), clock(d)),
            None => format!("Paused at {}", clock(p.position)),
        })
    } else { subtitle.map(str::to_owned) };
    let mut result = json!({
        "type": match p.media { Media::Video => 3, Media::Music => 2, _ => 0 },
        "details": clip(&p.title),
        "buttons": [{ "label": "TSUGI", "url": REPO_URL }],
    });
    if let Some(state) = state { result["state"] = json!(clip(&state)); }
    if !p.browsing { result["status_display_type"] = json!(2); }
    if p.media == Media::Video {
        if let Some(id) = p.imdb.as_deref().filter(|id|
            (3..=12).contains(&id.len()) && id.starts_with("tt") && id[2..].bytes().all(|b| b.is_ascii_digit())) {
            let page = format!("https://www.imdb.com/title/{id}/");
            result["details_url"] = json!(page);
            result["buttons"] = json!([
                { "label": "View on IMDb", "url": page },
                { "label": "TSUGI", "url": REPO_URL },
            ]);
        }
    }
    if media && !p.paused && !p.browsing {
        if let Some(d) = duration {
            let now = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |t| t.as_millis() as i64);
            let start = now.saturating_sub(p.position.clamp(0, d));
            result["timestamps"] = json!({ "start": start, "end": start.saturating_add(d) });
        }
    }
    result
}

struct Connection { stream: Box<dyn Stream>, nonce: u64 }
trait Stream: Read + Write + Send {}
impl<T: Read + Write + Send> Stream for T {}

impl Connection {
    fn open(application_id: &str) -> Result<Self, Status> {
        if !valid_application_id(application_id) { return Err(Status::NeedsSetup); }
        let mut failed = false;
        let generation = CLEAR_GENERATION.load(Ordering::SeqCst);
        for path in socket_paths() {
            if CLEAR_GENERATION.load(Ordering::SeqCst) != generation { return Err(Status::Failed); }
            let stream = match connect(&path) {
                Ok(stream) => stream,
                Err(e) if e.kind() == ErrorKind::NotFound || e.raw_os_error() == Some(2) => continue,
                Err(_) => { failed = true; continue; }
            };
            let mut conn = Self { stream, nonce: 0 };
            let result = conn.write(OP_HANDSHAKE, &json!({"v":1,"client_id":application_id}))
                .and_then(|_| conn.read());
            match result {
                Ok(reply) if reply["cmd"] == "DISPATCH" && reply["evt"] == "READY" => return Ok(conn),
                Ok(_) => return Err(Status::Refused),
                Err(_) => { failed = true; }
            }
        }
        Err(if failed { Status::Failed } else { Status::NotFound })
    }

    fn set_activity(&mut self, presence: Option<&Presence>) -> std::io::Result<bool> {
        self.nonce = self.nonce.wrapping_add(1);
        let nonce = self.nonce.to_string();
        self.write(OP_FRAME, &json!({
            "cmd":"SET_ACTIVITY", "args":{"pid":std::process::id(),"activity":presence.map(activity)},
            "nonce":nonce,
        }))?;
        for _ in 0..16 {
            let reply = self.read()?;
            if reply["nonce"] != nonce { continue; }
            if reply["evt"] == "ERROR" { return Ok(true); }
            if reply["cmd"] == "SET_ACTIVITY" { return Ok(false); }
            return Err(std::io::Error::other("Unexpected Discord reply"));
        }
        Err(std::io::Error::other("Discord did not acknowledge the activity"))
    }

    fn ping(&mut self) -> std::io::Result<()> {
        self.nonce = self.nonce.wrapping_add(1);
        let nonce = format!("tsugi-check-{}", self.nonce);
        self.write(OP_PING, &json!({ "nonce": nonce }))?;
        for _ in 0..16 {
            let (op, value) = self.read_frame()?;
            if op == OP_PONG && value["nonce"] == nonce { return Ok(()); }
        }
        Err(std::io::Error::other("Discord did not acknowledge the connection check"))
    }

    fn write(&mut self, op: u32, payload: &Value) -> std::io::Result<()> {
        let body = serde_json::to_vec(payload).map_err(std::io::Error::other)?;
        if body.len() > MAX_FRAME { return Err(std::io::Error::other("Discord frame is too large")); }
        let mut frame = Vec::with_capacity(8 + body.len());
        frame.extend_from_slice(&op.to_le_bytes());
        frame.extend_from_slice(&(body.len() as u32).to_le_bytes());
        frame.extend_from_slice(&body);
        self.stream.write_all(&frame)?;
        self.stream.flush()
    }

    fn read(&mut self) -> std::io::Result<Value> {
        self.read_frame().map(|(_, value)| value)
    }

    fn read_frame(&mut self) -> std::io::Result<(u32, Value)> {
        for _ in 0..16 {
            let mut header = [0; 8];
            self.stream.read_exact(&mut header)?;
            let op = u32::from_le_bytes(header[..4].try_into().unwrap());
            let len = u32::from_le_bytes(header[4..].try_into().unwrap()) as usize;
            if len > MAX_FRAME { return Err(std::io::Error::other("Discord frame is too large")); }
            if op == OP_CLOSE { return Err(std::io::Error::other("Discord closed the connection")); }
            if op != OP_FRAME && op != OP_PING && op != OP_PONG { return Err(std::io::Error::other("Unexpected Discord frame")); }
            let mut body = vec![0; len];
            self.stream.read_exact(&mut body)?;
            let value: Value = serde_json::from_slice(&body).map_err(|_| std::io::Error::other("Invalid Discord frame"))?;
            if op == OP_PING { self.write(OP_PONG, &value)?; continue; }
            return Ok((op, value));
        }
        Err(std::io::Error::other("Too many Discord control frames"))
    }
}

#[cfg(windows)]
fn socket_paths() -> Vec<PathBuf> {
    (0..10).map(|i| format!(r"\\.\pipe\discord-ipc-{i}").into()).collect()
}

#[cfg(windows)]
struct Pipe(std::fs::File);
#[cfg(windows)]
impl Read for Pipe {
    fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
        use std::os::windows::io::AsRawHandle;
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn PeekNamedPipe(handle: *mut std::ffi::c_void, buffer: *mut std::ffi::c_void, size: u32,
                read: *mut u32, available: *mut u32, left: *mut u32) -> i32;
        }
        if out.is_empty() { return Ok(0); }
        let until = Instant::now() + IO_TIMEOUT;
        let generation = CLEAR_GENERATION.load(Ordering::SeqCst);
        loop {
            if CLEAR_GENERATION.load(Ordering::SeqCst) != generation {
                return Err(std::io::Error::new(ErrorKind::ConnectionAborted, "Discord operation cancelled"));
            }
            let mut available = 0;
            let ok = unsafe { PeekNamedPipe(self.0.as_raw_handle(), std::ptr::null_mut(), 0,
                std::ptr::null_mut(), &mut available, std::ptr::null_mut()) };
            if ok == 0 { return Err(std::io::Error::last_os_error()); }
            if available > 0 {
                let count = out.len().min(available as usize);
                return self.0.read(&mut out[..count]);
            }
            if Instant::now() >= until { return Err(std::io::Error::new(ErrorKind::TimedOut, "Discord did not respond")); }
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}
#[cfg(windows)]
impl Write for Pipe {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> { self.0.write(bytes) }
    fn flush(&mut self) -> std::io::Result<()> { self.0.flush() }
}
#[cfg(windows)]
fn connect(path: &std::path::Path) -> std::io::Result<Box<dyn Stream>> {
    Ok(Box::new(Pipe(std::fs::OpenOptions::new().read(true).write(true).open(path)?)))
}

#[cfg(unix)]
fn socket_paths() -> Vec<PathBuf> {
    let mut dirs = vec![];
    for dir in ["XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"].into_iter()
        .filter_map(std::env::var_os).map(PathBuf::from).chain(["/tmp".into()]) {
        if !dirs.contains(&dir) { dirs.push(dir); }
    }
    let mut subs = vec![""];
    if cfg!(target_os = "linux") {
        subs.extend(["snap.discord", "snap.discord-canary", "app/com.discordapp.Discord",
            ".flatpak/com.discordapp.Discord/xdg-run", "app/dev.vencord.Vesktop",
            ".flatpak/dev.vencord.Vesktop/xdg-run", "app/org.equicord.equibop",
            ".flatpak/org.equicord.equibop/xdg-run", "app/io.github.equicord.equibop",
            ".flatpak/io.github.equicord.equibop/xdg-run"]);
    }
    dirs.into_iter().flat_map(|dir| subs.iter().flat_map(move |sub|
        (0..10).map({ let dir = dir.clone(); move |i| dir.join(sub).join(format!("discord-ipc-{i}")) }))).collect()
}

#[cfg(unix)]
fn connect(path: &std::path::Path) -> std::io::Result<Box<dyn Stream>> {
    let stream = std::os::unix::net::UnixStream::connect(path)?;
    stream.set_read_timeout(Some(IO_TIMEOUT))?;
    stream.set_write_timeout(Some(IO_TIMEOUT))?;
    Ok(Box::new(stream))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn presence(media: Media) -> Presence {
        Presence { media, title: "A title".into(), subtitle: Some("Artist or chapter".into()),
            imdb: Some("tt1234567".into()), position: 2000, duration: Some(90000), paused: false, browsing: false }
    }
    fn config() -> Config {
        Config { enabled: true, private_mode: false, application_id: "123456789012345678".into(),
            media: Visibility { video: true, music: true, manga: true, books: true } }
    }
    #[test]
    fn defaults_and_privacy_gate_every_media_type() {
        for media in [Media::Video, Media::Music, Media::Manga, Media::Books] {
            let p = presence(media);
            assert!(!Config::default().permits(&p));
            let mut c = config(); assert!(c.permits(&p));
            c.private_mode = true; assert!(!c.permits(&p));
            c.private_mode = false; c.media = Visibility::default(); assert!(!c.permits(&p));
            c = config(); c.application_id.clear(); assert!(!c.permits(&p));
        }
    }
    #[test]
    fn application_identity_is_explicit_and_bounded() {
        assert!(valid_application_id("123456789012345678"));
        for id in ["", "1484926986865479680x", "00000000000000000", "18446744073709551616", "123", "12345678901234567 "] {
            assert!(!valid_application_id(id));
        }
    }
    #[test]
    fn media_payload_has_only_public_metadata_and_supported_activity_types() {
        for (media, kind) in [(Media::Video,3),(Media::Music,2),(Media::Manga,0),(Media::Books,0)] {
            let a = activity(&presence(media));
            assert_eq!(a["type"],kind);
            assert_eq!(a.get("timestamps").is_some(), matches!(media, Media::Video | Media::Music));
            assert_eq!(a.get("details_url").is_some(), media == Media::Video);
            assert!(a.get("assets").is_none());
            assert!(!a.to_string().contains("AIOStreams"));
            assert!(a.to_string().contains("G1NYU/TSUGI"));
        }
        let mut p = presence(Media::Music); p.paused = true;
        assert!(activity(&p).get("timestamps").is_none());
        assert!(activity(&p)["state"].as_str().unwrap().starts_with("Paused"));
    }
    #[test]
    fn provider_urls_paths_and_extra_fields_cannot_escape_as_presence() {
        for text in ["https://private.test/?token=secret", r"C:\Users\private\track.mp3", "C:/Users/private/track.mp3",
            "  c:/Users/private/track.mp3  ", "/private/book.epub", "  /Users/private/book.epub", "\t/Users/private/book.epub\n",
            "\u{0001}/Users/private/book.epub", "C\u{0001}:/Users/private/track.mp3", r"\Users\private", r"\\server\private", "password=secret"] {
            assert_eq!(clip(text),"Private title");
        }
        assert_eq!(clip("Title\nwith\tcontrols"),"Titlewithcontrols");
        assert_eq!(clip("  AC/DC  "), "AC/DC");
        assert_eq!(clip("  Chapter 1: Opening  "), "Chapter 1: Opening");
        assert!(serde_json::from_value::<Presence>(json!({"media":"music","title":"Title","subtitle":null,
            "imdb":null,"position":0,"duration":null,"streamUrl":"https://secret.test"})).is_err());
    }
    struct Fixture { input: std::io::Cursor<Vec<u8>>, output: Vec<u8> }
    impl Read for Fixture { fn read(&mut self, b: &mut [u8]) -> std::io::Result<usize> { self.input.read(b) } }
    impl Write for Fixture {
        fn write(&mut self, b: &[u8]) -> std::io::Result<usize> { self.output.extend_from_slice(b); Ok(b.len()) }
        fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
    }
    fn frame(op: u32, value: Value) -> Vec<u8> {
        let body = serde_json::to_vec(&value).unwrap();
        [op.to_le_bytes().to_vec(),(body.len() as u32).to_le_bytes().to_vec(),body].concat()
    }
    fn fixture(input: Vec<u8>) -> Connection {
        Connection { stream: Box::new(Fixture { input: std::io::Cursor::new(input), output: vec![] }), nonce: 0 }
    }
    #[test]
    fn ipc_checks_nonce_acknowledgement_and_bounded_frames() {
        let mut c = fixture([frame(OP_FRAME,json!({"cmd":"DISPATCH","evt":"READY"})),
            frame(OP_FRAME,json!({"cmd":"SET_ACTIVITY","nonce":"1"}))].concat());
        assert!(!c.set_activity(Some(&presence(Media::Music))).unwrap());
        let mut c = fixture(frame(OP_FRAME,json!({"evt":"ERROR","nonce":"1","data":{"message":"secret"}})));
        assert!(c.set_activity(None).unwrap());
        let mut c = fixture([OP_FRAME.to_le_bytes().to_vec(),((MAX_FRAME+1) as u32).to_le_bytes().to_vec()].concat());
        assert!(c.read().is_err());
        let mut c = fixture(frame(OP_HANDSHAKE,json!({})));
        assert!(c.read().is_err());
        let mut c = fixture([frame(OP_PING,json!({"ping":1})),frame(OP_FRAME,json!({"cmd":"SET_ACTIVITY","nonce":"1"}))].concat());
        assert!(!c.set_activity(None).unwrap());
    }
    struct AutoReply {
        input: std::collections::VecDeque<u8>,
        activities: Sender<Value>,
    }
    impl Read for AutoReply {
        fn read(&mut self, output: &mut [u8]) -> std::io::Result<usize> {
            let count = output.len().min(self.input.len());
            for byte in &mut output[..count] { *byte = self.input.pop_front().unwrap(); }
            Ok(count)
        }
    }
    impl Write for AutoReply {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            let payload: Value = serde_json::from_slice(&bytes[8..]).unwrap();
            if u32::from_le_bytes(bytes[..4].try_into().unwrap()) == OP_PING {
                self.input.extend(frame(OP_PONG, payload));
            } else {
                self.activities.send(payload["args"]["activity"].clone()).unwrap();
                self.input.extend(frame(OP_FRAME, json!({"cmd":"SET_ACTIVITY","nonce":payload["nonce"]})));
            }
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
    }
    #[test]
    fn worker_never_connects_disabled_and_clears_queued_activity_without_waiting_for_gap() {
        use std::sync::Arc;
        let (tx, rx) = mpsc::channel();
        let (status_tx, statuses) = mpsc::channel();
        let (activity_tx, activities) = mpsc::channel();
        let connects = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let opens = connects.clone();
        let worker = std::thread::spawn(move || run_with(rx, move |message| {
            if let Outbound::DiscordStatus { state, .. } = message { status_tx.send(state).unwrap(); }
        }, move |_| {
            opens.fetch_add(1, Ordering::SeqCst);
            Ok(Connection { stream: Box::new(AutoReply { input: Default::default(), activities: activity_tx.clone() }), nonce: 0 })
        }));
        let status = || statuses.recv_timeout(Duration::from_secs(1)).unwrap();
        assert_eq!(status(), "disabled");
        tx.send(Command::Set(Some(presence(Media::Music)))).unwrap();
        tx.send(Command::Check).unwrap();
        assert_eq!(status(), "disabled");
        assert_eq!(connects.load(Ordering::SeqCst), 0);
        tx.send(Command::Configure(config())).unwrap();
        assert_eq!(status(), "idle"); assert_eq!(status(), "connected");
        assert!(!activities.recv_timeout(Duration::from_secs(1)).unwrap().is_null());
        tx.send(Command::Check).unwrap(); assert_eq!(status(), "connected");
        assert!(activities.try_recv().is_err(), "connection checks do not consume activity updates");
        // This title is queued inside the four-second rate gap. Private mode must
        // discard it and immediately clear the already-published title.
        tx.send(Command::Set(Some(presence(Media::Manga)))).unwrap();
        let mut private = config(); private.private_mode = true;
        let at = Instant::now();
        tx.send(Command::Configure(private)).unwrap();
        assert!(activities.recv_timeout(Duration::from_secs(1)).unwrap().is_null());
        assert_eq!(status(), "private");
        assert!(at.elapsed() < Duration::from_secs(1));
        tx.send(Command::Set(Some(presence(Media::Books)))).unwrap();
        tx.send(Command::Check).unwrap(); assert_eq!(status(), "private");
        assert_eq!(connects.load(Ordering::SeqCst), 1);
        assert!(activities.try_recv().is_err());
        tx.send(Command::Configure(config())).unwrap();
        assert_eq!(status(), "idle"); assert_eq!(status(), "connected");
        assert_eq!(activities.recv_timeout(Duration::from_secs(1)).unwrap()["type"], 0);
        tx.send(Command::Set(None)).unwrap();
        assert!(activities.recv_timeout(Duration::from_secs(1)).unwrap().is_null());
        assert_eq!(status(), "idle");
        drop(tx); worker.join().unwrap();
    }
    #[test]
    fn disabling_cancels_an_unavailable_discord_retry_and_check_stays_local() {
        use std::sync::Arc;
        let (tx, rx) = mpsc::channel();
        let (status_tx, statuses) = mpsc::channel();
        let connects = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let opens = connects.clone();
        let worker = std::thread::spawn(move || run_with(rx, move |message| {
            if let Outbound::DiscordStatus { state, .. } = message { status_tx.send(state).unwrap(); }
        }, move |_| { opens.fetch_add(1, Ordering::SeqCst); Err(Status::NotFound) }));
        let status = || statuses.recv_timeout(Duration::from_secs(1)).unwrap();
        assert_eq!(status(), "disabled");
        tx.send(Command::Configure(config())).unwrap(); assert_eq!(status(), "idle");
        tx.send(Command::Set(Some(presence(Media::Video)))).unwrap(); assert_eq!(status(), "not-found");
        tx.send(Command::Configure(Config::default())).unwrap(); assert_eq!(status(), "disabled");
        tx.send(Command::Check).unwrap(); assert_eq!(status(), "disabled");
        assert_eq!(connects.load(Ordering::SeqCst), 1);
        drop(tx); worker.join().unwrap();
    }

}
