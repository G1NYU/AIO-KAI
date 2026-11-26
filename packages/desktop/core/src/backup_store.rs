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
fn valid_payload(kind:&str,payload:&str)->bool {
    // The WebView also validates the complete scalar schemas on capture and
    // restore. The native boundary independently checks structure, versions,
    // entry caps and field allowlists before persisting any payload.
    let Ok(value)=serde_json::from_str::<Value>(payload) else {return false;};
    let version=value["version"].as_u64();
    match kind {
        "preferences"=>version==Some(1)&&value["format"]=="tsugi-preferences"&&
            fields(&value,&["format","version","settings"],&[])&&
            fields(&value["settings"],&["theme","accent","startup","matrix","layout","audioProfile","reader"],&[])&&
            fields(&value["settings"]["reader"],&["mode","width","gap","rtl","fit","background","focus","autoNext","wheelZoom","resume"],&[])&&
            scalars(&value["settings"],&["reader"])&&scalars(&value["settings"]["reader"],&[]),
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
        !(3..=4).contains(&archive.entries.len()){
        return Err("Unsupported backup manifest.");
    }
    let mut mask=0u8;
    for entry in archive.entries{
        let (bit,max)=match entry.kind.as_str(){
            "preferences"=>(1,16*1024),"music"=>(2,4*1024*1024),"books"=>(4,2*1024*1024),"manga"=>(8,8*1024*1024),
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
    let body=name.strip_prefix("tsugi-backup-")?.strip_suffix(".json")?;
    let (time,nonce)=body.split_once('-')?;
    if time.len()!=13||!time.bytes().all(|b|b.is_ascii_digit())||nonce.len()!=32||
        !nonce.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)){
        return None;
    }
    time.parse().ok()
}
fn generated_name()->Result<String,&'static str>{
    let time=SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"Invalid system time.")?.as_millis();
    if time>9_999_999_999_999{return Err("Invalid system time.");}
    let mut nonce=[0u8;16];getrandom::fill(&mut nonce).map_err(|_|"Could not allocate backup identifier.")?;
    let suffix:String=nonce.iter().map(|b|format!("{b:02x}")).collect();
    Ok(format!("tsugi-backup-{time:013}-{suffix}.json"))
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
    rows.sort_by(|a,b|b["name"].as_str().cmp(&a["name"].as_str()));
    Ok(rows)
}
fn save(dir:&Path,text:&str)->Result<Value,&'static str>{
    validate_archive(text)?;
    if list(dir)?.len()>=MAX_FILES{return Err("Managed backup limit reached. Move old copies out of the backup folder.");}
    let name=generated_name()?;
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
pub fn execute(root:&Path,action:BackupAction)->Result<Value,&'static str>{
    let dir=directory(root)?;
    match action {
        BackupAction::List=>Ok(json!({"folder":dir.to_string_lossy(),"backups":list(&dir)?})),
        BackupAction::Save{archive}=>save(&dir,&archive),
        BackupAction::Open{name}=>Ok(json!({"archive":read_archive(&dir,&name)?})),
    }
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
        let name=generated_name().unwrap();
        let root=std::env::temp_dir().join(format!("tsugi-test-{name}"));
        fs::create_dir(&root).unwrap();root
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
