//! Managed Windows Aria2 Next transfer backend. The bundled independent
//! executable is verified against the pinned release before use.
//! Native Vault admission and the bounded range gateway remain authoritative.
use crate::vault_gateway::{Gateway,Source};
use serde::{Deserialize,Serialize};
use serde_json::{Value,json};
use sha2::{Digest,Sha256};
use std::{
    fs, io::Read, net::TcpListener, path::{Path,PathBuf},
    process::{Child,Command,Stdio},
    sync::{Arc,atomic::{AtomicBool,Ordering}},
    thread, time::{Duration,Instant},
};
use std::os::windows::process::CommandExt;

const PIN:&str="94edc284cd84dec26a16ae9431378c5ab9e5cde8011482566483f4f0cb20c03f";
const MAX_BINARY:u64=128*1024*1024;
const MAX_REPLY:u64=64*1024;
const MAX_FILE:u64=256*1024*1024;
const STAGE:&str=".tsugi-aria2";
type Result<T>=std::result::Result<T,&'static str>;

#[derive(Debug,PartialEq,Eq)]
pub enum Outcome{Complete,Fallback,Stopped}

fn hex(bytes:&[u8])->String{bytes.iter().map(|b|format!("{b:02x}")).collect::<Vec<_>>().join("")}
fn random<const N:usize>()->Result<String>{
    let mut bytes=[0u8;N];getrandom::fill(&mut bytes).map_err(|_|"Engine randomness unavailable")?;Ok(hex(&bytes))
}
fn valid_hex(value:&str,len:usize)->bool{value.len()==len&&value.bytes().all(|b|b.is_ascii_hexdigit())}
fn regular(path:&Path,limit:u64)->bool{fs::symlink_metadata(path).is_ok_and(|m|m.file_type().is_file()&&m.len()<=limit)}
fn directory(path:&Path)->bool{fs::symlink_metadata(path).is_ok_and(|m|m.file_type().is_dir())}
fn verify_binary(path:&Path)->bool{
    if !regular(path,MAX_BINARY){return false;}
    let Ok(file)=fs::File::open(path) else{return false;};
    let mut reader=file.take(MAX_BINARY+1);
    let mut digest=Sha256::new();
    let mut buffer=[0u8;64*1024];
    let mut count=0u64;
    loop{let Ok(n)=reader.read(&mut buffer)else{return false;};if n==0{break;}count+=n as u64;if count>MAX_BINARY{return false;}digest.update(&buffer[..n]);}
    hex(&digest.finalize())==PIN
}
pub fn installed_binary()->Option<PathBuf>{
    let exe=std::env::current_exe().ok()?;
    let path=exe.parent()?.join("vault-tools").join("aria2-next.exe");
    verify_binary(&path).then_some(path)
}

#[derive(Serialize,Deserialize)]
struct Manifest{version:u32,url:String,etag:String,mime:String,total:u64,port:u16,token:String,gid:String}
impl Manifest{
    fn valid(&self)->bool{self.version==1&&self.port>0&&self.total>0&&self.total<=MAX_FILE
        &&valid_hex(&self.token,64)&&valid_hex(&self.gid,16)&&!self.gid.bytes().all(|b|b==b'0')}
    fn matches(&self,url:&str,source:&Source)->bool{
        self.valid()&&self.url==url&&self.etag==source.etag&&self.mime==source.mime&&self.total==source.total
    }
}
fn stage_path(path:&Path)->Option<PathBuf>{Some(path.parent()?.join(STAGE))}
fn manifest(root:&Path)->Option<Manifest>{
    let path=root.join("manifest.json");
    if !directory(root)||!regular(&path,16*1024){return None;}
    let m:Manifest=serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    m.valid().then_some(m)
}
/// Never remove an unrecognized or symlinked directory from a user's folder.
pub fn cleanup(path:&Path){
    if let Some(root)=stage_path(path){if manifest(&root).is_some(){let _=fs::remove_dir_all(root);}}
}
fn normal_windows_path(path:&Path)->Result<PathBuf>{
    let path=path.canonicalize().map_err(|_|"Engine path unavailable")?;
    let value=path.to_str().ok_or("Engine path unavailable")?;
    if value.starts_with(r"\\?\UNC\"){return Err("Engine does not support network staging");}
    Ok(PathBuf::from(value.trim_start_matches(r"\\?\")))
}
fn free_port()->Result<u16>{
    TcpListener::bind(("127.0.0.1",0)).and_then(|s|s.local_addr()).map(|a|a.port()).map_err(|_|"RPC port unavailable")
}
struct Engine{child:Child,agent:ureq::Agent,endpoint:String,secret:String}
impl Engine{
    fn start(binary:&Path,root:&Path,rate_mib:u32,segmented:bool)->Result<Self>{
        let port=free_port()?;
        let secret=random::<32>()?;
        let output=root.join("output");
        let state=root.join("state");
        let input=root.join("input.txt");
        let session=root.join("session.txt");
        if !directory(&output)||!directory(&state)||!regular(&input,8192){return Err("Invalid engine stage");}
        let mut command=Command::new(binary);
        command.creation_flags(0x08000000).current_dir(root)
            .args(["--no-conf=true","--enable-rpc=true","--rpc-listen-all=false",
                "--enable-dht=false","--enable-peer-exchange=false","--bt-enable-lpd=false",
                "--bt-port-mapping=false","--ed2k-port-mapping=false","--disable-ipv6=true",
                "--file-allocation=none","--summary-interval=0","--show-console-readout=false",
                "--max-concurrent-downloads=1","--follow-torrent=false","--follow-metalink=false",
                "--no-netrc=true","--auto-file-renaming=false","--allow-overwrite=false",
                "--http-accept-gzip=false","--min-split-size=1M",
                "--state-save-interval=1","--save-session-interval=1","--max-tries=3"])
            .arg(if segmented{"--split=2"}else{"--split=1"})
            .arg(if segmented{"--stream-max-connections=2"}else{"--stream-max-connections=1"})
            .arg(format!("--rpc-listen-port={port}"))
            .arg(format!("--rpc-secret={secret}"))
            .arg(format!("--dir={}",output.display()))
            .arg(format!("--state-dir={}",state.display()))
            .arg(format!("--input-file={}",input.display()))
            .arg(format!("--save-session={}",session.display()))
            .arg(format!("--max-overall-download-limit={}",u64::from(rate_mib)*1024*1024))
            .arg(format!("--stop-with-process={}",std::process::id()))
            .arg(format!("--listen-port={}",free_port()?))
            .arg(format!("--ed2k-listen-port={}",free_port()?))
            .arg(format!("--ed2k-udp-listen-port={}",free_port()?))
            .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        for (key,_) in std::env::vars_os(){if key.to_string_lossy().to_ascii_lowercase().ends_with("_proxy"){command.env_remove(key);}}
        let child=command.spawn().map_err(|_|"Engine launch failed")?;
        let agent:ureq::Agent=ureq::Agent::config_builder().proxy(None).max_redirects(0)
            .timeout_global(Some(Duration::from_secs(3))).build().into();
        let mut engine=Self{child,agent,endpoint:format!("http://127.0.0.1:{port}/jsonrpc"),secret};
        let deadline=Instant::now()+Duration::from_secs(20);
        loop{
            if engine.child.try_wait().map_err(|_|"Engine unavailable")?.is_some(){return Err("Engine exited");}
            if let Ok(version)=engine.rpc("getVersion",vec![]){
                if version["version"].as_str().is_some_and(|v|v.contains("3.1.2")){return Ok(engine);}
                return Err("Unexpected engine version");
            }
            if Instant::now()>=deadline{return Err("Engine readiness timed out");}
            thread::sleep(Duration::from_millis(100));
        }
    }
    fn rpc(&self,method:&str,mut params:Vec<Value>)->Result<Value>{
        params.insert(0,json!(format!("token:{}",self.secret)));
        let request=json!({"jsonrpc":"2.0","id":"tsugi-vault","method":format!("aria2.{method}"),"params":params});
        let response=self.agent.post(&self.endpoint).header("Content-Type","application/json")
            .send(request.to_string()).map_err(|_|"Engine RPC failed")?;
        let mut bytes=Vec::new();response.into_body().into_reader().take(MAX_REPLY+1).read_to_end(&mut bytes).map_err(|_|"Engine reply unreadable")?;
        if bytes.len() as u64>MAX_REPLY{return Err("Engine reply too large");}
        let value:Value=serde_json::from_slice(&bytes).map_err(|_|"Engine reply invalid")?;
        if value["id"]!="tsugi-vault"||value.get("error").is_some(){return Err("Engine RPC rejected");}
        value.get("result").cloned().ok_or("Engine result missing")
    }
    fn status(&self,gid:&str,total:u64)->Result<(String,u64)>{
        let value=self.rpc("tellStatus",vec![json!(gid),json!(["status","completedLength","totalLength"])])?;
        let status=value["status"].as_str().ok_or("Engine status missing")?;
        let completed=value["completedLength"].as_str().and_then(|n|n.parse::<u64>().ok()).ok_or("Engine length missing")?;
        let reported=value["totalLength"].as_str().and_then(|n|n.parse::<u64>().ok()).ok_or("Engine total missing")?;
        if completed>total||(reported!=0&&reported!=total){return Err("Engine length mismatch");}
        Ok((status.to_owned(),completed))
    }
}
impl Drop for Engine{
    fn drop(&mut self){
        let _=self.rpc("shutdown",vec![]);
        let deadline=Instant::now()+Duration::from_secs(4);
        while Instant::now()<deadline{if self.child.try_wait().ok().flatten().is_some(){return;}thread::sleep(Duration::from_millis(50));}
        let _=self.child.kill();let _=self.child.wait();
    }
}

/// Safe sidecar entry point. Production calls it only after native job
/// admission; the fixture flag is not exposed through the webview bridge.
/// Any incompatibility returns Fallback, never a successful fake transfer.
pub fn transfer(binary:&Path,url:&str,path:&Path,stop:Arc<AtomicBool>,rate_mib:u32,
    allowed_mime:impl Fn(&str)->bool,report:impl Fn(u64,Option<u64>),fixture:bool)->Outcome{
    if stop.load(Ordering::Relaxed){return Outcome::Stopped;}
    if !verify_binary(binary)||path.exists(){return Outcome::Fallback;}
    let result=Source::probe(url,fixture).and_then(|source|{
        if !allowed_mime(&source.mime){return Err("Source MIME not allowed");}
        transfer_inner(binary,url,source,path,&stop,rate_mib,report)
    });
    match result{
        Ok(Outcome::Complete)=>{cleanup(path);Outcome::Complete},
        Ok(Outcome::Stopped)=>Outcome::Stopped,
        _ if stop.load(Ordering::Relaxed)=>Outcome::Stopped,
        _=>{cleanup(path);Outcome::Fallback},
    }
}
/// A freshly resolved audio URL stays in memory. Only the public watch URL,
/// hash of the exact media URL, strong validator and length may be written to a restart manifest.
pub fn transfer_media(binary:&Path,watch:&str,media_url:&str,headers:Vec<(String,String)>,path:&Path,
    stop:Arc<AtomicBool>,rate_mib:u32,report:impl Fn(u64,Option<u64>),fixture:bool)->Outcome{
    if stop.load(Ordering::Relaxed){return Outcome::Stopped;}
    if !crate::music_resolver::is_target(watch)||!verify_binary(binary)||path.exists(){return Outcome::Fallback;}
    let Ok(source)=Source::probe_media(media_url,headers,fixture)else{cleanup(path);return Outcome::Fallback;};
    let resumable=source.segmented();
    if !resumable{cleanup(path);}
    // ETags are scoped to a representation, not globally unique. A rotated
    // signed URL must restart instead of stitching unrelated responses.
    let key=format!("{watch}#source={}",hex(&Sha256::digest(media_url.as_bytes())));
    let result=transfer_inner(binary,&key,source,path,&stop,rate_mib,report);
    match result{
        Ok(Outcome::Complete)=>{cleanup(path);Outcome::Complete},
        Ok(Outcome::Stopped)=>{if !resumable{cleanup(path);}Outcome::Stopped},
        _ if stop.load(Ordering::Relaxed)=>{if !resumable{cleanup(path);}Outcome::Stopped},
        _=>{cleanup(path);Outcome::Fallback}
    }
}
fn transfer_inner(binary:&Path,url:&str,source:Source,path:&Path,stop:&Arc<AtomicBool>,rate_mib:u32,
    report:impl Fn(u64,Option<u64)>)->Result<Outcome>{
    if stop.load(Ordering::Relaxed){return Ok(Outcome::Stopped);}
    let parent=path.parent().ok_or("Vault destination missing")?;
    fs::create_dir_all(parent).map_err(|_|"Vault destination unavailable")?;
    let root=stage_path(path).ok_or("Engine stage missing")?;
    let mut previous=manifest(&root);
    if root.exists()&&previous.is_none(){return Err("Unrecognized engine stage");}
    if previous.as_ref().is_some_and(|m|!m.matches(url,&source)){
        cleanup(path);previous=None;
    }
    let total=source.total;
    let segmented=source.segmented();
    let (token,gid,port)=match previous.as_ref(){
        Some(m)=>(m.token.clone(),m.gid.clone(),m.port),
        None=>(random::<32>()?,random::<8>()?,0),
    };
    let gateway=Gateway::start(source.clone(),port,&token,stop.clone())?;
    if previous.is_none(){
        fs::create_dir(&root).map_err(|_|"Engine stage unavailable")?;
        let m=Manifest{version:1,url:url.to_owned(),etag:source.etag,mime:source.mime,total,port:gateway.port(),token,gid:gid.clone()};
        let bytes=serde_json::to_vec(&m).map_err(|_|"Engine manifest invalid")?;
        fs::write(root.join("manifest.json"),bytes).map_err(|_|"Engine manifest unavailable")?;
        fs::create_dir(root.join("output")).map_err(|_|"Engine output unavailable")?;
        fs::create_dir(root.join("state")).map_err(|_|"Engine state unavailable")?;
    }
    // Reconstruct the input from trusted fields. Never execute a saved session
    // file with arbitrary task options or upstream URLs.
    let input=root.join("input.txt");
    if input.exists()&&!regular(&input,8192){return Err("Invalid engine input");}
    fs::write(&input,format!("{}\n gid={}\n out=payload.bin\n",gateway.url(),gid)).map_err(|_|"Engine input unavailable")?;
    let root=normal_windows_path(&root)?;
    let binary=normal_windows_path(binary)?;
    let mut engine=Engine::start(&binary,&root,rate_mib,segmented)?;
    let mut progress=0;
    let mut last_change=Instant::now();
    let deadline=Instant::now()+Duration::from_secs(900);
    let mut failures=0;
    loop{
        if stop.load(Ordering::Relaxed){
            let _=engine.rpc("pause",vec![json!(gid)]);
            let _=engine.rpc("saveSession",vec![]);
            return Ok(Outcome::Stopped);
        }
        if engine.child.try_wait().map_err(|_|"Engine status unavailable")?.is_some(){return Err("Engine exited");}
        match engine.status(&gid,total){
            Ok((state,bytes))=>{
                failures=0;
                if bytes!=progress{progress=bytes;last_change=Instant::now();}
                report(bytes,Some(total));
                match state.as_str(){
                    "complete" if bytes==total=>{
                        let payload=root.join("output").join("payload.bin");
                        if !regular(&payload,total)||fs::metadata(&payload).map_err(|_|"Output unavailable")?.len()!=total{return Err("Engine output mismatch");}
                        if stop.load(Ordering::Relaxed){return Ok(Outcome::Stopped);}
                        if path.exists(){return Err("Vault destination already exists");}
                        fs::rename(&payload,path).map_err(|_|"Engine output finalization failed")?;
                        return Ok(Outcome::Complete);
                    },
                    "active"|"waiting"=>{},
                    _=>return Err("Engine transfer failed"),
                }
            }
            Err(_)=>{failures+=1;if failures>=5{return Err("Engine status failed");}}
        }
        if Instant::now()>=deadline||last_change.elapsed()>Duration::from_secs(60){return Err("Engine transfer stalled");}
        thread::sleep(Duration::from_millis(200));
    }
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn pin_and_manifest_guards(){
        assert!(!verify_binary(Path::new("missing-aria2-next.exe")));
        assert!(valid_hex("0123456789abcdef",16));
        assert!(!valid_hex("../0123456789abc",16));
        let m=Manifest{version:1,url:"https://example.org/a.pdf".into(),etag:"\"v1\"".into(),mime:"application/pdf".into(),total:MAX_FILE+1,port:1,token:"a".repeat(64),gid:"b".repeat(16)};
        assert!(!m.valid());
    }
}
