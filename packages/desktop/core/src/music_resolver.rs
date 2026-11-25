//! Windows music transport: yt-dlp owns the media request. No URL handoff.
use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

pub(crate) type MediaHeaders = Vec<(String, String)>;
const PREFIX: &str = "https://www.youtube.com/watch?v=";
const MAX_AUDIO: u64 = 64 * 1024 * 1024;
type Output = JoinHandle<Result<Vec<u8>, &'static str>>;

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

fn read_bounded(reader: impl Read, limit: u64) -> Result<Vec<u8>, &'static str> {
    let mut bytes = Vec::new();
    reader
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Could not read the music transfer output.")?;
    if bytes.len() as u64 > limit {
        return Err("Music transfer exceeded its size limit.");
    }
    Ok(bytes)
}

fn classify_error(stderr: &[u8]) -> &'static str {
    let error = String::from_utf8_lossy(stderr).to_ascii_lowercase();
    if error.contains("sign in") || error.contains("not a bot") {
        "YouTube requires sign-in or verification."
    } else if error.contains("403") {
        "YouTube refused access to this stream (HTTP 403)."
    } else if error.contains("429") {
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
}

impl Transfer {
    pub(crate) fn start(value: &str) -> Result<Self, &'static str> {
        Self::start_with(value, "bestaudio[protocol=https]", Duration::from_secs(25))
    }

    // An explicit authorized Vault export, distinct from the playback format.
    // No muxing, authentication cookies, plugins, or post-processors.
    pub(crate) fn start_export(value: &str) -> Result<Self, &'static str> {
        Self::start_with(value, "bestaudio[ext=m4a][protocol=https]", Duration::from_secs(120))
    }

    fn start_with(value: &str, format: &str, timeout: Duration) -> Result<Self, &'static str> {
        if !is_target(value) {
            return Err("Invalid YouTube Music track.");
        }
        let app = std::env::current_exe().map_err(|_| "Could not locate Tsugi.")?;
        let directory = app.parent().ok_or("Could not locate Tsugi.")?;
        let resolver = directory.join("music-tools").join("yt-dlp.exe");
        let runtime = directory.join("music-tools").join("deno.exe");
        if !resolver.is_file() || !runtime.is_file() {
            return Err("Bundled YouTube Music tools are missing from this installation.");
        }
        let mut command = Command::new(resolver);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command
            .args([
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
            .arg(format!("deno:{}", runtime.display()))
            .args(["-o", "-", "--", value])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|_| "Could not start the bundled music transport.")?;
        let stdout = child.stdout.take().expect("piped stdout");
        let stderr = child.stderr.take().expect("piped stderr");
        Ok(Self {
            child,
            stdout: Some(std::thread::spawn(move || read_bounded(stdout, MAX_AUDIO))),
            stderr: Some(std::thread::spawn(move || read_bounded(stderr, 256 * 1024))),
            deadline: Instant::now() + timeout,
        })
    }

    /// Poll without blocking the command worker. Discard incomplete transfers.
    pub(crate) fn poll(&mut self) -> Result<Option<Vec<u8>>, &'static str> {
        if Instant::now() >= self.deadline {
            return Err("YouTube Music transfer timed out.");
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
            return Err(classify_error(&stderr));
        }
        stdout.map(Some)
    }
}

impl Drop for Transfer {
    fn drop(&mut self) {
        if !matches!(self.child.try_wait(), Ok(Some(_))) {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
        // Reader threads own bounded allocations and no player state.
        // Do not wait on pipes possibly inherited by a subprocess.
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn bounds_binary_output() {
        assert_eq!(read_bounded(&b"abc"[..], 3), Ok(b"abc".to_vec()));
        assert!(read_bounded(&b"abcd"[..], 3).is_err());
    }

    #[test]
    fn errors_never_include_raw_provider_output() {
        assert_eq!(
            classify_error(b"ERROR: Sign in to confirm you are not a bot"),
            "YouTube requires sign-in or verification."
        );
        assert_eq!(
            classify_error(b"ERROR: HTTP Error 403: Forbidden"),
            "YouTube refused access to this stream (HTTP 403)."
        );
        assert!(!classify_error(b"https://example.test/?private=hidden").contains("hidden"));
    }
}
