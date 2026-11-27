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
    pub(super) source_id:u32,
    pub(super) media_type:String,
    pub(super) catalog_id:String,
    pub(super) extras:BTreeMap<String,String>,
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
            Action::Install{..}|Action::SetEnabled{..}|Action::Remove{..}|Action::Move{..}|Action::ImportApply{..}|Action::ImportRetry{..}),
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
            let source=match profiles.and_then(|p|p.browse_source(action.profile_id,action.source_id)){
                Ok(source)=>source,
                Err(error)=>{respond(emit,request,Err(error));continue;},
            };
            let (tx,rx)=mpsc::sync_channel(1);
            match thread::Builder::new().name("tsugi-watch-catalogue".into()).spawn(move||{
                let result=source.endpoint.catalog(&source.manifest,&action.media_type,&action.catalog_id,&action.extras)
                    .map(|page|{
                        let mut data=catalog_response(&page,action.source_id,&action.media_type,&action.catalog_id);
                        data["profileId"]=json!(action.profile_id);
                        data
                    });
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
