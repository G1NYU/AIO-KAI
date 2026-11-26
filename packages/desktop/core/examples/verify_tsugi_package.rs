//! Read-only verification and disposable staging helper for release acceptance.
#[cfg(windows)]
fn main() {
    use aiostreams_desktop_core::portable_package::{verify_package,probe_stage_package};
    use std::{path::PathBuf, sync::atomic::AtomicBool};
    let mut args: Vec<_> = std::env::args_os().skip(1).collect();
    let stage = args.first().is_some_and(|arg| arg == "--stage-probe");
    if stage { args.remove(0); }
    let [path, bytes, sha, commit] = args.as_slice() else {
        eprintln!("Usage: verify_tsugi_package [--stage-probe] <zip> <expected-bytes> <sha256> <source-commit>");
        std::process::exit(2);
    };
    let Some(bytes) = bytes.to_str().and_then(|s| s.parse::<u64>().ok()) else { std::process::exit(2); };
    let (Some(sha),Some(commit)) = (sha.to_str(),commit.to_str()) else { std::process::exit(2); };
    if stage {
        match probe_stage_package(&PathBuf::from(path),bytes,sha,commit,&AtomicBool::new(false)) {
            Ok(report) => println!("PASS portable stage commit={} sha256={} files={} directories={} tree_sha256={}",
                report.package.source_commit,report.package.sha256,report.files,report.directories,report.tree_sha256),
            Err(error) => { eprintln!("{error}"); std::process::exit(1); }
        }
        return;
    }
    match verify_package(&PathBuf::from(path),bytes,sha,commit,&AtomicBool::new(false)) {
        Ok(report) => println!("PASS portable package commit={} sha256={} bytes={} unpacked={} entries={}",
            report.source_commit,report.sha256,report.package_bytes,report.unpacked_bytes,report.entries),
        Err(error) => { eprintln!("{error}"); std::process::exit(1); }
    }
}
#[cfg(not(windows))]
fn main() {
    eprintln!("This read-only package verifier requires Windows.");
    std::process::exit(2);
}
