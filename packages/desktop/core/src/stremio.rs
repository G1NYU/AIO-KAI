//! Direct Stremio HTTP transport contract. The caller owns the explicitly
//! reviewed endpoint; no addon response may substitute another request host.
//! Configured paths and queries can contain credentials: Endpoint is neither
//! Debug nor Serialize, and network errors are reduced to fixed codes.
use serde::Deserialize;
use serde_json::Value;
use std::{collections::{BTreeMap, BTreeSet}, io::Read, time::Duration};
use url::{Host, Url};

pub mod registry;
mod items;

const MAX_URL: usize = 16 * 1024;
const MANIFEST_LIMIT: usize = 512 * 1024;
const CATALOG_LIMIT: usize = 2 * 1024 * 1024;
const MAX_CATALOG_ROWS: usize = 500;
const MAX_SKIP: u32 = 100_000;
type Result<T> = std::result::Result<T, &'static str>;

fn text_valid(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.len() <= max && !value.chars().any(char::is_control)
}
fn type_valid(value: &str) -> bool {
    text_valid(value, 32) && value.split('.').all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'))
}
fn id_valid(value: &str) -> bool {
    text_valid(value, 512) && !matches!(value, "." | "..") && !value.contains(['/', '\\'])
}
fn encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    const HEX: &[u8] = b"0123456789ABCDEF";
    for b in value.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(char::from(b));
        } else {
            out.push('%');
            out.push(char::from(HEX[(b >> 4) as usize]));
            out.push(char::from(HEX[(b & 15) as usize]));
        }
    }
    out
}

#[derive(Clone)]
pub struct Endpoint(Url);
impl Endpoint {
    /// Initial support is explicit HTTPS HTTP-transport manifests only.
    /// A Stremio install link is normalized to HTTPS, not followed externally.
    /// No redirects, URL userinfo, fragments, IP literals or legacy transport.
    /// This is not a DNS/IP trust boundary; users must trust the chosen origin.
    pub fn parse(input: &str) -> Result<Self> {
        let raw = input.trim();
        if raw.len() > MAX_URL || raw.chars().any(|c| c.is_control() || c.is_whitespace()) || raw.contains('\\') {
            return Err("invalid-endpoint");
        }
        let raw = raw.strip_prefix("stremio://").map(|s| format!("https://{s}")).unwrap_or_else(|| raw.to_owned());
        let url = Url::parse(&raw).map_err(|_| "invalid-endpoint")?;
        let Some(Host::Domain(host)) = url.host() else { return Err("invalid-endpoint"); };
        let host = host.trim_end_matches('.');
        if url.scheme() != "https" || !host.contains('.') || host.ends_with(".localhost") ||
            host.ends_with(".local") || host == "localhost" || url.fragment().is_some() ||
            !url.username().is_empty() || url.password().is_some() ||
            !url.path().ends_with("/manifest.json") || url.as_str().len() > MAX_URL {
            return Err("invalid-endpoint");
        }
        Ok(Self(url))
    }

    fn resource_url(&self, resource: &str, kind: &str, id: &str, extras: &BTreeMap<String, String>) -> Result<Url> {
        if !type_valid(kind) || !id_valid(id) || extras.len() > 16 { return Err("invalid-resource"); }
        let base = self.0.path().strip_suffix("/manifest.json").ok_or("invalid-endpoint")?;
        let mut path = format!("{base}/{resource}/{kind}/{}", encode(id));
        if !extras.is_empty() {
            path.push('/');
            let pairs: Vec<_> = extras.iter().map(|(key, value)| format!("{}={}", encode(key), encode(value))).collect();
            path.push_str(&pairs.join("&"));
        }
        path.push_str(".json");
        let mut url = self.0.clone();
        url.set_path(&path);
        if url.as_str().len() > MAX_URL { return Err("invalid-resource"); }
        Ok(url)
    }

    pub fn manifest(&self) -> Result<Manifest> {
        let bytes = fetch(&self.0, MANIFEST_LIMIT)?;
        Manifest::parse(&bytes)
    }

    pub fn catalog(&self, manifest: &Manifest, kind: &str, id: &str, extras: &BTreeMap<String, String>) -> Result<CatalogPage> {
        let (catalog, skip) = manifest.catalog_request(kind, id, extras)?;
        let url = self.resource_url("catalog", kind, id, extras)?;
        let bytes = fetch(&url, CATALOG_LIMIT)?;
        CatalogPage::parse(&bytes, kind, skip, catalog.extra.iter().any(|e| e.name == "skip"))
    }

    /// Build a request only for a declared metadata, stream or subtitle
    /// resource, preserving the exact video or metadata ID. No tracking,
    /// arbitrary resource strings or automatically followed provider URLs.
    pub fn item_url(&self, manifest: &Manifest, resource: ItemResource, kind: &str, id: &str) -> Result<Url> {
        if !manifest.supports(resource, kind, id) { return Err("unsupported-resource"); }
        self.resource_url(resource.name(), kind, id, &BTreeMap::new())
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ItemResource { Meta, Stream, Subtitles }
impl ItemResource {
    fn name(self) -> &'static str {
        match self { Self::Meta => "meta", Self::Stream => "stream", Self::Subtitles => "subtitles" }
    }
}

#[derive(Clone, Deserialize, serde::Serialize)]
#[serde(untagged)]
enum Declaration {
    Name(String),
    Detailed { name: String, types: Vec<String>, #[serde(default, rename="idPrefixes")] id_prefixes: Vec<String> },
}
#[derive(Clone, Deserialize, serde::Serialize)]
#[serde(rename_all="camelCase")]
pub struct CatalogExtra {
    pub name: String,
    #[serde(default)]
    pub is_required: bool,
    #[serde(default)]
    pub options: Vec<String>,
    #[serde(default)]
    pub options_limit: Option<u32>,
}
#[derive(Clone, Deserialize, serde::Serialize)]
pub struct Catalog {
    #[serde(rename="type")]
    pub kind: String,
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub extra: Vec<CatalogExtra>,
}
#[derive(Default, Clone, Deserialize, serde::Serialize)]
#[serde(rename_all="camelCase")]
pub struct BehaviorHints {
    #[serde(default)]
    pub configurable: bool,
    #[serde(default)]
    pub configuration_required: bool,
    #[serde(default)]
    pub p2p: bool,
    #[serde(default)]
    pub adult: bool,
}
#[derive(Clone, Deserialize, serde::Serialize)]
#[serde(rename_all="camelCase")]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    pub types: Vec<String>,
    #[serde(default)]
    id_prefixes: Vec<String>,
    resources: Vec<Declaration>,
    #[serde(default)]
    pub catalogs: Vec<Catalog>,
    #[serde(default)]
    pub behavior_hints: BehaviorHints,
}

fn types_valid(types: &[String]) -> bool {
    types.len() <= 32 && types.iter().all(|value| type_valid(value))
}
fn prefixes_valid(prefixes: &[String]) -> bool {
    prefixes.len() <= 64 && prefixes.iter().all(|value| text_valid(value, 128))
}
impl Manifest {
    pub fn parse(bytes: &[u8]) -> Result<Self> {
        if bytes.is_empty() || bytes.len() > MANIFEST_LIMIT { return Err("manifest-limit"); }
        let mut m: Self = serde_json::from_slice(bytes).map_err(|_| "invalid-manifest")?;
        if !id_valid(&m.id) || !text_valid(&m.name, 256) || !text_valid(&m.version, 64) ||
            m.description.len() > 4096 || m.types.is_empty() || !types_valid(&m.types) ||
            !prefixes_valid(&m.id_prefixes) || m.resources.is_empty() || m.resources.len() > 64 ||
            m.catalogs.len() > 128 {
            return Err("invalid-manifest");
        }
        for resource in &m.resources {
            match resource {
                Declaration::Name(name) if type_valid(name) => {},
                Declaration::Detailed { name, types, id_prefixes } if type_valid(name) &&
                    types_valid(types) && prefixes_valid(id_prefixes) => {},
                _ => return Err("invalid-manifest"),
            }
        }
        let mut catalog_ids = BTreeSet::new();
        for c in &mut m.catalogs {
            if !type_valid(&c.kind) || !id_valid(&c.id) || c.extra.len() > 16 ||
                !catalog_ids.insert((c.kind.clone(), c.id.clone())) { return Err("invalid-manifest"); }
            if c.name.trim().is_empty() { c.name = c.id.clone(); }
            if !text_valid(&c.name, 256) { return Err("invalid-manifest"); }
            let mut names = BTreeSet::new();
            for e in &c.extra {
                if !type_valid(&e.name) || !names.insert(e.name.clone()) || e.options.len() > 256 ||
                    e.options.iter().any(|o| !text_valid(o, 512)) || e.options_limit == Some(0) {
                    return Err("invalid-manifest");
                }
            }
        }
        Ok(m)
    }

    /// String resources inherit the manifest defaults. Object declarations
    /// override types and prefixes; omitted object prefixes mean unrestricted,
    /// as specified by the official SDK. Catalog IDs are not prefix-filtered.
    pub fn supports(&self, resource: ItemResource, kind: &str, id: &str) -> bool {
        if self.behavior_hints.configuration_required || !type_valid(kind) || !id_valid(id) { return false; }
        self.resources.iter().any(|r| {
            let (name, types, prefixes) = match r {
                Declaration::Name(name) => (name, &self.types, &self.id_prefixes),
                Declaration::Detailed { name, types, id_prefixes } => (name, types, id_prefixes),
            };
            name == resource.name() && types.iter().any(|t| t == kind) &&
                (prefixes.is_empty() || prefixes.iter().any(|p| id.starts_with(p)))
        })
    }
    pub fn declared_catalogs(&self) -> impl Iterator<Item = &Catalog> {
        self.catalogs.iter().filter(|c| !self.behavior_hints.configuration_required &&
            self.resources.iter().any(|r| match r {
                Declaration::Name(name) => name == "catalog" && self.types.contains(&c.kind),
                Declaration::Detailed { name, types, .. } => name == "catalog" && types.contains(&c.kind),
            }))
    }
    fn catalog_request(&self, kind: &str, id: &str, extras: &BTreeMap<String, String>) -> Result<(&Catalog, u32)> {
        let catalog = self.declared_catalogs().find(|c| c.kind == kind && c.id == id).ok_or("unsupported-catalog")?;
        if extras.len() > 16 { return Err("invalid-extras"); }
        for (key, value) in extras {
            let extra = catalog.extra.iter().find(|e| &e.name == key).ok_or("invalid-extras")?;
            if !text_valid(value, 512) || (!extra.options.is_empty() && !extra.options.contains(value)) {
                return Err("invalid-extras");
            }
        }
        if catalog.extra.iter().any(|e| e.is_required && !extras.contains_key(&e.name)) {
            return Err("required-extra");
        }
        let skip = match extras.get("skip") {
            Some(value) => {
                let n = value.parse::<u32>().map_err(|_| "invalid-extras")?;
                if n > MAX_SKIP || n.to_string() != *value { return Err("invalid-extras"); }
                n
            }
            None => 0,
        };
        Ok((catalog, skip))
    }
}

// Conventional public artwork paths only. Arbitrary addon image URLs can
// contain credentials or direct the renderer to a private host.
fn public_poster(value: &Value) -> Option<String> {
    // AIOMetadata artwork proxies can embed a public fallback and a private
    // token. Never return the configured proxy URL or its credentials.
    let raw=value.as_str()?;
    if raw.len()<=MAX_URL {
        if let Ok(url)=Url::parse(raw) {
            if url.scheme()=="https" && url.username().is_empty() && url.password().is_none() &&
                url.path_segments().is_some_and(|mut p|p.any(|segment|matches!(segment,"poster"|"background"|"logo"|"landscape"|"thumbnail"))) {
                if let Some((_,fallback))=url.query_pairs().find(|(key,_)|key=="fallback") {
                    if let Some(art)=public_cdn_art(&Value::String(fallback.into_owned())){return Some(art);}
                }
            }
        }
    }
    public_cdn_art(value)
}
fn public_cdn_art(value: &Value) -> Option<String> {
    let raw=value.as_str()?;
    if raw.len()>512 || raw.chars().any(|c|c.is_control()||c.is_whitespace()) || raw.contains('\\'){return None;}
    let url=Url::parse(raw).ok()?;
    if url.scheme()!="https"||url.port().is_some()||!url.username().is_empty()||url.password().is_some()||
        url.query().is_some()||url.fragment().is_some(){return None;}
    let parts:Vec<_>=url.path_segments()?.collect();
    let safe_file=|s:&str|{
        let Some((stem,ext))=s.rsplit_once('.')else{return false;};
        !stem.is_empty()&&stem.len()<=80&&stem.bytes().all(|b|b.is_ascii_alphanumeric()||matches!(b,b'_'|b'-'))&&
            matches!(ext,"jpg"|"jpeg"|"png"|"webp")
    };
    let digits=|s:&str|!s.is_empty()&&s.len()<=12&&s.bytes().all(|b|b.is_ascii_digit());
    let valid=match (url.host_str()?,parts.as_slice()){
        ("image.tmdb.org",["t","p",size,file])=>matches!(*size,"w45"|"w92"|"w154"|"w185"|"w300"|"w342"|"w500"|"w780"|"w1280"|"w600_and_h900_bestv2"|"original")&&safe_file(file),
        ("images.metahub.space",["poster"|"background",size,id,"img"])=>matches!(*size,"small"|"medium"|"large")&&id.strip_prefix("tt").is_some_and(digits),
        ("cdn.myanimelist.net",["images","anime",folder,file])=>digits(folder)&&safe_file(file),
        ("media.kitsu.io",["anime","poster_images",id,file])=>digits(id)&&safe_file(file),
        _=>false
    };
    valid.then(||url.to_string())
}
pub struct CatalogItem {
    pub kind: String,
    pub id: String,
    pub name: String,
    pub poster: Option<String>,
}
pub struct CatalogPage {
    pub items: Vec<CatalogItem>,
    pub source_count: usize,
    pub next_skip: Option<u32>,
}
impl CatalogPage {
    fn parse(bytes: &[u8], kind: &str, skip: u32, supports_skip: bool) -> Result<Self> {
        if bytes.is_empty() || bytes.len() > CATALOG_LIMIT { return Err("catalog-limit"); }
        let payload: Value = serde_json::from_slice(bytes).map_err(|_| "invalid-catalog")?;
        let metas = payload["metas"].as_array().ok_or("invalid-catalog")?;
        if metas.len() > MAX_CATALOG_ROWS { return Err("catalog-limit"); }
        let mut seen = BTreeSet::new();
        let items = metas.iter().filter_map(|row| {
            let id = row["id"].as_str()?;
            let name = row["name"].as_str()?;
            if row["type"].as_str()? != kind || !id_valid(id) || !text_valid(name, 512) ||
                !seen.insert(id) { return None; }
            let imdb = [row["imdb_id"].as_str(),row["imdbId"].as_str(),Some(id)].into_iter().flatten()
                .find(|id|id.strip_prefix("tt").is_some_and(|digits| !digits.is_empty() && digits.len()<=12 && digits.bytes().all(|b|b.is_ascii_digit())));
            let poster=public_poster(&row["poster"]).or_else(||imdb.map(|id|format!("https://images.metahub.space/poster/medium/{id}/img")));
            Some(CatalogItem { kind: kind.to_owned(), id: id.to_owned(), name: name.to_owned(), poster })
        }).collect();
        // Invalid/duplicate sibling rows still count toward the source offset.
        // No guessed fixed page length or cross-provider cursor.
        let next_skip = supports_skip.then_some(()).filter(|_| !metas.is_empty())
            .and_then(|_| skip.checked_add(metas.len() as u32)).filter(|n| *n <= MAX_SKIP);
        Ok(Self { items, source_count: metas.len(), next_skip })
    }
}

fn read_bounded(mut reader: impl Read, limit: usize) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    reader.by_ref().take(limit as u64 + 1).read_to_end(&mut bytes).map_err(|_| "network")?;
    if bytes.len() > limit { return Err("response-limit"); }
    Ok(bytes)
}

fn fetch(url: &Url, limit: usize) -> Result<Vec<u8>> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(20))).max_redirects(0).build().into();
    let response = agent.get(url.as_str()).header("Accept", "application/json").call().map_err(|error| match error {
        ureq::Error::StatusCode(401 | 403) => "auth",
        ureq::Error::StatusCode(429) => "rate",
        ureq::Error::StatusCode(_) => "request",
        _ => "network",
    })?;
    if response.status() != 200 { return Err("request"); }
    read_bounded(response.into_body().into_reader(), limit)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn manifest() -> Manifest {
        Manifest::parse(&serde_json::to_vec(&json!({
            "id":"test.fixture","name":"Fixture","version":"1.0.0","types":["movie","series"],
            "idPrefixes":["tt"],"resources":["catalog","meta",{"name":"stream","types":["series"]},
                {"name":"subtitles","types":["movie"],"idPrefixes":["imdb:"]},"player"],
            "catalogs":[{"type":"movie","id":"top","name":"Top","extra":[{"name":"skip"},{"name":"genre","options":["Science Fiction"]}]},
                {"type":"movie","id":"search","extra":[{"name":"search","isRequired":true},{"name":"skip"}]}]
        })).unwrap()).unwrap()
    }
    #[test]
    fn configured_transport_preserves_path_and_query_with_encoded_exact_ids() {
        let endpoint = Endpoint::parse("stremio://example.org/config%2Fprivate/manifest.json?token=fixture%2Bkey").unwrap();
        let url = endpoint.item_url(&manifest(), ItemResource::Stream, "series", "custom:42:1:2").unwrap();
        assert_eq!(url.as_str(), "https://example.org/config%2Fprivate/stream/series/custom%3A42%3A1%3A2.json?token=fixture%2Bkey");
        let extras = BTreeMap::from([("search".into(), "space & science + 日本語".into()), ("skip".into(), "20".into())]);
        manifest().catalog_request("movie","search",&extras).unwrap();
        let url = endpoint.resource_url("catalog","movie","search",&extras).unwrap();
        assert_eq!(url.path(), "/config%2Fprivate/catalog/movie/search/search=space%20%26%20science%20%2B%20%E6%97%A5%E6%9C%AC%E8%AA%9E&skip=20.json");
        assert_eq!(url.query(), Some("token=fixture%2Bkey"));
    }
    #[test]
    fn endpoint_is_explicit_https_manifest_and_never_accepts_userinfo_or_other_transports() {
        for input in ["http://example.org/manifest.json","https://example.org/stremio/v1","ipfs://example.org/manifest.json",
            "https://user:secret@example.org/manifest.json","https://example.org/manifest.json#x","https://127.0.0.1/manifest.json",
            "https://[::1]/manifest.json","https://foo.local/manifest.json","https://foo.localhost/manifest.json",
            "https://example.org/a\\manifest.json","https://example.org/manifest.json\n?x=y"] {
            assert!(Endpoint::parse(input).is_err(), "{input}");
        }
        assert!(Endpoint::parse("https://example.org/manifest.json").is_ok());
    }
    #[test]
    fn string_defaults_and_object_overrides_follow_protocol() {
        let m = manifest();
        assert!(m.supports(ItemResource::Meta,"movie","tt123"));
        assert!(!m.supports(ItemResource::Meta,"movie","custom:1"));
        assert!(m.supports(ItemResource::Stream,"series","custom:1:2:3"));
        assert!(!m.supports(ItemResource::Stream,"movie","tt123"));
        assert!(m.supports(ItemResource::Subtitles,"movie","imdb:123"));
        assert!(!m.supports(ItemResource::Subtitles,"movie","tt123"));
        assert!(!m.supports(ItemResource::Stream,"series",".."));
        assert!(!m.supports(ItemResource::Stream,"series","a/b"));
        assert_eq!(m.declared_catalogs().count(),2);
    }
    #[test]
    fn catalogs_enforce_declared_extras_and_required_search() {
        let m = manifest();
        assert!(m.catalog_request("movie","top",&BTreeMap::new()).is_ok());
        assert!(m.catalog_request("movie","search",&BTreeMap::new()).is_err());
        assert!(m.catalog_request("series","top",&BTreeMap::new()).is_err());
        for (key,value) in [("search","query"),("genre","Drama"),("skip","-1"),("skip","0001"),("skip","100001"),("unknown","value")] {
            assert!(m.catalog_request("movie","top",&BTreeMap::from([(key.into(),value.into())])).is_err());
        }
        let (_,skip) = m.catalog_request("movie","top",&BTreeMap::from([("genre".into(),"Science Fiction".into()),("skip".into(),"40".into())])).unwrap();
        assert_eq!(skip,40);
    }
    #[test]
    fn configuration_required_does_not_enable_any_resource() {
        let mut m = manifest();
        m.behavior_hints.configuration_required = true;
        assert_eq!(m.declared_catalogs().count(),0);
        assert!(!m.supports(ItemResource::Meta,"movie","tt123"));
    }
    #[test]
    fn pagination_counts_raw_rows_and_keeps_only_exact_valid_titles() {
        let bytes = serde_json::to_vec(&json!({"metas":[
            {"id":"tt1","type":"movie","name":"First"},
            {"id":"tt1","type":"movie","name":"Duplicate"},
            {"id":"tt2","type":"series","name":"Wrong type"},
            {"id":"tt3","type":"movie","name":"Second"},
            {"id":"tt4","type":"movie"}
        ]})).unwrap();
        let page = CatalogPage::parse(&bytes,"movie",40,true).unwrap();
        assert_eq!(page.source_count,5);
        assert_eq!(page.next_skip,Some(45));
        assert_eq!(page.items.iter().map(|item|item.id.as_str()).collect::<Vec<_>>(),vec!["tt1","tt3"]);
        assert_eq!(CatalogPage::parse(&bytes,"movie",40,false).unwrap().next_skip,None);
        assert_eq!(CatalogPage::parse(br#"{"metas":[]}"#,"movie",45,true).unwrap().next_skip,None);
        assert_eq!(CatalogPage::parse(&bytes,"movie",MAX_SKIP,true).unwrap().next_skip,None);
    }
    #[test]
    fn actual_http_fetch_is_bounded_and_does_not_follow_redirects() {
        let (base, server) = crate::test_http::response(200, "application/json", b"{}".to_vec());
        let url = Url::parse(&format!("{base}config/manifest.json?key=fixture")).unwrap();
        assert_eq!(fetch(&url, 2).unwrap(),b"{}");
        let sent = server.join().unwrap();
        assert!(sent.starts_with("GET /config/manifest.json?key=fixture "));
        assert!(sent.to_ascii_lowercase().contains("accept: application/json"));
        for (status,expected) in [(403,"auth"),(429,"rate"),(500,"request")] {
            let (base,server) = crate::test_http::response(status,"application/json",b"{}".to_vec());
            assert_eq!(fetch(&Url::parse(&base).unwrap(),32),Err(expected));
            server.join().unwrap();
        }
        let (base,server) = crate::test_http::response(200,"application/json",b"12345".to_vec());
        assert_eq!(fetch(&Url::parse(&base).unwrap(),4),Err("response-limit"));
        server.join().unwrap();
        let (base,server) = crate::test_http::response_with_headers(302,"text/plain",Vec::new(),
            "Location: https://example.invalid/private\r\n".into(),||{});
        assert_eq!(fetch(&Url::parse(&base).unwrap(),32),Err("request"));
        server.join().unwrap();
    }
    #[test]
    fn catalogue_posters_only_expose_public_cdn_paths(){
        assert_eq!(public_poster(&json!("https://addon.example/poster/movie/tt123?key=private-fixture&fallback=https%3A%2F%2Fimage.tmdb.org%2Ft%2Fp%2Fw500%2Fabc.jpg")).as_deref(),Some("https://image.tmdb.org/t/p/w500/abc.jpg"));
        assert!(public_poster(&json!("https://addon.example/poster/movie/tt123?fallback=https%3A%2F%2Fprivate.example%2Fsecret.jpg")).is_none());
        let page=CatalogPage::parse(br#"{"metas":[{"id":"tt123","type":"movie","name":"Film","poster":"https://image.tmdb.org/t/p/w342/abc123.jpg"},{"id":"tt456","type":"movie","name":"Private","poster":"https://image.tmdb.org/t/p/w342/abc.jpg?token=private-fixture"},{"id":"tt789","type":"movie","name":"Unknown","poster":"https://example.org/config/private-fixture.jpg"}]}"#,"movie",0,false).unwrap();
        assert_eq!(page.items[0].poster.as_deref(),Some("https://image.tmdb.org/t/p/w342/abc123.jpg"));
        assert_eq!(page.items[1].poster.as_deref(),Some("https://images.metahub.space/poster/medium/tt456/img"));
        assert_eq!(page.items[2].poster.as_deref(),Some("https://images.metahub.space/poster/medium/tt789/img"));
        for raw in ["http://image.tmdb.org/t/p/w342/a.jpg","https://image.tmdb.org.example.org/t/p/w342/a.jpg","https://user:secret@image.tmdb.org/t/p/w342/a.jpg","https://image.tmdb.org:444/t/p/w342/a.jpg","https://image.tmdb.org/t/p/w342/%2Fprivate.jpg","https://images.metahub.space/poster/medium/not-imdb/img"]{
            assert!(public_poster(&json!(raw)).is_none());
        }
        assert!(public_poster(&json!("https://images.metahub.space/poster/medium/tt123/img")).is_some());
    }
    #[test]
    fn aiometadata_dotted_media_types_are_supported(){
        let m=Manifest::parse(br#"{"id":"metadata.fixture","name":"AIOMetadata fixture","version":"4","types":["movie","series","anime.movie","anime.series","anime","Trakt","collection","person"],"resources":["catalog","meta"],"catalogs":[{"id":"anime.top","type":"anime.series"}]}"#).unwrap();
        assert!(m.supports(ItemResource::Meta,"anime.series","mal:12"));
        assert_eq!(m.declared_catalogs().count(),1);
        for kind in [".","..","anime..series","anime/series","anime%2fseries"]{assert!(!type_valid(kind));}
    }
    #[test]
    fn response_and_manifest_bounds_reject_malformed_payloads() {
        assert!(read_bounded(&b"12345"[..],4).is_err());
        assert_eq!(read_bounded(&b"1234"[..],4).unwrap(),b"1234");
        assert!(Manifest::parse(&vec![b' ';MANIFEST_LIMIT+1]).is_err());
        assert!(Manifest::parse(br#"{"id":"x","name":"X","version":"1","types":["movie"],"resources":[]}"#).is_err());
        assert!(Manifest::parse(br#"{"id":"x","name":"X","version":"1","types":["movie"],"resources":["catalog"],"catalogs":[{"type":"movie","id":"x"},{"type":"movie","id":"x"}]}"#).is_err());
        assert!(CatalogPage::parse(br#"{"metas":{}}"#,"movie",0,true).is_err());
        assert!(CatalogPage::parse(&vec![b' ';CATALOG_LIMIT+1],"movie",0,true).is_err());
    }
}
