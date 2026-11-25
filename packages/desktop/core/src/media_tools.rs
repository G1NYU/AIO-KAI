//! Independent, local-only FFmpeg tools. Preserve the downloaded AAC bytes;
//! reject malformed audio before publishing a finished file to the library.
use sha2::{Digest,Sha256};
use std::{fs,io::Read,path::{Path,PathBuf},process::{Command,Stdio},sync::atomic::{AtomicBool,Ordering},thread,time::{Duration,Instant}};
use std::os::windows::process::CommandExt;

type Result<T>=std::result::Result<T,&'static str>;
const MAX_TOOL:u64=128*1024*1024;

fn directory()->Option<PathBuf>{Some(std::env::current_exe().ok()?.parent()?.join("media-tools"))}
fn checked_file(root:&Path,name:&str,limit:u64)->Result<PathBuf>{
    let path=root.join(name);
    let meta=fs::symlink_metadata(&path).map_err(|_|"Bundled media tool missing")?;
    if !meta.file_type().is_file()||meta.len()==0||meta.len()>limit{return Err("Invalid bundled media tool");}
    Ok(path)
}
fn hash(path:&Path)->Result<String>{
    let file=fs::File::open(path).map_err(|_|"Media tool unreadable")?;
    let mut reader=file.take(MAX_TOOL+1);
    let mut buffer=[0u8;65536];
    let mut digest=Sha256::new();
    let mut total=0u64;
    loop{let n=reader.read(&mut buffer).map_err(|_|"Media tool unreadable")?;if n==0{break;}total+=n as u64;if total>MAX_TOOL{return Err("Media tool exceeds size limit");}digest.update(&buffer[..n]);}
    Ok(digest.finalize().iter().map(|b|format!("{b:02x}")).collect::<Vec<_>>().join(""))
}
fn tools(root:&Path)->Result<(PathBuf,PathBuf)>{
    let sums=checked_file(root,"SHA256SUMS",8192)?;
    let sums=fs::read_to_string(sums).map_err(|_|"Media tool checksum manifest unreadable")?;
    let verify=|name:&str|->Result<PathBuf>{
        let mut lines=sums.lines().filter_map(|line|line.split_once("  ")).filter(|(_,file)|*file==name);
        let (expected,_)=lines.next().ok_or("Media tool checksum missing")?;
        if lines.next().is_some()||expected.len()!=64||!expected.bytes().all(|b|b.is_ascii_hexdigit()){return Err("Media tool checksum invalid");}
        let path=checked_file(root,name,MAX_TOOL)?;
        if hash(&path)?!=expected{return Err("Media tool checksum mismatch");}
        Ok(path)
    };
    Ok((verify("ffmpeg.exe")?,verify("ffprobe.exe")?))
}
pub fn installed_ready()->bool{directory().is_some_and(|root|tools(&root).is_ok())}
fn run(mut command:Command,stop:&AtomicBool,timeout:Duration)->Result<Vec<u8>>{
    if stop.load(Ordering::Relaxed){return Err("Media verification cancelled");}
    command.creation_flags(0x08000000).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    let mut child=command.spawn().map_err(|_|"Could not start bundled media tool")?;
    let stdout=child.stdout.take().expect("piped stdout");
    let reader=thread::spawn(move||{
        let mut bytes=Vec::new();
        stdout.take(8193).read_to_end(&mut bytes).map_err(|_|"Media tool output unreadable")?;
        if bytes.len()>8192{return Err("Media tool output exceeds limit");}
        Ok(bytes)
    });
    let deadline=Instant::now()+timeout;
    loop{
        if stop.load(Ordering::Relaxed)||Instant::now()>=deadline{
            let _=child.kill();let _=child.wait();return Err("Media verification cancelled or timed out");
        }
        match child.try_wait(){
            Ok(Some(status))=>{
                if !status.success(){return Err("Media verification rejected the audio file");}
                if reader.is_finished(){return reader.join().map_err(|_|"Media tool output reader stopped")?;}
            }
            Ok(None)=>{},
            Err(_)=>{let _=child.kill();let _=child.wait();return Err("Media tool status unavailable");}
        }
        thread::sleep(Duration::from_millis(50));
    }
}
fn validate(root:&Path,path:&Path,stop:&AtomicBool)->Result<()>{
    let (ffmpeg,ffprobe)=tools(root)?;
    let meta=fs::symlink_metadata(path).map_err(|_|"Media verification input missing")?;
    if !meta.file_type().is_file()||!(16..=64*1024*1024).contains(&meta.len()){return Err("Media verification input invalid");}
    let mut probe=Command::new(ffprobe);
    probe.args(["-v","error","-protocol_whitelist","file","-f","mov","-select_streams","a:0","-show_entries","stream=codec_name","-of","default=noprint_wrappers=1:nokey=1"]).arg(path);
    let codec=run(probe,stop,Duration::from_secs(15))?;
    if !matches!(String::from_utf8_lossy(&codec).trim(),"aac"|"alac"){return Err("Downloaded M4A does not contain supported audio");}
    let mut decode=Command::new(ffmpeg);
    decode.args(["-nostdin","-hide_banner","-v","error","-xerror","-protocol_whitelist","file","-f","mov","-i"]).arg(path)
        .args(["-map","0:a:0","-c:a","pcm_s16le","-f","null","-"]);
    run(decode,stop,Duration::from_secs(45))?;
    Ok(())
}
pub(crate) fn validate_installed(path:&Path,stop:&AtomicBool)->Result<()>{
    let root=directory().ok_or("Could not locate bundled media tools")?;
    match fs::symlink_metadata(&root){
        Ok(meta) if meta.file_type().is_dir()=>validate(&root,path,stop),
        Err(error) if error.kind()==std::io::ErrorKind::NotFound=>Ok(()), // older development builds
        _=>Err("Bundled media tool directory is invalid"),
    }
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    #[ignore="Requires the actual built Windows FFmpeg/FFprobe and synthetic fixture"]
    fn bundled_media_validates_audio(){
        let root=PathBuf::from(std::env::var_os("TSUGI_MEDIA_TOOLS").expect("fixture tool directory"));
        let input=PathBuf::from(std::env::var_os("TSUGI_MEDIA_FIXTURE").expect("fixture audio"));
        let original=fs::read(&input).unwrap();
        assert!(validate(&root,&input,&AtomicBool::new(false)).is_ok());
        assert_eq!(fs::read(&input).unwrap(),original);
        assert!(validate(&root,&input,&AtomicBool::new(true)).is_err());
        let invalid=input.with_file_name("invalid-native.m4a");
        fs::write(&invalid,b"not a valid media file").unwrap();
        assert!(validate(&root,&invalid,&AtomicBool::new(false)).is_err());
        fs::remove_file(invalid).unwrap();
        println!("PASS: native media worker validated original audio, cancellation and malformed input");
    }
}
