//! Constrained localhost byte-range transport for the optional Vault engine.
//! The engine receives a random local URL, never the original remote URL.
use std::{
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    sync::{Arc, atomic::{AtomicBool, Ordering}},
    thread::{self, JoinHandle},
    time::Duration,
};

const MAX_FILE: u64 = 256 * 1024 * 1024;
const CHUNK: u64 = 4 * 1024 * 1024;
const MAX_HEADERS: u64 = 8192;
type Result<T> = std::result::Result<T, &'static str>;

fn strong_etag(value: &str) -> bool {
    value.len() >= 2 && value.len() <= 512 && value.starts_with('"') && value.ends_with('"')
        && value.as_bytes()[1..value.len()-1].iter().all(|&b| b == 0x21 || (0x23..=0x7e).contains(&b))
}
fn mime(value: &str) -> Option<String> {
    let value = value.split(';').next()?.trim().to_ascii_lowercase();
    let (kind, subtype) = value.split_once('/')?;
    let valid = |part: &str| !part.is_empty() && part.bytes().all(|b| b.is_ascii_alphanumeric() || b"-+._".contains(&b));
    (value.len() <= 100 && valid(kind) && valid(subtype)).then_some(value)
}
fn header<'a>(response: &'a ureq::http::Response<ureq::Body>, name: &str) -> Option<&'a str> {
    response.headers().get(name)?.to_str().ok()
}
fn identity(response: &ureq::http::Response<ureq::Body>) -> bool {
    header(response,"content-encoding").is_none_or(|value| value.eq_ignore_ascii_case("identity"))
}
fn content_range(value: &str) -> Option<(u64,u64,u64)> {
    let (range, total) = value.strip_prefix("bytes ")?.split_once('/')?;
    let (start,end) = range.split_once('-')?;
    let (start,end,total) = (start.parse().ok()?,end.parse().ok()?,total.parse().ok()?);
    (start <= end && end < total && total <= MAX_FILE).then_some((start,end,total))
}

#[derive(Clone)]
pub struct Source {
    agent: ureq::Agent,
    url: String,
    pub etag: String,
    pub mime: String,
    pub total: u64,
}
impl Source {
    /// Production accepts HTTPS only; loopback HTTP is solely for the fixture client.
    pub fn probe(url: &str, allow_fixture: bool) -> Result<Self> {
        let parsed = url::Url::parse(url).map_err(|_| "Invalid source URL")?;
        if !(parsed.scheme()=="https" || allow_fixture && parsed.scheme()=="http" && parsed.host_str()==Some("127.0.0.1"))
            || !parsed.username().is_empty() || parsed.password().is_some() || parsed.query().is_some() || parsed.fragment().is_some() {
            return Err("Source URL not eligible for range gateway");
        }
        let agent: ureq::Agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(20)))
            .timeout_connect(Some(Duration::from_secs(8))).max_redirects(0).https_only(!allow_fixture)
            .build().into();
        let response = agent.get(url).header("Range","bytes=0-0").header("Accept-Encoding","identity").call()
            .map_err(|_| "Source probe failed")?;
        if response.status()!=206 || !identity(&response) { return Err("Source does not support validated ranges"); }
        let (start,end,total) = header(&response,"content-range").and_then(content_range).ok_or("Invalid source range")?;
        if start!=0 || end!=0 || header(&response,"content-length").and_then(|n| n.parse::<u64>().ok())!=Some(1) {
            return Err("Unexpected source probe length");
        }
        let etag = header(&response,"etag").filter(|s| strong_etag(s)).ok_or("Strong validator required")?.to_owned();
        let mime = header(&response,"content-type").and_then(mime).ok_or("Source MIME unavailable")?;
        let mut bytes=Vec::new();
        response.into_body().into_reader().take(2).read_to_end(&mut bytes).map_err(|_|"Source probe unreadable")?;
        if bytes.len()!=1 { return Err("Source probe body mismatch"); }
        Ok(Self { agent,url:url.to_owned(),etag,mime,total })
    }

    fn range(&self,start:u64,end:u64) -> Result<Vec<u8>> {
        if start>end || end>=self.total || end-start>=CHUNK { return Err("Invalid gateway range"); }
        let length=end-start+1;
        let response=self.agent.get(&self.url).header("Range",format!("bytes={start}-{end}"))
            .header("If-Match",&self.etag).header("If-Range",&self.etag).header("Accept-Encoding","identity")
            .call().map_err(|_|"Source range failed")?;
        if response.status()!=206 || !identity(&response)
            || header(&response,"content-range").and_then(content_range)!=Some((start,end,self.total))
            || header(&response,"etag")!=Some(self.etag.as_str())
            || header(&response,"content-type").and_then(mime).as_deref()!=Some(self.mime.as_str())
            || header(&response,"content-length").and_then(|n|n.parse::<u64>().ok())!=Some(length) {
            return Err("Source range representation changed");
        }
        let mut bytes=Vec::with_capacity(length as usize);
        response.into_body().into_reader().take(length+1).read_to_end(&mut bytes).map_err(|_|"Source range unreadable")?;
        if bytes.len() as u64 != length { return Err("Source range length mismatch"); }
        Ok(bytes)
    }
}

fn requested_range(value: Option<&str>, total:u64) -> Option<(u64,u64)> {
    if total==0 { return None; }
    let Some(value)=value else {return Some((0,total-1));};
    let (start,end)=value.strip_prefix("bytes=")?.split_once('-')?;
    let start:u64=start.parse().ok()?;
    let end=if end.is_empty(){total-1}else{end.parse::<u64>().ok()?.min(total-1)};
    (start<=end && end<total).then_some((start,end))
}
fn reject(stream:&mut TcpStream,status:&str) {
    let _=write!(stream,"HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
}
fn stopped(job:&AtomicBool,shutdown:&AtomicBool)->bool {
    job.load(Ordering::Relaxed)||shutdown.load(Ordering::Relaxed)
}
fn serve(mut stream:TcpStream,source:&Source,path:&str,job:&AtomicBool,shutdown:&AtomicBool) {
    let _=stream.set_read_timeout(Some(Duration::from_secs(2)));
    let _=stream.set_write_timeout(Some(Duration::from_secs(5)));
    let mut first=String::new();
    let mut range=None;
    {
        let mut input=BufReader::new(&mut stream).take(MAX_HEADERS);
        if input.read_line(&mut first).unwrap_or(0)==0 {return;}
        loop {
            let mut line=String::new();
            if input.read_line(&mut line).unwrap_or(0)==0 {return;}
            if line=="\r\n" {break;}
            let Some((name,value))=line.trim_end_matches(['\r','\n']).split_once(':') else{return;};
            let value=value.trim();
            if name.eq_ignore_ascii_case("range") {
                if range.is_some(){return;}
                range=Some(value.to_owned());
            }
            if name.eq_ignore_ascii_case("transfer-encoding") || name.eq_ignore_ascii_case("content-length")&&value!="0" {return;}
        }
    }
    let words:Vec<_>=first.split_ascii_whitespace().collect();
    if words.len()!=3 || words[1]!=path || !["HTTP/1.1","HTTP/1.0"].contains(&words[2]) {
        reject(&mut stream,"404 Not Found");return;
    }
    let head=words[0]=="HEAD";
    if !head&&words[0]!="GET" {reject(&mut stream,"405 Method Not Allowed");return;}
    if stopped(job,shutdown) {reject(&mut stream,"503 Service Unavailable");return;}
    let Some((start,end))=requested_range(range.as_deref(),source.total) else {
        let _=write!(stream,"HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",source.total);return;
    };
    let status=if range.is_some(){"206 Partial Content"}else{"200 OK"};
    let first_end=end.min(start+CHUNK-1);
    let first_bytes=if head{None}else{
        match source.range(start,first_end) {
            Ok(bytes)=>Some(bytes),
            Err(_)=>{reject(&mut stream,"502 Bad Gateway");return;}
        }
    };
    if stopped(job,shutdown) {return;}
    if write!(stream,"HTTP/1.1 {status}\r\nContent-Length: {}\r\nContent-Type: {}\r\nETag: {}\r\nAccept-Ranges: bytes\r\nConnection: close\r\n",end-start+1,source.mime,source.etag).is_err(){return;}
    if range.is_some()&&write!(stream,"Content-Range: bytes {start}-{end}/{}\r\n",source.total).is_err(){return;}
    if stream.write_all(b"\r\n").is_err()||head{return;}
    if let Some(bytes)=first_bytes {if stream.write_all(&bytes).is_err(){return;}}
    let mut at=first_end+1;
    while at<=end&&!stopped(job,shutdown) {
        let last=end.min(at+CHUNK-1);
        let Ok(bytes)=source.range(at,last) else{return;};
        if stopped(job,shutdown)||stream.write_all(&bytes).is_err(){return;}
        at=last+1;
    }
}

pub struct Gateway {
    shutdown:Arc<AtomicBool>,
    listener:Option<JoinHandle<()>>,
    port:u16,
    path:String,
}
impl Gateway {
    pub fn start(source:Source,port:u16,token:&str,job:Arc<AtomicBool>)->Result<Self>{
        if token.len()!=64||!token.bytes().all(|b|b.is_ascii_hexdigit()){return Err("Invalid gateway token");}
        let socket=TcpListener::bind(("127.0.0.1",port)).map_err(|_|"Gateway port unavailable")?;
        let port=socket.local_addr().map_err(|_|"Gateway address unavailable")?.port();
        socket.set_nonblocking(true).map_err(|_|"Gateway listener failed")?;
        let path=format!("/{token}/file");
        let shutdown=Arc::new(AtomicBool::new(false));
        let (quit,route)=(shutdown.clone(),path.clone());
        let listener=thread::Builder::new().name("vault-gateway".into()).spawn(move||{
            let mut workers:Vec<JoinHandle<()>>=Vec::new();
            while !stopped(&job,&quit){
                let mut i=0;
                while i<workers.len(){if workers[i].is_finished(){let _=workers.swap_remove(i).join();}else{i+=1;}}
                match socket.accept(){
                    Ok((stream,_)) if workers.len()<4=>{
                        let (source,route,job,quit)=(source.clone(),route.clone(),job.clone(),quit.clone());
                        if let Ok(worker)=thread::Builder::new().name("vault-range".into()).spawn(move||serve(stream,&source,&route,&job,&quit)){workers.push(worker);}
                    }
                    Ok((_,_))=>{},
                    Err(e) if e.kind()==std::io::ErrorKind::WouldBlock=>thread::sleep(Duration::from_millis(20)),
                    Err(_)=>break,
                }
            }
            for worker in workers {let _=worker.join();}
        }).map_err(|_|"Gateway worker unavailable")?;
        Ok(Self{shutdown,listener:Some(listener),port,path})
    }
    pub fn port(&self)->u16{self.port}
    pub fn url(&self)->String{format!("http://127.0.0.1:{}{}",self.port,self.path)}
}
impl Drop for Gateway{
    fn drop(&mut self){self.shutdown.store(true,Ordering::Relaxed);if let Some(listener)=self.listener.take(){let _=listener.join();}}
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn range_bounds_and_validator_guards(){
        assert_eq!(requested_range(Some("bytes=2-999"),10),Some((2,9)));
        assert_eq!(requested_range(Some("bytes=2-"),10),Some((2,9)));
        for bad in ["bytes=10-","bytes=-2","bytes=1-2,3-4","bytes=5-2","garbage"]{assert!(requested_range(Some(bad),10).is_none());}
        assert!(content_range("bytes 0-1/268435457").is_none());
        assert!(!strong_etag("W/\"weak\""));
        assert!(strong_etag("\"fixture\""));
    }
    #[test]
    fn source_probe_and_changed_range_rejection(){
        let (url,server)=crate::test_http::response_with_headers(206,"application/pdf",vec![1],
            "Content-Range: bytes 0-0/10\r\nETag: \"fixture\"\r\n".into(),||{});
        let source=Source::probe(&url,true).unwrap();
        assert_eq!(source.total,10);
        assert_eq!(source.mime,"application/pdf");
        server.join().unwrap();
        for (tag,good) in [("\"fixture\"",true),("\"changed\"",false)]{
            let (url,server)=crate::test_http::response_with_headers(206,"application/pdf",vec![2,3],
                format!("Content-Range: bytes 1-2/10\r\nETag: {tag}\r\n"),||{});
            let test=Source{url,..source.clone()};
            assert_eq!(test.range(1,2).is_ok(),good);
            let sent=server.join().unwrap().to_ascii_lowercase();
            assert!(sent.contains("if-match: \"fixture\""));
            assert!(sent.contains("range: bytes=1-2"));
        }
    }
}
