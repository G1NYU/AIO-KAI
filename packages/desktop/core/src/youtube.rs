//! A YouTube video's stream, asked of its player API as YouTube's apps ask. The
//! links only play from the address that asked, so the app resolves them itself.

use std::time::Duration;

use serde_json::{Map, Value, json};

struct Client {
    name: &'static str,
    id: &'static str,
    version: &'static str,
    user_agent: &'static str,
    key: Option<&'static str>,
    fields: &'static [(&'static str, &'static str)],
    /// An HLS playlist of every size, where the muxed formats stop at 360p.
    hls: bool,
}

const CLIENTS: &[Client] = &[
    Client {
        name: "VISIONOS",
        id: "101",
        version: "1.02",
        user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
        key: None,
        fields: &[
            ("deviceMake", "Apple"),
            ("deviceModel", "RealityDevice17,1"),
            ("osName", "visionOS"),
            ("osVersion", "26.5.23O471"),
        ],
        hls: true,
    },
    Client {
        name: "ANDROID",
        id: "3",
        version: "20.10.41",
        user_agent: "com.google.android.youtube/20.10.41 (Linux; U; Android 11) gzip",
        key: Some("AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w"),
        fields: &[
            ("deviceMake", "Google"),
            ("deviceModel", "Pixel 5"),
            ("osName", "Android"),
            ("osVersion", "11"),
            ("androidSdkVersion", "30"),
            ("platform", "MOBILE"),
        ],
        hls: false,
    },
];

pub struct Stream {
    pub url: String,
    pub original_language: Option<String>,
    /// What mpv plays for `url`, which FFmpeg would open every variant of before playing.
    pub playable: Option<String>,
}

pub fn resolve(video_id: &str) -> Option<Stream> {
    let valid = video_id.len() == 11
        && video_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    if !valid {
        return None;
    }
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(10)))
        .build()
        .into();
    CLIENTS
        .iter()
        .find_map(|client| match ask(&agent, client, video_id) {
            Ok(url) => url,
            Err(e) => {
                log::warn!("youtube {}: {e}", client.name);
                None
            }
        })
}

fn ask(agent: &ureq::Agent, client: &Client, video_id: &str) -> Result<Option<Stream>, String> {
    let mut visitor: Option<String> = None;
    for _ in 0..2 {
        let answer = player(agent, client, video_id, visitor.as_deref())?;
        if answer["playabilityStatus"]["status"] == "OK" {
            let streaming = &answer["streamingData"];
            let url = if client.hls {
                streaming["hlsManifestUrl"].as_str()
            } else {
                streaming["formats"]
                    .as_array()
                    .and_then(|formats| formats.iter().find_map(|f| f["url"].as_str()))
            };
            let original = original_audio(streaming);
            return Ok(url.map(|url| Stream {
                url: url.to_string(),
                original_language: original
                    .and_then(|id| id.split('.').next())
                    .map(String::from),
                playable: client.hls.then(|| playable(agent, url, original)).flatten(),
            }));
        }
        // Without a visitor id YouTube refuses, but hands one out for the next ask.
        match answer["responseContext"]["visitorData"].as_str() {
            Some(id) => visitor = Some(id.to_string()),
            None => return Ok(None),
        }
    }
    Ok(None)
}

/// The original audio's id, such as `en-US.4`, which a manifest with dubs doesn't mark.
fn original_audio(streaming: &Value) -> Option<&str> {
    streaming["adaptiveFormats"]
        .as_array()?
        .iter()
        .map(|format| &format["audioTrack"])
        .find(|track| track["audioIsDefault"] == true)?["id"]
        .as_str()
}

fn playable(agent: &ureq::Agent, url: &str, original: Option<&str>) -> Option<String> {
    let master = agent
        .get(url)
        .call()
        .and_then(|mut response| response.body_mut().read_to_string())
        .inspect_err(|e| log::warn!("youtube playlist: {e}"))
        .ok()?;
    one_variant(&master, original)
}

type Attributes<'a> = Vec<(&'a str, &'a str)>;

fn attributes(mut list: &str) -> Attributes<'_> {
    let mut all = Vec::new();
    while let Some((name, rest)) = list.split_once('=') {
        let (value, rest) = match rest.strip_prefix('"') {
            Some(quoted) => quoted.split_once('"').unwrap_or((quoted, "")),
            None => rest.split_once(',').unwrap_or((rest, "")),
        };
        all.push((name, value));
        list = rest.strip_prefix(',').unwrap_or(rest);
    }
    all
}

fn get<'a>(attributes: &Attributes<'a>, name: &str) -> Option<&'a str> {
    attributes.iter().find(|(n, _)| *n == name).map(|(_, v)| *v)
}

fn edl_value(value: &str) -> String {
    format!("%{}%{value}", value.len())
}

/// The largest H.264 variant of `master` with its group's audio as an EDL, each
/// audio opened only once mpv picks it by language.
fn one_variant(master: &str, original: Option<&str>) -> Option<String> {
    let mut audio = Vec::new();
    let mut best: Option<((u32, u64), Attributes, &str)> = None;
    let mut lines = master.lines();
    while let Some(line) = lines.next() {
        if let Some(list) = line.strip_prefix("#EXT-X-MEDIA:") {
            let media = attributes(list);
            if get(&media, "TYPE") == Some("AUDIO") {
                audio.push(media);
            }
        } else if let Some(list) = line.strip_prefix("#EXT-X-STREAM-INF:") {
            let variant = attributes(list);
            let uri = lines.next()?.trim();
            let height = get(&variant, "RESOLUTION")
                .and_then(|r| r.split_once('x')?.1.parse().ok())
                .unwrap_or(0);
            let bandwidth = get(&variant, "BANDWIDTH")
                .and_then(|b| b.parse().ok())
                .unwrap_or(0);
            let h264 = get(&variant, "CODECS").is_some_and(|c| c.starts_with("avc1"));
            if h264
                && best
                    .as_ref()
                    .is_none_or(|(size, ..)| (height, bandwidth) > *size)
            {
                best = Some(((height, bandwidth), variant, uri));
            }
        }
    }
    let (_, variant, uri) = best?;
    let Some(group) = get(&variant, "AUDIO") else {
        return Some(uri.to_string());
    };
    if !get(&variant, "CODECS")?.contains("mp4a") {
        return None;
    }
    let mut tracks: Vec<_> = audio
        .iter()
        .filter(|media| get(media, "GROUP-ID") == Some(group) && get(media, "URI").is_some())
        .collect();
    if let Some(original) = original {
        tracks.sort_by_key(|media| get(media, "YT-EXT-AUDIO-CONTENT-ID") != Some(original));
    }
    if tracks.is_empty() {
        return None;
    }
    // Otherwise each segment becomes a chapter titled with its URL.
    let mut edl = format!("edl://!no_chapters;{}", edl_value(uri));
    for media in tracks {
        edl.push_str(";!new_stream;!no_clip;!delay_open,media_type=audio,codec=aac");
        let meta: Vec<_> = [("lang", "LANGUAGE"), ("title", "NAME")]
            .into_iter()
            .filter_map(|(key, name)| Some(format!("{key}={}", edl_value(get(media, name)?))))
            .collect();
        if !meta.is_empty() {
            edl.push_str(&format!(";!track_meta,{}", meta.join(",")));
        }
        edl.push_str(&format!(";{}", edl_value(get(media, "URI")?)));
    }
    Some(edl)
}

fn player(
    agent: &ureq::Agent,
    client: &Client,
    video_id: &str,
    visitor: Option<&str>,
) -> Result<Value, String> {
    let mut fields = Map::new();
    fields.insert("clientName".into(), client.name.into());
    fields.insert("clientVersion".into(), client.version.into());
    fields.insert("hl".into(), "en".into());
    fields.insert("gl".into(), "US".into());
    if let Some(id) = visitor {
        fields.insert("visitorData".into(), id.into());
    }
    for (name, value) in client.fields {
        fields.insert((*name).into(), (*value).into());
    }
    let body = json!({
        "videoId": video_id,
        "context": { "client": fields },
        "contentCheckOk": true,
        "racyCheckOk": true,
    });
    let key = client.key.map(|k| format!("key={k}&")).unwrap_or_default();
    let mut request = agent
        .post(format!(
            "https://www.youtube.com/youtubei/v1/player?{key}prettyPrint=false"
        ))
        .header("Content-Type", "application/json")
        .header("User-Agent", client.user_agent)
        .header("Origin", "https://www.youtube.com")
        .header("Referer", "https://www.youtube.com/")
        .header("X-YouTube-Client-Name", client.id)
        .header("X-YouTube-Client-Version", client.version);
    if let Some(id) = visitor {
        request = request.header("X-Goog-Visitor-Id", id);
    }
    let mut response = request.send(body.to_string()).map_err(|e| e.to_string())?;
    let text = response
        .body_mut()
        .read_to_string()
        .map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

const MUSIC_VERSION: &str = "1.20260213.01.00";

/// Anonymous music metadata and direct, provider-issued audio URLs only.
/// No account cookies, signature deciphering, or arbitrary request destinations.
pub fn music_request(operation: &str, value: &str) -> Result<Value, &'static str> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(10)))
        .build()
        .into();
    match operation {
        "search" if !value.trim().is_empty() && value.chars().count() <= 200 => {
            music_metadata(&agent, "search", json!({ "query": value.trim() }))
        }
        "browse" if music_browse_id(value) => {
            music_metadata(&agent, "browse", json!({ "browseId": value }))
        }
        "audio" if music_video_id(value) => music_audio(&agent, value),
        _ => Err("Invalid YouTube Music request."),
    }
}

fn music_video_id(id: &str) -> bool {
    id.len() == 11 && music_id_chars(id)
}

fn music_id_chars(id: &str) -> bool {
    id.bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn music_browse_id(id: &str) -> bool {
    id.len() <= 180
        && music_id_chars(id)
        && ["MPRE", "UC", "VL", "MPLA", "OLAK5uy_"]
            .iter()
            .any(|prefix| id.len() > prefix.len() && id.starts_with(*prefix))
}

fn music_metadata(
    agent: &ureq::Agent,
    operation: &str,
    mut body: Value,
) -> Result<Value, &'static str> {
    body["context"] = json!({
        "client": {
            "clientName": "WEB_REMIX",
            "clientVersion": MUSIC_VERSION,
            "hl": "en",
        }
    });
    let mut response = agent
        .post(format!(
            "https://music.youtube.com/youtubei/v1/{operation}?prettyPrint=false"
        ))
        .header("Content-Type", "application/json")
        .header("Origin", "https://music.youtube.com")
        .header("Referer", "https://music.youtube.com/")
        .header("X-YouTube-Client-Name", "67")
        .header("X-YouTube-Client-Version", MUSIC_VERSION)
        .send(body.to_string())
        .map_err(|_| "YouTube Music did not answer.")?;
    let text = response
        .body_mut()
        .read_to_string()
        .map_err(|_| "Could not read the YouTube Music response.")?;
    if text.len() > 4 * 1024 * 1024 {
        return Err("YouTube Music returned too much data.");
    }
    let data: Value = serde_json::from_str(&text).map_err(|_| "Invalid YouTube Music response.")?;
    if data["contents"].is_null() && data["header"].is_null() {
        return Err("YouTube Music returned no accessible results.");
    }
    Ok(json!({
        "contents": data["contents"],
        "header": data["header"],
    }))
}

fn direct_music_audio(streaming: &Value) -> Option<Value> {
    streaming["adaptiveFormats"]
        .as_array()?
        .iter()
        .filter_map(|format| {
            let mime = format["mimeType"].as_str()?;
            if !mime.starts_with("audio/mp4") && !mime.starts_with("audio/webm") {
                return None;
            }
            if format["audioTrack"]["audioIsDefault"] == false {
                return None;
            }
            let url = url::Url::parse(format["url"].as_str()?).ok()?;
            let host = url.host_str()?;
            if url.scheme() != "https"
                || !url.username().is_empty()
                || url.password().is_some()
                || url.port_or_known_default() != Some(443)
                || !(host == "googlevideo.com" || host.ends_with(".googlevideo.com"))
            {
                return None;
            }
            let bitrate = format["bitrate"].as_u64().unwrap_or(0);
            Some((
                bitrate,
                json!({
                    "url": url.as_str(),
                    "format": mime.split(';').next(),
                    "quality": format!("{} kbps", bitrate / 1000),
                }),
            ))
        })
        .max_by_key(|(bitrate, _)| *bitrate)
        .map(|(_, stream)| stream)
}

fn music_audio(agent: &ureq::Agent, video_id: &str) -> Result<Value, &'static str> {
    // Reuse the existing desktop resolver's direct-format client; do not
    // change the video resolver or try to unlock restricted content.
    let client = CLIENTS
        .iter()
        .find(|client| !client.hls)
        .ok_or("YouTube audio is unavailable.")?;
    let answer = player(agent, client, video_id, None)
        .map_err(|_| "YouTube audio could not be resolved.")?;
    music_playability(&answer["playabilityStatus"])?;
    direct_music_audio(&answer["streamingData"])
        .ok_or("YouTube did not supply a directly playable audio stream.")
}

// Fixed messages only: the upstream reason may include account-specific data.
fn music_playability(status: &Value) -> Result<(), &'static str> {
    match status["status"].as_str() {
        Some("OK") => Ok(()),
        Some("LOGIN_REQUIRED") => {
            let reason = status["reason"].as_str().unwrap_or("").to_ascii_lowercase();
            if reason.contains("bot") {
                Err("YouTube requires bot verification on this network (LOGIN_REQUIRED).")
            } else {
                Err("YouTube requires sign-in for this track (LOGIN_REQUIRED).")
            }
        }
        Some("AGE_CHECK_REQUIRED" | "CONTENT_CHECK_REQUIRED") => {
            Err("YouTube requires content or age verification.")
        }
        Some("UNPLAYABLE") => Err("YouTube reports this track is unavailable (UNPLAYABLE)."),
        Some("ERROR") => Err("YouTube reports a playback error (ERROR)."),
        Some("LIVE_STREAM_OFFLINE") => Err("YouTube reports that this live stream is offline."),
        _ => Err("YouTube returned an unsupported playback status."),
    }
}

#[cfg(test)]
mod music_tests {
    use super::*;

    #[test]
    fn classifies_playability_without_leaking_provider_reasons() {
        assert_eq!(music_playability(&json!({"status": "OK"})), Ok(()));
        assert_eq!(
            music_playability(&json!({
                "status": "LOGIN_REQUIRED",
                "reason": "Sign in to confirm you're not a bot"
            })),
            Err("YouTube requires bot verification on this network (LOGIN_REQUIRED).")
        );
        assert_eq!(
            music_playability(&json!({"status": "LOGIN_REQUIRED", "reason": "private account data"})),
            Err("YouTube requires sign-in for this track (LOGIN_REQUIRED).")
        );
        assert!(music_playability(&json!({"status": "UNPLAYABLE"})).is_err());
        assert!(music_playability(&Value::Null).is_err());
    }

    #[test]
    fn restricts_music_targets() {
        assert!(music_video_id("abcDEF_1234"));
        assert!(!music_video_id("https://example.test"));
        assert!(music_browse_id("MPREtest"));
        assert!(!music_browse_id("FEmusic_library"));
        assert!(!music_browse_id("VL../secret"));
    }

    #[test]
    fn picks_only_direct_audio_on_youtube_media_hosts() {
        let data = json!({
            "adaptiveFormats": [
                {"mimeType": "video/mp4", "bitrate": 900000, "url": "https://a.googlevideo.com/v"},
                {"mimeType": "audio/mp4", "bitrate": 128000, "url": "https://a.googlevideo.com/a"},
                {"mimeType": "audio/webm", "bitrate": 160000, "url": "https://b.googlevideo.com/b"},
                {"mimeType": "audio/webm", "bitrate": 500000, "url": "https://googlevideo.com.evil.test/c"},
                {"mimeType": "audio/mp4", "bitrate": 600000, "signatureCipher": "not-a-direct-url"},
                {"mimeType": "audio/mp4", "bitrate": 800000, "url": "https://a.googlevideo.com/d", "audioTrack": {"audioIsDefault": false}}
            ]
        });
        let result = direct_music_audio(&data).unwrap();
        assert_eq!(result["url"], "https://b.googlevideo.com/b");
        assert_eq!(result["quality"], "160 kbps");
        assert!(direct_music_audio(&json!({"adaptiveFormats": []})).is_none());
    }
}
