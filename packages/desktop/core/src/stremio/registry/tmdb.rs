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
