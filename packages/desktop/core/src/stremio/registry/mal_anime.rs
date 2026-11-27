//! Profile-owned MAL export metadata. The MAL ID is not a playback ID.
use super::Result;
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use std::collections::BTreeSet;

const MAX_ENTRIES:usize=3000;
const MAX_BYTES:usize=2*1024*1024;

#[derive(Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(rename_all="kebab-case")]
enum Status{Active,Completed,OnHold,Dropped,Planned}

#[derive(Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Entry{
    mal_id:u32,title:String,status:Status,progress:u32,total:u32,score:u8,
    format:String,volumes_read:u32,volumes_total:u32,
}
fn label(value:&str,max:usize)->bool{
    !value.is_empty()&&value==value.trim()&&value.encode_utf16().count()<=max&&
        !value.chars().any(char::is_control)
}
fn validate(rows:&[Entry])->Result<()>{
    if rows.len()>MAX_ENTRIES{return Err("mal-limit");}
    let mut ids=BTreeSet::new();
    if rows.iter().any(|row|row.mal_id==0||row.mal_id>2147483647||!ids.insert(row.mal_id)||
        !label(&row.title,512)||!label(&row.format,32)||row.progress>10_000_000||
        row.total>10_000_000||row.score>10||row.volumes_read!=0||row.volumes_total!=0){
        return Err("mal-invalid");
    }
    if serde_json::to_vec(rows).map_err(|_|"mal-invalid")?.len()>MAX_BYTES{return Err("mal-limit");}
    Ok(())
}

#[derive(Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(super) struct SourceMatch{
    pub(super) mal_id:u32,pub(super) source_id:u32,media_type:String,item_id:String,name:String,
}
fn validate_matches(entries:&[Entry],matches:&[SourceMatch])->Result<()>{
    let mut ids=BTreeSet::new();let mut identities=BTreeSet::new();
    for row in matches{
        let entry=entries.iter().find(|entry|entry.mal_id==row.mal_id).ok_or("mal-invalid")?;
        let movie=entry.format.eq_ignore_ascii_case("movie");
        if row.source_id==0||!ids.insert(row.mal_id)||!identities.insert((&row.media_type,&row.item_id))||
            !(row.media_type=="anime"||row.media_type==if movie{"movie"}else{"series"})||
            !super::super::id_valid(&row.item_id)||!label(&row.name,512){return Err("mal-invalid");}
    }
    let size=serde_json::to_vec(entries).map_err(|_|"mal-invalid")?.len()+if matches.is_empty(){0}else{serde_json::to_vec(matches).map_err(|_|"mal-invalid")?.len()};
    if size>MAX_BYTES{return Err("mal-limit");}
    Ok(())
}

#[derive(Clone,Default)]
pub(super) struct Collection{entries:Vec<Entry>,matches:Vec<SourceMatch>}
impl Collection{
    pub(super) fn restored(entries:Vec<Entry>,matches:Vec<SourceMatch>)->Result<Self>{
        validate(&entries).map_err(|_|"profile-store")?;
        validate_matches(&entries,&matches).map_err(|_|"profile-store")?;
        Ok(Self{entries,matches})
    }
    pub(super) fn saved(&self)->Vec<Entry>{self.entries.clone()}
    pub(super) fn saved_matches(&self)->Vec<SourceMatch>{self.matches.clone()}
    pub(super) fn list(&self)->Value{json!({"entries":self.entries,"matches":self.matches})}
    pub(super) fn assign(&mut self,mal_id:u32,source_id:u32,media_type:String,item_id:String,name:String)->Result<Value>{
        let mut next=self.matches.clone();next.retain(|row|row.mal_id!=mal_id);
        next.push(SourceMatch{mal_id,source_id,media_type,item_id,name});
        validate_matches(&self.entries,&next)?;
        self.matches=next;Ok(self.list())
    }
    pub(super) fn unassign(&mut self,mal_id:u32)->Result<Value>{
        if !self.entries.iter().any(|row|row.mal_id==mal_id){return Err("mal-invalid");}
        self.matches.retain(|row|row.mal_id!=mal_id);Ok(self.list())
    }
    pub(super) fn remove_source(&mut self,source_id:u32){self.matches.retain(|row|row.source_id!=source_id);}
    pub(super) fn import(&mut self,incoming:Vec<Entry>)->Result<Value>{
        validate(&incoming)?;
        let mut next=self.entries.clone();
        let mut ids:BTreeSet<u32>=next.iter().map(|row|row.mal_id).collect();
        // Reimport is additive; conflicting existing metadata is not a
        // synchronization request or permission to overwrite local history.
        next.extend(incoming.into_iter().filter(|row|ids.insert(row.mal_id)));
        validate(&next)?;
        validate_matches(&next,&self.matches)?;
        self.entries=next;
        Ok(self.list())
    }
    pub(super) fn remove(&mut self,mal_id:u32)->Result<Value>{
        if mal_id==0||mal_id>2147483647{return Err("mal-invalid");}
        self.entries.retain(|row|row.mal_id!=mal_id);
        self.matches.retain(|row|row.mal_id!=mal_id);
        Ok(self.list())
    }
}

#[cfg(test)]
mod tests{
    use super::*;
    fn entry(id:u32,format:&str)->Entry{
        Entry{mal_id:id,title:format!("Fixture {id}"),status:Status::Active,
            progress:3,total:12,score:8,format:format.into(),volumes_read:0,volumes_total:0}
    }
    #[test]
    fn additive_import_is_bounded_and_does_not_change_existing_progress(){
        let mut c=Collection::default();
        let original=entry(123,"TV");
        c.import(vec![original.clone()]).unwrap();
        let mut changed=original.clone();changed.progress=1;
        c.import(vec![changed,entry(456,"Movie")]).unwrap();
        assert_eq!(c.list()["entries"][0]["progress"],3);
        assert_eq!(c.list()["entries"][1]["format"],"Movie");
        let before=c.list();
        assert_eq!(c.import(vec![entry(7,"TV"),entry(7,"TV")]),Err("mal-invalid"));
        let mut invalid=entry(7,"TV");invalid.volumes_read=3;
        assert_eq!(c.import(vec![invalid]),Err("mal-invalid"));
        assert_eq!(c.list(),before);
        assert_eq!(Collection::restored(c.saved(),c.saved_matches()).unwrap().list(),before);
        c.remove(456).unwrap();assert_eq!(c.list()["entries"].as_array().unwrap().len(),1);
        assert_eq!(c.remove(0),Err("mal-invalid"));
    }
    #[test]
    fn saved_matches_are_validated_and_removed_with_owner(){
        let mut c=Collection::default();c.import(vec![entry(7,"TV"),entry(8,"Movie"),entry(9,"Movie")]).unwrap();
        assert!(c.assign(7,1,"movie".into(),"tt123".into(),"Wrong format".into()).is_err());
        assert!(c.assign(1,1,"movie".into(),"tt123".into(),"Unknown MAL entry".into()).is_err());
        assert!(c.assign(8,1,"movie".into(),"https://example.test/secret".into(),"Invalid identity".into()).is_err());
        c.assign(8,1,"movie".into(),"tt123".into(),"Film".into()).unwrap();
        assert!(c.assign(9,2,"movie".into(),"tt123".into(),"Duplicate film".into()).is_err());
        c.assign(7,2,"anime".into(),"kitsu:7".into(),"Series".into()).unwrap();
        let mut restored=Collection::restored(c.saved(),c.saved_matches()).unwrap();
        assert_eq!(restored.list(),c.list());
        restored.remove_source(1);assert_eq!(restored.list()["matches"].as_array().unwrap().len(),1);
        restored.remove(7).unwrap();assert_eq!(restored.list()["matches"],json!([]));
        c.unassign(8).unwrap();assert_eq!(c.list()["matches"].as_array().unwrap().len(),1);
        assert!(Collection::restored(vec![entry(8,"Movie")],c.saved_matches()).is_err());
    }
    #[test]
    fn invalid_saved_data_is_never_replaced_with_an_empty_collection(){
        let duplicate=entry(1,"TV");
        assert!(Collection::restored(vec![duplicate.clone(),duplicate],vec![]).is_err());
        let oversized=(1..=MAX_ENTRIES as u32+1).map(|id|entry(id,"TV")).collect();
        assert!(Collection::restored(oversized,vec![]).is_err());
    }
}
