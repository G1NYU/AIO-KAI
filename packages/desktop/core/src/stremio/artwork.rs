//! Ephemeral, scoped addon poster capabilities. Configured URLs never cross IPC.
use super::{public_cdn_art,read_bounded,MAX_URL};
use serde_json::Value;
use std::{collections::VecDeque,sync::{Mutex,OnceLock},time::{Duration,Instant}};
use url::{Host,Url};

const MAX_HANDLES:usize=4096;
const TTL:Duration=Duration::from_secs(30*60);
const MAX_IMAGE:usize=3*1024*1024;
struct Entry{token:String,url:Url,origin:Url,created:Instant}
static HANDLES:OnceLock<Mutex<VecDeque<Entry>>>=OnceLock::new();
fn entries()->&'static Mutex<VecDeque<Entry>>{HANDLES.get_or_init(||Mutex::new(VecDeque::new()))}

fn allowed(origin:&Url,raw:&str)->Option<Url>{
    if raw.len()>MAX_URL||raw.chars().any(|c|c.is_control()||c.is_whitespace())||raw.contains('\\'){return None;}
    let url=Url::parse(raw).ok()?;
    let Host::Domain(host)=url.host()? else{return None;};
    if url.scheme()!="https"||!url.username().is_empty()||url.password().is_some()||url.fragment().is_some()||
        !host.contains('.')||host.ends_with(".local")||host.ends_with(".localhost")||host.ends_with('.') {return None;}
    let parts:Vec<_>=url.path_segments()?.collect();
    let own=url.origin()==origin.origin()&&parts.iter().any(|p|matches!(*p,"poster"|"posters"));
    // Only explicitly supported public poster endpoints may cross origins.
    let known=url.port().is_none()&&match host{
        "postersplus.cc"=>url.path()=="/poster",
        "btttr.cc"=>parts.len()==4&&parts[0]=="poster"&&parts[1]=="imdb"&&parts[2].starts_with("poster-")&&parts[3].ends_with(".jpg"),
        "api.ratingposterdb.com"=>parts.len()==4&&parts[2].starts_with("poster-")&&parts[3].ends_with(".jpg"),
        "api.top-posters.com"=>parts.len()==4&&parts[2]=="poster"&&parts[3].ends_with(".jpg"),
        "apiv2.aioratings.com"=>parts.len()==5&&parts[0]=="api"&&parts[4].ends_with(".jpg"),
        _=>false,
    };
    (own||known||public_cdn_art(&Value::String(url.to_string())).is_some()).then_some(url)
}

pub(super) fn register(endpoint:&Url,value:&Value)->Option<String>{
    if public_cdn_art(value).is_some(){return None;}
    let origin=Url::parse(&endpoint.origin().ascii_serialization()).ok()?;
    let url=allowed(&origin,value.as_str()?)?;
    let mut rows=entries().lock().ok()?;
    rows.retain(|entry|entry.created.elapsed()<TTL);
    if let Some(entry)=rows.iter().find(|entry|entry.url==url&&entry.origin==origin){
        return Some(format!("http://tsugi-addon-art.localhost/poster/{}",entry.token));
    }
    let mut bytes=[0u8;16];getrandom::fill(&mut bytes).ok()?;
    let token=bytes.iter().map(|b|format!("{b:02x}")).collect::<String>();
    while rows.len()>=MAX_HANDLES{rows.pop_front();}
    rows.push_back(Entry{token:token.clone(),url,origin,created:Instant::now()});
    Some(format!("http://tsugi-addon-art.localhost/poster/{token}"))
}
pub(super) fn clear(){if let Ok(mut rows)=entries().lock(){rows.clear();}}

fn raster_mime(bytes:&[u8])->Option<&'static str>{
    if bytes.starts_with(&[0xff,0xd8,0xff]){Some("image/jpeg")}
    else if bytes.starts_with(b"\x89PNG\r\n\x1a\n"){Some("image/png")}
    else if bytes.starts_with(b"RIFF")&&bytes.get(8..12)==Some(b"WEBP".as_slice()){Some("image/webp")}
    else{None}
}
pub fn load(token:&str)->Option<(&'static str,Vec<u8>)>{
    if token.len()!=32||!token.bytes().all(|b|b.is_ascii_hexdigit()){return None;}
    let (mut url,origin)={
        let mut rows=entries().lock().ok()?;
        rows.retain(|entry|entry.created.elapsed()<TTL);
        let entry=rows.iter().find(|entry|entry.token==token)?;
        (entry.url.clone(),entry.origin.clone())
    };
    let started=Instant::now();
    for _ in 0..3{
        let remaining=Duration::from_secs(8).saturating_sub(started.elapsed());
        if remaining.is_zero(){return None;}
        let agent:ureq::Agent=ureq::Agent::config_builder().timeout_global(Some(remaining)).max_redirects(0).build().into();
        let response=agent.get(url.as_str()).header("Accept","image/jpeg,image/png,image/webp").call().ok()?;
        if response.status().is_redirection(){
            let location=response.headers().get("location")?.to_str().ok()?;
            url=allowed(&origin,url.join(location).ok()?.as_str())?;
            continue;
        }
        if response.status()!=200{return None;}
        let bytes=read_bounded(response.into_body().into_reader(),MAX_IMAGE).ok()?;
        return Some((raster_mime(&bytes)?,bytes));
    }
    None
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn same_origin_proxy_and_known_custom_endpoints_remain_private(){
        let endpoint=Url::parse("https://addon.example/config/manifest.json").unwrap();
        let raw="https://addon.example/poster/anime/mal:12?token=synthetic&fallback=https%3A%2F%2Fimage.tmdb.org%2Ft%2Fp%2Fw500%2Fabc.jpg";
        let cap=register(&endpoint,&serde_json::json!(raw)).unwrap();
        assert!(cap.starts_with("http://tsugi-addon-art.localhost/poster/"));
        assert!(!cap.contains("synthetic")&&!cap.contains("addon.example"));
        assert!(allowed(&endpoint,"https://postersplus.cc/poster?imdb_id=tt123").is_some());
        for raw in ["https://other.example/poster/tt123","https://addon.example/api/config","https://addon.example.evil.test/poster/tt123","https://127.0.0.1/poster/tt123","https://u:p@addon.example/poster/tt123","http://addon.example/poster/tt123","https://api.ratingposterdb.com/a/isValid"]{
            assert!(allowed(&endpoint,raw).is_none());
        }
        assert!(load("not-a-handle").is_none());
        assert!(raster_mime(b"<svg/>").is_none());
        assert_eq!(raster_mime(b"\xff\xd8\xff"),Some("image/jpeg"));
    }
}
