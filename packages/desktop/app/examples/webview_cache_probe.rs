//! Standalone Windows integration probe. Never opens a TSUGI application profile.
#[cfg(not(windows))]
fn main() {
    eprintln!("This probe requires Windows and the WebView2 runtime.");
    std::process::exit(1);
}

#[cfg(windows)]
fn main() {
    match probe::run() {
        Ok(code) => std::process::exit(code),
        Err(error) => {
            eprintln!("WebView2 cache probe failed: {error}");
            std::process::exit(1);
        }
    }
}

#[cfg(windows)]
mod probe {
    use std::{
        env, fs,
        io::{BufRead, BufReader, Read, Write},
        net::{Ipv4Addr, TcpListener, TcpStream},
        os::windows::{fs::MetadataExt, io::{AsRawHandle, FromRawHandle, OwnedHandle}},
        path::{Path, PathBuf},
        process::Command,
        sync::{Arc, atomic::{AtomicBool, AtomicUsize, Ordering}},
        thread,
        time::{Duration, Instant, SystemTime, UNIX_EPOCH},
    };
    use tao::{
        event::{Event, WindowEvent},
        event_loop::{ControlFlow, EventLoopBuilder},
        platform::run_return::EventLoopExtRunReturn,
        window::WindowBuilder,
    };
    use webview2_com::{
        CoTaskMemPWSTR, ClearBrowsingDataCompletedHandler,
        Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE, ICoreWebView2Environment7,
            ICoreWebView2Profile2, ICoreWebView2_13,
        },
    };
    use windows::core::{Interface, PWSTR};
    use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject};
    use wry::{WebContext, WebView, WebViewBuilder, WebViewExtWindows};

    type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;
    const PAGE: &str = include_str!("webview_cache_fixture.html");
    const PREFIX: &str = "tsugi-webview-cache-fixture-";
    const REPARSE_POINT: u32 = 0x400;

    fn reject_overrides() -> Result<()> {
        // Environment/policy overrides could redirect the test to an unrelated profile.
        if env::vars_os().any(|(name, _)| name.to_string_lossy().to_ascii_uppercase().starts_with("WEBVIEW2_")) {
            return Err("WebView2 environment override present; refusing disposable probe".into());
        }
        Ok(())
    }

    fn root_for(token: &str) -> Result<PathBuf> {
        if token.len() != 32 || !token.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("invalid fixture ownership token".into());
        }
        Ok(env::temp_dir().join(format!("{PREFIX}{token}")))
    }

    fn ordinary_directory(path: &Path) -> Result<()> {
        let meta = fs::symlink_metadata(path)?;
        if !meta.is_dir() || meta.file_attributes() & REPARSE_POINT != 0 {
            return Err("fixture directory is not an ordinary directory".into());
        }
        Ok(())
    }

    fn owned_root(token: &str) -> Result<PathBuf> {
        let root = root_for(token)?;
        ordinary_directory(&root)?;
        let marker = root.join("fixture-owner");
        let meta = fs::symlink_metadata(&marker)?;
        if !meta.is_file() || meta.file_attributes() & REPARSE_POINT != 0 || meta.len() != 32
            || fs::read_to_string(&marker)? != token {
            return Err("fixture ownership marker mismatch".into());
        }
        ordinary_directory(&root.join("profile"))?;
        Ok(root)
    }

    fn serve_one(mut stream: TcpStream, hits: &AtomicUsize) -> std::io::Result<()> {
        stream.set_read_timeout(Some(Duration::from_secs(2)))?;
        stream.set_write_timeout(Some(Duration::from_secs(2)))?;
        let mut request = Vec::new();
        let mut reader = BufReader::new(&mut stream).take(32768);
        reader.read_until(b'\n', &mut request)?;
        if request.len() > 8192 { return Ok(()); }
        let line = std::str::from_utf8(&request).unwrap_or("");
        let mut parts = line.split_ascii_whitespace();
        let method = parts.next().unwrap_or("");
        let path = parts.next().unwrap_or("");
        let asset;
        let (status, mime, cache, body) = if method == "GET" && path.starts_with("/fixture?phase=") {
            ("200 OK", "text/html; charset=utf-8", "no-store", PAGE)
        } else if method == "GET" && path == "/asset" {
            hits.fetch_add(1, Ordering::SeqCst);
            asset = "tsugi-disk-cache-fixture\n".repeat(4096);
            ("200 OK", "text/plain; charset=utf-8", "public, max-age=3600", asset.as_str())
        } else {
            ("404 Not Found", "text/plain", "no-store", "not found")
        };
        // Consume the remaining headers before closing the connection.
        loop {
            let mut header = Vec::new();
            let n = reader.read_until(b'\n', &mut header)?;
            if n == 0 || header == b"\r\n" || header == b"\n" { break; }
        }
        drop(reader);
        write!(stream, "HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nCache-Control: {cache}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len())?;
        stream.write_all(body.as_bytes())
    }

    // Hold a process handle rather than assuming a host exit flushes the profile.
    fn browser_handle(webview: &WebView) -> Result<OwnedHandle> {
        let mut pid = 0;
        unsafe { webview.webview().BrowserProcessId(&mut pid)?; }
        if pid == 0 { return Err("invalid WebView2 browser process".into()); }
        let handle = unsafe { OpenProcess(0x0010_0000, 0, pid) }; // SYNCHRONIZE only
        if handle.is_null() { return Err(std::io::Error::last_os_error().into()); }
        Ok(unsafe { OwnedHandle::from_raw_handle(handle) })
    }

    fn assert_profile(webview: &WebView, root: &Path) -> Result<ICoreWebView2Profile2> {
        let expected = root.join("profile");
        ordinary_directory(&expected)?;
        let environment = webview.environment().cast::<ICoreWebView2Environment7>()?;
        let mut folder = PWSTR::null();
        unsafe { environment.UserDataFolder(&mut folder)?; }
        let folder = CoTaskMemPWSTR::from(folder);
        if fs::canonicalize(PathBuf::from(folder.to_string()))? != fs::canonicalize(&expected)? {
            return Err("WebView2 resolved a different user data folder".into());
        }
        let profile = unsafe { webview.webview().cast::<ICoreWebView2_13>()?.Profile()? };
        let mut path = PWSTR::null();
        unsafe { profile.ProfilePath(&mut path)?; }
        let path = CoTaskMemPWSTR::from(path);
        let path = PathBuf::from(path.to_string());
        let default = expected.join("EBWebView").join("Default");
        ordinary_directory(&expected.join("EBWebView"))?;
        ordinary_directory(&default)?;
        if fs::canonicalize(&path)? != fs::canonicalize(&default)? {
            return Err("WebView2 resolved a different profile".into());
        }
        Ok(profile.cast::<ICoreWebView2Profile2>()?)
    }

    enum Message { Page(String), Cleared(bool) }

    fn child(token: &str, port: u16, phase: &str) -> Result<i32> {
        reject_overrides()?;
        let root = owned_root(token)?;
        if !matches!(phase, "seed" | "clear" | "verify" | "interrupt" | "post-interrupt") {
            return Err("invalid fixture phase".into());
        }
        let url = format!("http://127.0.0.1:{port}/fixture?phase={phase}");
        let mut event_loop = EventLoopBuilder::<Message>::with_user_event().build();
        let proxy = event_loop.create_proxy();
        let window = WindowBuilder::new().with_title("TSUGI disposable cache probe")
            .with_visible(true).build(&event_loop)?;
        let mut context = WebContext::new(Some(root.join("profile")));
        let allowed = url.clone();
        let webview = WebViewBuilder::new_with_web_context(&mut context)
            .with_url("about:blank")
            .with_navigation_handler(move |target| target == "about:blank" || target == allowed)
            .with_ipc_handler({
                let proxy = proxy.clone();
                move |request| { let _ = proxy.send_event(Message::Page(request.body().clone())); }
            })
            .build(&window)?;
        let profile = assert_profile(&webview, &root)?;
        let process = browser_handle(&webview)?;
        // Do not seed even synthetic state before checking the resolved profile.
        webview.load_url(&url)?;
        let deadline = Instant::now() + Duration::from_secs(40);
        let mut stage = 0;
        let mut outcome = 1;
        let mut error = String::from("fixture did not complete");
        event_loop.run_return(|event, _, control| {
            if Instant::now() >= deadline {
                error = "fixture phase timed out".into();
                *control = ControlFlow::Exit;
                return;
            }
            *control = ControlFlow::WaitUntil(deadline);
            match event {
                Event::UserEvent(Message::Page(message)) => match message.as_str() {
                    "verified" if stage == 0 && !matches!(phase, "clear" | "interrupt") => {
                        outcome = 0;
                        *control = ControlFlow::Exit;
                    }
                    "ready-to-clear" if stage == 0 && matches!(phase, "clear" | "interrupt") => {
                        stage = 1;
                        let done = proxy.clone();
                        // Verify the actual COM profile again immediately before clearing.
                        let result = assert_profile(&webview, &root).and_then(|checked| {
                            unsafe {
                                checked.ClearBrowsingData(
                                    COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE,
                                    &ClearBrowsingDataCompletedHandler::create(Box::new(move |result| {
                                        let _ = done.send_event(Message::Cleared(result.is_ok()));
                                        Ok(())
                                    })),
                                )?;
                            }
                            Ok(())
                        });
                        if let Err(reason) = result {
                            error = reason.to_string();
                            *control = ControlFlow::Exit;
                        } else if phase == "interrupt" {
                            // Closing before observing the callback is deliberately unknown.
                            outcome = 2;
                            *control = ControlFlow::Exit;
                        }
                    }
                    "preserved" if stage == 2 && phase == "clear" => {
                        outcome = 0;
                        *control = ControlFlow::Exit;
                    }
                    _ => {
                        error = format!("unexpected fixture message: {message}");
                        *control = ControlFlow::Exit;
                    }
                },
                Event::UserEvent(Message::Cleared(true)) if stage == 1 && phase == "clear" => {
                    stage = 2;
                    if let Err(reason) = webview.evaluate_script("window.verifyAfterClear()") {
                        error = reason.to_string();
                        *control = ControlFlow::Exit;
                    }
                }
                Event::UserEvent(Message::Cleared(_)) => {
                    error = "cache completion failed or arrived out of sequence".into();
                    *control = ControlFlow::Exit;
                }
                Event::WindowEvent { event: WindowEvent::CloseRequested, .. } => {
                    error = "fixture window closed unexpectedly".into();
                    *control = ControlFlow::Exit;
                }
                _ => {}
            }
        });
        drop(profile);
        drop(webview);
        drop(context);
        drop(window);
        // Wait only on this disposable browser's existing handle; never terminate it.
        if unsafe { WaitForSingleObject(process.as_raw_handle(), 20_000) } != 0 {
            return Err("disposable WebView2 browser did not exit normally".into());
        }
        if outcome == 1 { return Err(error.into()); }
        println!("PASS WebView2 fixture {phase}: exit {outcome}");
        Ok(outcome)
    }

    fn launch(token: &str, port: u16, phase: &str, expected: i32) -> Result<()> {
        let mut process = Command::new(env::current_exe()?)
            .args(["--fixture-child", token, &port.to_string(), phase]).spawn()?;
        let deadline = Instant::now() + Duration::from_secs(75);
        loop {
            if let Some(status) = process.try_wait()? {
                if status.code() != Some(expected) {
                    return Err(format!("fixture phase {phase} returned {status}, expected {expected}").into());
                }
                return Ok(());
            }
            if Instant::now() >= deadline {
                process.kill()?;
                process.wait()?;
                return Err(format!("fixture phase {phase} exceeded the supervisor deadline").into());
            }
            thread::sleep(Duration::from_millis(50));
        }
    }

    pub fn run() -> Result<i32> {
        reject_overrides()?;
        let args: Vec<_> = env::args().skip(1).collect();
        if let [flag, token, port, phase] = args.as_slice() {
            if flag != "--fixture-child" { return Err("invalid fixture command".into()); }
            return child(token, port.parse()?, phase);
        }
        if !args.is_empty() { return Err("this fixture accepts no external profile path".into()); }
        let token = format!("{:032x}", SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos()
            ^ ((std::process::id() as u128) << 64));
        let root = root_for(&token)?;
        fs::create_dir(&root)?;
        fs::write(root.join("fixture-owner"), &token)?;
        fs::create_dir(root.join("profile"))?;
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        let port = listener.local_addr()?.port();
        listener.set_nonblocking(true)?;
        let hits = Arc::new(AtomicUsize::new(0));
        let stop = Arc::new(AtomicBool::new(false));
        let server = thread::spawn({
            let hits = hits.clone();
            let stop = stop.clone();
            move || while !stop.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((stream, _)) => { let _ = serve_one(stream, &hits); }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock =>
                        thread::sleep(Duration::from_millis(10)),
                    Err(_) => break,
                }
            }
        });
        let result: Result<()> = (|| {
            for (phase, expected) in [("seed", 1), ("clear", 1), ("verify", 2)] {
                launch(&token, port, phase, 0)?;
                let actual = hits.load(Ordering::SeqCst);
                if actual != expected {
                    return Err(format!("HTTP cache request count after {phase}: {actual}, expected {expected}").into());
                }
                println!("PASS WebView2 {phase} HTTP cache requests: {actual}");
            }
            launch(&token, port, "interrupt", 2)?;
            launch(&token, port, "post-interrupt", 0)?;
            println!("PASS WebView2 DISK_CACHE preservation, cold/warm/restart counts 1/1/2; interrupted outcome unknown");
            Ok(())
        })();
        stop.store(true, Ordering::SeqCst);
        server.join().map_err(|_| "fixture server panicked")?;
        result?;
        // Only the freshly created, owned fixture is eligible for cleanup.
        let verified = owned_root(&token)?;
        fs::remove_dir_all(verified)?;
        Ok(0)
    }
}
