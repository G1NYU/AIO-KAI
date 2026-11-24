//! Audio-only playback, separate from the video player's mpv handle.
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use crate::bridge::Outbound;
use crate::mpv::{Event, Kind, Mpv};
use crate::player::Emit;

pub enum Command {
    Load {
        request: String,
        url: String,
        volume: f64,
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

struct Session {
    mpv: Mpv,
    request: String,
    started: Instant,
    loaded: bool,
    position: f64,
    duration: f64,
    last_report: Instant,
    failure: Option<&'static str>,
}

impl Session {
    fn new(library: &Path, request: String, url: &str, volume: f64) -> Result<Self, String> {
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
        mpv.command(&["loadfile", url, "replace"])?;
        let now = Instant::now();
        Ok(Self {
            mpv,
            request,
            started: now,
            loaded: false,
            position: 0.0,
            duration: 0.0,
            last_report: now,
            failure: None,
        })
    }

    fn update(&mut self, emit: &Emit) -> bool {
        for _ in 0..64 {
            let Some(event) = self.mpv.wait_event(0.0, |_| false) else {
                break;
            };
            match event {
                Event::FileLoaded => self.loaded = true,
                Event::Log { text, .. } => {
                    // Only classify known HTTP errors; never emit the raw log.
                    if text.contains("403 Forbidden") || text.contains("HTTP error 403") {
                        self.failure = Some("The stream server refused access (HTTP 403).");
                    } else if text.contains("401 Unauthorized") {
                        self.failure = Some("The stream server requires authorization (HTTP 401).");
                    } else if text.contains("429 Too Many Requests") {
                        self.failure = Some("The stream server is rate limiting playback (HTTP 429).");
                    }
                }
                Event::EndFile { reason, .. } => {
                    if reason == "eof" && self.loaded {
                        report(
                            emit,
                            &self.request,
                            "ended",
                            self.duration,
                            self.duration,
                            None,
                        );
                    } else {
                        fail(
                            emit,
                            &self.request,
                            self.failure
                                .unwrap_or("Native audio could not open or complete this stream."),
                        );
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
            fail(
                emit,
                &self.request,
                "Native audio timed out opening the stream.",
            );
            return false;
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
            report(emit, &self.request, status, self.position, self.duration, None);
            self.last_report = Instant::now();
        }
        true
    }

    fn control(&self, action: &str, value: f64) -> Result<(), String> {
        match action {
            "pause" => self.mpv.set_property("pause", if value > 0.0 { "yes" } else { "no" }),
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

fn run(library: &Path, emit: &Emit, inbox: &Receiver<Command>) {
    let mut session: Option<Session> = None;
    loop {
        match inbox.recv_timeout(Duration::from_millis(50)) {
            Ok(Command::Load {
                request,
                url,
                volume,
            }) => {
                // A fresh instance isolates queued EOF/property events from the previous track.
                session.take();
                if !allowed_url(&url) || !volume.is_finite() {
                    fail(emit, &request, "Invalid native music stream.");
                    continue;
                }
                report(emit, &request, "loading", 0.0, 0.0, None);
                match Session::new(library, request.clone(), &url, volume) {
                    Ok(player) => session = Some(player),
                    Err(_) => fail(emit, &request, "Could not initialize native audio playback."),
                }
            }
            Ok(Command::Control {
                request,
                action,
                value,
            }) => {
                if session.as_ref().is_some_and(|player| player.request == request) {
                    if action == "stop" {
                        session.take();
                    } else if value.is_finite()
                        && let Some(player) = &session
                        && player.control(&action, value).is_err()
                    {
                        fail(emit, &request, "Native audio control failed.");
                        session.take();
                    }
                }
            }
            Ok(Command::Stop) => {
                session.take();
            }
            Err(RecvTimeoutError::Disconnected) => return,
            Err(RecvTimeoutError::Timeout) => {}
        }
        if session.as_mut().is_some_and(|player| !player.update(emit)) {
            session.take();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
