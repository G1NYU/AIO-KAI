//! Fixed app-owned Windows profile store. User-scope DPAPI, no plaintext
//! staging files, and no fallback that silently overwrites unreadable data.
use super::{profiles::{Profiles,SNAPSHOT_LIMIT},Result};
use std::{fs::{self,File,OpenOptions},io::{Read,Write},os::windows::fs::{MetadataExt,OpenOptionsExt},path::{Path,PathBuf},ptr::{null,null_mut}};
use windows_sys::Win32::{Foundation::LocalFree,Security::Cryptography::{CryptProtectData,CryptUnprotectData,CRYPT_INTEGER_BLOB,CRYPTPROTECT_UI_FORBIDDEN}};

const CIPHER_LIMIT:usize=SNAPSHOT_LIMIT+64*1024;
const NAME:&str="profiles-v1.dpapi";
const LOCK:&str="profiles-v1.lock";
const MAGIC:&[u8]=b"TSUGI-STREMIO-PROFILES-V1\0";
const REPARSE:u32=0x400;

fn regular(meta:&fs::Metadata)->bool{
    meta.is_file()&&!meta.file_type().is_symlink()&&meta.file_attributes()&REPARSE==0
}
fn directory(root:&Path)->Result<PathBuf>{
    let root=root.canonicalize().map_err(|_|"profile-store")?;
    let path=root.join("stremio");
    match fs::create_dir(&path){Ok(())=>(),Err(e) if e.kind()==std::io::ErrorKind::AlreadyExists=>(),Err(_)=>return Err("profile-store")}
    let meta=fs::symlink_metadata(&path).map_err(|_|"profile-store")?;
    if !meta.is_dir()||meta.file_type().is_symlink()||meta.file_attributes()&REPARSE!=0{return Err("profile-store");}
    let actual=path.canonicalize().map_err(|_|"profile-store")?;
    if actual.parent()!=Some(root.as_path()){return Err("profile-store");}
    Ok(actual)
}
fn read(path:&Path)->Result<Vec<u8>>{
    let meta=fs::symlink_metadata(path).map_err(|_|"profile-store")?;
    if !regular(&meta)||meta.len()==0||meta.len()>CIPHER_LIMIT as u64{return Err("profile-store");}
    let file=File::open(path).map_err(|_|"profile-store")?;
    if !regular(&file.metadata().map_err(|_|"profile-store")?){return Err("profile-store");}
    let mut bytes=Vec::new();
    file.take(CIPHER_LIMIT as u64+1).read_to_end(&mut bytes).map_err(|_|"profile-store")?;
    if bytes.len()!=meta.len() as usize||bytes.len()>CIPHER_LIMIT{return Err("profile-store");}
    Ok(bytes)
}
fn crypt(input:&[u8],encrypt:bool)->Result<Vec<u8>>{
    if input.is_empty()||input.len()>CIPHER_LIMIT{return Err("profile-store");}
    let blob=CRYPT_INTEGER_BLOB{cbData:input.len() as u32,pbData:input.as_ptr() as *mut u8};
    let mut out=CRYPT_INTEGER_BLOB{cbData:0,pbData:null_mut()};
    // SAFETY: the input remains valid for the synchronous call; DPAPI owns
    // the output allocation, which is freed with LocalFree on every path.
    let ok=unsafe{
        if encrypt{CryptProtectData(&blob,null(),null(),null(),null(),CRYPTPROTECT_UI_FORBIDDEN,&mut out)}
        else{CryptUnprotectData(&blob,null_mut(),null(),null(),null(),CRYPTPROTECT_UI_FORBIDDEN,&mut out)}
    };
    let result=if ok!=0&&!out.pbData.is_null()&&out.cbData>0&&(out.cbData as usize)<=CIPHER_LIMIT{
        Ok(unsafe{std::slice::from_raw_parts(out.pbData,out.cbData as usize)}.to_vec())
    }else{Err("profile-store")};
    if !out.pbData.is_null(){
        unsafe {
            if !encrypt&&(out.cbData as usize)<=CIPHER_LIMIT{
                for i in 0..out.cbData as usize{std::ptr::write_volatile(out.pbData.add(i),0);}
            }
            let _=LocalFree(out.pbData.cast());
        }
    }
    result
}
fn decode(cipher:&[u8])->Result<Profiles>{
    let plaintext=crypt(cipher,false)?;
    let data=plaintext.strip_prefix(MAGIC).ok_or("profile-store")?;
    Profiles::decode(data)
}
// An exclusive Windows file handle prevents separate desktop processes from
// draining the same queue or replacing each other's encrypted snapshots.
pub(super) struct Store{root:PathBuf,_lock:File}
impl Store{
    pub(super) fn open(root:&Path)->Result<(Self,Profiles)>{
        let root=root.canonicalize().map_err(|_|"profile-store")?;
        let dir=directory(&root)?;
        let lock_path=dir.join(LOCK);
        match fs::symlink_metadata(&lock_path){
            Ok(meta) if !regular(&meta)=>return Err("profile-store"),
            Ok(_)=>(),
            Err(e) if e.kind()==std::io::ErrorKind::NotFound=>(),
            Err(_)=>return Err("profile-store"),
        }
        // FILE_FLAG_OPEN_REPARSE_POINT + exclusive sharing: never follow a
        // substituted junction/symlink or permit another writer to open it.
        let lock=OpenOptions::new().read(true).write(true).create(true).truncate(false)
            .share_mode(0).custom_flags(0x00200000).open(&lock_path).map_err(|_|"profile-store")?;
        if !regular(&lock.metadata().map_err(|_|"profile-store")?){return Err("profile-store");}
        let store=Self{root,_lock:lock};
        let path=dir.join(NAME);
        let profiles=match fs::symlink_metadata(&path){
            Ok(_)=>decode(&read(&path)?)?,
            Err(e) if e.kind()==std::io::ErrorKind::NotFound=>Profiles::default(),
            Err(_)=>return Err("profile-store"),
        };
        Ok((store,profiles))
    }
    pub(super) fn save(&self,profiles:&Profiles)->Result<()>{
        let dir=directory(&self.root)?;
        let target=dir.join(NAME);
        match fs::symlink_metadata(&target){
            Ok(meta) if !regular(&meta)=>return Err("profile-store"),
            Ok(_)=>(),
            Err(e) if e.kind()==std::io::ErrorKind::NotFound=>(),
            Err(_)=>return Err("profile-store"),
        }
        let mut plaintext=MAGIC.to_vec();
        plaintext.extend(profiles.encode()?);
        let cipher=crypt(&plaintext,true)?;
        let mut nonce=[0u8;16];getrandom::fill(&mut nonce).map_err(|_|"profile-store")?;
        let suffix:String=nonce.iter().map(|b|format!("{b:02x}")).collect();
        let temp=dir.join(format!("profiles-{suffix}.tmp"));
        let mut file=OpenOptions::new().create_new(true).write(true).open(&temp).map_err(|_|"profile-store")?;
        let written=file.write_all(&cipher).and_then(|_|file.sync_all());
        drop(file);
        let result=(||{
            written.map_err(|_|"profile-store")?;
            let actual=read(&temp)?;
            // Verify the exact encrypted file can be decrypted and decoded
            // before replacing the previous valid snapshot.
            if crypt(&actual,false)?!=plaintext{return Err("profile-store");}
            decode(&actual)?;
            fs::rename(&temp,&target).map_err(|_|"profile-store")
        })();
        if result.is_err(){let _=fs::remove_file(&temp);}
        result
    }
}
#[cfg(test)]
mod tests{
    use super::*;
    use super::super::Action;
    struct Temp(PathBuf);
    impl Temp{
        fn new()->Self{
            let mut nonce=[0u8;16];getrandom::fill(&mut nonce).unwrap();
            let suffix:String=nonce.iter().map(|b|format!("{b:02x}")).collect();
            let path=std::env::temp_dir().join(format!("tsugi-profile-fixture-{suffix}"));
            fs::create_dir(&path).unwrap();Self(path)
        }
    }
    impl Drop for Temp{fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
    #[test]
    fn encrypted_store_roundtrip_replaces_and_preserves_corrupt_state(){
        let root=Temp::new();
        let (store,mut profiles)=Store::open(&root.0).ok().unwrap();
        assert!(!root.0.join("stremio").join(NAME).exists());
        profiles.execute(Action::ProfileCreate{name:"Synthetic profile sentinel".into()}).unwrap();
        store.save(&profiles).unwrap();
        let path=root.0.join("stremio").join(NAME);
        let cipher=fs::read(&path).unwrap();
        assert!(!cipher.windows(b"Synthetic profile sentinel".len()).any(|w|w==b"Synthetic profile sentinel"));
        assert!(Store::open(&root.0).is_err());
        drop(store);
        let (store,mut restored)=Store::open(&root.0).ok().unwrap();
        assert_eq!(restored.execute(Action::ProfileList).unwrap(),profiles.execute(Action::ProfileList).unwrap());
        restored.execute(Action::ProfileRename{profile_id:2,name:"Renamed".into()}).unwrap();
        store.save(&restored).unwrap();
        drop(store);
        let (store,mut reopened)=Store::open(&root.0).ok().unwrap();
        assert_eq!(reopened.execute(Action::ProfileList).unwrap(),restored.execute(Action::ProfileList).unwrap());
        drop(store);
        fs::write(&path,b"corrupt fixture").unwrap();
        assert!(Store::open(&root.0).is_err());
        assert_eq!(fs::read(&path).unwrap(),b"corrupt fixture");
    }
}
