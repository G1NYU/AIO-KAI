//! Windows music transport: yt-dlp playback plus bounded export metadata resolution.
use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, atomic::{AtomicU64, Ordering}};
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
    received: Arc<AtomicU64>,
}

impl Transfer {
    pub(crate) fn start(value: &str) -> Result<Self, &'static str> {
        Self::start_with(value, "bestaudio[protocol=https]", Duration::from_secs(25), false)
    }

    // An explicit authorized Vault export, distinct from the playback format.
    // No muxing, authentication cookies, plugins, or post-processors.
    pub(crate) fn start_export(value: &str) -> Result<Self, &'static str> {
        Self::start_with(value, "bestaudio[ext=m4a][protocol=https]", Duration::from_secs(120), false)
    }

    #[cfg(windows)]
    pub(crate) fn start_resolve(value:&str)->Result<Self,&'static str>{
        Self::start_with(value,"bestaudio[ext=m4a][protocol=https]",Duration::from_secs(35),true)
    }

    fn start_with(value: &str, format: &str, timeout: Duration, metadata:bool) -> Result<Self, &'static str> {
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
        command
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
            .arg(format!("deno:{}", runtime.display()));
        if metadata {command.args(["--skip-download","--dump-single-json"]);}
        else {command.args(["-o","-"]);}
        let mut child=command.args(["--",value])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|_| "Could not start the bundled music transport.")?;
        let stdout = child.stdout.take().expect("piped stdout");
        let stderr = child.stderr.take().expect("piped stderr");
        let received = Arc::new(AtomicU64::new(0));
        let counter = received.clone();
        Ok(Self {
            child,
            stdout: Some(std::thread::spawn(move || read_audio(stdout, if metadata {2*1024*1024}else{MAX_AUDIO}, &counter))),
            stderr: Some(std::thread::spawn(move || read_bounded(stderr, 256 * 1024))),
            deadline: Instant::now() + timeout,
            received,
        })
    }

    /// Bytes actually read from the media pipe; total is unknown until completion.
    pub(crate) fn received_bytes(&self) -> u64 { self.received.load(Ordering::Relaxed) }

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
    fn bounds_binary_output() {
        assert_eq!(read_bounded(&b"abc"[..], 3), Ok(b"abc".to_vec()));
        assert!(read_bounded(&b"abcd"[..], 3).is_err());
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
