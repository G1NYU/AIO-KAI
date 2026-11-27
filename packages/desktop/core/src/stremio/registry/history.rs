//! Bounded, local-only watch progress. Exact item/video identities are never
//! mapped to a different provider or inferred from a display title.
use super::super::{id_valid, text_valid, type_valid, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeSet, time::{SystemTime, UNIX_EPOCH}};

const LIMIT:usize=100;
const MAX_MS:u64=604800000;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct Progress {
    pub media_type:String,
    pub item_id:String,
    pub video_id:String,
    pub title:String,
    pub episode_title:Option<String>,
    pub position_ms:u64,
    pub duration_ms:u64,
    pub completed:bool,
}
impl Progress {
    fn valid(&self)->bool{
        type_valid(&self.media_type)&&id_valid(&self.item_id)&&id_valid(&self.video_id)&&
        text_valid(&self.title,512)&&self.episode_title.as_ref().is_none_or(|s|text_valid(s,512))&&
        self.duration_ms>0&&self.duration_ms<=MAX_MS&&self.position_ms<=self.duration_ms&&
        (!self.completed||self.position_ms==self.duration_ms)
    }
    fn identity(&self)->(&str,&str,&str){(&self.media_type,&self.item_id,&self.video_id)}
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub(super) struct Entry{
    progress:Progress,
    updated_at:u64,
}
#[derive(Clone, Default)]
pub(super) struct History{rows:Vec<Entry>}
impl History{
    pub(super) fn list(&self)->Value{json!({"history":self.rows})}
    pub(super) fn saved(&self)->Vec<Entry>{self.rows.clone()}
    pub(super) fn restore(rows:Vec<Entry>)->Result<Self>{
        let mut seen=BTreeSet::new();
        if rows.len()>LIMIT||rows.iter().any(|row|!row.progress.valid()||
            row.updated_at==0||row.updated_at>253402300799999||!seen.insert(row.progress.identity())){
            return Err("profile-store");
        }
        drop(seen);
        Ok(Self{rows})
    }
    pub(super) fn record(&mut self,progress:Progress)->Result<Value>{
        if !progress.valid(){return Err("invalid-watch-progress");}
        let updated_at=SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"profile-store")?.as_millis();
        if updated_at==0||updated_at>253402300799999{return Err("profile-store");}
        self.rows.retain(|row|row.progress.identity()!=progress.identity());
        self.rows.insert(0,Entry{progress,updated_at:updated_at as u64});
        self.rows.truncate(LIMIT);
        Ok(json!({"saved":true}))
    }
    pub(super) fn remove(&mut self,media_type:&str,item_id:&str,video_id:&str)->Result<Value>{
        if !type_valid(media_type)||!id_valid(item_id)||!id_valid(video_id){return Err("invalid-watch-progress");}
        self.rows.retain(|row|row.progress.identity()!=(media_type,item_id,video_id));
        Ok(self.list())
    }
}
#[cfg(test)]
mod tests{
    use super::*;
    fn progress(id:&str)->Progress{
        Progress{media_type:"movie".into(),item_id:id.into(),video_id:id.into(),title:"Fixture".into(),episode_title:None,position_ms:12000,duration_ms:60000,completed:false}
    }
    #[test]
    fn exact_identity_bound_rewatch_and_invalid_snapshot(){
        let mut history=History::default();
        for n in 0..101{history.record(progress(&format!("tt{n}"))).unwrap();}
        assert_eq!(history.rows.len(),LIMIT);
        assert_eq!(history.rows[0].progress.item_id,"tt100");
        let mut updated=progress("tt100");
        updated.position_ms=60000;updated.completed=true;
        history.record(updated).unwrap();
        assert!(history.rows[0].progress.completed);
        history.record(progress("tt100")).unwrap();
        assert!(!history.rows[0].progress.completed);
        assert_eq!(history.rows.len(),LIMIT);
        let mut invalid=progress("tt100");invalid.position_ms=60001;
        assert_eq!(history.record(invalid),Err("invalid-watch-progress"));
        let mut rows=history.saved();rows[1]=rows[0].clone();
        assert!(History::restore(rows).is_err());
        history.remove("movie","tt100","tt100").unwrap();
        assert_eq!(history.rows.len(),LIMIT-1);
    }
}
