//! Public SoundCloud track identities and bounded incremental search.
use serde_json::{Value, json};
use std::collections::HashSet;

const PREFIX: &str = "https://api.soundcloud.com/tracks/";
const MAX_ROWS: usize = 20;
const MAX_LINE: usize = 256 * 1024;
const MAX_OUTPUT: usize = 2 * 1024 * 1024;

pub(crate) fn track_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 20 && !id.starts_with('0')
        && id.bytes().all(|b| b.is_ascii_digit()) && id.parse::<u64>().is_ok()
}

pub(crate) fn is_target(url: &str) -> bool {
    url.strip_prefix(PREFIX).is_some_and(track_id)
}

pub(crate) fn search_target(query: &str) -> Result<String, &'static str> {
    let query = query.trim();
    if query.is_empty() || query.len() > 800 || query.chars().any(char::is_control) {
        return Err("Invalid SoundCloud search.");
    }
    Ok(format!("scsearch{MAX_ROWS}:{query}"))
}

fn public_text(value: &Value) -> Option<&str> {
    let text = value.as_str()?.trim();
    if text.is_empty() || text.encode_utf16().count() > 220
        || text.chars().any(char::is_control) || text.contains("://")
        || text.to_ascii_lowercase().split_whitespace().any(|part| part.starts_with("blob:") || part.starts_with("data:") || part == "bearer")
    { return None; }
    Some(text)
}

fn artwork(value: &Value) -> Option<String> {
    let raw = value.as_str()?;
    if raw.len() > 2048 { return None; }
    let url = url::Url::parse(raw).ok()?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some()
        || url.port().is_some() || url.query().is_some() || url.fragment().is_some()
        || !matches!(url.host_str(), Some("i1.sndcdn.com" | "i2.sndcdn.com" | "i3.sndcdn.com" | "i4.sndcdn.com"))
        || ![".jpg", ".jpeg", ".png", ".webp"].iter().any(|ext| url.path().ends_with(*ext))
    { return None; }
    Some(url.to_string())
}

// Return only public replay identity and bounded display metadata. Never return
// extractor URLs, descriptions, authorization, cookies or arbitrary headers.
fn public_track(value: &Value) -> Option<Value> {
    let id = value["id"].as_str().filter(|id| track_id(id))?;
    let title = public_text(&value["title"])?;
    let artist = value["artists"].as_array()
        .and_then(|items| items.iter().find_map(public_text))
        .or_else(|| public_text(&value["uploader"])).unwrap_or("");
    let mut track = json!({ "id": id, "title": title, "artist": artist });
    if let Some(duration) = value["duration"].as_f64().filter(|n| n.is_finite() && *n > 0.0 && *n <= 86400.0) {
        track["duration"] = json!(duration);
    }
    let image = value["thumbnails"].as_array().and_then(|items| {
        items.iter().rev().take(32).find_map(|item| artwork(&item["url"]))
    }).or_else(|| artwork(&value["thumbnail"]));
    if let Some(image) = image { track["artworkURL"] = json!(image); }
    Some(track)
}

#[derive(Default)]
pub(crate) struct SearchRows {
    pending: Vec<u8>,
    total: usize,
    lines: usize,
    ids: HashSet<String>,
}

impl SearchRows {
    pub(crate) fn push(&mut self, bytes: &[u8], emit: &mut impl FnMut(Value)) -> Result<(), &'static str> {
        self.total = self.total.checked_add(bytes.len()).filter(|n| *n <= MAX_OUTPUT)
            .ok_or("SoundCloud search exceeded its output limit.")?;
        for part in bytes.split_inclusive(|byte| *byte == b'\n') {
            let complete = part.last() == Some(&b'\n');
            let part = if complete { &part[..part.len()-1] } else { part };
            if self.pending.len() + part.len() > MAX_LINE { return Err("SoundCloud search row is too large."); }
            self.pending.extend_from_slice(part);
            if complete { self.line(emit)?; }
        }
        Ok(())
    }

    pub(crate) fn finish(&mut self, emit: &mut impl FnMut(Value)) -> Result<(), &'static str> {
        if !self.pending.is_empty() { self.line(emit)?; }
        Ok(())
    }

    fn line(&mut self, emit: &mut impl FnMut(Value)) -> Result<(), &'static str> {
        let bytes = std::mem::take(&mut self.pending);
        if bytes.iter().all(|byte| byte.is_ascii_whitespace()) { return Ok(()); }
        self.lines += 1;
        if self.lines > MAX_ROWS { return Err("SoundCloud search returned too many rows."); }
        let row: Value = serde_json::from_slice(&bytes).map_err(|_| "SoundCloud returned an invalid search row.")?;
        if let Some(track) = public_track(&row)
            && let Some(id) = track["id"].as_str()
            && self.ids.insert(id.to_owned())
        { emit(track); }
        Ok(())
    }
}

#[cfg(windows)]
mod worker {
    use super::*;
    use crate::bridge::Outbound;
    use crate::music_resolver::Transfer;
    use crate::player::Emit;
    use std::sync::mpsc::{self, SyncSender, RecvTimeoutError};
    use std::thread::JoinHandle;
    use std::time::Duration;

    enum Command {
        Start { request: String, query: String },
        Cancel(String),
    }

    pub(crate) struct Searches {
        sender: Option<SyncSender<Command>>,
        worker: Option<JoinHandle<()>>,
    }

    fn result(emit: &Emit, request: String, tracks: Vec<Value>, complete: bool, error: Option<String>) {
        emit(Outbound::SoundcloudSearchResult { request, tracks, complete, error });
    }

    impl Searches {
        pub(crate) fn new(emit: Emit) -> Result<Self, &'static str> {
            let (sender, inbox) = mpsc::sync_channel(8);
            let worker = std::thread::Builder::new().name("tsugi-soundcloud-search".into()).spawn(move || {
                let mut active: Option<(String, Transfer)> = None;
                loop {
                    match inbox.recv_timeout(Duration::from_millis(40)) {
                        Ok(Command::Start { request, query }) => {
                            // One owned subprocess at a time, including replacement.
                            if let Some((old, transfer)) = active.take() {
                                drop(transfer);
                                result(&emit, old, vec![], true, Some("SoundCloud search was replaced.".into()));
                            }
                            let partial_emit = emit.clone();
                            let partial_request = request.clone();
                            match Transfer::start_soundcloud_search(&query, Box::new(move |track| {
                                result(&partial_emit, partial_request.clone(), vec![track], false, None);
                            })) {
                                Ok(transfer) => active = Some((request, transfer)),
                                Err(error) => result(&emit, request, vec![], true, Some(error.into())),
                            }
                        }
                        Ok(Command::Cancel(request)) => {
                            if active.as_ref().is_some_and(|(id, _)| *id == request) {
                                active.take();
                                result(&emit, request, vec![], true, Some("SoundCloud search was cancelled.".into()));
                            }
                        }
                        Err(RecvTimeoutError::Timeout) => {}
                        Err(RecvTimeoutError::Disconnected) => return,
                    }
                    if let Some((_, transfer)) = &mut active
                        && let Some(outcome) = transfer.poll().transpose()
                    {
                        let (request, transfer) = active.take().expect("active search");
                        drop(transfer);
                        result(&emit, request, vec![], true, outcome.err().map(str::to_owned));
                    }
                }
            }).map_err(|_| "Could not start SoundCloud search worker.")?;
            Ok(Self { sender: Some(sender), worker: Some(worker) })
        }

        pub(crate) fn search(&self, request: String, query: String) -> bool {
            search_target(&query).is_ok() && self.sender.as_ref()
                .is_some_and(|sender| sender.try_send(Command::Start { request, query }).is_ok())
        }

        pub(crate) fn cancel(&self, request: String) {
            if let Some(sender) = &self.sender { let _ = sender.try_send(Command::Cancel(request)); }
        }
    }

    impl Drop for Searches {
        fn drop(&mut self) {
            self.sender.take();
            if let Some(worker) = self.worker.take() { let _ = worker.join(); }
        }
    }
}

#[cfg(windows)]
pub(crate) use worker::Searches;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_canonical_numeric_public_targets() {
        assert!(is_target("https://api.soundcloud.com/tracks/123456789"));
        assert!(track_id("18446744073709551615"));
        for id in ["", "0", "01", "-1", "18446744073709551616", "1?secret_token=private", "1/2", "١"] {
            assert!(!track_id(id));
        }
        for target in ["https://api.soundcloud.com/tracks/1?secret_token=x", "https://soundcloud.com/a/b",
            "https://api.soundcloud.com.evil.test/tracks/1", "file:///tmp/1"] {
            assert!(!is_target(target));
        }
        assert_eq!(search_target("  夏の音楽  ").unwrap(), "scsearch20:夏の音楽");
        assert!(search_target("a\nb").is_err());
        assert!(search_target(&"x".repeat(801)).is_err());
    }

    #[test]
    fn incremental_rows_keep_only_safe_metadata_and_deduplicate() {
        let row = json!({"id":"123","title":"夏の音楽","uploader":"Fixture artist","duration":42.5,
            "url":"https://private.test/secret","http_headers":{"Authorization":"private"},
            "thumbnails":[{"url":"https://i1.sndcdn.com/artworks-fixture-t500x500.jpg"},
                {"url":"https://i1.sndcdn.com/artworks-private.jpg?token=private"}]});
        let encoded = format!("{row}\r\n{row}\n{}\n", json!({"id":"1?secret=x","title":"Bad"}));
        let mut parser = SearchRows::default();
        let mut found = Vec::new();
        for chunk in encoded.as_bytes().chunks(7) { parser.push(chunk, &mut |track| found.push(track)).unwrap(); }
        parser.finish(&mut |track| found.push(track)).unwrap();
        assert_eq!(found, vec![json!({"id":"123","title":"夏の音楽","artist":"Fixture artist","duration":42.5,
            "artworkURL":"https://i1.sndcdn.com/artworks-fixture-t500x500.jpg"})]);
    }

    #[test]
    fn rejects_invalid_rows_and_bounds_input() {
        let mut parser = SearchRows::default();
        assert!(parser.push(b"{not JSON}\n", &mut |_| {}).is_err());
        assert!(SearchRows::default().push(&vec![b'x'; MAX_LINE+1], &mut |_| {}).is_err());
        let mut parser = SearchRows::default();
        assert!(parser.push(&vec![b' '; MAX_OUTPUT+1], &mut |_| {}).is_err());
        let many = "{}\n".repeat(MAX_ROWS+1);
        assert!(SearchRows::default().push(many.as_bytes(), &mut |_| {}).is_err());
    }
}
