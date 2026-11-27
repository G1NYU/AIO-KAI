mod pip;

use std::borrow::Cow;
use std::cell::RefCell;
use std::rc::Rc;
use std::time::Instant;

use aiostreams_desktop_core::bridge::{self, Outbound, origin};
use aiostreams_desktop_core::discord;
use tao::dpi::{LogicalSize, PhysicalPosition, PhysicalSize};
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopWindowTarget};
use tao::monitor::MonitorHandle;
#[cfg(target_os = "macos")]
use tao::platform::macos::WindowBuilderExtMacOS;
#[cfg(windows)]
use tao::platform::windows::{WindowBuilderExtWindows, WindowExtWindows};
use tao::window::{Fullscreen, ResizeDirection, Window, WindowBuilder};
#[cfg(windows)]
use wry::WebViewBuilderExtWindows;
use wry::http::{Request, Response};
use wry::{NewWindowResponse, PageLoadEvent, Rect, WebContext, WebViewBuilder};

use self::pip::Pip;
use crate::links::Inbox;
use crate::media;
use crate::placement::{self, MIN_SIZE, Placement, SETTLE};
use crate::updates::Updater;
use crate::{
    App, Edge, UserEvent, allowed_navigation, handle, platform, receive_script, serve,
    start_downloads, start_external, start_player,
};
use aiostreams_desktop_core::downloads::Command as DownloadCommand;

#[cfg(target_os = "macos")]
const CLOSE_WAIT: std::time::Duration = std::time::Duration::from_secs(3);

pub fn webview_version() -> String {
    wry::webview_version().unwrap_or_else(|_| "missing".into())
}

fn page_bounds(size: PhysicalSize<u32>) -> Rect {
    Rect {
        position: PhysicalPosition::new(0, 0).into(),
        size: size.into(),
    }
}

/// tao keeps a maximized frameless window's content off the taskbar even in
/// fullscreen, so the window leaves maximized first and goes back after.
fn set_fullscreen(window: &Window, value: Option<bool>, remaximize: &mut bool) {
    let on = value.unwrap_or(window.fullscreen().is_none());
    if on == window.fullscreen().is_some() {
        return;
    }
    if on {
        *remaximize = window.is_maximized();
        if *remaximize {
            window.set_maximized(false);
        }
        window.set_fullscreen(Some(Fullscreen::Borderless(None)));
    } else {
        window.set_fullscreen(None);
        if std::mem::take(remaximize) {
            window.set_maximized(true);
        }
    }
}

/// Whether the top middle of a window `width` logical pixels wide at `(x, y)` is on a screen.
fn on_screen(
    mut monitors: impl Iterator<Item = MonitorHandle>,
    (x, y): (i32, i32),
    width: u32,
) -> bool {
    monitors.any(|m| {
        let (origin, size) = (m.position(), m.size());
        let middle = x + (width as f64 * m.scale_factor() / 2.0) as i32;
        (origin.x..origin.x + size.width as i32).contains(&middle)
            && (origin.y..origin.y + size.height as i32).contains(&(y + 16))
    })
}

fn start_position(
    target: &EventLoopWindowTarget<UserEvent>,
    saved: &Placement,
) -> Option<PhysicalPosition<i32>> {
    if let Some(at) = saved.position
        && on_screen(target.available_monitors(), at, saved.width)
    {
        return Some(PhysicalPosition::new(at.0, at.1));
    }
    let m = target.primary_monitor()?;
    let (origin, size, scale) = (m.position(), m.size(), m.scale_factor());
    let width = (saved.width as f64 * scale) as i32;
    let height = (saved.height as f64 * scale) as i32;
    Some(PhysicalPosition::new(
        origin.x + ((size.width as i32 - width) / 2).max(0),
        origin.y + ((size.height as i32 - height) / 2).max(0),
    ))
}

/// Read once the window settles, since a maximize reports its new bounds before its new state.
fn record(window: &Window, placement: &mut Placement) {
    if window.fullscreen().is_some() || window.is_minimized() {
        return;
    }
    placement.maximized = window.is_maximized();
    if !placement.maximized {
        let size = window.inner_size().to_logical::<f64>(window.scale_factor());
        placement.width = size.width.round() as u32;
        placement.height = size.height.round() as u32;
        if let Ok(p) = window.outer_position() {
            placement.position = Some((p.x, p.y));
        }
    }
}

fn direction(edge: Edge) -> ResizeDirection {
    match edge {
        Edge::North => ResizeDirection::North,
        Edge::NorthEast => ResizeDirection::NorthEast,
        Edge::NorthWest => ResizeDirection::NorthWest,
    }
}

pub fn run(app: App) {
    let App {
        args,
        web,
        start_url,
        app_origin,
        data_dir,
        paths,
        bridge,
    } = app;
    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let inbox = Rc::new(RefCell::new(Inbox::default()));
    if let Some(link) = args.link.clone() {
        inbox.borrow_mut().receive(link);
    }
    #[cfg(windows)]
    platform::listen_links(&data_dir, {
        let proxy = proxy.clone();
        move |link| {
            let _ = proxy.send_event(UserEvent::Link(link));
        }
    });
    #[cfg(target_os = "macos")]
    platform::load_video_output(&data_dir);
    #[cfg(target_os = "macos")]
    let _menu = platform::install_menu({
        let proxy = proxy.clone();
        move || {
            let _ = proxy.send_event(UserEvent::Close);
        }
    });
    let mut placement = placement::load(&data_dir);
    let builder = WindowBuilder::new()
        .with_title("Tsugi")
        .with_window_icon(platform::window_icon())
        .with_inner_size(LogicalSize::new(placement.width, placement.height))
        .with_min_inner_size(LogicalSize::new(MIN_SIZE.0, MIN_SIZE.1))
        .with_maximized(placement.maximized);
    let builder = match start_position(&event_loop, &placement) {
        Some(position) => builder.with_position(position),
        None => builder,
    };
    // macOS keeps its own window buttons, drawn over the page.
    #[cfg(target_os = "macos")]
    let builder = builder
        .with_titlebar_transparent(true)
        .with_title_hidden(true)
        .with_fullsize_content_view(true);
    // tao shows a visible window at its restored size before maximizing it.
    #[cfg(windows)]
    let builder = builder
        .with_visible(false)
        .with_decorations(false)
        .with_undecorated_shadow(true)
        .with_window_classname(platform::WINDOW_CLASS)
        .with_taskbar_icon(platform::window_icon());
    let window = builder
        .build(&event_loop)
        .unwrap_or_else(|e| platform::fatal(&format!("could not open a window: {e}")));
    let size = window.inner_size();
    #[cfg(target_os = "macos")]
    let _fullscreen_left = platform::on_fullscreen_left(&window, {
        let proxy = proxy.clone();
        move || {
            let _ = proxy.send_event(UserEvent::FullscreenLeft);
        }
    });

    let video = platform::VideoSurface::new(&window).unwrap_or_else(|e| platform::fatal(&e));
    let started = start_player(&video, &paths, {
        let proxy = proxy.clone();
        move |message: Outbound| {
            let _ = proxy.send_event(UserEvent::Emit(receive_script(&message)));
        }
    });
    video.attach(started.mpv());
    video.on_input({
        let proxy = proxy.clone();
        move |message: Outbound| {
            let _ = proxy.send_event(UserEvent::Emit(receive_script(&message)));
        }
    });
    let player = Rc::new(RefCell::new(Some(started)));
    let external = Rc::new(start_external(&paths, {
        let proxy = proxy.clone();
        move |message: Outbound| {
            let _ = proxy.send_event(UserEvent::Emit(receive_script(&message)));
        }
    }));
    let updater = Rc::new(Updater::start({
        let proxy = proxy.clone();
        move |message: Outbound| {
            let _ = proxy.send_event(UserEvent::Emit(receive_script(&message)));
        }
    }));
    let downloads = Rc::new(start_downloads(&paths, {
        let proxy = proxy.clone();
        move |message: Outbound| {
            let _ = proxy.send_event(UserEvent::Emit(receive_script(&message)));
        }
    }));
    let keys = {
        let proxy = proxy.clone();
        move |key| {
            let _ = proxy.send_event(UserEvent::Emit(receive_script(&Outbound::MediaKey { key })));
        }
    };
    #[cfg(windows)]
    media::start(window.hwnd(), keys);
    #[cfg(target_os = "macos")]
    media::start(keys);
    discord::start({
        let proxy = proxy.clone();
        move |message: Outbound| {
            let _ = proxy.send_event(UserEvent::Emit(receive_script(&message)));
        }
    });

    #[cfg(windows)]
    let reading = crate::reading::bundled_runtime_path(&args, web.as_deref()).map(|runtime| {
        let proxy = proxy.clone();
        std::sync::Arc::new(crate::reading::Worker::new(runtime, data_dir.join("reading"), window.hwnd() as isize, downloads.as_ref().clone(), move |message| {
            let _ = proxy.send_event(UserEvent::Emit(receive_script(&message)));
        }))
    });
    #[cfg(windows)]
    let backup_root = crate::reading::bundled_directory(&args, web.as_deref()).map(|_| data_dir.clone());
    #[cfg(windows)]
    let backup_busy = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    #[cfg(windows)]
    let release_root = if backup_root.is_some() && cfg!(target_arch = "x86_64") { crate::portable_root() } else { None };
    #[cfg(windows)]
    let release_busy = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    // The same exact bundled Windows origin gate as managed backups.
    #[cfg(windows)]
    let stremio = backup_root.as_ref().map(|root| Rc::new(aiostreams_desktop_core::stremio::registry::Worker::start(root.clone(), {
        let proxy = proxy.clone();
        move |message| { let _ = proxy.send_event(UserEvent::Emit(receive_script(&message))); }
    })));
    let torbox = Rc::new(aiostreams_desktop_core::torbox::Worker::start({
        let proxy = proxy.clone();
        move |message| { let _ = proxy.send_event(UserEvent::Emit(receive_script(&message))); }
    }));
    let ebook_web = web.clone();
    let mut context = WebContext::new(Some(data_dir.join(platform::WEB_DATA_DIR)));
    let builder = WebViewBuilder::new_with_web_context(&mut context)
        .with_bounds(page_bounds(size))
        .with_transparent(true)
        .with_devtools(args.devtools)
        .with_initialization_script(bridge)
        .with_custom_protocol("aiostreams".into(), {
            let vault_downloads = downloads.as_ref().clone();
            #[cfg(windows)]
            let reading = reading.clone();
            move |_, req: Request<Vec<u8>>| {
            #[cfg(windows)]
            if req.uri().path().starts_with("/__tsugi_read/page/") {
                if let Some((mime, body)) = reading.as_ref().and_then(|worker| worker.image(req.uri().path())) {
                    return Response::builder()
                        .status(200)
                        .header("Content-Type", mime)
                        .header("Cache-Control", "no-store")
                        .header("X-Content-Type-Options", "nosniff")
                        .body(Cow::Owned(body)).unwrap();
                }
                return Response::builder().status(404).body(Cow::Owned(Vec::new())).unwrap();
            }
            if let Some(id) = req.uri().path().strip_prefix("/__tsugi_vault/file/") {
                // Require a same-origin fetch with an explicit header.
                if req.method() == wry::http::Method::GET &&
                    req.headers().get("X-Tsugi-Vault-Import").and_then(|v| v.to_str().ok()) == Some("1") {
                    if let Some((mime, body)) = vault_downloads.vault_file(id) {
                        return Response::builder().status(200)
                            .header("Content-Type", mime)
                            .header("Content-Disposition", "attachment")
                            .header("Cache-Control", "no-store")
                            .header("X-Content-Type-Options", "nosniff")
                            .header("Content-Security-Policy", "default-src 'none'; sandbox")
                            .body(Cow::Owned(body)).unwrap();
                    }
                }
                return Response::builder().status(404).body(Cow::Owned(Vec::new())).unwrap();
            }
            // Ebook assets are never served from the privileged application origin.
            if req.uri().path().starts_with("/tsugi-books/") {
                return Response::builder().status(404).body(Cow::Owned(Vec::new())).unwrap();
            }
            let served = serve(web.as_deref(), req.uri().path());
            Response::builder()
                .status(served.status)
                .header("Content-Type", served.content_type)
                .body(Cow::Owned(served.body))
                .unwrap()
            }
        })
        .with_custom_protocol("tsugi-books".into(), move |_, req: Request<Vec<u8>>| {
            let path = req.uri().path();
            let safe = path.strip_prefix("/tsugi-books/").is_some_and(|relative| {
                !relative.is_empty() && !relative.contains(['%', '\\', ':']) &&
                    relative.split('/').all(|part| !part.is_empty() && part != "." && part != "..") &&
                    std::path::Path::new(relative).extension().is_some()
            });
            if req.method() != wry::http::Method::GET || !safe {
                return Response::builder().status(404).body(Cow::Owned(Vec::new())).unwrap();
            }
            let served = serve(ebook_web.as_deref(), path);
            Response::builder()
                .status(served.status)
                .header("Content-Type", served.content_type)
                .header("X-Content-Type-Options", "nosniff")
                .header("Cache-Control", "no-store")
                .header("Content-Security-Policy", "default-src 'none'; script-src 'self' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline' blob:; img-src 'self' blob: data:; font-src 'self' blob: data:; frame-src blob: about:; connect-src 'self' blob:; media-src blob: data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors http://aiostreams.localhost")
                .body(Cow::Owned(served.body)).unwrap()
        })
        .with_ipc_handler({
            let (player, proxy, app_origin) = (player.clone(), proxy.clone(), app_origin.clone());
            let (external, paths, updater) = (external.clone(), paths.clone(), updater.clone());
            let downloads = downloads.clone();
            let torbox = torbox.clone();
            #[cfg(windows)]
            let stremio = stremio.clone();
            #[cfg(windows)]
            let mut active_watch:Option<(u32,String,String)>=None;
            #[cfg(windows)]
            let reading = reading.clone();
            #[cfg(windows)]
            let (backup_root, backup_busy) = (backup_root.clone(), backup_busy.clone());
            #[cfg(windows)]
            let (release_root, release_busy) = (release_root.clone(), release_busy.clone());
            move |req: Request<String>| {
                let from = origin(&req.uri().to_string()).unwrap_or_default();
                if from != app_origin {
                    return log::warn!("ignored a message from {from}");
                }
                let send = |event: UserEvent| {
                    let _ = proxy.send_event(event);
                };
                if let Some(message) = bridge::parse(req.body()) {
                    let message = match message {
                        bridge::Inbound::TorboxRequest { request, operation, value } => {
                            if !torbox.request(request.clone(), operation, value) {
                                let _ = proxy.send_event(UserEvent::Emit(receive_script(&Outbound::TorboxResult {
                                    request, data: None, error: Some("busy".into()),
                                })));
                            }
                            return;
                        }
                        other => other,
                    };
                    #[cfg(windows)]
                    let message = match message {
                        message @ (bridge::Inbound::PlayerLoad { .. } | bridge::Inbound::PlayerStop { .. }) => {
                            active_watch=None;
                            if let Some(worker)=&stremio{worker.invalidate_grant();}
                            message
                        }
                        bridge::Inbound::StremioConsumeGrant { request, grant_id } => {
                            if request.is_empty()||request.len()>128||!request.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-'){return;}
                            let result=(||{
                                let grant=stremio.as_ref().and_then(|worker|worker.take_grant(grant_id)).ok_or("expired-review")?;
                                let owner=player.borrow();
                                let p=owner.as_ref().ok_or("unsupported")?;
                                let (profile,kind,video)=grant.identity();
                                let identity=(profile,kind.to_owned(),video.to_owned());
                                if grant.is_subtitle(){
                                    if active_watch.as_ref()!=Some(&identity){return Err("invalid-media-selection");}
                                    let (url,language)=grant.subtitle();
                                    p.add_subtitle_url(url,"Addon subtitle",language,None,&|_|false).map_err(|_|"request")?;
                                }else{
                                    p.stop_music_audio();
                                    p.load(&grant.load(),&|_|false).map_err(|_|"request")?;
                                    active_watch=Some(identity);
                                }
                                Ok(serde_json::json!({"grantId":grant_id,"accepted":true,"subtitles":grant.is_subtitle()}))
                            })();
                            let (data,error)=match result{Ok(data)=>(Some(data),None),Err(error)=>(None,Some(error.to_owned()))};
                            send(UserEvent::Emit(receive_script(&Outbound::StremioResult{request,data,error})));
                            return;
                        }
                        bridge::Inbound::StremioRequest { request, action } => {
                            if matches!(&action,aiostreams_desktop_core::stremio::registry::Action::ProfileSwitch{..}|aiostreams_desktop_core::stremio::registry::Action::ProfileRemove{..}){
                                if active_watch.take().is_some()&&let Some(p)=player.borrow().as_ref(){p.stop();}
                            }
                            let error = match &stremio {
                                Some(worker) => {
                                    if worker.request(request.clone(), action) { return; }
                                    "busy"
                                },
                                None => "unsupported",
                            };
                            send(UserEvent::Emit(receive_script(&Outbound::StremioResult { request, data:None,error:Some(error.into()) })));
                            return;
                        }
                        bridge::Inbound::TsugiReleaseCheck { request } => {
                            use std::sync::atomic::Ordering;
                            if request.is_empty() || request.len() > 128 || !request.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') { return; }
                            let Some(root) = release_root.clone() else {
                                send(UserEvent::Emit(receive_script(&Outbound::TsugiReleaseResult { request, data: None, error: Some("Tsugi release discovery is unavailable in this session.".into()) })));
                                return;
                            };
                            if release_busy.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() {
                                send(UserEvent::Emit(receive_script(&Outbound::TsugiReleaseResult { request, data: None, error: Some("Release check already running.".into()) })));
                                return;
                            }
                            let busy = release_busy.clone();
                            let worker_proxy = proxy.clone();
                            let worker_request = request.clone();
                            let started = std::thread::Builder::new().name("tsugi-release-check".into()).spawn(move || {
                                let result = aiostreams_desktop_core::release_check::check(&root);
                                let message = match result {
                                    Ok(data) => Outbound::TsugiReleaseResult { request: worker_request, data: Some(data), error: None },
                                    Err(error) => Outbound::TsugiReleaseResult { request: worker_request, data: None, error: Some(error.into()) },
                                };
                                busy.store(false, Ordering::Release);
                                let _ = worker_proxy.send_event(UserEvent::Emit(receive_script(&message)));
                            });
                            if started.is_err() {
                                release_busy.store(false, Ordering::Release);
                                send(UserEvent::Emit(receive_script(&Outbound::TsugiReleaseResult { request, data: None, error: Some("Could not start release check.".into()) })));
                            }
                            return;
                        }
                        bridge::Inbound::BackupRequest { request, action } => {
                            use std::sync::atomic::Ordering;
                            if request.is_empty() || request.len() > 128 || !request.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') { return; }
                            let Some(root) = backup_root.clone() else {
                                send(UserEvent::Emit(receive_script(&Outbound::BackupResult { request, data: None, error: Some("Managed backups are unavailable in this desktop session.".into()) })));
                                return;
                            };
                            if backup_busy.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() {
                                send(UserEvent::Emit(receive_script(&Outbound::BackupResult { request, data: None, error: Some("Another managed backup operation is running.".into()) })));
                                return;
                            }
                            let busy = backup_busy.clone();
                            let worker_proxy = proxy.clone();
                            let worker_request = request.clone();
                            let started = std::thread::Builder::new().name("tsugi-backup".into()).spawn(move || {
                                let result = aiostreams_desktop_core::backup_store::execute(&root, action);
                                let message = match result {
                                    Ok(data) => Outbound::BackupResult { request: worker_request, data: Some(data), error: None },
                                    Err(error) => Outbound::BackupResult { request: worker_request, data: None, error: Some(error.into()) },
                                };
                                busy.store(false, Ordering::Release);
                                let _ = worker_proxy.send_event(UserEvent::Emit(receive_script(&message)));
                            });
                            if started.is_err() {
                                backup_busy.store(false, Ordering::Release);
                                send(UserEvent::Emit(receive_script(&Outbound::BackupResult { request, data: None, error: Some("Could not start managed backup operation.".into()) })));
                            }
                            return;
                        }
                        other => other,
                    };
                    #[cfg(windows)]
                    let message = match message {
                        bridge::Inbound::ReadRequest { request, action } => {
                            if let Some(worker) = &reading {
                                worker.request(request, action);
                                return;
                            }
                            bridge::Inbound::ReadRequest { request, action }
                        }
                        other => other,
                    };
                    handle(
                        message, &player, &external, &send, &paths, &updater, &downloads,
                    );
                }
            }
        })
        .with_navigation_handler({
            let app_origin = app_origin.clone();
            move |url| {
                let allowed = allowed_navigation(&url, &app_origin) || url == "http://tsugi-books.localhost/tsugi-books/index.html";
                if !allowed {
                    platform::open_external(&url);
                }
                allowed
            }
        })
        .with_new_window_req_handler({
            let app_origin = app_origin.clone();
            move |url, _| {
                if !allowed_navigation(&url, &app_origin) {
                    platform::open_external(&url);
                }
                NewWindowResponse::Deny
            }
        })
        .with_on_page_load_handler({
            let (player, external, inbox) = (player.clone(), external.clone(), inbox.clone());
            let proxy = proxy.clone();
            move |event, _| {
                if let PageLoadEvent::Started = event {
                    inbox.borrow_mut().page_loading();
                    let _ = proxy.send_event(UserEvent::Pip(Some(false)));
                    // A new page never owns the video the last one started.
                    if let Some(p) = player.borrow().as_ref() {
                        p.stop();
                    }
                    external.close();
                }
            }
        })
        .with_url(start_url);
    #[cfg(windows)]
    let webview = {
        let mut browser_args =
            "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection".to_string();
        if let Some(port) = args.debug_port {
            browser_args.push_str(&format!(" --remote-debugging-port={port}"));
        }
        builder
            .with_additional_browser_args(browser_args)
            .build_as_child(&window)
    };
    #[cfg(not(windows))]
    let webview = builder.build_as_child(&window);
    let webview =
        webview.unwrap_or_else(|e| platform::fatal(&format!("could not start the web view: {e}")));
    #[cfg(windows)]
    window.set_visible(true);
    // Showing the window maximizes it.
    let size = window.inner_size();
    let _ = webview.set_bounds(page_bounds(size));
    video.resize(size.width, size.height);

    let mut fullscreen = false;
    let mut maximized = window.is_maximized();
    let mut remaximize = false;
    let mut pip: Option<Pip> = None;
    let mut save_at: Option<Instant> = None;
    #[cfg(target_os = "macos")]
    let mut exit_at: Option<Instant> = None;
    event_loop.run(move |event, _, flow| {
        if save_at.is_some_and(|at| Instant::now() >= at) {
            save_at = None;
            match &pip {
                Some(small) => small.record(&window, &mut placement),
                None => record(&window, &mut placement),
            }
            placement::save(&data_dir, &placement);
        }
        *flow = save_at.map_or(ControlFlow::Wait, ControlFlow::WaitUntil);
        #[cfg(target_os = "macos")]
        if let Some(at) = exit_at {
            *flow = if Instant::now() >= at {
                ControlFlow::Exit
            } else {
                ControlFlow::WaitUntil(at)
            };
        }
        let emit = |message: Outbound| {
            let _ = webview.evaluate_script(&receive_script(&message));
        };
        match event {
            Event::WindowEvent {
                event: WindowEvent::Resized(size),
                ..
            } => {
                video.resize(size.width, size.height);
                let _ = webview.set_bounds(page_bounds(size));
                let now = window.fullscreen().is_some();
                if now != fullscreen {
                    fullscreen = now;
                    emit(Outbound::Fullscreen { value: now });
                }
                let now = window.is_maximized();
                if now != maximized {
                    maximized = now;
                    emit(Outbound::WindowState { maximized: now });
                }
                #[cfg(target_os = "macos")]
                video.refresh_hdr();
                let at = Instant::now() + SETTLE;
                save_at = Some(at);
                *flow = ControlFlow::WaitUntil(at);
            }
            Event::WindowEvent {
                event: WindowEvent::Moved(_),
                ..
            } => {
                // Another screen may take over the window, with its own EDR headroom.
                #[cfg(target_os = "macos")]
                video.refresh_hdr();
                let at = Instant::now() + SETTLE;
                save_at = Some(at);
                *flow = ControlFlow::WaitUntil(at);
            }
            // Keys go to the page, which a window brought back does not focus.
            Event::WindowEvent {
                event: WindowEvent::Focused(true),
                ..
            } => {
                let _ = webview.focus();
            }
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            }
            | Event::UserEvent(UserEvent::Close) => {
                #[cfg(target_os = "macos")]
                if exit_at.is_some() {
                    return;
                }
                log::info!("closing");
                match &pip {
                    Some(small) => small.record(&window, &mut placement),
                    None => record(&window, &mut placement),
                }
                placement::save(&data_dir, &placement);
                video.shutdown();
                let player = player.borrow_mut().take();
                // mpv's AVFoundation output tears down on the main thread, so the loop runs until it has.
                #[cfg(target_os = "macos")]
                {
                    window.set_visible(false);
                    let proxy = proxy.clone();
                    std::thread::spawn(move || {
                        drop(player);
                        let _ = proxy.send_event(UserEvent::Closed);
                    });
                    external.close();
                    let at = Instant::now() + CLOSE_WAIT;
                    exit_at = Some(at);
                    *flow = ControlFlow::WaitUntil(at);
                }
                #[cfg(not(target_os = "macos"))]
                {
                    #[cfg(windows)]
                    if let Some(worker) = &reading {
                        window.set_visible(false);
                        worker.close();
                    }
                    drop(player);
                    external.close();
                    *flow = ControlFlow::Exit;
                }
            }
            Event::UserEvent(UserEvent::Closed) => *flow = ControlFlow::Exit,
            Event::UserEvent(UserEvent::Emit(script)) => {
                let _ = webview.evaluate_script(&script);
            }
            Event::UserEvent(UserEvent::Fullscreen(value)) => {
                let left = pip::set(&mut pip, false, &window, &mut placement, &mut remaximize);
                if left {
                    placement::save(&data_dir, &placement);
                    emit(Outbound::Pip { value: false });
                }
                // From the small window, a toggle means full screen.
                let value = if left {
                    Some(value.unwrap_or(true))
                } else {
                    value
                };
                set_fullscreen(&window, value, &mut remaximize)
            }
            Event::UserEvent(UserEvent::Pip(value)) => {
                let on = value.unwrap_or(pip.is_none());
                if pip::set(&mut pip, on, &window, &mut placement, &mut remaximize) {
                    placement::save(&data_dir, &placement);
                }
                emit(Outbound::Pip {
                    value: pip.is_some(),
                });
            }
            #[cfg(target_os = "macos")]
            Event::UserEvent(UserEvent::FullscreenLeft) => {
                if pip
                    .as_mut()
                    .is_some_and(|small| small.shrink(&window, &mut placement))
                {
                    placement::save(&data_dir, &placement);
                }
            }
            Event::UserEvent(UserEvent::Minimize) => window.set_minimized(true),
            Event::UserEvent(UserEvent::VideoFrame(frame)) => {
                #[cfg(windows)]
                let scale = platform::page_scale(&webview).unwrap_or(window.scale_factor());
                #[cfg(not(windows))]
                let scale = window.scale_factor();
                video.frame(frame, scale);
            }
            Event::UserEvent(UserEvent::Drag) => {
                let _ = window.drag_window();
            }
            Event::UserEvent(UserEvent::Resize(edge)) => {
                let _ = window.drag_resize_window(direction(edge));
            }
            Event::UserEvent(UserEvent::ToggleMaximize) => {
                if pip.is_none() {
                    window.set_maximized(!window.is_maximized());
                }
            }
            Event::UserEvent(UserEvent::WindowState) => emit(Outbound::WindowState {
                maximized: window.is_maximized(),
            }),
            #[cfg(target_os = "macos")]
            Event::UserEvent(UserEvent::WindowButtons(visible)) => {
                if pip.is_none() {
                    platform::set_window_buttons(&window, visible)
                }
            }
            #[cfg(target_os = "macos")]
            Event::Opened { urls } => {
                for link in urls.iter().filter_map(|u| crate::links::accept(u.as_str())) {
                    if let Some(link) = inbox.borrow_mut().receive(link) {
                        emit(Outbound::Link { url: link });
                    }
                }
            }
            Event::UserEvent(UserEvent::Link(link)) => {
                if let Some(link) = inbox.borrow_mut().receive(link) {
                    emit(Outbound::Link { url: link });
                }
            }
            Event::UserEvent(UserEvent::LinksReady) => {
                for link in inbox.borrow_mut().ready() {
                    emit(Outbound::Link { url: link });
                }
            }
            Event::UserEvent(UserEvent::ChoosePlayer(kind)) => {
                let title = format!("Choose {}", kind.id());
                if let Some(path) = platform::choose_program(&window, &title) {
                    external.set_program(kind, path);
                }
                emit(external.players());
            }
            Event::UserEvent(UserEvent::ChooseDownloadFolder) => {
                if let Some(folder) = platform::choose_folder(&window, "Choose where downloads go")
                {
                    downloads.send(DownloadCommand::SetFolder(folder));
                }
            }
            Event::UserEvent(UserEvent::Sync) => {
                if let Some(p) = player.borrow().as_ref() {
                    p.sync();
                }
                emit(Outbound::Fullscreen { value: fullscreen });
                emit(Outbound::Pip {
                    value: pip.is_some(),
                });
            }
            _ => {}
        }
    });
}
