//! Profile-local favorites and ordered watch queue. Only public title metadata is persisted.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use super::super::{id_valid, public_poster, text_valid, type_valid, Result};

const LIMIT:usize=250;
#[derive(Clone,Debug,Deserialize,Serialize,PartialEq,Eq)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Entry {
    pub id:String,
    pub media_type:String,
    pub name:String,
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub poster:Option<String>,
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub background:Option<String>,
}
impl Entry {
    fn valid(&self)->bool{
        id_valid(&self.id)&&type_valid(&self.media_type)&&text_valid(&self.name,512)
        && [&self.poster,&self.background].iter().all(|value|value.as_ref().is_none_or(|url|public_poster(&json!(url)).as_ref()==Some(url)))
    }
    fn same(&self,other:&Self)->bool{self.id==other.id&&self.media_type==other.media_type}
}
#[derive(Clone,Default,Deserialize,Serialize)]
#[serde(deny_unknown_fields)]
pub struct Collections{
    favorites:Vec<Entry>,
    queue:Vec<Entry>,
}
impl Collections{
    pub fn restored(self)->Result<Self>{
        for rows in [&self.favorites,&self.queue]{
            if rows.len()>LIMIT||rows.iter().any(|r|!r.valid())||rows.iter().enumerate().any(|(i,r)|rows[..i].iter().any(|a|a.same(r))){
                return Err("profile-store");
            }
        }
        Ok(self)
    }
    pub fn list(&self)->Value{json!({"favorites":self.favorites,"queue":self.queue})}
    pub fn set(&mut self,collection:&str,item:Entry,enabled:bool)->Result<Value>{
        if !item.valid(){return Err("invalid-item");}
        let rows=match collection{"favorites"=>&mut self.favorites,"queue"=>&mut self.queue,_=>return Err("invalid-item")};
        if enabled{
            if let Some(row)=rows.iter_mut().find(|r|r.same(&item)){*row=item;}
            else if rows.len()>=LIMIT{return Err("collection-limit");}
            else{rows.push(item);}
        }else{rows.retain(|r|!r.same(&item));}
        Ok(self.list())
    }
}
#[cfg(test)]
mod tests{
    use super::*;
    fn item(id:&str)->Entry{Entry{id:id.into(),name:"Test title".into(),media_type:"movie".into(),poster:None,background:None}}
    #[test]
    fn ordered_queue_deduplicates_and_favorites_are_independent(){
        let mut c=Collections::default();
        c.set("queue",item("tt1"),true).unwrap();
        c.set("queue",item("tt2"),true).unwrap();
        c.set("queue",item("tt1"),true).unwrap();
        c.set("favorites",item("tt1"),true).unwrap();
        let restored:Collections=serde_json::from_value(serde_json::to_value(&c).unwrap()).unwrap();
        let mut restored=restored.restored().unwrap();
        assert_eq!(restored.list()["queue"][0]["id"],"tt1");
        assert_eq!(restored.list()["queue"].as_array().unwrap().len(),2);
        restored.set("queue",item("tt1"),false).unwrap();
        assert_eq!(restored.list()["favorites"].as_array().unwrap().len(),1);
        assert_eq!(restored.list()["queue"][0]["id"],"tt2");
    }
    #[test]
    fn rejects_private_artwork(){
        let mut c=Collections::default();
        let mut entry=item("tt1");
        entry.poster=Some("https://example.com/private?token=abc".into());
        assert!(c.set("favorites",entry,true).is_err());
    }
}
