//! Original Rust-side Aria2 Next RPC/supervision acceptance probe.
//! Evaluation only: loopback fixtures, no production job handoff.
#[cfg(windows)]
mod windows {
    use serde_json::{Value, json};
    use std::{fs, io::Read, net::TcpListener, path::{Path, PathBuf},
        process::{Child, Command, Stdio}, thread, time::{Duration, Instant}};
    use std::os::windows::process::CommandExt;

    type Result<T> = std::result::Result<T, &'static str>;
    const LIMIT: u64 = 64 * 1024;
    const FIXTURE_LEN: u64 = 16 * 1024 * 1024;

    fn free_port() -> Result<u16> {
        TcpListener::bind(("127.0.0.1", 0)).and_then(|s| s.local_addr())
            .map(|a| a.port()).map_err(|_| "Could not reserve local port")
    }

    fn random_hex() -> Result<String> {
        let mut bytes = [0u8; 32];
        getrandom::fill(&mut bytes).map_err(|_| "Could not generate RPC token")?;
        Ok(bytes.iter().map(|b| format!("{b:02x}")).collect::<Vec<_>>().join(""))
    }

    struct Engine {
        child: Child,
        agent: ureq::Agent,
        endpoint: String,
        secret: String,
    }

    impl Engine {
        fn start(binary: &Path, root: &Path) -> Result<Self> {
            let port = free_port()?;
            let secret = random_hex()?;
            let output = root.join("output");
            let state = root.join("state");
            fs::create_dir(&output).map_err(|_| "Could not create output")?;
            fs::create_dir(&state).map_err(|_| "Could not create state")?;
            let mut command = Command::new(binary);
            command.creation_flags(0x08000000)
                .current_dir(root)
                .args(["--no-conf=true", "--enable-rpc=true", "--rpc-listen-all=false",
                    "--enable-dht=false", "--enable-peer-exchange=false", "--bt-enable-lpd=false",
                    "--bt-port-mapping=false", "--ed2k-port-mapping=false", "--disable-ipv6=true",
                    "--file-allocation=none", "--summary-interval=0", "--show-console-readout=false",
                    "--max-concurrent-downloads=2", "--follow-torrent=false", "--follow-metalink=false",
                    "--no-netrc=true", "--auto-file-renaming=false", "--allow-overwrite=false"])
                .arg(format!("--rpc-listen-port={port}"))
                .arg(format!("--rpc-secret={secret}"))
                .arg(format!("--dir={}", output.display()))
                .arg(format!("--state-dir={}", state.display()))
                .arg(format!("--stop-with-process={}", std::process::id()))
                .arg(format!("--listen-port={}", free_port()?))
                .arg(format!("--ed2k-listen-port={}", free_port()?))
                .arg(format!("--ed2k-udp-listen-port={}", free_port()?))
                .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
            // Disable inherited proxy configuration for both local transports.
            for (key, _) in std::env::vars_os() {
                if key.to_string_lossy().to_ascii_lowercase().ends_with("_proxy") { command.env_remove(key); }
            }
            let child = command.spawn().map_err(|_| "Engine launch failed")?;
            let agent = ureq::Agent::config_builder()
                .proxy(None).max_redirects(0).timeout_global(Some(Duration::from_secs(3))).build().into();
            let mut engine = Self { child, agent, endpoint: format!("http://127.0.0.1:{port}/jsonrpc"), secret };
            let deadline = Instant::now() + Duration::from_secs(20);
            loop {
                if engine.child.try_wait().map_err(|_| "Engine status unavailable")?.is_some() {
                    return Err("Engine exited before RPC readiness");
                }
                if let Ok(version) = engine.rpc("getVersion", vec![], true) {
                    if version["version"].as_str().is_some_and(|v| v.contains("3.1.2")) { return Ok(engine); }
                    return Err("Unexpected engine version");
                }
                if Instant::now() >= deadline { return Err("RPC readiness timed out"); }
                thread::sleep(Duration::from_millis(100));
            }
        }

        fn rpc(&self, method: &str, mut params: Vec<Value>, auth: bool) -> Result<Value> {
            if auth { params.insert(0, json!(format!("token:{}", self.secret))); }
            let request = json!({"jsonrpc":"2.0","id":"tsugi-probe","method":format!("aria2.{method}"),"params":params});
            let response = self.agent.post(&self.endpoint).header("Content-Type","application/json")
                .send(request.to_string()).map_err(|_| "RPC transport failed")?;
            let mut bytes = Vec::new();
            response.into_body().into_reader().take(LIMIT+1).read_to_end(&mut bytes)
                .map_err(|_| "RPC response unreadable")?;
            if bytes.len() as u64 > LIMIT { return Err("RPC response exceeded bound"); }
            let value: Value = serde_json::from_slice(&bytes).map_err(|_| "Invalid RPC JSON")?;
            if value["id"] != "tsugi-probe" || value.get("error").is_some() { return Err("RPC rejected"); }
            value.get("result").cloned().ok_or("RPC result missing")
        }

        fn add(&self, url: &str, name: &str) -> Result<String> {
            let value = self.rpc("addUri", vec![json!([url]),json!({"out":name,
                "max-download-limit":"2M","split":"1","stream-max-connections":"1"})], true)?;
            let gid = value.as_str().filter(|s| s.len()==16 && s.bytes().all(|b| b.is_ascii_hexdigit()))
                .ok_or("Invalid task ID")?;
            Ok(gid.to_owned())
        }

        fn status(&self, gid: &str) -> Result<Status> {
            let value = self.rpc("tellStatus", vec![json!(gid),
                json!(["status","completedLength","totalLength","downloadSpeed"])], true)?;
            let number = |name: &str| value[name].as_str().and_then(|n| n.parse::<u64>().ok()).ok_or("Invalid transfer telemetry");
            let status = value["status"].as_str().ok_or("Missing transfer status")?;
            if !["active","waiting","paused","complete","error","removed"].contains(&status) { return Err("Unknown transfer status"); }
            let completed = number("completedLength")?;
            let total = number("totalLength")?;
            let speed = number("downloadSpeed")?;
            if completed > FIXTURE_LEN || total > FIXTURE_LEN || (total != 0 && completed > total) { return Err("Invalid fixture length"); }
            Ok(Status { state:status.to_owned(), completed, total, speed })
        }

        fn until(&self, gid: &str, expected: &str, timeout: Duration) -> Result<Status> {
            let deadline = Instant::now() + timeout;
            loop {
                let status = self.status(gid)?;
                if status.state == expected { return Ok(status); }
                if ["error","removed","complete"].contains(&status.state.as_str()) { return Err("Unexpected terminal transfer status"); }
                if Instant::now() >= deadline { return Err("Transfer state timed out"); }
                thread::sleep(Duration::from_millis(100));
            }
        }
    }
    impl Drop for Engine {
        fn drop(&mut self) {
            let _ = self.rpc("shutdown", vec![], true);
            let deadline = Instant::now() + Duration::from_secs(3);
            while Instant::now() < deadline {
                if self.child.try_wait().ok().flatten().is_some() { return; }
                thread::sleep(Duration::from_millis(50));
            }
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
    struct Status { state: String, completed: u64, total: u64, speed: u64 }

    pub fn run() -> Result<()> {
        let args: Vec<_> = std::env::args_os().collect();
        if args.len() != 4 { return Err("Expected pinned binary, loopback origin and fresh output root"); }
        let binary = PathBuf::from(&args[1]).canonicalize().map_err(|_| "Missing pinned binary")?;
        let origin = args[2].to_str().ok_or("Invalid origin")?;
        let url = url::Url::parse(origin).map_err(|_| "Invalid origin")?;
        if url.scheme() != "http" || url.host_str()!=Some("127.0.0.1") || url.port().is_none()
            || url.path()!="/" || url.query().is_some() || url.fragment().is_some()
            || !url.username().is_empty() || url.password().is_some() { return Err("Only loopback fixtures are permitted"); }
        let root = PathBuf::from(&args[3]);
        fs::create_dir(&root).map_err(|_| "Output root must be new")?;
        let root = root.canonicalize().map_err(|_| "Output root unavailable")?;
        // Keep paths in standard Windows form for the third-party engine.
        let root = PathBuf::from(root.to_string_lossy().trim_start_matches(r"\\?\"));
        let binary = PathBuf::from(binary.to_string_lossy().trim_start_matches(r"\\?\"));
        let engine = Engine::start(&binary, &root)?;
        if engine.rpc("tellActive", vec![], false).is_ok() { return Err("Unauthenticated RPC was accepted"); }
        let gid = engine.add(&format!("{}one.bin",url.as_str()),"one.bin")?;
        let active = engine.until(&gid,"active",Duration::from_secs(15))?;
        println!("PASS: Rust authenticated RPC, active task ({} bytes, {} B/s)",active.completed,active.speed);
        engine.rpc("pause",vec![json!(gid)],true)?;
        engine.until(&gid,"paused",Duration::from_secs(15))?;
        engine.rpc("unpause",vec![json!(gid)],true)?;
        let complete = engine.until(&gid,"complete",Duration::from_secs(60))?;
        if complete.completed != FIXTURE_LEN || complete.total != FIXTURE_LEN { return Err("Completed size mismatch"); }
        let cancelled = engine.add(&format!("{}two.bin",url.as_str()),"two.bin")?;
        engine.until(&cancelled,"active",Duration::from_secs(15))?;
        engine.rpc("forceRemove",vec![json!(cancelled)],true)?;
        engine.until(&cancelled,"removed",Duration::from_secs(15))?;
        println!("PASS: Rust pause, resume, telemetry and cancellation");
        // The same native client now transfers through a bounded validator-checking
        // gateway, so Aria2 never sees or follows the upstream URL itself.
        let source=aiostreams_desktop_core::vault_gateway::Source::probe(&format!("{}three.bin",url.as_str()),true)?;
        let job=std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let gateway=aiostreams_desktop_core::vault_gateway::Gateway::start(source,0,&random_hex()?,job)?;
        let gid=engine.add(&gateway.url(),"gateway.bin")?;
        let result=engine.until(&gid,"complete",Duration::from_secs(60))?;
        if result.completed!=FIXTURE_LEN||result.total!=FIXTURE_LEN{return Err("Gateway output size mismatch");}
        println!("PASS: Rust engine through validated native range gateway");
        drop(gateway);
        drop(engine);
        // Exercise the actual runtime adapter, including its persisted stage,
        // using a distinct directory and the same pinned fixture executable.
        use aiostreams_desktop_core::vault_engine::{transfer,Outcome};
        use std::sync::{Arc,atomic::{AtomicBool,Ordering}};
        let destination=root.join("runtime");
        fs::create_dir(&destination).map_err(|_|"Runtime fixture folder failed")?;
        let target=destination.join("restored.bin");
        let source=format!("{}crash.bin",url.as_str());
        let stop=Arc::new(AtomicBool::new(false));
        let signal=stop.clone();
        let first=transfer(&binary,&source,&target,stop,2,|m|m=="application/octet-stream",move|bytes,_|{
            if bytes>=5*1024*1024{signal.store(true,Ordering::Relaxed);}
        },true);
        if first!=Outcome::Stopped||target.exists()||!destination.join(".tsugi-aria2/manifest.json").is_file(){
            return Err("Runtime adapter did not preserve interrupted stage");
        }
        let first_report=std::cell::Cell::new(None);
        let result=transfer(&binary,&source,&target,Arc::new(AtomicBool::new(false)),2,|m|m=="application/octet-stream",|bytes,_|{
            if first_report.get().is_none(){first_report.set(Some(bytes));}
        },true);
        if result!=Outcome::Complete||destination.join(".tsugi-aria2").exists(){return Err("Runtime adapter recovery failed");}
        println!("PASS: Runtime adapter resumed validated stage; first observed progress {:?}",first_report.get());
        use aiostreams_desktop_core::vault_engine::transfer_media;
        let watch="https://www.youtube.com/watch?v=abcdefghijk";
        for (name,validated) in [("media",true),("single",false)]{
            let dir=root.join(name);
            fs::create_dir(&dir).map_err(|_|"Media fixture folder failed")?;
            let target=dir.join("audio.m4a");
            let media=format!("{}{name}.m4a?sig=fixture-private",url.as_str());
            let headers=vec![("user-agent".into(),"Tsugi fixture".into())];
            let stop=Arc::new(AtomicBool::new(false));
            let signal=stop.clone();
            let first=transfer_media(&binary,watch,&media,headers.clone(),&target,stop,2,move|bytes,_|{
                if bytes>=2*1024*1024{signal.store(true,Ordering::Relaxed);}
            },true);
            if first!=Outcome::Stopped||target.exists(){return Err("Media pause did not stop safely");}
            let manifest=dir.join(".tsugi-aria2/manifest.json");
            if validated{
                let content=fs::read_to_string(&manifest).map_err(|_|"Media recovery manifest missing")?;
                if content.contains("fixture-private")||!content.contains(watch){return Err("Sensitive media URL persisted");}
            }else if manifest.exists(){return Err("Unvalidated media stage survived pause");}
            let result=transfer_media(&binary,watch,&media,headers,&target,Arc::new(AtomicBool::new(false)),2,|_,_|{},true);
            if result!=Outcome::Complete||manifest.exists(){return Err("Media adapter completion failed");}
            println!("PASS: {name} audio fixture paused, completed, no signed URL in manifest");
        }
        Ok(())
    }
}
#[cfg(windows)]
fn main() {
    if let Err(error) = windows::run() { eprintln!("{error}"); std::process::exit(1); }
}
#[cfg(not(windows))]
fn main() { eprintln!("Windows-only engine probe"); std::process::exit(1); }
