//! One-time read-only external account imports. All account credentials and
//! configured URLs stay native; no provider writes, token refresh, automatic
//! addon contact or account persistence. Validated Stremio account manifests
//! are reused; only selected missing or invalid manifests are fetched.
use super::{Endpoint, Manifest, Registry, Source, Result, MAX_SOURCES, REVIEW_TTL, summary};
use super::super::read_bounded;
use serde::Deserialize;
use serde_json::{json,Value};
use std::{collections::BTreeSet,sync::atomic::{AtomicUsize,Ordering},thread,time::{Duration,Instant}};
use url::Url;

const STREMIO:&str="https://api.strem.io/api/";
const NUVIO:&str="https://api.nuvio.tv/";
// Intentionally public client identifier, published in Nuvio's public API
// reference https://nuvio.tv/docs/server-api (v1.3, 2026-08-20).
// This is not a service-role key or an account credential.
const NUVIO_PUBLIC_CLIENT:&str="sb_publishable_1Clq8rlTVACkdcZuqr6_AD__xUUC_EN";
const RESPONSE_LIMIT:usize=4*1024*1024;
const MAX_REMOTE_ADDONS:usize=128;

#[derive(Clone,Copy,Deserialize,PartialEq,Eq)]
#[serde(rename_all="lowercase")]
pub enum Provider { Stremio,Nuvio }
impl Provider {
    fn name(self)->&'static str {match self{Self::Stremio=>"stremio",Self::Nuvio=>"nuvio"}}
}

#[derive(Clone)]
struct Candidate {id:u32,name:String,endpoint:Endpoint,enabled:bool,cached_manifest:Option<Manifest>}
impl Candidate {
    fn manifest(&self)->Result<Manifest>{
        match self.cached_manifest.as_ref().filter(|m|!m.behavior_hints.configuration_required){
            Some(manifest)=>Ok(manifest.clone()),
            None=>self.endpoint.manifest(),
        }
    }
}
#[derive(Clone)]
struct RemoteProfile {index:u32,name:String,primary:bool,locked:bool}
#[derive(Clone)]
struct Prepared {candidate:Candidate,manifest:Manifest}
#[derive(Clone)]
struct Failed {candidate:Candidate,reason:&'static str}
#[derive(Clone)]
enum Stage {
    Nuvio { token:String, profiles:Vec<RemoteProfile> },
    Candidates { rows:Vec<Candidate>, skipped:usize },
    Reviewed { rows:Vec<Prepared>, failed:Vec<Failed>, account_order: Vec<Url> },
    Retry { failed:Vec<Failed>, account_order:Vec<Url> },
}
#[derive(Clone)]
pub(super) struct Flow {id:u32,provider:Provider,created:Instant,stage:Stage}
impl Flow {
    pub(super) fn expired(&self)->bool {self.created.elapsed()>=REVIEW_TTL}
}
fn agent()->ureq::Agent{
    ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(20))).max_redirects(0).build().into()
}
fn http(agent:&ureq::Agent,url:&str,headers:&[(&str,&str)],body:Option<Value>)->Result<Value>{
    let response=if let Some(value)=body{
        let mut request=agent.post(url).header("Accept","application/json").header("Content-Type","application/json");
        for &(name,value) in headers {request=request.header(name,value);}
        request.send(value.to_string())
    }else{
        let mut request=agent.get(url).header("Accept","application/json");
        for &(name,value) in headers {request=request.header(name,value);}
        request.call()
    };
    let response=response.map_err(|e|match e{
        ureq::Error::StatusCode(400|401|403)=>"account-auth",
        ureq::Error::StatusCode(429)=>"rate",
        ureq::Error::StatusCode(_)=>"account-request",
        _=>"network",
    })?;
    if response.status()!=200{return Err("account-request");}
    let bytes=read_bounded(response.into_body().into_reader(),RESPONSE_LIMIT)?;
    serde_json::from_slice(&bytes).map_err(|_|"account-response")
}
fn credentials(email:&str,password:&str)->Result<()>{
    if email.is_empty()||email!=email.trim()||email.len()>320||!email.contains('@')||
        email.chars().any(|c|c.is_control()||c.is_whitespace())||password.is_empty()||password.len()>4096{
        return Err("account-auth");
    }
    Ok(())
}
fn token(value:&Value)->Result<String>{
    value.as_str().filter(|s|!s.is_empty()&&s.len()<=8192&&s.bytes().all(|b|b.is_ascii_graphic())).map(str::to_owned).ok_or("account-auth")
}
fn stremio_result(v:&Value)->Result<&Value>{
    if v.get("error").is_some(){return Err("account-auth");}
    v.get("result").ok_or("account-response")
}
fn safe_name(value:Option<&str>,fallback:&str)->String{
    value.filter(|s|!s.trim().is_empty()&&s.len()<=256&&!s.chars().any(char::is_control)&&
        !s.contains("://")&&!s.contains(['?','/','\\'])).unwrap_or(fallback).to_owned()
}
fn host(endpoint:&Endpoint)->&str{endpoint.0.host_str().unwrap_or("addon")}
fn candidate(id:u32,endpoint:Endpoint,name:Option<&str>,enabled:bool)->Candidate{
    let name=safe_name(name,host(&endpoint));Candidate{id,name,endpoint,enabled,cached_manifest:None}
}
fn stremio_candidates(value:&Value)->Result<(Vec<Candidate>,usize)>{
    let addons=stremio_result(value)?["addons"].as_array().ok_or("account-response")?;
    if addons.len()>MAX_REMOTE_ADDONS{return Err("import-limit");}
    let mut rows=Vec::new();let mut seen=BTreeSet::new();
    for (index,row) in addons.iter().enumerate(){
        let Some(raw)=row["transportUrl"].as_str() else{continue;};
        let Ok(endpoint)=Endpoint::parse(raw) else{continue;};
        if !seen.insert(endpoint.0.as_str().to_owned()){continue;}
        let mut entry=candidate(index as u32+1,endpoint,row["manifest"]["name"].as_str(),true);
        // addonCollectionGet(update:false) already returns descriptors with full
        // manifests. Apply the same size/schema checks as an HTTP manifest.
        entry.cached_manifest=serde_json::to_vec(&row["manifest"]).ok().and_then(|bytes|Manifest::parse(&bytes).ok());
        rows.push(entry);
    }
    let skipped=addons.len()-rows.len();Ok((rows,skipped))
}
fn stremio_import_at(agent:&ureq::Agent,base:&str,email:&str,password:&str)->Result<(Vec<Candidate>,usize)>{
    credentials(email,password)?;
    // Official Stremio API client login parameters; no social-provider
    // fallback. update:false and no addFromURL avoid account mutation.
    let auth=http(agent,&format!("{base}login"),&[],Some(json!({"email":email,"password":password,"facebook":false})))?;
    let key=token(&stremio_result(&auth)?["authKey"])?;
    let list=http(agent,&format!("{base}addonCollectionGet"),&[],Some(json!({"authKey":key,"update":false})))?;
    stremio_candidates(&list)
}
fn nuvio_profiles(value:&Value)->Result<Vec<RemoteProfile>>{
    let rows=value.as_array().ok_or("account-response")?;
    if rows.len()>6{return Err("account-response");}
    let mut seen=BTreeSet::new();
    let mut result=Vec::new();
    for row in rows{
        let index=row["profile_index"].as_u64().filter(|i|(1..=6).contains(i)).ok_or("account-response")? as u32;
        if !seen.insert(index){return Err("account-response");}
        let name=safe_name(row["name"].as_str(),&format!("Profile {index}"));
        let primary=row["uses_primary_addons"].as_bool().ok_or("account-response")?;
        // No public PIN-unlock flow is documented. Never import a protected
        // profile, or access its primary shared sources through another slot.
        let locked=row["pin_enabled"].as_bool().unwrap_or(true)||!row["pin_locked_until"].is_null();
        result.push(RemoteProfile{index,name,primary,locked});
    }
    result.sort_by_key(|p|p.index);
    Ok(result)
}
fn accessible_profile(profiles:&[RemoteProfile],index:u32)->Result<u32>{
    let profile=profiles.iter().find(|p|p.index==index).ok_or("unknown-remote-profile")?;
    if profile.locked{return Err("locked-remote-profile");}
    if profile.primary{
        let primary=profiles.iter().find(|p|p.index==1).ok_or("unknown-remote-profile")?;
        if primary.locked{return Err("locked-remote-profile");}
        Ok(1)
    }else{Ok(index)}
}
fn nuvio_connect_at(agent:&ureq::Agent,base:&str,client:&str,email:&str,password:&str)->Result<(String,Vec<RemoteProfile>)>{
    credentials(email,password)?;
    let auth=http(agent,&format!("{base}auth/v1/token?grant_type=password"),&[("apikey",client)],Some(json!({"email":email,"password":password})))?;
    let access=token(&auth["access_token"])?;
    let bearer=format!("Bearer {access}");
    let profiles=http(agent,&format!("{base}rest/v1/rpc/sync_pull_profiles"),&[("apikey",client),("Authorization",&bearer)],Some(json!({})))?;
    Ok((access,nuvio_profiles(&profiles)?))
}
fn nuvio_endpoint(raw:&str)->Result<Endpoint>{
    if let Ok(endpoint)=Endpoint::parse(raw){return Ok(endpoint);}
    if raw.len()>16*1024||raw.chars().any(|c|c.is_control()||c.is_whitespace())||raw.contains('\\'){return Err("invalid-endpoint");}
    let mut url=Url::parse(raw).map_err(|_|"invalid-endpoint")?;
    // Nuvio stores both full manifests and addon base URLs. Do not guess a
    // path for other JSON documents. Preserve configured path and query.
    if url.path().ends_with(".json"){return Err("invalid-endpoint");}
    let path=format!("{}/manifest.json",url.path().trim_end_matches('/'));
    url.set_path(&path);Endpoint::parse(url.as_str())
}
fn nuvio_candidates(value:&Value,profile:u32)->Result<(Vec<Candidate>,usize)>{
    let addons=value.as_array().ok_or("account-response")?;
    if addons.len()>MAX_REMOTE_ADDONS{return Err("import-limit");}
    let mut sorted=Vec::new();
    for (index,row) in addons.iter().enumerate(){
        if row["profile_id"].as_u64()!=Some(u64::from(profile)){return Err("account-response");}
        let Some(order)=row["sort_order"].as_u64() else{continue;};
        let Some(enabled)=row["enabled"].as_bool() else{continue;};
        let Some(raw)=row["url"].as_str() else{continue;};
        let Ok(endpoint)=nuvio_endpoint(raw) else{continue;};
        sorted.push((order,index,candidate(index as u32+1,endpoint,row["name"].as_str(),enabled)));
    }
    sorted.sort_by_key(|(order,index,_)|(*order,*index));
    let mut seen=BTreeSet::new();
    let rows:Vec<_>=sorted.into_iter().filter_map(|(_,_,c)|seen.insert(c.endpoint.0.as_str().to_owned()).then_some(c)).collect();
    let skipped=addons.len()-rows.len();Ok((rows,skipped))
}
fn nuvio_addons_at(agent:&ureq::Agent,base:&str,client:&str,access:&str,profile:u32)->Result<(Vec<Candidate>,usize)>{
    if !(1..=6).contains(&profile){return Err("unknown-remote-profile");}
    let bearer=format!("Bearer {access}");
    let value=http(agent,&format!("{base}rest/v1/addons?select=profile_id,url,name,enabled,sort_order&profile_id=eq.{profile}&order=sort_order.asc&limit=129"),
        &[("apikey",client),("Authorization",&bearer)],None)?;
    nuvio_candidates(&value,profile)
}
fn candidate_summary(c:&Candidate,existing:bool)->Value{
    json!({"candidateId":c.id,"name":c.name,"host":host(&c.endpoint),"enabled":c.enabled,"alreadyInstalled":existing})
}
impl Registry{
    fn import_view(&self,flow:&Flow)->Result<Value>{
        let base=json!({"importId":flow.id,"provider":flow.provider.name()});
        let mut data=base;
        match &flow.stage{
            Stage::Nuvio{profiles,..}=>{
                data["phase"]=json!("profiles");
                data["remoteProfiles"]=json!(profiles.iter().map(|p|json!({
                    "profileIndex":p.index,"name":p.name,"usesPrimaryAddons":p.primary,
                    "locked":accessible_profile(profiles,p.index).is_err()
                })).collect::<Vec<_>>());
            }
            Stage::Candidates{rows,skipped}=>{
                data["phase"]=json!("candidates");data["skipped"]=json!(skipped);
                data["availableSlots"]=json!(MAX_SOURCES-self.sources.len());
                data["candidates"]=json!(rows.iter().map(|c|candidate_summary(c,self.sources.iter().any(|s|s.endpoint.0==c.endpoint.0))).collect::<Vec<_>>());
            }
            Stage::Reviewed{..}|Stage::Retry{..}=>return Err("expired-review"),
        }
        Ok(data)
    }
    pub(super) fn import_connect(&mut self,provider:Provider,email:&str,password:&str)->Result<Value>{
        self.import=None;self.pending=None;
        let stage=match provider{
            Provider::Stremio=>{let (rows,skipped)=stremio_import_at(&agent(),STREMIO,email,password)?;Stage::Candidates{rows,skipped}},
            Provider::Nuvio=>{let (token,profiles)=nuvio_connect_at(&agent(),NUVIO,NUVIO_PUBLIC_CLIENT,email,password)?;Stage::Nuvio{token,profiles}},
        };
        self.sequence=self.sequence.checked_add(1).ok_or("import-limit")?;
        let flow=Flow{id:self.sequence,provider,created:Instant::now(),stage};
        let data=self.import_view(&flow)?;self.import=Some(flow);Ok(data)
    }
    fn take_import(&mut self,id:u32)->Result<Flow>{
        if self.import.as_ref().is_none_or(|f|f.id!=id||f.expired()){return Err("expired-review");}
        self.import.take().ok_or("expired-review")
    }
    pub(super) fn import_nuvio_profile(&mut self,id:u32,index:u32)->Result<Value>{
        let flow=self.take_import(id)?;
        let Stage::Nuvio{token,profiles}=flow.stage else{return Err("expired-review");};
        let effective=accessible_profile(&profiles,index)?;
        let (rows,skipped)=nuvio_addons_at(&agent(),NUVIO,NUVIO_PUBLIC_CLIENT,&token,effective)?;
        // Token is dropped as soon as the selected profile has been pulled.
        let flow=Flow{id,provider:Provider::Nuvio,created:Instant::now(),stage:Stage::Candidates{rows,skipped}};
        let mut data=self.import_view(&flow)?;
        data["remoteProfile"]=json!(index);data["effectiveProfile"]=json!(effective);
        self.import=Some(flow);Ok(data)
    }
    pub(super) fn import_review(&mut self,id:u32,selected:Vec<u32>)->Result<Value>{
        let flow=self.take_import(id)?;
        let Stage::Candidates{rows,..}=flow.stage else{return Err("expired-review");};
        let selected_count=selected.len();
        let selected:BTreeSet<_>=selected.into_iter().collect();
        if (selected.is_empty()&&!rows.iter().any(|row|self.sources.iter().any(|source|source.endpoint.0==row.endpoint.0)))||selected.len()!=selected_count||selected.len()>MAX_SOURCES-self.sources.len()||
            selected.iter().any(|id|!rows.iter().any(|c|c.id==*id)){
            return Err("import-selection");
        }
        let account_order = rows.iter().map(|row| row.endpoint.0.clone()).collect();
        let chosen:Vec<_>=rows.into_iter().filter(|c|selected.contains(&c.id)).collect();
        let (ready,failed)=self.review_import_candidates(&chosen,&Candidate::manifest);
        let preview:Vec<_>=ready.iter().map(|row|json!({"candidateId":row.candidate.id,"name":row.candidate.name,
            "host":host(&row.candidate.endpoint),"enabled":row.candidate.enabled,"manifest":summary(&row.manifest)})).collect();
        let rejected=failed.iter().map(Self::import_failure).collect::<Vec<_>>();
        self.import=Some(Flow{id,provider:flow.provider,created:Instant::now(),stage:Stage::Reviewed{rows:ready,failed,account_order}});
        Ok(json!({"importId":id,"provider":flow.provider.name(),"phase":"review","ready":preview,"rejected":rejected}))
    }
    fn import_failure(row:&Failed)->Value{
        json!({"candidateId":row.candidate.id,"name":row.candidate.name,"reason":row.reason})
    }
    fn review_import_candidates(&self,chosen:&[Candidate],fetch:&(impl Fn(&Candidate)->Result<Manifest>+Sync))->(Vec<Prepared>,Vec<Failed>){
        let mut ready=Vec::new();let mut failed=Vec::new();
        let slots=MAX_SOURCES-self.sources.len();
        // Work-conserving bounded pool: a slow manifest does not stall the
        // next eight. Keep result slots indexed by original account order.
        let cursor=AtomicUsize::new(0);
        let mut results:Vec<Option<Result<Manifest>>>=(0..chosen.len()).map(|_|None).collect();
        thread::scope(|scope|{
            let workers:Vec<_>=(0..chosen.len().min(8)).map(|_|{
                let cursor=&cursor;
                scope.spawn(move||{
                    let mut completed=Vec::new();
                    loop{
                        let index=cursor.fetch_add(1,Ordering::Relaxed);
                        let Some(candidate)=chosen.get(index)else{break;};
                        let result=if self.sources.iter().any(|source|source.endpoint.0==candidate.endpoint.0){Err("duplicate")}else{fetch(candidate)};
                        completed.push((index,result));
                    }
                    completed
                })
            }).collect();
            for worker in workers{
                if let Ok(completed)=worker.join(){
                    for (index,result) in completed{results[index]=Some(result);}
                }
            }
        });
        for (candidate,result) in chosen.iter().zip(results){
            match result.unwrap_or(Err("request")){
                Ok(manifest) if manifest.behavior_hints.configuration_required=>failed.push(Failed{candidate:candidate.clone(),reason:"configuration-required"}),
                Ok(manifest) if ready.len()<slots=>ready.push(Prepared{candidate:candidate.clone(),manifest}),
                Ok(_)=>failed.push(Failed{candidate:candidate.clone(),reason:"source-limit"}),
                Err(reason)=>failed.push(Failed{candidate:candidate.clone(),reason}),
            }
        }
        (ready,failed)
    }
    pub(super) fn import_apply(&mut self,id:u32)->Result<Value>{
        let Some(flow)=self.import.as_ref().filter(|f|f.id==id&&!f.expired()) else{return Err("expired-review");};
        let Stage::Reviewed{rows,..}= &flow.stage else{return Err("expired-review");};
        if rows.len()>MAX_SOURCES-self.sources.len(){return Err("import-selection");}
        if rows.iter().any(|r|self.sources.iter().any(|s|s.endpoint.0==r.candidate.endpoint.0)){return Err("duplicate");}
        let end=self.sequence.checked_add(rows.len() as u32).ok_or("import-limit")?;
        let flow=self.take_import(id)?;
        let Stage::Reviewed{rows,failed,account_order}=flow.stage else{return Err("expired-review");};
        for row in rows {
            self.sequence+=1;
            self.sources.push(Source{id:self.sequence,endpoint:row.candidate.endpoint,manifest:row.manifest,enabled:row.candidate.enabled});
        }
        // Stable sorting keeps local-only sources in their previous relative order.
        self.sources.sort_by_key(|source| account_order.iter()
            .position(|url| url == &source.endpoint.0).unwrap_or(usize::MAX));
        debug_assert_eq!(self.sequence,end);
        self.pending=None;
        let mut data=self.list();
        data["rejected"]=json!(failed.iter().map(Self::import_failure).collect::<Vec<_>>());
        let can_retry=failed.iter().any(Self::retryable_import_failure);
        data["retryImportId"]=json!(if can_retry{Some(id)}else{None});
        if can_retry{
            // Only failed manifest endpoints remain in volatile native memory.
            // No login token, password or unselected account entries are retried.
            self.import=Some(Flow{id,provider:flow.provider,created:Instant::now(),stage:Stage::Retry{failed,account_order}});
        }
        Ok(data)
    }
    fn retryable_import_failure(row:&Failed)->bool{row.reason!="duplicate"&&row.reason!="configuration-required"}
    pub(super) fn import_retry(&mut self,id:u32)->Result<Value>{
        self.import_retry_with(id,&|candidate|candidate.endpoint.manifest())
    }
    fn import_retry_with(&mut self,id:u32,fetch:&(impl Fn(&Candidate)->Result<Manifest>+Sync))->Result<Value>{
        let Some(flow)=self.import.as_ref().filter(|flow|flow.id==id&&!flow.expired()) else{return Err("expired-review");};
        let Stage::Retry{failed,account_order}=&flow.stage else{return Err("expired-review");};
        let chosen:Vec<_>=failed.iter().filter(|row|Self::retryable_import_failure(row)).map(|row|row.candidate.clone()).collect();
        let retained:Vec<_>=failed.iter().filter(|row|!Self::retryable_import_failure(row)).cloned().collect();
        let account_order=account_order.clone();
        let provider=flow.provider;
        let (rows,mut failed)=self.review_import_candidates(&chosen,fetch);
        failed.extend(retained);
        failed.sort_by_key(|row|row.candidate.id);
        self.import=Some(Flow{id,provider,created:Instant::now(),stage:Stage::Reviewed{rows,failed,account_order}});
        self.import_apply(id)
    }
    pub(super) fn import_cancel(&mut self,id:u32)->bool{
        if self.import.as_ref().is_some_and(|f|f.id==id){self.import=None;true}else{false}
    }
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn stremio_import_projects_exact_order_and_deduplicates_configured_urls(){
        let payload=json!({"result":{"addons":[
            {"transportUrl":"https://example.org/private-fixture/manifest.json?key=sentinel","manifest":{"name":"First"}},
            {"transportUrl":"https://example.org/private-fixture/manifest.json?key=sentinel","manifest":{"name":"Duplicate"}},
            {"transportUrl":"http://legacy.example.org/manifest.json","manifest":{"name":"Legacy"}},
            {"transportUrl":"https://example.org/two/manifest.json","manifest":{"name":"Second"}}
        ]}});
        let (rows,skipped)=stremio_candidates(&payload).unwrap();
        assert_eq!(skipped,2);assert_eq!(rows.iter().map(|c|c.name.as_str()).collect::<Vec<_>>(),vec!["First","Second"]);
        assert_eq!(rows[0].endpoint.0.query(),Some("key=sentinel"));
        let data=candidate_summary(&rows[0],false).to_string();
        assert!(!data.contains("sentinel")&&!data.contains("private-fixture"));
    }
    #[test]
    fn stremio_import_uses_full_validated_account_manifest(){
        let payload=json!({"result":{"addons":[
            {"transportUrl":"https://example.invalid/first/manifest.json","manifest":{"id":"fixture.cached","name":"Cached","version":"1","types":["movie"],"resources":["stream"]}},
            {"transportUrl":"https://example.invalid/invalid/manifest.json","manifest":{"name":"Incomplete"}}
        ]}});
        let (rows,skipped)=stremio_candidates(&payload).unwrap();
        assert_eq!(skipped,0);
        assert!(rows[0].cached_manifest.is_some());
        assert!(rows[1].cached_manifest.is_none());
        let mut registry=Registry::default();
        registry.import=Some(Flow{id:1,provider:Provider::Stremio,created:Instant::now(),stage:Stage::Candidates{rows,skipped}});
        let review=registry.import_review(1,vec![1]).unwrap();
        assert_eq!(review["ready"][0]["manifest"]["id"],"fixture.cached");
        let applied=registry.import_apply(1).unwrap();
        assert_eq!(applied["sources"][0]["manifest"]["id"],"fixture.cached");
    }
    #[test]
    fn import_pool_does_not_wait_for_a_slow_first_batch(){
        let registry=Registry::default();
        let manifest=Manifest::parse(br#"{"id":"fixture","name":"Fixture","version":"1","types":["movie"],"resources":["stream"]}"#).unwrap();
        let chosen:Vec<_>=(1..=35).map(|id|candidate(id,Endpoint::parse(&format!("https://example.invalid/{id}/manifest.json")).unwrap(),None,true)).collect();
        let (tx,rx)=std::sync::mpsc::channel();
        let rx=std::sync::Mutex::new(rx);
        let (ready,failed)=registry.review_import_candidates(&chosen,&|candidate|{
            if candidate.id==1{
                rx.lock().unwrap().recv_timeout(Duration::from_secs(5)).map_err(|_|"batch-barrier")?;
                return Err("network");
            }
            if candidate.id==9{let _=tx.send(());}
            Ok(manifest.clone())
        });
        assert_eq!(failed.len(),1);
        assert_eq!(failed[0].candidate.id,1);
        assert_eq!(failed[0].reason,"network");
        assert_eq!(ready.iter().map(|r|r.candidate.id).collect::<Vec<_>>(),(2..=35).collect::<Vec<_>>());
    }
    #[test]
    fn nuvio_preserves_order_enabled_state_and_rejects_wrong_profile(){
        let (rows,skipped)=nuvio_candidates(&json!([
            {"profile_id":2,"url":"https://example.org/second/manifest.json","name":"Second","enabled":true,"sort_order":8},
            {"profile_id":2,"url":"https://example.org/private%2Fconfig?key=sentinel","name":"First","enabled":false,"sort_order":2},
            {"profile_id":2,"url":"https://example.org/other.json","enabled":true,"sort_order":1}
        ]),2).unwrap();
        assert_eq!(skipped,1);assert_eq!(rows[0].name,"First");assert!(!rows[0].enabled);
        assert_eq!(rows[0].endpoint.0.as_str(),"https://example.org/private%2Fconfig/manifest.json?key=sentinel");
        assert!(nuvio_candidates(&json!([{"profile_id":3}]),2).is_err());
        assert!(nuvio_endpoint("https://example.org/manifest.json#secret").is_err());
    }
    #[test]
    fn nuvio_profile_sharing_cannot_bypass_pin(){
        let profiles=nuvio_profiles(&json!([
            {"profile_index":1,"name":"Main","uses_primary_addons":false,"pin_enabled":true},
            {"profile_index":2,"name":"Shared","uses_primary_addons":true,"pin_enabled":false},
            {"profile_index":3,"name":"Independent","uses_primary_addons":false,"pin_enabled":false},
            {"profile_index":4,"name":"Unknown lock","uses_primary_addons":false}
        ])).unwrap();
        assert_eq!(accessible_profile(&profiles,1),Err("locked-remote-profile"));
        assert_eq!(accessible_profile(&profiles,2),Err("locked-remote-profile"));
        assert_eq!(accessible_profile(&profiles,3),Ok(3));
        assert_eq!(accessible_profile(&profiles,4),Err("locked-remote-profile"));
    }
    #[test]
    fn local_apply_requires_review_and_preserves_disabled_source_and_order(){
        let mut registry=Registry::default();registry.sequence=10;
        let manifest=Manifest::parse(br#"{"id":"fixture","name":"Fixture","version":"1","types":["movie"],"resources":["stream"]}"#).unwrap();
        let one=candidate(1,Endpoint::parse("https://example.org/one/manifest.json").unwrap(),Some("One"),false);
        let two=candidate(2,Endpoint::parse("https://example.org/two/manifest.json").unwrap(),Some("Two"),true);
        registry.import=Some(Flow{id:10,provider:Provider::Nuvio,created:Instant::now(),stage:Stage::Candidates{rows:vec![one.clone(),two.clone()],skipped:0}});
        assert_eq!(registry.import_apply(10),Err("expired-review"));
        let existing=Endpoint::parse("https://example.org/existing/manifest.json").unwrap();
        registry.sources.push(Source{id:9,endpoint:existing.clone(),manifest:manifest.clone(),enabled:false});
        let account_order=vec![one.endpoint.0.clone(),existing.0,two.endpoint.0.clone()];
        registry.import=Some(Flow{id:10,provider:Provider::Nuvio,created:Instant::now(),stage:Stage::Reviewed{account_order,failed:vec![],rows:vec![Prepared{candidate:one,manifest:manifest.clone()},Prepared{candidate:two,manifest}]}});
        assert_eq!(registry.import_apply(9),Err("expired-review"));
        let result=registry.import_apply(10).unwrap();
        assert_eq!(result["sources"][0]["sourceId"],11);assert_eq!(result["sources"][0]["enabled"],false);
        assert_eq!(result["sources"][1]["sourceId"],9);assert_eq!(result["sources"][1]["enabled"],false);
        assert_eq!(result["sources"][2]["sourceId"],12);assert_eq!(result["sources"][2]["enabled"],true);
        assert_eq!(registry.import_apply(10),Err("expired-review"));
    }
    #[test]
    fn failed_import_retries_only_selected_failures_and_restores_order(){
        let mut registry=Registry::default();registry.sequence=10;
        let manifest=Manifest::parse(br#"{"id":"fixture","name":"Fixture","version":"1","types":["movie"],"resources":["stream"]}"#).unwrap();
        let first=candidate(1,Endpoint::parse("https://example.org/first/manifest.json").unwrap(),Some("First"),false);
        let second=candidate(2,Endpoint::parse("https://example.org/second/manifest.json").unwrap(),Some("Second"),true);
        registry.sources.push(Source{id:9,endpoint:second.endpoint.clone(),manifest:manifest.clone(),enabled:true});
        let account_order=vec![first.endpoint.0.clone(),second.endpoint.0.clone()];
        registry.import=Some(Flow{id:10,provider:Provider::Stremio,created:Instant::now(),stage:Stage::Reviewed{
            rows:vec![],failed:vec![Failed{candidate:first.clone(),reason:"network"}],account_order}});
        let applied=registry.import_apply(10).unwrap();
        assert_eq!(applied["retryImportId"],10);
        assert_eq!(applied["rejected"][0]["reason"],"network");
        let retried=registry.import_retry_with(10,&|row|{assert_eq!(row.id,1);Ok(manifest.clone())}).unwrap();
        assert_eq!(retried["retryImportId"],Value::Null);
        assert_eq!(retried["sources"][0]["sourceId"],11);
        assert_eq!(retried["sources"][0]["enabled"],false);
        assert_eq!(retried["sources"][1]["sourceId"],9);
        assert_eq!(registry.import_retry(10),Err("expired-review"));
        registry.sources.reverse();
        registry.import=Some(Flow{id:12,provider:Provider::Stremio,created:Instant::now(),stage:Stage::Candidates{rows:vec![first,second],skipped:0}});
        let reviewed=registry.import_review(12,vec![]).unwrap();
        assert_eq!(reviewed["ready"],json!([]));
        assert_eq!(registry.import_apply(12).unwrap()["sources"][0]["sourceId"],11);
    }
    #[test]
    fn account_http_fixtures_bound_requests_and_refuse_redirects(){
        let (base,server)=crate::test_http::response(200,"application/json",br#"{"result":{"authKey":"fixture-token"}}"#.to_vec());
        let v=http(&agent(),&format!("{base}login"),&[],Some(json!({"email":"fixture@example.org","password":"fixture-password"}))).unwrap();
        assert_eq!(token(&stremio_result(&v).unwrap()["authKey"]).unwrap(),"fixture-token");
        let sent=server.join().unwrap();assert!(sent.starts_with("POST /login "));assert!(sent.contains("fixture-password"));
        let (base,server)=crate::test_http::response(200,"application/json",b"[]".to_vec());
        let (rows,skipped)=nuvio_addons_at(&agent(),&base,"fixture-public","fixture-token",2).unwrap();
        assert!(rows.is_empty());assert_eq!(skipped,0);
        let sent=server.join().unwrap();assert!(sent.starts_with("GET /rest/v1/addons?"));
        assert!(sent.contains("profile_id=eq.2"));assert!(sent.to_ascii_lowercase().contains("authorization: bearer fixture-token"));
        let (base,server)=crate::test_http::response_with_headers(302,"text/plain",Vec::new(),"Location: https://example.invalid/other\r\n".into(),||{});
        assert_eq!(http(&agent(),&base,&[],None),Err("account-request"));server.join().unwrap();
    }
}
