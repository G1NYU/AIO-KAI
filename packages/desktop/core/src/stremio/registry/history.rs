//! Bounded, local-only watch progress. Exact item/video identities are never
//! mapped to a different provider or inferred from a display title.
use super::super::{id_valid, text_valid, type_valid, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeSet, time::{SystemTime, UNIX_EPOCH}};

const LIMIT:usize=100;
const MAX_MS:u64=604800000;

pub(super) fn valid_viewing_id(id:&str)->bool{
    id.len()==36&&id.bytes().enumerate().all(|(i,b)|if matches!(i,8|13|18|23){b==b'-'}else{b.is_ascii_hexdigit()})
}

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
    #[serde(default,skip_serializing_if="Option::is_none")]
    viewing_id:Option<String>,
    #[serde(default,skip_serializing_if="std::ops::Not::not")]
    refract_recorded:bool,
}
#[derive(Clone, Default)]
pub(super) struct History{rows:Vec<Entry>}
impl History{
    pub(super) fn list(&self)->Value{
        json!({"history":self.rows.iter().map(|row|json!({"progress":row.progress,"updatedAt":row.updated_at})).collect::<Vec<_>>()})
    }
    pub(super) fn saved(&self)->Vec<Entry>{self.rows.clone()}
    pub(super) fn completed_at(&self,progress:&Progress,viewing_id:Option<&str>)->Option<u64>{
        self.rows.iter().find(|row|row.progress.completed&&row.progress.identity()==progress.identity()&&
            viewing_id.is_none_or(|id|row.viewing_id.as_deref()==Some(id))).map(|row|row.updated_at)
    }
    pub(super) fn restore(rows:Vec<Entry>)->Result<Self>{
        let mut seen=BTreeSet::new();
        if rows.len()>LIMIT||rows.iter().any(|row|!row.progress.valid()||
            row.updated_at==0||row.updated_at>253402300799999||row.viewing_id.as_deref().is_some_and(|id|!valid_viewing_id(id))||!seen.insert(row.progress.identity())){
            return Err("profile-store");
        }
        drop(seen);
        Ok(Self{rows})
    }
    pub(super) fn record(&mut self,progress:Progress,viewing_id:Option<String>)->Result<Value>{
        if !progress.valid()||viewing_id.as_deref().is_some_and(|id|!valid_viewing_id(id)){return Err("invalid-watch-progress");}
        let updated_at=SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"profile-store")?.as_millis();
        if updated_at==0||updated_at>253402300799999{return Err("profile-store");}
        let at=if progress.completed{self.completed_at(&progress,viewing_id.as_deref()).unwrap_or(updated_at as u64)}else{updated_at as u64};
        let refract_recorded=self.rows.iter().any(|row|row.progress.identity()==progress.identity()
            &&row.viewing_id==viewing_id&&row.refract_recorded&&(viewing_id.is_some()||progress.completed));
        self.rows.retain(|row|row.progress.identity()!=progress.identity());
        self.rows.insert(0,Entry{progress,updated_at:at,viewing_id,refract_recorded});
        self.rows.truncate(LIMIT);
        Ok(json!({"saved":true}))
    }
    pub(super) fn claim_refract(&mut self)->Option<u64>{
        let row=self.rows.first_mut()?;
        if row.refract_recorded{return None;}
        row.refract_recorded=true;
        Some(row.updated_at)
    }
    pub(super) fn manual_completion(&self,media:&str,item:&str,video:&str,at:u64)->Result<(Progress,Option<String>)>{
        let row=self.rows.iter().find(|row|row.progress.identity()==(media,item,video)&&row.updated_at==at&&!row.progress.completed)
            .ok_or("watch-history-changed")?;
        let mut progress=row.progress.clone();
        progress.completed=true;
        progress.position_ms=progress.duration_ms;
        Ok((progress,row.viewing_id.clone()))
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
    fn viewing_identity_distinguishes_direct_rewatch_without_partial_checkpoint(){
        let mut history=History::default();
        let first="00000000-0000-4000-8000-000000000001";
        let second="00000000-0000-4000-8000-000000000002";
        let mut p=progress("tt100");p.position_ms=p.duration_ms;p.completed=true;
        history.record(p.clone(),Some(first.into())).unwrap();
        let timestamp=history.completed_at(&p,Some(first)).unwrap();
        assert!(history.completed_at(&p,Some(second)).is_none());
        history.record(p.clone(),Some(first.into())).unwrap();
        assert_eq!(history.completed_at(&p,Some(first)),Some(timestamp));
        assert!(!history.list().to_string().contains(first));
        let mut restored=History::restore(history.saved()).unwrap();
        assert_eq!(restored.completed_at(&p,Some(first)),Some(timestamp));
        restored.record(p.clone(),Some(second.into())).unwrap();
        assert!(restored.completed_at(&p,Some(first)).is_none());
        assert!(restored.completed_at(&p,Some(second)).is_some());
        assert_eq!(restored.record(p,Some("invalid".into())),Err("invalid-watch-progress"));
    }
    #[test]
    fn exact_identity_bound_rewatch_and_invalid_snapshot(){
        let mut history=History::default();
        for n in 0..101{history.record(progress(&format!("tt{n}")),None).unwrap();}
        assert_eq!(history.rows.len(),LIMIT);
        assert_eq!(history.rows[0].progress.item_id,"tt100");
        let mut updated=progress("tt100");
        updated.position_ms=60000;updated.completed=true;
        history.record(updated,None).unwrap();
        assert!(history.rows[0].progress.completed);
        history.record(progress("tt100"),None).unwrap();
        assert!(!history.rows[0].progress.completed);
        assert_eq!(history.rows.len(),LIMIT);
        let mut invalid=progress("tt100");invalid.position_ms=60001;
        assert_eq!(history.record(invalid,None),Err("invalid-watch-progress"));
        let mut rows=history.saved();rows[1]=rows[0].clone();
        assert!(History::restore(rows).is_err());
        history.remove("movie","tt100","tt100").unwrap();
        assert_eq!(history.rows.len(),LIMIT-1);
    }
}
