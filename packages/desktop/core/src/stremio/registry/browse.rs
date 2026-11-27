//! Read-only catalogue work is independent of media and MAL review state.
//! Only the profile actor resolves configured endpoints and emits replies.
use super::super::CatalogPage;
use serde_json::{json,Value};
use std::collections::BTreeMap;
#[cfg(any(windows,test))]
use super::Action;
#[cfg(windows)]
use super::{Result,profiles::Profiles};
#[cfg(windows)]
use crate::bridge::Outbound;
#[cfg(windows)]
use std::{sync::mpsc,thread};

#[cfg_attr(not(windows),allow(dead_code))]
pub(super) struct BrowseRequest{
    pub(super) profile_id:u32,
    pub(super) kind:ReadKind,
}
#[cfg_attr(not(windows),allow(dead_code))]
pub(super) enum ReadKind{
    Catalog{source_id:u32,media_type:String,catalog_id:String,extras:BTreeMap<String,String>},
    TmdbSearch{query:String},
    TmdbTitle{media_type:String,item_id:String},
    TmdbSeason{tmdb_id:u64,season:u32},
}

pub(super) fn catalog_response(page:&CatalogPage,source_id:u32,media_type:&str,catalog_id:&str)->Value{
    let items:Vec<_>=page.items.iter().map(|item|json!({
        "id":item.id,"mediaType":item.kind,"name":item.name,"poster":item.poster,
        "background":item.background,"description":item.description,"imdbId":item.imdb_id,"identities":item.identities
    })).collect();
    json!({"sourceId":source_id,"mediaType":media_type,"catalogId":catalog_id,
        "items":items,"sourceCount":page.source_count,"nextSkip":page.next_skip})
}

#[cfg(any(windows,test))]
pub(super) fn changes_scope(action:&Action)->bool{
    match action{
        Action::ProfileSwitch{..}|Action::ProfileRemove{..}=>true,
        Action::ProfileRequest{action,..}=>matches!(action.as_ref(),
            Action::Install{..}|Action::SetEnabled{..}|Action::Remove{..}|Action::Move{..}|Action::ImportApply{..}|Action::ImportRetry{..}|Action::TmdbConnect{..}|Action::TmdbDisconnect),
        _=>false,
    }
}

#[cfg(windows)]
const MAX_FLIGHTS:usize=4;
#[cfg(windows)]
struct Flight{request:String,epoch:u64,rx:mpsc::Receiver<Result<Value>>}
#[cfg(windows)]
pub(super) struct Pool{
    pending:mpsc::Receiver<(String,BrowseRequest)>,
    flights:Vec<Flight>,
    epoch:u64,
}
#[cfg(windows)]
impl Pool{
    pub(super) fn new(pending:mpsc::Receiver<(String,BrowseRequest)>)->Self{
        Self{pending,flights:Vec::new(),epoch:0}
    }
    pub(super) fn invalidate(&mut self){self.epoch=self.epoch.wrapping_add(1);}
    pub(super) fn tick(&mut self,profiles:Result<&Profiles>,emit:&impl Fn(Outbound)){
        fn respond(emit:&impl Fn(Outbound),request:String,result:Result<Value>){
            let (data,error)=match result{Ok(value)=>(Some(value),None),Err(error)=>(None,Some(error.into()))};
            emit(Outbound::StremioResult{request,data,error});
        }
        let mut at=0;
        while at<self.flights.len(){
            let result=match self.flights[at].rx.try_recv(){
                Ok(result)=>result,
                Err(mpsc::TryRecvError::Empty)=>{at+=1;continue;},
                Err(mpsc::TryRecvError::Disconnected)=>Err("request"),
            };
            let flight=self.flights.swap_remove(at);
            respond(emit,flight.request,if flight.epoch==self.epoch{result}else{Err("profile-changed")});
        }
        // Bound both the queue and live HTTP requests. A slow provider never
        // holds up an already-finished sibling, nor can invalid requests starve
        // stateful commands by draining an unbounded queue in one tick.
        for _ in 0..8{
            if self.flights.len()>=MAX_FLIGHTS{break;}
            let Ok((request,action))=self.pending.try_recv()else{break;};
            let profile_id=action.profile_id;
            let work:Result<Box<dyn FnOnce()->Result<Value>+Send>>=match action.kind{
                ReadKind::Catalog{source_id,media_type,catalog_id,extras}=>profiles.and_then(|p|p.browse_source(profile_id,source_id)).map(|source|Box::new(move||source.endpoint.catalog(&source.manifest,&media_type,&catalog_id,&extras).map(|page|catalog_response(&page,source_id,&media_type,&catalog_id))) as Box<dyn FnOnce()->Result<Value>+Send>),
                ReadKind::TmdbSearch{query}=>profiles.and_then(|p|p.browse_tmdb(profile_id)).map(|tmdb|Box::new(move||tmdb.search(&query)) as Box<dyn FnOnce()->Result<Value>+Send>),
                ReadKind::TmdbTitle{media_type,item_id}=>profiles.and_then(|p|p.browse_tmdb(profile_id)).map(|tmdb|Box::new(move||tmdb.title(&media_type,&item_id)) as Box<dyn FnOnce()->Result<Value>+Send>),
                ReadKind::TmdbSeason{tmdb_id,season}=>profiles.and_then(|p|p.browse_tmdb(profile_id)).map(|tmdb|Box::new(move||tmdb.season(tmdb_id,season)) as Box<dyn FnOnce()->Result<Value>+Send>),
            };
            let work=match work{Ok(work)=>work,Err(error)=>{respond(emit,request,Err(error));continue;}};
            let (tx,rx)=mpsc::sync_channel(1);
            match thread::Builder::new().name("tsugi-watch-metadata".into()).spawn(move||{
                let result=work().map(|mut data|{data["profileId"]=json!(profile_id);data});
                let _=tx.send(result);
            }){
                Ok(_)=>self.flights.push(Flight{request,epoch:self.epoch,rx}),
                Err(_)=>respond(emit,request,Err("request")),
            }
        }
    }
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn only_scope_changes_expire_browse_results(){
        assert!(changes_scope(&Action::ProfileSwitch{profile_id:2}));
        assert!(changes_scope(&Action::ProfileRequest{profile_id:1,action:Box::new(Action::Remove{source_id:3})}));
        assert!(!changes_scope(&Action::ProfileRequest{profile_id:1,action:Box::new(Action::WatchHistory)}));
        assert!(!changes_scope(&Action::ProfileRequest{profile_id:1,action:Box::new(Action::PrepareMedia{review_id:3,option_index:0,start_ms:0})}));
    }
}
