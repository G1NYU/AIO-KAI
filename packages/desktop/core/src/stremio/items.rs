//! Bounded item responses from installed HTTP addons. Exact video identities
//! are retained. Signed media URLs are inspected natively and never included
//! in display responses. The registry keeps exact reviewed playable options in memory.
use super::{Endpoint, Manifest, ItemResource, Result, fetch, id_valid, type_valid, text_valid, MAX_URL};
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeSet;
use url::{Host, Url};

const ITEM_LIMIT: usize = 4 * 1024 * 1024;
const MAX_VIDEOS: usize = 2048;
const MAX_OPTIONS: usize = 256;

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub(super) struct Video {
    pub id: String,
    pub name: String,
    pub season: Option<u32>,
    pub episode: Option<u32>,
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub(super) struct Metadata {
    pub id: String,
    pub media_type: String,
    pub name: String,
    pub description: Option<String>,
    pub videos: Vec<Video>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all="camelCase")]
pub(super) struct OptionSummary {
    pub name: String,
    pub supported: bool,
    pub reason: &'static str,
    pub language: Option<String>,
    #[serde(skip)]
    pub url: Option<String>,
}

fn display(value: Option<&Value>, max: usize) -> Option<String> {
    let raw = value?.as_str()?;
    if raw.len() > max * 4 { return None; }
    let joined = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if !text_valid(&joined,max) || joined.contains("://") ||
        joined.to_ascii_lowercase().contains("token=") ||
        joined.to_ascii_lowercase().contains("password=") { return None; }
    Some(joined)
}
fn safe_url(value: Option<&Value>) -> bool {
    let Some(raw) = value.and_then(Value::as_str) else { return false; };
    if raw.len()>MAX_URL || raw.chars().any(|c|c.is_control()||c.is_whitespace()) || raw.contains('\\') { return false; }
    let Ok(url)=Url::parse(raw) else { return false; };
    let Some(Host::Domain(host))=url.host() else { return false; };
    let host=host.trim_end_matches('.');
    url.scheme()=="https" && host.contains('.') && !host.ends_with(".localhost") &&
        !host.ends_with(".local") && url.username().is_empty() && url.password().is_none() &&
        url.fragment().is_none()
}
fn parse_meta(bytes:&[u8],kind:&str,id:&str)->Result<Metadata>{
    let payload:Value=serde_json::from_slice(bytes).map_err(|_|"invalid-item")?;
    let meta=payload.get("meta").and_then(Value::as_object).ok_or("invalid-item")?;
    if meta.get("id").and_then(Value::as_str)!=Some(id) ||
        meta.get("type").and_then(Value::as_str)!=Some(kind) {return Err("invalid-item");}
    let name=display(meta.get("name"),512).ok_or("invalid-item")?;
    let mut videos=Vec::new();
    let mut seen=BTreeSet::new();
    if let Some(rows)=meta.get("videos").filter(|v|!v.is_null()){
        let rows=rows.as_array().ok_or("invalid-item")?;
        if rows.len()>MAX_VIDEOS{return Err("item-limit");}
        for row in rows{
            let Some(video_id)=row.get("id").and_then(Value::as_str).filter(|v|id_valid(v)) else{continue;};
            if !seen.insert(video_id){continue;}
            let season=row.get("season").and_then(Value::as_u64).and_then(|v|u32::try_from(v).ok());
            let episode=row.get("episode").and_then(Value::as_u64).and_then(|v|u32::try_from(v).ok());
            let title=display(row.get("title"),512).or_else(||display(row.get("name"),512)).unwrap_or_else(||match(season,episode){
                (Some(s),Some(e))=>format!("S{s} E{e}"),_=>"Video".to_owned()
            });
            videos.push(Video{id:video_id.to_owned(),name:title,season,episode});
        }
    }
    // Movie identity is a valid video ID only when no explicit videos exist.
    // Never fabricate episode IDs for series or other media types.
    if videos.is_empty()&&kind=="movie"{
        videos.push(Video{id:id.to_owned(),name:name.clone(),season:None,episode:None});
    }
    Ok(Metadata{id:id.to_owned(),media_type:kind.to_owned(),name,
        description:display(meta.get("description"),4096),videos})
}
fn parse_options(bytes:&[u8],resource:ItemResource)->Result<Vec<OptionSummary>>{
    let payload:Value=serde_json::from_slice(bytes).map_err(|_|"invalid-item")?;
    let key=match resource{ItemResource::Stream=>"streams",ItemResource::Subtitles=>"subtitles",_=>return Err("invalid-resource")};
    let rows=payload.get(key).and_then(Value::as_array).ok_or("invalid-item")?;
    if rows.len()>MAX_OPTIONS{return Err("item-limit");}
    Ok(rows.iter().enumerate().map(|(i,row)|{
        let language=row.get("lang").and_then(Value::as_str).filter(|s|type_valid(s)).map(str::to_owned);
        let name=display(row.get("name"),256).or_else(||display(row.get("title"),256))
            .or_else(||language.clone()).unwrap_or_else(||format!("Option {}",i+1));
        let valid=safe_url(row.get("url"));
        let proxy=row.pointer("/behaviorHints/proxyHeaders").is_some_and(|v|!v.is_null());
        let unsupported=["infoHash","ytId","externalUrl","nzbUrl","rarUrls","zipUrls","7zipUrls","tgzUrls","tarUrls"].iter()
            .any(|key|row.get(*key).is_some_and(|v|!v.is_null()));
        let (supported,reason)=if unsupported { (false,"unsupported-transport") }
            else if !valid { (false,"invalid-media-url") }
            else if proxy { (false,"proxy-headers") }
            else { (true,"direct-https") };
        let url=if supported{row.get("url").and_then(Value::as_str).map(str::to_owned)}else{None};
        OptionSummary{name,supported,reason,language,url}
    }).collect())
}
impl Endpoint {
    pub(super) fn metadata(&self,manifest:&Manifest,kind:&str,id:&str)->Result<Metadata>{
        let url=self.item_url(manifest,ItemResource::Meta,kind,id)?;
        parse_meta(&fetch(&url,ITEM_LIMIT)?,kind,id)
    }
    pub(super) fn item_options(&self,manifest:&Manifest,resource:ItemResource,kind:&str,video_id:&str)->Result<Vec<OptionSummary>>{
        let url=self.item_url(manifest,resource,kind,video_id)?;
        parse_options(&fetch(&url,ITEM_LIMIT)?,resource)
    }
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn preserves_exact_series_video_ids_and_rejects_wrong_metadata(){
        let bytes=br#"{"meta":{"id":"custom:1","type":"series","name":"Example","videos":[{"id":"custom:1:0:7","name":"Special","season":0,"episode":7},{"id":"custom:1:0:7","title":"duplicate"},{"id":"bad/path","title":"bad"}]}}"#;
        let result=parse_meta(bytes,"series","custom:1").unwrap();
        assert_eq!(result.videos.len(),1);
        assert_eq!(result.videos[0].id,"custom:1:0:7");
        assert_eq!(result.videos[0].season,Some(0));
        assert_eq!(result.videos[0].name,"Special");
        assert!(parse_meta(bytes,"series","custom:2").is_err());
        let movie=parse_meta(br#"{"meta":{"id":"tt123","type":"movie","name":"Movie"}}"#,"movie","tt123").unwrap();
        assert_eq!(movie.videos[0].id,"tt123");
        let series=parse_meta(br#"{"meta":{"id":"tt123","type":"series","name":"Show"}}"#,"series","tt123").unwrap();
        assert!(series.videos.is_empty());
    }
    #[test]
    fn stream_summary_classifies_transports_without_leaking_urls(){
        let rows=parse_options(br#"{"streams":[{"name":"HD","url":"https://cdn.example.org/movie?token=private-fixture"},{"url":"file:///private"},{"url":"https://127.0.0.1/file"},{"infoHash":"abc","name":"Torrent"},{"url":"https://cdn.example.org/movie","behaviorHints":{"proxyHeaders":{"request":{"Authorization":"secret"}}}},{"name":"https://cdn.example.org/?token=private-fixture","externalUrl":"https://example.org"}]}"#,ItemResource::Stream).unwrap();
        assert_eq!(rows.iter().map(|r|r.supported).collect::<Vec<_>>(),vec![true,false,false,false,false,false]);
        let result=serde_json::to_string(&rows).unwrap();
        assert!(!result.contains("private-fixture")&&!result.contains("cdn.example.org")&&!result.contains("Authorization"));
        let subs=parse_options(br#"{"subtitles":[{"lang":"eng","url":"https://cdn.example.org/sub.vtt?key=private-fixture"}]}"#,ItemResource::Subtitles).unwrap();
        assert_eq!(subs[0].language.as_deref(),Some("eng"));
        assert!(subs[0].supported);
    }
}
