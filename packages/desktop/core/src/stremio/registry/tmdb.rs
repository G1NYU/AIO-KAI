//! Fixed-origin TMDB v3 metadata access. Credentials remain inside the
//! protected Watch profile; renderer responses never contain the key.
use super::{Result,Value,json};
use super::super::read_bounded;
use std::time::Duration;
use url::Url;

const LIMIT:usize=4*1024*1024;
#[derive(Clone,Default)]
pub(super) struct Connection { key:Option<String> }
fn valid_key(key:&str)->bool{key.len()==32&&key.bytes().all(|b|b.is_ascii_hexdigit())}
fn valid_configuration(v:&Value)->bool{
    let images=&v["images"];
    images["secure_base_url"].as_str()==Some("https://image.tmdb.org/t/p/")&&images["poster_sizes"].as_array().is_some_and(|a|!a.is_empty()&&a.iter().all(Value::is_string))
}
fn get(key:&str,path:&str,query:&[(&str,String)])->Result<Value>{
    let mut url=Url::parse(&format!("https://api.themoviedb.org/3/{path}")).map_err(|_|"tmdb-request")?;
    url.query_pairs_mut().append_pair("api_key",key).extend_pairs(query.iter().map(|(k,v)|(*k,v.as_str())));
    let agent:ureq::Agent=ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(12))).max_redirects(0).http_status_as_error(false).build().into();
    let response=agent.get(url.as_str()).header("Accept","application/json").call().map_err(|_|"tmdb-network")?;
    match response.status().as_u16(){
        200=>{},401|403=>return Err("tmdb-auth"),404=>return Err("tmdb-not-found"),429=>return Err("tmdb-rate"),_=>return Err("tmdb-request"),
    }
    let bytes=read_bounded(response.into_body().into_reader(),LIMIT).map_err(|_|"tmdb-response")?;
    serde_json::from_slice(&bytes).map_err(|_|"tmdb-response")
}
impl Connection{
    pub(super) fn restored(key:Option<String>)->Result<Self>{
        if key.as_deref().is_some_and(|k|!valid_key(k)){return Err("profile-store");}
        Ok(Self{key})
    }
    pub(super) fn connected(&self)->bool{self.key.is_some()}
    pub(super) fn saved_key(&self)->Option<String>{self.key.clone()}
    pub(super) fn connect(&mut self,key:String)->Result<()>{
        self.connect_with(key,|k|get(k,"configuration",&[]))
    }
    fn connect_with(&mut self,key:String,fetch:impl FnOnce(&str)->Result<Value>)->Result<()>{
        let key=key.trim().to_owned();
        if !valid_key(&key){return Err("tmdb-auth");}
        if !valid_configuration(&fetch(&key)?){return Err("tmdb-response");}
        self.key=Some(key);Ok(())
    }
    pub(super) fn disconnect(&mut self){self.key=None;}
}
// The native metadata worker returns public image paths and bounded display
// fields only; never the upstream payload or protected API key.
fn image(v:&Value,size:&str)->Option<String>{
    let file=v.as_str()?.strip_prefix('/')?;
    let (name,ext)=file.rsplit_once('.')?;
    if name.is_empty()||name.len()>80||!name.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-'||b==b'_')||!matches!(ext,"jpg"|"jpeg"|"png"|"webp"){return None;}
    Some(format!("https://image.tmdb.org/t/p/{size}/{file}"))
}
fn clean(v:&Value,max:usize)->Option<String>{
    let value=v.as_str()?.trim().chars().filter(|c|!c.is_control()).take(max).collect::<String>();
    (!value.is_empty()).then_some(value)
}
fn rating(v:&Value)->Option<f64>{v.as_f64().filter(|n|n.is_finite()&&(0.0..=10.0).contains(n))}
fn number(v:&Value)->Option<u64>{v.as_u64().filter(|n|*n>0&&*n<=9_999_999_999)}
fn kind(media_type:&str)->Result<&'static str>{match media_type{"movie"|"anime.movie"=>Ok("movie"),"series"|"anime.series"=>Ok("tv"),_=>Err("tmdb-not-found")}}
fn tmdb_id(kind:&str,id:u64)->String{format!("tmdb:{kind}:{id}")}
fn summary(row:&Value,kind:&str)->Option<Value>{
    if row["adult"].as_bool()==Some(true){return None;}
    let id=number(&row["id"])?;
    let name=clean(&row[if kind=="movie"{"title"}else{"name"}],512)?;
    let date=clean(&row[if kind=="movie"{"release_date"}else{"first_air_date"}],32);
    Some(json!({"id":tmdb_id(kind,id),"mediaType":if kind=="movie"{"movie"}else{"series"},"name":name,
        "poster":image(&row["poster_path"],"w500"),"background":image(&row["backdrop_path"],"w1280"),"description":clean(&row["overview"],4096),
        "releaseInfo":date,"tmdbRating":rating(&row["vote_average"]),"identities":[tmdb_id(kind,id)]}))
}
impl Connection{
    fn request(&self,path:&str,query:&[(&str,String)])->Result<Value>{
        get(self.key.as_deref().ok_or("tmdb-auth")?,path,query)
    }
    pub(super) fn search(&self,query:&str)->Result<Value>{
        let query=query.trim();
        if query.is_empty()||query.chars().count()>512||query.chars().any(char::is_control){return Err("invalid-resource");}
        let raw=self.request("search/multi",&[("query",query.to_owned()),("include_adult","false".into())])?;
        let rows=raw["results"].as_array().ok_or("tmdb-response")?;
        let items:Vec<_>=rows.iter().take(60).filter_map(|row|match row["media_type"].as_str(){Some("movie")=>summary(row,"movie"),Some("tv")=>summary(row,"tv"),_=>None}).collect();
        Ok(json!({"items":items}))
    }
    fn resolve(&self,kind:&str,id:&str)->Result<u64>{
        if let Some(value)=id.strip_prefix("tmdb:"){
            let number=if let Some((prefix,n))=value.split_once(':'){if prefix!=kind{return Err("tmdb-not-found");}n}else{value};
            return number.parse::<u64>().ok().filter(|n|*n>0&&*n<=9_999_999_999).ok_or("tmdb-not-found");
        }
        if !id.strip_prefix("tt").is_some_and(|n|!n.is_empty()&&n.len()<=12&&n.bytes().all(|b|b.is_ascii_digit())){return Err("tmdb-not-found");}
        let raw=self.request(&format!("find/{id}"),&[("external_source","imdb_id".into())])?;
        let rows=raw[if kind=="movie"{"movie_results"}else{"tv_results"}].as_array().ok_or("tmdb-response")?;
        rows.first().and_then(|r|number(&r["id"])).ok_or("tmdb-not-found")
    }
    pub(super) fn title(&self,media_type:&str,item_id:&str)->Result<Value>{
        let kind=kind(media_type)?;let id=self.resolve(kind,item_id)?;
        let row=self.request(&format!("{kind}/{id}"),&[("append_to_response","external_ids,images,credits".into()),("include_image_language","en,null".into())])?;
        if number(&row["id"])!=Some(id){return Err("tmdb-response");}
        let mut item=summary(&row,kind).ok_or("tmdb-response")?;
        let imdb=row["external_ids"]["imdb_id"].as_str().filter(|s|s.strip_prefix("tt").is_some_and(|n|!n.is_empty()&&n.len()<=12&&n.bytes().all(|b|b.is_ascii_digit())));
        if let Some(imdb)=imdb{item["imdbId"]=json!(imdb);item["identities"]=json!([tmdb_id(kind,id),imdb]);}
        item["tmdbId"]=json!(id);
        item["logo"]=json!(row["images"]["logos"].as_array().and_then(|rows|rows.iter().find_map(|r|image(&r["file_path"],"w500"))));
        item["genres"]=json!(row["genres"].as_array().into_iter().flatten().filter_map(|r|clean(&r["name"],80)).take(16).collect::<Vec<_>>());
        item["cast"]=json!(row["credits"]["cast"].as_array().into_iter().flatten().filter_map(|r|clean(&r["name"],128)).take(12).collect::<Vec<_>>());
        item["runtime"]=json!(row["runtime"].as_u64().or_else(||row["episode_run_time"].as_array().and_then(|a|a.first()).and_then(Value::as_u64)).filter(|n|*n>0&&*n<=1440));
        Ok(json!({"item":item}))
    }
    pub(super) fn season(&self,id:u64,season:u32)->Result<Value>{
        if id==0||id>9_999_999_999||season>1000{return Err("invalid-resource");}
        let row=self.request(&format!("tv/{id}/season/{season}"),&[])?;
        if row["season_number"].as_u64()!=Some(season as u64){return Err("tmdb-response");}
        let episodes:Vec<_>=row["episodes"].as_array().ok_or("tmdb-response")?.iter().take(500).filter_map(|e|{
            let n=e["episode_number"].as_u64().filter(|n|*n<=10000)?;
            Some(json!({"episode":n,"name":clean(&e["name"],512),"description":clean(&e["overview"],4096),"thumbnail":image(&e["still_path"],"w500"),"runtime":e["runtime"].as_u64().filter(|n|*n>0&&*n<=1440),"tmdbRating":rating(&e["vote_average"])}))
        }).collect();
        Ok(json!({"tmdbId":id,"season":season,"episodes":episodes}))
    }
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn metadata_rejects_private_image_paths_and_wrong_kinds(){
        assert_eq!(image(&json!("/cover.jpg"),"w500").as_deref(),Some("https://image.tmdb.org/t/p/w500/cover.jpg"));
        assert!(image(&json!("https://private.example/key"),"w500").is_none());
        assert!(image(&json!("/cover.jpg?token=private"),"w500").is_none());
        assert!(summary(&json!({"id":1,"title":"Hidden","adult":true}),"movie").is_none());
        let row=summary(&json!({"id":123,"name":"Series","backdrop_path":"/scene.jpg"}),"tv").unwrap();
        assert_eq!(row["id"],"tmdb:tv:123");
    }
    const FIXTURE:&str="00000000000000000000000000000000";
    #[test]
    fn only_verified_v3_keys_are_saved(){
        let mut connection=Connection::default();
        assert_eq!(connection.connect_with("invalid".into(),|_|panic!("invalid key requested")),Err("tmdb-auth"));
        assert_eq!(connection.connect_with(FIXTURE.into(),|_|Err("tmdb-auth")),Err("tmdb-auth"));
        assert_eq!(connection.connect_with(FIXTURE.into(),|_|Ok(json!({"success":true}))),Err("tmdb-response"));
        assert!(!connection.connected());
        connection.connect_with(FIXTURE.into(),|key|{
            assert_eq!(key,FIXTURE);
            Ok(json!({"images":{"secure_base_url":"https://image.tmdb.org/t/p/","poster_sizes":["w500","original"]}}))
        }).unwrap();
        assert!(connection.connected());
        assert_eq!(connection.saved_key().as_deref(),Some(FIXTURE));
        assert_eq!(connection.connect_with("11111111111111111111111111111111".into(),|_|Err("tmdb-auth")),Err("tmdb-auth"));
        assert_eq!(connection.saved_key().as_deref(),Some(FIXTURE));
        connection.disconnect();assert!(!connection.connected());
    }
    #[test]
    fn configuration_rejects_other_artwork_origins(){
        assert!(!valid_configuration(&json!({"images":{"secure_base_url":"https://example.invalid/","poster_sizes":["w500"]}})));
        assert!(Connection::restored(Some("invalid".into())).is_err());
    }
}
