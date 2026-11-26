//! Reviewed Mihon reconstruction through the pinned engine's public backup API.
//! Original files, private preferences and arbitrary protobuf never enter this
//! operation. Current engine-exported metadata is retained before each merge.
use super::*;
use crate::bridge::MihonImportInput;
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

const MAX_BYTES: usize = 32 * 1024 * 1024;
const INVALID: &str = "The Mihon import metadata is invalid or exceeds its limits. Choose the backup again.";
const STALE: &str = "The Mihon review expired or library state changed. Review the backup again.";
const FLAGS: &str = "includeManga: true, includeChapters: true, includeCategories: false, includeHistory: true, includeTracking: true, includeClientData: false, includeServerSettings: false";

#[derive(Clone, Debug, PartialEq, Eq)]
struct Field { number: u32, wire: u8, bytes: Vec<u8> }
type Message = Vec<Field>;

fn varint(data: &[u8], position: &mut usize) -> Result<u64, &'static str> {
    let mut value = 0u64;
    for index in 0..10 {
        let byte = *data.get(*position).ok_or(INVALID)?; *position += 1;
        if index == 9 && byte > 1 { return Err(INVALID); }
        value |= u64::from(byte & 127) << (index * 7);
        if byte < 128 { if index > 0 && byte == 0 { return Err(INVALID); } return Ok(value); }
    }
    Err(INVALID)
}
fn encode_varint(mut value: u64) -> Vec<u8> {
    let mut bytes = Vec::new();
    loop { let byte = (value & 127) as u8; value >>= 7; bytes.push(byte | if value > 0 { 128 } else { 0 }); if value == 0 { return bytes; } }
}
fn parse(data: &[u8]) -> Result<Message, &'static str> {
    if data.len() > MAX_BYTES { return Err(INVALID); }
    let mut position = 0; let mut fields = Vec::new();
    while position < data.len() {
        if fields.len() >= 200_000 { return Err(INVALID); }
        let tag = varint(data, &mut position)?;
        if tag < 8 || tag > u64::from(u32::MAX) { return Err(INVALID); }
        let wire = (tag & 7) as u8;
        let size = match wire {
            0 => { let start = position; varint(data, &mut position)?; fields.push(Field { number: (tag >> 3) as u32, wire, bytes: data[start..position].to_vec() }); continue; }
            1 => 8,
            2 => usize::try_from(varint(data, &mut position)?).map_err(|_| INVALID)?,
            5 => 4,
            _ => return Err(INVALID),
        };
        let end = position.checked_add(size).filter(|end| *end <= data.len()).ok_or(INVALID)?;
        fields.push(Field { number: (tag >> 3) as u32, wire, bytes: data[position..end].to_vec() }); position = end;
    }
    Ok(fields)
}
fn encode(fields: &[Field]) -> Result<Vec<u8>, &'static str> {
    let mut bytes = Vec::new();
    for field in fields {
        bytes.extend(encode_varint(u64::from(field.number) * 8 + u64::from(field.wire)));
        if field.wire == 2 { bytes.extend(encode_varint(field.bytes.len() as u64)); }
        bytes.extend(&field.bytes);
        if bytes.len() > MAX_BYTES { return Err(INVALID); }
    }
    Ok(bytes)
}
fn number_field(number: u32, value: i64) -> Field { Field { number, wire: 0, bytes: encode_varint(value as u64) } }
fn bytes_field(number: u32, bytes: Vec<u8>) -> Field { Field { number, wire: 2, bytes } }
fn text_field(number: u32, value: &str) -> Field { bytes_field(number, value.as_bytes().to_vec()) }
fn field(fields: &[Field], number: u32) -> Result<Option<&Field>, &'static str> {
    let mut values = fields.iter().filter(|field| field.number == number);
    let first = values.next(); if values.next().is_some() { return Err(INVALID); } Ok(first)
}
fn int(fields: &[Field], number: u32) -> Result<i64, &'static str> {
    let Some(value) = field(fields, number)? else { return Ok(0); };
    if value.wire != 0 { return Err(INVALID); }
    Ok(varint(&value.bytes, &mut 0)? as i64)
}
fn chapter_number(fields: &[Field]) -> Result<f32, &'static str> {
    let Some(value) = field(fields, 9)? else { return Ok(0.0); };
    if value.wire != 5 { return Err(INVALID); }
    let value = f32::from_le_bytes(value.bytes.as_slice().try_into().map_err(|_| INVALID)?);
    if !value.is_finite() { return Err(INVALID); } Ok(value)
}
fn text_value(fields: &[Field], number: u32) -> Result<String, &'static str> {
    let Some(value) = field(fields, number)? else { return Ok(String::new()); };
    if value.wire != 2 { return Err(INVALID); }
    String::from_utf8(value.bytes.clone()).map_err(|_| INVALID)
}
fn messages(fields: &[Field], number: u32, maximum: usize) -> Result<Vec<Message>, &'static str> {
    let mut out = Vec::new();
    for field in fields.iter().filter(|field| field.number == number) {
        if out.len() >= maximum || field.wire != 2 { return Err(INVALID); } out.push(parse(&field.bytes)?);
    }
    Ok(out)
}
fn set(fields: &mut Message, replacement: Field) { fields.retain(|field| field.number != replacement.number); fields.push(replacement); }
fn set_messages(fields: &mut Message, number: u32, rows: &[Message]) -> Result<(), &'static str> {
    fields.retain(|field| field.number != number);
    for row in rows { fields.push(bytes_field(number, encode(row)?)); } Ok(())
}
fn key(manga: &[Field]) -> Result<(String, String), &'static str> { Ok((int(manga, 1)?.to_string(), text_value(manga, 2)?)) }
fn canonical(fields: &[Field], excluded: &[u32]) -> Vec<(u32, u8, Vec<u8>)> {
    let mut values = fields.iter().filter(|field| !excluded.contains(&field.number))
        .filter(|field| !(field.wire == 0 && field.bytes == [0]) && !(field.wire == 2 && field.bytes.is_empty()))
        .map(|field| (field.number, field.wire, field.bytes.clone())).collect::<Vec<_>>();
    values.sort(); values
}
fn category_orders(manga: &[Field]) -> Result<BTreeSet<i32>, &'static str> {
    let mut orders = BTreeSet::new();
    for value in manga.iter().filter(|field| field.number == 17) {
        if !matches!(value.wire, 0 | 2) { return Err(INVALID); }
        let mut position = 0;
        while position < value.bytes.len() {
            let number = varint(&value.bytes, &mut position)?;
            orders.insert(i32::try_from(number as i64).map_err(|_| INVALID)?);
            if orders.len() > 100 { return Err(INVALID); }
        }
    }
    Ok(orders)
}
fn history(manga: &[Field]) -> Result<BTreeMap<String, i64>, &'static str> {
    let mut out = BTreeMap::new();
    for row in messages(manga, 104, 10_000)? {
        let at = int(&row, 2)?; if at < 0 { return Err(INVALID); }
        let url = text_value(&row, 1)?;
        out.entry(url).and_modify(|old: &mut i64| *old = (*old).max(at)).or_insert(at);
    } Ok(out)
}
fn gzip(bytes: &[u8]) -> Result<Vec<u8>, &'static str> {
    let mut writer = GzEncoder::new(Vec::new(), Compression::fast());
    writer.write_all(bytes).map_err(|_| INVALID)?; writer.finish().map_err(|_| INVALID)
}
fn gunzip(bytes: &[u8]) -> Result<Vec<u8>, &'static str> {
    if bytes.is_empty() || bytes.len() > MAX_BYTES { return Err(INVALID); }
    let mut expanded = Vec::new(); GzDecoder::new(bytes).take(MAX_BYTES as u64 + 1).read_to_end(&mut expanded).map_err(|_| INVALID)?;
    if expanded.len() > MAX_BYTES { return Err(INVALID); } Ok(expanded)
}
fn digest(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }
fn label(value: &str, maximum: usize) -> bool { !value.trim().is_empty() && value.chars().count() <= maximum && !value.chars().any(char::is_control) && !value.contains("://") }
fn identifier(value: &str) -> bool {
    if value.is_empty() || value.trim() != value || value.len() > 16384 || value.chars().any(char::is_control) || value.contains(['\\', '#']) || value.starts_with("//") { return false; }
    let lower = value.to_ascii_lowercase();
    if (0u8..=31).chain(std::iter::once(127)).any(|byte| lower.contains(&format!("%{byte:02x}"))) { return false; }
    let base = url::Url::parse("https://tsugi-import.invalid/").unwrap();
    let absolute = url::Url::parse(value).is_ok();
    let Ok(parsed) = base.join(value) else { return false; };
    if parsed.scheme() != "https" || !parsed.username().is_empty() || parsed.password().is_some() || parsed.fragment().is_some() { return false; }
    if absolute {
        let Some(url::Host::Domain(host)) = parsed.host() else { return false; };
        let host = host.trim_end_matches('.');
        if !host.contains('.') || ["localhost", "local", "internal", "invalid", "test", "localdomain"].iter().any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}"))) { return false; }
    }
    let allowed = ["id", "manga", "chapter", "title", "page", "volume", "lang", "language", "slug"];
    for (name, value) in parsed.query_pairs() {
        if !allowed.contains(&name.to_ascii_lowercase().as_str()) || value.is_empty() || value.len() > 200 || !value.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"_.~-".contains(&byte)) { return false; }
    }
    // Decode path escapes solely for credential-marker validation, never for
    // identity matching or output. The exact original identifier is retained.
    let path = parsed.path().as_bytes(); let mut decoded = Vec::new(); let mut index = 0;
    while index < path.len() {
        if path[index] == b'%' {
            if index + 2 >= path.len() { return false; }
            let pair = std::str::from_utf8(&path[index + 1..index + 3]).unwrap_or("");
            let Ok(byte) = u8::from_str_radix(pair, 16) else { return false; }; decoded.push(byte); index += 3;
        } else { decoded.push(path[index]); index += 1; }
    }
    let Ok(path) = String::from_utf8(decoded) else { return false; };
    !path.split('/').any(|part| ["auth", "token", "secret", "api-key", "api_key", "apikey", "password", "credential", "credentials", "session", "sessions", "signed"].contains(&part.to_ascii_lowercase().as_str()))
}
fn decimal(value: &str, positive: bool) -> Result<i64, &'static str> {
    let number = value.parse::<i64>().map_err(|_| INVALID)?;
    if number.to_string() != value || (positive && number <= 0) { return Err(INVALID); } Ok(number)
}
fn validate(input: &MihonImportInput) -> Result<(), &'static str> {
    if input.manga.len() > 1000 || input.categories.len() > 100 { return Err(INVALID); }
    let categories = input.categories.iter().collect::<BTreeSet<_>>();
    if categories.len() != input.categories.len() || input.categories.iter().any(|name| !label(name, 80) || name.trim().eq_ignore_ascii_case("default")) { return Err(INVALID); }
    let mut titles = BTreeSet::new(); let mut chapters = 0usize;
    for manga in &input.manga {
        decimal(&manga.source_id, false)?;
        if !identifier(&manga.url) || !label(&manga.title, 500) || !titles.insert((&manga.source_id, &manga.url))
            || manga.chapters.len() > 10000 || manga.categories.len() > 100 || manga.trackers.len() > 20
            || manga.categories.iter().collect::<BTreeSet<_>>().len() != manga.categories.len()
            || manga.categories.iter().any(|name| !categories.contains(name)) { return Err(INVALID); }
        chapters += manga.chapters.len(); if chapters > 100000 { return Err(INVALID); }
        let mut ids = BTreeSet::new();
        for chapter in &manga.chapters {
            let at = decimal(&chapter.last_read_at, false)?;
            if !identifier(&chapter.url) || !label(&chapter.name, 500) || chapter.page < 0 || !chapter.chapter_number.is_finite() || !(-1.0..=1_000_000_000.0).contains(&chapter.chapter_number) || chapter.source_order < 0 || at < 0 || at > i64::MAX / 1000 || !ids.insert(&chapter.url) { return Err(INVALID); }
        }
        for tracker in &manga.trackers { if !matches!(tracker.tracker_id, 1 | 2) { return Err(INVALID); } decimal(&tracker.remote_id, true)?; }
    } Ok(())
}

struct Merged { payload: Vec<u8>, expected: Vec<Message>, rows: Vec<Value> }

fn merge(input: &MihonImportInput, original: &[Message], counts: &BTreeMap<(String, String), (i32, i32)>, cached: &BTreeSet<(String, String)>) -> Result<Merged, &'static str> {
    validate(input)?;
    let mut originals = BTreeMap::new();
    for row in original { if originals.insert(key(row)?, row).is_some() { return Err(INVALID); } }
    let mut expected = Vec::new(); let mut rows = Vec::new();
    for incoming in &input.manga {
        let identity = (incoming.source_id.clone(), incoming.url.clone());
        let existing = originals.get(&identity).copied();
        if existing.is_none() && (incoming.source_id == "0" || cached.contains(&identity)) {
            rows.push(json!({"title": incoming.title, "sourceId": incoming.source_id, "state": if incoming.source_id == "0" { "local-files-required" } else { "cached-title-not-in-library" }, "chapters": 0, "history": 0, "trackers": 0, "trackerConflicts": 0, "partialSkipped": incoming.chapters.iter().filter(|chapter| !chapter.read && chapter.page > 0).count()})); continue;
        }
        let mut manga = existing.cloned().unwrap_or_else(|| vec![number_field(1, incoming.source_id.parse().unwrap()), text_field(2, &incoming.url), text_field(3, &incoming.title), number_field(100, 1)]);
        let old_chapters = messages(&manga, 16, 10000)?;
        let mut chapters = BTreeMap::new();
        let mut order = Vec::new();
        for row in old_chapters { let id = text_value(&row, 1)?; order.push(id.clone()); if chapters.insert(id, row).is_some() { return Err(INVALID); } }
        let mut dates = history(&manga)?;
        let manga_identity = backup_identity("tsugi-manga-v1", &incoming.source_id, &incoming.url);
        let mut partial_skipped = 0; let mut history_added = 0; let mut chapters_added = 0;
        for old in &incoming.chapters {
            let prior = chapters.get(&old.url); let new = prior.is_none();
            let mut chapter = prior.cloned().unwrap_or_else(|| vec![text_field(1, &old.url), text_field(2, &old.name), Field { number: 9, wire: 5, bytes: old.chapter_number.to_le_bytes().to_vec() }, number_field(10, i64::from(old.source_order))]);
            let at = old.last_read_at.parse::<i64>().map_err(|_| INVALID)?.checked_mul(1000).ok_or(INVALID)?;
            let before_at = *dates.get(&old.url).unwrap_or(&0);
            let recent = at >= before_at;
            if old.read && recent { set(&mut chapter, number_field(4, 1)); }
            if old.bookmark { set(&mut chapter, number_field(5, 1)); }
            if old.page > 0 && !old.read {
                let chapter_identity = backup_identity("tsugi-chapter-v1", &manga_identity, &old.url);
                let count = counts.get(&(manga_identity.clone(), chapter_identity));
                if input.include_partial_pages && recent && int(&chapter, 4)? == 0 && count.is_some_and(|(_, count)| old.page < *count)
                    && i64::from(old.page) > int(&chapter, 6)? { set(&mut chapter, number_field(6, i64::from(old.page))); }
                else { partial_skipped += 1; }
            }
            if at > before_at { dates.insert(old.url.clone(), at); history_added += 1; }
            if new { chapters_added += 1; order.push(old.url.clone()); }
            chapters.insert(old.url.clone(), chapter);
        }
        // Retain original ordering for existing chapters. New rows use a
        // deterministic source order; real catalogue refresh owns later order.
        let total = order.len(); if total > 10000 { return Err(INVALID); }
        let list = order.iter().map(|id| chapters.get(id).unwrap().clone()).collect::<Vec<_>>();
        set_messages(&mut manga, 16, &list)?;
        let histories = dates.iter().filter(|(_, at)| **at > 0).map(|(url, at)| vec![text_field(1, url), number_field(2, *at)]).collect::<Vec<_>>();
        set_messages(&mut manga, 104, &histories)?;
        let mut trackers = messages(&manga, 18, 20)?;
        let mut tracker_ids = BTreeMap::new();
        for row in &trackers { if tracker_ids.insert(int(row, 1)?, int(row, 100)?).is_some() { return Err(INVALID); } }
        let mut added_trackers = 0; let mut tracker_conflicts = 0;
        if input.include_trackers {
            let mut proposed: BTreeMap<i32, BTreeSet<i64>> = BTreeMap::new();
            for tracker in &incoming.trackers { proposed.entry(tracker.tracker_id).or_default().insert(decimal(&tracker.remote_id, true)?); }
            for (tracker, remote_ids) in proposed {
                if remote_ids.len() != 1 { tracker_conflicts += 1; continue; }
                let remote_id = *remote_ids.first().unwrap();
                match tracker_ids.get(&i64::from(tracker)) {
                    Some(current) if *current != remote_id => tracker_conflicts += 1,
                    Some(_) => (),
                    None => {
                        trackers.push(vec![number_field(1, i64::from(tracker)), number_field(2, 0), number_field(100, remote_id), text_field(5, &incoming.title)]);
                        added_trackers += 1;
                    }
                }
            }
        }
        set_messages(&mut manga, 18, &trackers)?;
        rows.push(json!({"title": incoming.title, "sourceId": incoming.source_id, "state": if existing.is_some() { "merge" } else { "new" }, "chapters": chapters_added, "history": history_added, "trackers": added_trackers, "trackerConflicts": tracker_conflicts, "partialSkipped": partial_skipped}));
        expected.push(manga);
    }
    let added = expected.iter().filter(|row| key(row).ok().is_some_and(|id| !originals.contains_key(&id))).count();
    if original.len() + added > 1000 { return Err("The combined library exceeds the 1,000-title import limit."); }
    let mut final_chapters = BTreeMap::new();
    for row in original.iter().chain(&expected) { final_chapters.insert(key(row)?, messages(row, 16, 10000)?.len()); }
    if final_chapters.values().sum::<usize>() > 100000 { return Err(INVALID); }
    // The upstream restore updates an existing tracker record when supplied,
    // including account-local IDs. Send only brand-new tracker mappings; the
    // expected verification still contains every unchanged original mapping.
    let mut payload_rows = expected.clone();
    for row in &mut payload_rows {
        let previous = originals.get(&key(row)?).copied();
        let existing = previous.map(|value| messages(value, 18, 20)).transpose()?.unwrap_or_default();
        let existing_ids = existing.iter().map(|value| int(value, 1)).collect::<Result<BTreeSet<_>, _>>()?;
        let new_tracks = messages(row, 18, 20)?.into_iter().filter(|value| int(value, 1).is_ok_and(|id| !existing_ids.contains(&id))).collect::<Vec<_>>();
        set_messages(row, 18, &new_tracks)?;
    }
    let mut root = Vec::new(); set_messages(&mut root, 1, &payload_rows)?;
    Ok(Merged { payload: gzip(&encode(&root)?)?, expected, rows })
}

pub struct MihonImportReview {
    id: String, created: Instant, owner: u32, input: MihonImportInput,
    before: Vec<u8>, before_categories: Value, cached: BTreeSet<(String, String)>,
    counts: BTreeMap<(String, String), (i32, i32)>, merged: Merged,
}
impl MihonImportReview {
    pub fn id(&self) -> &str { &self.id }
    pub fn preview(&self) -> Value {
        json!({"reviewId": self.id, "rows": self.merged.rows, "categories": self.input.categories,
            "includesTrackers": self.input.include_trackers, "includesPartialPages": self.input.include_partial_pages})
    }
    pub fn description(&self) -> String {
        format!("Import {} reviewed manga entries and merge {} category names?\n\nMissing remote titles and chapters will be reconstructed from the backup without contacting sources. Existing newer progress, bookmarks and tracker mappings are preserved. Missing local media and cached titles outside the library are skipped.\n\nA private recovery copy is created before changing Reader data. All applied metadata is verified after restart; failure restores that copy. No extensions, account connections, source preferences or remote tracker updates are imported.", self.merged.expected.len(), self.input.categories.len())
    }
}

impl ReadRuntime {
    fn mihon_export(&self) -> Result<Vec<u8>, &'static str> {
        let value = self.client.document("mutation TsugiMihonSnapshot { createBackup(input: { flags: { includeManga: true, includeChapters: true, includeCategories: true, includeTracking: true, includeHistory: true, includeClientData: true, includeServerSettings: false } }) { url } }", "createBackup", json!({}))?;
        let path = value["url"].as_str().ok_or(INVALID)?;
        let token = path.strip_prefix("/api/graphql/files/backup/").ok_or(INVALID)?;
        if token.is_empty() || token.len() > 100 || !token.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte)) || !token.ends_with(".tachibk") { return Err(INVALID); }
        verify_listener(self.client.port, self.client.owner_pid)?;
        let mut response = self.client.agent.get(format!("http://127.0.0.1:{}{path}", self.client.port))
            .header("Authorization", &self.client.authorization).header("Connection", "close").call().map_err(|_| "Could not read the current Reader backup.")?;
        if response.status().as_u16() != 200 { return Err("The Reader backup could not be read."); }
        let mut bytes = Vec::new(); response.body_mut().as_reader().take(MAX_BYTES as u64 + 1).read_to_end(&mut bytes).map_err(|_| INVALID)?;
        gunzip(&bytes)
    }
    fn mihon_catalogue_state(&self) -> Result<(BTreeSet<(String, String)>, BTreeMap<(String, String), (i32, i32)>), &'static str> {
        let mut seen = BTreeSet::new(); let mut counts = BTreeMap::new(); let mut offset = 0usize; let mut total = None;
        loop {
            let page = self.client.document("query TsugiMihonInventory($offset: Int!) { mangas(first: 100, offset: $offset, order: [{ by: ID, byType: ASC }]) { nodes { id sourceId url inLibrary } totalCount } }", "mangas", json!({"offset": offset}))?;
            let rows = page["nodes"].as_array().ok_or(INVALID)?; let count = page["totalCount"].as_u64().filter(|count| *count <= 10000).ok_or(INVALID)? as usize;
            if total.is_some_and(|old| old != count) || offset + rows.len() > count || (rows.is_empty() && offset < count) { return Err(STALE); } total = Some(count);
            for row in rows {
                let source = backup_long(&row["sourceId"])?.to_string(); let url = backup_url(&row["url"])?;
                if !seen.insert((source, url.to_owned())) { return Err(INVALID); }
                if row["inLibrary"] == true {
                    let id = row["id"].as_i64().and_then(|id| i32::try_from(id).ok()).filter(|id| *id > 0).ok_or(INVALID)?;
                    let raw = self.backup_manga_raw(id)?;
                    let snapshot = project_manga_backup(&raw, id)?; let identity = snapshot["identity"].as_str().ok_or(INVALID)?;
                    for chapter in backup_nodes(&raw["chapters"], 10_000)? {
                        let chapter_identity = backup_identity("tsugi-chapter-v1", identity, backup_url(&chapter["url"])?);
                        // Preserve the exact signed runtime value for stale
                        // review and post-restore checks, including unknown -1.
                        let page_count = backup_page_count(&chapter["pageCount"])?;
                        if counts.insert((identity.to_owned(), chapter_identity), (id, page_count)).is_some() { return Err(INVALID); }
                    }
                }
            }
            offset += rows.len(); if offset == count { return Ok((seen, counts)); }
        }
    }
    fn mihon_idle(&self) -> Result<(), &'static str> {
        self.require_empty_download_queue()?;
        let settings = self.client.document("query TsugiMihonSchedules { settings { autoDownloadNewChapters globalUpdateInterval } }", "settings", json!({}))?;
        if settings["autoDownloadNewChapters"] != false || settings["globalUpdateInterval"].as_f64() != Some(0.0)
            || self.library_update_status()?["jobsInfo"]["isRunning"] != false {
            return Err("Pause automatic downloads and library updates before importing a Mihon backup.");
        }
        Ok(())
    }
    pub fn review_mihon_import(&self, input: MihonImportInput) -> Result<MihonImportReview, &'static str> {
        validate(&input)?; self.mihon_idle()?;
        let before = self.mihon_export()?; let original = messages(&parse(&before)?, 1, 1000)?;
        let before_categories = self.query(ReadOperation::Categories)?;
        let mut category_names = BTreeSet::new();
        for row in backup_nodes(&before_categories, 100)? {
            let name = row["name"].as_str().ok_or(INVALID)?;
            if !category_names.insert(name) { return Err("Resolve duplicate category names before importing."); }
        }
        category_names.extend(input.categories.iter().map(String::as_str));
        if category_names.len() > 100 { return Err("The combined library exceeds the 100-category import limit."); }
        let (cached, counts) = self.mihon_catalogue_state()?;
        let merged = merge(&input, &original, &counts, &cached)?;
        if self.mihon_export()? != before || self.query(ReadOperation::Categories)? != before_categories { return Err(STALE); }
        let mut entropy = [0u8; 16]; getrandom::fill(&mut entropy).map_err(|_| INVALID)?;
        Ok(MihonImportReview { id: entropy.iter().map(|byte| format!("{byte:02x}")).collect(), created: Instant::now(), owner: self.client.owner_pid,
            input, before, before_categories, cached, counts, merged })
    }
    fn mihon_restore(&self, payload: &[u8]) -> Result<(), &'static str> {
        let boundary = format!("TsugiMihon{}", &digest(payload)[..32]);
        let query = format!("mutation TsugiMihonRestore($file: Upload!) {{ restoreBackup(input: {{ backup: $file, flags: {{ {FLAGS} }} }}) {{ id status {{ state }} }} }}");
        let operation = json!({"query": query, "variables": {"file": null}});
        let mut body = format!("--{boundary}\r\nContent-Disposition: form-data; name=\"operations\"\r\n\r\n{operation}\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"map\"\r\n\r\n{{\"0\":[\"variables.file\"]}}\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"0\"; filename=\"tsugi-reviewed.tachibk\"\r\nContent-Type: application/octet-stream\r\n\r\n").into_bytes();
        body.extend_from_slice(payload); body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
        let cookies = self.extension_upload_session()?;
        verify_listener(self.client.port, self.client.owner_pid)?;
        let mut response = self.client.slow().agent.post(format!("http://127.0.0.1:{}/api/graphql", self.client.port))
            .header("Authorization", &self.client.authorization).header("Cookie", &cookies).header("Connection", "close")
            .header("Content-Type", format!("multipart/form-data; boundary={boundary}")).send(body).map_err(|_| "The Reader did not confirm the Mihon import.")?;
        let mut bytes = Vec::new(); response.body_mut().as_reader().take(MAX_RESPONSE + 1).read_to_end(&mut bytes).map_err(|_| INVALID)?;
        if response.status().as_u16() != 200 || bytes.len() as u64 > MAX_RESPONSE { return Err("The Reader rejected the Mihon import."); }
        let result: Value = serde_json::from_slice(&bytes).map_err(|_| INVALID)?;
        if result.get("errors").is_some_and(|errors| !errors.is_null()) { return Err("The Reader rejected the Mihon import."); }
        let id = result["data"]["restoreBackup"]["id"].as_str().filter(|id| !id.is_empty() && id.len() <= 30 && id.bytes().all(|byte| byte.is_ascii_digit())).ok_or(INVALID)?;
        let deadline = Instant::now() + Duration::from_secs(180);
        loop {
            let status = self.client.document("query TsugiMihonRestoreStatus($id: String!) { restoreStatus(id: $id) { state } }", "restoreStatus", json!({"id": id}))?;
            match status["state"].as_str() {
                Some("SUCCESS") => return Ok(()), Some("FAILURE") | None => return Err("The Reader could not complete the Mihon import."),
                Some("IDLE" | "RESTORING_MANGA") if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(100)),
                _ => return Err("The Mihon import timed out or returned an unexpected state."),
            }
        }
    }
    fn mihon_categories(&self, review: &MihonImportReview) -> Result<(), &'static str> {
        let categories = self.query(ReadOperation::Categories)?;
        let mut names = BTreeMap::new();
        for row in backup_nodes(&categories, 100)? {
            let name = row["name"].as_str().ok_or(INVALID)?.to_owned(); let id = row["id"].as_i64().and_then(|id| i32::try_from(id).ok()).ok_or(INVALID)?;
            if names.insert(name, id).is_some() { return Err(INVALID); }
        }
        for name in &review.input.categories {
            if !names.contains_key(name) {
                let created = self.save_category(None, name)?;
                let id = created["category"]["id"].as_i64().and_then(|id| i32::try_from(id).ok()).filter(|id| *id > 0).ok_or(INVALID)?;
                names.insert(name.clone(), id);
            }
        }
        let restored = self.mihon_ids()?;
        for manga in &review.input.manga {
            let Some(id) = restored.get(&(manga.source_id.clone(), manga.url.clone())) else { continue; };
            if !review.merged.expected.iter().any(|row| key(row).ok().as_ref() == Some(&(manga.source_id.clone(), manga.url.clone()))) { continue; }
            for name in &manga.categories { self.assign_category(*id, *names.get(name).ok_or(INVALID)?, true)?; }
        }
        Ok(())
    }
    fn mihon_ids(&self) -> Result<BTreeMap<(String, String), i32>, &'static str> {
        let mut ids = BTreeMap::new(); let mut offset = 0usize;
        loop {
            let page = self.client.document("query TsugiMihonLibraryIds($offset: Int!) { mangas(condition: { inLibrary: true }, first: 100, offset: $offset, order: [{ by: ID, byType: ASC }]) { nodes { id sourceId url } totalCount } }", "mangas", json!({"offset": offset}))?;
            let rows = page["nodes"].as_array().ok_or(INVALID)?; let count = page["totalCount"].as_u64().filter(|count| *count <= 1000).ok_or(INVALID)? as usize;
            if offset + rows.len() > count || (rows.is_empty() && offset < count) { return Err(INVALID); }
            for row in rows {
                let id = row["id"].as_i64().and_then(|id| i32::try_from(id).ok()).filter(|id| *id > 0).ok_or(INVALID)?;
                if ids.insert((backup_long(&row["sourceId"])?.to_string(), backup_url(&row["url"] )?.to_owned()), id).is_some() { return Err(INVALID); }
            }
            offset += rows.len(); if offset == count { return Ok(ids); }
        }
    }
    fn verify_mihon(&self, review: &MihonImportReview) -> Result<(), &'static str> {
        let after = messages(&parse(&self.mihon_export()?)?, 1, 1000)?;
        let mut by_id = BTreeMap::new(); for row in &after { if by_id.insert(key(row)?, row).is_some() { return Err(INVALID); } }
        let original = messages(&parse(&review.before)?, 1, 1000)?;
        let mut expected = original.iter().map(|row| Ok((key(row)?, row))).collect::<Result<BTreeMap<_, _>, &'static str>>()?;
        for row in &review.merged.expected { expected.insert(key(row)?, row); }
        if by_id.len() != expected.len() { return Err("The imported library did not match the review."); }
        for (id, wanted) in expected {
            let actual = by_id.get(&id).ok_or("A reviewed title was not imported.")?;
            if text_value(wanted, 3)? != text_value(actual, 3)? { return Err("An imported title did not match the review."); }
            // New database records supply their own version/default metadata;
            // every pre-existing manga keeps all metadata except category union.
            if original.iter().any(|row| key(row).ok().as_ref() == Some(&id)) && canonical(wanted, &[16, 17, 18, 104]) != canonical(actual, &[16, 17, 18, 104]) { return Err("Existing manga metadata changed during import."); }
            let want_chapters = messages(wanted, 16, 10000)?; let got_chapters = messages(actual, 16, 10000)?;
            let got = got_chapters.iter().map(|row| Ok((text_value(row, 1)?, row))).collect::<Result<BTreeMap<_, _>, &'static str>>()?;
            if got.len() != want_chapters.len() { return Err("The imported chapter count did not match."); }
            for chapter in want_chapters {
                let found = got.get(&text_value(&chapter, 1)?).ok_or("A reviewed chapter was not imported.")?;
                if text_value(&chapter, 2)? != text_value(found, 2)? || chapter_number(&chapter)? != chapter_number(found)? { return Err("Imported chapter metadata did not match the review."); }
                for number in [4, 5, 6] { if int(&chapter, number)? != int(found, number)? { return Err("Imported chapter progress did not match the review."); } }
            }
            if history(wanted)? != history(actual)? { return Err("Imported history did not match the review."); }
            let wanted_tracks = messages(wanted, 18, 20)?; let actual_tracks = messages(actual, 18, 20)?;
            let tracks = |rows: &[Message]| rows.iter().map(|row| Ok((int(row, 1)?, int(row, 100)?))).collect::<Result<BTreeMap<_, _>, &'static str>>();
            if tracks(&wanted_tracks)? != tracks(&actual_tracks)? { return Err("Imported tracker mappings did not match the review."); }
        }
        let (_, page_counts) = self.mihon_catalogue_state()?;
        if review.counts.iter().any(|(key, count)| page_counts.get(key) != Some(count)) { return Err("Existing chapter identity or page count changed during import."); }
        for old in &original {
            let actual = by_id.get(&key(old)?).ok_or(INVALID)?;
            if !category_orders(old)?.is_subset(&category_orders(actual)?) { return Err("Existing category assignments changed during import."); }
            let old_chapters = messages(old, 16, 10000)?;
            let actual_chapters = messages(actual, 16, 10000)?;
            for chapter in old_chapters {
                let url = text_value(&chapter, 1)?;
                let current = actual_chapters.iter().find(|value| text_value(value, 1).ok().as_deref() == Some(url.as_str())).ok_or(INVALID)?;
                if canonical(&chapter, &[4, 5, 6, 10]) != canonical(current, &[4, 5, 6, 10]) { return Err("Existing chapter metadata changed during import."); }
            }
            let old_tracks = messages(old, 18, 20)?; let actual_tracks = messages(actual, 18, 20)?;
            for track in old_tracks {
                let id = int(&track, 1)?;
                let current = actual_tracks.iter().find(|value| int(value, 1).ok() == Some(id)).ok_or(INVALID)?;
                if canonical(&track, &[]) != canonical(current, &[]) { return Err("Existing tracker metadata changed during import."); }
            }
        }
        let ids = self.mihon_ids()?;
        let categories = self.query(ReadOperation::Categories)?;
        let names = backup_nodes(&categories, 100)?.iter().map(|row| row["name"].as_str().ok_or(INVALID)).collect::<Result<BTreeSet<_>, _>>()?;
        if review.input.categories.iter().any(|name| !names.contains(name.as_str())) { return Err("Imported categories were incomplete."); }
        for row in backup_nodes(&review.before_categories, 100)? {
            if !backup_nodes(&categories, 100)?.contains(row) { return Err("An existing category changed during import."); }
        }
        for manga in &review.input.manga {
            if !review.merged.expected.iter().any(|row| key(row).ok().as_ref() == Some(&(manga.source_id.clone(), manga.url.clone()))) { continue; }
            let id = ids.get(&(manga.source_id.clone(), manga.url.clone())).ok_or(INVALID)?;
            let state = self.backup_manga(*id)?; let names = state["categories"].as_array().ok_or(INVALID)?;
            if manga.categories.iter().any(|name| !names.contains(&json!(name))) { return Err("Imported category assignments were incomplete."); }
        }
        Ok(())
    }
    pub fn apply_mihon_import(&mut self, review: MihonImportReview) -> Result<Value, &'static str> {
        if review.created.elapsed() > Duration::from_secs(600) || review.owner != self.client.owner_pid { return Err(STALE); }
        self.mihon_idle()?;
        if self.mihon_export()? != review.before || self.query(ReadOperation::Categories)? != review.before_categories || self.mihon_catalogue_state()? != (review.cached.clone(), review.counts.clone()) { return Err(STALE); }
        self.shutdown()?;
        let checkpoint = match crate::read_checkpoint::create(&self.data_path) { Ok(value) => value, Err(error) => { self.restart_after_stop()?; return Err(error); } };
        let checkpoint_id = checkpoint.id().to_owned();
        let applied = (|| {
            self.restart_after_stop()?; self.mihon_idle()?;
            if self.mihon_export()? != review.before || self.query(ReadOperation::Categories)? != review.before_categories { return Err(STALE); }
            if !review.merged.expected.is_empty() { self.mihon_restore(&review.merged.payload)?; }
            self.mihon_categories(&review)?;
            self.shutdown()?; self.restart_after_stop()?; self.mihon_idle()?;
            self.verify_mihon(&review)
        })();
        if let Err(error) = applied {
            self.shutdown()?; checkpoint.rollback()?; self.restart_after_stop()?;
            if self.mihon_export()? != review.before || self.query(ReadOperation::Categories)? != review.before_categories { return Err("Mihon recovery could not be verified. Restart Tsugi before continuing."); }
            return Ok(json!({"status": "rolled-back", "reviewId": review.id, "checkpointId": checkpoint_id, "error": error}));
        }
        if checkpoint.commit().is_err() {
            self.shutdown()?; crate::read_checkpoint::recover_pending(&self.data_path)?; self.restart_after_stop()?;
            if self.mihon_export()? != review.before { return Err("Mihon recovery is pending. Restart Tsugi before continuing."); }
            return Ok(json!({"status": "rolled-back", "reviewId": review.id, "checkpointId": checkpoint_id, "error": "The import could not be committed; previous metadata was restored."}));
        }
        Ok(json!({"status": "imported", "reviewId": review.id, "checkpointId": checkpoint_id, "rows": review.merged.rows}))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> MihonImportInput {
        serde_json::from_value(json!({"includePartialPages": true, "includeTrackers": true, "categories": ["Mihon shelf"], "manga": [{"sourceId": "9007199254740993", "url": "/original/manga", "title": "Authored Mihon fixture", "categories": ["Mihon shelf"], "chapters": [
            {"url": "/original/chapter", "name": "Original chapter", "read": true, "bookmark": true, "page": 8, "chapterNumber": 1.0, "sourceOrder": 0, "lastReadAt": "1700000000"},
            {"url": "/original/partial", "name": "Partial chapter", "read": false, "bookmark": false, "page": 3, "chapterNumber": 2.0, "sourceOrder": 1, "lastReadAt": "1700000001"}],
            "trackers": [{"trackerId": 1, "remoteId": "44"}]}]})).unwrap()
    }
    #[test]
    fn reconstruction_retains_exact_identity_and_history_without_inventing_page_counts() {
        let merged = merge(&fixture(), &[], &BTreeMap::new(), &BTreeSet::new()).unwrap();
        assert_eq!(merged.rows[0]["state"], "new"); assert_eq!(merged.rows[0]["chapters"], 2);
        assert_eq!(merged.rows[0]["partialSkipped"], 1);
        let rows = messages(&parse(&gunzip(&merged.payload).unwrap()).unwrap(), 1, 1000).unwrap();
        assert_eq!(key(&rows[0]).unwrap().0, "9007199254740993");
        assert_eq!(history(&rows[0]).unwrap()["/original/chapter"], 1700000000000);
        let chapters = messages(&rows[0], 16, 10000).unwrap();
        assert_eq!(int(&chapters[0], 4).unwrap(), 1); assert_eq!(int(&chapters[0], 5).unwrap(), 1);
        assert_eq!(int(&chapters[1], 6).unwrap(), 0);
        assert_eq!(chapter_number(&chapters[0]).unwrap(), 1.0);
        assert_eq!(chapter_number(&[]).unwrap(), 0.0);
    }
    #[test]
    fn reconstruction_applies_partial_progress_only_with_a_known_positive_page_count() {
        let input = fixture(); let original = merge(&input, &[], &BTreeMap::new(), &BTreeSet::new()).unwrap().expected;
        let manga_identity = backup_identity("tsugi-manga-v1", "9007199254740993", "/original/manga");
        let chapter_identity = backup_identity("tsugi-chapter-v1", &manga_identity, "/original/partial");
        for count in [-1, 0, 3, 4] {
            let counts = BTreeMap::from([((manga_identity.clone(), chapter_identity.clone()), (7, count))]);
            let merged = merge(&input, &original, &counts, &BTreeSet::new()).unwrap();
            let chapters = messages(&merged.expected[0], 16, 10000).unwrap();
            assert_eq!(int(&chapters[1], 6).unwrap(), if count == 4 { 3 } else { 0 });
            assert_eq!(merged.rows[0]["partialSkipped"], if count == 4 { 0 } else { 1 });
        }
    }
    #[test]
    fn reconstruction_preserves_newer_state_and_unrelated_metadata() {
        let input = fixture(); let first = merge(&input, &[], &BTreeMap::new(), &BTreeSet::new()).unwrap();
        let mut original = first.expected[0].clone();
        set(&mut original, text_field(5, "Current author")); set(&mut original, number_field(101, 173));
        original.push(number_field(17, 2)); original.push(number_field(17, 8));
        assert_eq!(category_orders(&original).unwrap(), category_orders(&[bytes_field(17, vec![2, 8])]).unwrap());
        let mut chapters = messages(&original, 16, 10000).unwrap();
        set(&mut chapters[0], number_field(4, 0));
        set(&mut chapters[1], number_field(6, 6));
        set_messages(&mut original, 16, &chapters).unwrap();
        set_messages(&mut original, 104, &[vec![text_field(1, "/original/chapter"), number_field(2, 1800000000000)], vec![text_field(1, "/original/partial"), number_field(2, 1800000000000)]]).unwrap();
        let merged = merge(&input, &[original.clone()], &BTreeMap::new(), &BTreeSet::new()).unwrap();
        assert_eq!(canonical(&merged.expected[0], &[16, 104]), canonical(&original, &[16, 104]));
        let chapters = messages(&merged.expected[0], 16, 10000).unwrap();
        assert_eq!(int(&chapters[0], 4).unwrap(), 0, "older completion cannot overwrite a newer unread state");
        assert_eq!(int(&chapters[1], 6).unwrap(), 6);
        assert_eq!(history(&merged.expected[0]).unwrap(), history(&original).unwrap());
    }
    #[test]
    fn reconstruction_ignores_ambiguous_tracker_ids_and_preserves_existing_bindings() {
        let mut input = fixture(); let original = merge(&input, &[], &BTreeMap::new(), &BTreeSet::new()).unwrap().expected;
        input.manga[0].trackers[0].remote_id = "45".into();
        let changed = merge(&input, &original, &BTreeMap::new(), &BTreeSet::new()).unwrap();
        assert_eq!(changed.rows[0]["trackerConflicts"], 1);
        assert_eq!(int(&messages(&changed.expected[0], 18, 20).unwrap()[0], 100).unwrap(), 44);
        input.manga[0].trackers.push(crate::bridge::MihonImportTracker { tracker_id: 1, remote_id: "46".into() });
        let conflict = merge(&input, &[], &BTreeMap::new(), &BTreeSet::new()).unwrap();
        assert_eq!(conflict.rows[0]["trackerConflicts"], 1); assert!(messages(&conflict.expected[0], 18, 20).unwrap().is_empty());
    }
    #[test]
    fn reconstruction_refuses_duplicates_and_skips_local_media_and_unfollowed_collisions() {
        let mut input = fixture(); input.manga.push(input.manga[0].clone()); assert!(validate(&input).is_err());
        let mut input = fixture(); input.manga[0].source_id = "0".into();
        let local = merge(&input, &[], &BTreeMap::new(), &BTreeSet::new()).unwrap(); assert!(local.expected.is_empty()); assert_eq!(local.rows[0]["state"], "local-files-required");
        let input = fixture(); let cached = BTreeSet::from([("9007199254740993".into(), "/original/manga".into())]);
        let collision = merge(&input, &[], &BTreeMap::new(), &cached).unwrap(); assert!(collision.expected.is_empty()); assert_eq!(collision.rows[0]["state"], "cached-title-not-in-library");
    }
    #[test]
    fn reconstruction_rejects_private_identities_at_the_native_boundary() {
        for value in ["https://user:secret@example.com/a", "//example.com/a", "/manga?token=secret", "/manga?X-Amz-Signature=private", "/manga?unknown=private", "/manga#private", "file:///private/file", "http://example.com/a", "https://127.0.0.1/a", "https://[::1]/a", "https://localhost./a", "https://intranet.local/a", "/manga/%0a/private", "/token/private/manga", "/%74oken/private/manga", " /manga"] {
            assert!(!identifier(value), "private or unsupported identity must be rejected");
            let mut input = fixture(); input.manga[0].url = value.into(); assert!(validate(&input).is_err());
        }
        for value in ["/manga/public", "manga/public/chapter-1", "/manga?id=123&lang=en", "https://reader.example.com/manga/chapter-1"] { assert!(identifier(value)); }
    }
    #[test]
    fn reconstruction_gzip_and_wire_validation_reject_corruption_and_unbounded_values() {
        let raw = encode(&[number_field(1, i64::MIN), text_field(2, "Original ✓")]).unwrap();
        assert_eq!(gunzip(&gzip(&raw).unwrap()).unwrap(), raw);
        let mut broken = gzip(&raw).unwrap(); let end = broken.len() - 5; broken[end] ^= 1; assert!(gunzip(&broken).is_err());
        for wire in [vec![0x0b], vec![0x12, 0xff, 0x7f], vec![0x08, 0x80, 0], vec![0x08, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 2]] { assert!(parse(&wire).is_err()); }
        let mut input = fixture(); input.manga[0].chapters[0].last_read_at = i64::MAX.to_string(); assert!(validate(&input).is_err());
    }

    #[test]
    #[ignore = "requires the actual pinned Windows runtime; uses authored metadata, no remote provider"]
    fn packaged_runtime_mihon_import_reconstructs_and_recovers() {
        let runtime = std::path::PathBuf::from(std::env::var_os("TSUGI_READ_RUNTIME").unwrap());
        let data = std::path::PathBuf::from(std::env::var_os("TSUGI_READ_FIXTURE").unwrap()).join("mihon-import");
        assert!(!data.exists());
        let mut managed = ReadRuntime::start(&runtime, &data).unwrap();
        let before = managed.mihon_export().unwrap();
        let review = managed.review_mihon_import(fixture()).unwrap();
        assert_eq!(review.preview()["rows"][0]["state"], "new");
        assert_eq!(managed.mihon_export().unwrap(), before, "review must not mutate library metadata");
        let result = managed.apply_mihon_import(review).unwrap();
        assert_eq!(result["status"], "imported", "native restore result: {result}");
        let ids = managed.mihon_ids().unwrap(); let id = ids[&("9007199254740993".into(), "/original/manga".into())];
        let state = managed.backup_manga(id).unwrap();
        assert_eq!(state["categories"], json!(["Mihon shelf"]));
        assert_eq!(state["chapters"].as_array().unwrap().len(), 2);
        assert!(state["chapters"].as_array().unwrap().iter().all(|chapter| chapter["pageCount"] == 0 && chapter["lastPageRead"] == 0), "unknown counts must not invent page progress");
        let raw = managed.backup_manga_raw(id).unwrap();
        assert!(backup_nodes(&raw["chapters"], 10_000).unwrap().iter().all(|chapter| chapter["pageCount"] == -1), "the pinned runtime keeps unknown chapter counts as -1");
        assert!(managed.query(ReadOperation::History).unwrap()["nodes"].as_array().unwrap().iter().any(|row| row["lastReadAt"] == "1700000000" || row["lastReadAt"] == 1700000000));
        let records = managed.track_records(id).unwrap(); assert_eq!(records["totalCount"], 1);
        let after = managed.mihon_export().unwrap();
        let review = managed.review_mihon_import(fixture()).unwrap();
        assert_eq!(review.preview()["rows"][0]["chapters"], 0); assert_eq!(review.preview()["rows"][0]["trackers"], 0);
        assert_eq!(review.preview()["rows"][0]["partialSkipped"], 1);
        assert_eq!(review.counts.len(), 2);
        assert!(review.counts.values().all(|(_, count)| *count == -1), "native review must retain exact runtime counts");
        let result = managed.apply_mihon_import(review).unwrap(); assert_eq!(result["status"], "imported", "reimport result: {result}");
        assert_eq!(managed.mihon_export().unwrap(), after, "reimport must be idempotent");
        let stale = managed.review_mihon_import(fixture()).unwrap();
        managed.save_category(None, "New local shelf").unwrap(); assert!(managed.apply_mihon_import(stale).is_err());
        let preserved = managed.mihon_export().unwrap();
        let mut changed = fixture(); changed.manga[0].url = "/original/second".into(); changed.manga[0].title = "Second authored manga".into();
        let mut review = managed.review_mihon_import(changed).unwrap();
        // Force a real post-restore verification failure without changing the
        // reviewed upload, proving the checkpoint removes new rows on rollback.
        set(&mut review.merged.expected[0], number_field(1, 42));
        let rolled_back = managed.apply_mihon_import(review).unwrap(); assert_eq!(rolled_back["status"], "rolled-back");
        assert_eq!(managed.mihon_export().unwrap(), preserved);
        managed.shutdown().unwrap(); drop(managed);
        let mut managed = ReadRuntime::start(&runtime, &data).unwrap(); assert_eq!(managed.mihon_export().unwrap(), preserved);
        managed.shutdown().unwrap(); drop(managed); fs::remove_dir_all(data).unwrap();
        eprintln!("PASS: native Mihon reconstruction, exact LongString source, chapters, history, categories and local tracker refs persisted; duplicate reimport was idempotent; stale review refused and failed verification rolled back across restart.");
    }
}
