//! Bounded native provider fan-out. Completed providers become selectable
//! immediately; stale responses cannot create reviews for a new query.
use super::{Registry,VideoRoute,StreamQuery,MediaReview,Source,ItemResource,OptionSummary,Result,Declaration,json,Value,MAX_STREAM_ROUTES,REVIEW_TTL};
use std::{collections::{BTreeMap,VecDeque},time::Instant};
#[derive(Clone)]
pub(super) struct Progress{
    pub(super) id:u32,
    order:Vec<u32>,
    queued:VecDeque<u32>,
    groups:BTreeMap<u32,Value>,
}
pub(super) struct Job{profile_id:u32,query_id:u32,source:Source,routes:Vec<VideoRoute>}
pub(super) struct JobResult{pub(super) profile_id:u32,query_id:u32,source_id:u32,selected:usize,result:Result<Vec<OptionSummary>>}
impl Registry{
    pub(super) fn begin_streams(&mut self,kind:&str,video:&str,alternatives:&[VideoRoute])->Result<Value>{
        if !super::super::type_valid(kind)||!super::super::id_valid(video)||alternatives.len()>8||
            alternatives.iter().any(|r|!super::super::type_valid(&r.media_type)||!super::super::id_valid(&r.video_id)){return Err("invalid-resource");}
        self.media_review=None;self.stream_reviews.clear();self.stream_query=None;self.progressive=None;
        self.sequence=self.sequence.checked_add(1).ok_or("source-limit")?;
        let id=self.sequence;
        let mut routes=vec![VideoRoute{media_type:kind.to_owned(),video_id:video.to_owned()}];
        for route in alternatives{if !routes.iter().any(|r|r.media_type==route.media_type&&r.video_id==route.video_id){routes.push(route.clone());}}
        let mut progress=Progress{id,order:vec![],queued:VecDeque::new(),groups:BTreeMap::new()};
        let mut compatible=BTreeMap::new();
        for source in self.sources.iter().filter(|s|s.enabled&&s.manifest.resources.iter().any(|r|match r{Declaration::Name(name)|Declaration::Detailed{name,..}=>name=="stream"})){
            progress.order.push(source.id);
            let selected:Vec<_>=routes.iter().filter(|r|source.manifest.supports(ItemResource::Stream,&r.media_type,&r.video_id)).take(MAX_STREAM_ROUTES).cloned().collect();
            if selected.is_empty(){progress.groups.insert(source.id,json!({"sourceId":source.id,"reviewId":null,"options":[],"error":"unsupported-resource"}));}
            else{progress.queued.push_back(source.id);compatible.insert(source.id,selected);}
        }
        self.stream_query=Some(StreamQuery{media_type:kind.to_owned(),video_id:video.to_owned(),routes:compatible,created:Instant::now()});
        self.progressive=Some(progress);
        self.stream_snapshot(id)
    }
    pub(super) fn stream_snapshot(&self,id:u32)->Result<Value>{
        let p=self.progressive.as_ref().filter(|p|p.id==id).ok_or("expired-review")?;
        let q=self.stream_query.as_ref().filter(|q|q.created.elapsed()<REVIEW_TTL).ok_or("expired-review")?;
        let pending:Vec<_>=p.order.iter().filter(|id|!p.groups.contains_key(*id)).collect();
        let groups:Vec<_>=p.order.iter().filter_map(|id|p.groups.get(id)).collect();
        Ok(json!({"queryId":id,"mediaType":q.media_type,"videoId":q.video_id,"groups":groups,"pendingSourceIds":pending,"done":pending.is_empty()}))
    }
    #[cfg(any(windows,test))]
    pub(super) fn next_stream_job(&mut self,profile_id:u32)->Option<Job>{
        let progress=self.progressive.as_mut()?;
        let q=self.stream_query.as_ref()?;
        let id=progress.queued.pop_front()?;
        let source=self.sources.iter().find(|s|s.id==id&&s.enabled)?.clone();
        Some(Job{profile_id,query_id:progress.id,source,routes:q.routes.get(&id)?.clone()})
    }
    #[cfg(any(windows,test))]
    pub(super) fn finish_stream_job(&mut self,job:JobResult){
        let Some(p)=self.progressive.as_mut().filter(|p|p.id==job.query_id&&!p.groups.contains_key(&job.source_id)&&p.order.contains(&job.source_id))else{return;};
        let Some(q)=self.stream_query.as_mut().filter(|q|q.created.elapsed()<REVIEW_TTL)else{return;};
        if !self.sources.iter().any(|s|s.id==job.source_id&&s.enabled){return;}
        let Some(routes)=q.routes.get_mut(&job.source_id)else{return;};
        Self::prefer_stream_route(routes,job.selected);
        let group=match job.result{
            Ok(rows)=>if let Some(id)=self.sequence.checked_add(1){
                self.sequence=id;
                let group=json!({"sourceId":job.source_id,"reviewId":id,"options":rows,"error":null});
                self.stream_reviews.push(MediaReview{id,source_id:job.source_id,media_type:q.media_type.clone(),video_id:q.video_id.clone(),subtitles:false,rows,created:Instant::now()});
                group
            }else{json!({"sourceId":job.source_id,"reviewId":null,"options":[],"error":"source-limit"})},
            Err(error)=>json!({"sourceId":job.source_id,"reviewId":null,"options":[],"error":error}),
        };
        p.groups.insert(job.source_id,group);
    }
}
#[cfg(windows)]
#[derive(Default)]
pub(super) struct Pool{running:Vec<(u32,u32,u32,std::sync::mpsc::Receiver<JobResult>)>}
#[cfg(windows)]
impl Pool{
    pub(super) fn tick(&mut self,profiles:&mut super::profiles::Profiles){
        use std::{sync::mpsc,thread};
        let mut i=0;
        while i<self.running.len(){
            let (profile_id,query_id,source_id,rx)=&self.running[i];
            match rx.try_recv(){
                Ok(result)=>{profiles.finish_stream_job(result);self.running.swap_remove(i);}
                Err(mpsc::TryRecvError::Disconnected)=>{profiles.finish_stream_job(JobResult{profile_id:*profile_id,query_id:*query_id,source_id:*source_id,selected:0,result:Err("request")});self.running.swap_remove(i);}
                Err(mpsc::TryRecvError::Empty)=>i+=1,
            }
        }
        while self.running.len()<12{
            let Some(job)=profiles.next_stream_job()else{break;};
            let (profile_id,query_id,source_id)=(job.profile_id,job.query_id,job.source.id);
            let (tx,rx)=mpsc::sync_channel(1);
            let spawned=thread::Builder::new().name("addon-stream".into()).spawn(move||{
                let (selected,result)=Registry::resolve_stream_routes(&job.source,&job.routes,&|source,kind,video,timeout|source.endpoint.item_options_with_timeout(&source.manifest,ItemResource::Stream,kind,video,timeout));
                let _=tx.send(JobResult{profile_id,query_id,source_id,selected,result});
            });
            if spawned.is_ok(){self.running.push((profile_id,query_id,source_id,rx));}
            else{profiles.finish_stream_job(JobResult{profile_id,query_id,source_id,selected:0,result:Err("request")});}
        }
    }
}
#[cfg(test)]
mod tests{
    use super::*;
    use super::super::{Endpoint,Manifest,Action};
    fn source(id:u32)->Source{
        Source{id,endpoint:Endpoint::parse("https://example.com/manifest.json").unwrap(),manifest:Manifest::parse(br#"{"id":"test","name":"Test","version":"1.0.0","types":["movie"],"resources":["stream"]}"#).unwrap(),enabled:true}
    }
    #[test]
    fn fast_result_is_selectable_before_slow_provider_and_stale_completion_is_ignored(){
        let mut r=Registry::default();r.sequence=10;r.sources=vec![source(1),source(2)];
        let first=r.begin_streams("movie","tt123",&[]).unwrap();
        let id=first["queryId"].as_u64().unwrap() as u32;
        let slow=r.next_stream_job(1).unwrap();let fast=r.next_stream_job(1).unwrap();
        assert_eq!(fast.source.id,2);
        let rows=vec![OptionSummary{name:"1080p".into(),detail:None,supported:true,reason:"direct-https",url:Some("https://example.com/video.mp4".into()),language:None}];
        r.finish_stream_job(JobResult{profile_id:1,query_id:id,source_id:fast.source.id,selected:0,result:Ok(rows)});
        let partial=r.stream_snapshot(id).unwrap();
        assert_eq!(partial["done"],false);assert_eq!(partial["pendingSourceIds"],json!([1]));
        let review=partial["groups"][0]["reviewId"].as_u64().unwrap() as u32;
        assert!(r.execute(Action::PrepareMedia{review_id:review,option_index:0,start_ms:0}).is_ok());
        r.finish_stream_job(JobResult{profile_id:1,query_id:id,source_id:slow.source.id,selected:0,result:Ok(vec![])});
        assert!(r.stream_snapshot(id).is_err());assert!(r.stream_reviews.is_empty());
    }
}
