//! Resolve authorized direct audio through the separately packaged yt-dlp tool.
use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

pub(crate) type MediaHeaders = Vec<(String, String)>;

pub(crate) struct Resolved {
    pub data: Value,
    pub headers: MediaHeaders,
}

const LIMIT: u64 = 4 * 1024 * 1024;

fn read_output(mut reader: impl Read) -> Result<Vec<u8>, &'static str> {
    let mut bytes = Vec::new();
    reader
        .by_ref()
        .take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Could not read the music resolver output.")?;
    if bytes.len() as u64 > LIMIT {
        return Err("The music resolver returned too much data.");
    }
    Ok(bytes)
}

pub(crate) fn resolve(id: &str) -> Result<Resolved, &'static str> {
    if id.len() != 11
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
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
            "--skip-download",
            "--dump-single-json",
            "--socket-timeout",
            "8",
            "--retries",
            "0",
            "--extractor-retries",
            "0",
            "--format",
            "bestaudio[protocol=https]",
            "--no-js-runtimes",
            "--js-runtimes",
        ])
        .arg(format!("deno:{}", runtime.display()))
        .arg("--")
        .arg(format!("https://www.youtube.com/watch?v={id}"))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| "Could not start the bundled music resolver.")?;
    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");
    let out = std::thread::spawn(move || read_output(stdout));
    let err = std::thread::spawn(move || read_output(stderr));
    let deadline = Instant::now() + Duration::from_secs(25);
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(50));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("YouTube Music resolver timed out or stopped.");
            }
        }
    };
    while !out.is_finished() || !err.is_finished() {
        if Instant::now() >= deadline {
            return Err("YouTube Music resolver output timed out.");
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    let stdout = out.join().map_err(|_| "Music resolver output stopped.")??;
    let stderr = err.join().map_err(|_| "Music resolver output stopped.")??;
    if !status.success() {
        return Err(classify_error(&stderr));
    }
    let data: Value =
        serde_json::from_slice(&stdout).map_err(|_| "Invalid music resolver response.")?;
    parse(&data)
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
        "The bundled resolver could not obtain a playable YouTube Music stream."
    }
}

fn parse(data: &Value) -> Result<Resolved, &'static str> {
    if data["vcodec"] != "none"
        || data["acodec"].as_str().is_none_or(|codec| codec == "none")
        || data["protocol"] != "https"
        || !data["fragments"].is_null()
    {
        return Err("The resolver did not return direct HTTPS audio.");
    }
    let raw = data["url"].as_str().ok_or("Missing direct audio URL.")?;
    let url = url::Url::parse(raw).map_err(|_| "Invalid direct audio URL.")?;
    if raw.len() > 16384
        || url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port_or_known_default() != Some(443)
        || !url
            .host_str()
            .is_some_and(|host| host == "googlevideo.com" || host.ends_with(".googlevideo.com"))
    {
        return Err("Unapproved media host.");
    }
    let format = match data["ext"].as_str() {
        Some("m4a" | "mp4") => "audio/mp4",
        Some("webm") => "audio/webm",
        _ => return Err("The resolver returned an unsupported audio format."),
    };
    let mut headers = Vec::new();
    if let Some(fields) = data["http_headers"].as_object() {
        for (name, value) in fields {
            let name = name.to_ascii_lowercase();
            if !matches!(
                name.as_str(),
                "user-agent" | "accept" | "accept-language" | "referer" | "origin"
            ) {
                continue;
            }
            let value = value.as_str().ok_or("Invalid media header.")?;
            if value.len() > 2048 || !value.bytes().all(|b| (32..=126).contains(&b)) {
                return Err("Invalid media header.");
            }
            headers.push((name, value.to_owned()));
        }
    }
    let quality = data["abr"]
        .as_f64()
        .filter(|value| value.is_finite() && *value > 0.0 && *value < 10000.0)
        .map(|value| format!("{value:.0} kbps"));
    Ok(Resolved {
        data: json!({"url": url.as_str(), "format": format, "quality": quality}),
        headers,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_direct_audio_and_safe_headers_are_accepted() {
        let data = json!({
            "vcodec": "none",
            "acodec": "opus",
            "protocol": "https",
            "ext": "webm",
            "abr": 139.2,
            "url": "https://a.googlevideo.com/audio",
            "http_headers": {
                "User-Agent": "fixture",
                "Cookie": "not forwarded",
                "Authorization": "not forwarded"
            }
        });
        let result = parse(&data).expect("direct audio");
        assert_eq!(result.data["quality"], "139 kbps");
        assert_eq!(
            result.headers,
            vec![("user-agent".to_string(), "fixture".to_string())]
        );
        let mut bad = data.clone();
        bad["url"] = json!("https://googlevideo.com.example.test/audio");
        assert!(parse(&bad).is_err());
        bad = data;
        bad["http_headers"]["User-Agent"] = json!("bad\r\nheader");
        assert!(parse(&bad).is_err());
    }

    #[test]
    fn errors_never_include_raw_provider_output() {
        assert_eq!(
            classify_error(b"ERROR: Sign in to confirm you are not a bot"),
            "YouTube requires sign-in or verification."
        );
        assert!(!classify_error(b"https://example.test/?private=hidden").contains("hidden"));
    }
}
