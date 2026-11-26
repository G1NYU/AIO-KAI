//! Windows music transport: yt-dlp playback plus bounded export metadata resolution.
use std::io::{BufRead, Read, Write};
use std::process::{Child, ChildStdout, Command, Stdio};
use std::sync::{Arc, Condvar, Mutex, atomic::{AtomicBool, AtomicU64, Ordering}};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

pub(crate) type MediaHeaders = Vec<(String, String)>;
const PREFIX: &str = "https://www.youtube.com/watch?v=";
const MAX_AUDIO: u64 = 64 * 1024 * 1024;
type Output = JoinHandle<Result<Vec<u8>, &'static str>>;

// An explicit choice for this process only. No browser is inspected until a
// transfer is started after the user opts in. Never persist cookies or profiles.
static SESSION: AtomicU64 = AtomicU64::new(0);
const SESSION_CHANGED: &str = "YouTube session changed. Play the track or retry the export again.";

pub(crate) fn session_revision() -> u64 { SESSION.load(Ordering::Acquire) }

fn update_session(state: &AtomicU64, value: &str) -> Result<(&'static str, bool), &'static str> {
    let wanted = match value {
        "status" => None,
        "anonymous" => Some(0),
        "firefox" => Some(1),
        _ => return Err("Invalid YouTube session choice."),
    };
    let mut current = state.load(Ordering::Acquire);
    loop {
        let mode = |revision: u64| if revision & 1 == 1 { "firefox" } else { "anonymous" };
        let Some(wanted) = wanted else { return Ok((mode(current), false)); };
        if current & 1 == wanted { return Ok((mode(current), false)); }
        let next = (current.wrapping_add(2) & !1) | wanted;
        match state.compare_exchange_weak(current, next, Ordering::AcqRel, Ordering::Acquire) {
            Ok(_) => return Ok((mode(next), true)),
            Err(actual) => current = actual,
        }
    }
}

pub(crate) fn session_request(value: &str) -> Result<(&'static str, bool), &'static str> {
    update_session(&SESSION, value)
}

const FIRST_AUDIO: usize = 64 * 1024;
const CANCELLED: &str = "YouTube audio transfer stopped.";
const LENGTH_CHANGED: &str = "YouTube audio length changed during transfer.";

#[derive(Default)]
struct TransferLength { total: AtomicU64, invalid: AtomicBool }

impl TransferLength {
    fn record(&self, length: u64) {
        if length == 0 || length > MAX_AUDIO
            || self.total.compare_exchange(0, length, Ordering::AcqRel, Ordering::Acquire).is_err_and(|known| known != length)
        { self.invalid.store(true, Ordering::Release); }
    }

    fn known(&self) -> Option<u64> {
        let value = self.total.load(Ordering::Acquire);
        (value > 0 && !self.invalid.load(Ordering::Acquire)).then_some(value)
    }

    fn validate(&self, received: u64, complete: bool) -> Result<(), &'static str> {
        if self.invalid.load(Ordering::Acquire)
            || self.known().is_some_and(|total| received > total || complete && received != total)
        { Err(LENGTH_CHANGED) } else { Ok(()) }
    }
}

#[cfg(windows)]
struct SessionTemporary(std::path::PathBuf);

#[cfg(windows)]
impl SessionTemporary {
    fn create() -> Result<Self, &'static str> { Self::create_named("tsugi-youtube") }

    fn create_named(prefix: &str) -> Result<Self, &'static str> {
        let error = "Could not prepare private temporary music storage.";
        let user = crate::read_runtime::private_storage::CurrentUser::get().map_err(|_| error)?;
        let mut nonce = [0u8; 16];
        getrandom::fill(&mut nonce).map_err(|_| error)?;
        let name: String = nonce.iter().map(|byte| format!("{byte:02x}")).collect();
        let directory = std::env::temp_dir().join(format!("{prefix}-{name}"));
        if !user.create_root(&directory).map_err(|_| error)? { return Err(error); }
        let temporary = Self(directory);
        user.verify(&temporary.0, true).map_err(|_| error)?;
        Ok(temporary)
    }
}

#[cfg(windows)]
impl Drop for SessionTemporary {
    fn drop(&mut self) {
        if std::fs::remove_dir_all(&self.0).is_err() {
            log::warn!("Could not remove private temporary music tool files.");
        }
    }
}

#[derive(Default)]
struct AudioState {
    bytes: Vec<u8>,
    complete: bool,
    error: Option<&'static str>,
    verified: bool,
    expected: Option<u64>,
}

/// The existing yt-dlp transport supplies a bounded seekable spool while mpv
/// decodes its first bytes. No signed media URL is handed to another client.
pub(crate) struct ProgressiveAudio {
    state: Mutex<AudioState>,
    changed: Condvar,
}

impl ProgressiveAudio {
    pub(crate) fn new() -> Arc<Self> {
        Arc::new(Self { state: Mutex::new(AudioState::default()), changed: Condvar::new() })
    }

    pub(crate) fn append(&self, bytes: &[u8]) -> Result<(), &'static str> {
        let mut state = self.state.lock().map_err(|_| CANCELLED)?;
        if state.complete { return Err(state.error.unwrap_or(CANCELLED)); }
        if state.bytes.len() + bytes.len() > MAX_AUDIO as usize { return Err("Music transfer exceeded its size limit."); }
        if state.expected.is_some_and(|length| state.bytes.len() as u64 + bytes.len() as u64 > length) {
            return Err("YouTube audio length changed during transfer.");
        }
        state.bytes.extend_from_slice(bytes);
        self.changed.notify_all();
        Ok(())
    }

    pub(crate) fn finish(&self, error: Option<&'static str>) {
        if let Ok(mut state) = self.state.lock() {
            if !state.verified {
                state.complete = true;
                state.error = state.error.or(error).or_else(|| state.expected.filter(|length| *length != state.bytes.len() as u64)
                    .map(|_| "YouTube audio ended before the expected length."));
                state.verified = true;
                self.changed.notify_all();
            }
        }
    }

    fn end_of_stream(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.complete = true;
            self.changed.notify_all();
        }
    }

    pub(crate) fn verified(&self) -> bool {
        self.state.lock().is_ok_and(|state| state.verified && state.error.is_none())
    }

    pub(crate) fn set_length(&self, length: u64) {
        if let Ok(mut state) = self.state.lock() {
            if length == 0 || length > MAX_AUDIO || length < state.bytes.len() as u64
                || state.expected.is_some_and(|expected| expected != length)
            {
                state.error = Some("YouTube audio length changed during transfer.");
                state.complete = true;
            } else { state.expected = Some(length); }
            self.changed.notify_all();
        }
    }

    pub(crate) fn ready(&self) -> bool {
        self.state.lock().is_ok_and(|state| state.error.is_none()
            && (state.bytes.len() >= FIRST_AUDIO || state.complete && !state.bytes.is_empty()))
    }

    pub(crate) fn failure(&self) -> Option<&'static str> {
        self.state.lock().ok().and_then(|state| state.error)
    }

    pub(crate) fn length(&self) -> Option<u64> {
        self.state.lock().ok().and_then(|state| if state.complete { Some(state.bytes.len() as u64) } else { state.expected })
    }

    /// Future seeks wait for the producer, with a bounded stall timeout. Reads
    /// already available return immediately, without waiting for another block.
    pub(crate) fn read(&self, start: u64, count: usize) -> Result<(Vec<u8>, Option<u64>), &'static str> {
        self.read_with_stall_timeout(start, count, Duration::from_secs(8))
    }

    fn read_with_stall_timeout(&self, start: u64, count: usize, stall_timeout: Duration) -> Result<(Vec<u8>, Option<u64>), &'static str> {
        if start > MAX_AUDIO || count > FIRST_AUDIO { return Err("Invalid progressive audio range."); }
        let mut state = self.state.lock().map_err(|_| CANCELLED)?;
        let mut received = state.bytes.len();
        let mut deadline = Instant::now() + stall_timeout;
        loop {
            if let Some(error) = state.error { return Err(error); }
            let length = if state.complete { Some(state.bytes.len() as u64) } else { state.expected };
            if start < state.bytes.len() as u64 {
                let end = (start as usize + count).min(state.bytes.len());
                return Ok((state.bytes[start as usize..end].to_vec(), length));
            }
            if state.complete || length.is_some_and(|length| start >= length) { return Ok((Vec::new(), length)); }
            // A future seek may need several healthy reads before its offset
            // arrives. Metadata and spurious notifications are not progress.
            if state.bytes.len() > received {
                received = state.bytes.len();
                deadline = Instant::now() + stall_timeout;
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() { return Err("YouTube audio stalled while buffering. Retry the track."); }
            let (next, _) = self.changed.wait_timeout(state, remaining).map_err(|_| CANCELLED)?;
            state = next;
        }
    }
}

fn read_diagnostics(reader: impl Read, audio: Option<Arc<ProgressiveAudio>>, total: &TransferLength) -> Result<Vec<u8>, &'static str> {
    const LIMIT: usize = 256 * 1024;
    let mut reader = std::io::BufReader::new(reader.take(LIMIT as u64 + 1));
    let mut output = Vec::new();
    loop {
        let mut line = Vec::new();
        if reader.read_until(b'\n', &mut line).map_err(|_| "Could not read the music transfer output.")? == 0 { break; }
        if output.len() + line.len() > LIMIT { return Err("Music transfer diagnostic limit exceeded."); }
        if let Ok(text) = std::str::from_utf8(&line)
            && let Some(length) = text.trim_end_matches(['\r', '\n']).strip_prefix("TSUGI_AUDIO_LENGTH=")
            && !length.is_empty() && length.len() <= 20 && length.bytes().all(|byte| byte.is_ascii_digit())
            && let Ok(length) = length.parse::<u64>()
        {
            total.record(length);
            if let Some(audio) = &audio { audio.set_length(length); }
        }
        output.extend(line);
    }
    Ok(output)
}

// A child can leave a pipe inherited by its JavaScript worker. Poll pipe
// readiness so cancellation never waits indefinitely for that child's EOF.
fn read_cancellable(stdout: &mut ChildStdout, buffer: &mut [u8], cancelled: &AtomicBool) -> Result<usize, &'static str> {
    loop {
        if cancelled.load(Ordering::Acquire) { return Err(CANCELLED); }
        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawHandle;
            #[link(name = "kernel32")]
            unsafe extern "system" {
                fn PeekNamedPipe(pipe: *mut std::ffi::c_void, buffer: *mut std::ffi::c_void, size: u32, read: *mut u32, available: *mut u32, left: *mut u32) -> i32;
            }
            let mut available = 0;
            // SAFETY: live ChildStdout handle, no output buffer, valid counter.
            let ok = unsafe { PeekNamedPipe(stdout.as_raw_handle(), std::ptr::null_mut(), 0, std::ptr::null_mut(), &mut available, std::ptr::null_mut()) };
            if ok == 0 {
                return if std::io::Error::last_os_error().raw_os_error() == Some(109) { Ok(0) }
                    else { Err("Could not read the music transfer output.") };
            }
            if available > 0 {
                let length = buffer.len().min(available as usize);
                return stdout.read(&mut buffer[..length]).map_err(|_| "Could not read the music transfer output.");
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            #[repr(C)]
            struct Poll { fd: i32, events: i16, returned: i16 }
            unsafe extern "C" { fn poll(fds: *mut Poll, count: usize, timeout: i32) -> i32; }
            let mut descriptor = Poll { fd: stdout.as_raw_fd(), events: 1, returned: 0 };
            // SAFETY: one live descriptor and valid writable poll storage.
            let ready = unsafe { poll(&mut descriptor, 1, 20) };
            if ready > 0 { return stdout.read(buffer).map_err(|_| "Could not read the music transfer output."); }
            if ready < 0 && std::io::Error::last_os_error().kind() != std::io::ErrorKind::Interrupted {
                return Err("Could not wait for the music transfer output.");
            }
        }
        #[cfg(not(any(unix, windows)))]
        return stdout.read(buffer).map_err(|_| "Could not read the music transfer output.");
    }
}

enum AudioOutput { Memory, Progressive(Arc<ProgressiveAudio>), File(std::fs::File) }

fn read_stream(mut stdout: ChildStdout, output: AudioOutput, received: &AtomicU64, cancelled: &AtomicBool) -> Result<Vec<u8>, &'static str> {
    read_stream_bounded(&mut stdout, output, received, cancelled, MAX_AUDIO)
}

fn read_stream_bounded(stdout: &mut ChildStdout, output: AudioOutput, received: &AtomicU64, cancelled: &AtomicBool, limit: u64) -> Result<Vec<u8>, &'static str> {
    let mut output = output;
    let audio = match &output { AudioOutput::Progressive(audio) => Some(audio.clone()), _ => None };
    let result = (|| {
    let mut memory = Vec::new();
    let mut count = 0u64;
    let mut buffer = [0u8; FIRST_AUDIO];
    loop {
        let size = read_cancellable(stdout, &mut buffer, cancelled)?;
        if size == 0 { break; }
        count += size as u64;
        if count > limit { return Err("Music transfer exceeded its size limit."); }
        match &mut output {
            AudioOutput::Memory => memory.extend_from_slice(&buffer[..size]),
            AudioOutput::Progressive(audio) => audio.append(&buffer[..size])?,
            AudioOutput::File(file) => file.write_all(&buffer[..size]).map_err(|_| "Could not write the Vault music file.")?,
        }
        received.store(count, Ordering::Relaxed);
    }
    if cancelled.load(Ordering::Acquire) { return Err(CANCELLED); }
    if let AudioOutput::File(file) = &mut output { file.sync_all().map_err(|_| "Could not finish the Vault music file.")?; }
    Ok(memory)
    })();
    if let Some(audio) = audio {
        match &result { Ok(_) => audio.end_of_stream(), Err(error) => audio.finish(Some(error)) }
    }
    result
}

pub(crate) fn target(id: &str) -> Result<String, &'static str> {
    if id.len() != 11
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("Invalid YouTube Music track.");
    }
    Ok(format!("{PREFIX}{id}"))
}

pub(crate) fn is_target(value: &str) -> bool {
    value
        .strip_prefix(PREFIX)
        .is_some_and(|id| target(id).is_ok())
}

fn read_audio(reader: impl Read, limit: u64, received: &AtomicU64) -> Result<Vec<u8>, &'static str> {
    let mut reader = reader.take(limit + 1);
    let mut bytes = Vec::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let n = reader.read(&mut buffer).map_err(|_| "Could not read the music transfer output.")?;
        if n == 0 { break; }
        if bytes.len() as u64 + n as u64 > limit { return Err("Music transfer exceeded its size limit."); }
        bytes.extend_from_slice(&buffer[..n]);
        received.store(bytes.len() as u64, Ordering::Relaxed);
    }
    Ok(bytes)
}

fn classify_error(stderr: &[u8], firefox: bool) -> &'static str {
    let error = String::from_utf8_lossy(stderr).to_ascii_lowercase();
    // A client warning can precede a different terminal failure. Prefer yt-dlp's
    // final error rather than attributing that failure to an earlier warning.
    let error = error.lines().rev()
        .find(|line| line.trim_start().starts_with("error:"))
        .unwrap_or(&error);
    let http_status = |code: &str| {
        ["http error ", "http ", "status code ", "status code: "]
            .iter().any(|prefix| error.contains(&format!("{prefix}{code}")))
    };
    if firefox && error.contains("firefox") && (error.contains("cookie") || error.contains("profile")) {
        "Could not read the Firefox YouTube session. Open YouTube in Firefox, then retry. You can return to anonymous access in Music sources."
    } else if error.contains("not a bot") {
        if firefox {
            "YouTube still requires verification. Open this track in your most recently used Firefox profile, complete YouTube's verification there, then retry."
        } else {
            "YouTube requires verification. Open Music sources and choose a YouTube session, then retry this track."
        }
    } else if ["confirm your age", "age-restricted", "age restricted", "age-verification", "age verification", "age_verification_required", "age_check_required"]
        .iter().any(|reason| error.contains(reason)) {
        "This YouTube track requires age verification. Verify access in Firefox, then choose its YouTube session in Music sources."
    } else if ["sign in", "sign-in", "log in", "login_required"]
        .iter().any(|reason| error.contains(reason)) {
        "This YouTube track requires sign-in. Sign in to YouTube in Firefox, then choose its YouTube session in Music sources."
    } else if http_status("403") {
        "YouTube refused access to this stream (HTTP 403)."
    } else if http_status("429") {
        "YouTube is rate limiting playback (HTTP 429)."
    } else {
        "The bundled music transport could not complete the audio transfer."
    }
}

pub(crate) struct Transfer {
    child: Child,
    stdout: Option<Output>,
    stderr: Option<Output>,
    deadline: Instant,
    received: Arc<AtomicU64>,
    total: Arc<TransferLength>,
    session: u64,
    soundcloud: bool,
    audio: Option<Arc<ProgressiveAudio>>,
    cancelled: Arc<AtomicBool>,
    file_output: bool,
    #[cfg(windows)]
    job: Option<crate::read_runtime::ReadJob>,
    #[cfg(windows)]
    temporary: Option<SessionTemporary>,
}

enum TransferOutput { Metadata, Memory, Playback, File(std::fs::File), Search(Box<dyn FnMut(serde_json::Value) + Send>) }

impl Transfer {
    pub(crate) fn start(value: &str) -> Result<Self, &'static str> {
        Self::start_with(value, "bestaudio[protocol=https]", Duration::from_secs(120), TransferOutput::Playback, 0)
    }

    #[cfg(windows)]
    pub(crate) fn start_soundcloud_search(query: &str, emit: Box<dyn FnMut(serde_json::Value) + Send>) -> Result<Self, &'static str> {
        let target = crate::soundcloud::search_target(query)?;
        Self::start_with(&target, "", Duration::from_secs(60), TransferOutput::Search(emit), 0)
    }

    // An explicit authorized Vault export, distinct from the playback format.
    // No muxing, plugins, or post-processors. Uses only the explicitly chosen
    // in-process YouTube session, exactly like playback.
    pub(crate) fn start_export(value: &str) -> Result<Self, &'static str> {
        Self::start_with(value, "bestaudio[ext=m4a][protocol=https]", Duration::from_secs(120), TransferOutput::Memory, 0)
    }

    pub(crate) fn start_export_to(value: &str, file: std::fs::File, rate_mib: u32) -> Result<Self, &'static str> {
        Self::start_with(value, "bestaudio[ext=m4a][protocol=https]", Duration::from_secs(120), TransferOutput::File(file), rate_mib)
    }

    pub(crate) fn progressive_audio(&self) -> Option<Arc<ProgressiveAudio>> { self.audio.clone() }

    #[cfg(windows)]
    pub(crate) fn start_resolve(value:&str)->Result<Self,&'static str>{
        Self::start_with(value,"bestaudio[ext=m4a][protocol=https]",Duration::from_secs(35),TransferOutput::Metadata,0)
    }

    fn start_with(value: &str, format: &str, timeout: Duration, output: TransferOutput, rate_mib: u32) -> Result<Self, &'static str> {
        let search = matches!(&output, TransferOutput::Search(_));
        let soundcloud = search || (matches!(&output, TransferOutput::Playback) && crate::soundcloud::is_target(value));
        if (!is_target(value) && !soundcloud) || (soundcloud && !cfg!(windows)) {
            return Err("Invalid or unsupported native music target.");
        }
        let app = std::env::current_exe().map_err(|_| "Could not locate Tsugi.")?;
        let directory = app.parent().ok_or("Could not locate Tsugi.")?;
        let resolver = directory.join("music-tools").join("yt-dlp.exe");
        let runtime = directory.join("music-tools").join("deno.exe");
        if !resolver.is_file() || (!soundcloud && !runtime.is_file()) {
            return Err("Bundled music tools are missing from this installation.");
        }
        let session = session_revision();
        let metadata = matches!(&output, TransferOutput::Metadata);
        #[cfg(windows)]
        let temporary = if soundcloud { Some(SessionTemporary::create_named("tsugi-soundcloud")?) }
            else if session & 1 == 1 { Some(SessionTemporary::create()?) } else { None };
        let mut command = if soundcloud {
            #[cfg(windows)]
            { soundcloud_command(&resolver, &temporary.as_ref().expect("owned SoundCloud directory").0, value, search) }
            #[cfg(not(windows))]
            { return Err("SoundCloud is supported on Windows only."); }
        } else { transport_command(&resolver, &runtime, value, format, metadata, session & 1 == 1, rate_mib) };
        #[cfg(windows)]
        let job = crate::read_runtime::ReadJob::new().map_err(|_| "Could not contain the YouTube music tool.")?;
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
            // yt-dlp's Firefox loader copies its database temporarily. Keep all
            // tool temporary files private, outside portable data and backups.
            if let Some(temporary) = &temporary {
                command.env("TMP", &temporary.0).env("TEMP", &temporary.0).env("TMPDIR", &temporary.0);
            }
        }
        let mut child=command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|_| "Could not start the bundled music transport.")?;
        #[cfg(windows)]
        if job.attach(&child).is_err() {
            let _ = child.kill(); let _ = child.wait();
            return Err("Could not contain the YouTube music tool.");
        }
        let stdout = child.stdout.take().expect("piped stdout");
        let stderr = child.stderr.take().expect("piped stderr");
        let received = Arc::new(AtomicU64::new(0));
        let counter = received.clone();
        let total = Arc::new(TransferLength::default());
        let diagnostic_total = total.clone();
        let cancelled = Arc::new(AtomicBool::new(false));
        let cancellation = cancelled.clone();
        let file_output = matches!(&output, TransferOutput::File(_));
        let audio = matches!(&output, TransferOutput::Playback).then(ProgressiveAudio::new);
        let diagnostic_audio = audio.clone();
        let playback_audio = audio.clone();
        Ok(Self {
            child,
            stdout: Some(std::thread::spawn(move || match output {
                TransferOutput::Metadata => read_audio(stdout, 2*1024*1024, &counter),
                TransferOutput::Search(emit) => read_soundcloud_rows(stdout, &cancellation, emit),
                TransferOutput::File(file) => read_stream(stdout, AudioOutput::File(file), &counter, &cancellation),
                TransferOutput::Playback => read_stream(stdout, AudioOutput::Progressive(playback_audio.expect("playback spool")), &counter, &cancellation),
                TransferOutput::Memory => read_stream(stdout, AudioOutput::Memory, &counter, &cancellation),
            })),
            stderr: Some(std::thread::spawn(move || read_diagnostics(stderr, diagnostic_audio, &diagnostic_total))),
            deadline: Instant::now() + timeout,
            received,
            total,
            session,
            soundcloud,
            audio,
            cancelled,
            file_output,
            #[cfg(windows)]
            job: Some(job),
            #[cfg(windows)]
            temporary,
        })
    }

    /// Bytes actually read from the media pipe.
    pub(crate) fn received_bytes(&self) -> u64 { self.received.load(Ordering::Relaxed) }

    /// The exact transport total, when available; never an estimate.
    pub(crate) fn total_bytes(&self) -> Option<u64> { self.total.known() }

    /// Poll without blocking the command worker. Discard incomplete transfers.
    pub(crate) fn poll(&mut self) -> Result<Option<Vec<u8>>, &'static str> {
        let mut result = self.poll_inner();
        if let Some(audio) = &self.audio {
            match &result {
                Ok(Some(_)) => audio.finish(None),
                Err(error) => audio.finish(Some(error)),
                _ => {},
            }
            if result.as_ref().is_ok_and(Option::is_some) && let Some(error) = audio.failure() { result = Err(error); }
        }
        result
    }

    fn poll_inner(&mut self) -> Result<Option<Vec<u8>>, &'static str> {
        if !self.soundcloud && self.session != session_revision() { return Err(SESSION_CHANGED); }
        self.total.validate(self.received_bytes(), false)?;
        if Instant::now() >= self.deadline {
            return Err(if self.soundcloud { "SoundCloud request timed out." } else { "YouTube Music transfer timed out." });
        }
        let Some(status) = self
            .child
            .try_wait()
            .map_err(|_| "The music transport stopped.")?
        else {
            return Ok(None);
        };
        if !self.stdout.as_ref().is_some_and(|out| out.is_finished())
            || !self.stderr.as_ref().is_some_and(|err| err.is_finished())
        {
            return Ok(None);
        }
        let stdout = self
            .stdout
            .take()
            .expect("checked output")
            .join()
            .map_err(|_| "Music output reader stopped.")?;
        let stderr = self
            .stderr
            .take()
            .expect("checked output")
            .join()
            .map_err(|_| "Music diagnostic reader stopped.")??;
        if !status.success() {
            return Err(if self.soundcloud { "SoundCloud could not complete the public media request." }
                else { classify_error(&stderr, self.session & 1 == 1) });
        }
        self.total.validate(self.received_bytes(), true)?;
        stdout.map(Some)
    }
}

fn read_soundcloud_rows(mut stdout: ChildStdout, cancelled: &AtomicBool, mut emit: Box<dyn FnMut(serde_json::Value) + Send>) -> Result<Vec<u8>, &'static str> {
    let mut rows = crate::soundcloud::SearchRows::default();
    let mut buffer = [0u8; 16 * 1024];
    let mut deliver = |track| {
        if !cancelled.load(Ordering::Acquire) { emit(track); }
    };
    loop {
        let size = read_cancellable(&mut stdout, &mut buffer, cancelled)?;
        if size == 0 { break; }
        rows.push(&buffer[..size], &mut deliver)?;
    }
    rows.finish(&mut deliver)?;
    Ok(Vec::new())
}

// Native HLS writes temporary fragment files even when its final output is
// stdout. Keep those files in this transfer's private working directory.
#[cfg(any(windows, test))]
fn soundcloud_command(resolver: &std::path::Path, directory: &std::path::Path, value: &str, search: bool) -> Command {
    let mut command = Command::new(resolver);
    command.current_dir(directory).args([
        "--ignore-config", "--no-plugin-dirs", "--no-cache-dir", "--no-progress",
        "--socket-timeout", "8", "--retries", "0", "--extractor-retries", "0",
        "--no-js-runtimes", "--encoding", "utf-8",
    ]).arg("--ffmpeg-location").arg(directory);
    if search {
        command.args(["--use-extractors", "soundcloud:search", "--flat-playlist", "--lazy-playlist",
            "--playlist-end", "20", "--skip-download", "--dump-json", "--quiet"]);
    } else {
        // Public, complete AAC only. No preview, DRM, cookies, browser session,
        // external downloader, user configuration or arbitrary target URL.
        command.args(["--use-extractors", "soundcloud", "--no-playlist", "--no-continue",
            "--fragment-retries", "0", "--abort-on-unavailable-fragments",
            "--extractor-args", "soundcloud:formats=hls_aac,http_aac",
            "--format", "bestaudio[ext=m4a][protocol=m3u8_native][format_id!*=preview]/bestaudio[ext=m4a][protocol=http][format_id!*=preview]",
            "--downloader", "m3u8:native", "--fixup", "never", "-o", "-"]);
    }
    command.args(["--", value]);
    command
}

pub(crate) fn is_playback_target(value: &str) -> bool {
    is_target(value) || crate::soundcloud::is_target(value)
}

fn transport_command(resolver: &std::path::Path, runtime: &std::path::Path, value: &str, format: &str, metadata: bool, firefox: bool, rate_mib: u32) -> Command {
    let mut command = Command::new(resolver);
    command.args([
                "--ignore-config",
                "--no-plugin-dirs",
                "--no-cache-dir",
                "--no-playlist",
                "--no-progress",
                "--socket-timeout",
                "8",
                "--retries",
                "0",
                "--extractor-retries",
                "0",
                "--fragment-retries",
                "0",
                "--format",
                format,
                "--no-js-runtimes",
                "--js-runtimes",
            ])
            .arg(format!("deno:{}", runtime.display()));
        // yt-dlp loads the most recently used Firefox profile into its private
        // cookie jar. It does not export a cookie file without --cookies.
        // The profile/arguments are a closed native choice, never web input.
        if firefox { command.args(["--cookies-from-browser", "firefox::none"]); }
        if rate_mib > 0 { command.args(["--limit-rate", &(u64::from(rate_mib) * 1024 * 1024).to_string()]); }
        if metadata {command.args(["--skip-download","--dump-single-json"]);}
        else {
            // With stdout media, yt-dlp sends its progress output to stderr.
            // Only this exact numeric total is consumed; no URLs or credentials
            // enter the native decoder or UI. An early size makes MP4 atom
            // discovery seekable without waiting for the full download.
            command.args(["--progress", "--newline", "--no-colors", "--progress-template",
                "download:TSUGI_AUDIO_LENGTH=%(progress.total_bytes)s", "-o", "-"]);
        }
        command.args(["--",value]);
        command
}

impl Drop for Transfer {
    fn drop(&mut self) {
        self.cancelled.store(true, Ordering::Release);
        if let Some(audio) = &self.audio { audio.finish(Some(CANCELLED)); }
        #[cfg(windows)]
        self.job.take();
        if !matches!(self.child.try_wait(), Ok(Some(_))) {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
        // File output polls for cancellation before every pipe read. Bound the
        // wait anyway so an unhealthy disk cannot block Stop indefinitely.
        if self.file_output && let Some(output) = self.stdout.take() {
            let deadline = Instant::now() + Duration::from_secs(2);
            while !output.is_finished() && Instant::now() < deadline { std::thread::sleep(Duration::from_millis(10)); }
            if output.is_finished() { let _ = output.join(); }
        }
        #[cfg(windows)]
        self.temporary.take();
        // Metadata/diagnostic threads own bounded allocations and no file.
    }
}

/// Sensitive resolved URLs and headers are intentionally not Debug/Serialize.
#[cfg(windows)]
pub(crate) struct ResolvedAudio{
    pub(crate) url:String,
    pub(crate) headers:MediaHeaders,
}
#[cfg(windows)]
pub(crate) fn parse_resolved(bytes:&[u8])->Result<ResolvedAudio,&'static str>{
    let value:serde_json::Value=serde_json::from_slice(bytes).map_err(|_|"Invalid music resolver metadata")?;
    if value["ext"]!="m4a"||value["protocol"]!="https"||value["vcodec"]!="none"
        || !value["acodec"].as_str().is_some_and(|v|!v.is_empty()&&v!="none")
        ||value.get("requested_formats").is_some_and(|v|!v.is_null())
        ||value.get("fragments").is_some_and(|v|!v.is_null())
        ||value["is_live"].as_bool()==Some(true)
        ||value["filesize"].as_u64().is_some_and(|n|n==0||n>MAX_AUDIO){
        return Err("Resolver did not select a bounded direct M4A audio stream");
    }
    let url=value["url"].as_str().filter(|v|v.len()<=16384).ok_or("Resolved audio URL unavailable")?.to_owned();
    let mut headers=Vec::new();
    if let Some(h)=value["http_headers"].as_object(){
        for (k,v) in h{
            let key=k.to_ascii_lowercase();
            // Do not silently strip access-dependent or request-specific headers.
            if key=="accept-encoding"{continue;}
            if !["user-agent","accept","accept-language","referer","origin","sec-fetch-mode"].contains(&key.as_str()){
                return Err("Resolved media requires unsupported headers");
            }
            let v=v.as_str().filter(|v|v.len()<=2048&&!v.bytes().any(|b|b<32||b==127)).ok_or("Invalid resolved header")?;
            headers.push((key,v.to_owned()));
        }
    }
    if headers.len()>8{return Err("Too many resolved media headers");}
    Ok(ResolvedAudio{url,headers})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_is_an_explicit_closed_choice_and_changes_invalidate_old_work() {
        let state = AtomicU64::new(0);
        assert_eq!(update_session(&state, "status"), Ok(("anonymous", false)));
        assert_eq!(state.load(Ordering::Acquire), 0);
        for invalid in ["chrome", "firefox:path", "firefox::container", "--cookies secret", "", "Firefox"] {
            assert!(update_session(&state, invalid).is_err());
            assert_eq!(state.load(Ordering::Acquire), 0);
        }
        assert_eq!(update_session(&state, "firefox"), Ok(("firefox", true)));
        let first = state.load(Ordering::Acquire);
        assert_eq!(update_session(&state, "firefox"), Ok(("firefox", false)));
        assert_eq!(state.load(Ordering::Acquire), first);
        assert_eq!(update_session(&state, "anonymous"), Ok(("anonymous", true)));
        assert!(state.load(Ordering::Acquire) > first);
        assert_eq!(update_session(&state, "firefox"), Ok(("firefox", true)));
        assert!(state.load(Ordering::Acquire) > first, "reselecting the same account never revives old transfers");
    }

    #[test]
    fn transport_args_require_opt_in_and_keep_rate_options_before_the_url() {
        let args = |firefox, rate| transport_command(std::path::Path::new("yt-dlp.exe"), std::path::Path::new("D:/Music tools/deno.exe"),
            "https://www.youtube.com/watch?v=abcdefghijk", "bestaudio[protocol=https]", false, firefox, rate)
            .get_args().map(|value| value.to_string_lossy().into_owned()).collect::<Vec<_>>();
        let anonymous = args(false, 0);
        assert!(!anonymous.iter().any(|arg| arg.contains("cookies")));
        assert!(!anonymous.iter().any(|arg| arg == "--limit-rate"));
        let firefox = args(true, 2);
        assert!(firefox.windows(2).any(|pair| pair == ["--cookies-from-browser", "firefox::none"]));
        assert!(firefox.windows(2).any(|pair| pair == ["--limit-rate", "2097152"]));
        assert!(!firefox.iter().any(|arg| arg == "--cookies"));
        assert!(firefox.iter().any(|arg| arg == "deno:D:/Music tools/deno.exe"));
        assert_eq!(&firefox[firefox.len()-2..], &["--", "https://www.youtube.com/watch?v=abcdefghijk"]);
    }

    #[test]
    fn soundcloud_commands_are_public_bounded_and_use_owned_fragment_directory() {
        let directory = std::path::Path::new("private-fragments");
        let resolver = std::path::Path::new("yt-dlp.exe");
        for (value, search) in [("scsearch20:original music", true), ("https://api.soundcloud.com/tracks/123", false)] {
            let command = soundcloud_command(resolver, directory, value, search);
            assert_eq!(command.get_current_dir(), Some(directory));
            let args: Vec<_> = command.get_args().map(|v| v.to_string_lossy().into_owned()).collect();
            assert_eq!(&args[args.len()-2..], &["--", value]);
            assert!(!args.iter().any(|v| v.contains("cookies") || v == "--allow-unplayable-formats"));
            assert!(args.windows(2).any(|pair| pair == ["--ffmpeg-location", "private-fragments"]));
            if search {
                assert!(args.iter().any(|v| v == "--flat-playlist"));
                assert!(args.iter().any(|v| v == "--dump-json"));
                assert!(args.windows(2).any(|pair| pair == ["--playlist-end", "20"]));
            } else {
                assert!(args.iter().any(|v| v == "--abort-on-unavailable-fragments"));
                assert!(args.windows(2).any(|pair| pair == ["--downloader", "m3u8:native"]));
                assert!(args.iter().any(|v| v.contains("format_id!*=preview")));
                assert!(args.windows(2).any(|pair| pair == ["-o", "-"]));
            }
        }
        assert!(is_playback_target("https://api.soundcloud.com/tracks/123"));
        assert!(!is_target("https://api.soundcloud.com/tracks/123"), "SoundCloud cannot enter YouTube export");
    }

    #[test]
    fn progressive_audio_reads_before_completion_and_supports_future_seeks() {
        let audio = ProgressiveAudio::new();
        let mut first = vec![1; FIRST_AUDIO];
        first[..4].copy_from_slice(&[0x1a, 0x45, 0xdf, 0xa3]);
        audio.append(&first).unwrap();
        assert!(audio.ready());
        assert_eq!(audio.length(), None);
        assert_eq!(audio.read(0, 4), Ok((first[..4].to_vec(), None)));
        let awaiting = audio.clone();
        let future = std::thread::spawn(move || awaiting.read(FIRST_AUDIO as u64 + 4, 4));
        assert!(!future.is_finished());
        audio.append(b"headtail").unwrap();
        assert_eq!(future.join().unwrap().unwrap().0, b"tail");
        audio.finish(None);
        assert_eq!(audio.length(), Some(FIRST_AUDIO as u64 + 8));
        assert_eq!(audio.read(FIRST_AUDIO as u64 + 8, 8), Ok((Vec::new(), audio.length())));
        assert!(audio.append(b"late").is_err());
        assert!(audio.read(MAX_AUDIO+1, 1).is_err());
        assert!(audio.read(0, FIRST_AUDIO+1).is_err());
    }

    #[test]
    fn progressive_failure_wakes_waiters_and_never_returns_partial_success() {
        let audio = ProgressiveAudio::new();
        let awaiting = audio.clone();
        let waiter = std::thread::spawn(move || awaiting.read(128, 8));
        audio.finish(Some(CANCELLED));
        assert_eq!(waiter.join().unwrap(), Err(CANCELLED));
        assert!(!audio.ready());
        assert_eq!(audio.failure(), Some(CANCELLED));
    }

    #[test]
    fn progressive_future_seek_waits_while_bytes_keep_arriving() {
        let audio = ProgressiveAudio::new();
        let producer = audio.clone();
        let writer = std::thread::spawn(move || {
            for byte in 0..8 {
                std::thread::sleep(Duration::from_millis(75));
                producer.append(&[byte]).unwrap();
            }
        });
        let timeout = Duration::from_millis(300);
        let started = Instant::now();
        let result = audio.read_with_stall_timeout(7, 1, timeout);
        let elapsed = started.elapsed();
        writer.join().unwrap();
        assert_eq!(result, Ok((vec![7], None)), "a future seek remains healthy while its producer makes progress");
        assert!(elapsed > timeout, "fixture must require more than one stall window to reach the seek position");
        assert!(!audio.verified(), "the read must not depend on transfer completion");
    }

    #[test]
    fn progressive_stall_ignores_notifications_without_new_bytes() {
        let audio = ProgressiveAudio::new();
        audio.append(b"head").unwrap();
        let notifier = audio.clone();
        let notifications = std::thread::spawn(move || {
            for _ in 0..10 {
                std::thread::sleep(Duration::from_millis(50));
                notifier.set_length(1024);
                notifier.append(b"").unwrap();
                notifier.changed.notify_all();
            }
        });
        let timeout = Duration::from_millis(150);
        let started = Instant::now();
        let result = audio.read_with_stall_timeout(128, 8, timeout);
        let elapsed = started.elapsed();
        notifications.join().unwrap();
        assert_eq!(result, Err("YouTube audio stalled while buffering. Retry the track."));
        assert!(elapsed >= timeout);
        assert!(elapsed < Duration::from_millis(450), "length metadata, empty appends and notifications must not renew the stall timeout");
    }

    #[test]
    fn progressive_wait_cancels_after_partial_progress() {
        let audio = ProgressiveAudio::new();
        let producer = audio.clone();
        let writer = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(30));
            producer.append(b"head").unwrap();
            std::thread::sleep(Duration::from_millis(30));
            producer.finish(Some(CANCELLED));
        });
        assert_eq!(audio.read_with_stall_timeout(128, 8, Duration::from_secs(1)), Err(CANCELLED));
        writer.join().unwrap();
    }

    #[test]
    fn exact_length_supports_virtual_eof_and_rejects_mismatches() {
        let audio = ProgressiveAudio::new();
        audio.append(b"head").unwrap();
        let diagnostics = b"WARNING: ignored total_bytes_estimate=200\nTSUGI_AUDIO_LENGTH=NA\nTSUGI_AUDIO_LENGTH=12\r\n";
        let total = TransferLength::default();
        assert_eq!(read_diagnostics(&diagnostics[..], Some(audio.clone()), &total).unwrap(), diagnostics);
        assert_eq!(total.known(), Some(12));
        assert!(total.validate(13, false).is_err());
        assert!(total.validate(11, true).is_err());
        assert!(total.validate(12, true).is_ok());
        assert_eq!(audio.length(), Some(12));
        assert_eq!(audio.read(12, 4), Ok((Vec::new(), Some(12))), "MP4 atom scan can inspect EOF without waiting for audio bytes");
        assert!(!audio.verified());
        let waiting = audio.clone();
        let future = std::thread::spawn(move || waiting.read(8, 4));
        assert!(!future.is_finished());
        audio.append(b"nexttail").unwrap();
        assert_eq!(future.join().unwrap(), Ok((b"tail".to_vec(), Some(12))));
        audio.finish(None);
        assert!(audio.verified());

        let mismatch = ProgressiveAudio::new();
        mismatch.set_length(12); mismatch.append(b"short").unwrap(); mismatch.finish(None);
        assert!(mismatch.failure().is_some());
        assert!(!mismatch.verified());
        for length in [0, MAX_AUDIO+1, 6] {
            let changed = ProgressiveAudio::new(); changed.set_length(4); changed.append(b"four").unwrap(); changed.set_length(length); changed.finish(None);
            assert!(changed.failure().is_some(), "conflicting/oversized length cannot become success");
        }
    }

    const ECHO_READY: &[u8] = b"\nTSUGI_MUSIC_ECHO_READY\n";

    // Run a byte-preserving producer without a shell's startup/stdin behavior.
    // Exit directly so libtest cannot append its summary to the media pipe.
    #[test]
    #[ignore = "subprocess fixture only"]
    fn echo_fixture_process() {
        if std::env::var_os("TSUGI_MUSIC_ECHO_FIXTURE").as_deref() != Some(std::ffi::OsStr::new("1")) { return; }
        let mut input = std::io::stdin().lock();
        let mut output = std::io::stdout().lock();
        output.write_all(ECHO_READY).unwrap();
        output.flush().unwrap();
        let mut buffer = [0; FIRST_AUDIO];
        loop {
            let size = input.read(&mut buffer).unwrap();
            if size == 0 { break; }
            output.write_all(&buffer[..size]).unwrap();
            output.flush().unwrap();
        }
        std::process::exit(0);
    }

    struct EchoChild(Child);

    impl EchoChild {
        fn stop(&mut self) {
            self.0.stdin.take();
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    impl Drop for EchoChild {
        fn drop(&mut self) { self.stop(); }
    }

    fn echo_child() -> EchoChild {
        let mut child = EchoChild(Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "music_resolver::tests::echo_fixture_process", "--ignored", "--nocapture", "--test-threads=1"])
            .env("TSUGI_MUSIC_ECHO_FIXTURE", "1")
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().unwrap());
        let mut stdout = child.0.stdout.take().unwrap();
        let cancelled = Arc::new(AtomicBool::new(false));
        let flag = cancelled.clone();
        let (ready, wait) = std::sync::mpsc::channel();
        let reader = std::thread::spawn(move || {
            let result = (|| {
                // Consume only the bounded libtest preamble and readiness marker.
                // Reading one byte avoids taking any subsequent fixture data.
                let mut preamble = Vec::new();
                while preamble.len() < 4096 {
                    let mut byte = [0];
                    if read_cancellable(&mut stdout, &mut byte, &flag)? == 0 { return Err("echo fixture exited before readiness"); }
                    preamble.push(byte[0]);
                    if preamble.ends_with(ECHO_READY) { return Ok(()); }
                }
                Err("echo fixture readiness preamble exceeded its bound")
            })();
            let _ = ready.send(result);
            stdout
        });
        let result = wait.recv_timeout(Duration::from_secs(10));
        if !matches!(result, Ok(Ok(()))) {
            cancelled.store(true, Ordering::Release);
            child.stop();
        }
        child.0.stdout = Some(reader.join().expect("echo readiness reader"));
        assert!(matches!(result, Ok(Ok(()))), "native echo producer must become ready before transfer checks: {result:?}; child={:?}", child.0.try_wait());
        child
    }

    struct FixtureOutput {
        worker: Option<Output>,
        cancelled: Arc<AtomicBool>,
        child: EchoChild,
    }

    impl FixtureOutput {
        fn is_finished(&self) -> bool { self.worker.as_ref().unwrap().is_finished() }
        fn join(&mut self) -> Result<Vec<u8>, &'static str> { self.worker.take().unwrap().join().expect("fixture output reader") }
    }

    impl Drop for FixtureOutput {
        fn drop(&mut self) {
            self.cancelled.store(true, Ordering::Release);
            self.child.stop();
            if let Some(worker) = self.worker.take() { let _ = worker.join(); }
        }
    }

    struct FixtureFile(std::path::PathBuf);

    impl FixtureFile {
        fn create(path: std::path::PathBuf) -> (Self, std::fs::File) {
            let file = std::fs::OpenOptions::new().create_new(true).write(true).open(&path).unwrap();
            (Self(path), file)
        }
    }

    impl Drop for FixtureFile {
        fn drop(&mut self) { let _ = std::fs::remove_file(&self.0); }
    }

    #[test]
    fn export_sink_writes_before_eof_and_releases_file_on_completion_and_cancel() {
        static SEQUENCE: AtomicU64 = AtomicU64::new(0);
        for cancel in [false, true] {
            let (path, file) = FixtureFile::create(std::env::temp_dir().join(format!("tsugi-audio-sink-{}-{}.part", std::process::id(), SEQUENCE.fetch_add(1, Ordering::Relaxed))));
            let mut child = echo_child();
            let stdout = child.0.stdout.take().unwrap();
            let counter = Arc::new(AtomicU64::new(0)); let received = counter.clone();
            let cancelled = Arc::new(AtomicBool::new(false)); let flag = cancelled.clone();
            let mut worker = FixtureOutput { worker: Some(std::thread::spawn(move || read_stream(stdout, AudioOutput::File(file), &received, &flag))), cancelled: cancelled.clone(), child };
            let first: Vec<u8> = (0..FIRST_AUDIO).map(|byte| byte as u8).collect();
            worker.child.0.stdin.as_mut().unwrap().write_all(&first).unwrap();
            let deadline = Instant::now() + Duration::from_secs(5);
            while counter.load(Ordering::Relaxed) < first.len() as u64 && Instant::now() < deadline { std::thread::sleep(Duration::from_millis(10)); }
            let received = counter.load(Ordering::Relaxed);
            if received != first.len() as u64 {
                let finished = worker.is_finished();
                let result = if finished { Some(worker.join()) } else { None };
                panic!("native echo output did not reach the writer: received={received}, child={:?}, worker_finished={finished}, worker_result={result:?}", worker.child.0.try_wait());
            }
            assert_eq!(std::fs::read(&path.0).unwrap(), first, "a fresh file handle reads exact binary output before child EOF");
            assert!(!worker.is_finished());
            if cancel { cancelled.store(true, Ordering::Release); }
            else { worker.child.0.stdin.as_mut().unwrap().write_all(b"tail").unwrap(); worker.child.0.stdin.take(); }
            let deadline = Instant::now() + Duration::from_secs(2);
            while !worker.is_finished() && Instant::now() < deadline { std::thread::sleep(Duration::from_millis(10)); }
            assert!(worker.is_finished(), "the output writer releases its file without waiting for child EOF on cancellation");
            let result = worker.join();
            if cancel { assert_eq!(result, Err(CANCELLED)); }
            else { assert_eq!(result, Ok(Vec::new()), "file export does not allocate a second complete audio buffer"); }
            let mut expected = first; if !cancel { expected.extend(b"tail"); }
            assert_eq!(std::fs::read(&path.0).unwrap(), expected);
            let moved = path.0.with_extension("finished");
            std::fs::rename(&path.0, &moved).expect("writer file handle must already be closed");
            let moved = FixtureFile(moved);
            std::fs::remove_file(&moved.0).unwrap();
        }
    }

    #[test]
    fn export_sink_enforces_its_limit_before_writing_an_oversized_block() {
        let (path, file) = FixtureFile::create(std::env::temp_dir().join(format!("tsugi-audio-limit-{}.part", std::process::id())));
        let mut child = echo_child();
        let mut stdout = child.0.stdout.take().unwrap();
        child.0.stdin.as_mut().unwrap().write_all(b"oversized").unwrap(); child.0.stdin.take();
        let received = AtomicU64::new(0);
        let result = read_stream_bounded(&mut stdout, AudioOutput::File(file), &received, &AtomicBool::new(false), 4);
        assert_eq!(result, Err("Music transfer exceeded its size limit."));
        assert!(received.load(Ordering::Relaxed) <= 4);
        assert!(std::fs::metadata(&path.0).unwrap().len() <= 4);
        std::fs::remove_file(&path.0).expect("failed export releases its file handle");
    }

    #[test]
    fn output_pipe_cancellation_does_not_wait_for_child_eof() {
        #[cfg(windows)]
        let mut child = Command::new("cmd").args(["/D", "/C", "ping -n 6 127.0.0.1 >nul"]).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().unwrap();
        #[cfg(unix)]
        let mut child = Command::new("sh").args(["-c", "sleep 5"]).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().unwrap();
        #[cfg(any(windows, unix))]
        {
            let cancelled = Arc::new(AtomicBool::new(false));
            let flag = cancelled.clone();
            let mut stdout = child.stdout.take().unwrap();
            let reader = std::thread::spawn(move || read_cancellable(&mut stdout, &mut [0; 8], &flag));
            std::thread::sleep(Duration::from_millis(50));
            assert!(!reader.is_finished(), "fixture must be blocked on a still-open pipe");
            let start = Instant::now();
            cancelled.store(true, Ordering::Release);
            let deadline = Instant::now() + Duration::from_secs(2);
            while !reader.is_finished() && Instant::now() < deadline { std::thread::sleep(Duration::from_millis(10)); }
            let _ = child.kill(); let _ = child.wait();
            assert!(reader.is_finished(), "cancellation must not wait for a descendant holding the pipe");
            assert_eq!(reader.join().unwrap(), Err(CANCELLED));
            assert!(start.elapsed() < Duration::from_secs(2));
        }
    }

    #[cfg(windows)]
    #[test]
    fn resolved_metadata_rejects_unsupported_formats_and_credentials(){
        let mut value=serde_json::json!({"url":"https://a.googlevideo.com/videoplayback?sig=private",
            "ext":"m4a","protocol":"https","vcodec":"none","acodec":"mp4a.40.2",
            "filesize":1234,"http_headers":{"User-Agent":"fixture","Accept-Encoding":"gzip"}});
        let parsed=parse_resolved(&serde_json::to_vec(&value).unwrap()).unwrap();
        assert_eq!(parsed.headers,vec![("user-agent".into(),"fixture".into())]);
        value["http_headers"]["Cookie"]=serde_json::json!("secret");
        assert!(parse_resolved(&serde_json::to_vec(&value).unwrap()).is_err());
        value["http_headers"]=serde_json::json!({});
        value["vcodec"]=serde_json::json!("avc1");
        assert!(parse_resolved(&serde_json::to_vec(&value).unwrap()).is_err());
        value["vcodec"]=serde_json::json!("none");
        value["filesize"]=serde_json::json!(MAX_AUDIO+1);
        assert!(parse_resolved(&serde_json::to_vec(&value).unwrap()).is_err());
    }

    #[test]
    fn validates_exact_watch_targets() {
        let url = target("abcdefghijk").expect("valid ID");
        assert_eq!(url, "https://www.youtube.com/watch?v=abcdefghijk");
        assert!(is_target(&url));
        for value in [
            "https://www.youtube.com/watch?v=abcdefghijk&list=bad",
            "https://youtube.com/watch?v=abcdefghijk",
            "https://example.test/watch?v=abcdefghijk",
            "https://www.youtube.com/watch?v=abc",
        ] {
            assert!(!is_target(value));
        }
        assert!(target("abc/efghijk").is_err());
    }

    #[test]
    fn bounds_diagnostics_and_accepts_only_exact_numeric_lengths() {
        let total = TransferLength::default();
        for invalid in ["NA", "12.5", "-12", "1e4", "12345 byte", "999999999999999999999"] {
            read_diagnostics(format!("TSUGI_AUDIO_LENGTH={invalid}\n").as_bytes(), None, &total).unwrap();
            assert_eq!(total.known(), None);
        }
        read_diagnostics(b"TSUGI_AUDIO_LENGTH=12\n".as_slice(), None, &total).unwrap();
        assert_eq!(total.known(), Some(12));
        read_diagnostics(b"TSUGI_AUDIO_LENGTH=13\n".as_slice(), None, &total).unwrap();
        assert_eq!(total.known(), None);
        assert!(total.validate(12, true).is_err());
        assert!(read_diagnostics(vec![b'x'; 256*1024+1].as_slice(), None, &TransferLength::default()).is_err());
    }

    #[test]
    fn audio_progress_counts_only_bounded_bytes() {
        let count = AtomicU64::new(0);
        assert_eq!(read_audio(&b"abcdef"[..], 6, &count), Ok(b"abcdef".to_vec()));
        assert_eq!(count.load(Ordering::Relaxed), 6);
        count.store(0, Ordering::Relaxed);
        assert!(read_audio(&b"abcdef"[..], 5, &count).is_err());
        assert!(count.load(Ordering::Relaxed) <= 5);
    }
    #[test]
    fn errors_never_include_raw_provider_output() {
        assert_eq!(
            classify_error(b"ERROR: Sign in to confirm you are not a bot", false),
            "YouTube requires verification. Open Music sources and choose a YouTube session, then retry this track."
        );
        assert_eq!(
            classify_error(b"ERROR: HTTP Error 403: Forbidden", false),
            "YouTube refused access to this stream (HTTP 403)."
        );
        assert!(!classify_error(b"https://example.test/?private=hidden", false).contains("hidden"));
    }

    #[test]
    fn distinguishes_access_restrictions_without_assuming_a_browser_session() {
        for reason in ["Sign in to confirm your age", "This video is age-restricted", "AGE_VERIFICATION_REQUIRED"] {
            assert_eq!(classify_error(format!("ERROR: [youtube] abcdefghijk: {reason}").as_bytes(), false),
                "This YouTube track requires age verification. Verify access in Firefox, then choose its YouTube session in Music sources.");
        }
        for reason in ["Private video. Sign in if you have access", "LOGIN_REQUIRED", "Please log in"] {
            assert_eq!(classify_error(format!("ERROR: [youtube] abcdefghijk: {reason}").as_bytes(), false),
                "This YouTube track requires sign-in. Sign in to YouTube in Firefox, then choose its YouTube session in Music sources.");
        }
        assert_eq!(classify_error(b"ERROR: HTTP Error 429: Too Many Requests", false),
            "YouTube is rate limiting playback (HTTP 429).");
    }

    #[test]
    fn terminal_failure_takes_priority_over_client_warnings_and_url_digits() {
        assert_eq!(classify_error(b"WARNING: Earlier client required sign in to confirm you are not a bot\nERROR: unable to download audio data: HTTP Error 403: Forbidden", false),
            "YouTube refused access to this stream (HTTP 403).");
        assert_eq!(classify_error(b"ERROR: HTTP Error 403: Forbidden\nERROR: HTTP Error 429: Too Many Requests", false),
            "YouTube is rate limiting playback (HTTP 429).");
        assert_eq!(classify_error(b"WARNING: Earlier client returned 429\nERROR: Could not read https://example.test/audio-403?private=hidden", false),
            "The bundled music transport could not complete the audio transfer.");
    }
}
