//! Windows managed metadata backups. Fixed app-owned directory and generated
//! names only; never accept an arbitrary path or copy a live runtime database.
use crate::bridge::BackupAction;
use serde::Deserialize;
use serde_json::{Value,json};
use sha2::{Digest,Sha256};
use std::fs::{self,File,OpenOptions};
use std::io::{Read,Write};
use std::os::windows::fs::MetadataExt;
use std::path::{Path,PathBuf};
use std::time::{SystemTime,UNIX_EPOCH};

const LIMIT:usize=24*1024*1024;
const MAX_FILES:usize=500;
const MAX_DIRECTORY_ENTRIES:usize=10_000;
const REPARSE_POINT:u32=0x400;

#[derive(Deserialize)]
#[serde(deny_unknown_fields,rename_all="camelCase")]
struct Archive {
    format:String, version:u32, created_at:String, entries:Vec<Entry>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    kind:String, bytes:usize, sha256:String, payload:String,
}

fn sha256(bytes:&[u8])->String {
    Sha256::digest(bytes).iter().map(|byte|format!("{byte:02x}")).collect()
}
fn fields(value:&Value,required:&[&str],optional:&[&str])->bool {
    value.as_object().is_some_and(|obj|
        required.iter().all(|key|obj.contains_key(*key)) &&
        obj.keys().all(|key|required.contains(&key.as_str())||optional.contains(&key.as_str())))
}
fn scalars(value:&Value,containers:&[&str])->bool {
    value.as_object().is_some_and(|obj|obj.iter().all(|(key,value)|containers.contains(&key.as_str())||(!value.is_object()&&!value.is_array())))
}
fn array(value:&Value,max:usize,valid:impl Fn(&Value)->bool)->bool {
    value.as_array().is_some_and(|rows|rows.len()<=max&&rows.iter().all(valid))
}
fn valid_feed_preferences(value:&Value)->bool {
    if !fields(value,&["version","sources"],&[])||value["version"].as_u64()!=Some(1){return false;}
    let Some(rows)=value["sources"].as_array().filter(|rows|rows.len()<=8) else{return false;};
    let mut seen=std::collections::BTreeSet::new();
    for row in rows {
        if !fields(row,&["sourceId","mode"],&[])||!matches!(row["mode"].as_str(),Some("popular")|Some("latest")){return false;}
        let Some(id)=row["sourceId"].as_str() else{return false;};
        let Ok(number)=id.parse::<i64>() else{return false;};
        if number==0||number.to_string()!=id||!seen.insert(id){return false;}
    }
    true
}
fn valid_payload(kind:&str,payload:&str)->bool {
    // The WebView also validates the complete scalar schemas on capture and
    // restore. The native boundary independently checks structure, versions,
    // entry caps and field allowlists before persisting any payload.
    let Ok(value)=serde_json::from_str::<Value>(payload) else {return false;};
    let version=value["version"].as_u64();
    match kind {
        "preferences"=>(version==Some(1)||version==Some(2))&&value["format"]=="tsugi-preferences"&&
            fields(&value,&["format","version","settings"],&[])&&
            fields(&value["settings"],&["theme","accent","startup","matrix","layout","audioProfile","reader"],if version==Some(2){&["feed"]}else{&[]})&&
            (version!=Some(2)||valid_feed_preferences(&value["settings"]["feed"]))&&
            fields(&value["settings"]["reader"],&["mode","width","gap","rtl","fit","background","focus","autoNext","wheelZoom","resume"],&[])&&
            scalars(&value["settings"],&["reader","feed"])&&scalars(&value["settings"]["reader"],&[]),
        "music"=>version==Some(1)&&value["format"]=="tsugi-music-library"&&
            fields(&value,&["format","version","playlists"],&[])&&
            array(&value["playlists"],100,|row|
                fields(row,&["id","name","tracks"],&["collection"])&&scalars(row,&["tracks","collection"])&&
                row.get("collection").is_none_or(|collection|fields(collection,&["sourceId","id","type"],&[])&&scalars(collection,&[]))&&
                array(&row["tracks"],1000,|track|fields(track,&["id","title","artist"],&["album","duration","isrc","sourceId"])&&scalars(track,&[]))),
        "books"=>version==Some(1)&&value["format"]=="tsugi-book-progress"&&
            fields(&value,&["format","version","books"],&[])&&
            array(&value["books"],1000,|row|
                fields(row,&["id","name","title","format","size","sha256","progress"],&[])&&scalars(row,&["progress"])&&
                (row["progress"].is_null()||(fields(&row["progress"],&["position","fraction","lastReadAt"],&[])&&scalars(&row["progress"],&[])))),
        "mal"=>version==Some(1)&&fields(&value,&["version","entries","links"],&[])&&
            array(&value["entries"],3000,|row|
                fields(row,&["malId","title","status","progress","total","score","format","volumesRead","volumesTotal"],&[])&&scalars(row,&[]))&&
            array(&value["links"],3000,|row|fields(row,&["malId","mangaId","sourceId","identity"],&[])&&scalars(row,&[])),
        "manga"=>(version==Some(1)||version==Some(2))&&value["format"]=="tsugi-manga-progress"&&
            (if version==Some(2) {fields(&value,&["format","version","manga","categories"],&[])&&array(&value["categories"],100,Value::is_string)}
             else {fields(&value,&["format","version","manga"],&[])})&&
            array(&value["manga"],1000,|row|
                fields(row,&["identity","sourceId","title","categories","chapters"],&[])&&scalars(row,&["categories","chapters"])&&
                array(&row["categories"],100,Value::is_string)&&
                array(&row["chapters"],10_000,|chapter|
                    fields(chapter,&["identity","name","isRead","isBookmarked","lastPageRead","pageCount","lastReadAt"],&[])&&scalars(chapter,&[]))),
        _=>false,
    }
}
fn valid_timestamp(value:&str)->bool {
    let bytes=value.as_bytes();
    bytes.len()==24&&bytes.iter().enumerate().all(|(i,b)|match i {
        4|7=>*b==b'-',10=>*b==b'T',13|16=>*b==b':',19=>*b==b'.',23=>*b==b'Z',_=>b.is_ascii_digit(),
    })
}
fn validate_archive(text:&str)->Result<(),&'static str>{
    if text.is_empty()||text.len()>LIMIT{return Err("Invalid backup size.");}
    let archive:Archive=serde_json::from_str(text).map_err(|_|"Invalid backup manifest.")?;
    if archive.format!="tsugi-portable"||archive.version!=1||!valid_timestamp(&archive.created_at)||
        !(3..=5).contains(&archive.entries.len()){
        return Err("Unsupported backup manifest.");
    }
    let mut mask=0u8;
    for entry in archive.entries{
        let (bit,max)=match entry.kind.as_str(){
            "preferences"=>(1,16*1024),"music"=>(2,4*1024*1024),"books"=>(4,2*1024*1024),"manga"=>(8,8*1024*1024),"mal"=>(16,3*1024*1024),
            _=>return Err("Unknown backup section."),
        };
        if mask&bit!=0||entry.bytes==0||entry.bytes>max||entry.bytes!=entry.payload.len()||
            entry.sha256!=sha256(entry.payload.as_bytes())||!valid_payload(&entry.kind,&entry.payload){
            return Err("Backup section failed integrity or schema checks.");
        }
        mask|=bit;
    }
    if mask&7!=7{return Err("Missing required backup section.");}
    Ok(())
}
fn reparse(metadata:&fs::Metadata)->bool {
    metadata.file_type().is_symlink()||metadata.file_attributes()&REPARSE_POINT!=0
}
fn directory(root:&Path)->Result<PathBuf,&'static str>{
    let root=root.canonicalize().map_err(|_|"Backup data folder is unavailable.")?;
    let dir=root.join("backups");
    match fs::create_dir(&dir) {
        Ok(())=>(),
        Err(error) if error.kind()==std::io::ErrorKind::AlreadyExists=>(),
        Err(_)=>return Err("Could not create managed backup folder."),
    }
    let meta=fs::symlink_metadata(&dir).map_err(|_|"Backup folder is unavailable.")?;
    if !meta.is_dir()||reparse(&meta){return Err("Managed backup folder cannot be a redirected directory.");}
    let actual=dir.canonicalize().map_err(|_|"Backup folder is unavailable.")?;
    if actual.parent()!=Some(root.as_path()){return Err("Managed backup folder is outside app data.");}
    Ok(actual)
}
fn name_timestamp(name:&str)->Option<u64>{
    let body=name.strip_prefix("tsugi-backup-").or_else(||name.strip_prefix("tsugi-auto-backup-"))?.strip_suffix(".json")?;
    let (time,nonce)=body.split_once('-')?;
    if time.len()!=13||!time.bytes().all(|b|b.is_ascii_digit())||nonce.len()!=32||
        !nonce.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)){
        return None;
    }
    time.parse().ok()
}
fn generated_name(scheduled:bool)->Result<String,&'static str>{
    let time=SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"Invalid system time.")?.as_millis();
    if time>9_999_999_999_999{return Err("Invalid system time.");}
    let mut nonce=[0u8;16];getrandom::fill(&mut nonce).map_err(|_|"Could not allocate backup identifier.")?;
    let suffix:String=nonce.iter().map(|b|format!("{b:02x}")).collect();
    let prefix=if scheduled {"tsugi-auto-backup"} else {"tsugi-backup"};
    Ok(format!("{prefix}-{time:013}-{suffix}.json"))
}
fn regular(path:&Path)->Result<fs::Metadata,&'static str>{
    let meta=fs::symlink_metadata(path).map_err(|_|"Managed backup is missing.")?;
    if !meta.is_file()||reparse(&meta){return Err("Managed backup is not a regular file.");}
    Ok(meta)
}
fn read_archive(dir:&Path,name:&str)->Result<String,&'static str>{
    if name_timestamp(name).is_none(){return Err("Invalid managed backup name.");}
    let path=dir.join(name);
    let meta=regular(&path)?;
    if meta.len()==0||meta.len()>LIMIT as u64{return Err("Invalid backup size.");}
    let file=File::open(&path).map_err(|_|"Could not open managed backup.")?;
    let mut bytes=Vec::with_capacity(meta.len() as usize);
    file.take(LIMIT as u64+1).read_to_end(&mut bytes).map_err(|_|"Could not read managed backup.")?;
    if bytes.len()!=meta.len() as usize||bytes.len()>LIMIT{return Err("Managed backup changed while reading.");}
    let text=String::from_utf8(bytes).map_err(|_|"Invalid backup encoding.")?;
    validate_archive(&text)?;
    Ok(text)
}
fn list(dir:&Path)->Result<Vec<Value>,&'static str>{
    let mut rows=Vec::new();
    for (index,entry) in fs::read_dir(dir).map_err(|_|"Could not list managed backups.")?.enumerate(){
        if index>=MAX_DIRECTORY_ENTRIES{return Err("Managed backup folder exceeds its listing limit.");}
        let entry=entry.map_err(|_|"Could not list managed backups.")?;
        let Ok(name)=entry.file_name().into_string() else {continue;};
        let Some(time)=name_timestamp(&name) else {continue;};
        let meta=regular(&entry.path())?;
        if rows.len()>=MAX_FILES{return Err("Managed backup folder exceeds its backup limit.");}
        rows.push(json!({"name":name,"createdMs":time,"bytes":meta.len(),"readable":meta.len()>0&&meta.len()<=LIMIT as u64}));
    }
    rows.sort_by(|a,b|b["createdMs"].as_u64().cmp(&a["createdMs"].as_u64()).then_with(||b["name"].as_str().cmp(&a["name"].as_str())));
    Ok(rows)
}
fn save(dir:&Path,text:&str,scheduled:bool)->Result<Value,&'static str>{
    validate_archive(text)?;
    if list(dir)?.len()>=MAX_FILES{return Err("Managed backup limit reached. Move old copies out of the backup folder.");}
    let name=generated_name(scheduled)?;
    let final_path=dir.join(&name);
    let temporary=dir.join(format!("{name}.tmp"));
    let mut file=OpenOptions::new().write(true).create_new(true).open(&temporary)
        .map_err(|_|"Could not stage managed backup.")?;
    let written=file.write_all(text.as_bytes()).and_then(|_|file.sync_all());
    drop(file);
    if written.is_err(){
        let _=fs::remove_file(&temporary);
        return Err("Could not write or flush managed backup.");
    }
    if final_path.exists()||fs::rename(&temporary,&final_path).is_err(){
        let _=fs::remove_file(&temporary);
        return Err("Could not publish managed backup.");
    }
    let confirmed=read_archive(dir,&name)?;
    if confirmed!=text{return Err("Managed backup could not be verified after writing.");}
    Ok(json!({"name":name,"createdMs":name_timestamp(&name),"bytes":text.len(),"readable":true}))
}
fn save_scheduled(dir:&Path,text:&str,keep:usize)->Result<Value,&'static str>{
    if !matches!(keep,0|3|7|14|30){return Err("Invalid scheduled backup retention.");}
    // Publish and verify the new copy before considering retention. Manual,
    // unrelated, damaged and redirected files are never removed by this policy.
    let backup=save(dir,text,true)?;
    let mut removed=0usize;
    let mut incomplete=false;
    if keep>0{
        let current=backup["name"].as_str().ok_or("Invalid saved backup.")?;
        match list(dir){
            Ok(rows)=>{
                let mut retained=1usize;
                for row in rows{
                    let Some(name)=row["name"].as_str() else {incomplete=true;continue;};
                    if !name.starts_with("tsugi-auto-backup-")||name==current{continue;}
                    if read_archive(dir,name).is_err(){incomplete=true;continue;}
                    if retained<keep{retained+=1;continue;}
                    if fs::remove_file(dir.join(name)).is_ok(){removed+=1;}else{incomplete=true;}
                }
            },
            Err(_)=>incomplete=true,
        }
    }
    Ok(json!({"backup":backup,"removed":removed,"retentionIncomplete":incomplete}))
}
pub fn execute(root:&Path,action:BackupAction)->Result<Value,&'static str>{
    if let BackupAction::Storage { detailed } = &action { return storage_usage(root, *detailed); }
    let dir=directory(root)?;
    match action {
        BackupAction::Storage { .. }=>unreachable!("storage handled before backup directory creation"),
        BackupAction::List=>Ok(json!({"folder":dir.to_string_lossy(),"backups":list(&dir)?})),
        BackupAction::Save{archive}=>save(&dir,&archive,false),
        BackupAction::SaveScheduled{archive,keep}=>save_scheduled(&dir,&archive,keep),
        BackupAction::Open{name}=>Ok(json!({"archive":read_archive(&dir,&name)?})),
    }
}

// Logical file lengths only. Bounded metadata traversal, no file reads,
// no following symlinks/junctions, no cleanup or external folder discovery.
const STORAGE_LIMIT:usize=50_000;
const STORAGE_DEPTH:usize=32;
const STORAGE_KEYS:[&str;6]=["backups","reader","webview","logs","downloads","other"];
#[derive(Default)]
struct Usage { bytes:u64, files:u64, skipped:u64, incomplete:bool }
// Only these default, root-relative directory trees have a known narrower purpose.
// Everything else stays in its original group. No user-configured paths are read.
const DETAIL_PATHS: [(&str, &str, usize); 3] = [
    ("reading/downloads/mangas", "readerChapters", 1),
    ("reading/cache", "readerCache", 1),
    ("WebView2/EBWebView/Default/Cache", "webCache", 2),
];

fn detail_group(relative: &Path, parent: usize) -> usize {
    DETAIL_PATHS.iter().position(|(known, _, _)| {
        let mut actual = relative.components();
        Path::new(known).components().all(|component| {
            actual.next().is_some_and(|part| part.as_os_str().eq_ignore_ascii_case(component.as_os_str()))
        }) && actual.next().is_none()
    }).map_or(parent, |index| STORAGE_KEYS.len() + index)
}

fn scan_usage(root: &Path, relative: &Path, depth: usize, budget: &mut usize,
              groups: &mut [Usage], kind: usize, detailed: bool) {
    if *budget == 0 || depth > STORAGE_DEPTH {
        groups[kind].incomplete = true;
        return;
    }
    *budget -= 1;
    let path = root.join(relative);
    let Ok(meta) = fs::symlink_metadata(&path) else {
        groups[kind].skipped += 1;
        groups[kind].incomplete = true;
        return;
    };
    if reparse(&meta) {
        groups[kind].skipped += 1;
        groups[kind].incomplete = true;
    } else if meta.is_file() {
        let usage = &mut groups[kind];
        usage.bytes = usage.bytes.saturating_add(meta.len()).min(9_007_199_254_740_991);
        usage.files += 1;
    } else if meta.is_dir() {
        let group = if detailed && (kind == 1 || kind == 2) && depth <= 3 {
            detail_group(relative, kind)
        } else { kind };
        let Ok(entries) = fs::read_dir(path) else {
            groups[group].skipped += 1;
            groups[group].incomplete = true;
            return;
        };
        for entry in entries {
            if *budget == 0 { groups[group].incomplete = true; break; }
            match entry {
                Ok(child) => scan_usage(root, &relative.join(child.file_name()), depth + 1, budget, groups, group, detailed),
                Err(_) => { *budget -= 1; groups[group].skipped += 1; groups[group].incomplete = true; }
            }
        }
    } else {
        groups[kind].skipped += 1;
        groups[kind].incomplete = true;
    }
}

fn storage_usage(root: &Path, detailed: bool) -> Result<Value, &'static str> {
    let meta = fs::symlink_metadata(root).map_err(|_| "App data folder unavailable.")?;
    if !meta.is_dir() || reparse(&meta) { return Err("App data folder unavailable."); }
    let entries = fs::read_dir(root).map_err(|_| "Could not inspect app data.")?;
    let mut groups: [Usage; STORAGE_KEYS.len() + DETAIL_PATHS.len()] = std::array::from_fn(|_| Usage::default());
    let mut budgets = [STORAGE_LIMIT; 6];
    let mut root_incomplete = false;
    for (index, entry) in entries.enumerate() {
        if index >= MAX_DIRECTORY_ENTRIES { root_incomplete = true; break; }
        let Ok(entry) = entry else { root_incomplete = true; continue; };
        let name = entry.file_name();
        let kind = match name.to_string_lossy().to_ascii_lowercase().as_str() {
            "backups" => 0, "reading" => 1, "webview2" => 2, "logs" => 3, "downloads" => 4, _ => 5,
        };
        scan_usage(root, Path::new(&name), 0, &mut budgets[kind], &mut groups, kind, detailed);
    }
    let keys = STORAGE_KEYS.iter().copied().chain(DETAIL_PATHS.iter().map(|(_, key, _)| *key));
    let count = if detailed { groups.len() } else { STORAGE_KEYS.len() };
    let rows: Vec<_> = keys.take(count).enumerate().map(|(index, key)| {
        let row = &groups[index];
        // An unreadable ancestor could contain an unseen detail subtree.
        let parent_partial = index.checked_sub(STORAGE_KEYS.len())
            .is_some_and(|i| groups[DETAIL_PATHS[i].2].incomplete);
        json!({"kind":key,"bytes":row.bytes,"files":row.files,"skipped":row.skipped,
               "complete":!root_incomplete && !row.incomplete && !parent_partial})
    }).collect();
    Ok(json!({"rows":rows}))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture()->String {
        let sections=[
            ("preferences",json!({"format":"tsugi-preferences","version":1,"settings":{
                "theme":"mocha","accent":"blue","startup":"auto","matrix":"wave","layout":"default","audioProfile":"flat",
                "reader":{"mode":"scroll","width":55,"gap":false,"rtl":false,"fit":"width","background":"black","focus":false,"autoNext":false,"wheelZoom":true,"resume":true}
            }})),
            ("music",json!({"format":"tsugi-music-library","version":1,"playlists":[]})),
            ("books",json!({"format":"tsugi-book-progress","version":1,"books":[]})),
            ("manga",json!({"format":"tsugi-manga-progress","version":2,"manga":[],"categories":["日本語"]})),
        ];
        let entries:Vec<_>=sections.into_iter().map(|(kind,value)|{
            let payload=value.to_string();
            json!({"kind":kind,"bytes":payload.len(),"sha256":sha256(payload.as_bytes()),"payload":payload})
        }).collect();
        json!({"format":"tsugi-portable","version":1,"createdAt":"2026-01-01T00:00:00.000Z","entries":entries}).to_string()
    }
    fn temp()->PathBuf{
        let name=generated_name(false).unwrap();
        let root=std::env::temp_dir().join(format!("tsugi-test-{name}"));
        fs::create_dir(&root).unwrap();root
    }
    #[test]
    fn portable_mal_collection_checks_structure_before_storage(){
        let payload=json!({"version":1,"entries":[],"links":[]}).to_string();
        let mut archive:Value=serde_json::from_str(&fixture()).unwrap();
        archive["entries"].as_array_mut().unwrap().push(json!({
            "kind":"mal","bytes":payload.len(),"sha256":sha256(payload.as_bytes()),"payload":payload
        }));
        assert!(validate_archive(&archive.to_string()).is_ok());
        assert!(!valid_payload("mal",r#"{"version":1,"entries":[],"links":[{"token":"fixture"}]}"#));
    }
    #[test]
    fn managed_roundtrip_and_fixed_names(){
        let root=temp();
        let text=fixture();
        let row=execute(&root,BackupAction::Save{archive:text.clone()}).unwrap();
        let name=row["name"].as_str().unwrap();
        assert_eq!(row["bytes"].as_u64(),Some(text.len() as u64));
        let result=execute(&root,BackupAction::Open{name:name.into()}).unwrap();
        assert_eq!(result["archive"],text);
        let dir=directory(&root).unwrap();
        fs::write(dir.join("unrelated.json"),"not a backup").unwrap();
        fs::write(dir.join(format!("{name}.tmp")),"interrupted").unwrap();
        let result=execute(&root,BackupAction::List).unwrap();
        assert_eq!(result["backups"].as_array().unwrap().len(),1);
        assert!(execute(&root,BackupAction::Open{name:"../unrelated.json".into()}).is_err());
        assert!(execute(&root,BackupAction::Open{name:"unrelated.json".into()}).is_err());
        fs::write(dir.join(name),"damaged").unwrap();
        assert!(execute(&root,BackupAction::Open{name:name.into()}).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn managed_feed_preferences_roundtrip_preserves_legacy_manual_and_scheduled_archives(){
        let root=temp();
        let legacy=fixture();
        let current=super::feed_schema_tests::fixture();
        let old=execute(&root,BackupAction::Save{archive:legacy.clone()}).unwrap();
        let new=execute(&root,BackupAction::Save{archive:current.clone()}).unwrap();
        let automatic=execute(&root,BackupAction::SaveScheduled{archive:current.clone(),keep:0}).unwrap();
        for (row,expected) in [(&old,&legacy),(&new,&current),(&automatic["backup"],&current)] {
            let reopened=execute(&root,BackupAction::Open{name:row["name"].as_str().unwrap().into()}).unwrap();
            assert_eq!(reopened["archive"].as_str(),Some(expected.as_str()));
        }
        assert_eq!(execute(&root,BackupAction::List).unwrap()["backups"].as_array().unwrap().len(),3);
        assert!(automatic["backup"]["name"].as_str().unwrap().starts_with("tsugi-auto-backup-"));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn storage_scan_is_read_only_and_reports_separate_groups(){
        let root=temp();
        fs::create_dir(root.join("reading")).unwrap();
        fs::write(root.join("reading").join("fixture"),b"1234").unwrap();
        fs::create_dir(root.join("WebView2")).unwrap();
        fs::write(root.join("WebView2").join("fixture"),b"abc").unwrap();
        fs::write(root.join("settings.json"),b"ab").unwrap();
        let report=execute(&root,BackupAction::Storage { detailed: false }).unwrap();
        let rows=report["rows"].as_array().unwrap();
        assert_eq!(rows.len(),6);
        assert_eq!(rows[1]["bytes"],4);
        assert_eq!(rows[2]["bytes"],3);
        assert_eq!(rows[5]["bytes"],2);
        assert!(rows.iter().all(|row|row["complete"]==true));
        assert!(!root.join("backups").exists());
        assert_eq!(fs::read(root.join("reading").join("fixture")).unwrap(),b"1234");
        for (folder, _, _) in DETAIL_PATHS {
            let dir = root.join(folder).join("日本語");
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join("fixture"), b"12345").unwrap();
        }
        let detailed = storage_usage(&root, true).unwrap();
        let rows = detailed["rows"].as_array().unwrap();
        assert_eq!(rows.len(), 9);
        for row in &rows[6..] { assert_eq!(row["bytes"], 5); }
        assert_eq!(rows[1]["bytes"], 4);
        assert_eq!(rows[2]["bytes"], 3);
        let legacy = storage_usage(&root, false).unwrap();
        assert_eq!(legacy["rows"][1]["bytes"], 14);
        assert_eq!(legacy["rows"][2]["bytes"], 8);
        let mut groups: [Usage; 9] = std::array::from_fn(|_| Usage::default());
        scan_usage(&root, Path::new("reading"), 0, &mut 0, &mut groups, 1, true);
        assert!(groups[1].incomplete);
        assert_eq!(groups[1].files, 0);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn storage_skips_junctions_and_marks_hidden_subtrees_partial() {
        let root = temp();
        fs::create_dir_all(root.join("reading")).unwrap();
        fs::create_dir(root.join("target")).unwrap();
        fs::write(root.join("target/private"), b"once").unwrap();
        let status = std::process::Command::new("cmd.exe")
            .current_dir(&root)
            .args(["/d", "/c", "mklink", "/J", "reading\\downloads", "target"])
            .status().unwrap();
        assert!(status.success());
        let report = storage_usage(&root, true).unwrap();
        assert_eq!(report["rows"][1]["skipped"], 1);
        assert_eq!(report["rows"][5]["bytes"], 4);
        assert_eq!(report["rows"][6]["bytes"], 0);
        assert_eq!(report["rows"][6]["complete"], false);
        assert!(storage_usage(&root.join("reading/downloads"), true).is_err());
        fs::remove_dir(root.join("reading/downloads")).unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn scheduled_retention_preserves_manual_damaged_and_new_copy(){
        let root=temp();
        let text=fixture();
        let manual=execute(&root,BackupAction::Save{archive:text.clone()}).unwrap();
        let dir=directory(&root).unwrap();
        for i in 0..4 {
            fs::write(dir.join(format!("tsugi-auto-backup-170000000000{i}-{}.json","a".repeat(32))),&text).unwrap();
        }
        let damaged="tsugi-auto-backup-1600000000000-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.json";
        fs::write(dir.join(damaged),"damaged").unwrap();
        fs::write(dir.join("notes.txt"),"unrelated").unwrap();
        assert!(execute(&root,BackupAction::SaveScheduled{archive:text.clone(),keep:1}).is_err());
        let saved=execute(&root,BackupAction::SaveScheduled{archive:text.clone(),keep:3}).unwrap();
        assert_eq!(saved["removed"],2);
        assert_eq!(saved["retentionIncomplete"],true);
        assert!(dir.join(manual["name"].as_str().unwrap()).is_file());
        assert!(dir.join(damaged).is_file());
        assert!(dir.join("notes.txt").is_file());
        assert_eq!(read_archive(&dir,saved["backup"]["name"].as_str().unwrap()).unwrap(),text);
        assert_eq!(list(&dir).unwrap().len(),5);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn rejects_corruption_even_when_nested_payload_rehashed(){
        let text=fixture();
        assert!(validate_archive(&text).is_ok());
        let mut archive:Value=serde_json::from_str(&text).unwrap();
        archive["entries"][0]["sha256"]=json!("0".repeat(64));
        assert!(validate_archive(&archive.to_string()).is_err());
        let mut archive:Value=serde_json::from_str(&text).unwrap();
        let mut payload:Value=serde_json::from_str(archive["entries"][0]["payload"].as_str().unwrap()).unwrap();
        payload["settings"]["token"]=json!("fixture-secret");
        let text=payload.to_string();
        archive["entries"][0]["bytes"]=json!(text.len());
        archive["entries"][0]["sha256"]=json!(sha256(text.as_bytes()));
        archive["entries"][0]["payload"]=json!(text);
        assert!(validate_archive(&archive.to_string()).is_err());
    }
}

#[cfg(test)]
mod feed_schema_tests {
    use super::*;
    fn preferences()->Value {
        json!({"format":"tsugi-preferences","version":2,"settings":{
            "theme":"mocha","accent":"blue","startup":"auto","matrix":"wave","layout":"default","audioProfile":"flat",
            "reader":{"mode":"scroll","width":55,"gap":false,"rtl":false,"fit":"width","background":"black","focus":false,"autoNext":false,"wheelZoom":true,"resume":true},
            "feed":{"version":1,"sources":[{"sourceId":"9007199254740993","mode":"latest"},{"sourceId":"-9223372036854775808","mode":"popular"}]}
        }})
    }
    fn archive(preferences:Value)->String {
        let sections=[("preferences",preferences),
            ("music",json!({"format":"tsugi-music-library","version":1,"playlists":[]})),
            ("books",json!({"format":"tsugi-book-progress","version":1,"books":[]}))];
        let entries:Vec<_>=sections.into_iter().map(|(kind,value)|{
            let payload=value.to_string();
            json!({"kind":kind,"bytes":payload.len(),"sha256":sha256(payload.as_bytes()),"payload":payload})
        }).collect();
        json!({"format":"tsugi-portable","version":1,"createdAt":"2026-01-01T00:00:00.000Z","entries":entries}).to_string()
    }
    pub(super) fn fixture()->String {archive(preferences())}

    #[test]
    fn accepts_exact_legacy_and_feed_preferences_with_one_portable_manifest_version(){
        assert!(validate_archive(&fixture()).is_ok());
        let mut legacy=preferences();legacy["version"]=json!(1);legacy["settings"].as_object_mut().unwrap().remove("feed");
        assert!(validate_archive(&archive(legacy.clone())).is_ok());
        legacy["settings"]["feed"]=json!({"version":1,"sources":[]});
        assert!(validate_archive(&archive(legacy)).is_err());
        let mut absent=preferences();absent["settings"].as_object_mut().unwrap().remove("feed");
        assert!(validate_archive(&archive(absent)).is_err());
        let mut future=preferences();future["version"]=json!(3);
        assert!(validate_archive(&archive(future)).is_err());
    }
    #[test]
    fn feed_source_ids_are_exact_unique_signed_64_bit_nonzero_strings(){
        for id in ["1","-1","9007199254740993","-9007199254740993","9223372036854775807","-9223372036854775808"] {
            let mut value=preferences();value["settings"]["feed"]["sources"]=json!([{"sourceId":id,"mode":"popular"}]);
            assert!(validate_archive(&archive(value)).is_ok(),"supported source identity");
        }
        for id in ["0","-0","+1","01","-01"," 1","1 ","1.0","1e3","１２","9223372036854775808","-9223372036854775809","https://private.example"] {
            let mut value=preferences();value["settings"]["feed"]["sources"]=json!([{"sourceId":id,"mode":"latest"}]);
            assert!(validate_archive(&archive(value)).is_err(),"reject noncanonical identity");
        }
        let mut duplicate=preferences();duplicate["settings"]["feed"]["sources"]=json!([{"sourceId":"1","mode":"popular"},{"sourceId":"1","mode":"latest"}]);
        assert!(validate_archive(&archive(duplicate)).is_err());
    }
    #[test]
    fn feed_payload_rejects_extra_fields_invalid_modes_counts_and_numeric_ids_even_with_valid_hashes(){
        let mut empty=preferences();empty["settings"]["feed"]["sources"]=json!([]);
        assert!(validate_archive(&archive(empty)).is_ok());
        let mut eight=preferences();eight["settings"]["feed"]["sources"]=json!((1..=8).map(|id|json!({"sourceId":id.to_string(),"mode":"popular"})).collect::<Vec<_>>());
        assert!(validate_archive(&archive(eight.clone())).is_ok());
        eight["settings"]["feed"]["sources"].as_array_mut().unwrap().push(json!({"sourceId":"9","mode":"latest"}));
        assert!(validate_archive(&archive(eight)).is_err());
        for feed in [Value::Null,json!({"version":2,"sources":[]}),json!({"version":1,"sources":[],"token":"fixture-private"}),
            json!({"version":1,"sources":[{"sourceId":1,"mode":"popular"}]}),json!({"version":1,"sources":[{"sourceId":"1","mode":"search"}]}),
            json!({"version":1,"sources":[{"sourceId":"1","mode":"popular","url":"https://private.example"}]})] {
            let mut value=preferences();value["settings"]["feed"]=feed;
            assert!(validate_archive(&archive(value)).is_err());
        }
    }
}
