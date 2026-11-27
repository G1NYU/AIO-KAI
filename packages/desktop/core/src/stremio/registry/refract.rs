//! User-supplied Refract keys and an opt-in durable outbound queue.
//! No credentials, raw provider responses or configured URLs cross back
//! into the renderer. Only exact external identities are used for writes.
use super::super::{read_bounded,text_valid,Result};
use super::history::Progress;
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use std::{collections::BTreeSet,sync::{Arc,Mutex},time::{Duration,SystemTime,UNIX_EPOCH}};
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
// Harbor accepts opaque string and numeric Refract identifiers. Restrict
// the string form to safe path segments; never interpolate arbitrary URLs.
fn safe_provider_id(id:&str)->bool{
    !id.is_empty()&&id.len()<=128&&id.bytes().all(|b|b.is_ascii_alphanumeric()||matches!(b,b'-'|b'_'))
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
enum RemoteId{Text(String),Number(u64)}
impl RemoteId{
    fn parse(value:&Value)->Option<Self>{
        if let Some(id)=value.as_str().filter(|id|safe_provider_id(id)){return Some(Self::Text(id.into()));}
        value.as_u64().filter(|n|*n>0&&*n<=9007199254740991).map(Self::Number)
    }
    fn path(&self)->String{match self{Self::Text(id)=>id.clone(),Self::Number(id)=>id.to_string()}}
    fn value(&self)->Value{match self{Self::Text(id)=>json!(id),Self::Number(id)=>json!(id)}}
}
#[derive(Clone,PartialEq,Eq)]
struct Match{id:RemoteId,season:Option<u32>,number:Option<u32>}
fn unique_match(value:Value,kind:&Kind)->Result<Match>{
    let rows=value["data"].as_array().ok_or("refract-response")?;
    if rows.len()>100{return Err("refract-response");}
    let mut found:Option<Match>=None;
    for row in rows{
        if !row.is_object(){return Err("refract-response");}
        // The exact lookup query already specifies type. Some Harbor-tested
        // responses omit that redundant field; reject any explicit mismatch.
        if row.get("type").is_some_and(|v|v.as_str()!=Some(kind.name())){continue;}
        let (id,season,number)=if *kind==Kind::Episode{
            if row["show"].get("type").is_some_and(|v|v.as_str()!=Some("show")){return Err("refract-response");}
            let s=row["episode"]["season"].as_u64().and_then(|n|u32::try_from(n).ok()).ok_or("refract-response")?;
            let n=row["episode"]["number"].as_u64().and_then(|n|u32::try_from(n).ok()).filter(|n|*n>0).ok_or("refract-response")?;
            (&row["show"]["ids"]["refract"],Some(s),Some(n))
        }else{
            if row.get("episode").is_some()||row.get("show").is_some(){return Err("refract-response");}
            (&row["ids"]["refract"],None,None)
        };
        let id=RemoteId::parse(id).ok_or("refract-response")?;
        let matched=Match{id,season,number};
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

#[derive(Clone,PartialEq,Eq,Serialize,Deserialize)]
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
    matches!(code,"refract-auth"|"refract-scope"|"refract-rate"|"refract-network"|"refract-request"|"refract-response"|"refract-rejected"|
        "refract-conflict"|"refract-unmatched"|"refract-queue-full"|"refract-clock"|"refract-protected"|"unsupported")
}
impl Saved{
    fn valid(&self)->bool{
        let mut ids=BTreeSet::new();
        valid_key(&self.key)&&safe_provider_id(&self.member_id)&&safe_name(&self.username)&&self.jobs.len()<=QUEUE_LIMIT&&
        self.retry_at<=MAX_MS&&self.last_error.as_deref().is_none_or(known_error)&&
        self.jobs.iter().all(|job|job.valid()&&ids.insert(&job.request_id))
    }
}
#[derive(Clone,Copy,Debug)]
struct Failure{code:&'static str,retry_ms:u64}
impl Failure{
    fn new(code:&'static str)->Self{Self{code,retry_ms:0}}
}
type Remote<T>=std::result::Result<T,Failure>;
fn agent()->ureq::Agent{
    ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(15))).max_redirects(0)
        .http_status_as_error(false).build().into()
}
// Match the verified Harbor contract: GET requires structured data, but a
// successful mutation is acknowledged by its HTTP status (including 204 and
// an empty 200/201). Do not retry a confirmed write because a result field is
// absent. Terminal client errors must not block later queued events.
fn decode_response(status:u16,retry_ms:u64,bytes:&[u8],read_json:bool)->Remote<Value>{
    if (200..300).contains(&status){
        return if read_json{serde_json::from_slice(bytes).map_err(|_|Failure::new("refract-response"))}else{Ok(Value::Null)};
    }
    if status==429{return Err(Failure{code:"refract-rate",retry_ms});}
    if status==401{return Err(Failure::new("refract-auth"));}
    if status==403{return Err(Failure::new("refract-scope"));}
    if status==503{return Err(Failure{code:"refract-network",retry_ms});}
    let code=serde_json::from_slice::<Value>(bytes).ok().and_then(|v|v["code"].as_str().map(str::to_owned));
    Err(Failure::new(match (status,code.as_deref()){
        (409,Some("IN_LIBRARY"))=>"refract-protected",
        (409,_)=>"refract-conflict",
        (404,_)=>"refract-unmatched",
        (400..=499,_)=>"refract-rejected",
        (500..=599,_)=>"refract-network",
        _=>"refract-request",
    }))
}
fn response(response:ureq::http::Response<ureq::Body>,read_json:bool)->Remote<Value>{
    let status=response.status().as_u16();
    let retry_ms=response.headers().get("Retry-After").and_then(|v|v.to_str().ok())
        .and_then(|v|v.parse::<u64>().ok()).unwrap_or(60).clamp(1,86400)*1000;
    if (!read_json&&(200..300).contains(&status))||matches!(status,401|403|429|503){
        return decode_response(status,retry_ms,&[],read_json);
    }
    let bytes=read_bounded(response.into_body().into_reader(),LIMIT).map_err(|_|Failure::new("refract-response"))?;
    decode_response(status,retry_ms,&bytes,read_json)
}
fn get(key:&str,url:&str)->Remote<Value>{
    let bearer=format!("Bearer {key}");
    response(agent().get(url).header("Accept","application/json").header("Authorization",bearer.as_str())
        .call().map_err(|_|Failure::new("refract-network"))?,true)
}
fn member(key:&str)->Result<(String,String)>{
    if !valid_key(key){return Err("refract-auth");}
    let url=format!("{API}/me");let v=get(key,&url).map_err(|e|e.code)?;
    parse_member(&v)
}
fn parse_member(v:&Value)->Result<(String,String)>{
    let id=RemoteId::parse(&v["id"]).ok_or("refract-response")?.path();
    let name=v["username"].as_str().filter(|v|safe_name(v))
        .or_else(||v["display_name"].as_str().filter(|v|safe_name(v))).unwrap_or("Connected");
    Ok((if uuid(&id){id.to_ascii_lowercase()}else{id},name.into()))
}
fn resolve(key:&str,identity:&Identity)->Remote<Match>{
    let url=identity.lookup().map_err(Failure::new)?;
    unique_match(get(key,url.as_str())?,&identity.kind).map_err(Failure::new)
}
fn send_watch(key:&str,job:&Job,matched:Match)->Remote<()>{
    let watched_at=instant(job.watched_at).map_err(Failure::new)?;
    let bearer=format!("Bearer {key}");let agent=agent();
    if job.identity.kind==Kind::Movie{
        let url=format!("{API}/history/movies");let idem=format!("\"{}\"",job.request_id);
        let body=json!({"movie_id":matched.id.value(),"watched_at":watched_at}).to_string();
        response(agent.post(url.as_str()).header("Accept","application/json").header("Authorization",bearer.as_str())
            .header("Content-Type","application/json").header("Idempotency-Key",idem.as_str())
            .send(body).map_err(|_|Failure::new("refract-network"))?,false)?;
    }else{
        let (season,number)=(matched.season.ok_or(Failure::new("refract-unmatched"))?,matched.number.ok_or(Failure::new("refract-unmatched"))?);
        let url=format!("{API}/history/episodes/{}/{season}/{number}",matched.id.path());
        response(agent.put(url.as_str()).header("Accept","application/json").header("Authorization",bearer.as_str())
            .header("Content-Type","application/json").send(json!({"watched_at":watched_at}).to_string())
            .map_err(|_|Failure::new("refract-network"))?,false)?;
    }
    Ok(())
}
// A single native delivery is permitted to cross the lookup/write boundary
// only while its owner is current. The gate is held for the transition, not
// for network I/O. The actor can cancel lookup or reject an account change
// after the mutation is authorized; it never blocks waiting for a request.
#[derive(Clone,Copy,PartialEq,Eq)]
enum Phase{Lookup,Writing,Cancelled}
#[derive(Clone)]
pub(super) struct Delivery{
    key:String,member_id:String,job:Job,gate:Arc<Mutex<Phase>>,
}
pub(super) struct DeliveryResult(Option<Remote<()>>);
impl Delivery{
    pub(super) fn cancel_before_write(&self)->bool{
        let Ok(mut phase)=self.gate.lock()else{return false;};
        if *phase==Phase::Writing{return false;}
        *phase=Phase::Cancelled;true
    }
    fn begin_write(&self)->bool{
        let Ok(mut phase)=self.gate.lock()else{return false;};
        if *phase!=Phase::Lookup{return false;}
        *phase=Phase::Writing;true
    }
    pub(super) fn run(&self)->DeliveryResult{
        let matched=resolve(&self.key,&self.job.identity);
        if !self.begin_write(){return DeliveryResult(None);}
        DeliveryResult(Some(matched.and_then(|m|send_watch(&self.key,&self.job,m))))
    }
    #[cfg(test)]
    pub(super) fn succeeded_for_test(&self)->DeliveryResult{
        assert!(self.begin_write());
        DeliveryResult(Some(Ok(())))
    }
    pub(super) fn interrupted(&self)->DeliveryResult{
        if self.cancel_before_write(){DeliveryResult(None)}
        else{DeliveryResult(Some(Err(Failure::new("refract-network"))))}
    }
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
    pub(super) fn enqueue(&mut self,progress:&Progress,watched_at:u64,viewing_id:Option<&str>){
        let Some(saved)=self.saved.as_mut().filter(|s|s.enabled)else{return;};
        let Some(identity)=Identity::completed(progress)else{saved.skipped=saved.skipped.saturating_add(1);saved.last_error=Some("refract-unmatched".into());return;};
        // Harbor review-completion distinguishes separate movie viewings,
        // while a queued episode PUT represents one idempotent watched state.
        // A movie's stable viewing UUID is also its request id; even a retry
        // after a lost acknowledgment must not append the same play twice.
        let movie_id=if identity.kind==Kind::Movie{viewing_id}else{None};
        if let Some(id)=movie_id{
            if !uuid(id){saved.skipped=saved.skipped.saturating_add(1);saved.last_error=Some("refract-request".into());return;}
            if let Some(previous)=saved.jobs.iter().find(|j|j.request_id==id){
                if previous.identity!=identity||previous.watched_at!=watched_at{
                    saved.skipped=saved.skipped.saturating_add(1);saved.last_error=Some("refract-conflict".into());
                }
                return;
            }
        }else if saved.jobs.iter().any(|j|j.identity==identity&&(identity.kind!=Kind::Movie||j.watched_at==watched_at)){return;}
        if saved.jobs.len()>=QUEUE_LIMIT{saved.skipped=saved.skipped.saturating_add(1);saved.last_error=Some("refract-queue-full".into());return;}
        match movie_id.map(str::to_owned).map(Ok).unwrap_or_else(request_id){
            Ok(request_id)=>saved.jobs.push(Job{identity,watched_at,request_id,attempts:0}),
            Err(code)=>{saved.skipped=saved.skipped.saturating_add(1);saved.last_error=Some(code.into());}
        }
    }
    // Explicit "sync next" requests now acknowledge queue state; the same
    // scheduler handles both manual and automatic delivery, with one flight.
    pub(super) fn sync(&self)->Result<Value>{
        let saved=self.saved.as_ref().ok_or("refract-disconnected")?;
        if !saved.enabled{return Err("refract-paused");}
        Ok(self.status())
    }
    pub(super) fn delivery(&self)->Option<Delivery>{
        let saved=self.saved.as_ref()?;
        if !saved.enabled||saved.retry_at>now_ms().ok()?{return None;}
        Some(Delivery{key:saved.key.clone(),member_id:saved.member_id.clone(),job:saved.jobs.first()?.clone(),
            gate:Arc::new(Mutex::new(Phase::Lookup))})
    }
    pub(super) fn finish_delivery(&mut self,delivery:&Delivery,result:&DeliveryResult)->Result<bool>{
        let Some(outcome)=result.0.as_ref()else{return Ok(false);};
        let Some(saved)=self.saved.as_mut()else{return Ok(false);};
        // Commit only the exact queued job and its original account, even if
        // another profile is now active. Never mutate the replacement queue.
        if !saved.enabled||saved.key!=delivery.key||saved.member_id!=delivery.member_id||
            saved.jobs.first()!=Some(&delivery.job){return Ok(false);}
        let now=now_ms()?;
        match outcome{
            Ok(())=>{saved.jobs.remove(0);saved.sent=saved.sent.saturating_add(1);
                if saved.last_error.as_deref()!=Some("refract-queue-full"){saved.last_error=None;}
                saved.retry_at=0;},
            Err(error)=>{
                saved.last_error=Some(error.code.into());
                if matches!(error.code,"refract-unmatched"|"refract-rejected"|"refract-protected"){
                    saved.jobs.remove(0);saved.skipped=saved.skipped.saturating_add(1);saved.retry_at=0;
                }else{
                    let job=&mut saved.jobs[0];job.attempts=job.attempts.saturating_add(1).min(32);
                    let delay=if matches!(error.code,"refract-auth"|"refract-scope"){3600000}else{5000u64*(1u64<<job.attempts.min(9))};
                    saved.retry_at=now.saturating_add(delay.max(error.retry_ms)).min(MAX_MS);
                }
            }
        }
        Ok(true)
    }
    pub(super) fn watchlist(&mut self,media_type:&str,item_id:&str,add:bool)->Result<Value>{
        let saved=self.saved.as_mut().ok_or("refract-disconnected")?;
        let now=now_ms()?;
        if saved.retry_at>now{return Err("refract-rate");}
        let identity=Identity::title(media_type,item_id).ok_or("refract-unmatched")?;
        let result=(||->Remote<Value>{
            let matched=resolve(&saved.key,&identity)?;
            let url=format!("{API}/watchlist/{}",matched.id.path());let bearer=format!("Bearer {}",saved.key);
            let agent=agent();
            if add{
                response(agent.put(url.as_str()).header("Accept","application/json").header("Authorization",bearer.as_str())
                    .send("").map_err(|_|Failure::new("refract-network"))?,false)
            }else{
                response(agent.delete(url.as_str()).header("Accept","application/json").header("Authorization",bearer.as_str())
                    .call().map_err(|_|Failure::new("refract-network"))?,false)
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
        // Shapes used by Harbor's API/sync fixtures: opaque string IDs,
        // numeric IDs, and absent redundant nested type discriminators.
        let movie=unique_match(json!({"data":[{"ids":{"refract":"movie-ref"}}]}),&Kind::Movie).unwrap();
        assert_eq!(movie.id.value(),json!("movie-ref"));
        let episode=unique_match(json!({"data":[{"show":{"ids":{"refract":37}},"episode":{"season":2,"number":6}}]}),&Kind::Episode).unwrap();
        assert_eq!(episode.id.value(),json!(37));assert_eq!(episode.id.path(),"37");
        assert_eq!((episode.season,episode.number),(Some(2),Some(6)));
        assert!(unique_match(json!({"data":[{"type":"show","ids":{"refract":"movie-ref"}}]}),&Kind::Movie).is_err());
        assert!(unique_match(json!({"data":[{"ids":{"refract":"../../bad"}}]}),&Kind::Movie).is_err());
        assert!(unique_match(json!({"data":[{"ids":{"refract":"movie-ref"}},{"ids":{"refract":"other-ref"}}]}),&Kind::Movie).is_err());
        assert_eq!(parse_member(&json!({"id":"member-ref","display_name":"Fixture"})).unwrap(),("member-ref".into(),"Fixture".into()));
        assert!(parse_member(&json!({"username":"Fixture"})).is_err());
    }
    #[test]
    fn harbor_http_ack_and_retry_contract(){
        for status in [200,201,204]{
            assert_eq!(decode_response(status,60000,b"",false).unwrap(),Value::Null);
        }
        assert_eq!(decode_response(201,60000,b"{}",false).unwrap(),Value::Null);
        assert_eq!(decode_response(200,60000,b"",true).unwrap_err().code,"refract-response");
        assert_eq!(decode_response(200,60000,br#"{"data":[]}"#,true).unwrap()["data"],json!([]));
        for (status,code) in [(401,"refract-auth"),(403,"refract-scope"),(404,"refract-unmatched"),
            (409,"refract-conflict"),(422,"refract-rejected"),(429,"refract-rate"),(503,"refract-network")]{
            assert_eq!(decode_response(status,13000,b"{}",false).unwrap_err().code,code);
        }
        assert_eq!(decode_response(429,13000,b"",false).unwrap_err().retry_ms,13000);
        assert_eq!(decode_response(409,60000,br#"{"code":"IN_LIBRARY"}"#,false).unwrap_err().code,"refract-protected");
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
    fn automatic_delivery_guard_retry_and_stale_result(){
        let mut c=connection();c.enable(true).unwrap();
        let p=progress("movie","tt123","tt123");
        let id="00000000-0000-4000-8000-000000000001";
        c.enqueue(&p,1609459200123,Some(id));
        let cancelled=c.delivery().unwrap();
        assert!(cancelled.cancel_before_write());
        assert!(!cancelled.begin_write());
        assert!(!c.finish_delivery(&cancelled,&DeliveryResult(None)).unwrap());
        assert_eq!(c.status()["pending"],1);
        let failed=c.delivery().unwrap();assert!(failed.begin_write());
        assert!(!failed.cancel_before_write());
        assert!(c.finish_delivery(&failed,&DeliveryResult(Some(Err(Failure{code:"refract-rate",retry_ms:60000})))).unwrap());
        assert_eq!(c.status()["pending"],1);
        assert_eq!(c.status()["lastError"],"refract-rate");
        assert!(c.delivery().is_none());
        assert_eq!(c.saved.as_ref().unwrap().jobs[0].request_id,id);
        c.saved.as_mut().unwrap().retry_at=0;
        let next=c.delivery().unwrap();assert_eq!(next.job.watched_at,failed.job.watched_at);
        assert_eq!(next.job.request_id,failed.job.request_id);
        assert!(next.begin_write());
        assert!(!c.finish_delivery(&failed,&DeliveryResult(Some(Ok(())))).unwrap());
        c.saved.as_mut().unwrap().key="rfk_replacement".into();
        assert!(!c.finish_delivery(&next,&DeliveryResult(Some(Ok(())))).unwrap());
        c.saved.as_mut().unwrap().key="rfk_fixture-only".into();
        assert!(c.finish_delivery(&next,&DeliveryResult(Some(Ok(())))).unwrap());
        assert!(!c.finish_delivery(&next,&DeliveryResult(Some(Ok(())))).unwrap());
        assert_eq!(c.status()["pending"],0);assert_eq!(c.status()["sent"],1);
    }
    #[cfg(windows)]
    #[test]
    fn opt_in_queue_persists_and_disconnect_requires_confirmation(){
        let mut c=connection();let p=progress("movie","tt123","tt123");
        c.enqueue(&p,1609459200123,None);assert_eq!(c.status()["pending"],0);
        c.enable(true).unwrap();c.enqueue(&p,1609459200123,None);c.enqueue(&p,1609459200123,None);
        assert_eq!(c.status()["pending"],1);
        c.enqueue(&p,1609459201123,None);
        assert_eq!(c.status()["pending"],2);
        let episode=progress("series","tt456","tt456:1:2");
        c.enqueue(&episode,1609459200123,None);c.enqueue(&episode,1609459201123,None);
        assert_eq!(c.status()["pending"],3);
        let saved=c.saved().unwrap();
        assert_eq!(saved.jobs[0].watched_at,1609459200123);
        assert_eq!(saved.jobs[1].watched_at,1609459201123);
        assert_ne!(saved.jobs[0].request_id,saved.jobs[1].request_id);
        let first="00000000-0000-4000-8000-000000000001";
        let second="00000000-0000-4000-8000-000000000002";
        c.enqueue(&p,1609459202123,Some(first));
        c.enqueue(&p,1609459202123,Some(first));
        c.enqueue(&p,1609459202123,Some(second));
        assert_eq!(c.status()["pending"],5);
        assert_eq!(c.saved().unwrap().jobs[3].request_id,first);
        assert_eq!(c.saved().unwrap().jobs[4].request_id,second);
        let saved=c.saved().unwrap();assert!(uuid(&saved.jobs[0].request_id));
        let mut restored=Connection::restored(Some(saved)).unwrap();
        assert_eq!(restored.status(),c.status());
        assert_eq!(restored.disconnect(false),Err("refract-pending"));
        restored.enable(false).unwrap();assert_eq!(restored.sync(),Err("refract-paused"));
        assert_eq!(restored.disconnect(true).unwrap()["connected"],false);
    }
}
