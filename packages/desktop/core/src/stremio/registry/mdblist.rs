//! Read-only MDBList catalogues. Credentials stay in the protected native
//! profile, fixed host GET requests only. No list or tracking mutations.
use super::{Result,Value,json};
use super::super::{read_bounded,text_valid};
use std::{collections::{BTreeMap,BTreeSet},time::{Duration,Instant}};
use url::Url;

const LIMIT:usize=4*1024*1024;
const PAGE:u32=100;
const MAX_OFFSET:u32=100_000;
const TTL:Duration=Duration::from_secs(300);

#[derive(Clone,Default)]
pub(super) struct Connection{
    key:Option<String>,
    cache:BTreeMap<String,(Instant,Value)>,
    retry_at:Option<Instant>,
}
pub(super) fn valid_key(key:&str)->bool{
    !key.is_empty()&&key.len()<=512&&key.bytes().all(|b|b.is_ascii_alphanumeric()||matches!(b,b'-'|b'_'|b'.'))
}
fn label(v:&Value,max:usize)->Option<String>{
    let s=v.as_str()?;
    if !text_valid(s,max)||s.contains("://")||s.to_ascii_lowercase().contains("apikey="){return None;}
    Some(s.to_owned())
}
fn imdb(s:&str)->bool{
    s.strip_prefix("tt").is_some_and(|v|!v.is_empty()&&v.len()<=12&&v.bytes().all(|b|b.is_ascii_digit()))
}
fn lists(value:Value)->Result<Value>{
    let rows=value.as_array().ok_or("mdblist-response")?;
    if rows.len()>1000{return Err("mdblist-response");}
    let mut seen=BTreeSet::new();
    let rows:Vec<_>=rows.iter().filter_map(|row|{
        let id=row["id"].as_u64().filter(|id|*id>0&&*id<=u32::MAX as u64)?;
        let name=label(&row["name"],512)?;
        if !seen.insert(id){return None;}
        Some(json!({"id":id,"name":name,"count":row["items"].as_u64().unwrap_or(0).min(u32::MAX as u64)}))
    }).collect();
    Ok(json!({"lists":rows}))
}
fn parse_page(value:Value,offset:u32,has_more:Option<bool>)->Result<Value>{
    let mut raw:Vec<(&Value,&str)>=Vec::new();
    let split=!value.is_array()&&!value["items"].is_array();
    if let Some(rows)=value.as_array().or_else(||value["items"].as_array()){
        raw.extend(rows.iter().map(|row|(row,row["mediatype"].as_str().unwrap_or(""))));
    }else{
        let movies=value["movies"].as_array();
        let shows=value["shows"].as_array();
        if movies.is_none()&&shows.is_none(){return Err("mdblist-response");}
        if let Some(rows)=movies{raw.extend(rows.iter().map(|row|(row,"movie")));}
        if let Some(rows)=shows{raw.extend(rows.iter().map(|row|(row,"show")));}
    }
    if raw.len()>PAGE as usize{return Err("mdblist-response");}
    if split{raw.sort_by_key(|(row,_)|row["rank"].as_u64().unwrap_or(u64::MAX));}
    let count=raw.len();
    let mut seen=BTreeSet::new();
    let rows:Vec<_>=raw.into_iter().filter_map(|(row,kind)|{
        let media_type=match kind{"movie"=>"movie","show"|"series"=>"series",_=>return None};
        let id=row["ids"]["imdb"].as_str().filter(|id|imdb(id)).or_else(||row["imdb_id"].as_str().filter(|id|imdb(id))).map(str::to_owned)
            .or_else(||row["ids"]["tmdb"].as_u64().or_else(||row["id"].as_u64()).filter(|id|*id>0&&*id<=u32::MAX as u64)
                .map(|id|format!("tmdb:{}:{id}",if media_type=="movie"{"movie"}else{"tv"})))?;
        let name=label(&row["title"],512)?;
        if !seen.insert((media_type,id.clone())){return None;}
        let mut ratings=BTreeMap::new();
        if let Some(values)=row["ratings"].as_array().filter(|v|v.len()<=64){
            for rating in values{
                if let (Some(source),Some(score))=(rating["source"].as_str(),rating["score"].as_f64()){
                    if matches!(source,"imdb"|"tmdb"|"mdblist"|"trakt"|"letterboxd"|"tomatoes"|"metacritic")&&score.is_finite()&&(0.0..=100.0).contains(&score){ratings.insert(source,score);}
                }
            }
        }
        Some(json!({"id":id,"mediaType":media_type,"name":name,"ratings":ratings}))
    }).collect();
    let next=if has_more.unwrap_or(count==PAGE as usize)&&count>0{offset.checked_add(count as u32).filter(|next|*next<=MAX_OFFSET)}else{None};
    Ok(json!({"items":rows,"nextOffset":next}))
}
impl Connection{
    pub(super) fn restored(key:Option<String>)->Result<Self>{
        if key.as_ref().is_some_and(|key|!valid_key(key)){return Err("profile-store");}
        Ok(Self{key,..Self::default()})
    }
    pub(super) fn saved_key(&self)->Option<String>{self.key.clone()}
    pub(super) fn status(&self)->Value{json!({"connected":self.key.is_some()})}
    fn get(&mut self,key:&str,path:&str,query:&[(&str,String)])->Result<(Value,Option<bool>)>{
        if self.retry_at.is_some_and(|at|at>Instant::now()){return Err("mdblist-rate");}
        let mut url=Url::parse(&format!("https://api.mdblist.com/{path}")).map_err(|_|"mdblist-request")?;
        url.query_pairs_mut().append_pair("apikey",key).extend_pairs(query.iter().map(|(k,v)|(*k,v.as_str())));
        let agent:ureq::Agent=ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(20))).max_redirects(0).http_status_as_error(false).build().into();
        let response=agent.get(url.as_str()).header("Accept","application/json").call().map_err(|_|"mdblist-network")?;
        match response.status().as_u16(){
            200=>{},
            401|403=>return Err("mdblist-auth"),
            404=>return Err("mdblist-not-found"),
            429=>{
                let wait=response.headers().get("Retry-After").and_then(|v|v.to_str().ok()).and_then(|v|v.parse::<u64>().ok()).unwrap_or(60).clamp(1,86400);
                self.retry_at=Instant::now().checked_add(Duration::from_secs(wait));return Err("mdblist-rate");
            },
            _=>return Err("mdblist-request"),
        }
        let more=response.headers().get("X-Has-More").and_then(|v|v.to_str().ok()).and_then(|v|match v{"true"=>Some(true),"false"=>Some(false),_=>None});
        let bytes=read_bounded(response.into_body().into_reader(),LIMIT)?;
        let value=serde_json::from_slice(&bytes).map_err(|_|"mdblist-response")?;
        Ok((value,more))
    }
    pub(super) fn connect(&mut self,key:String)->Result<Value>{
        if !valid_key(&key){return Err("mdblist-auth");}
        let (user,_)=self.get(&key,"user",&[])?;
        if !user["user_id"].as_u64().is_some_and(|id|id>0)||label(&user["username"],256).is_none(){return Err("mdblist-response");}
        self.key=Some(key);self.cache.clear();Ok(self.status())
    }
    pub(super) fn disconnect(&mut self)->Value{*self=Self::default();self.status()}
    fn cached(&self,key:&str)->Option<Value>{self.cache.get(key).filter(|(at,_)|at.elapsed()<TTL).map(|(_,v)|v.clone())}
    fn save_cache(&mut self,key:String,value:Value)->Value{
        if self.cache.len()>=32&&let Some(old)=self.cache.iter().min_by_key(|(_,v)|v.0).map(|(k,_)|k.clone()){self.cache.remove(&old);}
        self.cache.insert(key,(Instant::now(),value.clone()));value
    }
    pub(super) fn lists(&mut self)->Result<Value>{
        let key=self.key.clone().ok_or("mdblist-disconnected")?;
        if let Some(v)=self.cached("lists"){return Ok(v);}
        let (value,_)=self.get(&key,"lists/user",&[("sort","ranked".into()),("unified","false".into())])?;
        let value=lists(value)?;
        Ok(self.save_cache("lists".into(),value))
    }
    pub(super) fn page(&mut self,id:u32,offset:u32)->Result<Value>{
        if id==0||offset>MAX_OFFSET{return Err("mdblist-request");}
        let key=self.key.clone().ok_or("mdblist-disconnected")?;
        let cache_key=format!("list:{id}:{offset}");
        if let Some(v)=self.cached(&cache_key){return Ok(v);}
        let (value,more)=self.get(&key,&format!("lists/{id}/items"),&[("limit",PAGE.to_string()),("offset",offset.to_string()),("unified","true".into()),("sort","rank".into()),("order","asc".into()),("append_to_response","ratings".into())])?;
        let value=parse_page(value,offset,more)?;
        Ok(self.save_cache(cache_key,value))
    }
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn mdb_list_order_exact_identity_ratings_and_offset(){
        let value=json!({"movies":[{"id":12,"rank":2,"title":"Film","imdb_id":"tt123","ratings":[{"source":"imdb","score":85},{"source":"unknown","score":100}]}],
            "shows":[{"id":99,"rank":1,"title":"Show","ids":{"tmdb":99}},{"id":99,"rank":3,"title":"Duplicate","ids":{"tmdb":99}}]});
        let page=parse_page(value,100,Some(true)).unwrap();
        assert_eq!(page["items"][0]["id"],"tmdb:tv:99");
        assert_eq!(page["items"][1]["id"],"tt123");
        assert_eq!(page["items"][1]["ratings"]["imdb"],85.0);
        assert!(page["items"][1]["ratings"]["unknown"].is_null());
        assert_eq!(page["nextOffset"],103);
        assert_eq!(page["items"].as_array().unwrap().len(),2);
    }
    #[test]
    fn keys_and_account_status_never_expose_credentials(){
        let key="fixture-key";
        let mut c=Connection::restored(Some(key.into())).unwrap();
        assert_eq!(c.status(),json!({"connected":true}));
        assert!(!c.status().to_string().contains(key));
        assert!(Connection::restored(Some("https://bad.example/key".into())).is_err());
        assert_eq!(c.disconnect(),json!({"connected":false}));
        assert_eq!(c.lists(),Err("mdblist-disconnected"));
    }
}
