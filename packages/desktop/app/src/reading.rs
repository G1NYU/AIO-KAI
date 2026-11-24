//! Windows-only, lazy reader worker. All runtime access is serialized off the UI
//! thread. Credentials, page routes and the Java process remain native-owned.
use std::path::{Path, PathBuf};
use std::fs;
use std::process::{Command, Stdio};
use std::os::windows::process::CommandExt;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
    mpsc::{self, RecvTimeoutError, SyncSender, TrySendError},
};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use aiostreams_desktop_core::bridge::{Outbound, ReadAction};
use aiostreams_desktop_core::read_runtime::{CatalogueMode, ChapterPages, ReadJob, ReadOperation, ReadRuntime};
use serde_json::{Value, json};

use crate::Args;

fn bundled_directory(args: &Args, web: Option<&Path>) -> Option<PathBuf> {
    if args.web.is_some() || args.web_dir.is_some() || args.devtools || args.debug_port.is_some()
        || std::env::var_os("AIOSTREAMS_WEB_DIR").is_some()
    {
        return None;
    }
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let bundled_web = dir.join("web");
    if !bundled_web.join("index.html").is_file()
        || web?.canonicalize().ok()? != bundled_web.canonicalize().ok()?
    {
        return None;
    }
    Some(dir.to_path_buf())
}

fn runtime_ready(runtime: &Path) -> bool {
    ["jre/bin/java.exe", "bin/Suwayomi-Server.jar", "launcher/TsugiReadLauncher.class"]
        .iter().all(|path| runtime.join(path).is_file())
}

fn setup_assets(dir: &Path) -> bool {
    ["read-launcher/fetch-read-tools.ps1", "read-launcher/TsugiReadLauncher.class"]
        .iter().all(|path| dir.join(path).is_file())
}

/// A packaged Read destination remains visible even before Java is prepared.
pub fn bundled_read_section(args: &Args, web: Option<&Path>) -> bool {
    bundled_runtime_path(args, web).is_some()
}

pub fn bundled_runtime_path(args: &Args, web: Option<&Path>) -> Option<PathBuf> {
    let dir = bundled_directory(args, web)?;
    let runtime = dir.join("read-tools");
    (runtime_ready(&runtime) || setup_assets(&dir)).then_some(runtime)
}

pub fn bundled_runtime(args: &Args, web: Option<&Path>) -> Option<PathBuf> {
    bundled_runtime_path(args, web).filter(|path| runtime_ready(path))
}

/// Prepare only the pinned runtime bundled with the trusted local desktop
/// package. The fixed setup script is an internal implementation detail:
/// never execute user-supplied scripts, download URLs, or shell arguments.
pub fn prepare_runtime(runtime: &Path, stopped: &AtomicBool) -> Result<(), &'static str> {
    if runtime_ready(runtime) { return Ok(()); }
    if stopped.load(Ordering::Acquire) { return Err("Reading setup cancelled."); }
    if runtime.exists() {
        return Err("Reading runtime folder is incomplete. Keep your data and reinstall the application in a fresh folder.");
    }
    let dir = runtime.parent().ok_or("Reading runtime location is missing.")?;
    if !setup_assets(dir) { return Err("Reading setup files are missing."); }
    let system = PathBuf::from(std::env::var_os("SystemRoot").ok_or("Windows system directory is unavailable.")?);
    let powershell_dir = system.join("System32/WindowsPowerShell/v1.0");
    let powershell = powershell_dir.join("powershell.exe");
    if !powershell.is_file() { return Err("Windows reading setup component is unavailable."); }
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "Could not create reading setup directory.")?.as_nanos();
    let stage = dir.join(format!("read-tools-setup-{}-{stamp}", std::process::id()));
    fs::create_dir(&stage).map_err(|_| "Could not create reading setup directory. Use a writable installation folder.")?;
    let result = (|| {
        let job = ReadJob::new()?;
        let mut child = Command::new(powershell)
            .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
            .arg(dir.join("read-launcher/fetch-read-tools.ps1"))
            .arg("-Destination").arg(&stage)
            .env("PSModulePath", powershell_dir.join("Modules"))
            .current_dir(dir)
            .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn().map_err(|_| "Could not start reading setup.")?;
        if let Err(error) = job.attach(&child) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
        let deadline = Instant::now() + Duration::from_secs(18 * 60);
        let status = loop {
            if stopped.load(Ordering::Acquire) || Instant::now() >= deadline {
                drop(job);
                let _ = child.kill();
                let _ = child.wait();
                return Err("Reading setup was cancelled or timed out.");
            }
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) => thread::sleep(Duration::from_millis(100)),
                Err(_) => {
                    drop(job);
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err("Could not monitor reading setup.");
                }
            }
        };
        drop(job);
        if !status.success() {
            log::warn!("Reading setup exited with status {status}");
            return Err("Reading setup failed. Check your internet connection and available disk space, then retry.");
        }
        let launcher = stage.join("launcher");
        fs::create_dir(&launcher).map_err(|_| "Could not stage reading launcher.")?;
        fs::copy(dir.join("read-launcher/TsugiReadLauncher.class"), launcher.join("TsugiReadLauncher.class"))
            .map_err(|_| "Could not stage reading launcher.")?;
        if !runtime_ready(&stage) { return Err("Reading setup did not complete."); }
        // Never replace an existing runtime or touch the reading data.
        fs::rename(&stage, runtime).map_err(|_| "Could not activate prepared reading runtime.")?;
        Ok(())
    })();
    if stage.exists() {
        let _ = fs::remove_dir_all(&stage);
    }
    result
}

const PAGE_PREFIX: &str = "/__tsugi_read/page/";
struct CachedImage {
    path: String,
    mime: &'static str,
    bytes: Vec<u8>,
}
type Cache = Arc<Mutex<Option<CachedImage>>>;
type Emit = Arc<dyn Fn(Outbound) + Send + Sync>;
type Request = (String, ReadAction);

pub struct Worker {
    tx: SyncSender<Request>,
    stop: Arc<AtomicBool>,
    thread: Mutex<Option<JoinHandle<()>>>,
    cache: Cache,
    emit: Emit,
}

impl Worker {
    pub fn new(runtime: PathBuf, data: PathBuf, owner: isize, emit: impl Fn(Outbound) + Send + Sync + 'static) -> Self {
        let (tx, rx) = mpsc::sync_channel::<Request>(4);
        let stop = Arc::new(AtomicBool::new(false));
        let cache: Cache = Arc::new(Mutex::new(None));
        let emit: Emit = Arc::new(emit);
        let (stopped, images, reply) = (stop.clone(), cache.clone(), emit.clone());
        let thread = thread::spawn(move || {
            let mut reader = None;
            let mut chapter = None;
            let mut serial = 0u64;
            while !stopped.load(Ordering::Acquire) {
                let (request, action) = match rx.recv_timeout(Duration::from_millis(100)) {
                    Ok(item) => item,
                    Err(RecvTimeoutError::Timeout) => continue,
                    Err(RecvTimeoutError::Disconnected) => break,
                };
                if stopped.load(Ordering::Acquire) { break; }
                let result = (|| {
                    let preparing = matches!(&action, ReadAction::Prepare);
                    if preparing {
                        prepare_runtime(&runtime, &stopped)?;
                    }
                    if reader.is_none() {
                        reader = Some(ReadRuntime::start(&runtime, &data)?);
                    }
                    if preparing {
                        return Ok(json!({"ready": true}));
                    }
                    execute(reader.as_ref().unwrap(), &mut chapter, &images, &mut serial, owner, action)
                })();
                if !stopped.load(Ordering::Acquire) {
                    answer(&reply, request, result);
                }
            }
            if let Some(mut reader) = reader {
                if let Err(error) = reader.shutdown() {
                    log::warn!("Reading shutdown: {error}");
                }
            }
        });
        Self { tx, stop, thread: Mutex::new(Some(thread)), cache, emit }
    }

    pub fn request(&self, request: String, action: ReadAction) {
        if request.is_empty() || request.len() > 64
            || !request.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
        {
            return;
        }
        if self.stop.load(Ordering::Acquire) {
            answer(&self.emit, request, Err("Reading is closing."));
            return;
        }
        match self.tx.try_send((request, action)) {
            Ok(()) => (),
            Err(TrySendError::Full((request, _))) => answer(&self.emit, request, Err("Reading is busy. Try again.")),
            Err(TrySendError::Disconnected((request, _))) => answer(&self.emit, request, Err("Reading is unavailable.")),
        }
    }

    pub fn image(&self, path: &str) -> Option<(&'static str, Vec<u8>)> {
        let cache = self.cache.lock().ok()?;
        let image = cache.as_ref().filter(|image| image.path == path)?;
        Some((image.mime, image.bytes.clone()))
    }

    pub fn close(&self) {
        self.stop.store(true, Ordering::Release);
        let Ok(mut thread) = self.thread.lock() else { return };
        let Some(handle) = thread.take() else { return };
        // Normal JVM shutdown can flush the DB. A blocked upstream operation
        // must not prevent the desktop process from closing forever.
        let deadline = Instant::now() + Duration::from_secs(18);
        while !handle.is_finished() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(50));
        }
        if handle.is_finished() {
            let _ = handle.join();
        } else {
            log::warn!("Reading worker did not stop within its closing deadline.");
        }
    }
}

impl Drop for Worker {
    fn drop(&mut self) {
        self.close();
    }
}

fn answer(emit: &Emit, request: String, result: Result<Value, &'static str>) {
    let (data, error) = match result {
        Ok(data) => (Some(data), None),
        Err(error) => (None, Some(error.to_owned())),
    };
    emit(Outbound::ReadResult { request, data, error });
}

// Every executable install requires a native dialog. A web message is
// insufficient consent, even if it came from the bundled origin.
fn confirm(owner: isize, title: &str, message: &str) -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        IDYES, MB_DEFBUTTON2, MB_ICONWARNING, MB_SETFOREGROUND, MB_YESNO, MessageBoxW,
    };
    let message: Vec<u16> = message.encode_utf16().chain([0]).collect();
    let title: Vec<u16> = title.encode_utf16().chain([0]).collect();
    // SAFETY: NUL-terminated UTF-16 strings live for the duration of the dialog.
    unsafe { MessageBoxW(owner as windows_sys::Win32::Foundation::HWND, message.as_ptr(), title.as_ptr(), MB_YESNO | MB_ICONWARNING | MB_DEFBUTTON2 | MB_SETFOREGROUND) == IDYES }
}

fn confirm_store(owner: isize, index: &str) -> bool {
    if index.len() > 2048 || index.chars().any(char::is_control) { return false; }
    confirm(owner, "Tsugi reading repository", &format!("Register this reading repository?\n\n{index}\n\nOnly add repositories you trust. Registering a store does not install its extensions."))
}

fn stage_image(cache: &Cache, serial: &mut u64, image: aiostreams_desktop_core::read_runtime::PageImage) -> Result<Value, &'static str> {
    *serial = serial.checked_add(1).ok_or("Reading image counter exhausted.")?;
    let path = format!("{PAGE_PREFIX}{serial}");
    *cache.lock().map_err(|_| "Reading image cache unavailable.")? = Some(CachedImage {
        path: path.clone(), mime: image.mime, bytes: image.bytes,
    });
    Ok(json!({"path": path}))
}

fn execute(
    reader: &ReadRuntime,
    chapter: &mut Option<(i32, ChapterPages)>,
    cache: &Cache,
    serial: &mut u64,
    owner: isize,
    action: ReadAction,
) -> Result<Value, &'static str> {
    match action {
        ReadAction::Prepare => Err("Invalid reading setup state."),
        ReadAction::Status => reader.query(ReadOperation::Status),
        ReadAction::Sources => reader.query(ReadOperation::Sources),
        ReadAction::Library => reader.query(ReadOperation::Library),
        ReadAction::Stores => reader.query(ReadOperation::Stores),
        ReadAction::AddStore { index } => {
            if !confirm_store(owner, &index) { return Err("Repository registration cancelled."); }
            reader.add_store(&index)
        }
        ReadAction::RemoveStore { index } => reader.remove_store(&index),
        ReadAction::RefreshExtensions => reader.refresh_extensions().map(|()| json!({"ok": true})),
        ReadAction::InstallExtension { package } => {
            let review = reader.review_extension(&package)?;
            let message = format!("Install executable extension code?\n\n{}\n\nExtensions run with your Windows account permissions, not inside a security sandbox. Package signatures are not independently verified, and the repository may redirect downloads. Only continue if you trust the publisher.", review.description());
            if !confirm(owner, "Tsugi extension installation", &message) {
                return Err("Extension installation cancelled.");
            }
            reader.install_reviewed_extension(review)
        }
        ReadAction::UninstallExtension { package } => {
            if package.len() > 200 || package.chars().any(char::is_control) {
                return Err("Invalid extension package.");
            }
            if !confirm(owner, "Tsugi extension removal", &format!("Uninstall {package}?")) {
                return Err("Extension removal cancelled.");
            }
            *chapter = None;
            if let Ok(mut cache) = cache.lock() { *cache = None; }
            reader.uninstall_extension(&package)
        }
        ReadAction::Extensions { offset, query, store, language, installed } => reader.filter_extensions(offset, query.as_deref().unwrap_or(""), store.as_deref(), language.as_deref(), installed),
        ReadAction::Catalogue { source, page, mode, query } => {
            let mode = match mode.as_str() {
                "popular" => CatalogueMode::Popular,
                "latest" => CatalogueMode::Latest,
                "search" => CatalogueMode::Search(query.as_deref().ok_or("Missing search query.")?),
                _ => return Err("Invalid reading catalogue mode."),
            };
            reader.catalogue(&source, page, mode)
        }
        ReadAction::Manga { id } => reader.manga(id),
        ReadAction::Cover { id } => {
            let image = reader.thumbnail(id)?;
            stage_image(cache, serial, image)
        }
        ReadAction::SetLibrary { id, in_library } => reader.set_library(id, in_library),
        ReadAction::Chapter { id } => {
            let pages = reader.chapter(id)?;
            let count = pages.len();
            *chapter = Some((id, pages));
            if let Ok(mut cache) = cache.lock() { *cache = None; }
            Ok(json!({"id": id, "pageCount": count}))
        }
        ReadAction::Page { chapter_id, index } => {
            let (_, pages) = chapter.as_ref().filter(|(id, _)| *id == chapter_id)
                .ok_or("Open the reading chapter first.")?;
            let image = reader.page(pages, index)?;
            let mut result = stage_image(cache, serial, image)?;
            result["index"] = json!(index);
            Ok(result)
        }
        ReadAction::Progress { chapter_id, index, finished } => {
            let (_, pages) = chapter.as_ref().filter(|(id, _)| *id == chapter_id)
                .ok_or("Open the reading chapter first.")?;
            reader.save_progress(pages, index, finished)
        }
    }
}
