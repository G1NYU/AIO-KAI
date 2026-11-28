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
    // Account imports are local resume points, never newly watched events.
    #[serde(default,skip_serializing_if="std::ops::Not::not")]
    imported_stremio:bool,
}
#[derive(Clone, Default)]
pub(super) struct History{rows:Vec<Entry>}
impl History{
    pub(super) fn list(&self)->Value{
        json!({"history":self.rows.iter().map(|row|json!({"progress":row.progress,"updatedAt":row.updated_at,"importedStremio":row.imported_stremio})).collect::<Vec<_>>()})
    }
    /// Merge unfinished account resume points without replacing local progress,
    /// marking them watched, or enqueuing external tracking events.
    pub(super) fn merge_stremio(&mut self,rows:Vec<Entry>)->usize{
        let mut added=0;
        for row in rows{
            // Never evict existing local progress to make room for an import.
            if self.rows.len()>=LIMIT{break;}
            if self.rows.iter().any(|old|old.progress.media_type==row.progress.media_type&&old.progress.item_id==row.progress.item_id){continue;}
            self.rows.push(row);
            added+=1;
        }
        self.rows.sort_by(|a,b|b.updated_at.cmp(&a.updated_at));
        added
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
        self.rows.insert(0,Entry{progress,updated_at:at,viewing_id,refract_recorded,imported_stremio:false});
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

fn imdb_id(id:&str)->bool{
    id.strip_prefix("tt").is_some_and(|digits|!digits.is_empty()&&digits.len()<=12&&digits.bytes().all(|b|b.is_ascii_digit()))
}
// Stremio core serializes UTC DateTime values as RFC3339. Preserve the
// original timestamp rather than making every imported title look new.
fn utc_millis(raw:&str)->Option<u64>{
    let raw=raw.strip_suffix('Z').or_else(||raw.strip_suffix("+00:00"))?;
    if raw.len()<19||!raw.is_ascii(){return None;}
    let b=raw.as_bytes();
    if [b[4],b[7],b[10],b[13],b[16]]!=[b'-',b'-',b'T',b':',b':']{return None;}
    let num=|lo:usize,hi:usize|->Option<u64>{
        let s=raw.get(lo..hi)?;
        if s.is_empty()||!s.bytes().all(|v|v.is_ascii_digit()){return None;}s.parse().ok()
    };
    let year=num(0,4)?;let month=num(5,7)?;let day=num(8,10)?;
    let hour=num(11,13)?;let minute=num(14,16)?;let sec=num(17,19)?;
    if !(1970..=9999).contains(&year)||!(1..=12).contains(&month)||hour>23||minute>59||sec>59{return None;}
    let leap=|y:u64|y%4==0&&(y%100!=0||y%400==0);
    let months=[31,if leap(year){29}else{28},31,30,31,30,31,31,30,31,30,31];
    if day==0||day>months[month as usize-1]{return None;}
    let fraction=if raw.len()==19{0}else{
        let frac=raw.get(19..)?.strip_prefix('.')?;
        if frac.is_empty()||frac.len()>9||!frac.bytes().all(|v|v.is_ascii_digit()){return None;}
        let mut ms=0;for (i,d) in frac.bytes().take(3).enumerate(){ms+=u64::from(d-b'0')*[100,10,1][i];}ms
    };
    let leaps=|y:u64|y/4-y/100+y/400;
    let days=(year-1970)*365+leaps(year-1)-leaps(1969)+months[..month as usize-1].iter().sum::<u64>()+day-1;
    let ms=((days*24+hour)*60*60+minute*60+sec)*1000+fraction;
    (ms>0&&ms<=253402300799999).then_some(ms)
}
/// Stremio's read-only datastoreGet returns a libraryItem array. Only
/// exact ordinary IMDb movie/episode routes with unfinished progress are
/// imported; custom anime namespaces are intentionally not copied.
pub(super) fn stremio_resume(value:&Value)->Result<Vec<Entry>>{
    let rows=value.as_array().ok_or("account-response")?;
    let mut imported=Vec::new();
    for row in rows{
        let entry=(||->Option<Entry>{
            let id=row["_id"].as_str()?;
            let media=row["type"].as_str()?;
            if !imdb_id(id)||!matches!(media,"movie"|"series")||row["removed"].as_bool().unwrap_or(true)&&!row["temp"].as_bool().unwrap_or(false){return None;}
            let state=&row["state"];
            let position=state["timeOffset"].as_u64()?;
            let duration=state["duration"].as_u64()?;
            if position==0||position>=duration||duration>MAX_MS{return None;}
            let video=state["video_id"].as_str().or_else(||(media=="movie").then_some(id))?;
            if media=="movie"{if video!=id{return None;}}
            else{
                let suffix=video.strip_prefix(id)?.strip_prefix(':')?;
                let (season,episode)=suffix.split_once(':')?;
                if season.is_empty()||episode.is_empty()||!season.bytes().all(|b|b.is_ascii_digit())||!episode.bytes().all(|b|b.is_ascii_digit())||season.parse::<u32>().is_err()||episode.parse::<u32>().is_err(){return None;}
            }
            let title=row["name"].as_str()?.trim();
            if title.contains("://"){return None;}
            let updated_at=state["lastWatched"].as_str().and_then(utc_millis).or_else(||row["_mtime"].as_str().and_then(utc_millis))?;
            let progress=Progress{media_type:media.into(),item_id:id.into(),video_id:video.into(),title:title.into(),episode_title:None,position_ms:position,duration_ms:duration,completed:false};
            if !progress.valid(){return None;}
            Some(Entry{progress,updated_at,viewing_id:None,refract_recorded:true,imported_stremio:true})
        })();
        if let Some(entry)=entry{imported.push(entry);}
    }
    imported.sort_by(|a,b|b.updated_at.cmp(&a.updated_at));
    let mut seen=BTreeSet::new();
    imported.retain(|row|seen.insert((row.progress.media_type.clone(),row.progress.item_id.clone())));
    imported.truncate(LIMIT);
    Ok(imported)
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
    fn imported_stremio_progress_is_exact_bounded_and_does_not_replace_local(){
        assert_eq!(utc_millis("2024-02-29T12:34:56.123Z"),Some(1709210096123));
        assert!(utc_millis("2023-02-29T00:00:00Z").is_none());
        let row=|id:&str,media:&str,video:&str,offset:u64|json!({
            "_id":id,"type":media,"name":"Fixture","removed":false,"temp":false,
            "_mtime":"2024-02-29T12:34:56.123Z",
            "state":{"timeOffset":offset,"duration":60000,"video_id":video}
        });
        let mut removed=row("tt90","movie","tt90",12000);removed["removed"]=json!(true);
        let payload=json!([row("tt1","movie","tt1",12000),row("tt2","series","tt2:1:7",45000),
            row("tt3","series","tt4:1:7",12000),row("kitsu:4","anime","kitsu:4:1",12000),
            row("tt5","movie","tt5",60000),removed,row("tt2","series","tt2:1:7",45000)]);
        let imported=stremio_resume(&payload).unwrap();
        assert_eq!(imported.len(),2);
        assert_eq!(imported[1].progress.video_id,"tt2:1:7");
        let mut history=History::default();
        history.record(progress("tt1"),None).unwrap();
        assert_eq!(history.merge_stremio(imported.clone()),1);
        assert_eq!(history.merge_stremio(imported),0);
        assert_eq!(history.rows.len(),2);
        assert!(!history.rows[0].imported_stremio);
        assert!(history.rows[1].imported_stremio&&history.rows[1].refract_recorded);
        let restored=History::restore(history.saved()).unwrap();
        assert_eq!(restored.list()["history"][1]["importedStremio"],true);
        let mut local=restored.rows[1].progress.clone();local.position_ms=50000;
        let mut restored=restored;restored.record(local,None).unwrap();
        assert_eq!(restored.list()["history"][0]["importedStremio"],false);
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
