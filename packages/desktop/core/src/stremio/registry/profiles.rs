//! Local media identities for the direct addon workspace. Profiles are
//! convenience boundaries inside one Windows account, not access-control
//! boundaries or replacements for authenticated Jellyfin/AIOStreams users.
use super::{Action, Endpoint, Manifest, Registry, Source, Result, MAX_SOURCES};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;

pub(super) const MAX_PROFILES: usize = 6;
pub(super) const SNAPSHOT_LIMIT: usize = 16 * 1024 * 1024;

#[derive(Clone)]
struct Profile {
    id: u32,
    name: String,
    registry: Registry,
}
#[derive(Clone)]
pub(super) struct Profiles {
    active: u32,
    sequence: u32,
    profiles: Vec<Profile>,
}
impl Default for Profiles {
    fn default() -> Self {
        Self { active:1, sequence:1, profiles:vec![Profile {id:1,name:"Default".into(),registry:Registry::default()}] }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Snapshot {
    version: u32,
    active: u32,
    sequence: u32,
    profiles: Vec<SavedProfile>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SavedProfile {
    id: u32,
    name: String,
    sources: Vec<SavedSource>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SavedSource {
    id: u32,
    endpoint: String,
    enabled: bool,
    manifest: Manifest,
}

fn name_valid(name: &str) -> bool {
    !name.is_empty() && name == name.trim() && name.len() <= 256 &&
        name.chars().count() <= 64 && !name.chars().any(char::is_control)
}
fn source_action(action: &Action) -> bool {
    matches!(action,Action::List|Action::Review{..}|Action::Install{..}|Action::CancelReview{..}|
        Action::SetEnabled{..}|Action::Move{..}|Action::Remove{..}|Action::Catalog{..}|Action::Metadata{..}|Action::ItemOptions{..}|
        Action::ImportConnect{..}|Action::ImportNuvioProfile{..}|Action::ImportReview{..}|Action::ImportApply{..}|Action::ImportCancel{..})
}
pub(super) fn is_mutation(action: &Action) -> bool {
    match action {
        Action::ProfileCreate{..}|Action::ProfileRename{..}|Action::ProfileSwitch{..}|Action::ProfileRemove{..} => true,
        Action::ProfileRequest{action,..} => matches!(action.as_ref(),Action::Install{..}|Action::SetEnabled{..}|Action::Move{..}|Action::Remove{..}|Action::ImportApply{..}),
        _ => false,
    }
}

impl Profiles {
    fn index(&self, id:u32) -> Result<usize> {
        self.profiles.iter().position(|p|p.id==id).ok_or("unknown-profile")
    }
    fn check_name(&self,name:&str,except:Option<u32>) -> Result<()> {
        if !name_valid(name) { return Err("invalid-profile-name"); }
        if self.profiles.iter().any(|p|Some(p.id)!=except&&p.name.to_lowercase()==name.to_lowercase()) {
            return Err("duplicate-profile");
        }
        Ok(())
    }
    fn list(&self) -> Value {
        let profiles:Vec<_>=self.profiles.iter().map(|p|json!({
            "profileId":p.id,"name":p.name,"sourceCount":p.registry.sources.len()
        })).collect();
        json!({"activeProfileId":self.active,"profiles":profiles})
    }
    pub(super) fn expire_all(&mut self){for profile in &mut self.profiles{profile.registry.expire();}}
    pub(super) fn execute(&mut self, action:Action) -> Result<Value> {
        match action {
            Action::ProfileList => Ok(self.list()),
            Action::ProfileCreate{name} => {
                let name=name.trim().to_owned();
                self.check_name(&name,None)?;
                if self.profiles.len()>=MAX_PROFILES {return Err("profile-limit");}
                self.sequence=self.sequence.checked_add(1).ok_or("profile-limit")?;
                self.profiles.push(Profile{id:self.sequence,name,registry:Registry::default()});
                Ok(self.list())
            }
            Action::ProfileRename{profile_id,name} => {
                let index=self.index(profile_id)?;
                let name=name.trim().to_owned();
                self.check_name(&name,Some(profile_id))?;
                self.profiles[index].name=name;
                Ok(self.list())
            }
            Action::ProfileSwitch{profile_id} => {
                self.index(profile_id)?;
                if self.active!=profile_id {
                    // Reviews cannot survive a profile switch. Source ids
                    // are globally unique and never reused by another profile.
                    for profile in &mut self.profiles {profile.registry.pending=None;profile.registry.import=None;}
                    self.active=profile_id;
                }
                Ok(self.list())
            }
            Action::ProfileRemove{profile_id,confirmed_name} => {
                let index=self.index(profile_id)?;
                if self.profiles.len()==1||self.active==profile_id{return Err("active-profile");}
                if self.profiles[index].name!=confirmed_name{return Err("profile-confirmation");}
                self.profiles.remove(index);
                Ok(self.list())
            }
            Action::ProfileRequest{profile_id,action} => {
                if self.active!=profile_id {return Err("profile-changed");}
                if !source_action(&action) {return Err("profile-required");}
                let index=self.index(profile_id)?;
                let registry=&mut self.profiles[index].registry;
                registry.sequence=self.sequence;
                let result=registry.execute(*action);
                self.sequence=registry.sequence;
                result.map(|mut data|{data["profileId"]=json!(profile_id);data})
            }
            _=>Err("profile-required"),
        }
    }

    /// The serialized form never includes pending reviews or external account
    /// credentials. Configured addon URLs themselves may contain secrets and
    /// must only be passed to the native encrypted store.
    pub(super) fn encode(&self) -> Result<Vec<u8>> {
        let snapshot=Snapshot {
            version:1,active:self.active,sequence:self.sequence,
            profiles:self.profiles.iter().map(|p|SavedProfile{
                id:p.id,name:p.name.clone(),
                sources:p.registry.sources.iter().map(|s|SavedSource{
                    id:s.id,endpoint:s.endpoint.0.as_str().to_owned(),enabled:s.enabled,manifest:s.manifest.clone()
                }).collect()
            }).collect()
        };
        let bytes=serde_json::to_vec(&snapshot).map_err(|_|"profile-store")?;
        if bytes.len()>SNAPSHOT_LIMIT{return Err("profile-store-limit");}
        Ok(bytes)
    }
    pub(super) fn decode(bytes:&[u8])->Result<Self>{
        if bytes.is_empty()||bytes.len()>SNAPSHOT_LIMIT{return Err("profile-store");}
        let saved:Snapshot=serde_json::from_slice(bytes).map_err(|_|"profile-store")?;
        if saved.version!=1||saved.sequence==0||saved.profiles.is_empty()||saved.profiles.len()>MAX_PROFILES {
            return Err("profile-store");
        }
        let mut ids=BTreeSet::new();
        let mut names=BTreeSet::new();
        let mut profiles=Vec::with_capacity(saved.profiles.len());
        for profile in saved.profiles {
            if profile.id==0||profile.id>saved.sequence||!ids.insert(profile.id)||
                !name_valid(&profile.name)||!names.insert(profile.name.to_lowercase())||profile.sources.len()>MAX_SOURCES{
                return Err("profile-store");
            }
            let mut endpoints=BTreeSet::new();
            let mut sources=Vec::with_capacity(profile.sources.len());
            for source in profile.sources {
                if source.id==0||source.id>saved.sequence||!ids.insert(source.id){return Err("profile-store");}
                let endpoint=Endpoint::parse(&source.endpoint).map_err(|_|"profile-store")?;
                if !endpoints.insert(endpoint.0.as_str().to_owned()){return Err("profile-store");}
                let bytes=serde_json::to_vec(&source.manifest).map_err(|_|"profile-store")?;
                let manifest=Manifest::parse(&bytes).map_err(|_|"profile-store")?;
                if manifest.behavior_hints.configuration_required{return Err("profile-store");}
                sources.push(Source{id:source.id,endpoint,manifest,enabled:source.enabled});
            }
            profiles.push(Profile{id:profile.id,name:profile.name,registry:Registry{sequence:saved.sequence,sources,pending:None,import:None}});
        }
        if !profiles.iter().any(|p|p.id==saved.active){return Err("profile-store");}
        Ok(Self{active:saved.active,sequence:saved.sequence,profiles})
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn scoped(profile_id:u32,action:Action)->Action{Action::ProfileRequest{profile_id,action:Box::new(action)}}
    fn stage(profiles:&mut Profiles,profile_id:u32)->u32{
        let i=profiles.index(profile_id).unwrap();
        profiles.profiles[i].registry.sequence=profiles.sequence;
        let manifest=Manifest::parse(br#"{"id":"org.fixture","name":"Fixture","version":"1.0.0","types":["movie"],"resources":["catalog",{"name":"stream","types":["movie"],"idPrefixes":["tt"]}],"catalogs":[{"type":"movie","id":"top","extra":[{"name":"skip"}]}]}"#).unwrap();
        let row=profiles.profiles[i].registry.stage(Endpoint::parse("https://example.org/configured/manifest.json?key=private-fixture").unwrap(),manifest).unwrap();
        profiles.sequence=profiles.profiles[i].registry.sequence;
        row["reviewId"].as_u64().unwrap() as u32
    }
    #[test]
    fn profile_scopes_are_explicit_and_review_cannot_cross_switch(){
        let mut p=Profiles::default();
        assert_eq!(p.execute(Action::List),Err("profile-required"));
        let r=stage(&mut p,1);
        let list=p.execute(Action::ProfileCreate{name:"Second".into()}).unwrap();
        let second=list["profiles"][1]["profileId"].as_u64().unwrap() as u32;
        p.execute(Action::ProfileSwitch{profile_id:second}).unwrap();
        assert_eq!(p.execute(scoped(1,Action::Install{review_id:r})),Err("profile-changed"));
        assert_eq!(p.execute(scoped(second,Action::Install{review_id:r})),Err("expired-review"));
        assert_eq!(p.execute(scoped(second,Action::List)).unwrap()["sources"],json!([]));
        let s=stage(&mut p,second);
        let installed=p.execute(scoped(second,Action::Install{review_id:s})).unwrap();
        assert_eq!(installed["profileId"],second);
        assert!(!installed.to_string().contains("private-fixture"));
        p.execute(Action::ProfileSwitch{profile_id:1}).unwrap();
        assert_eq!(p.execute(scoped(1,Action::Install{review_id:r})),Err("expired-review"));
        assert_eq!(p.execute(scoped(1,Action::Remove{source_id:s})),Err("unknown-source"));
        assert_eq!(p.execute(scoped(1,Action::ProfileSwitch{profile_id:second})),Err("profile-required"));
        let first=stage(&mut p,1);
        assert_ne!(first,s);
        p.execute(scoped(1,Action::Install{review_id:first})).unwrap();
        assert_eq!(p.execute(scoped(1,Action::List)).unwrap()["sources"][0]["sourceId"],first);
    }
    #[test]
    fn snapshots_preserve_profile_sources_order_and_capabilities_without_pending_reviews(){
        let mut p=Profiles::default();
        let s=stage(&mut p,1);
        p.execute(scoped(1,Action::Install{review_id:s})).unwrap();
        p.execute(scoped(1,Action::SetEnabled{source_id:s,enabled:false})).unwrap();
        let second=p.execute(Action::ProfileCreate{name:"Second".into()}).unwrap()["profiles"][1]["profileId"].as_u64().unwrap() as u32;
        p.execute(Action::ProfileSwitch{profile_id:second}).unwrap();
        let r=stage(&mut p,second);
        let encoded=p.encode().unwrap();
        let mut restored=Profiles::decode(&encoded).unwrap();
        assert_eq!(restored.list(),p.list());
        assert_eq!(restored.execute(scoped(second,Action::Install{review_id:r})),Err("expired-review"));
        assert_eq!(restored.execute(scoped(second,Action::List)).unwrap()["sources"],json!([]));
        restored.execute(Action::ProfileSwitch{profile_id:1}).unwrap();
        let rows=restored.execute(scoped(1,Action::List)).unwrap();
        assert_eq!(rows["sources"][0]["sourceId"],s);
        assert_eq!(rows["sources"][0]["enabled"],false);
        assert!(restored.profiles[0].registry.sources[0].manifest.supports(super::super::super::ItemResource::Stream,"movie","tt123"));
        assert!(!restored.profiles[0].registry.sources[0].manifest.supports(super::super::super::ItemResource::Stream,"movie","other"));
        assert_eq!(restored.profiles[0].registry.sources[0].endpoint.0.query(),Some("key=private-fixture"));
        let mut bad:Value=serde_json::from_slice(&encoded).unwrap();
        bad["active"]=json!(999);
        assert!(Profiles::decode(&serde_json::to_vec(&bad).unwrap()).is_err());
    }
    #[test]
    fn profile_names_limits_and_deletion_require_exact_inactive_target(){
        let mut p=Profiles::default();
        assert_eq!(p.execute(Action::ProfileCreate{name:"default".into()}),Err("duplicate-profile"));
        assert_eq!(p.execute(Action::ProfileCreate{name:"\n ".into()}),Err("invalid-profile-name"));
        assert_eq!(p.execute(Action::ProfileRemove{profile_id:1,confirmed_name:"Default".into()}),Err("active-profile"));
        let second=p.execute(Action::ProfileCreate{name:"Second".into()}).unwrap()["profiles"][1]["profileId"].as_u64().unwrap() as u32;
        assert_eq!(p.execute(Action::ProfileRemove{profile_id:second,confirmed_name:"wrong".into()}),Err("profile-confirmation"));
        p.execute(Action::ProfileRename{profile_id:second,name:"Other".into()}).unwrap();
        p.execute(Action::ProfileRemove{profile_id:second,confirmed_name:"Other".into()}).unwrap();
        for i in 2..=MAX_PROFILES{p.execute(Action::ProfileCreate{name:format!("Profile {i}")}).unwrap();}
        assert_eq!(p.execute(Action::ProfileCreate{name:"One too many".into()}),Err("profile-limit"));
    }
}
