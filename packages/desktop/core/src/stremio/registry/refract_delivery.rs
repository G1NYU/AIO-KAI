//! Background Refract delivery, owned by the native profile actor.
//! A single network flight avoids simultaneous writes and never runs on the
//! actor or playback thread. The actor alone commits encrypted snapshots.
use super::{Action,Outbound,profiles::Profiles,refract::{Delivery,DeliveryResult},store::Store};
use std::{sync::mpsc,thread,time::{Duration,Instant}};

const PACE:Duration=Duration::from_secs(3);
const DISK_RETRY:Duration=Duration::from_secs(5);

struct Flight{
    profile_id:u32,
    delivery:Delivery,
    rx:mpsc::Receiver<DeliveryResult>,
    thread:Option<thread::JoinHandle<()>>,
    result:Option<DeliveryResult>,
}
impl Drop for Flight{
    fn drop(&mut self){
        self.delivery.cancel_before_write();
        // Only the dedicated native actor waits during shutdown. Keep the
        // exclusive store handle alive until this bounded request finishes.
        if let Some(handle)=self.thread.take(){let _=handle.join();}
    }
}
pub(super) struct AutoSync{flight:Option<Flight>,next_at:Instant}
impl AutoSync{
    pub(super) fn new()->Self{Self{flight:None,next_at:Instant::now()}}
    pub(super) fn permit(&self,action:&Action)->bool{
        let Some(flight)=&self.flight else{return true;};
        match action{
            Action::ProfileSwitch{profile_id} if *profile_id!=flight.profile_id=>{
                // Already-authorized writes may finish for the old profile.
                // A lookup that has not begun writing must not cross the switch.
                flight.delivery.cancel_before_write();true
            }
            Action::ProfileRemove{profile_id,..} if *profile_id==flight.profile_id=>flight.delivery.cancel_before_write(),
            Action::ProfileRequest{profile_id,action}=>{
                let sensitive=(*profile_id==flight.profile_id&&matches!(action.as_ref(),
                    Action::RefractConnect{..}|Action::RefractEnable{..}|Action::RefractDisconnect{..}))||
                    matches!(action.as_ref(),Action::RefractWatchlist{..});
                !sensitive||flight.delivery.cancel_before_write()
            }
            _=>true,
        }
    }
    pub(super) fn tick(&mut self,storage:&Store,profiles:&mut Profiles,emit:&impl Fn(Outbound)){
        if let Some(flight)=&mut self.flight{
            if flight.result.is_none(){
                match flight.rx.try_recv(){
                    Ok(result)=>flight.result=Some(result),
                    Err(mpsc::TryRecvError::Empty)=>return,
                    Err(mpsc::TryRecvError::Disconnected)=>flight.result=Some(flight.delivery.interrupted()),
                }
            }
            if Instant::now()<self.next_at{return;}
            let mut next=profiles.clone();
            let result=next.finish_refract(flight.profile_id,&flight.delivery,flight.result.as_ref().unwrap());
            match result.and_then(|status|{
                if status.is_some(){storage.save(&next)?;}
                Ok(status)
            }){
                Ok(Some(status))=>{
                    *profiles=next;
                    emit(Outbound::RefractStatusChanged{profile_id:flight.profile_id,data:Some(status),error:None});
                }
                Ok(None)=>{},
                Err(error)=>{
                    // A remote success whose local commit failed must not be
                    // resent in a loop. Retain the result and retry only disk
                    // persistence; the previous durable queue remains intact.
                    self.next_at=Instant::now()+DISK_RETRY;
                    emit(Outbound::RefractStatusChanged{profile_id:flight.profile_id,data:None,error:Some(error.into())});
                    return;
                }
            }
            self.flight=None;
            self.next_at=Instant::now()+PACE;
            return;
        }
        if Instant::now()<self.next_at{return;}
        self.next_at=Instant::now()+PACE;
        let Some((profile_id,delivery))=profiles.refract_delivery()else{return;};
        let (tx,rx)=mpsc::sync_channel(1);
        let task=delivery.clone();
        match thread::Builder::new().name("tsugi-refract-delivery".into()).spawn(move||{
            let _=tx.send(task.run());
        }){
            Ok(handle)=>self.flight=Some(Flight{profile_id,delivery,rx,thread:Some(handle),result:None}),
            Err(_)=>emit(Outbound::RefractStatusChanged{profile_id,data:None,error:Some("refract-network".into())}),
        }
    }
}

#[cfg(test)]
mod tests{
    use super::*;
    use serde_json::{json,Value};
    use std::{cell::RefCell,fs,path::PathBuf};
    struct Temp(PathBuf);
    impl Temp{
        fn new()->Self{
            let mut bytes=[0u8;16];getrandom::fill(&mut bytes).unwrap();
            let id:String=bytes.iter().map(|b|format!("{b:02x}")).collect();
            let root=std::env::temp_dir().join(format!("tsugi-refract-delivery-fixture-{id}"));
            fs::create_dir(&root).unwrap();Self(root)
        }
    }
    impl Drop for Temp{fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
    fn profiles()->Profiles{
        let snapshot=json!({"version":1,"active":1,"sequence":2,"profiles":[
            {"id":1,"name":"Default","sources":[],"refract":{
                "key":"rfk_fixture-only","member_id":"fixture-member","username":"Fixture","enabled":true,
                "jobs":[{"identity":{"provider":"imdb","id":"tt123","kind":"movie","season":null,"number":null},
                    "watched_at":1609459200123u64,"request_id":"00000000-0000-4000-8000-000000000001","attempts":0}],
                "sent":0,"skipped":0,"retry_at":0,"last_error":null}},
            {"id":2,"name":"Second","sources":[]}
        ]});
        Profiles::decode(&serde_json::to_vec(&snapshot).unwrap()).unwrap()
    }
    fn status(profiles:&mut Profiles,profile_id:u32)->Value{
        profiles.execute(Action::ProfileRequest{profile_id,action:Box::new(Action::RefractStatus)}).unwrap()
    }
    fn flight(profiles:&Profiles)->Flight{
        let (profile_id,delivery)=profiles.refract_delivery().unwrap();
        let result=delivery.succeeded_for_test();
        let (_tx,rx)=mpsc::sync_channel(1);
        Flight{profile_id,delivery,rx,thread:None,result:Some(result)}
    }
    #[test]
    fn completion_survives_switch_and_disk_failure_without_new_write(){
        let root=Temp::new();
        let (store,_)=Store::open(&root.0).unwrap();
        let mut profiles=profiles();store.save(&profiles).unwrap();
        let mut sync=AutoSync{flight:Some(flight(&profiles)),next_at:Instant::now()};
        let disconnect=Action::ProfileRequest{profile_id:1,action:Box::new(Action::RefractDisconnect{discard_pending:true})};
        assert!(!sync.permit(&disconnect));
        let switch=Action::ProfileSwitch{profile_id:2};
        assert!(sync.permit(&switch));profiles.execute(switch).unwrap();
        store.save(&profiles).unwrap();
        assert!(!sync.permit(&Action::ProfileRemove{profile_id:1,confirmed_name:"Default".into()}));
        assert_eq!(status(&mut profiles,2)["connected"],false);
        let target=root.0.join("stremio").join("profiles-v1.dpapi");
        let original=fs::read(&target).unwrap();
        fs::remove_file(&target).unwrap();fs::create_dir(&target).unwrap();
        let events=RefCell::new(Vec::<Value>::new());
        let emit=|event:Outbound|events.borrow_mut().push(serde_json::to_value(event).unwrap());
        sync.tick(&store,&mut profiles,&emit);
        assert!(sync.flight.as_ref().unwrap().result.is_some());
        assert_eq!(events.borrow()[0]["error"],"profile-store");
        assert_eq!(status(&mut profiles,2)["connected"],false);
        fs::remove_dir(&target).unwrap();fs::write(&target,original).unwrap();
        sync.next_at=Instant::now();
        sync.tick(&store,&mut profiles,&emit);
        assert!(sync.flight.is_none());
        assert_eq!(events.borrow()[1]["type"],"refract-status-changed");
        assert_eq!(events.borrow()[1]["profileId"],1);
        assert_eq!(events.borrow()[1]["data"]["pending"],0);
        assert_eq!(events.borrow()[1]["data"]["sent"],1);
        assert_eq!(status(&mut profiles,2)["connected"],false);
        drop(store);
        let (_store,mut restored)=Store::open(&root.0).unwrap();
        assert_eq!(status(&mut restored,2)["connected"],false);
        restored.execute(Action::ProfileSwitch{profile_id:1}).unwrap();
        assert_eq!(status(&mut restored,1)["sent"],1);
        assert!(restored.refract_delivery().is_none());
    }
    #[test]
    fn lookup_is_cancelled_before_switch_or_disconnect(){
        let profiles=profiles();
        let (profile_id,delivery)=profiles.refract_delivery().unwrap();
        let (_tx,rx)=mpsc::sync_channel(1);
        let sync=AutoSync{flight:Some(Flight{profile_id,delivery,rx,thread:None,result:None}),next_at:Instant::now()};
        assert!(sync.permit(&Action::ProfileSwitch{profile_id:2}));
        assert!(sync.permit(&Action::ProfileRemove{profile_id:1,confirmed_name:"Default".into()}));
        assert!(sync.permit(&Action::ProfileRequest{profile_id:1,action:Box::new(Action::RefractDisconnect{discard_pending:true})}));
        let result=sync.flight.as_ref().unwrap().delivery.interrupted();
        let mut next=profiles.clone();
        assert!(next.finish_refract(1,&sync.flight.as_ref().unwrap().delivery,&result).unwrap().is_none());
        assert_eq!(status(&mut next,1)["pending"],1);
    }
}
