//! Native addon review and source registry. Profile scoping and Windows
//! protected persistence are handled in the profiles and store modules.
use super::{Endpoint, Manifest, Declaration, Result, ItemResource, items::OptionSummary};
use crate::bridge::Outbound;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{collections::{BTreeMap, BTreeSet}, fmt, sync::{mpsc, Arc, Mutex}, thread, time::{Duration, Instant}};

mod accounts;
mod mdblist;
mod history;
mod refract;
pub use history::Progress as WatchProgress;
pub use accounts::Provider as ImportProvider;
mod profiles;
#[cfg(windows)]
mod store;
#[cfg(windows)]
mod refract_delivery;

const MAX_SOURCES: usize = 16;
const REVIEW_TTL: Duration = Duration::from_secs(300);

#[derive(Deserialize)]
#[serde(tag="kind", rename_all="kebab-case", rename_all_fields="camelCase", deny_unknown_fields)]
pub enum Action {
    ProfileList,
    ProfileCreate { name: String },
    ProfileRename { profile_id: u32, name: String },
    ProfileSwitch { profile_id: u32 },
    ProfileRemove { profile_id: u32, confirmed_name: String },
    ProfileRequest { profile_id: u32, action: Box<Action> },
    ImportConnect { provider: ImportProvider, email: String, password: String },
    ImportNuvioProfile { import_id: u32, remote_profile: u32 },
    ImportReview { import_id: u32, selected: Vec<u32> },
    ImportApply { import_id: u32 },
    ImportCancel { import_id: u32 },
    List,
    Review { url: String },
    Install { review_id: u32 },
    CancelReview { review_id: u32 },
    SetEnabled { source_id: u32, enabled: bool },
    Move { source_id: u32, position: usize },
    Remove { source_id: u32 },
    Catalog { source_id: u32, media_type: String, catalog_id: String, extras: BTreeMap<String,String> },
    Metadata { source_id: u32, media_type: String, item_id: String },
    ItemOptions { source_id: u32, media_type: String, video_id: String, subtitles: bool },
    PrepareMedia { review_id: u32, option_index: usize, start_ms: u64 },
    WatchHistory,
    WatchRecord { progress: WatchProgress, #[serde(default)] viewing_id: Option<String> },
    WatchRemove { media_type: String, item_id: String, video_id: String },
    RefractStatus,
    RefractConnect { key: String },
    RefractEnable { enabled: bool },
    RefractDisconnect { discard_pending: bool },
    RefractSync,
    RefractWatchlist { media_type: String, item_id: String, add: bool },
    MdblistStatus,
    MdblistConnect { key: String },
    MdblistDisconnect,
    MdblistLists,
    MdblistPage { list_id:u32, offset:u32 },
}
impl fmt::Debug for Action {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Inbound's derived Debug must never print private URLs or filters.
        f.write_str("StremioAction(<redacted>)")
    }
}

#[derive(Clone)]
struct Reviewed {
    id: u32,
    endpoint: Endpoint,
    manifest: Manifest,
    created: Instant,
}
#[derive(Clone)]
struct Source {
    id: u32,
    endpoint: Endpoint,
    manifest: Manifest,
    enabled: bool,
}

#[derive(Clone)]
struct MediaReview {
    id:u32, source_id:u32, media_type:String, video_id:String, subtitles:bool,
    rows:Vec<OptionSummary>, created:Instant,
}
/// Short-lived native-only handoff. Never serialized or formatted with Debug.
#[derive(Clone)]
pub struct MediaGrant {
    id:u32, profile_id:u32, media_type:String, video_id:String,
    url:String, language:Option<String>, subtitles:bool, start_ms:u64, created:Instant,
}
impl MediaGrant {
    pub fn id(&self)->u32{self.id}
    pub fn identity(&self)->(u32,&str,&str){(self.profile_id,&self.media_type,&self.video_id)}
    pub fn is_subtitle(&self)->bool{self.subtitles}
    pub fn subtitle(&self)->(&str,&str){(&self.url,self.language.as_deref().unwrap_or(""))}
    pub fn load(&self)->crate::playback::Load{
        crate::playback::Load{url:self.url.clone(),headers:BTreeMap::new(),start_ms:self.start_ms as f64,
            append:false,live:false,audio_languages:Vec::new(),subtitle_languages:Vec::new(),
            subtitle_mode:crate::playback::SubtitleMode::Default}
    }
}
#[derive(Default)]
struct GrantSlot { generation:u64, grant:Option<MediaGrant> }
#[derive(Clone, Default)]
struct Registry {
    sequence: u32,
    sources: Vec<Source>,
    pending: Option<Reviewed>,
    import: Option<accounts::Flow>,
    media_review: Option<MediaReview>,
    grant: Option<MediaGrant>,
    mdblist: mdblist::Connection,
    history: history::History,
    refract: refract::Connection,
}

/// Only bounded display fields and declared capabilities cross the bridge.
/// No configured endpoint, logo, raw manifest, config fields or headers.
fn summary(manifest: &Manifest) -> Value {
    let resources: BTreeSet<&str> = manifest.resources.iter().map(|r| match r {
        Declaration::Name(name) | Declaration::Detailed { name, .. } => name.as_str(),
    }).filter(|name| matches!(*name,"catalog"|"meta"|"stream"|"subtitles")).collect();
    let catalogs: Vec<_> = manifest.declared_catalogs().map(|catalog| {
        let extras: Vec<_> = catalog.extra.iter().map(|extra| json!({
            "name":extra.name,"required":extra.is_required,"options":extra.options,"optionsLimit":extra.options_limit
        })).collect();
        json!({"id":catalog.id,"mediaType":catalog.kind,"name":catalog.name,"extras":extras})
    }).collect();
    json!({
        "id":manifest.id,"name":manifest.name,"version":manifest.version,
        "resources":resources,"catalogs":catalogs,"configurable":manifest.behavior_hints.configurable,
        "configurationRequired":manifest.behavior_hints.configuration_required,
        "p2p":manifest.behavior_hints.p2p,"adult":manifest.behavior_hints.adult
    })
}

impl Registry {
    fn list(&self) -> Value {
        let sources: Vec<_> = self.sources.iter().map(|source| json!({
            "sourceId":source.id,"enabled":source.enabled,"manifest":summary(&source.manifest)
        })).collect();
        json!({"sources":sources})
    }
    fn expire(&mut self) {
        if self.pending.as_ref().is_some_and(|p| p.created.elapsed() >= REVIEW_TTL) { self.pending = None; }
        if self.import.as_ref().is_some_and(|p| p.expired()) { self.import = None; }
        if self.media_review.as_ref().is_some_and(|p|p.created.elapsed()>=REVIEW_TTL){self.media_review=None;}
        if self.grant.as_ref().is_some_and(|p|p.created.elapsed()>=Duration::from_secs(15)){self.grant=None;}
    }
    fn check_endpoint(&self, endpoint: &Endpoint) -> Result<()> {
        if self.sources.len() >= MAX_SOURCES { return Err("source-limit"); }
        if self.sources.iter().any(|s| s.endpoint.0 == endpoint.0) { return Err("duplicate"); }
        Ok(())
    }
    fn stage(&mut self, endpoint: Endpoint, manifest: Manifest) -> Result<Value> {
        self.check_endpoint(&endpoint)?;
        self.sequence = self.sequence.checked_add(1).ok_or("source-limit")?;
        let id = self.sequence;
        let data = json!({"reviewId":id,"manifest":summary(&manifest)});
        self.pending = Some(Reviewed { id, endpoint, manifest, created:Instant::now() });
        Ok(data)
    }
    fn source_index(&self, id: u32) -> Result<usize> {
        self.sources.iter().position(|source| source.id == id).ok_or("unknown-source")
    }
    fn execute(&mut self, action: Action) -> Result<Value> {
        self.expire();
        self.grant=None;
        if matches!(&action,Action::Install{..}|Action::SetEnabled{..}|Action::Remove{..}|Action::Move{..}|Action::ImportApply{..}|Action::ItemOptions{..}|Action::Metadata{..}|Action::Catalog{..}) {self.media_review=None;}
        match action {
            Action::List => Ok(self.list()),
            Action::WatchHistory => Ok(self.history.list()),
            Action::WatchRecord { progress,viewing_id } => {
                let already_completed=self.history.completed_at(&progress,viewing_id.as_deref()).is_some();
                let result=self.history.record(progress.clone(),viewing_id.clone())?;
                // Persist the optional outbound event together with local history.
                // A provider outage cannot prevent recording local playback.
                if progress.completed&&!already_completed&&let Some(at)=self.history.completed_at(&progress,viewing_id.as_deref()){
                    self.refract.enqueue(&progress,at,viewing_id.as_deref());
                }
                Ok(result)
            },
            Action::WatchRemove { media_type,item_id,video_id } => self.history.remove(&media_type,&item_id,&video_id),
            Action::RefractStatus=>Ok(self.refract.status()),
            Action::RefractConnect{key}=>self.refract.connect(key),
            Action::RefractEnable{enabled}=>self.refract.enable(enabled),
            Action::RefractDisconnect{discard_pending}=>self.refract.disconnect(discard_pending),
            Action::RefractSync=>self.refract.sync(),
            Action::RefractWatchlist{media_type,item_id,add}=>self.refract.watchlist(&media_type,&item_id,add),
            Action::MdblistStatus=>Ok(self.mdblist.status()),
            Action::MdblistConnect{key}=>self.mdblist.connect(key),
            Action::MdblistDisconnect=>Ok(self.mdblist.disconnect()),
            Action::MdblistLists=>self.mdblist.lists(),
            Action::MdblistPage{list_id,offset}=>self.mdblist.page(list_id,offset),
            Action::ImportConnect { provider,email,password } => self.import_connect(provider,&email,&password),
            Action::ImportNuvioProfile { import_id,remote_profile } => self.import_nuvio_profile(import_id,remote_profile),
            Action::ImportReview { import_id,selected } => self.import_review(import_id,selected),
            Action::ImportApply { import_id } => self.import_apply(import_id),
            Action::ImportCancel { import_id } => Ok(json!({"cancelled":self.import_cancel(import_id)})),
            Action::Review { url } => {
                // A replacement review invalidates the previous capability
                // before making any request. Failure cannot install stale data.
                self.pending = None;
                let endpoint = Endpoint::parse(&url)?;
                self.check_endpoint(&endpoint)?;
                let manifest = endpoint.manifest()?;
                self.stage(endpoint,manifest)
            }
            Action::Install { review_id } => {
                let pending = self.pending.as_ref().filter(|r| r.id == review_id).ok_or("expired-review")?;
                if pending.manifest.behavior_hints.configuration_required { return Err("configuration-required"); }
                self.check_endpoint(&pending.endpoint)?;
                let reviewed = self.pending.take().ok_or("expired-review")?;
                self.sources.push(Source { id:reviewed.id, endpoint:reviewed.endpoint, manifest:reviewed.manifest, enabled:true });
                Ok(self.list())
            }
            Action::CancelReview { review_id } => {
                let cancelled = self.pending.as_ref().is_some_and(|r| r.id == review_id);
                if cancelled { self.pending = None; }
                Ok(json!({"cancelled":cancelled}))
            }
            Action::SetEnabled { source_id, enabled } => {
                let index = self.source_index(source_id)?;
                self.sources[index].enabled = enabled;
                Ok(self.list())
            }
            Action::Move { source_id, position } => {
                let index = self.source_index(source_id)?;
                if position >= self.sources.len() { return Err("invalid-position"); }
                let source = self.sources.remove(index);
                self.sources.insert(position,source);
                Ok(self.list())
            }
            Action::Remove { source_id } => {
                let index = self.source_index(source_id)?;
                self.sources.remove(index);
                Ok(self.list())
            }
            Action::Catalog { source_id, media_type, catalog_id, extras } => {
                let source = &self.sources[self.source_index(source_id)?];
                if !source.enabled { return Err("disabled-source"); }
                let page = source.endpoint.catalog(&source.manifest,&media_type,&catalog_id,&extras)?;
                let items: Vec<_> = page.items.iter().map(|item| json!({
                    "id":item.id,"mediaType":item.kind,"name":item.name
                })).collect();
                Ok(json!({"sourceId":source_id,"mediaType":media_type,"catalogId":catalog_id,
                    "items":items,"sourceCount":page.source_count,"nextSkip":page.next_skip}))
            }
            Action::Metadata { source_id,media_type,item_id } => {
                let source=&self.sources[self.source_index(source_id)?];
                if !source.enabled{return Err("disabled-source");}
                let meta=source.endpoint.metadata(&source.manifest,&media_type,&item_id)?;
                Ok(json!({"sourceId":source_id,"metadata":meta}))
            }
            Action::ItemOptions { source_id,media_type,video_id,subtitles } => {
                let source=&self.sources[self.source_index(source_id)?];
                if !source.enabled{return Err("disabled-source");}
                let resource=if subtitles{ItemResource::Subtitles}else{ItemResource::Stream};
                let options=source.endpoint.item_options(&source.manifest,resource,&media_type,&video_id)?;
                self.sequence=self.sequence.checked_add(1).ok_or("source-limit")?;
                let id=self.sequence;
                let data=json!({"sourceId":source_id,"mediaType":media_type,"videoId":video_id,"subtitles":subtitles,"reviewId":id,"options":options});
                self.media_review=Some(MediaReview{id,source_id,media_type,video_id,subtitles,rows:options,created:Instant::now()});
                Ok(data)
            }
            Action::PrepareMedia {review_id,option_index,start_ms}=>{
                if start_ms>604800000{return Err("invalid-media-selection");}
                let review=self.media_review.take().filter(|p|p.id==review_id).ok_or("expired-review")?;
                if !self.sources[self.source_index(review.source_id)?].enabled{return Err("disabled-source");}
                let option=review.rows.get(option_index).filter(|row|row.supported).ok_or("invalid-media-selection")?;
                let url=option.url.clone().ok_or("invalid-media-selection")?;
                self.sequence=self.sequence.checked_add(1).ok_or("source-limit")?;
                let id=self.sequence;
                self.grant=Some(MediaGrant{id,profile_id:0,media_type:review.media_type,video_id:review.video_id,
                    url,language:option.language.clone(),subtitles:review.subtitles,start_ms,created:Instant::now()});
                Ok(json!({"grantId":id,"subtitles":review.subtitles}))
            }
            _ => Err("profile-required"),
        }
    }
}

pub struct Worker(mpsc::SyncSender<(String,Action,u64)>,Arc<Mutex<GrantSlot>>);
impl Worker {
    #[cfg(windows)]
    pub fn start(root: std::path::PathBuf, emit: impl Fn(Outbound) + Send + 'static) -> Self {
        let (tx,rx) = mpsc::sync_channel::<(String,Action,u64)>(2);
        let slot=Arc::new(Mutex::new(GrantSlot::default()));
        let worker_slot=slot.clone();
        thread::spawn(move || {
            let mut opened = store::Store::open(&root);
            let mut delivery = refract_delivery::AutoSync::new();
            loop {
                let message=match rx.recv_timeout(Duration::from_millis(500)){
                    Ok(message)=>Some(message),
                    Err(mpsc::RecvTimeoutError::Timeout)=>None,
                    Err(mpsc::RecvTimeoutError::Disconnected)=>break,
                };
                if let Ok((_,profiles))=&mut opened{profiles.expire_all();}
                if let Some((request,action,generation))=message{
                    // Account-sensitive changes cancel an uncommitted lookup;
                    // once a write starts they fail busy instead of racing it.
                    let permitted=delivery.permit(&action);
                    let result = if !permitted{Err("busy")}else{match &mut opened {
                        Ok((storage,profiles)) if profiles::is_mutation(&action) => {
                            // Commit to memory only after the encrypted snapshot
                            // has been flushed, verified and atomically replaced.
                            let mut next = profiles.clone();
                            next.execute(action).and_then(|data| {
                                storage.save(&next)?;
                                *profiles = next;
                                Ok(data)
                            })
                        }
                        Ok((_,profiles)) => profiles.execute(action),
                        Err(error) => Err(*error),
                    }};
                    if let Ok((_,profiles))=&mut opened{
                        let grant=profiles.take_grant();
                        if result.is_ok()&&let Some(grant)=grant&&let Ok(mut slot)=worker_slot.lock(){
                            if slot.generation==generation{slot.grant=Some(grant);}
                        }
                    }
                    let (data,error) = match result {
                        Ok(data) => (Some(data),None),
                        Err(error) => (None,Some(error.to_owned())),
                    };
                    emit(Outbound::StremioResult { request,data,error });
                }
                // Delivery never calls Worker::request or executes a registry
                // action. In particular it cannot invalidate media grants.
                if let Ok((storage,profiles))=&mut opened{
                    delivery.tick(storage,profiles,&emit);
                }
            }
            // Drop cancels lookup and joins any already authorized write
            // before releasing the exclusive profile store handle.
            drop(delivery);
        });
        Self(tx,slot)
    }
    pub fn request(&self, request: String, action: Action) -> bool {
        if request.is_empty()||request.len()>128||!request.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-'){return false;}
        let Ok(mut slot)=self.1.lock() else{return false;};
        // A newer request immediately invalidates a pending handoff, even
        // when the worker is occupied and the newer request cannot enqueue.
        slot.grant=None;
        let Some(generation)=slot.generation.checked_add(1) else{return false;};
        slot.generation=generation;
        self.0.try_send((request,action,generation)).is_ok()
    }
    pub fn take_grant(&self,id:u32)->Option<MediaGrant>{
        let mut slot=self.1.lock().ok()?;
        slot.grant.take().filter(|grant|grant.id==id&&grant.created.elapsed()<Duration::from_secs(15))
    }
    pub fn invalidate_grant(&self){
        if let Ok(mut slot)=self.1.lock(){slot.grant=None;slot.generation=slot.generation.saturating_add(1);}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn manifest() -> Manifest {
        Manifest::parse(br#"{"id":"org.fixture","name":"Fixture","version":"1.0.0","types":["movie"],"resources":["catalog","stream","player"],"catalogs":[{"type":"movie","id":"top","name":"Top","extra":[{"name":"skip"}]}]}"#).unwrap()
    }
    fn stage(registry: &mut Registry, suffix: &str) -> u32 {
        let endpoint = Endpoint::parse(&format!("https://example.org/{suffix}/manifest.json?key=private-fixture")).unwrap();
        let result = registry.stage(endpoint,manifest()).unwrap();
        assert!(!result.to_string().contains("private-fixture"));
        result["reviewId"].as_u64().unwrap() as u32
    }
    #[test]
    fn media_grant_is_exact_one_use_and_not_serialized(){
        let mut registry=Registry::default();
        let id=stage(&mut registry,"media");
        registry.execute(Action::Install{review_id:id}).unwrap();
        let review=MediaReview{id:100,source_id:id,media_type:"movie".into(),video_id:"tt123".into(),subtitles:false,
            rows:vec![OptionSummary{name:"HD".into(),supported:true,reason:"direct-https",language:None,url:Some("https://cdn.example.org/video?token=private-fixture".into())}],created:Instant::now()};
        registry.media_review=Some(review.clone());
        let data=registry.execute(Action::PrepareMedia{review_id:100,option_index:0,start_ms:12000}).unwrap();
        assert!(!data.to_string().contains("private-fixture"));
        let grant=registry.grant.take().unwrap();
        assert_eq!(grant.load().start_ms,12000.0);
        assert!(grant.load().url.contains("private-fixture"));
        assert_eq!(registry.execute(Action::PrepareMedia{review_id:100,option_index:0,start_ms:0}),Err("expired-review"));
        let (tx,_rx)=mpsc::sync_channel(2);
        let worker=Worker(tx,Arc::new(Mutex::new(GrantSlot{generation:0,grant:Some(grant.clone())})));
        assert!(worker.take_grant(grant.id()).is_some());
        assert!(worker.take_grant(grant.id()).is_none());
        worker.1.lock().unwrap().grant=Some(grant.clone());
        worker.invalidate_grant();
        assert!(worker.take_grant(grant.id()).is_none());
        registry.media_review=Some(review);
        registry.execute(Action::SetEnabled{source_id:id,enabled:false}).unwrap();
        assert_eq!(registry.execute(Action::PrepareMedia{review_id:100,option_index:0,start_ms:0}),Err("expired-review"));
    }
    #[test]
    fn review_is_one_use_explicit_and_never_returns_configured_url() {
        let mut registry = Registry::default();
        let id = stage(&mut registry,"one");
        assert_eq!(registry.list()["sources"],json!([]));
        assert_eq!(registry.execute(Action::Install { review_id:id+1 }),Err("expired-review"));
        let data = registry.execute(Action::Install { review_id:id }).unwrap();
        assert_eq!(data["sources"][0]["sourceId"],id);
        assert_eq!(data["sources"][0]["manifest"]["resources"],json!(["catalog","stream"]));
        assert!(!data.to_string().contains("private-fixture"));
        assert!(!data.to_string().contains("example.org"));
        assert_eq!(registry.execute(Action::Install { review_id:id }),Err("expired-review"));
        assert_eq!(registry.check_endpoint(&Endpoint::parse("https://example.org/one/manifest.json?key=private-fixture").unwrap()),Err("duplicate"));
    }
    #[test]
    fn cancelled_expired_and_replaced_reviews_cannot_install() {
        let mut registry = Registry::default();
        let first = stage(&mut registry,"one");
        let next = stage(&mut registry,"two");
        assert_eq!(registry.execute(Action::Install { review_id:first }),Err("expired-review"));
        assert_eq!(registry.execute(Action::CancelReview { review_id:first }).unwrap()["cancelled"],false);
        assert_eq!(registry.execute(Action::CancelReview { review_id:next }).unwrap()["cancelled"],true);
        assert_eq!(registry.execute(Action::Install { review_id:next }),Err("expired-review"));
        let last = stage(&mut registry,"three");
        registry.pending.as_mut().unwrap().created = Instant::now().checked_sub(REVIEW_TTL).unwrap();
        assert_eq!(registry.execute(Action::Install { review_id:last }),Err("expired-review"));
        assert!(registry.pending.is_none());
        let id = stage(&mut registry,"four");
        assert_eq!(registry.execute(Action::Review { url:"file:///not-an-addon".into() }),Err("invalid-endpoint"));
        assert_eq!(registry.execute(Action::Install { review_id:id }),Err("expired-review"));
    }
    #[test]
    fn order_enable_and_removal_are_source_scoped() {
        let mut registry = Registry::default();
        let one = stage(&mut registry,"one");
        registry.execute(Action::Install { review_id:one }).unwrap();
        let two = stage(&mut registry,"two");
        registry.execute(Action::Install { review_id:two }).unwrap();
        let rows = registry.execute(Action::Move { source_id:two,position:0 }).unwrap();
        assert_eq!(rows["sources"][0]["sourceId"],two);
        assert_eq!(rows["sources"][1]["sourceId"],one);
        registry.execute(Action::SetEnabled { source_id:two,enabled:false }).unwrap();
        assert_eq!(registry.execute(Action::Catalog { source_id:two,media_type:"movie".into(),catalog_id:"top".into(),extras:BTreeMap::new() }),Err("disabled-source"));
        assert_eq!(registry.execute(Action::Catalog { source_id:one,media_type:"movie".into(),catalog_id:"undeclared".into(),extras:BTreeMap::new() }),Err("unsupported-catalog"));
        let rows = registry.execute(Action::Remove { source_id:two }).unwrap();
        assert_eq!(rows["sources"].as_array().unwrap().len(),1);
        assert_eq!(rows["sources"][0]["sourceId"],one);
        assert_eq!(registry.execute(Action::Remove { source_id:two }),Err("unknown-source"));
    }
    #[test]
    fn configuration_required_review_is_not_installable() {
        let mut registry = Registry::default();
        let mut manifest = manifest();
        manifest.behavior_hints.configuration_required = true;
        let reviewed = registry.stage(Endpoint::parse("https://example.org/manifest.json").unwrap(),manifest).unwrap();
        let id = reviewed["reviewId"].as_u64().unwrap() as u32;
        assert_eq!(reviewed["manifest"]["configurationRequired"],true);
        assert_eq!(registry.execute(Action::Install { review_id:id }),Err("configuration-required"));
        assert_eq!(registry.list()["sources"],json!([]));
    }
    #[test]
    fn bridge_actions_reject_arbitrary_paths_and_redact_private_debug() {
        let action: Action = serde_json::from_value(json!({"kind":"review","url":"https://example.org/private-fixture/manifest.json"})).unwrap();
        assert!(!format!("{action:?}").contains("private-fixture"));
        assert!(serde_json::from_value::<Action>(json!({"kind":"install","reviewId":1,"url":"https://example.org/manifest.json"})).is_err());
        assert!(serde_json::from_value::<Action>(json!({"kind":"catalog","sourceId":1,"mediaType":"movie","catalogId":"top","extras":{},"path":"C:/file"})).is_err());
        assert!(serde_json::from_value::<Action>(json!({"kind":"player","sourceId":1})).is_err());
    }
}
