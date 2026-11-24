//! Windows-only, lazy reader worker. All runtime access is serialized off the UI
//! thread. Credentials, page routes and the Java process remain native-owned.
use std::path::{Path, PathBuf};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
    mpsc::{self, RecvTimeoutError, SyncSender, TrySendError},
};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use aiostreams_desktop_core::bridge::{Outbound, ReadAction};
use aiostreams_desktop_core::read_runtime::{CatalogueMode, ChapterPages, ReadOperation, ReadRuntime};
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

/// A packaged Read destination remains visible even before Java is prepared.
pub fn bundled_read_section(args: &Args, web: Option<&Path>) -> bool {
    bundled_directory(args, web).is_some_and(|dir| {
        dir.join("read-launcher/fetch-read-tools.ps1").is_file()
            || bundled_runtime(args, web).is_some()
    })
}

pub fn bundled_runtime(args: &Args, web: Option<&Path>) -> Option<PathBuf> {
    let runtime = bundled_directory(args, web)?.join("read-tools");
    ["jre/bin/java.exe", "bin/Suwayomi-Server.jar", "launcher/TsugiReadLauncher.class"]
        .iter().all(|path| runtime.join(path).is_file()).then_some(runtime)
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
    pub fn new(runtime: PathBuf, data: PathBuf, emit: impl Fn(Outbound) + Send + Sync + 'static) -> Self {
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
                    if reader.is_none() {
                        reader = Some(ReadRuntime::start(&runtime, &data)?);
                    }
                    execute(reader.as_ref().unwrap(), &mut chapter, &images, &mut serial, action)
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
fn confirm(title: &str, message: &str) -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        IDYES, MB_DEFBUTTON2, MB_ICONWARNING, MB_YESNO, MessageBoxW,
    };
    let message: Vec<u16> = message.encode_utf16().chain([0]).collect();
    let title: Vec<u16> = title.encode_utf16().chain([0]).collect();
    // SAFETY: NUL-terminated UTF-16 strings live for the duration of the dialog.
    unsafe { MessageBoxW(std::ptr::null_mut(), message.as_ptr(), title.as_ptr(), MB_YESNO | MB_ICONWARNING | MB_DEFBUTTON2) == IDYES }
}

fn confirm_store(index: &str) -> bool {
    if index.len() > 2048 || index.chars().any(char::is_control) { return false; }
    confirm("Tsugi reading repository", &format!("Register this reading repository?\n\n{index}\n\nOnly add repositories you trust. Registering a store does not install its extensions."))
}

fn execute(
    reader: &ReadRuntime,
    chapter: &mut Option<(i32, ChapterPages)>,
    cache: &Cache,
    serial: &mut u64,
    action: ReadAction,
) -> Result<Value, &'static str> {
    match action {
        ReadAction::Status => reader.query(ReadOperation::Status),
        ReadAction::Sources => reader.query(ReadOperation::Sources),
        ReadAction::Library => reader.query(ReadOperation::Library),
        ReadAction::Stores => reader.query(ReadOperation::Stores),
        ReadAction::AddStore { index } => {
            if !confirm_store(&index) { return Err("Repository registration cancelled."); }
            reader.add_store(&index)
        }
        ReadAction::RemoveStore { index } => reader.remove_store(&index),
        ReadAction::RefreshExtensions => reader.refresh_extensions().map(|()| json!({"ok": true})),
        ReadAction::InstallExtension { package } => {
            let review = reader.review_extension(&package)?;
            let message = format!("Install executable extension code?\n\n{}\n\nExtensions run with your Windows account permissions, not inside a security sandbox. Package signatures are not independently verified, and the repository may redirect downloads. Only continue if you trust the publisher.", review.description());
            if !confirm("Tsugi extension installation", &message) {
                return Err("Extension installation cancelled.");
            }
            reader.install_reviewed_extension(review)
        }
        ReadAction::UninstallExtension { package } => {
            if package.len() > 200 || package.chars().any(char::is_control) {
                return Err("Invalid extension package.");
            }
            if !confirm("Tsugi extension removal", &format!("Uninstall {package}?")) {
                return Err("Extension removal cancelled.");
            }
            *chapter = None;
            if let Ok(mut cache) = cache.lock() { *cache = None; }
            reader.uninstall_extension(&package)
        }
        ReadAction::Extensions { offset } => reader.extensions(offset),
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
            *serial = serial.checked_add(1).ok_or("Reading page counter exhausted.")?;
            let path = format!("{PAGE_PREFIX}{serial}");
            *cache.lock().map_err(|_| "Reading image cache unavailable.")? = Some(CachedImage {
                path: path.clone(), mime: image.mime, bytes: image.bytes,
            });
            Ok(json!({"path": path, "index": index}))
        }
        ReadAction::Progress { chapter_id, index, finished } => {
            let (_, pages) = chapter.as_ref().filter(|(id, _)| *id == chapter_id)
                .ok_or("Open the reading chapter first.")?;
            reader.save_progress(pages, index, finished)
        }
    }
}
