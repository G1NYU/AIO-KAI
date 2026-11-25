//! Downloads the page hands over. Each runs on its own thread, resumes from
//! what is already on disk, and the queue outlives the app.

use std::collections::{BTreeMap, HashMap};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use ureq::ResponseExt;

use crate::bridge::{DownloadJob, DownloadStatus, FileKind, Outbound};
use crate::playback::{is_header_name, is_header_value};
use crate::music_resolver;

const PROGRESS_EVERY: Duration = Duration::from_millis(500);
/// No timeout bounds a stalled read on its own, so each request ends after
/// this and the next one carries on from what was written.
const REQUEST_LIMIT: Duration = Duration::from_secs(90);
const RETRY_SECONDS: &[u64] = &[2, 5, 15, 30, 60];
const MAX_REDIRECTS: usize = 10;
const MAX_CONCURRENT: u32 = 4;
const EXTENSIONS: &[&str] = &[
    "mkv", "mp4", "m4v", "avi", "mov", "webm", "ts", "m2ts", "wmv", "flv", "mpg", "mpeg", "ogv",
    "3gp", "srt", "vtt", "ass", "ssa", "sub", "sup", "idx", "ttml", "jpg", "jpeg", "png", "webp",
    "avif", "json",
];
const VAULT_EXTENSIONS: &[&str] = &["pdf", "epub", "mp3", "flac", "m4a", "wav", "ogg", "opus", "aac"];
const VAULT_LIMIT: u64 = 256 * 1024 * 1024;
const MIB: u64 = 1024 * 1024;
const VAULT_RATES: &[u32] = &[0, 1, 2, 4, 8, 16];

fn vault_rate(value: u32) -> u32 {
    if VAULT_RATES.contains(&value) { value } else { 0 }
}
const RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum State {
    Queued,
    Downloading,
    Paused,
    Failed,
    Done,
}

impl State {
    fn name(self) -> &'static str {
        match self {
            State::Queued => "queued",
            State::Downloading => "downloading",
            State::Paused => "paused",
            State::Failed => "failed",
            State::Done => "done",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Job {
    #[serde(flatten)]
    spec: DownloadJob,
    /// Where it was saved, as the folder for new downloads can change.
    folder: PathBuf,
    state: State,
    bytes: u64,
    total: Option<u64>,
    error: Option<String>,
}

#[derive(Default, Serialize, Deserialize)]
struct Saved {
    folder: Option<PathBuf>,
    concurrent: Option<u32>,
    #[serde(default)]
    vault_rate_mib: u32,
    jobs: Vec<Job>,
}

pub enum Command {
    Add(Vec<DownloadJob>),
    Pause(String),
    Resume(String),
    Retry(String),
    Remove { id: String, files: bool },
    List,
    SetFolder(PathBuf),
    SetConcurrent(u32),
    SetVaultRate(u32),
}

enum Failure {
    Stopped,
    Error(String),
}

enum Event {
    Command(Command),
    Progress {
        id: String,
        bytes: u64,
        total: Option<u64>,
    },
    Finished {
        id: String,
        result: Result<(), Failure>,
    },
}

/// What playback and the file manager need, readable without the queue's thread.
#[derive(Default)]
struct Shared {
    folder: PathBuf,
    jobs: HashMap<String, Placed>,
}

#[derive(Default)]
struct Placed {
    done: bool,
    video: Option<PathBuf>,
    subtitles: Vec<PathBuf>,
    vault: Option<PathBuf>,
}

#[derive(Clone)]
pub struct Downloads {
    events: Sender<Event>,
    shared: Arc<Mutex<Shared>>,
}

impl Downloads {
    /// `emit` is called on the queue's own thread.
    pub fn start(
        state_file: PathBuf,
        default_folder: PathBuf,
        emit: impl Fn(Outbound) + Send + 'static,
    ) -> Downloads {
        let saved: Saved = fs::read(&state_file)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        let (events, received) = mpsc::channel();
        let shared = Arc::new(Mutex::new(Shared::default()));
        let mut queue = Queue {
            folder: saved.folder.unwrap_or(default_folder),
            concurrent: saved.concurrent.unwrap_or(2).clamp(1, MAX_CONCURRENT),
            vault_rate_mib: vault_rate(saved.vault_rate_mib),
            jobs: saved.jobs,
            running: HashMap::new(),
            removing: HashMap::new(),
            speeds: HashMap::new(),
            events: events.clone(),
            emit: Box::new(emit),
            state_file,
            shared: shared.clone(),
            agent: agent(),
        };
        for job in &mut queue.jobs {
            if job.state == State::Downloading {
                job.state = State::Queued;
            }
        }
        thread::Builder::new()
            .name("downloads".into())
            .spawn(move || queue.run(received))
            .expect("could not start the downloads thread");
        let downloads = Downloads { events, shared };
        downloads.send(Command::List);
        downloads
    }

    pub fn send(&self, command: Command) {
        let _ = self.events.send(Event::Command(command));
    }

    pub fn folder(&self) -> PathBuf {
        self.shared
            .lock()
            .map(|s| s.folder.clone())
            .unwrap_or_default()
    }

    pub fn is_local(&self, path: &str) -> bool {
        let Ok(shared) = self.shared.lock() else {
            return false;
        };
        let path = Path::new(path);
        shared
            .jobs
            .values()
            .filter(|p| p.done)
            .any(|p| p.video.as_deref() == Some(path) || p.subtitles.iter().any(|s| s == path))
    }

    /// Read only a completed Vault job, never a caller-supplied path.
    pub fn vault_file(&self, id: &str) -> Option<(&'static str, Vec<u8>)> {
        if !id.starts_with("vault-") || id.len() > 64 ||
            !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') { return None; }
        let path = {
            let shared = self.shared.lock().ok()?;
            let job = shared.jobs.get(id)?;
            if !job.done { return None; }
            job.vault.clone()?
        };
        let mime = match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
            "epub" => "application/epub+zip", "pdf" => "application/pdf",
            "m4a" => "audio/mp4", "mp3" => "audio/mpeg", "flac" => "audio/flac",
            "wav" => "audio/wav", "ogg" | "opus" => "audio/ogg", "aac" => "audio/aac",
            _ => return None,
        };
        const IMPORT_LIMIT: u64 = 128 * 1024 * 1024;
        let meta = fs::symlink_metadata(&path).ok()?;
        if !meta.file_type().is_file() || meta.len() == 0 || meta.len() > IMPORT_LIMIT { return None; }
        let mut data = Vec::new();
        let file = fs::File::open(path).ok()?;
        file.take(IMPORT_LIMIT + 1).read_to_end(&mut data).ok()?;
        if data.is_empty() || data.len() as u64 > IMPORT_LIMIT { return None; }
        Some((mime, data))
    }

    pub fn job_folder(&self, id: &str) -> Option<PathBuf> {
        let shared = self.shared.lock().ok()?;
        let job = shared.jobs.get(id)?;
        job.video.as_ref().or(job.vault.as_ref())?.parent().map(Path::to_path_buf)
    }
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(REQUEST_LIMIT))
        .timeout_connect(Some(Duration::from_secs(20)))
        .user_agent(concat!("AIOStreams Desktop/", env!("CARGO_PKG_VERSION")))
        .build()
        .into()
}

struct Speed {
    since: Instant,
    from: u64,
    value: u64,
}

struct Queue {
    folder: PathBuf,
    concurrent: u32,
    vault_rate_mib: u32,
    jobs: Vec<Job>,
    running: HashMap<String, Arc<AtomicBool>>,
    /// Removed while running: its files go once its thread lets go of them.
    removing: HashMap<String, Job>,
    speeds: HashMap<String, Speed>,
    events: Sender<Event>,
    emit: Box<dyn Fn(Outbound) + Send>,
    state_file: PathBuf,
    shared: Arc<Mutex<Shared>>,
    agent: ureq::Agent,
}

impl Queue {
    fn run(mut self, received: Receiver<Event>) {
        let mut last_progress = Instant::now();
        loop {
            match received.recv_timeout(PROGRESS_EVERY) {
                Ok(Event::Command(command)) => self.command(command),
                Ok(Event::Progress { id, bytes, total }) => {
                    if let Some(job) = self.jobs.iter_mut().find(|j| j.spec.id == id) {
                        job.bytes = bytes;
                        job.total = if bytes == 0 { total } else { total.or(job.total) };
                    }
                }
                Ok(Event::Finished { id, result }) => self.finished(&id, result),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return,
            }
            if last_progress.elapsed() >= PROGRESS_EVERY {
                last_progress = Instant::now();
                self.report_progress();
            }
        }
    }

    fn command(&mut self, command: Command) {
        match command {
            Command::Add(jobs) => {
                for spec in jobs {
                    if self.jobs.iter().any(|j| j.spec.id == spec.id) {
                        continue;
                    }
                    if let Err(e) = check(&spec) {
                        log::warn!("download {}: {e}", spec.id);
                        (self.emit)(Outbound::Error {
                            message: format!("Can't download {}: {e}", spec.title),
                        });
                        continue;
                    }
                    log::info!("download added id={} title={}", spec.id, spec.title);
                    self.jobs.push(Job {
                        spec,
                        folder: self.folder.clone(),
                        state: State::Queued,
                        bytes: 0,
                        total: None,
                        error: None,
                    });
                }
            }
            Command::Pause(id) => {
                if let Some(stop) = self.running.get(&id) {
                    stop.store(true, Ordering::Relaxed);
                }
                self.set_state(&id, |s| s != State::Done, State::Paused);
            }
            Command::Resume(id) => self.set_state(&id, |s| s == State::Paused, State::Queued),
            Command::Retry(id) => self.set_state(&id, |s| s == State::Failed, State::Queued),
            Command::Remove { id, files } => {
                let Some(at) = self.jobs.iter().position(|j| j.spec.id == id) else {
                    return;
                };
                let job = self.jobs.remove(at);
                if let Some(stop) = self.running.get(&id) {
                    stop.store(true, Ordering::Relaxed);
                    if files {
                        self.removing.insert(id, job);
                    }
                } else if files {
                    self.delete_files(&job);
                }
            }
            Command::List => {}
            Command::SetFolder(folder) => {
                log::info!("download folder={}", folder.display());
                self.folder = folder;
            }
            Command::SetConcurrent(n) => self.concurrent = n.clamp(1, MAX_CONCURRENT),
            Command::SetVaultRate(n) => { if VAULT_RATES.contains(&n) { self.vault_rate_mib = n; } },
        }
        self.changed();
    }

    fn set_state(&mut self, id: &str, when: impl Fn(State) -> bool, state: State) {
        if let Some(job) = self
            .jobs
            .iter_mut()
            .find(|j| j.spec.id == id && when(j.state))
        {
            job.state = state;
            job.error = None;
        }
    }

    fn finished(&mut self, id: &str, result: Result<(), Failure>) {
        let cancelled = self.running.remove(id).is_some_and(|stop| stop.load(Ordering::Relaxed));
        self.speeds.remove(id);
        if let Some(job) = self.removing.remove(id) {
            self.delete_files(&job);
        }
        if let Some(job) = self.jobs.iter_mut().find(|j| j.spec.id == id) {
            match result {
                Ok(()) => {
                    log::info!("download done id={id}");
                    job.state = State::Done;
                    job.total = job.total.or(Some(job.bytes));
                    job.bytes = job.total.unwrap_or(job.bytes);
                }
                // Paused or removed, which the command already recorded.
                Err(Failure::Stopped) => {}
                Err(Failure::Error(_)) if cancelled && matches!(job.state, State::Paused | State::Queued) => {}
                Err(Failure::Error(e)) => {
                    log::warn!("download failed id={id}: {e}");
                    job.state = State::Failed;
                    job.error = Some(e);
                }
            }
        }
        self.changed();
    }

    /// Starts what fits, saves the queue and tells the page.
    fn changed(&mut self) {
        let free = (self.concurrent as usize).saturating_sub(self.running.len());
        let next: Vec<usize> = self
            .jobs
            .iter()
            .enumerate()
            .filter(|(_, j)| j.state == State::Queued && !self.running.contains_key(&j.spec.id))
            .map(|(i, _)| i)
            .take(free)
            .collect();
        for i in next {
            let job = &mut self.jobs[i];
            job.state = State::Downloading;
            let stop = Arc::new(AtomicBool::new(false));
            self.running.insert(job.spec.id.clone(), stop.clone());
            let (spec, folder, events, agent) = (
                job.spec.clone(),
                job.folder.clone(),
                self.events.clone(),
                self.agent.clone(),
            );
            let vault_rate_mib = self.vault_rate_mib;
            if thread::Builder::new()
                .name("download".into())
                .spawn(move || work(spec, folder, agent, stop, events, vault_rate_mib)).is_err() {
                self.running.remove(&job.spec.id);
                job.state = State::Failed;
                job.error = Some("Could not start download worker".into());
            }
        }
        self.save();
        self.share();
        (self.emit)(Outbound::DownloadState {
            folder: self.folder.to_string_lossy().into_owned(),
            vault_rate_mib: self.vault_rate_mib,
            jobs: self
                .jobs
                .iter()
                .map(|j| {
                    let placed = if j.state == State::Done {
                        self.placed(j)
                    } else {
                        Placed::default()
                    };
                    DownloadStatus {
                        id: j.spec.id.clone(),
                        state: j.state.name(),
                        bytes: j.bytes,
                        total: j.total,
                        error: j.error.clone(),
                        video: placed.video.map(|p| p.to_string_lossy().into_owned()),
                        subtitles: placed
                            .subtitles
                            .iter()
                            .map(|p| p.to_string_lossy().into_owned())
                            .collect(),
                        vault_title: j.spec.files.iter().any(|f| f.kind == FileKind::Vault).then(|| j.spec.title.clone()),
                        vault_path: placed.vault.map(|p| p.to_string_lossy().into_owned()),
                    }
                })
                .collect(),
        });
    }

    fn report_progress(&mut self) {
        let now = Instant::now();
        for job in self.jobs.iter().filter(|j| j.state == State::Downloading) {
            let speed = self.speeds.entry(job.spec.id.clone()).or_insert(Speed {
                since: now,
                from: job.bytes,
                value: 0,
            });
            // Measured over a few seconds, so the number holds still enough to read.
            let elapsed = now.duration_since(speed.since).as_secs_f64();
            if elapsed >= 2.0 {
                speed.value = (job.bytes.saturating_sub(speed.from) as f64 / elapsed) as u64;
                speed.since = now;
                speed.from = job.bytes;
            }
            (self.emit)(Outbound::DownloadProgress {
                id: job.spec.id.clone(),
                bytes: job.bytes,
                total: job.total,
                speed: speed.value,
            });
        }
    }

    fn save(&self) {
        let saved = Saved {
            folder: Some(self.folder.clone()),
            concurrent: Some(self.concurrent),
            vault_rate_mib: self.vault_rate_mib,
            jobs: self.jobs.clone(),
        };
        let Ok(bytes) = serde_json::to_vec(&saved) else {
            return;
        };
        let temporary = self.state_file.with_extension("json.tmp");
        if fs::write(&temporary, bytes).is_ok() {
            let _ = fs::rename(&temporary, &self.state_file);
        }
    }

    fn placed(&self, job: &Job) -> Placed {
        let of = |kind| {
            job.spec
                .files
                .iter()
                .filter(move |f| f.kind == kind)
                .filter_map(|f| place(&job.folder, &f.path).ok())
        };
        Placed {
            done: job.state == State::Done,
            video: of(FileKind::Video).next(),
            subtitles: of(FileKind::Subtitle).collect(),
            vault: of(FileKind::Vault).next(),
        }
    }

    fn share(&self) {
        let jobs = self
            .jobs
            .iter()
            .map(|job| (job.spec.id.clone(), self.placed(job)))
            .collect();
        if let Ok(mut shared) = self.shared.lock() {
            shared.folder = self.folder.clone();
            shared.jobs = jobs;
        }
    }

    /// Leaves files another download still uses, such as a show's poster.
    fn delete_files(&self, job: &Job) {
        let others: Vec<PathBuf> = self
            .jobs
            .iter()
            .flat_map(|j| {
                let folder = j.folder.clone();
                j.spec
                    .files
                    .iter()
                    .map(|f| f.path.clone())
                    .chain(j.spec.texts.iter().map(|t| t.path.clone()))
                    .filter_map(move |p| place(&folder, &p).ok())
                    .collect::<Vec<_>>()
            })
            .collect();
        let paths = job
            .spec
            .files
            .iter()
            .map(|f| &f.path)
            .chain(job.spec.texts.iter().map(|t| &t.path))
            .filter_map(|p| place(&job.folder, p).ok());
        for path in paths {
            if others.contains(&path) {
                continue;
            }
            let _ = fs::remove_file(&path);
            let _ = fs::remove_file(part_of(&path));
            if job.spec.files.iter().any(|f| f.kind == FileKind::Vault) { let _ = fs::remove_file(vault_checkpoint_path(&path)); }
            // Empty folders up to the downloads folder go too.
            let mut dir = path.parent();
            while let Some(d) = dir {
                if d == job.folder || fs::remove_dir(d).is_err() {
                    break;
                }
                dir = d.parent();
            }
        }
        log::info!("download files deleted id={}", job.spec.id);
    }
}

fn check(spec: &DownloadJob) -> Result<(), String> {
    let id_ok = !spec.id.is_empty()
        && spec.id.len() <= 64
        && spec
            .id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !id_ok {
        return Err("bad id".into());
    }
    if spec.files.iter().any(|f| f.kind == FileKind::Vault) {
        if spec.files.len() != 1 || !spec.texts.is_empty() || !spec.id.starts_with("vault-") {
            return Err("invalid Vault job".into());
        }
        let file = &spec.files[0];
        let url = url::Url::parse(&file.url).map_err(|_| "invalid Vault URL")?;
        let music = music_resolver::is_target(&file.url);
        if url.scheme() != "https" || url.host_str().is_none() || !url.username().is_empty()
            || url.password().is_some() || (!music && url.query().is_some()) || url.fragment().is_some()
            || !file.headers.is_empty() {
            return Err("Vault requires a public direct HTTPS file URL without credentials or query parameters".into());
        }
        let path = place(Path::new("."), &file.path)?;
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
        let expected = Path::new("Vault").join(&spec.id);
        if !VAULT_EXTENSIONS.contains(&ext.as_str()) || (music && ext != "m4a") || Path::new(&file.path).parent() != Some(expected.as_path())
            || path.file_name().and_then(|n| n.to_str()) != Some(spec.title.as_str()) {
            return Err("invalid Vault file path".into());
        }
        return Ok(());
    }
    for file in &spec.files {
        if !file.url.starts_with("http://") && !file.url.starts_with("https://") {
            return Err("only http(s) addresses".into());
        }
        for (name, value) in &file.headers {
            if !is_header_name(name) || !is_header_value(value) {
                return Err(format!("header {name} is not allowed"));
            }
        }
        let path = place(Path::new("."), &file.path)?;
        if !legacy_extension(&path) { return Err("invalid video download file type".into()); }
    }
    for text in &spec.texts {
        let path = place(Path::new("."), &text.path)?;
        if !legacy_extension(&path) { return Err("invalid video download details file type".into()); }
    }
    Ok(())
}

/// Inside `folder`, a known media, subtitle, image or details file, or nothing.
fn place(folder: &Path, relative: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    let mut out = folder.to_path_buf();
    let mut parts = 0;
    for component in path.components() {
        let Component::Normal(part) = component else {
            return Err(format!("{relative} is not a relative path"));
        };
        let part = part.to_str().ok_or("not unicode")?;
        let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
        let bad = part.is_empty()
            || part.len() > 200
            || part.ends_with(['.', ' '])
            || part
                .chars()
                .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
            || RESERVED.contains(&stem.as_str());
        if bad {
            return Err(format!("{part} is not a usable name"));
        }
        out.push(part);
        parts += 1;
    }
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if parts == 0 || !(EXTENSIONS.contains(&extension.as_str()) || VAULT_EXTENSIONS.contains(&extension.as_str())) {
        return Err(format!("{relative} is not a media file"));
    }
    Ok(out)
}

fn legacy_extension(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|ext| EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
}

fn part_of(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".part");
    path.with_file_name(name)
}

fn work(
    spec: DownloadJob,
    folder: PathBuf,
    agent: ureq::Agent,
    stop: Arc<AtomicBool>,
    events: Sender<Event>,
    vault_rate_mib: u32,
) {
    let result = (|| {
        for text in &spec.texts {
            let path = place(&folder, &text.path).map_err(Failure::Error)?;
            if !path.exists() {
                write_text(&path, &text.text).map_err(Failure::Error)?;
            }
        }
        // Subtitles and art first, so they are there while the video comes.
        let mut files: Vec<_> = spec.files.iter().collect();
        files.sort_by_key(|f| f.kind == FileKind::Video);
        for file in files {
            let path = place(&folder, &file.path).map_err(Failure::Error)?;
            let report = |bytes, total| {
                if matches!(file.kind, FileKind::Video | FileKind::Vault) {
                    let _ = events.send(Event::Progress {
                        id: spec.id.clone(),
                        bytes,
                        total,
                    });
                }
            };
            let result = if file.kind == FileKind::Vault && music_resolver::is_target(&file.url) {
                fetch_vault_music(&file.url, &path, &stop, report)
            } else if file.kind == FileKind::Vault {
                fetch_vault(&agent, &file.url, &path, &stop, report, vault_rate_mib)
            } else {
                fetch(&agent, &file.url, &file.headers, &path, &stop, report)
            };
            match result {
                // Art or a subtitle missing never costs the video.
                Err(Failure::Error(e)) if matches!(file.kind, FileKind::Subtitle | FileKind::Image) => {
                    log::warn!("download {}: skipped {}: {e}", spec.id, file.path)
                }
                result => result?,
            }
        }
        Ok(())
    })();
    let _ = events.send(Event::Finished {
        id: spec.id,
        result,
    });
}

fn write_text(path: &Path, text: &str) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(path, text).map_err(|e| e.to_string())
}

/// `bytes a-b/total`, or the length of a whole answer.
fn total_of(response: &ureq::http::Response<ureq::Body>, offset: u64) -> Option<u64> {
    let header = |name| response.headers().get(name)?.to_str().ok();
    if let Some(range) = header("content-range") {
        return range.rsplit('/').next()?.parse().ok();
    }
    header("content-length")?
        .parse::<u64>()
        .ok()
        .map(|n| n + offset)
}

/// With headers, follows redirects itself, as ureq drops `Authorization` and `Cookie` on the way.
fn get(
    agent: &ureq::Agent,
    url: &str,
    headers: &BTreeMap<String, String>,
    from: u64,
) -> Result<ureq::http::Response<ureq::Body>, ureq::Error> {
    let mut address = url.to_string();
    for _ in 0..=MAX_REDIRECTS {
        let mut request = agent.get(&address);
        if from > 0 {
            request = request.header("Range", format!("bytes={from}-"));
        }
        if headers.is_empty() {
            return request.call();
        }
        for (name, value) in headers {
            request = request.header(name, value);
        }
        let response = request.config().max_redirects(0).build().call()?;
        let location = response.headers().get("location");
        let Some(location) = location.filter(|_| response.status().is_redirection()) else {
            return Ok(response);
        };
        let next = location
            .to_str()
            .ok()
            .and_then(|l| url::Url::parse(&address).ok()?.join(l).ok())
            .ok_or_else(|| ureq::Error::BadUri(format!("{location:?}")))?;
        address = next.into();
    }
    Err(ureq::Error::TooManyRedirects)
}

fn fetch(
    agent: &ureq::Agent,
    url: &str,
    headers: &BTreeMap<String, String>,
    path: &Path,
    stop: &AtomicBool,
    report: impl Fn(u64, Option<u64>),
) -> Result<(), Failure> {
    if let Ok(meta) = fs::metadata(path) {
        report(meta.len(), Some(meta.len()));
        return Ok(());
    }
    let fail = |e: std::io::Error| Failure::Error(e.to_string());
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(fail)?;
    }
    let part = part_of(path);
    // Later ranges go to where the first request was sent on to; an address
    // that has since expired is asked for again through `url`.
    let mut address = url.to_string();
    let mut failures = 0;
    let mut total = None;
    loop {
        if stop.load(Ordering::Relaxed) {
            return Err(Failure::Stopped);
        }
        let mut have = fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
        if total.is_some_and(|t| have >= t) {
            return fs::rename(&part, path).map_err(fail);
        }
        let error = match get(agent, &address, headers, have) {
            Ok(response) => {
                if response.status() == 200 && have > 0 {
                    have = 0;
                }
                total = total_of(&response, have).or(total);
                address = response.get_uri().to_string();
                let mut file = OpenOptions::new()
                    .create(true)
                    .write(true)
                    .append(have > 0)
                    .truncate(have == 0)
                    .open(&part)
                    .map_err(fail)?;
                let mut reader = response.into_body().into_reader();
                let mut buffer = vec![0u8; 256 * 1024];
                let mut written = 0u64;
                let ended = loop {
                    if stop.load(Ordering::Relaxed) {
                        return Err(Failure::Stopped);
                    }
                    match reader.read(&mut buffer) {
                        Ok(0) => break None,
                        Ok(n) => {
                            file.write_all(&buffer[..n]).map_err(fail)?;
                            written += n as u64;
                            report(have + written, total);
                        }
                        Err(e) => break Some(e.to_string()),
                    }
                };
                file.flush().map_err(fail)?;
                let complete = match total {
                    Some(t) => have + written >= t,
                    None => ended.is_none(),
                };
                if complete {
                    return fs::rename(&part, path).map_err(fail);
                }
                if written > 0 {
                    failures = 0;
                    continue;
                }
                ended.unwrap_or_else(|| "the answer ended early".into())
            }
            Err(ureq::Error::StatusCode(416)) if have > 0 => {
                return fs::rename(&part, path).map_err(fail);
            }
            Err(ureq::Error::StatusCode(code @ (401 | 403 | 404 | 410))) if address != url => {
                log::info!("download address expired ({code}), asking again");
                address = url.to_string();
                continue;
            }
            Err(ureq::Error::StatusCode(code)) if code < 500 && code != 429 => {
                return Err(Failure::Error(format!("The server answered {code}")));
            }
            Err(e) => e.to_string(),
        };
        let Some(wait) = RETRY_SECONDS.get(failures) else {
            return Err(Failure::Error(error));
        };
        failures += 1;
        log::info!("download retry in {wait}s: {error}");
        let until = Instant::now() + Duration::from_secs(*wait);
        while Instant::now() < until {
            if stop.load(Ordering::Relaxed) {
                return Err(Failure::Stopped);
            }
            thread::sleep(Duration::from_millis(200));
        }
    }
}

fn vault_mime_allowed(ext: &str, content_type: &str) -> bool {
    let mime = content_type.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    mime == "application/octet-stream" || match ext {
        "pdf" => mime == "application/pdf",
        "epub" => mime == "application/epub+zip",
        "mp3" => matches!(mime.as_str(), "audio/mpeg" | "audio/mp3"),
        "flac" => matches!(mime.as_str(), "audio/flac" | "audio/x-flac"),
        "m4a" => matches!(mime.as_str(), "audio/mp4" | "audio/x-m4a"),
        "wav" => matches!(mime.as_str(), "audio/wav" | "audio/x-wav" | "audio/wave"),
        "ogg" => matches!(mime.as_str(), "audio/ogg" | "application/ogg"),
        "opus" => matches!(mime.as_str(), "audio/ogg" | "audio/opus"),
        "aac" => mime == "audio/aac",
        _ => false,
    }
}

// Vault transfers are intentionally stricter than the legacy video downloader.
// Resume restarts an incomplete transfer, avoiding unsafe byte-range stitching
// when a public source changes its contents between requests.
// Uses the same bounded yt-dlp transport as playback, but asks for M4A only.
// All file IO stays in the persistent Vault worker; no player state changes.
fn fetch_vault_music(
    url: &str, path: &Path, stop: &AtomicBool,
    report: impl Fn(u64, Option<u64>),
) -> Result<(), Failure> {
    let error = |message: &str| Failure::Error(message.to_owned());
    if stop.load(Ordering::Relaxed) { return Err(Failure::Stopped); }
    if path.exists() { return Err(error("A file already exists at the Vault destination")); }
    report(0, None);
    let mut transfer = music_resolver::Transfer::start_export(url).map_err(error)?;
    let mut reported = 0;
    let bytes = loop {
        if stop.load(Ordering::Relaxed) { return Err(Failure::Stopped); }
        if let Some(bytes) = transfer.poll().map_err(error)? { break bytes; }
        let received = transfer.received_bytes();
        if received != reported { report(received, None); reported = received; }
        thread::sleep(Duration::from_millis(100));
    };
    // ISO BMFF file signature; never label a WebM or an error response M4A.
    if bytes.get(4..8) != Some(&b"ftyp"[..]) || bytes.len() < 16 {
        return Err(error("YouTube did not return a supported M4A file"));
    }
    let parent = path.parent().ok_or_else(|| error("Invalid Vault destination"))?;
    fs::create_dir_all(parent).map_err(|_| error("Could not create Vault folder"))?;
    let part = part_of(path);
    let result = (|| {
        let mut file = OpenOptions::new().create(true).truncate(true).write(true).open(&part)
            .map_err(|_| error("Could not open Vault temporary file"))?;
        for chunk in bytes.chunks(128 * 1024) {
            if stop.load(Ordering::Relaxed) { return Err(Failure::Stopped); }
            file.write_all(chunk).map_err(|_| error("Could not write Vault music file"))?;
        }
        file.sync_all().map_err(|_| error("Could not finish Vault music file"))?;
        drop(file);
        if stop.load(Ordering::Relaxed) { return Err(Failure::Stopped); }
        if path.exists() { return Err(error("A file already exists at the Vault destination")); }
        fs::rename(&part, path).map_err(|_| error("Could not finalize Vault music file"))?;
        report(bytes.len() as u64, Some(bytes.len() as u64));
        Ok(())
    })();
    if result.is_err() { let _ = fs::remove_file(&part); }
    result
}

#[derive(Serialize, Deserialize)]
struct VaultCheckpoint {
    url: String,
    etag: String,
    total: u64,
}

fn vault_checkpoint_path(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".part.resume.json");
    path.with_file_name(name)
}

fn strong_etag(value: &str) -> bool {
    value.len() >= 2 && value.len() <= 512 && value.starts_with('"') &&
        value.ends_with('"') && value.as_bytes()[1..value.len()-1].iter()
            .all(|&b| b == 0x21 || (0x23..=0x7e).contains(&b))
}

fn read_vault_checkpoint(path: &Path, url: &str) -> Option<(VaultCheckpoint, u64)> {
    let meta = fs::symlink_metadata(vault_checkpoint_path(path)).ok()?;
    if !meta.file_type().is_file() || meta.len() > 16 * 1024 { return None; }
    let checkpoint: VaultCheckpoint = serde_json::from_slice(&fs::read(vault_checkpoint_path(path)).ok()?).ok()?;
    let partial = fs::symlink_metadata(part_of(path)).ok()?;
    let bytes = partial.len();
    if !partial.file_type().is_file() || checkpoint.url != url || !strong_etag(&checkpoint.etag) ||
        checkpoint.total > VAULT_LIMIT || bytes == 0 || bytes >= checkpoint.total { return None; }
    Some((checkpoint, bytes))
}

fn discard_vault_partial(path: &Path) {
    let _ = fs::remove_file(vault_checkpoint_path(path));
    let _ = fs::remove_file(part_of(path));
}

// Pace each chunk against time actually spent receiving it. Waiting checks the
// queue's cancellation flag frequently; no credit accumulates after a stall.
fn pace_vault_chunk(started: Instant, bytes: usize, rate_mib: u32, stop: &AtomicBool) -> Result<(), Failure> {
    if rate_mib == 0 { return Ok(()); }
    let expected = Duration::from_secs_f64(bytes as f64 / (u64::from(rate_mib) * MIB) as f64);
    while let Some(left) = expected.checked_sub(started.elapsed()) {
        if stop.load(Ordering::Relaxed) { return Err(Failure::Stopped); }
        if left.is_zero() { break; }
        thread::sleep(left.min(Duration::from_millis(25)));
    }
    if stop.load(Ordering::Relaxed) { return Err(Failure::Stopped); }
    Ok(())
}

fn fetch_vault(
    agent: &ureq::Agent,
    url: &str,
    path: &Path,
    stop: &AtomicBool,
    report: impl Fn(u64, Option<u64>),
    rate_mib: u32,
) -> Result<(), Failure> {
    let error = |message: &str| Failure::Error(message.to_owned());
    if stop.load(Ordering::Relaxed) { return Err(Failure::Stopped); }
    if path.exists() { return Err(error("A file already exists at the Vault destination")); }
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    let parent = path.parent().ok_or_else(|| error("Invalid Vault destination"))?;
    fs::create_dir_all(parent).map_err(|_| error("Could not create Vault folder"))?;
    let part = part_of(path);
    let checkpoint_path = vault_checkpoint_path(path);
    // Reject nonregular staging paths rather than following symlinks or devices.
    for candidate in [&part, &checkpoint_path] {
        if fs::symlink_metadata(candidate).is_ok_and(|m| !m.file_type().is_file()) {
            return Err(error("Invalid Vault temporary file"));
        }
    }
    let resume = read_vault_checkpoint(path, url);
    if resume.is_none() { discard_vault_partial(path); }
    let mut request = agent.get(url).header("Accept-Encoding", "identity");
    if let Some((saved, offset)) = &resume {
        request = request.header("Range", format!("bytes={offset}-")).header("If-Range", &saved.etag);
    }
    // ureq 3.4 measures the whole request, including deliberate pacing. Give
    // capped jobs the extra bounded time needed to receive the largest file.
    // Unlimited jobs retain the previous timeout.
    let mut config = request.config().max_redirects(0);
    if rate_mib != 0 {
        let pacing_budget = Duration::from_secs(VAULT_LIMIT.div_ceil(u64::from(rate_mib) * MIB));
        config = config.timeout_global(Some(REQUEST_LIMIT + pacing_budget))
            .timeout_recv_response(Some(Duration::from_secs(20)));
    }
    let response = match config.build().call() {
        Ok(response) => response,
        Err(ureq::Error::StatusCode(416)) if resume.is_some() => {
            discard_vault_partial(path);
            return Err(error("Vault resume range was rejected; retry to restart the file"));
        },
        Err(_) => return Err(error("Vault file request failed")),
    };
    let header = |name: &str| response.headers().get(name).and_then(|v| v.to_str().ok());
    if !vault_mime_allowed(&ext, header("content-type").unwrap_or("")) {
        discard_vault_partial(path);
        return Err(error("Unexpected Vault file type"));
    }
    if header("content-encoding").is_some_and(|v| !v.eq_ignore_ascii_case("identity")) {
        discard_vault_partial(path);
        return Err(error("Compressed transfer encoding is not supported in Vault"));
    }
    let (offset, total, etag) = if response.status() == 206 {
        let valid = resume.as_ref().filter(|(saved, offset)| {
            let expected = format!("bytes {}-{}/{}", offset, saved.total - 1, saved.total);
            header("content-range") == Some(expected.as_str()) &&
                header("etag") == Some(saved.etag.as_str()) &&
                header("content-length").is_none_or(|length| length.parse::<u64>().ok() == Some(saved.total - offset))
        });
        let Some((saved, offset)) = valid else {
            discard_vault_partial(path);
            return Err(error("Vault resume response did not match the saved file; retry to restart"));
        };
        (*offset, Some(saved.total), Some(saved.etag.clone()))
    } else if response.status() == 200 && header("content-range").is_none() {
        // Server ignored Range or representation changed: safely restart at zero.
        discard_vault_partial(path);
        let total = header("content-length").and_then(|value| value.parse::<u64>().ok());
        let etag = header("etag").filter(|value| strong_etag(value)).map(str::to_owned);
        (0, total, etag)
    } else {
        discard_vault_partial(path);
        return Err(error("Vault requires a direct file response without redirects"));
    };
    if total.is_some_and(|size| size == 0 || size > VAULT_LIMIT) {
        discard_vault_partial(path);
        return Err(error("Vault file exceeds its size limit or is empty"));
    }
    let mut resumable = offset > 0;
    let mut discard = false;
    let result = (|| {
        let mut file = OpenOptions::new().create(true).write(true).append(offset > 0).truncate(offset == 0).open(&part)
            .map_err(|_| error("Could not open Vault temporary file"))?;
        if offset == 0 {
            if let (Some(total), Some(etag)) = (total, etag) {
                let checkpoint = VaultCheckpoint { url: url.to_owned(), etag, total };
                if let Ok(bytes) = serde_json::to_vec(&checkpoint) {
                    // Written before any body bytes; corrupt/incomplete metadata
                    // after a crash is treated as non-resumable.
                    resumable = fs::write(&checkpoint_path, bytes).is_ok();
                }
            }
        }
        let mut reader = response.into_body().into_reader();
        let mut buffer = vec![0u8; 128 * 1024];
        let mut bytes = offset;
        report(bytes, total);
        loop {
            if stop.load(Ordering::Relaxed) { return Err(Failure::Stopped); }
            let started = Instant::now();
            let n = reader.read(&mut buffer).map_err(|_| error("Vault transfer was interrupted"))?;
            if n == 0 { break; }
            bytes += n as u64;
            if bytes > VAULT_LIMIT || total.is_some_and(|size| bytes > size) {
                discard = true;
                return Err(error("Vault transfer exceeded the expected size"));
            }
            pace_vault_chunk(started, n, rate_mib, stop)?;
            file.write_all(&buffer[..n]).map_err(|_| error("Could not write Vault file"))?;
            report(bytes, total);
        }
        if stop.load(Ordering::Relaxed) { return Err(Failure::Stopped); }
        if bytes == 0 || total.is_some_and(|size| size != bytes) { return Err(error("Vault transfer was incomplete")); }
        file.sync_all().map_err(|_| error("Could not finish Vault file"))?;
        drop(file);
        if path.exists() { discard = true; return Err(error("A file already exists at the Vault destination")); }
        fs::rename(&part, path).map_err(|_| error("Could not finalize Vault file"))?;
        let _ = fs::remove_file(&checkpoint_path);
        Ok(())
    })();
    if result.is_err() && (!resumable || discard || read_vault_checkpoint(path, url).is_none()) {
        discard_vault_partial(path);
    }
    result
}

#[cfg(test)]
mod vault_tests {
    use super::*;
    use crate::bridge::DownloadFile;
    fn spec(url: &str, path: &str) -> DownloadJob {
        DownloadJob {
            id: "vault-test".into(), title: "book.epub".into(),
            files: vec![DownloadFile { url: url.into(), path: path.into(), kind: FileKind::Vault, headers: BTreeMap::new() }],
            texts: vec![],
        }
    }
    #[test]
    fn restricts_vault_jobs_to_public_direct_urls_and_unique_folders() {
        let good = "https://example.org/book.epub";
        let path = "Vault/vault-test/book.epub";
        assert!(check(&spec(good, path)).is_ok());
        for bad in ["http://example.org/book.epub", "https://example.org/book.epub?token=secret", "https://user:secret@example.org/book.epub"] {
            assert!(check(&spec(bad, path)).is_err());
        }
        for bad in ["Vault/vault-other/book.epub", "../book.epub", "Vault/vault-test/book.exe"] {
            assert!(check(&spec(good, bad)).is_err());
        }
        let mut legacy = spec(good, path);
        legacy.files[0].kind = FileKind::Video;
        assert!(check(&legacy).is_err());
    }
    #[test]
    fn accepts_only_exact_youtube_targets_with_m4a_paths() {
        let mut music = spec("https://www.youtube.com/watch?v=abcdefghijk", "Vault/vault-test/abcdefghijk.m4a");
        music.title = "abcdefghijk.m4a".into();
        assert!(check(&music).is_ok());
        music.files[0].url.push_str("&list=other");
        assert!(check(&music).is_err());
        music.files[0].url = "https://www.youtube.com/watch?v=abcdefghijk".into();
        music.files[0].path = "Vault/vault-test/book.epub".into();
        music.title = "book.epub".into();
        assert!(check(&music).is_err());
    }
    #[test]
    fn completed_vault_file_access_rejects_other_jobs_and_paths() {
        let dir = std::env::temp_dir().join(format!(
            "tsugi-vault-import-{}-{}", std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("fixture.pdf");
        fs::write(&path, b"%PDF-fixture").unwrap();
        let (events, _receiver) = mpsc::channel();
        let mut jobs = HashMap::new();
        jobs.insert("vault-done".into(), Placed { done: true, vault: Some(path.clone()), ..Default::default() });
        jobs.insert("vault-pending".into(), Placed { done: false, vault: Some(path.clone()), ..Default::default() });
        jobs.insert("video-done".into(), Placed { done: true, video: Some(path.clone()), ..Default::default() });
        let downloads = Downloads { events, shared: Arc::new(Mutex::new(Shared { folder: dir.clone(), jobs })) };
        assert_eq!(downloads.vault_file("vault-done"), Some(("application/pdf", b"%PDF-fixture".to_vec())));
        for id in ["vault-pending", "video-done", "vault-unknown", "vault-../fixture.pdf"] {
            assert!(downloads.vault_file(id).is_none());
        }
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn native_queue_runs_two_transfers_and_waits_for_a_free_slot() {
        let dir = std::env::temp_dir().join(format!("tsugi-vault-concurrent-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&dir).unwrap();
        let (events, received) = mpsc::channel();
        let (arrived, arrivals) = mpsc::channel();
        let mut servers = Vec::new();
        let mut releases = Vec::new();
        let mut jobs = Vec::new();
        let payload = b"%PDF-1.4\nTsugi concurrent fixture\n%%EOF\n".to_vec();
        for index in 0..3 {
            let (release, wait) = mpsc::channel();
            releases.push(release);
            let arrived = arrived.clone();
            let (url, server) = crate::test_http::response_after(200, "application/pdf", payload.clone(), move || {
                arrived.send(index).unwrap();
                wait.recv_timeout(Duration::from_secs(8)).unwrap();
            });
            servers.push(server);
            let id = format!("vault-concurrent-{index}");
            let mut spec = spec(&url, &format!("Vault/{id}/book.pdf"));
            spec.id = id;
            spec.title = "book.pdf".into();
            // Loopback HTTP is test-only; production Command::Add still applies
            // the existing HTTPS-only admission checks.
            jobs.push(Job { spec, folder: dir.clone(), state: State::Queued, bytes: 0, total: None, error: None });
        }
        let mut queue = Queue {
            folder: dir.clone(), concurrent: 2, vault_rate_mib: 0, jobs, running: HashMap::new(),
            removing: HashMap::new(), speeds: HashMap::new(), events,
            emit: Box::new(|_| {}), state_file: dir.join("queue.json"),
            shared: Arc::new(Mutex::new(Shared::default())), agent: agent(),
        };
        queue.changed();
        let mut first = vec![arrivals.recv_timeout(Duration::from_secs(5)).unwrap(), arrivals.recv_timeout(Duration::from_secs(5)).unwrap()];
        first.sort_unstable();
        assert_eq!(first, vec![0, 1], "both initial requests must reach their servers before either is released");
        assert_eq!(queue.running.len(), 2);
        assert_eq!(queue.jobs[2].state, State::Queued);
        assert!(arrivals.recv_timeout(Duration::from_millis(200)).is_err());
        releases[0].send(()).unwrap();
        let finish = |queue: &mut Queue| {
            loop {
                match received.recv_timeout(Duration::from_secs(5)).unwrap() {
                    Event::Progress { id, bytes, total } => {
                        let job = queue.jobs.iter_mut().find(|job| job.spec.id == id).unwrap();
                        job.bytes = bytes; job.total = total;
                    }
                    Event::Finished { id, result } => {
                        assert!(result.is_ok(), "fixture transfer failed: {id}");
                        queue.finished(&id, result);
                        return id;
                    }
                    Event::Command(_) => panic!("unexpected command"),
                }
            }
        };
        assert_eq!(finish(&mut queue), "vault-concurrent-0");
        assert_eq!(arrivals.recv_timeout(Duration::from_secs(5)).unwrap(), 2);
        releases[1].send(()).unwrap();
        releases[2].send(()).unwrap();
        finish(&mut queue);
        finish(&mut queue);
        assert!(queue.running.is_empty());
        let saved: Saved = serde_json::from_slice(&fs::read(&queue.state_file).unwrap()).unwrap();
        assert_eq!(saved.concurrent, Some(2));
        assert!(saved.jobs.iter().all(|job| job.state == State::Done));
        for index in 0..3 {
            let file = dir.join(format!("Vault/vault-concurrent-{index}/book.pdf"));
            assert_eq!(fs::read(&file).unwrap(), payload);
            assert!(!part_of(&file).exists());
        }
        for server in servers { server.join().unwrap(); }
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn native_vault_resume_validates_range_and_representation() {
        let dir = std::env::temp_dir().join(format!("tsugi-vault-resume-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&dir).unwrap();
        let stop = AtomicBool::new(false);
        let payload = b"%PDF-1.4\nTsugi original fixture\n%%EOF\n";
        let offset = 10;
        let etag = "\"fixture-v1\"";
        for (status, headers, body, success) in [
            (206, format!("ETag: {etag}\r\nContent-Range: bytes {offset}-{}/{}\r\n",payload.len()-1,payload.len()), payload[offset..].to_vec(), true),
            (206, format!("ETag: \"changed\"\r\nContent-Range: bytes {offset}-{}/{}\r\n",payload.len()-1,payload.len()), payload[offset..].to_vec(), false),
            (200, "ETag: \"new\"\r\n".into(), payload.to_vec(), true),
        ] {
            let path = dir.join("fixture.pdf");
            let (url, server) = crate::test_http::response_with_headers(status,"application/pdf",body,headers,||{});
            fs::write(part_of(&path),&payload[..offset]).unwrap();
            fs::write(vault_checkpoint_path(&path),serde_json::to_vec(&VaultCheckpoint {url:url.clone(),etag:etag.into(),total:payload.len() as u64}).unwrap()).unwrap();
            assert_eq!(fetch_vault(&agent(),&url,&path,&stop,|_,_|{},0).is_ok(),success);
            let sent = server.join().unwrap().to_ascii_lowercase();
            assert!(sent.contains("range: bytes=10-"));
            assert!(sent.contains("if-range: \"fixture-v1\""));
            assert_eq!(path.exists(),success);
            if success { assert_eq!(fs::read(&path).unwrap(),payload); fs::remove_file(&path).unwrap(); }
            assert!(!part_of(&path).exists());
            assert!(!vault_checkpoint_path(&path).exists());
        }
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn native_vault_pause_keeps_only_validated_partial_bytes() {
        let dir = std::env::temp_dir().join(format!("tsugi-vault-pause-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("fixture.pdf");
        let payload = vec![b'X';512*1024];
        let (url, server) = crate::test_http::response_with_headers(200,"application/pdf",payload.clone(),"ETag: \"pause-v1\"\r\n".into(),||{});
        let stop = AtomicBool::new(false);
        assert!(matches!(fetch_vault(&agent(),&url,&path,&stop,|bytes,_|{if bytes>0 {stop.store(true,Ordering::Relaxed);}},0),Err(Failure::Stopped)));
        let (_, offset) = read_vault_checkpoint(&path,&url).unwrap();
        assert!(offset>0 && offset<payload.len() as u64);
        assert_eq!(fs::read(part_of(&path)).unwrap(),payload[..offset as usize]);
        assert!(!path.exists());
        // The sender can observe a closed socket after the intentional pause.
        let _ = server.join();
        discard_vault_partial(&path);
        assert!(!part_of(&path).exists()&&!vault_checkpoint_path(&path).exists());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn native_direct_transfer_writes_real_bytes_and_rejects_html() {
        let dir = std::env::temp_dir().join(format!("tsugi-vault-http-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("fixture.pdf");
        let bytes = b"%PDF-1.4\nTsugi original transfer fixture\n%%EOF\n".to_vec();
        let (url, server) = crate::test_http::response(200, "application/pdf", bytes.clone());
        let stop = AtomicBool::new(false);
        let transferred = std::cell::Cell::new(0);
        assert!(fetch_vault(&agent(),&url,&path,&stop,|n,_|transferred.set(n),0).is_ok());
        assert_eq!(fs::read(&path).unwrap(),bytes);
        assert_eq!(transferred.get(),bytes.len() as u64);
        assert!(!part_of(&path).exists());
        server.join().unwrap();
        let bad = dir.join("bad.pdf");
        let (url, server) = crate::test_http::response(200,"text/html",b"<html>not a book</html>".to_vec());
        assert!(fetch_vault(&agent(),&url,&bad,&stop,|_,_|{},0).is_err());
        assert!(!bad.exists()&&!part_of(&bad).exists());
        server.join().unwrap();
        fs::remove_dir_all(dir).unwrap();
    }
    #[cfg(windows)]
    #[test]
    #[ignore = "Requires real YouTube access and pinned music-tools next to the test executable"]
    fn live_youtube_export_writes_m4a() {
        // Big Buck Bunny (c) 2008 Blender Foundation, CC BY 3.0.
        // https://peach.blender.org/about/ -- original public licensed test fixture.
        let dir = std::env::temp_dir().join(format!("tsugi-live-music-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("big-buck-bunny.m4a");
        let stop = AtomicBool::new(false);
        let result = fetch_vault_music("https://www.youtube.com/watch?v=YE7VzlLtp-4",&path,&stop,|_,_|{});
        let checked = match result {
            Ok(()) => {
                let data = fs::read(&path).unwrap();
                assert!(data.len()>1024);
                assert_eq!(data.get(4..8),Some(&b"ftyp"[..]));
                assert!(!part_of(&path).exists());
                println!("Live M4A export wrote {} bytes", data.len());
                Ok(())
            },
            Err(Failure::Error(e)) => Err(e),
            Err(Failure::Stopped) => Err("Unexpected cancellation".into()),
        };
        fs::remove_dir_all(dir).unwrap();
        checked.unwrap();
    }
    #[test]
    fn native_direct_transfer_obeys_rate_and_preserves_bytes() {
        let dir = std::env::temp_dir().join(format!("tsugi-vault-rate-{}-{}", std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("rate.pdf");
        let payload = vec![42u8; 512 * 1024];
        let (url, server) = crate::test_http::response(200, "application/pdf", payload.clone());
        let started = Instant::now();
        assert!(fetch_vault(&agent(), &url, &path, &AtomicBool::new(false), |_,_|{}, 1).is_ok());
        assert!(started.elapsed() >= Duration::from_millis(480), "rate cap did not pace the actual transfer");
        assert_eq!(fs::read(&path).unwrap(), payload);
        server.join().unwrap();
        let saved: Saved = serde_json::from_str(r#"{"jobs":[]}"#).unwrap();
        assert_eq!(saved.vault_rate_mib, 0);
        assert_eq!(vault_rate(3), 0);
        let stopped = AtomicBool::new(true);
        assert!(matches!(pace_vault_chunk(Instant::now(), 1024, 1, &stopped), Err(Failure::Stopped)));
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn validates_vault_mime_types() {
        assert!(vault_mime_allowed("epub", "application/epub+zip"));
        assert!(vault_mime_allowed("mp3", "audio/mpeg; charset=binary"));
        assert!(!vault_mime_allowed("pdf", "text/html"));
    }
}
