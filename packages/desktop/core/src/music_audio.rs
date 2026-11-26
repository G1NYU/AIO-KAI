//! Audio-only playback, separate from the video player's mpv handle.
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use crate::bridge::Outbound;
use crate::mpv::{Event, Kind, Mpv};
use crate::music_resolver::Transfer;
use crate::music_stream::{self, Source};
use crate::player::Emit;

pub enum Command {
    Load {
        request: String,
        url: String,
        volume: f64,
    },
    Prefetch {
        request: String,
        url: Option<String>,
    },
    Control {
        request: String,
        action: String,
        value: f64,
    },
    Stop,
}

pub struct MusicAudio {
    sender: Option<Sender<Command>>,
    worker: Option<JoinHandle<()>>,
}

impl MusicAudio {
    pub fn new(library: PathBuf, emit: Emit) -> Result<Self, String> {
        let (sender, inbox) = mpsc::channel();
        let worker = std::thread::Builder::new()
            .name("tsugi-music-audio".into())
            .spawn(move || run(&library, &emit, &inbox))
            .map_err(|_| "Could not start native music engine.".to_string())?;
        Ok(Self {
            sender: Some(sender),
            worker: Some(worker),
        })
    }

    pub fn send(&self, command: Command) -> bool {
        self.sender
            .as_ref()
            .is_some_and(|sender| sender.send(command).is_ok())
    }
}

impl Drop for MusicAudio {
    fn drop(&mut self) {
        self.sender.take();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn allowed_url(value: &str) -> bool {
    if value.len() > 16384 || value.contains('\0') {
        return false;
    }
    let Ok(url) = url::Url::parse(value) else {
        return false;
    };
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port_or_known_default() == Some(443)
        && url
            .host_str()
            .is_some_and(|host| host == "googlevideo.com" || host.ends_with(".googlevideo.com"))
}

fn probe_status(status: u16) -> &'static str {
    match status {
        200 | 206 => "HTTPS stream responds; native decoder or transport failed.",
        401 => "The stream server requires authorization (HTTP 401).",
        403 => "The stream server refused access (HTTP 403).",
        404 => "The stream is not available (HTTP 404).",
        410 => "The stream has expired or been removed (HTTP 410).",
        416 => "The stream rejected the byte range (HTTP 416).",
        429 => "The stream server is rate limiting playback (HTTP 429).",
        300..=399 => "The stream server returned a redirect.",
        500..=599 => "The stream server returned a server error.",
        _ => "The stream server returned an unexpected HTTP status.",
    }
}

// Recognize only fixed categories; never return a raw log, URL or query.
fn classify_log(text: &str) -> Option<&'static str> {
    let line = text.to_ascii_lowercase();
    for (code, phrase) in [
        (401, "401 unauthorized"),
        (403, "403 forbidden"),
        (404, "404 not found"),
        (410, "410 gone"),
        (416, "416 range"),
        (429, "429 too many requests"),
    ] {
        if line.contains(phrase)
            || line.contains(&format!("http error {code}"))
            || line.contains(&format!("response code: {code}"))
            || line.contains(&format!("returned error: {code}"))
        {
            return Some(probe_status(code));
        }
    }
    if line.contains("certificate") || line.contains("tls handshake") {
        return Some("Native audio HTTPS certificate or TLS handshake failed.");
    }
    if line.contains("audio device") || line.contains("audio output") {
        return Some("Native audio output could not initialize.");
    }
    if line.contains("decoder") || line.contains("unrecognized file format") {
        return Some("Native audio could not decode the returned media.");
    }
    None
}

fn report(
    emit: &Emit,
    request: &str,
    status: &str,
    position: f64,
    duration: f64,
    error: Option<&str>,
) {
    emit(Outbound::MusicAudioState {
        request: request.to_string(),
        status: status.to_string(),
        position,
        duration,
        error: error.map(String::from),
    });
}

fn fail(emit: &Emit, request: &str, message: &str) {
    // Never log a signed stream URL or raw network diagnostic.
    log::warn!("native music: {message}");
    report(emit, request, "error", 0.0, 0.0, Some(message));
}

// The bridge sends a closed numeric enum, never arbitrary filter strings.
const METER_FLAG: u8 = 8;
const METER_PROPERTY: &str = "af-metadata/tsugi-meter/by-key/lavfi.astats.Overall.RMS_level";
fn dsp_mode(value: f64) -> Option<u8> {
    if !value.is_finite() || value.fract() != 0.0 || !(0.0..=13.0).contains(&value) { return None; }
    let mode = value as u8;
    (mode & 7 <= 5).then_some(mode)
}
fn dsp_filters(mode: u8) -> String {
    let gains = match mode & 7 {
        2 => Some((2, 0, -1)),
        3 => Some((5, -1, -1)),
        4 => Some((-1, 3, 1)),
        5 => Some((-1, 0, 4)),
        _ => None,
    };
    let mut filters = Vec::new();
    if let Some((low, mid, high)) = gains {
        filters.push(format!("@tsugi-eq:lavfi=[volume=-6dB,bass=f=140:g={low},equalizer=f=1100:t=q:w=0.8:g={mid},treble=f=6500:g={high}]"));
    }
    if mode & METER_FLAG != 0 {
        filters.push("@tsugi-meter:astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=RMS_level".into());
    }
    filters.join(",")
}
fn meter_level(value: &str) -> Option<f64> {
    if value == "-inf" { return Some(0.0); }
    let db: f64 = value.parse().ok()?;
    db.is_finite().then(|| ((db + 55.0) / 55.0).clamp(0.0, 1.0))
}

struct Session {
    // Field order matters: destroy mpv before the registered callback context.
    mpv: Mpv,
    source: Arc<Source>,
    request: String,
    started: Instant,
    loaded: bool,
    position: f64,
    duration: f64,
    last_report: Instant,
    failure: Option<&'static str>,
    finished: bool,
    drained: bool,
    timing_reported: bool,
    cache_key: Option<String>,
    cache_recorded: bool,
    dsp: u8,
    last_meter: Instant,
}

impl Session {
    fn new(
        library: &Path,
        request: String,
        source: Arc<Source>,
        volume: f64,
    ) -> Result<Self, String> {
        // The Arc allocation remains stable across Session moves.
        let mpv = Mpv::new(
            library,
            &[
                ("config", "no"),
                ("idle", "yes"),
                ("keep-open", "no"),
                ("force-window", "no"),
                ("vid", "no"),
                ("vo", "null"),
                ("audio-display", "no"),
                ("ytdl", "no"),
                ("load-scripts", "no"),
                ("input-default-bindings", "no"),
                ("network-timeout", "12"),
                ("tls-verify", "yes"),
                ("audio-client-name", "Tsugi"),
            ],
        )?;
        mpv.request_log_messages("warn")?;
        mpv.set_property("volume", &(volume.clamp(0.0, 1.0) * 100.0).to_string())?;
        // SAFETY: source is created before mpv and lives after it in Session.
        unsafe { music_stream::register(&mpv, &source)? };
        mpv.command(&["loadfile", "tsugi-audio://track", "replace"])?;
        let now = Instant::now();
        Ok(Self {
            mpv,
            source,
            request,
            started: now,
            loaded: false,
            position: 0.0,
            duration: 0.0,
            last_report: now,
            failure: None,
            finished: false,
            drained: false,
            timing_reported: false,
            cache_key: None,
            cache_recorded: false,
            dsp: 0,
            last_meter: now,
        })
    }

    fn update(&mut self, emit: &Emit) -> bool {
        if let Some(message) = self.source.failure() {
            fail(emit, &self.request, message);
            return false;
        }
        if self.drained {
            if !self.source.transfer_verified() { return true; }
            self.finished = true;
            report(emit, &self.request, "ended", self.duration, self.duration, None);
            return false;
        }
        for _ in 0..64 {
            let Some(event) = self.mpv.wait_event(0.0, |_| false) else {
                break;
            };
            match event {
                Event::FileLoaded => self.loaded = true,
                Event::Log { text, .. } => {
                    if let Some(message) = classify_log(&text) {
                        self.failure = Some(message);
                    }
                }
                Event::EndFile { reason, .. } => {
                    if reason == "eof" && self.loaded && self.source.failure().is_none() {
                        if !self.source.transfer_verified() {
                            self.drained = true;
                            return true;
                        }
                        self.finished = true;
                        report(
                            emit,
                            &self.request,
                            "ended",
                            self.duration,
                            self.duration,
                            None,
                        );
                    } else {
                        let message = self.source.failure().or(self.failure).unwrap_or(
                            "Native decoder could not open or complete validated audio.",
                        );
                        fail(emit, &self.request, message);
                    }
                    return false;
                }
                Event::Shutdown => {
                    fail(emit, &self.request, "Native music engine stopped.");
                    return false;
                }
                _ => {}
            }
        }
        if !self.loaded && self.started.elapsed() > Duration::from_secs(20) {
            let message = self
                .source
                .failure()
                .or(self.failure)
                .unwrap_or("Native audio timed out opening the stream.");
            fail(emit, &self.request, message);
            return false;
        }
        if self.loaded && self.dsp & METER_FLAG != 0 && self.last_meter.elapsed() >= Duration::from_millis(80) {
            if let Some(level) = self.mpv.get_property(METER_PROPERTY, Kind::String)
                .and_then(|value| value.as_str().and_then(meter_level))
            {
                emit(Outbound::MusicAudioMeter { request: self.request.clone(), level });
            }
            self.last_meter = Instant::now();
        }
        if self.loaded && self.last_report.elapsed() >= Duration::from_millis(200) {
            let number = |name| {
                self.mpv
                    .get_property(name, Kind::Double)
                    .and_then(|value| value.as_f64())
                    .filter(|value| value.is_finite() && *value >= 0.0)
            };
            let flag = |name| {
                self.mpv
                    .get_property(name, Kind::Flag)
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false)
            };
            self.position = number("time-pos").unwrap_or(self.position);
            self.duration = number("duration").unwrap_or(self.duration);
            let status = if flag("pause") {
                "paused"
            } else if flag("paused-for-cache") {
                "loading"
            } else {
                "playing"
            };
            if status == "playing" && !self.timing_reported {
                self.timing_reported = true;
                log::info!("native music: decoder ready in {} ms", self.started.elapsed().as_millis());
            }
            report(
                emit,
                &self.request,
                status,
                self.position,
                self.duration,
                None,
            );
            self.last_report = Instant::now();
        }
        true
    }

    fn configure_dsp(&mut self, value: f64, emit: &Emit) {
        let Some(mode) = dsp_mode(value) else { return; };
        if !self.loaded || self.dsp == mode { return; }
        match self.mpv.set_property("af", &dsp_filters(mode)) {
            Ok(()) => {
                self.dsp = mode;
                emit(Outbound::MusicAudioDsp { request: self.request.clone(), error: None });
            }
            Err(_) => {
                // Optional DSP must never enter the fatal transport/control path.
                let _ = self.mpv.set_property("af", &dsp_filters(self.dsp));
                emit(Outbound::MusicAudioDsp { request: self.request.clone(), error: Some("Native audio effects could not be applied.".into()) });
            }
        }
    }

    fn control(&self, action: &str, value: f64) -> Result<(), String> {
        match action {
            "pause" => self
                .mpv
                .set_property("pause", if value > 0.0 { "yes" } else { "no" }),
            "volume" => self
                .mpv
                .set_property("volume", &(value.clamp(0.0, 1.0) * 100.0).to_string()),
            "seek" => self.mpv.command(&[
                "seek",
                &value.clamp(0.0, 86400.0).to_string(),
                "absolute",
                "exact",
            ]),
            _ => Ok(()),
        }
    }
}

struct Pending {
    request: String,
    url: String,
    volume: f64,
    transfer: Transfer,
    started: Instant,
    decoding: bool,
}

// A single, short-lived, in-memory buffer. No signed URLs, disk cache or
// additional provider requests. It shares the active player's allocation.
const REPLAY_TTL: Duration = Duration::from_secs(120);
struct Replay {
    url: String,
    source: Arc<Source>,
    stored: Instant,
}
impl Replay {
    fn usable(&self, url: &str, now: Instant) -> bool {
        self.url == url
            && crate::music_resolver::is_target(url)
            && now.saturating_duration_since(self.stored) < REPLAY_TTL
            && self.source.failure().is_none()
    }
}

// At most one speculative transfer; bounded by the same 64 MiB transport cap.
const PREFETCH_TTL: Duration = Duration::from_secs(600);
struct Prefetch {
    owner: String,
    url: String,
    started: Instant,
    transfer: Option<Transfer>,
    source: Option<Arc<Source>>,
}
impl Prefetch {
    fn matches(&self, url: &str, now: Instant) -> bool {
        self.url == url && crate::music_resolver::is_target(url)
            && now.saturating_duration_since(self.started) < PREFETCH_TTL
    }
}

fn start_session(
    library: &Path,
    emit: &Emit,
    request: String,
    source: Arc<Source>,
    volume: f64,
) -> Option<Session> {
    match Session::new(library, request.clone(), source, volume) {
        Ok(player) => Some(player),
        Err(_) => {
            fail(
                emit,
                &request,
                "Could not initialize native audio playback.",
            );
            None
        }
    }
}

fn run(library: &Path, emit: &Emit, inbox: &Receiver<Command>) {
    let mut session: Option<Session> = None;
    let mut pending: Option<Pending> = None;
    let mut replay: Option<Replay> = None;
    let mut prefetch: Option<Prefetch> = None;
    let mut youtube_session = crate::music_resolver::session_revision();
    loop {
        let current_session = crate::music_resolver::session_revision();
        if youtube_session != current_session {
            // Opting out must discard already downloaded authenticated audio as
            // well as pending extraction. A later Play starts a fresh request.
            if let Some(item) = pending.take() {
                fail(emit, &item.request, "YouTube session changed. Play the track again.");
            }
            if let Some(player) = session.take() {
                report(emit, &player.request, "paused", player.position, player.duration, None);
            }
            replay = None;
            prefetch = None;
            youtube_session = current_session;
        }
        if prefetch.as_ref().is_some_and(|item| !item.matches(&item.url, Instant::now())) {
            prefetch = None;
        }
        if replay.as_ref().is_some_and(|item| !item.usable(&item.url, Instant::now())) {
            replay = None;
        }
        match inbox.recv_timeout(Duration::from_millis(50)) {
            Ok(Command::Load {
                request,
                url,
                volume,
            }) => {
                // A fresh instance isolates queued EOF/property events from the previous track.
                pending.take();
                session.take();
                let prepared = prefetch.take().filter(|item| item.matches(&url, Instant::now()));
                if !volume.is_finite() {
                    fail(emit, &request, "Invalid native music stream.");
                    continue;
                }
                report(emit, &request, "loading", 0.0, 0.0, None);
                if cfg!(windows) {
                    if replay.as_ref().is_some_and(|item| item.usable(&url, Instant::now())) {
                        let item = replay.take().expect("checked replay");
                        log::info!("native music: reused a validated audio buffer");
                        session = start_session(library, emit, request, item.source, volume);
                        if let Some(player) = &mut session {
                            player.cache_key = Some(url);
                        }
                        continue;
                    }
                    // Do not retain an unrelated buffer while receiving a new one.
                    replay = None;
                    let started = Instant::now();
                    let mut prepared = prepared;
                    if let Some(source) = prepared.as_mut().and_then(|item| item.source.take()) {
                        log::info!("native music: used prefetched audio");
                        session = start_session(library, emit, request, source, volume);
                        if let Some(player) = &mut session { player.cache_key = Some(url); }
                        continue;
                    }
                    let transfer = match prepared.and_then(|mut item| item.transfer.take()) {
                        Some(transfer) => Ok(transfer),
                        None => Transfer::start(&url),
                    };
                    match transfer {
                        Ok(transfer) => {
                            pending = Some(Pending {
                                request,
                                url,
                                volume,
                                transfer,
                                started,
                                decoding: false,
                            });
                        }
                        Err(message) => fail(emit, &request, message),
                    }
                } else if allowed_url(&url) {
                    session = start_session(
                        library,
                        emit,
                        request,
                        Source::new(&url, Vec::new()),
                        volume,
                    );
                } else {
                    fail(emit, &request, "Invalid native music stream.");
                }
            }
            Ok(Command::Prefetch { request, url }) => {
                // A stale frontend request cannot replace another session's slot.
                if prefetch.as_ref().is_some_and(|item| item.owner == request)
                    && url.as_ref().is_none_or(|target| prefetch.as_ref().is_some_and(|item| item.url != *target))
                { prefetch = None; }
                if cfg!(windows) && let Some(url) = url
                    && crate::music_resolver::is_target(&url)
                    && session.as_ref().is_some_and(|player| player.request == request
                        && player.timing_reported && player.failure.is_none()
                        && player.cache_key.as_deref() != Some(url.as_str()))
                    && prefetch.is_none()
                    && let Ok(transfer) = Transfer::start(&url)
                {
                    prefetch = Some(Prefetch { owner: request, url, started: Instant::now(), transfer: Some(transfer), source: None });
                }
            }
            Ok(Command::Control {
                request,
                action,
                value,
            }) => {
                if action == "stop" && prefetch.as_ref().is_some_and(|item| item.owner == request) {
                    prefetch = None;
                }
                if pending.as_ref().is_some_and(|item| item.request == request) {
                    if action == "stop" || action == "advance" {
                        pending.take();
                    } else if action == "volume"
                        && value.is_finite()
                        && let Some(item) = &mut pending
                    {
                        item.volume = value;
                    }
                }
                if session
                    .as_ref()
                    .is_some_and(|player| player.request == request)
                {
                    if action == "stop" || action == "advance" {
                        if action == "stop" { replay = None; }
                        session.take();
                    } else if action == "dsp" {
                        if let Some(player) = &mut session { player.configure_dsp(value, emit); }
                    } else if value.is_finite()
                        && let Some(player) = &session
                        && player.control(&action, value).is_err()
                    {
                        fail(emit, &request, "Native audio control failed.");
                        if pending.as_ref().is_some_and(|item| item.request == request) { pending.take(); }
                        session.take();
                        replay = None;
                        prefetch = None;
                    }
                }
            }
            Ok(Command::Stop) => {
                pending.take();
                session.take();
                replay = None;
                prefetch = None;
            }
            Err(RecvTimeoutError::Disconnected) => return,
            Err(RecvTimeoutError::Timeout) => {}
        }
        let speculative = prefetch.as_mut().and_then(|item| item.transfer.as_mut())
            .and_then(|transfer| transfer.poll().transpose().map(|result| (result, transfer.progressive_audio())));
        if let Some((result, audio)) = speculative {
            match result.and_then(|bytes| match audio {
                Some(audio) => Ok(Source::from_progressive(audio)),
                None => Source::from_bytes(bytes),
            }) {
                Ok(source) => if let Some(item) = &mut prefetch {
                    item.transfer.take();
                    item.source = Some(source);
                },
                Err(_) => { prefetch = None; }
            }
        }
        let mut failed_start = false;
        if let Some(item) = &mut pending
            && !item.decoding
            && let Some(audio) = item.transfer.progressive_audio()
            && audio.ready()
        {
            // The downloader continues producing in parallel. Decoding is no
            // longer gated on the end of the track's transfer.
            log::info!("native music: first audio buffer ready in {} ms", item.started.elapsed().as_millis());
            session = start_session(library, emit, item.request.clone(), Source::from_progressive(audio), item.volume);
            if let Some(player) = &mut session { player.cache_key = Some(item.url.clone()); }
            item.decoding = session.is_some();
            failed_start = session.is_none();
        }
        if failed_start { pending.take(); }
        let ready = pending
            .as_mut()
            .and_then(|item| item.transfer.poll().transpose());
        if let Some(result) = ready
            && let Some(item) = pending.take()
        {
            match result {
                Ok(bytes) => {
                    log::info!("native music: resolver and transfer completed in {} ms", item.started.elapsed().as_millis());
                    if !item.decoding {
                        let source = match item.transfer.progressive_audio() {
                            Some(audio) => Ok(Source::from_progressive(audio)),
                            None => Source::from_bytes(bytes),
                        };
                        match source {
                            Ok(source) => {
                                session = start_session(library, emit, item.request, source, item.volume);
                                if let Some(player) = &mut session { player.cache_key = Some(item.url); }
                            }
                            Err(message) => fail(emit, &item.request, message),
                        }
                    }
                }
                Err(message) => {
                    if session.as_ref().is_some_and(|player| player.request == item.request) { session.take(); }
                    replay = None;
                    prefetch = None;
                    fail(emit, &item.request, message);
                },
            }
        }
        if let Some(player) = &mut session {
            let alive = player.update(emit);
            if alive && player.timing_reported && !player.cache_recorded && player.failure.is_none()
                && player.source.failure().is_none()
                && let Some(url) = &player.cache_key
            {
                replay = Some(Replay { url: url.clone(), source: player.source.clone(), stored: Instant::now() });
                player.cache_recorded = true;
            }
            if !alive {
                if pending.as_ref().is_some_and(|item| item.request == player.request) { pending.take(); }
                if !player.finished { replay = None; prefetch = None; }
                session.take();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn verify_progressive_decoder(library: &Path) {
        use crate::music_resolver::ProgressiveAudio;
        for (name, bytes) in [
            ("WebM/Opus", &include_bytes!("../tests/fixtures/progressive-tone.webm")[..]),
            ("M4A/AAC", &include_bytes!("../tests/fixtures/progressive-tone.m4a")[..]),
        ] {
            let initial = 64 * 1024;
            let audio = ProgressiveAudio::new();
            if name == "M4A/AAC" {
                assert_eq!(bytes.get(4..8), Some(b"ftyp".as_slice()));
                audio.set_length(bytes.len() as u64);
                assert_eq!(audio.length(), Some(bytes.len() as u64));
            } else {
                assert!(bytes.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]));
                assert_eq!(audio.length(), None);
            }
            audio.append(&bytes[..initial]).unwrap();
            let source = Source::from_progressive(audio.clone());
            let mpv = Mpv::new(library, &[
                ("config", "no"), ("idle", "yes"), ("keep-open", "no"),
                ("force-window", "no"), ("vid", "no"), ("vo", "null"),
                ("ao", "null"), ("audio-display", "no"), ("ytdl", "no"),
                ("load-scripts", "no"), ("input-default-bindings", "no"),
                ("network-timeout", "12"), ("tls-verify", "yes"),
            ]).expect("load real mpv for progressive playback");
            // SAFETY: source remains alive until this mpv instance is dropped.
            unsafe { music_stream::register(&mpv, &source).unwrap(); }
            let result = (|| -> Result<(), String> {
                let started = Instant::now();
                mpv.command(&["loadfile", "tsugi-audio://track", "replace"])?;
                let deadline = Instant::now() + Duration::from_secs(3);
                let position = || mpv.get_property("time-pos", Kind::Double).and_then(|value| value.as_f64());
                let mut decoded = false;
                while Instant::now() < deadline {
                    mpv.wait_event(0.02, |_| false);
                    if position().is_some_and(|value| value > 0.05) { decoded = true; break; }
                }
                if !decoded { return Err(format!("{name} did not decode from its initial {initial} bytes before producer EOF")); }
                if audio.verified() { return Err("fixture ended the producer before asserting startup".into()); }
                println!("PASS: {name} decoded before transfer completion in {} ms ({initial} / {} bytes)", started.elapsed().as_millis(), bytes.len());
                let partial_end = bytes.len() * 3 / 4;
                let future_bytes = bytes[initial..partial_end].to_vec();
                let producer = audio.clone();
                let fill = std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(100));
                    producer.append(&future_bytes).unwrap();
                });
                mpv.command(&["seek", "12", "absolute", "exact"])?;
                let deadline = Instant::now() + Duration::from_secs(3);
                let mut sought = false;
                while Instant::now() < deadline {
                    mpv.wait_event(0.02, |_| false);
                    if position().is_some_and(|value| value >= 11.5) { sought = true; break; }
                }
                fill.join().map_err(|_| "future-byte producer failed".to_owned())?;
                if !sought { return Err(format!("{name} did not seek to newly arriving bytes before producer EOF")); }
                if audio.verified() { return Err("producer reached EOF before seek acceptance".into()); }
                audio.append(&bytes[partial_end..]).map_err(str::to_owned)?;
                audio.finish(None);
                Ok(())
            })();
            audio.finish(Some("Progressive fixture ended."));
            drop(mpv);
            result.expect("real progressive native decode and seek");
        }
    }

    #[cfg(all(windows, target_arch = "x86_64"))]
    #[test]
    fn native_progressive_audio_decodes_before_transfer_completion() {
        let library = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../vendor/x86_64/libmpv-2.dll");
        if !library.is_file() {
            assert!(std::env::var_os("CI").is_none(), "CI did not stage the pinned mpv DLL");
            return;
        }
        let _vulkan = unsafe { libloading::Library::new(library.with_file_name("vulkan").join("vulkan-1.dll")) }.ok();
        verify_progressive_decoder(&library);
    }

    #[cfg(unix)]
    #[test]
    #[ignore = "requires an explicitly supplied local libmpv test runtime"]
    fn local_progressive_audio_decodes_before_transfer_completion() {
        let library = PathBuf::from(std::env::var_os("TSUGI_MPV_TEST_LIBRARY").expect("set local libmpv test runtime"));
        verify_progressive_decoder(&library);
    }

    #[test]
    fn native_dsp_is_a_closed_enum_and_meter_is_bounded() {
        for value in [-1.0, 1.5, 6.0, 7.0, 14.0, f64::NAN, f64::INFINITY] { assert!(dsp_mode(value).is_none()); }
        assert_eq!(dsp_mode(11.0), Some(11));
        assert_eq!(dsp_filters(0), "");
        assert_eq!(dsp_filters(1), "");
        assert!(dsp_filters(3).contains("bass=f=140:g=5"));
        assert!(!dsp_filters(3).contains("astats"));
        assert!(dsp_filters(11).contains("RMS_level"));
        assert_eq!(meter_level("-inf"), Some(0.0));
        assert_eq!(meter_level("-55"), Some(0.0));
        assert_eq!(meter_level("2"), Some(1.0));
        assert_eq!(meter_level("NaN"), None);
    }

    // Exercise the real pinned mpv DLL on the existing Windows validation
    // runner with a generated sine, null audio output and no network access.
    #[cfg(all(windows, target_arch = "x86_64"))]
    #[test]
    fn native_dsp_filters_and_metadata_on_pinned_mpv() {
        let library = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../vendor/x86_64/libmpv-2.dll");
        if !library.is_file() {
            assert!(std::env::var_os("CI").is_none(), "CI did not stage the pinned mpv DLL");
            return;
        }
        let library = library.canonicalize().expect("resolve pinned mpv");
        let _vulkan = unsafe { libloading::Library::new(library.with_file_name("vulkan").join("vulkan-1.dll")) }.ok();
        let mpv = Mpv::new(&library, &[("config","no"),("idle","yes"),("vid","no"),("vo","null"),("ao","null"),("audio-display","no"),("load-scripts","no"),("ytdl","no")]).expect("load pinned mpv");
        let path = std::env::temp_dir().join(format!("tsugi-dsp-test-{}.wav", std::process::id()));
        let samples = 48_000u32 * 4;
        let size = samples * 2;
        let mut wav = Vec::with_capacity((size + 44) as usize);
        wav.extend(b"RIFF"); wav.extend((36 + size).to_le_bytes()); wav.extend(b"WAVEfmt ");
        wav.extend(16u32.to_le_bytes()); wav.extend(1u16.to_le_bytes()); wav.extend(1u16.to_le_bytes());
        wav.extend(48_000u32.to_le_bytes()); wav.extend(96_000u32.to_le_bytes());
        wav.extend(2u16.to_le_bytes()); wav.extend(16u16.to_le_bytes()); wav.extend(b"data"); wav.extend(size.to_le_bytes());
        for i in 0..samples {
            let value = (6000.0 * (i as f64 * 440.0 * std::f64::consts::TAU / 48_000.0).sin()) as i16;
            wav.extend(value.to_le_bytes());
        }
        std::fs::write(&path, wav).expect("write fixture");
        let result = (|| -> Result<f64, String> {
            mpv.command(&["loadfile", path.to_str().ok_or("invalid fixture path")?, "replace"])?;
            let deadline = Instant::now() + Duration::from_secs(8);
            while Instant::now() < deadline {
                match mpv.wait_event(0.05, |_| false) {
                    Some(Event::FileLoaded) => { mpv.set_property("af", &dsp_filters(11))?; }
                    Some(Event::EndFile { .. }) => break,
                    _ => {}
                }
                if let Some(level) = mpv.get_property(METER_PROPERTY, Kind::String).and_then(|value| value.as_str().and_then(meter_level))
                    && level > 0.0
                {
                    mpv.set_property("af", "")?;
                    return Ok(level);
                }
            }
            Err("No real RMS metadata from pinned mpv".into())
        })();
        drop(mpv);
        let _ = std::fs::remove_file(&path);
        assert!(result.is_ok(), "{result:?}");
    }

    #[test]
    fn classifies_failures_without_exposing_stream_urls() {
        assert_eq!(
            classify_log("https: HTTP error 403 https://example.test/?private=hidden"),
            Some(probe_status(403))
        );
        assert_eq!(
            classify_log("The requested URL returned error: 429"),
            Some(probe_status(429))
        );
        assert_eq!(classify_log("https://example.test/?private=hidden"), None);
        assert!(probe_status(206).contains("responds"));
        assert!(probe_status(416).contains("416"));
    }

    #[test]
    fn replay_is_exact_target_bounded_by_time_and_reuses_allocation() {
        let source = Source::from_bytes(b"\x00\x00\x00\x18ftypM4A ".to_vec()).unwrap_or_else(|_| panic!("fixture header"));
        let now = Instant::now();
        let url = "https://www.youtube.com/watch?v=abcdefghijk";
        let replay = Replay { url: url.into(), source: source.clone(), stored: now };
        assert!(replay.usable(url, now));
        assert!(Arc::ptr_eq(&source, &replay.source));
        assert!(!replay.usable("https://www.youtube.com/watch?v=abcdefghijl", now));
        assert!(!replay.usable(url, now + REPLAY_TTL));
        assert!(!replay.usable("file:///test", now));
    }

    #[test]
    fn prefetched_audio_is_exact_target_and_expires() {
        let now = Instant::now();
        let url = "https://www.youtube.com/watch?v=abcdefghijk";
        let item = Prefetch { owner: "first".into(), url: url.into(), started: now, transfer: None, source: None };
        assert!(item.matches(url, now));
        assert!(!item.matches("https://www.youtube.com/watch?v=abcdefghijl", now));
        assert!(!item.matches(url, now + PREFETCH_TTL));
    }

    #[test]
    fn only_direct_https_media_hosts_are_accepted() {
        assert!(allowed_url("https://rr1.googlevideo.com/videoplayback?x=1"));
        for url in [
            "file:///C:/test.mp3",
            "http://rr1.googlevideo.com/test",
            "https://googlevideo.com.evil.test/a",
            "https://user:pass@googlevideo.com/a",
            "https://googlevideo.com:8443/a",
        ] {
            assert!(!allowed_url(url));
        }
    }
}
