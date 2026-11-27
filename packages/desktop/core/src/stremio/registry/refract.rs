//! User-supplied Refract keys and an opt-in durable outbound queue.
//! No credentials, raw provider responses or configured URLs cross back
//! into the renderer. Only exact external identities are used for writes.
use super::super::{read_bounded,text_valid,Result};
use super::history::Progress;
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use std::{collections::BTreeSet,time::{Duration,SystemTime,UNIX_EPOCH}};
use url::Url;

const API:&str="https://getrefract.app/v1";
const LIMIT:usize=512*1024;
const QUEUE_LIMIT:usize=256;
const MAX_MS:u64=253402300799999;

fn valid_key(key:&str)->bool{
    key.strip_prefix("rfk_").is_some_and(|rest|!rest.is_empty()&&key.len()<=512&&
        rest.bytes().all(|b|b.is_ascii_alphanumeric()||matches!(b,b'-'|b'_'|b'.')))
}
fn uuid(id:&str)->bool{
    id.len()==36&&id.bytes().enumerate().all(|(i,b)|if matches!(i,8|13|18|23){b==b'-'}else{b.is_ascii_hexdigit()})
}
fn safe_name(name:&str)->bool{
    text_valid(name,256)&&!name.contains("://")&&!name.contains("rfk_")
}
fn now_ms()->Result<u64>{
    let ms=SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"refract-clock")?.as_millis();
    if ms==0||ms>MAX_MS as u128{return Err("refract-clock");}
    Ok(ms as u64)
}
fn positive(s:&str)->bool{
    !s.is_empty()&&s.len()<=10&&!s.starts_with('0')&&s.bytes().all(|b|b.is_ascii_digit())&&s.parse::<u32>().is_ok()
}
fn imdb(s:&str)->bool{
    s.strip_prefix("tt").is_some_and(|v|!v.is_empty()&&v.len()<=12&&v.bytes().all(|b|b.is_ascii_digit()))
}
#[derive(Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(rename_all="snake_case")]
enum Kind{Movie,Show,Episode}
impl Kind{fn name(&self)->&'static str{match self{Self::Movie=>"movie",Self::Show=>"show",Self::Episode=>"episode"}}}
#[derive(Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
struct Identity{provider:String,id:String,kind:Kind,season:Option<u32>,number:Option<u32>}
impl Identity{
    fn title(media_type:&str,item:&str)->Option<Self>{
        let kind=match media_type{"movie"=>Kind::Movie,"series"=>Kind::Show,_=>return None};
        let external=item.strip_prefix("imdb:").unwrap_or(item);
        let (provider,id)=if imdb(external){("imdb",external)}
            else if let Some(id)=item.strip_prefix(if kind==Kind::Movie{"tmdb:movie:"}else{"tmdb:tv:"}){
                if !positive(id){return None;}("tmdb",id)
            }else if kind==Kind::Show{
                let id=item.strip_prefix("tvdb:")?;if !positive(id){return None;}("tvdb",id)
            }else{return None;};
        Some(Self{provider:provider.into(),id:id.into(),kind,season:None,number:None})
    }
    fn completed(p:&Progress)->Option<Self>{
        if !p.completed{return None;}
        let mut identity=Self::title(&p.media_type,&p.item_id)?;
        if identity.kind==Kind::Movie{
            if p.item_id!=p.video_id{return None;}
        }else{
            let suffix=p.video_id.strip_prefix(p.item_id.as_str())?.strip_prefix(':')?;
            let (season,number)=suffix.split_once(':')?;
            if !(season=="0"||positive(season))||!positive(number){return None;}
            identity.kind=Kind::Episode;identity.season=Some(season.parse().ok()?);identity.number=Some(number.parse().ok()?);
        }
        Some(identity)
    }
    fn valid(&self)->bool{
        let id=match self.provider.as_str(){"imdb"=>imdb(&self.id),"tmdb"=>positive(&self.id),"tvdb"=>self.kind!=Kind::Movie&&positive(&self.id),_=>false};
        id&&match self.kind{
            Kind::Episode=>self.season.is_some()&&self.number.is_some_and(|n|n>0),
            _=>self.season.is_none()&&self.number.is_none(),
        }
    }
    fn lookup(&self)->Result<Url>{
        if !self.valid(){return Err("refract-unmatched");}
        let mut url=Url::parse(&format!("{API}/search/{}/{}",self.provider,self.id)).map_err(|_|"refract-request")?;
        url.query_pairs_mut().append_pair("type",self.kind.name());
        if let (Some(season),Some(number))=(self.season,self.number){
            url.query_pairs_mut().append_pair("season",&season.to_string()).append_pair("number",&number.to_string())
                .append_pair("numbering",if self.provider=="tvdb"{"tvdb"}else{"tmdb"});
        }
        Ok(url)
    }
}
#[derive(Clone,PartialEq,Eq)]
struct Match{id:String,season:Option<u32>,number:Option<u32>}
fn unique_match(value:Value,kind:&Kind)->Result<Match>{
    let rows=value["data"].as_array().ok_or("refract-response")?;
    if rows.len()>100{return Err("refract-response");}
    let mut found:Option<Match>=None;
    for row in rows{
        if row["type"].as_str()!=Some(kind.name()){continue;}
        let (id,season,number)=if *kind==Kind::Episode{
            if row["show"]["type"].as_str()!=Some("show"){return Err("refract-response");}
            let s=row["episode"]["season"].as_u64().and_then(|n|u32::try_from(n).ok()).ok_or("refract-response")?;
            let n=row["episode"]["number"].as_u64().and_then(|n|u32::try_from(n).ok()).filter(|n|*n>0).ok_or("refract-response")?;
            (&row["show"]["ids"]["refract"],Some(s),Some(n))
        }else{(&row["ids"]["refract"],None,None)};
        let id=id.as_str().filter(|id|uuid(id)).ok_or("refract-response")?;
        let matched=Match{id:id.to_ascii_lowercase(),season,number};
        if found.as_ref().is_some_and(|old|*old!=matched){return Err("refract-unmatched");}
        found=Some(matched);
    }
    found.ok_or("refract-unmatched")
}

// Bounded UTC RFC3339 conversion, no local timezone or additional dependency.
// Preserve the original completion timestamp on every retry.
fn instant(ms:u64)->Result<String>{
    if ms==0||ms>MAX_MS{return Err("refract-clock");}
    let seconds=ms/1000;
    let mut days=seconds/86400;
    let cycles=days/146097;let mut year=1970+cycles*400;days%=146097;
    let leap=|y:u64|y%4==0&&(y%100!=0||y%400==0);
    while days>=365+(leap(year) as u64){days-=365+(leap(year) as u64);year+=1;}
    let months=[31,28+(leap(year) as u64),31,30,31,30,31,31,30,31,30,31];
    let mut month=1;
    for length in months{if days<length{break;}days-=length;month+=1;}
    Ok(format!("{year:04}-{month:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",days+1,seconds/3600%24,seconds/60%60,seconds%60,ms%1000))
}
#[cfg(windows)]
fn request_id()->Result<String>{
    let mut bytes=[0u8;16];getrandom::fill(&mut bytes).map_err(|_|"refract-request")?;
    bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
    let hex:String=bytes.iter().map(|b|format!("{b:02x}")).collect();
    Ok(format!("{}-{}-{}-{}-{}",&hex[..8],&hex[8..12],&hex[12..16],&hex[16..20],&hex[20..]))
}
#[cfg(not(windows))]
fn request_id()->Result<String>{Err("unsupported")}

#[derive(Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
struct Job{identity:Identity,watched_at:u64,request_id:String,attempts:u32}
impl Job{
    fn valid(&self)->bool{self.identity.valid()&&self.identity.kind!=Kind::Show&&self.watched_at>0&&
        self.watched_at<=MAX_MS&&uuid(&self.request_id)&&self.attempts<=32}
}
#[derive(Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Saved{
    key:String,member_id:String,username:String,enabled:bool,jobs:Vec<Job>,
    sent:u32,skipped:u32,retry_at:u64,last_error:Option<String>,
}
fn known_error(code:&str)->bool{
    matches!(code,"refract-auth"|"refract-scope"|"refract-rate"|"refract-network"|"refract-request"|"refract-response"|
        "refract-conflict"|"refract-unmatched"|"refract-queue-full"|"refract-clock"|"refract-protected"|"unsupported")
}
impl Saved{
    fn valid(&self)->bool{
        let mut ids=BTreeSet::new();
        valid_key(&self.key)&&uuid(&self.member_id)&&safe_name(&self.username)&&self.jobs.len()<=QUEUE_LIMIT&&
        self.retry_at<=MAX_MS&&self.last_error.as_deref().is_none_or(known_error)&&
        self.jobs.iter().all(|job|job.valid()&&ids.insert(&job.request_id))
    }
}
#[derive(Clone,Copy)]
struct Failure{code:&'static str,retry_ms:u64}
impl Failure{
    fn new(code:&'static str)->Self{Self{code,retry_ms:0}}
}
type Remote<T>=std::result::Result<T,Failure>;
fn agent()->ureq::Agent{
    ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(15))).max_redirects(0)
        .http_status_as_error(false).build().into()
}
fn response(response:ureq::http::Response<ureq::Body>)->Remote<Value>{
    let status=response.status().as_u16();
    if status==204{return Ok(Value::Null);}
    let retry_ms=response.headers().get("Retry-After").and_then(|v|v.to_str().ok())
        .and_then(|v|v.parse::<u64>().ok()).unwrap_or(60).clamp(1,86400)*1000;
    if status==429{return Err(Failure{code:"refract-rate",retry_ms});}
    if status==401{return Err(Failure::new("refract-auth"));}
    if status==403{return Err(Failure::new("refract-scope"));}
    if status==503{return Err(Failure{code:"refract-network",retry_ms});}
    let bytes=read_bounded(response.into_body().into_reader(),LIMIT).map_err(|_|Failure::new("refract-response"))?;
    if !(200..300).contains(&status){
        let code=serde_json::from_slice::<Value>(&bytes).ok().and_then(|v|v["code"].as_str().map(str::to_owned));
        return Err(Failure::new(match (status,code.as_deref()){
            (_,Some("IN_LIBRARY"))=>"refract-protected",
            (_,Some("IDEMPOTENCY_KEY_MISMATCH"))=>"refract-conflict",
            (409,_)=>"refract-conflict",
            (404,_)=>"refract-unmatched",
            (500..=599,_)=>"refract-network",
            _=>"refract-request",
        }));
    }
    serde_json::from_slice(&bytes).map_err(|_|Failure::new("refract-response"))
}
fn get(key:&str,url:&str)->Remote<Value>{
    let bearer=format!("Bearer {key}");
    response(agent().get(url).header("Accept","application/json").header("Authorization",bearer.as_str())
        .call().map_err(|_|Failure::new("refract-network"))?)
}
fn member(key:&str)->Result<(String,String)>{
    if !valid_key(key){return Err("refract-auth");}
    let url=format!("{API}/me");let v=get(key,&url).map_err(|e|e.code)?;
    let id=v["id"].as_str().filter(|v|uuid(v)).ok_or("refract-response")?;
    let name=v["username"].as_str().filter(|v|safe_name(v)).ok_or("refract-response")?;
    Ok((id.to_ascii_lowercase(),name.into()))
}
fn resolve(key:&str,identity:&Identity)->Remote<Match>{
    let url=identity.lookup().map_err(Failure::new)?;
    unique_match(get(key,url.as_str())?,&identity.kind).map_err(Failure::new)
}
fn send_watch(key:&str,job:&Job)->Remote<()>{
    let matched=resolve(key,&job.identity)?;
    let watched_at=instant(job.watched_at).map_err(Failure::new)?;
    let bearer=format!("Bearer {key}");let agent=agent();
    if job.identity.kind==Kind::Movie{
        let url=format!("{API}/history/movies");let idem=format!("\"{}\"",job.request_id);
        let body=json!({"movie_id":matched.id,"watched_at":watched_at}).to_string();
        let value=response(agent.post(url.as_str()).header("Accept","application/json").header("Authorization",bearer.as_str())
            .header("Content-Type","application/json").header("Idempotency-Key",idem.as_str())
            .send(body).map_err(|_|Failure::new("refract-network"))?)?;
        if !matches!(value["result"].as_str(),Some("watched"|"rewatched"|"duplicate")){return Err(Failure::new("refract-response"));}
    }else{
        let (season,number)=(matched.season.ok_or(Failure::new("refract-unmatched"))?,matched.number.ok_or(Failure::new("refract-unmatched"))?);
        let url=format!("{API}/history/episodes/{}/{season}/{number}",matched.id);
        response(agent.put(url.as_str()).header("Accept","application/json").header("Authorization",bearer.as_str())
            .header("Content-Type","application/json").send(json!({"watched_at":watched_at}).to_string())
            .map_err(|_|Failure::new("refract-network"))?)?;
    }
    Ok(())
}
#[derive(Clone,Default)]
pub(super) struct Connection{saved:Option<Saved>}
impl Connection{
    pub(super) fn restored(saved:Option<Saved>)->Result<Self>{
        if saved.as_ref().is_some_and(|s|!s.valid()){return Err("profile-store");}
        Ok(Self{saved})
    }
    pub(super) fn saved(&self)->Option<Saved>{self.saved.clone()}
    pub(super) fn status(&self)->Value{
        let s=self.saved.as_ref();
        json!({"connected":s.is_some(),"username":s.map(|v|v.username.as_str()),"enabled":s.is_some_and(|v|v.enabled),
            "pending":s.map_or(0,|v|v.jobs.len()),"sent":s.map_or(0,|v|v.sent),"skipped":s.map_or(0,|v|v.skipped),
            "retryAt":s.map_or(0,|v|v.retry_at),"lastError":s.and_then(|v|v.last_error.as_deref())})
    }
    pub(super) fn connect(&mut self,key:String)->Result<Value>{
        let (member_id,username)=member(&key)?;
        if let Some(saved)=&mut self.saved{
            if saved.member_id!=member_id{return Err("refract-account-changed");}
            saved.key=key;saved.username=username;
            if matches!(saved.last_error.as_deref(),Some("refract-auth"|"refract-scope")){
                saved.retry_at=0;saved.last_error=None;
            }
        }else{
            self.saved=Some(Saved{key,member_id,username,enabled:false,jobs:Vec::new(),sent:0,skipped:0,retry_at:0,last_error:None});
        }
        Ok(self.status())
    }
    pub(super) fn enable(&mut self,enabled:bool)->Result<Value>{
        self.saved.as_mut().ok_or("refract-disconnected")?.enabled=enabled;
        Ok(self.status())
    }
    pub(super) fn disconnect(&mut self,discard_pending:bool)->Result<Value>{
        if self.saved.as_ref().is_some_and(|s|!s.jobs.is_empty())&&!discard_pending{return Err("refract-pending");}
        self.saved=None;Ok(self.status())
    }
    pub(super) fn enqueue(&mut self,progress:&Progress,watched_at:u64){
        let Some(saved)=self.saved.as_mut().filter(|s|s.enabled)else{return;};
        let Some(identity)=Identity::completed(progress)else{saved.skipped=saved.skipped.saturating_add(1);saved.last_error=Some("refract-unmatched".into());return;};
        // Identical completed events and close-in-time observations are not new viewings.
        if saved.jobs.iter().any(|j|j.identity==identity&&j.watched_at.abs_diff(watched_at)<30*60*1000){return;}
        if saved.jobs.len()>=QUEUE_LIMIT{saved.skipped=saved.skipped.saturating_add(1);saved.last_error=Some("refract-queue-full".into());return;}
        match request_id(){
            Ok(request_id)=>saved.jobs.push(Job{identity,watched_at,request_id,attempts:0}),
            Err(code)=>{saved.skipped=saved.skipped.saturating_add(1);saved.last_error=Some(code.into());}
        }
    }
    pub(super) fn sync(&mut self)->Result<Value>{
        let now=now_ms()?;
        let saved=self.saved.as_mut().ok_or("refract-disconnected")?;
        if !saved.enabled{return Err("refract-paused");}
        if saved.jobs.is_empty()||saved.retry_at>now{return Ok(self.status());}
        match send_watch(&saved.key,&saved.jobs[0]){
            Ok(())=>{saved.jobs.remove(0);saved.sent=saved.sent.saturating_add(1);saved.last_error=None;saved.retry_at=0;},
            Err(error)=>{
                saved.last_error=Some(error.code.into());
                if error.code=="refract-unmatched"{
                    saved.jobs.remove(0);saved.skipped=saved.skipped.saturating_add(1);saved.retry_at=0;
                }else{
                    let job=&mut saved.jobs[0];job.attempts=job.attempts.saturating_add(1).min(32);
                    let delay=if matches!(error.code,"refract-auth"|"refract-scope"){3600000}else{5000u64*(1u64<<job.attempts.min(9))};
                    saved.retry_at=now.saturating_add(delay.max(error.retry_ms)).min(MAX_MS);
                }
            }
        }
        Ok(self.status())
    }
    pub(super) fn watchlist(&mut self,media_type:&str,item_id:&str,add:bool)->Result<Value>{
        let saved=self.saved.as_mut().ok_or("refract-disconnected")?;
        let now=now_ms()?;
        if saved.retry_at>now{return Err("refract-rate");}
        let identity=Identity::title(media_type,item_id).ok_or("refract-unmatched")?;
        let result=(||->Remote<Value>{
            let matched=resolve(&saved.key,&identity)?;
            let url=format!("{API}/watchlist/{}",matched.id);let bearer=format!("Bearer {}",saved.key);
            let agent=agent();
            if add{
                response(agent.put(url.as_str()).header("Accept","application/json").header("Authorization",bearer.as_str())
                    .send("").map_err(|_|Failure::new("refract-network"))?)
            }else{
                response(agent.delete(url.as_str()).header("Accept","application/json").header("Authorization",bearer.as_str())
                    .call().map_err(|_|Failure::new("refract-network"))?)
            }
        })();
        match result{
            Ok(_)=>Ok(json!({"result":"updated"})),
            Err(error) if error.code=="refract-protected"=>Ok(json!({"result":"protected"})),
            Err(error)=>{
                if error.retry_ms>0{saved.retry_at=now.saturating_add(error.retry_ms).min(MAX_MS);}
                // Return a bounded error envelope so the rate limit survives a
                // successful snapshot transaction even when the request failed.
                Ok(json!({"result":"failed","error":error.code}))
            },
        }
    }
}

#[cfg(test)]
mod tests{
    use super::*;
    const ID:&str="3f2a9c4e-6b1d-4e8a-9c27-5d0b8e41f6a2";
    fn progress(media_type:&str,item:&str,video:&str)->Progress{
        Progress{media_type:media_type.into(),item_id:item.into(),video_id:video.into(),title:"Fixture".into(),
            episode_title:None,position_ms:120000,duration_ms:120000,completed:true}
    }
    fn connection()->Connection{
        Connection::restored(Some(Saved{key:"rfk_fixture-only".into(),member_id:ID.into(),username:"Fixture".into(),
            enabled:false,jobs:Vec::new(),sent:0,skipped:0,retry_at:0,last_error:None})).unwrap()
    }
    #[test]
    fn exact_id_and_episode_numbering_never_guess(){
        let movie=Identity::completed(&progress("movie","tt123","tt123")).unwrap();
        assert_eq!(movie.lookup().unwrap().as_str(),"https://getrefract.app/v1/search/imdb/tt123?type=movie");
        let episode=Identity::completed(&progress("series","tvdb:123","tvdb:123:0:2")).unwrap();
        assert_eq!(episode.lookup().unwrap().as_str(),"https://getrefract.app/v1/search/tvdb/123?type=episode&season=0&number=2&numbering=tvdb");
        for p in [progress("movie","tt123","tt456"),progress("series","tt123","tt456:1:2"),
            progress("series","tt123","tt123:1:2:3"),progress("series","kitsu:12","kitsu:12:1:2"),
            progress("movie","tmdb:tv:12","tmdb:tv:12")]{
            assert!(Identity::completed(&p).is_none());
        }
        let match_row=json!({"type":"episode","show":{"type":"show","ids":{"refract":ID}},"episode":{"season":2,"number":4}});
        let found=unique_match(json!({"data":[match_row.clone(),match_row.clone()]}),&Kind::Episode).ok().unwrap();
        assert_eq!((found.season,found.number),(Some(2),Some(4)));
        let mut other=match_row.clone();other["episode"]["number"]=json!(5);
        assert!(matches!(unique_match(json!({"data":[match_row,other]}),&Kind::Episode),Err("refract-unmatched")));
        assert!(matches!(unique_match(json!({"data":[]}),&Kind::Movie),Err("refract-unmatched")));
    }
    #[test]
    fn original_utc_time_and_credential_validation(){
        assert_eq!(instant(1).unwrap(),"1970-01-01T00:00:00.001Z");
        assert_eq!(instant(951782400000).unwrap(),"2000-02-29T00:00:00.000Z");
        assert_eq!(instant(1609459200123).unwrap(),"2021-01-01T00:00:00.123Z");
        assert_eq!(instant(MAX_MS).unwrap(),"9999-12-31T23:59:59.999Z");
        assert!(!valid_key("rfk_key\r\nInjected")&&!valid_key("other"));
        let c=connection();
        assert!(!c.status().to_string().contains("rfk_fixture-only"));
        assert_eq!(c.status()["enabled"],false);
        assert!(Connection::restored(Some(Saved{key:"invalid".into(),..c.saved().unwrap()})).is_err());
    }
    #[cfg(windows)]
    #[test]
    fn opt_in_queue_persists_and_disconnect_requires_confirmation(){
        let mut c=connection();let p=progress("movie","tt123","tt123");
        c.enqueue(&p,1609459200123);assert_eq!(c.status()["pending"],0);
        c.enable(true).unwrap();c.enqueue(&p,1609459200123);c.enqueue(&p,1609459201123);
        assert_eq!(c.status()["pending"],1);
        let saved=c.saved().unwrap();assert!(uuid(&saved.jobs[0].request_id));
        let mut restored=Connection::restored(Some(saved)).unwrap();
        assert_eq!(restored.status(),c.status());
        assert_eq!(restored.disconnect(false),Err("refract-pending"));
        restored.enable(false).unwrap();assert_eq!(restored.sync(),Err("refract-paused"));
        assert_eq!(restored.disconnect(true).unwrap()["connected"],false);
    }
}
