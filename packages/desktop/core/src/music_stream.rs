//! Bounded, seekable HTTPS media reader for the independent music decoder.
//! The URL is provided by the existing resolver, never rewritten. Authentication
//! errors are terminal; no redirects, retries, disk cache or credential forwarding.
use std::ffi::{CStr, c_char, c_int, c_void};
use std::io::Read;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::mpv::{Handle, Mpv};

const CHUNK: u64 = 512 * 1024;
const MAX_SIZE: u64 = 1024 * 1024 * 1024;
const URI: &CStr = c"tsugi-audio://track";
const LOAD_FAILED: c_int = -13;

pub(crate) struct Source {
    url: String,
    agent: ureq::Agent,
    failure: Mutex<Option<&'static str>>,
    #[cfg(test)]
    fixture: Option<Arc<Vec<u8>>>,
}

impl Source {
    pub(crate) fn new(url: &str) -> Arc<Self> {
        Arc::new(Self {
            url: url.to_owned(),
            agent: ureq::Agent::config_builder()
                .timeout_global(Some(Duration::from_secs(8)))
                .https_only(true)
                .max_redirects(0)
                .http_status_as_error(false)
                .build()
                .into(),
            failure: Mutex::new(None),
            #[cfg(test)]
            fixture: None,
        })
    }

    fn fail(&self, message: &'static str) {
        if let Ok(mut failure) = self.failure.lock() {
            *failure = Some(message);
        }
    }

    pub(crate) fn failure(&self) -> Option<&'static str> {
        self.failure.lock().ok().and_then(|value| *value)
    }

    fn fetch(&self, start: u64, total: Option<u64>) -> Result<Chunk, &'static str> {
        #[cfg(test)]
        if let Some(bytes) = &self.fixture {
            let size = bytes.len() as u64;
            if start >= size || total.is_some_and(|known| known != size) {
                return Err("Invalid fixture range.");
            }
            if start == 0 && !media_header(bytes) {
                return Err("Invalid fixture header.");
            }
            let end = (start + CHUNK).min(size);
            return Ok(Chunk {
                start,
                size,
                bytes: bytes[start as usize..end as usize].to_vec(),
            });
        }
        if self.failure().is_some() {
            return Err("The media reader has stopped.");
        }
        let end = (start + CHUNK - 1).min(total.unwrap_or(MAX_SIZE) - 1);
        let mut response = self
            .agent
            .get(&self.url)
            .header("Range", format!("bytes={start}-{end}"))
            .header("Accept-Encoding", "identity")
            // Each bounded request must work even when a server closes TLS.
            .header("Connection", "close")
            .call()
            .map_err(|_| "Music HTTPS transport could not connect.")?;
        let status = response.status().as_u16();
        if status != 206 {
            return Err(match status {
                200 => "Stream server did not honor the audio byte range (HTTP 200).",
                401 => "The stream server requires authorization (HTTP 401).",
                403 => "The stream server refused access (HTTP 403).",
                404 => "The stream is not available (HTTP 404).",
                410 => "The stream has expired (HTTP 410).",
                416 => "The stream rejected the byte range (HTTP 416).",
                429 => "The stream server is rate limiting playback (HTTP 429).",
                300..=399 => "The stream server returned an unsupported redirect.",
                _ => "The stream server returned an unexpected HTTP status.",
            });
        }
        let header = response
            .headers()
            .get("content-range")
            .and_then(|value| value.to_str().ok())
            .ok_or("Stream response has no Content-Range.")?;
        let (actual_start, actual_end, size) =
            parse_range(header).ok_or("Stream response has an invalid Content-Range.")?;
        if actual_start != start
            || actual_end != end.min(size - 1)
            || total.is_some_and(|known| known != size)
        {
            return Err("Stream response returned an inconsistent byte range.");
        }
        if response
            .headers()
            .get("content-encoding")
            .is_some_and(|value| value != "identity")
        {
            return Err("Stream response used an unsupported content encoding.");
        }
        let expected = (actual_end - start + 1) as usize;
        let mut bytes = Vec::with_capacity(expected);
        response
            .body_mut()
            .as_reader()
            .take(expected as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Music HTTPS transport could not read the audio bytes.")?;
        if bytes.len() != expected {
            return Err("Stream response contained incomplete audio bytes.");
        }
        if start == 0 && !media_header(&bytes) {
            return Err("HTTPS response does not contain a recognized MP4 or WebM audio header.");
        }
        Ok(Chunk { start, size, bytes })
    }
}

fn parse_range(header: &str) -> Option<(u64, u64, u64)> {
    let (range, size) = header.strip_prefix("bytes ")?.split_once('/')?;
    let (start, end) = range.split_once('-')?;
    let (start, end, size) = (start.parse().ok()?, end.parse().ok()?, size.parse().ok()?);
    if start <= end && end < size && size <= MAX_SIZE && end - start < CHUNK {
        Some((start, end, size))
    } else {
        None
    }
}

fn media_header(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0x1a, 0x45, 0xdf, 0xa3])
        || bytes.get(4..8).is_some_and(|kind| kind == b"ftyp")
}

struct Chunk {
    start: u64,
    size: u64,
    bytes: Vec<u8>,
}

struct Reader {
    source: Arc<Source>,
    chunk: Chunk,
    position: u64,
}

impl Reader {
    fn read(&mut self, output: &mut [u8]) -> Result<usize, &'static str> {
        if self.position >= self.chunk.size || output.is_empty() {
            return Ok(0);
        }
        if self.position < self.chunk.start
            || self.position - self.chunk.start >= self.chunk.bytes.len() as u64
        {
            let start = self.position / CHUNK * CHUNK;
            self.chunk = self.source.fetch(start, Some(self.chunk.size))?;
        }
        let offset = (self.position - self.chunk.start) as usize;
        let count = output.len().min(self.chunk.bytes.len() - offset);
        output[..count].copy_from_slice(&self.chunk.bytes[offset..offset + count]);
        self.position += count as u64;
        Ok(count)
    }
}

// ABI prefix shared by the old and current stream_cb.h. mpv initializes the
// optional trailing cancel_fn to null. Only the common fields are written.
#[repr(C)]
struct StreamInfo {
    cookie: *mut c_void,
    read: unsafe extern "C" fn(*mut c_void, *mut c_char, u64) -> i64,
    seek: unsafe extern "C" fn(*mut c_void, i64) -> i64,
    size: unsafe extern "C" fn(*mut c_void) -> i64,
    close: unsafe extern "C" fn(*mut c_void),
}

type Open = unsafe extern "C" fn(*mut c_void, *mut c_char, *mut StreamInfo) -> c_int;
type Register = unsafe extern "C" fn(Handle, *const c_char, *mut c_void, Open) -> c_int;

/// # Safety
/// Keep a strong reference to source alive until mpv has been destroyed.
pub(crate) unsafe fn register(mpv: &Mpv, source: &Arc<Source>) -> Result<(), String> {
    // SAFETY: matches mpv_stream_cb_add_ro in stream_cb.h. Arc keeps the
    // allocation at a stable address, owned by Session for the mpv lifetime.
    let register: Register = unsafe { mpv.symbol("mpv_stream_cb_add_ro")? };
    let code = unsafe {
        register(
            mpv.handle(),
            c"tsugi-audio".as_ptr(),
            Arc::as_ptr(source).cast_mut().cast(),
            open,
        )
    };
    if code < 0 {
        Err("Could not register the native HTTPS media reader.".into())
    } else {
        Ok(())
    }
}

unsafe extern "C" fn open(context: *mut c_void, uri: *mut c_char, info: *mut StreamInfo) -> c_int {
    if context.is_null() || uri.is_null() || info.is_null() {
        return LOAD_FAILED;
    }
    // SAFETY: mpv passes the registered source pointer and a NUL-terminated URI.
    if unsafe { CStr::from_ptr(uri) } != URI {
        return LOAD_FAILED;
    }
    let source = context.cast::<Source>();
    // SAFETY: registration guarantees a live Arc allocation. The increment
    // transfers one strong reference to the new stream cookie.
    let source = unsafe {
        Arc::increment_strong_count(source);
        Arc::from_raw(source)
    };
    let chunk = match source.fetch(0, None) {
        Ok(chunk) => chunk,
        Err(message) => {
            source.fail(message);
            return LOAD_FAILED;
        }
    };
    let reader = Box::new(Reader {
        source,
        chunk,
        position: 0,
    });
    // SAFETY: mpv provides writable callback storage; only ABI prefix fields
    // are touched. close() releases the cookie once mpv is finished.
    unsafe {
        std::ptr::write(
            info,
            StreamInfo {
                cookie: Box::into_raw(reader).cast(),
                read,
                seek,
                size,
                close,
            },
        );
    }
    0
}

unsafe extern "C" fn read(cookie: *mut c_void, buffer: *mut c_char, length: u64) -> i64 {
    if cookie.is_null() || buffer.is_null() {
        return -1;
    }
    // SAFETY: mpv serializes read/seek/size/close for each stream cookie and
    // supplies a writable buffer of length bytes. Limit each short read.
    let reader = unsafe { &mut *cookie.cast::<Reader>() };
    let output =
        unsafe { std::slice::from_raw_parts_mut(buffer.cast::<u8>(), length.min(CHUNK) as usize) };
    match reader.read(output) {
        Ok(count) => count as i64,
        Err(message) => {
            reader.source.fail(message);
            -1
        }
    }
}

unsafe extern "C" fn seek(cookie: *mut c_void, offset: i64) -> i64 {
    if cookie.is_null() || offset < 0 {
        return -1;
    }
    // SAFETY: cookie belongs to this stream until close.
    let reader = unsafe { &mut *cookie.cast::<Reader>() };
    if offset as u64 > reader.chunk.size {
        return -1;
    }
    reader.position = offset as u64;
    offset
}

unsafe extern "C" fn size(cookie: *mut c_void) -> i64 {
    if cookie.is_null() {
        return -1;
    }
    // SAFETY: cookie belongs to this stream until close.
    unsafe { &*cookie.cast::<Reader>() }.chunk.size as i64
}

unsafe extern "C" fn close(cookie: *mut c_void) {
    if !cookie.is_null() {
        // SAFETY: cookie was allocated by open and is closed exactly once by mpv.
        drop(unsafe { Box::from_raw(cookie.cast::<Reader>()) });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Real pinned libmpv, no GUI, no sound device. A moving playback clock
    // and an initialized audio track must both be observed, not just loadfile OK.
    fn headless_decode(source: &Arc<Source>) {
        use crate::mpv::{Event, Kind};
        use std::path::PathBuf;
        use std::time::Instant;

        let library = PathBuf::from(
            std::env::var_os("TSUGI_TEST_MPV").expect("TSUGI_TEST_MPV must point to libmpv"),
        );
        let mpv = Mpv::new(
            &library,
            &[
                ("config", "no"),
                ("idle", "yes"),
                ("vid", "no"),
                ("vo", "null"),
                ("ao", "null"),
                ("audio-display", "no"),
                ("ytdl", "no"),
                ("load-scripts", "no"),
                ("force-window", "no"),
            ],
        )
        .expect("initialize test decoder");
        // SAFETY: caller owns source until after this function drops mpv.
        unsafe { register(&mpv, source) }.expect("register test media reader");
        mpv.command(&["loadfile", "tsugi-audio://track", "replace"])
            .expect("load test media");
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut loaded = false;
        while Instant::now() < deadline {
            match mpv.wait_event(0.1, |_| false) {
                Some(Event::FileLoaded) => loaded = true,
                Some(Event::EndFile { .. } | Event::Shutdown) => {
                    panic!(
                        "decoder ended before playback: {}",
                        source.failure().unwrap_or("native decoder stopped")
                    );
                }
                _ => {}
            }
            let time = mpv
                .get_property("time-pos", Kind::Double)
                .and_then(|value| value.as_f64())
                .unwrap_or(0.0);
            let audio = mpv
                .get_property("audio-params", Kind::Json)
                .is_some_and(|value| !value.is_null());
            if loaded && audio && time > 0.2 {
                println!("Native audio track initialized; playback clock advanced.");
                return;
            }
        }
        panic!(
            "decoder did not start: {}",
            source.failure().unwrap_or("playback clock did not advance")
        );
    }

    #[test]
    #[ignore = "requires pinned libmpv and generated test tones"]
    fn headless_fixture_playback() {
        let directory = std::path::PathBuf::from(
            std::env::var_os("TSUGI_TEST_MEDIA_DIR").expect("TSUGI_TEST_MEDIA_DIR"),
        );
        for filename in ["tone.m4a", "tone.webm"] {
            let bytes = std::fs::read(directory.join(filename)).expect("read generated tone");
            let mut source = Source::new("https://example.test/unused");
            Arc::get_mut(&mut source).expect("unique source").fixture = Some(Arc::new(bytes));
            println!("Testing {filename} through the production callback.");
            headless_decode(&source);
        }
    }

    // Exercise the real HTTPS fetch and range parser using a local CA trusted
    // only by this test agent. Production TLS settings remain unchanged.
    #[test]
    #[ignore = "requires generated HTTPS fixtures and pinned libmpv"]
    fn headless_https_playback() {
        use ureq::tls::{Certificate, RootCerts, TlsConfig};

        let path = std::env::var_os("TSUGI_TEST_CA_DER").expect("test CA path");
        let root = std::fs::read(path).expect("read test CA");
        let cert = Certificate::from_der(&root).to_owned();
        let roots = RootCerts::new_with_certs(&[cert]);
        let base = std::env::var("TSUGI_TEST_HTTPS_BASE").expect("fixture server");
        assert!(base.starts_with("https://127.0.0.1:"));
        let source_for = |name: &str| {
            let mut source = Source::new(&format!("{base}/{name}"));
            Arc::get_mut(&mut source).expect("unique source").agent = ureq::Agent::config_builder()
                .timeout_global(Some(Duration::from_secs(8)))
                .https_only(true)
                .max_redirects(0)
                .http_status_as_error(false)
                .tls_config(TlsConfig::builder().root_certs(roots.clone()).build())
                .build()
                .into();
            source
        };
        let large = source_for("range.bin");
        let opening = large.fetch(0, None).expect("first HTTPS range");
        assert!(opening.size > CHUNK);
        let tail = large
            .fetch(CHUNK, Some(opening.size))
            .expect("second HTTPS range");
        assert_eq!(tail.start, CHUNK);
        assert!(tail.bytes.iter().all(|byte| *byte == 42));
        for (name, expected) in [
            ("refused", "The stream server refused access (HTTP 403)."),
            (
                "whole",
                "Stream server did not honor the audio byte range (HTTP 200).",
            ),
            (
                "bad-header",
                "Stream response has an invalid Content-Range.",
            ),
            (
                "html",
                "HTTPS response does not contain a recognized MP4 or WebM audio header.",
            ),
        ] {
            let result = source_for(name).fetch(0, None);
            assert_eq!(result.err(), Some(expected), "{name}");
        }
        for name in ["tone.m4a", "tone.webm"] {
            println!("Testing {name} via authenticated local HTTPS.");
            headless_decode(&source_for(name));
        }
    }

    #[test]
    #[ignore = "live provider test; service availability and runner IP vary"]
    fn headless_live_playback() {
        // Big Buck Bunny, Blender Foundation, CC BY 3.0.
        // https://peach.blender.org/about/
        // https://www.youtube.com/watch?v=YE7VzlLtp-4
        // Do not change client identity, access requirements or signed media URLs.
        let id = std::env::var("TSUGI_TEST_VIDEO_ID").unwrap_or_else(|_| "YE7VzlLtp-4".into());
        let result =
            crate::youtube::music_request("audio", &id).expect("public sample audio resolution");
        println!("Provider issued a direct audio URL (not logged).");
        let url = result["url"].as_str().expect("direct audio URL");
        let source = Source::new(url);
        let opening = source.fetch(0, None).expect("opening media bytes");
        println!("Opening range and media header verified.");
        if opening.size > CHUNK {
            let tail_start = (opening.size - 1) / CHUNK * CHUNK;
            source
                .fetch(tail_start, Some(opening.size))
                .expect("tail media bytes");
            println!("Tail range verified.");
        }
        headless_decode(&source);
    }

    #[test]
    fn validates_range_bounds_and_total() {
        assert_eq!(parse_range("bytes 0-511/512"), Some((0, 511, 512)));
        assert_eq!(
            parse_range("bytes 524288-524300/524301"),
            Some((524288, 524300, 524301))
        );
        for header in [
            "bytes 9-0/10",
            "bytes 0-10/10",
            "bytes 0-0/*",
            "bytes 0-524288/524289",
            "bytes 0-0/99999999999",
        ] {
            assert!(parse_range(header).is_none());
        }
    }

    #[test]
    fn rejects_non_media_responses() {
        assert!(media_header(b"\x00\x00\x00\x18ftypM4A "));
        assert!(media_header(&[0x1a, 0x45, 0xdf, 0xa3]));
        assert!(!media_header(b"<html>not audio</html>"));
        assert!(!media_header(b""));
    }

    #[test]
    fn buffered_reads_and_seeks_need_no_network() {
        let source = Source::new("https://example.test/unused");
        let mut reader = Reader {
            source,
            chunk: Chunk {
                start: 0,
                size: 6,
                bytes: b"abcdef".to_vec(),
            },
            position: 2,
        };
        let mut out = [0; 3];
        assert_eq!(reader.read(&mut out), Ok(3));
        assert_eq!(&out, b"cde");
        reader.position = 0;
        assert_eq!(reader.read(&mut out), Ok(3));
        assert_eq!(&out, b"abc");
        reader.position = 6;
        assert_eq!(reader.read(&mut out), Ok(0));
    }
}
