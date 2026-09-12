use serde_json::{json, Value};
use std::fs;
use std::io::Read;
use std::os::fd::AsRawFd;
use std::os::unix::fs::MetadataExt;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

pub const PROTOCOL: &str = "textbutler.lifecycle.v1";
const LIMIT: usize = 1_048_576;
static ACTIVE: AtomicBool = AtomicBool::new(false);
static UNCERTAIN: AtomicBool = AtomicBool::new(false);
static UNJOINED: AtomicBool = AtomicBool::new(false);
pub struct Permit;
impl Permit { pub fn acquire() -> Option<Self> { if UNJOINED.load(Ordering::Acquire) { return None; } ACTIVE.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).ok().map(|_| Self) } }
impl Drop for Permit { fn drop(&mut self) { ACTIVE.store(false, Ordering::Release); } }
pub fn failure(status: &str, message: &str) -> Value { json!({"protocol":PROTOCOL,"ok":false,"status":status,"message":message}) }
pub fn operation(request: &Value) -> Option<&str> {
    let row = request.as_object()?;
    if row.len() != 2 || row.get("protocol")?.as_str()? != PROTOCOL { return None; }
    match row.get("command")?.as_str()? { command @ ("install" | "uninstall" | "status") => Some(command), _ => None }
}
fn resource(path: &Path, executable: bool) -> Result<(), ()> {
    super::no_symlink_ancestors(path).map_err(|_| ())?;
    let m = fs::symlink_metadata(path).map_err(|_| ())?;
    let uid = unsafe { libc::getuid() };
    if !m.is_file() || m.nlink() != 1 || (m.uid() != uid && m.uid() != 0) || m.mode() & 0o022 != 0 || m.size() > 512 * 1024 * 1024 || (executable && m.mode() & 0o111 == 0) { return Err(()); }
    Ok(())
}
pub fn sanitized_result(value: &Value) -> Option<Value> {
    let result = value.as_object()?; let status = result.get("launchAgent")?.as_object()?;
    let installation = status.get("installation")?.as_str()?; let service = status.get("service")?.as_str()?;
    let detail = status.get("detail")?.as_str()?;
    if status.get("label")?.as_str()? != "app.textbutler.daemon" || status.get("automaticReplies")?.as_str()? != "unavailable" || result.get("automaticReplies")?.as_str()? != "unavailable"
        || !["absent","installed","conflict","indeterminate","unsupported"].contains(&installation)
        || !["not-loaded","loaded","running","unknown"].contains(&service) || detail.len() > 2048 || detail.chars().any(char::is_control) { return None; }
    let ok = result.get("ok")?.as_bool()?;
    Some(json!({"protocol":PROTOCOL,"ok":ok,"status":"completed","result":{"ok":ok,"automaticReplies":"unavailable","launchAgent":{"label":"app.textbutler.daemon","installation":installation,"service":service,"detail":detail,"automaticReplies":"unavailable"}}}))
}
fn nonblocking(fd: i32) -> Result<(), ()> {
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 { return Err(()); } Ok(())
}
fn drain(reader: &mut impl Read, bytes: &mut Vec<u8>, total: &mut usize) -> Result<bool, ()> {
    let mut chunk = [0_u8; 4096];
    loop { match reader.read(&mut chunk) {
        Ok(0) => return Ok(true),
        Ok(count) => { *total += count; if *total > LIMIT { return Err(()); } bytes.extend_from_slice(&chunk[..count]); },
        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => return Ok(false),
        Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
        Err(_) => return Err(()),
    } }
}
pub fn run(resources: PathBuf, operation: &str) -> Value {
    if operation != "status" && UNCERTAIN.load(Ordering::Acquire) { return failure("indeterminate", "A previous background-service action was interrupted. Check service status and reconcile the retained owner receipt before another action."); }
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from).filter(|p| p.is_absolute()) else { return failure("unavailable", "The local home directory is unavailable."); };
    let root = resources.join("textbutler-runtime"); let runtime = root.join("textbutler-bun"); let entry = root.join("cli.ts");
    if resource(&runtime, true).is_err() || resource(&entry, false).is_err() { return failure("unavailable", "The bundled Textbutler runtime is missing or unsafe. Reinstall the verified app."); }
    if operation == "install" {
        let app = resources.parent().and_then(Path::parent);
        if app != Some(Path::new("/Applications/Textbutler.app")) && app != Some(home.join("Applications/Textbutler.app").as_path()) { return failure("unavailable", "Move Textbutler.app to Applications before starting its background service."); }
    }
    let mut command = Command::new(runtime);
    command.args(["--no-env-file", "--no-install"]).arg(entry).args(["daemon", operation]).current_dir(&root)
        .env_clear().env("HOME", home).env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).process_group(0);
    let mut child = match command.spawn() { Ok(child) => child, Err(_) => return failure("unavailable", "The bundled background-service command could not start.") };
    let mut stdout = child.stdout.take().unwrap(); let mut stderr = child.stderr.take().unwrap();
    // Each launchctl operation is bounded by 20s in the CLI; uninstall has up to
    // four sequential probes. The outer deadline permits their cleanup to join.
    let deadline = Instant::now() + Duration::from_secs(120);
    let mut out = Vec::new(); let mut err = Vec::new(); let mut total = 0;
    let mut done = None; let mut uncertain = nonblocking(stdout.as_raw_fd()).is_err() || nonblocking(stderr.as_raw_fd()).is_err();
    while !uncertain {
        let a = drain(&mut stdout, &mut out, &mut total); let b = drain(&mut stderr, &mut err, &mut total);
        if a.is_err() || b.is_err() { uncertain = true; break; }
        if done.is_none() { match child.try_wait() { Ok(status) => done = status, Err(_) => { uncertain = true; break; } } }
        if let Some(status) = done {
            if a == Ok(true) && b == Ok(true) {
                if matches!(status.code(), Some(0 | 1)) {
                    if let Ok(value) = serde_json::from_slice::<Value>(&out) { if let Some(response) = sanitized_result(&value) { return response; } }
                }
                uncertain = true; break;
            }
        }
        if Instant::now() >= deadline { uncertain = true; break; }
        std::thread::sleep(Duration::from_millis(10));
    }
    if uncertain {
        // Never signal a group after reaping its leader: its number may be reused.
        // A launched service belongs to launchd, not this invocation's process group.
        if done.is_none() {
            let pgid = child.id() as libc::pid_t;
            unsafe { libc::kill(-pgid, libc::SIGTERM); }
            let grace = Instant::now() + Duration::from_secs(5);
            while Instant::now() < grace { if let Ok(Some(status)) = child.try_wait() { done = Some(status); break; } std::thread::sleep(Duration::from_millis(10)); }
            if done.is_none() {
                unsafe { libc::kill(-pgid, libc::SIGKILL); }
                let kill_grace = Instant::now() + Duration::from_secs(5);
                while Instant::now() < kill_grace { if let Ok(Some(status)) = child.try_wait() { done = Some(status); break; } std::thread::sleep(Duration::from_millis(10)); }
                if done.is_none() { UNJOINED.store(true, Ordering::Release); }
            }
        }
        UNCERTAIN.store(true, Ordering::Release);
    }
    failure("indeterminate", "The background-service action did not complete conclusively. Its owner data and lifecycle receipt are preserved. Check status before recovery; do not repeat the action blindly.")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn lifecycle_accepts_only_closed_operations() {
        for command in ["status","install","uninstall"] { assert_eq!(operation(&json!({"protocol":PROTOCOL,"command":command})), Some(command)); }
        for request in [json!({"protocol":PROTOCOL,"command":"exec"}), json!({"protocol":PROTOCOL,"command":"install","path":"/tmp/evil"}), json!({"protocol":"wrong","command":"status"})] { assert!(operation(&request).is_none()); }
    }
    #[test] fn lifecycle_drops_private_snapshot_and_paths() {
        let input = json!({"ok":false,"automaticReplies":"unavailable","daemon":{"contacts":["private"]},"launchAgent":{"label":"app.textbutler.daemon","installation":"absent","service":"not-loaded","detail":"No service.","automaticReplies":"unavailable","plistPath":"/private/owner/path","pid":42}});
        let output = sanitized_result(&input).unwrap().to_string();
        for forbidden in ["private","plistPath","pid","contacts"] { assert!(!output.contains(forbidden)); }
        assert!(output.contains("completed"));
    }
    #[test] fn lifecycle_output_bound_counts_both_streams() {
        let mut bytes = Vec::new(); let mut total = LIMIT - 2;
        assert!(drain(&mut &b"abc"[..], &mut bytes, &mut total).is_err()); assert!(bytes.is_empty());
    }
}
