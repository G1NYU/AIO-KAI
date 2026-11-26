//! Explicit chapter-download controls over the pinned runtime's queue.
//! Cancellation removes queue entries only; it never deletes downloaded media.
use super::*;
use std::collections::{BTreeMap, BTreeSet};

const MAX_DOWNLOAD_SELECTION: usize = 100;
const MAX_DOWNLOAD_QUEUE: usize = 1000;
const INVALID_STATUS: &str = "The complete download queue could not be verified. Refresh download status.";
const INVALID_SELECTION: &str = "Select between 1 and 100 different chapters to download.";
const CHANGED_SELECTION: &str = "The selected downloads changed. Refresh download status and select them again.";
const UNCERTAIN_OPERATION: &str = "The download operation may have changed the queue. Refresh download status before trying another action.";
const PENDING_DOWNLOADS: &str = "Finish or cancel all chapter downloads before changing extensions.";

macro_rules! download_fields {
    () => { "state queue { state progress tries position chapter { id mangaId name pageCount isDownloaded } manga { id title } }" };
}
const DOWNLOAD_STATUS_QUERY: &str = concat!("query TsugiDownloads { downloadStatus { ", download_fields!(), " } }");
const ENQUEUE_DOWNLOADS: &str = concat!("mutation TsugiEnqueueDownloads($input: EnqueueChapterDownloadsInput!) { enqueueChapterDownloads(input: $input) { downloadStatus { ", download_fields!(), " } } }");
const CANCEL_DOWNLOADS: &str = concat!("mutation TsugiCancelDownloads($input: DequeueChapterDownloadsInput!) { dequeueChapterDownloads(input: $input) { downloadStatus { ", download_fields!(), " } } }");
const PAUSE_DOWNLOADS: &str = concat!("mutation TsugiPauseDownloads($input: StopDownloaderInput!) { stopDownloader(input: $input) { downloadStatus { ", download_fields!(), " } } }");
const RESUME_DOWNLOADS: &str = concat!("mutation TsugiResumeDownloads($input: StartDownloaderInput!) { startDownloader(input: $input) { downloadStatus { ", download_fields!(), " } } }");

#[derive(Clone, Copy)]
enum DownloadControl { Enqueue, Cancel, Retry, Pause, Resume }

fn download_id(value: &Value) -> Result<i32, &'static str> {
    value.as_i64().and_then(|id| i32::try_from(id).ok()).filter(|id| *id > 0).ok_or(INVALID_STATUS)
}
fn download_label(value: &Value) -> Result<&str, &'static str> {
    value.as_str().filter(|value| !value.trim().is_empty() && value.chars().count() <= 500 && !value.chars().any(char::is_control)).ok_or(INVALID_STATUS)
}
fn download_page_count(value: &Value) -> Result<i32, &'static str> {
    value.as_i64().and_then(|count| i32::try_from(count).ok()).filter(|count| *count >= -1).ok_or(INVALID_STATUS)
}
fn selected_download_ids(ids: &[i32]) -> Result<BTreeSet<i32>, &'static str> {
    let selected = ids.iter().copied().collect::<BTreeSet<_>>();
    if ids.is_empty() || ids.len() > MAX_DOWNLOAD_SELECTION || selected.len() != ids.len() || ids.iter().any(|id| *id <= 0) {
        return Err(INVALID_SELECTION);
    }
    Ok(selected)
}

fn project_download_status(raw: &Value) -> Result<Value, &'static str> {
    let state = raw["state"].as_str().filter(|state| matches!(*state, "STARTED" | "STOPPED")).ok_or(INVALID_STATUS)?;
    let rows = raw["queue"].as_array().filter(|rows| rows.len() <= MAX_DOWNLOAD_QUEUE).ok_or(INVALID_STATUS)?;
    let mut seen = BTreeSet::new();
    let mut queue = Vec::with_capacity(rows.len());
    for (position, row) in rows.iter().enumerate() {
        let chapter = &row["chapter"];
        let manga = &row["manga"];
        let id = download_id(&chapter["id"])?;
        let manga_id = download_id(&manga["id"])?;
        if !seen.insert(id) || download_id(&chapter["mangaId"])? != manga_id
            || row["position"].as_u64() != Some(position as u64) { return Err(INVALID_STATUS); }
        let state = row["state"].as_str().filter(|state| matches!(*state, "QUEUED" | "DOWNLOADING" | "FINISHED" | "ERROR")).ok_or(INVALID_STATUS)?;
        let progress = row["progress"].as_f64().filter(|value| value.is_finite() && (0.0..=1.0).contains(value)).ok_or(INVALID_STATUS)?;
        let tries = row["tries"].as_u64().filter(|value| *value <= i32::MAX as u64).ok_or(INVALID_STATUS)?;
        queue.push(json!({"id": id, "mangaId": manga_id,
            "mangaTitle": download_label(&manga["title"])?, "chapterName": download_label(&chapter["name"])?,
            "pageCount": download_page_count(&chapter["pageCount"])?, "isDownloaded": chapter["isDownloaded"].as_bool().ok_or(INVALID_STATUS)?,
            "state": state, "progress": progress, "tries": tries, "position": position}));
    }
    Ok(json!({"state": state, "queue": queue}))
}

fn should_control_downloads(control: DownloadControl, ids: &[i32], status: &Value) -> Result<bool, &'static str> {
    let queue = status["queue"].as_array().ok_or(INVALID_STATUS)?;
    match control {
        DownloadControl::Pause => Ok(status["state"] == "STARTED"),
        DownloadControl::Resume => Ok(status["state"] == "STOPPED" && queue.iter().any(|row| row["state"] != "ERROR")),
        _ => {
            selected_download_ids(ids)?;
            let queued = queue.iter().map(|row| Ok((download_id(&row["id"])?, row))).collect::<Result<BTreeMap<_, _>, &'static str>>()?;
            match control {
                DownloadControl::Enqueue => {
                    if queue.len() + ids.len() > MAX_DOWNLOAD_QUEUE { return Err("The download queue would exceed 1000 chapters."); }
                    if ids.iter().any(|id| queued.contains_key(id)) { return Err("A selected chapter is already queued. Refresh download status or use Retry for failed downloads."); }
                }
                DownloadControl::Retry => if !ids.iter().all(|id| queued.get(id).is_some_and(|row| row["state"] == "ERROR")) { return Err(CHANGED_SELECTION); },
                DownloadControl::Cancel => if !ids.iter().all(|id| queued.contains_key(id)) { return Err(CHANGED_SELECTION); },
                _ => unreachable!(),
            }
            Ok(true)
        }
    }
}

fn verify_download_selection(raw: &Value, ids: &[i32]) -> Result<(), &'static str> {
    let expected = selected_download_ids(ids)?;
    let rows = raw["nodes"].as_array().ok_or(CHANGED_SELECTION)?;
    if rows.len() != expected.len() || raw["totalCount"].as_u64() != Some(expected.len() as u64) { return Err(CHANGED_SELECTION); }
    let mut seen = BTreeSet::new();
    for row in rows {
        let id = download_id(&row["id"])?;
        if !expected.contains(&id) || !seen.insert(id) { return Err(CHANGED_SELECTION); }
        if row["isDownloaded"] != false { return Err("A selected chapter is already marked downloaded. Refresh the chapter list."); }
        download_page_count(&row["pageCount"])?;
        download_label(&row["name"])?;
        let manga = &row["manga"];
        if download_id(&row["mangaId"])? != download_id(&manga["id"])? { return Err(CHANGED_SELECTION); }
        download_label(&manga["title"])?;
        let source = manga["sourceId"].as_str().filter(|id| id.parse::<i64>().is_ok_and(|value| value != 0 && value.to_string() == *id))
            .ok_or("Select chapters from an installed online source; local chapters do not need downloading.")?;
        if manga["source"]["id"] != source || manga["source"]["extension"]["isInstalled"] != true {
            return Err("The selected chapter source is unavailable. Reload installed sources before downloading.");
        }
        extension_package(manga["source"]["extension"]["pkgName"].as_str().ok_or(CHANGED_SELECTION)?).map_err(|_| CHANGED_SELECTION)?;
    }
    Ok(())
}

fn downloaded_selection(raw: &Value, ids: &[i32]) -> Result<BTreeSet<i32>, &'static str> {
    let expected = selected_download_ids(ids)?;
    let rows = raw["nodes"].as_array().ok_or(INVALID_STATUS)?;
    if rows.len() != expected.len() || raw["totalCount"].as_u64() != Some(expected.len() as u64) { return Err(INVALID_STATUS); }
    let mut seen = BTreeSet::new();
    let mut downloaded = BTreeSet::new();
    for row in rows {
        let id = download_id(&row["id"])?;
        if !expected.contains(&id) || !seen.insert(id) { return Err(INVALID_STATUS); }
        if row["isDownloaded"].as_bool().ok_or(INVALID_STATUS)? { downloaded.insert(id); }
    }
    Ok(downloaded)
}

fn reconciled_download_status(control: DownloadControl, ids: &[i32], acknowledged: bool,
    mut current: Value, downloaded: Option<&BTreeSet<i32>>) -> Value
{
    let queue = current["queue"].as_array().expect("verified download status");
    let observed = match control {
        DownloadControl::Enqueue | DownloadControl::Retry => ids.iter().all(|id| {
            queue.iter().any(|row| row["id"].as_i64() == Some(i64::from(*id))) || downloaded.is_some_and(|done| done.contains(id))
        }),
        DownloadControl::Cancel => !queue.iter().any(|row| row["id"].as_i64().is_some_and(|id| ids.iter().any(|selected| i64::from(*selected) == id))),
        DownloadControl::Pause => current["state"] == "STOPPED",
        DownloadControl::Resume => current["state"] == "STARTED" || queue.iter().all(|row| row["state"] == "ERROR"),
    };
    if !acknowledged || !observed { current["uncertain"] = json!(true); }
    current
}

pub(super) fn validate_chapter_download_flags(chapters: &Value) -> Result<(), &'static str> {
    let mut seen = BTreeSet::new();
    for chapter in chapters.as_array().ok_or("Invalid chapter download state.")? {
        if !seen.insert(download_id(&chapter["id"])?) || !chapter["isDownloaded"].is_boolean() { return Err("Invalid chapter download state."); }
        download_page_count(&chapter["pageCount"])?;
    }
    Ok(())
}

impl ReadRuntime {
    pub fn download_status(&self) -> Result<Value, &'static str> {
        let raw = self.client.document(DOWNLOAD_STATUS_QUERY, "downloadStatus", json!({})).map_err(|_| INVALID_STATUS)?;
        project_download_status(&raw)
    }

    pub fn require_empty_download_queue(&self) -> Result<(), &'static str> {
        let status = self.download_status()?;
        if status["state"] != "STOPPED" || !status["queue"].as_array().is_some_and(Vec::is_empty) { return Err(PENDING_DOWNLOADS); }
        Ok(())
    }

    pub fn enqueue_downloads(&self, ids: &[i32]) -> Result<Value, &'static str> { self.control_downloads(DownloadControl::Enqueue, ids) }
    pub fn cancel_downloads(&self, ids: &[i32]) -> Result<Value, &'static str> { self.control_downloads(DownloadControl::Cancel, ids) }
    pub fn retry_downloads(&self, ids: &[i32]) -> Result<Value, &'static str> { self.control_downloads(DownloadControl::Retry, ids) }
    pub fn pause_downloads(&self) -> Result<Value, &'static str> { self.control_downloads(DownloadControl::Pause, &[]) }
    pub fn resume_downloads(&self) -> Result<Value, &'static str> { self.control_downloads(DownloadControl::Resume, &[]) }

    fn control_downloads(&self, control: DownloadControl, ids: &[i32]) -> Result<Value, &'static str> {
        if !matches!(control, DownloadControl::Pause | DownloadControl::Resume) { selected_download_ids(ids)?; }
        let before = self.download_status()?;
        if !should_control_downloads(control, ids, &before)? { return Ok(before); }
        if matches!(control, DownloadControl::Enqueue | DownloadControl::Retry) {
            let selected = self.client.document(
                "query TsugiDownloadSelection($ids: [Int!]!) { chapters(filter: {id: {in: $ids}}, first: 100, order: [{by: ID, byType: ASC}]) { nodes { id mangaId name pageCount isDownloaded manga { id title sourceId source { id extension { pkgName isInstalled } } } } totalCount } }",
                "chapters", json!({"ids": ids}))?;
            verify_download_selection(&selected, ids)?;
            // Recheck membership/capacity immediately before sending. The
            // downloader continues independently of this serialized broker.
            should_control_downloads(control, ids, &self.download_status()?)?;
        }
        let (document, key, input) = match control {
            DownloadControl::Enqueue | DownloadControl::Retry => (ENQUEUE_DOWNLOADS, "enqueueChapterDownloads", json!({"ids": ids})),
            DownloadControl::Cancel => (CANCEL_DOWNLOADS, "dequeueChapterDownloads", json!({"ids": ids})),
            DownloadControl::Pause => (PAUSE_DOWNLOADS, "stopDownloader", json!({})),
            DownloadControl::Resume => (RESUME_DOWNLOADS, "startDownloader", json!({})),
        };
        // One write only. Pinned mutations can change the queue before their
        // update-event acknowledgement times out. Always fetch current state;
        // never replay an uncertain enqueue, cancellation or start/stop.
        let acknowledged = self.client.slow().mutation(document, key, input)
            .and_then(|reply| project_download_status(&reply["downloadStatus"])).is_ok();
        let current = self.download_status().map_err(|_| UNCERTAIN_OPERATION)?;
        let downloaded = if matches!(control, DownloadControl::Enqueue | DownloadControl::Retry) {
            self.client.document(
                "query TsugiDownloadedSelection($ids: [Int!]!) { chapters(filter: {id: {in: $ids}}, first: 100) { nodes { id isDownloaded } totalCount } }",
                "chapters", json!({"ids": ids})).and_then(|raw| downloaded_selection(&raw, ids)).ok()
        } else { None };
        Ok(reconciled_download_status(control, ids, acknowledged, current, downloaded.as_ref()))
    }
}

#[cfg(test)]
#[path = "read_downloads_tests.rs"]
mod tests;

#[cfg(test)]
mod unit_tests {
    use super::*;

    fn raw_status() -> Value {
        json!({"state":"STARTED", "queue":[{"state":"DOWNLOADING","progress":0.25,"tries":4,"position":0,
            "chapter":{"id":11,"mangaId":7,"name":"Original chapter","pageCount":-1,"isDownloaded":false,"url":"private-not-exported"},
            "manga":{"id":7,"title":"Original title","url":"private-not-exported"}}]})
    }
    fn selected() -> Value {
        json!({"totalCount":1,"nodes":[{"id":11,"mangaId":7,"name":"Original chapter","pageCount":-1,"isDownloaded":false,
            "manga":{"id":7,"title":"Original title","sourceId":"-9007199254740993","source":{"id":"-9007199254740993","extension":{"pkgName":"org.tsugi.fixture","isInstalled":true}}}}]})
    }

    #[test]
    fn download_status_is_complete_bounded_and_projects_only_display_state() {
        let result = project_download_status(&raw_status()).unwrap();
        assert_eq!(result["queue"][0]["tries"], 4);
        assert_eq!(result["queue"][0]["pageCount"], -1);
        assert!(!result.to_string().contains("private-not-exported"));
        for (field, bad) in [("state", json!("PAUSED")), ("progress", json!(1.01)), ("progress", json!(-0.1)), ("tries", json!(-1)), ("tries", json!(1.5)), ("position", json!(1))] {
            let mut raw = raw_status(); raw["queue"][0][field] = bad; assert!(project_download_status(&raw).is_err());
        }
        for (field, bad) in [("id", json!("11")), ("mangaId", json!(8)), ("pageCount", json!(-2)), ("isDownloaded", json!("false")), ("name", json!("a".repeat(501)))] {
            let mut raw = raw_status(); raw["queue"][0]["chapter"][field] = bad; assert!(project_download_status(&raw).is_err());
        }
        let mut raw = raw_status(); raw["state"] = json!("PAUSED"); assert!(project_download_status(&raw).is_err());
        let mut raw = raw_status(); let mut duplicate = raw["queue"][0].clone(); duplicate["position"] = json!(1);
        raw["queue"].as_array_mut().unwrap().push(duplicate); assert!(project_download_status(&raw).is_err());
        let mut raw = raw_status(); raw["queue"] = json!(vec![raw["queue"][0].clone(); 1001]); assert!(project_download_status(&raw).is_err());
    }

    #[test]
    fn download_selections_refuse_unknown_completed_local_and_unavailable_chapters() {
        assert!(verify_download_selection(&selected(), &[11]).is_ok());
        for ids in [vec![], vec![0], vec![11,11], vec![11;101]] { assert!(selected_download_ids(&ids).is_err()); }
        let mut raw = selected(); raw["totalCount"] = json!(2); assert!(verify_download_selection(&raw, &[11]).is_err());
        let mut raw = selected(); raw["nodes"][0]["id"] = json!(12); assert!(verify_download_selection(&raw, &[11]).is_err());
        let mut raw = selected(); raw["nodes"][0]["isDownloaded"] = json!(true); assert!(verify_download_selection(&raw, &[11]).is_err());
        let mut raw = selected(); raw["nodes"][0]["manga"]["sourceId"] = json!("0"); assert!(verify_download_selection(&raw, &[11]).is_err());
        let mut raw = selected(); raw["nodes"][0]["manga"]["source"] = Value::Null; assert!(verify_download_selection(&raw, &[11]).is_err());
        let mut raw = selected(); raw["nodes"][0]["manga"]["source"]["extension"]["isInstalled"] = json!(false); assert!(verify_download_selection(&raw, &[11]).is_err());
    }

    #[test]
    fn controls_require_current_membership_and_retry_only_failed_rows() {
        let mut status = project_download_status(&raw_status()).unwrap();
        assert!(should_control_downloads(DownloadControl::Enqueue, &[11], &status).is_err());
        assert!(should_control_downloads(DownloadControl::Cancel, &[12], &status).is_err());
        assert!(should_control_downloads(DownloadControl::Cancel, &[11], &status).unwrap());
        assert!(should_control_downloads(DownloadControl::Retry, &[11], &status).is_err());
        status["queue"][0]["state"] = json!("ERROR"); status["state"] = json!("STOPPED");
        assert!(should_control_downloads(DownloadControl::Retry, &[11], &status).unwrap());
        assert!(!should_control_downloads(DownloadControl::Resume, &[], &status).unwrap());
        assert!(!should_control_downloads(DownloadControl::Pause, &[], &status).unwrap());
        status["queue"][0]["state"] = json!("QUEUED");
        assert!(should_control_downloads(DownloadControl::Resume, &[], &status).unwrap());
        status["queue"][0]["state"] = json!("FINISHED");
        assert!(should_control_downloads(DownloadControl::Cancel, &[11], &status).unwrap());
    }

    #[test]
    fn uncertain_acknowledgements_return_current_queue_without_claiming_success() {
        let status = project_download_status(&raw_status()).unwrap();
        assert_eq!(reconciled_download_status(DownloadControl::Enqueue, &[11], false, status.clone(), None)["uncertain"], true);
        assert!(reconciled_download_status(DownloadControl::Enqueue, &[11], true, status.clone(), None).get("uncertain").is_none());
        assert_eq!(reconciled_download_status(DownloadControl::Cancel, &[11], true, status, None)["uncertain"], true);
        let empty = json!({"state":"STOPPED","queue":[]});
        assert_eq!(reconciled_download_status(DownloadControl::Enqueue, &[11], true, empty.clone(), None)["uncertain"], true);
        let completed = BTreeSet::from([11]);
        assert!(reconciled_download_status(DownloadControl::Enqueue, &[11], true, empty.clone(), Some(&completed)).get("uncertain").is_none());
        assert!(reconciled_download_status(DownloadControl::Cancel, &[11], true, empty, None).get("uncertain").is_none());
    }
}
