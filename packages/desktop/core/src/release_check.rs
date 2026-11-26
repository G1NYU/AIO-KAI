//! Read-only Tsugi release discovery. No executable download or update apply.
use serde_json::{Value,json};
use std::io::Read;
use std::path::Path;
use std::time::Duration;

const API:&str="https://api.github.com/repos/G1NYU/TSUGI";
const ASSET:&str="Tsugi-windows-x64.zip";
const CHECKSUM:&str="SHA256SUMS.txt";
const LIMIT:u64=512*1024;

fn hex(value:&str,len:usize)->bool{
    value.len()==len&&value.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))
}
fn tag(value:&str)->bool{
    let Some(rest)=value.strip_prefix('v') else {return false;};
    let parts:Vec<_>=rest.split('.').collect();
    parts.len()==3&&parts.iter().all(|part|!part.is_empty()&&part.len()<=9&&
        part.bytes().all(|b|b.is_ascii_digit())&&(part.len()==1||!part.starts_with('0')))
}
fn current_commit(root:&Path)->Option<String>{
    // Legacy portable archives already contain this build identity. Never
    // compare the inherited Cargo package version with the Tsugi release tag.
    let path=root.join("BUILD-INFO.json");
    let file=std::fs::File::open(path).ok()?;
    let mut bytes=Vec::new();
    file.take(8193).read_to_end(&mut bytes).ok()?;
    if bytes.len()>8192{return None;}
    let value:Value=serde_json::from_slice(bytes.strip_prefix(&[0xef,0xbb,0xbf]).unwrap_or(&bytes)).ok()?;
    if value["repository"]!="G1NYU/TSUGI"{return None;}
    let commit=value["commit"].as_str()?;
    hex(commit,40).then(||commit.to_owned())
}
fn fetch(agent:&ureq::Agent,url:&str)->Result<Value,&'static str>{
    let response=agent.get(url).header("User-Agent","Tsugi-Windows-release-check")
        .header("Accept","application/vnd.github+json").call()
        .map_err(|_|"Could not contact the Tsugi release service.")?;
    if response.status()!=200{return Err("Unexpected Tsugi release response.");}
    let mut bytes=Vec::new();
    response.into_body().into_reader().take(LIMIT+1).read_to_end(&mut bytes)
        .map_err(|_|"Could not read the Tsugi release response.")?;
    if bytes.len() as u64>LIMIT{return Err("Tsugi release response is too large.");}
    serde_json::from_slice(&bytes).map_err(|_|"Invalid Tsugi release response.")
}
fn stable_tag(release:&Value)->Result<&str,&'static str>{
    let name=release["tag_name"].as_str().ok_or("Missing release tag.")?;
    if !tag(name)||release["draft"]!=false||release["prerelease"]!=false||
        release["html_url"]!=format!("https://github.com/G1NYU/TSUGI/releases/tag/{name}"){
        return Err("Unsupported Tsugi stable release.");
    }
    Ok(name)
}
fn asset<'a>(release:&'a Value,name:&str,tag:&str,max:u64)->Result<&'a Value,&'static str>{
    let rows=release["assets"].as_array().ok_or("Missing release assets.")?;
    if rows.len()>64{return Err("Too many release assets.");}
    let mut matches=rows.iter().filter(|row|row["name"]==name);
    let row=matches.next().ok_or("Missing required release asset.")?;
    if matches.next().is_some()||row["state"]!="uploaded"||
        row["browser_download_url"]!=format!("https://github.com/G1NYU/TSUGI/releases/download/{tag}/{name}")||
        !row["size"].as_u64().is_some_and(|size|size>0&&size<=max){
        return Err("Invalid Tsugi release asset.");
    }
    Ok(row)
}
fn project_release(release:&Value,reference:&Value,current:Option<String>)->Result<Value,&'static str>{
    let name=stable_tag(release)?;
    if reference["ref"]!=format!("refs/tags/{name}")||reference["object"]["type"]!="commit"{
        return Err("Unsupported release tag reference.");
    }
    let commit=reference["object"]["sha"].as_str().filter(|value|hex(value,40)).ok_or("Invalid release commit.")?;
    // The existing publisher creates lightweight tags pointing at the exact
    // source SHA. Reject an inconsistent or ambiguous published identity.
    if release["target_commitish"]!=commit{return Err("Release tag and source identity disagree.");}
    let zip=asset(release,ASSET,name,2*1024*1024*1024)?;
    let _=asset(release,CHECKSUM,name,16*1024)?;
    let digest=zip["digest"].as_str().and_then(|value|value.strip_prefix("sha256:"))
        .filter(|value|hex(value,64)).ok_or("Missing Windows package digest.")?;
    let notes:String=release["body"].as_str().unwrap_or("").chars()
        .filter(|c|!c.is_control()||matches!(c,'\n'|'\t')).take(12_000).collect();
    let same=current.as_deref()==Some(commit);
    let status=if same{"same-build"}else if current.is_some(){"different-build"}else{"unknown-build"};
    Ok(json!({
        "latestTag":name,"latestCommit":commit,"currentCommit":current,"status":status,
        "packageBytes":zip["size"],"sha256":digest,"notes":notes
    }))
}
pub fn check(root:&Path)->Result<Value,&'static str>{
    let current=current_commit(root);
    let agent:ureq::Agent=ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(20))).max_redirects(0).build().into();
    let release=fetch(&agent,&format!("{API}/releases/latest"))?;
    let name=stable_tag(&release)?;
    let reference=fetch(&agent,&format!("{API}/git/ref/tags/{name}"))?;
    project_release(&release,&reference,current)
}

#[cfg(test)]
mod tests{
    use super::*;
    fn fixture()->(Value,Value){
        let commit="a".repeat(40);
        let release=json!({
            "tag_name":"v0.1.0","draft":false,"prerelease":false,
            "html_url":"https://github.com/G1NYU/TSUGI/releases/tag/v0.1.0",
            "target_commitish":commit,"body":"Release notes",
            "assets":[
                {"name":ASSET,"state":"uploaded","size":1000,"digest":format!("sha256:{}","b".repeat(64)),
                    "browser_download_url":format!("https://github.com/G1NYU/TSUGI/releases/download/v0.1.0/{ASSET}")},
                {"name":CHECKSUM,"state":"uploaded","size":88,
                    "browser_download_url":format!("https://github.com/G1NYU/TSUGI/releases/download/v0.1.0/{CHECKSUM}")}
            ]
        });
        (release,json!({"ref":"refs/tags/v0.1.0","object":{"type":"commit","sha":commit}}))
    }
    #[test]
    fn exact_release_identity_and_unknown_preview_order(){
        let (release,reference)=fixture();
        assert_eq!(project_release(&release,&reference,Some("a".repeat(40))).unwrap()["status"],"same-build");
        assert_eq!(project_release(&release,&reference,Some("c".repeat(40))).unwrap()["status"],"different-build");
        assert_eq!(project_release(&release,&reference,None).unwrap()["status"],"unknown-build");
        assert!(!tag("v0.01.0"));assert!(!tag("v0.1.0-beta"));assert!(!tag("../bad"));
    }
    #[test]
    fn rejects_wrong_repository_assets_and_release_identity(){
        let (release,reference)=fixture();
        let mut bad=release.clone();bad["prerelease"]=json!(true);
        assert!(project_release(&bad,&reference,None).is_err());
        let mut bad=release.clone();bad["assets"][0]["browser_download_url"]=json!("https://example.test/evil.zip");
        assert!(project_release(&bad,&reference,None).is_err());
        let mut bad=release.clone();bad["assets"][0]["digest"]=Value::Null;
        assert!(project_release(&bad,&reference,None).is_err());
        let mut bad=reference.clone();bad["object"]["sha"]=json!("c".repeat(40));
        assert!(project_release(&release,&bad,None).is_err());
    }
}
