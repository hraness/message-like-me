#[cfg(not(target_os = "macos"))]
compile_error!("Textbutler Desktop supports macOS only.");

use serde_json::{json, Value};
use std::fs;
use std::io::{Read, Write};
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{FileTypeExt, MetadataExt};
use std::os::unix::net::UnixStream;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};
use tauri::webview::NewWindowResponse;

const PROTOCOL: &str = "textbutler.control.v1";
const MAX_FRAME_BYTES: usize = 1_048_576;
static IN_FLIGHT: AtomicUsize = AtomicUsize::new(0);
struct RelayPermit;
impl RelayPermit {
    fn acquire() -> Option<Self> {
        IN_FLIGHT.fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| (count < 4).then_some(count + 1)).ok().map(|_| Self)
    }
}
impl Drop for RelayPermit { fn drop(&mut self) { IN_FLIGHT.fetch_sub(1, Ordering::AcqRel); } }
fn remaining(deadline: Instant) -> std::io::Result<Duration> {
    deadline.checked_duration_since(Instant::now()).filter(|duration| !duration.is_zero())
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::TimedOut, "Control deadline elapsed"))
}

fn connect_bounded(path: &Path, deadline: Instant) -> std::io::Result<UnixStream> {
    let bytes = path.as_os_str().as_bytes();
    let mut address: libc::sockaddr_un = unsafe { std::mem::zeroed() };
    if bytes.len() >= address.sun_path.len() { return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "Socket path is too long")); }
    address.sun_family = libc::AF_UNIX as libc::sa_family_t;
    for (destination, byte) in address.sun_path.iter_mut().zip(bytes) { *destination = *byte as libc::c_char; }
    let length = (std::mem::offset_of!(libc::sockaddr_un, sun_path) + bytes.len() + 1) as libc::socklen_t;
    address.sun_len = length as u8;
    let fd = unsafe { libc::socket(libc::AF_UNIX, libc::SOCK_STREAM, 0) };
    if fd < 0 { return Err(std::io::Error::last_os_error()); }
    let stream = unsafe { UnixStream::from_raw_fd(fd) };
    stream.set_nonblocking(true)?;
    let result = unsafe { libc::connect(fd, &address as *const _ as *const libc::sockaddr, length) };
    if result != 0 {
        let error = std::io::Error::last_os_error();
        if !matches!(error.raw_os_error(), Some(libc::EINPROGRESS | libc::EAGAIN)) { return Err(error); }
        loop {
            let duration = remaining(deadline)?;
            let mut descriptor = libc::pollfd { fd, events: libc::POLLOUT, revents: 0 };
            let polled = unsafe { libc::poll(&mut descriptor, 1, duration.as_millis().clamp(1, i32::MAX as u128) as i32) };
            if polled == 0 { return Err(std::io::Error::new(std::io::ErrorKind::TimedOut, "Socket connect deadline elapsed")); }
            if polled < 0 {
                let error = std::io::Error::last_os_error();
                if error.kind() == std::io::ErrorKind::Interrupted { continue; }
                return Err(error);
            }
            let mut socket_error: libc::c_int = 0;
            let mut size = std::mem::size_of::<libc::c_int>() as libc::socklen_t;
            if unsafe { libc::getsockopt(fd, libc::SOL_SOCKET, libc::SO_ERROR, &mut socket_error as *mut _ as *mut libc::c_void, &mut size) } != 0 { return Err(std::io::Error::last_os_error()); }
            if socket_error != 0 { return Err(std::io::Error::from_raw_os_error(socket_error)); }
            break;
        }
    }
    stream.set_nonblocking(false)?;
    Ok(stream)
}

fn exchange(mut stream: UnixStream, request: &[u8], deadline: Instant) -> std::io::Result<Vec<u8>> {
    let mut written = 0;
    while written < request.len() {
        stream.set_write_timeout(Some(remaining(deadline)?))?;
        match stream.write(&request[written..]) {
            Ok(0) => return Err(std::io::Error::new(std::io::ErrorKind::WriteZero, "Incomplete request")),
            Ok(count) => written += count,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        }
    }
    let mut response = Vec::new();
    let mut chunk = [0_u8; 4096];
    loop {
        stream.set_read_timeout(Some(remaining(deadline)?))?;
        let count = match stream.read(&mut chunk) {
            Ok(0) => return Err(std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "Incomplete response")),
            Ok(count) => count,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        };
        if response.len() + count > MAX_FRAME_BYTES { return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "Oversized response")); }
        if let Some(index) = chunk[..count].iter().position(|byte| *byte == b'\n') {
            if index + 1 != count { return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "Multiple response frames")); }
            response.extend_from_slice(&chunk[..count]);
            return Ok(response);
        }
        response.extend_from_slice(&chunk[..count]);
    }
}

fn failure(code: &str, message: &str) -> Value {
    json!({ "protocol": PROTOCOL, "ok": false, "code": code, "message": message })
}

fn local_url(url: &tauri::Url) -> bool {
    url.scheme() == "tauri"
        && url.host_str() == Some("localhost")
        && (url.path().is_empty() || url.path() == "/" || url.path() == "/index.html")
        && url.query().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
}

fn allowed_request(request: &Value) -> bool {
    let Some(row) = request.as_object() else { return false; };
    if row.get("protocol").and_then(Value::as_str) != Some(PROTOCOL) { return false; }
    let fields: &[&str] = match row.get("command").and_then(Value::as_str) {
        Some("snapshot" | "activity.list" | "conversations.list") => &["protocol", "command"],
        Some("owner.job.read") => &["protocol", "command", "jobId"],
        Some("contact.enroll") => &["protocol", "command", "candidateId", "expectedRevision", "initializeHistory"],
        Some("contact.memory.read") => &["protocol", "command", "contactId"],
        Some("contact.settings.update") => &["protocol", "command", "contactId", "expectedRevision", "settings"],
        Some("contact.memory.write") => &["protocol", "command", "contactId", "expectedRevision", "content"],
        Some("global.settings.update") => &["protocol", "command", "expectedRevision", "settings"],
        _ => return false,
    };
    row.len() == fields.len() && fields.iter().all(|field| row.contains_key(*field))
}

fn no_symlink_ancestors(path: &Path) -> Result<(), String> {
    let mut current = PathBuf::new();
    for component in path.components() {
        if matches!(component, Component::ParentDir | Component::CurDir) { return Err("The daemon path is not canonical.".into()); }
        current.push(component);
        let metadata = fs::symlink_metadata(&current).map_err(|_| "The daemon directory could not be inspected.")?;
        if metadata.file_type().is_symlink() { return Err("The daemon path contains a symbolic link.".into()); }
    }
    Ok(())
}

fn private_parent(parent: &Path, uid: u32) -> Result<(), String> {
    no_symlink_ancestors(parent)?;
    let metadata = fs::symlink_metadata(parent).map_err(|_| "The daemon directory could not be inspected.")?;
    if !metadata.is_dir() || metadata.uid() != uid || metadata.mode() & 0o777 != 0o700 {
        return Err("The daemon directory must be owned by you with mode 0700.".into());
    }
    Ok(())
}

fn relay(request: Value) -> Value {
    if !allowed_request(&request) { return failure("invalid-request", "This control operation is not supported."); }
    let mut bytes = match serde_json::to_vec(&request) { Ok(bytes) => bytes, Err(_) => return failure("invalid-request", "The request is invalid.") };
    if bytes.len() >= MAX_FRAME_BYTES { return failure("invalid-request", "The control request exceeds 1 MiB."); }
    bytes.push(b'\n');
    let Some(home) = std::env::var_os("HOME") else { return failure("unavailable", "The local home directory is unavailable."); };
    let home = PathBuf::from(home);
    if !home.is_absolute() { return failure("unavailable", "The local home directory must be absolute."); }
    let parent = home.join("Library/Application Support/Textbutler");
    let socket = parent.join("daemon.sock");
    let uid = unsafe { libc::getuid() };
    match fs::symlink_metadata(&parent) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return failure("disconnected", "The Textbutler daemon has not been set up."),
        Err(_) => return failure("unavailable", "The daemon directory cannot be inspected."),
        Ok(_) => {},
    }
    if let Err(error) = private_parent(&parent, uid) { return failure("unavailable", &error); }
    let metadata = match fs::symlink_metadata(&socket) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return failure("disconnected", "The Textbutler daemon is not running."),
        Err(_) => return failure("unavailable", "The daemon socket cannot be inspected."),
    };
    if !metadata.file_type().is_socket() || metadata.uid() != uid || metadata.mode() & 0o077 != 0 {
        return failure("unavailable", "The daemon socket must be private and owned by you.");
    }
    let deadline = Instant::now() + Duration::from_secs(4);
    let stream = match connect_bounded(&socket, deadline) {
        Ok(stream) => stream,
        Err(error) if matches!(error.kind(), std::io::ErrorKind::NotFound | std::io::ErrorKind::ConnectionRefused) => return failure("disconnected", "The Textbutler daemon is not running."),
        Err(_) => return failure("unavailable", "The daemon connection was refused or unavailable."),
    };
    let mut peer_uid: libc::uid_t = 0;
    let mut peer_gid: libc::gid_t = 0;
    if unsafe { libc::getpeereid(stream.as_raw_fd(), &mut peer_uid, &mut peer_gid) } != 0 || peer_uid != uid {
        return failure("unavailable", "The daemon peer identity could not be verified.");
    }
    if let Err(error) = private_parent(&parent, uid) { return failure("unavailable", &error); }
    let response = match exchange(stream, &bytes, deadline) {
        Ok(response) => response,
        Err(_) => return failure("unavailable", "The daemon request exceeded its deadline or returned an incomplete or invalid frame."),
    };
    match serde_json::from_slice::<Value>(&response) {
        Ok(value) if value.get("protocol").and_then(Value::as_str) == Some(PROTOCOL) => value,
        _ => failure("unavailable", "The daemon returned an incompatible control response."),
    }
}

#[tauri::command]
async fn control_request(window: tauri::WebviewWindow, request: Value) -> Value {
    if window.label() != "main" || !window.url().map(|url| local_url(&url)).unwrap_or(false) {
        return failure("unavailable", "Only the bundled main window may access daemon controls.");
    }
    let Some(permit) = RelayPermit::acquire() else { return failure("unavailable", "Too many control requests are in progress. Try again shortly."); };
    tauri::async_runtime::spawn_blocking(move || { let _permit = permit; relay(request) }).await
        .unwrap_or_else(|_| failure("unavailable", "The native control task could not complete."))
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![control_request])
        .setup(|app| {
            let config = app.config().app.windows.first().ok_or("Missing main window configuration")?;
            tauri::WebviewWindowBuilder::from_config(app, config)?
                .on_navigation(local_url)
                .on_new_window(|_, _| NewWindowResponse::Deny)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Textbutler could not open its local control panel");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn trickling_responses_do_not_extend_the_absolute_deadline() {
        let (client, mut server) = UnixStream::pair().unwrap();
        let writer = std::thread::spawn(move || {
            let mut request = [0_u8; 3]; server.read_exact(&mut request).unwrap();
            for _ in 0..100 {
                if server.write_all(b"x").is_err() { break; }
                std::thread::sleep(Duration::from_millis(10));
            }
        });
        let start = Instant::now();
        assert!(exchange(client, b"{}\n", start + Duration::from_millis(45)).is_err());
        assert!(start.elapsed() < Duration::from_secs(1));
        writer.join().unwrap();
    }
    #[test]
    fn only_bundled_navigation_has_authority() {
        for url in ["tauri://localhost", "tauri://localhost/index.html"] { assert!(local_url(&url.parse().unwrap())); }
        for url in ["https://textbutler.app", "http://localhost", "tauri://evil/index.html", "tauri://localhost/other.html", "tauri://localhost/index.html?remote=1"] { assert!(!local_url(&url.parse().unwrap())); }
    }
    #[test]
    fn bridge_has_no_arbitrary_execution_or_file_operation() {
        assert!(allowed_request(&json!({ "protocol": PROTOCOL, "command": "snapshot" })));
        assert!(allowed_request(&json!({ "protocol": PROTOCOL, "command": "conversations.list" })));
        assert!(allowed_request(&json!({ "protocol": PROTOCOL, "command": "owner.job.read", "jobId": "test-job" })));
        assert!(allowed_request(&json!({ "protocol": PROTOCOL, "command": "contact.enroll", "candidateId": "test-candidate", "expectedRevision": 1, "initializeHistory": false })));
        assert!(!allowed_request(&json!({ "protocol": PROTOCOL, "command": "contact.enroll", "candidateId": "test-candidate", "expectedRevision": 1, "initializeHistory": false, "chatGuid": "arbitrary-target" })));
        for command in ["shell", "exec", "read_file", "messages.send", "daemon.start"] { assert!(!allowed_request(&json!({ "protocol": PROTOCOL, "command": command }))); }
        assert!(!allowed_request(&json!({ "protocol": PROTOCOL, "command": "snapshot", "path": "/tmp" })));
    }
}
