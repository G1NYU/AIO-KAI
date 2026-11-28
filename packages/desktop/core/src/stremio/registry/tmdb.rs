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
/// Keep recommendation order, omit self/duplicate/adult entries and entries
/// without a valid portrait. Fall back to TMDB similar titles only if needed.
fn related_titles(row:&Value,kind:&str,id:u64)->Vec<Value>{
    for field in ["recommendations","similar"]{
        let mut seen=std::collections::HashSet::from([id]);
        let items:Vec<_>=row[field]["results"].as_array().into_iter().flatten().take(60).filter_map(|entry|{
            let candidate=number(&entry["id"])?;
            if seen.contains(&candidate){return None;}
            if entry["media_type"].as_str().is_some_and(|media|media!=kind){return None;}
            let item=summary(entry,kind)?;
            if !item["poster"].is_string(){return None;}
            seen.insert(candidate);
            Some(item)
        }).take(18).collect();
        if !items.is_empty(){return items;}
    }
    Vec::new()
}
fn enrich_credits(item:&mut Value,row:&Value){
    let mut seen=std::collections::HashSet::new();
    let cast:Vec<Value>=row["credits"]["cast"].as_array().into_iter().flatten().filter_map(|person|{
        let id=number(&person["id"])?;let name=clean(&person["name"],128)?;
        if !seen.insert(id){return None;}
        Some(json!({"id":id,"name":name,"character":clean(&person["character"],256),"portrait":image(&person["profile_path"],"w185")}))
    }).take(24).collect();
    item["castMembers"]=json!(cast);
    let roles:[(&str,&[&str]);6]=[
        ("director",&["Director"]),("writer",&["Writer","Screenplay","Story","Teleplay"]),
        ("producer",&["Producer","Executive Producer"]),("cinematography",&["Director of Photography"]),
        ("music",&["Original Music Composer"]),("editor",&["Editor"])
    ];
    let mut credits=Vec::new();
    for (role,jobs) in roles{
        let mut names_seen=std::collections::HashSet::new();
        let names:Vec<String>=row["credits"]["crew"].as_array().into_iter().flatten()
            .filter(|person|person["job"].as_str().is_some_and(|job|jobs.contains(&job)))
            .filter_map(|person|clean(&person["name"],128)).filter(|name|names_seen.insert(name.clone())).take(8).collect();
        if !names.is_empty(){credits.push(json!({"role":role,"names":names}));}
    }
    let creators:Vec<String>=row["created_by"].as_array().into_iter().flatten().filter_map(|person|clean(&person["name"],128)).take(8).collect();
    if !creators.is_empty(){credits.push(json!({"role":"creator","names":creators}));}
    item["crewCredits"]=json!(credits);
    item["tagline"]=json!(clean(&row["tagline"],256));
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
        let row=self.request(&format!("{kind}/{id}"),&[("append_to_response","external_ids,images,credits,recommendations,similar".into()),("include_image_language","en,null".into())])?;
        if number(&row["id"])!=Some(id){return Err("tmdb-response");}
        let mut item=summary(&row,kind).ok_or("tmdb-response")?;
        let imdb=row["external_ids"]["imdb_id"].as_str().filter(|s|s.strip_prefix("tt").is_some_and(|n|!n.is_empty()&&n.len()<=12&&n.bytes().all(|b|b.is_ascii_digit())));
        if let Some(imdb)=imdb{item["imdbId"]=json!(imdb);item["identities"]=json!([tmdb_id(kind,id),imdb]);}
        item["tmdbId"]=json!(id);
        item["logo"]=json!(row["images"]["logos"].as_array().and_then(|rows|rows.iter().find_map(|r|image(&r["file_path"],"w500"))));
        item["genres"]=json!(row["genres"].as_array().into_iter().flatten().filter_map(|r|clean(&r["name"],80)).take(16).collect::<Vec<_>>());
        item["cast"]=json!(row["credits"]["cast"].as_array().into_iter().flatten().filter_map(|r|clean(&r["name"],128)).take(12).collect::<Vec<_>>());
        enrich_credits(&mut item,&row);
        item["related"]=json!(related_titles(&row,kind,id));
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
    #[test]
    fn credits_keep_verified_portraits_and_roles(){
        let mut item=json!({});
        enrich_credits(&mut item,&json!({"tagline":"A verified tagline","credits":{"cast":[{"id":1,"name":"Actor","character":"Lead","profile_path":"/face.jpg"},{"id":1,"name":"Duplicate"},{"id":2,"name":"Second","profile_path":"https://private.example/key"}],"crew":[{"name":"Director","job":"Director"},{"name":"Writer","job":"Screenplay"},{"name":"Writer","job":"Story"}]}}));
        assert_eq!(item["castMembers"].as_array().unwrap().len(),2);
        assert_eq!(item["castMembers"][0]["portrait"],"https://image.tmdb.org/t/p/w185/face.jpg");
        assert!(item["castMembers"][1]["portrait"].is_null());
        assert_eq!(item["crewCredits"][1]["names"],json!(["Writer"]));
        assert_eq!(item["tagline"],"A verified tagline");
    }
    #[test]
    fn related_titles_use_exact_kind_and_order_with_safe_artwork(){
        let row=json!({"recommendations":{"results":[
            {"id":1,"title":"Self","poster_path":"/self.jpg"},
            {"id":2,"title":"First","poster_path":"/first.jpg","vote_average":7.4},
            {"id":2,"title":"Duplicate","poster_path":"/dup.jpg"},
            {"id":3,"title":"Adult","adult":true,"poster_path":"/adult.jpg"},
            {"id":4,"title":"Invalid art","poster_path":"https://private.example/path"},
            {"id":5,"title":"Wrong kind","media_type":"tv","poster_path":"/wrong.jpg"},
            {"id":6,"title":"Second","poster_path":"/second.jpg"}
        ]},"similar":{"results":[{"id":7,"title":"Fallback","poster_path":"/fallback.jpg"}]}});
        let related=related_titles(&row,"movie",1);
        assert_eq!(related.iter().map(|r|r["id"].as_str().unwrap()).collect::<Vec<_>>(),vec!["tmdb:movie:2","tmdb:movie:6"]);
        assert_eq!(related[0]["tmdbRating"],json!(7.4));
        let fallback=related_titles(&json!({"recommendations":{"results":[{"id":1,"name":"Self"}]},"similar":{"results":[{"id":8,"name":"Similar series","poster_path":"/series.jpg"}]}}),"tv",1);
        assert_eq!(fallback[0]["id"],"tmdb:tv:8");
        let many=(2..=40).map(|id|json!({"id":id,"title":"Film","poster_path":"/film.jpg"})).collect::<Vec<_>>();
        assert_eq!(related_titles(&json!({"recommendations":{"results":many}}),"movie",1).len(),18);
        assert!(related_titles(&json!({}),"movie",1).is_empty());
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
