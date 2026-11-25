//! TorBox cloud jobs; the API key is never persisted or echoed to the page.
use crate::bridge::Outbound;
use serde_json::{Value, json};
use std::{io::Read, sync::mpsc, thread, time::Duration};

const BASE: &str = "https://api.torbox.app/v1/api/webdl/";
const LIMIT: u64 = 4 * 1024 * 1024;
type Reply = Result<Value, &'static str>;

fn key_valid(key: &str) -> bool {
    !key.is_empty() && key.len() <= 512 && key.bytes().all(|b| b.is_ascii_graphic())
}
fn link(value: &str) -> Result<String, &'static str> {
    let url = url::Url::parse(value.trim()).map_err(|_| "link")?;
    if url.scheme() != "https" || url.host_str().is_none() || !url.username().is_empty() ||
        url.password().is_some() || url.fragment().is_some() || url.as_str().len() > 8192 {
        return Err("link");
    }
    Ok(url.into())
}
fn request(agent: &ureq::Agent, key: &str, submit: Option<&str>) -> Reply {
    request_at(agent, BASE, key, submit)
}
fn request_at(agent: &ureq::Agent, base: &str, key: &str, submit: Option<&str>) -> Reply {
    let auth = format!("Bearer {key}");
    let response = if let Some(value) = submit {
        let url = link(value)?;
        // URL serialization cannot contain literal CR/LF; boundary is not
        // accepted inside the value, preventing form field injection.
        const BOUNDARY: &str = "tsugi-form-7e2bd92fa44";
        if url.contains(BOUNDARY) { return Err("link"); }
        let body = format!("--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"link\"\r\n\r\n{url}\r\n--{BOUNDARY}--\r\n");
        agent.post(format!("{base}createwebdownload"))
            .header("Authorization", &auth).header("Accept", "application/json")
            .header("Content-Type", format!("multipart/form-data; boundary={BOUNDARY}"))
            .send(body)
    } else {
        agent.get(format!("{base}mylist?limit=100&files=false"))
            .header("Authorization", &auth).header("Accept", "application/json").call()
    };
    let response = response.map_err(|e| match e {
        ureq::Error::StatusCode(401 | 403) => "auth",
        ureq::Error::StatusCode(429) => "rate",
        ureq::Error::StatusCode(_) => "request",
        _ => "network",
    })?;
    if response.status() != 200 { return Err("request"); }
    let mut bytes = Vec::new();
    response.into_body().into_reader().take(LIMIT + 1).read_to_end(&mut bytes).map_err(|_| "network")?;
    if bytes.len() as u64 > LIMIT { return Err("request"); }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| "request")?;
    if value["success"] != true { return Err("request"); }
    if submit.is_some() { return Ok(json!({ "connected": true })); }
    let items = value["data"].as_array().ok_or("request")?;
    // Return only fields needed for the account's list; never raw provider responses.
    let rows: Vec<Value> = items.iter().take(100).filter_map(|item| {
        let id = item["id"].as_u64()?;
        if id > 9_007_199_254_740_991 { return None; }
        Some(json!({"id":id, "name":item["name"].as_str().unwrap_or("").chars().take(300).collect::<String>(),
            "state":item["download_state"].as_str().unwrap_or("").chars().take(80).collect::<String>(),
            "finished":item["download_finished"].as_bool().unwrap_or(false)}))
    }).collect();
    Ok(json!({"connected":true,"items":rows}))
}

pub struct Worker(mpsc::SyncSender<(String,String,String)>);
impl Worker {
    pub fn start(emit: impl Fn(Outbound) + Send + 'static) -> Self {
        let (tx, rx) = mpsc::sync_channel::<(String,String,String)>(2);
        thread::spawn(move || {
            let agent: ureq::Agent = ureq::Agent::config_builder()
                .timeout_global(Some(Duration::from_secs(25))).max_redirects(0).build().into();
            let mut key = String::new();
            while let Ok((id, operation, value)) = rx.recv() {
                let result = match operation.as_str() {
                    "status" => Ok(json!({"connected":!key.is_empty()})),
                    "disconnect" => { key.clear(); Ok(json!({"connected":false,"items":[]})) },
                    "connect" if key_valid(value.trim()) => {
                        let candidate = value.trim();
                        match request(&agent,candidate,None) {
                            Ok(data) => { key = candidate.to_owned(); Ok(data) },
                            Err(error) => Err(error),
                        }
                    },
                    "connect" => Err("auth"),
                    "list" if !key.is_empty() => request(&agent,&key,None),
                    "submit" if !key.is_empty() => request(&agent,&key,Some(&value)),
                    "list" | "submit" => Err("auth"),
                    _ => Err("request"),
                };
                if matches!(result, Err("auth")) && operation != "connect" { key.clear(); }
                let (data,error) = match result { Ok(v)=>(Some(v),None), Err(e)=>(None,Some(e.to_owned())) };
                emit(Outbound::TorboxResult { request:id, data, error });
            }
        });
        Self(tx)
    }
    pub fn request(&self, request: String, operation: String, value: String) -> bool {
        self.0.try_send((request,operation,value)).is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn test_agent() -> ureq::Agent {
        ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(12))).max_redirects(0).build().into()
    }
    #[test]
    fn native_http_list_and_multipart_submission() {
        let (base, server) = crate::test_http::response(200, "application/json", br#"{"success":true,"data":[{"id":42,"name":"fixture","download_finished":true,"download_state":"completed","private":"do not return"}]}"#.to_vec());
        let result = request_at(&test_agent(), &base, "fixture-key", None).unwrap();
        let sent = server.join().unwrap();
        assert!(sent.starts_with("GET /mylist?limit=100&files=false "));
        assert!(sent.to_ascii_lowercase().contains("authorization: bearer fixture-key"));
        assert_eq!(result["items"][0]["id"], 42);
        assert_eq!(result["items"][0]["finished"], true);
        assert!(result["items"][0].get("private").is_none());
        let (base, server) = crate::test_http::response(200, "application/json", br#"{"success":true,"data":{"id":43}}"#.to_vec());
        assert!(request_at(&test_agent(), &base, "fixture-key", Some("https://example.org/book.epub")).is_ok());
        let sent = server.join().unwrap();
        assert!(sent.starts_with("POST /createwebdownload "));
        assert!(sent.to_ascii_lowercase().contains("content-type: multipart/form-data; boundary="));
        assert!(sent.contains("name=\"link\"\r\n\r\nhttps://example.org/book.epub\r\n"));
    }
    #[test]
    fn native_http_error_classification() {
        for (status, expected) in [(403,"auth"),(429,"rate"),(500,"request")] {
            let (base, server) = crate::test_http::response(status, "application/json", b"{}".to_vec());
            assert_eq!(request_at(&test_agent(),&base,"fixture-key",None),Err(expected));
            server.join().unwrap();
        }
    }
    #[test]
    #[ignore = "Requires live TorBox network access; uses deliberately invalid authentication, never creates a job"]
    fn live_torbox_rejects_invalid_authentication() {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(25))).max_redirects(0).build().into();
        assert_eq!(request(&agent,"tsugi-invalid-public-probe",None),Err("auth"),
            "Expected real TorBox authentication rejection, not a mock or a transport failure");
    }
    #[test]
    fn rejects_unsafe_links_and_keys() {
        assert!(key_valid("fixture-key"));
        assert!(!key_valid("key\r\n"));
        assert!(link("https://example.org/book.epub").is_ok());
        for bad in ["file:///book.epub","http://example.org/a","https://user:pass@example.org/a","https://example.org/a#secret"] {
            assert!(link(bad).is_err());
        }
    }
}
