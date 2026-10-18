use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::AppHandle;

static REQUESTS: once_cell::sync::Lazy<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(HashMap::new()));

fn connection_failure(error: &reqwest::Error, target: &str) -> String {
    use std::error::Error;
    let mut details = String::new();
    let mut source: Option<&(dyn Error + 'static)> = Some(error);
    while let Some(current) = source {
        details.push_str(&current.to_string().to_lowercase());
        source = current.source();
    }
    // Classify internally; never expose error chains containing URLs or keys.
    let (code, message) = if error.is_timeout() {
        (
            "SERVICE_TIMEOUT",
            "连接超时，请检查服务、代理或隧道是否在线",
        )
    } else if details.contains("certificate") || details.contains("certinvalid") {
        (
            "SERVICE_CERTIFICATE",
            "证书验证失败，请检查服务证书和系统信任链",
        )
    } else if details.contains("tls") || details.contains("handshake") {
        (
            "SERVICE_TLS",
            "TLS 握手失败，请核对域名是否生效、隧道地址是否有效，以及代理连接",
        )
    } else if details.contains("dns") || details.contains("resolve") || details.contains("lookup") {
        ("SERVICE_DNS", "域名解析失败，请核对服务域名和隧道地址")
    } else if error.is_connect() {
        (
            "SERVICE_CONNECT",
            "无法建立连接，请检查服务监听端口、防火墙和代理是否启动",
        )
    } else if error.is_builder() {
        (
            "SERVICE_REQUEST",
            "请求配置无效，请检查服务地址和访问密钥格式",
        )
    } else {
        ("SERVICE_NETWORK", "网络请求失败，请检查反向代理和服务状态")
    };
    format!("{code} [{target}]: {message}")
}

fn is_local_service(url: &reqwest::Url) -> bool {
    let host = url.host_str().unwrap_or_default().trim_matches(['[', ']']);
    host.eq_ignore_ascii_case("localhost")
        || match host.parse::<std::net::IpAddr>() {
            Ok(std::net::IpAddr::V4(ip)) => {
                ip.is_loopback() || ip.is_private() || ip.is_link_local()
            }
            Ok(std::net::IpAddr::V6(ip)) => {
                ip.is_loopback() || ip.is_unique_local() || ip.is_unicast_link_local()
            }
            Err(_) => false,
        }
}

fn credential(id: &str) -> Result<keyring::Entry, String> {
    if id.len() > 80
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
    {
        return Err("Invalid extension ID".into());
    }
    keyring::Entry::new("com.mokidown.extensions", id).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn extension_set_credential(id: String, value: String) -> Result<(), String> {
    credential(&id)?
        .set_password(&value)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn extension_delete_credential(id: String) -> Result<(), String> {
    match credential(&id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[derive(Serialize)]
pub struct HttpResponse {
    status: u16,
    body: String,
}

#[tauri::command]
pub async fn extension_cancel_request(request_id: String) -> Result<(), String> {
    if let Some(flag) = REQUESTS.lock().map_err(|e| e.to_string())?.get(&request_id) {
        flag.store(true, Ordering::SeqCst);
    }
    Ok(())
}

#[tauri::command]
pub async fn extension_http_request(
    url: String,
    method: String,
    body: Option<String>,
    credential_id: Option<String>,
    request_id: Option<String>,
) -> Result<HttpResponse, String> {
    let cancelled = Arc::new(AtomicBool::new(false));
    if let Some(id) = &request_id {
        REQUESTS
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id.clone(), cancelled.clone());
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        let parsed = reqwest::Url::parse(&url).map_err(|_| "Invalid URL")?;
        if !["https", "http"].contains(&parsed.scheme())
            || !parsed.username().is_empty()
            || parsed.password().is_some()
        {
            return Err("Service URL must use HTTP or HTTPS without embedded credentials".into());
        }
        if !["GET", "PUT", "POST", "DELETE"].contains(&method.as_str())
            || body.as_ref().is_some_and(|b| b.len() > 4 * 1024 * 1024)
        {
            return Err("Invalid method or request too large".into());
        }
        if cancelled.load(Ordering::SeqCst) {
            return Err("Plugin stopped".into());
        }
        let target = format!(
            "{}:{}",
            parsed.host_str().unwrap_or_default(),
            parsed.port_or_known_default().unwrap_or(0)
        );
        let mut builder = reqwest::blocking::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .redirect(if credential_id.is_some() {
                reqwest::redirect::Policy::none()
            } else {
                reqwest::redirect::Policy::limited(5)
            });
        // Local/LAN office traffic must not be sent to an Internet proxy.
        if is_local_service(&parsed) {
            builder = builder.no_proxy();
        }
        let client = builder
            .build()
            .map_err(|_| "Could not create HTTP client")?;
        let mut request = client.request(method.parse().map_err(|_| "Invalid method")?, parsed);
        if let Some(id) = credential_id {
            let token = credential(&id)?
                .get_password()
                .map_err(|_| "Configure the plugin access key first")?;
            request = request.bearer_auth(token);
        }
        if let Some(body) = body {
            request = request
                .header("Content-Type", "application/json")
                .body(body);
        }
        let response = request
            .send()
            .map_err(|error| connection_failure(&error, &target))?;
        let status = response.status().as_u16();
        let mut bytes = Vec::new();
        response
            .take(4 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Could not read service response")?;
        if bytes.len() > 4 * 1024 * 1024 {
            return Err("Service response exceeds 4 MiB".into());
        }
        if cancelled.load(Ordering::SeqCst) {
            return Err("Plugin stopped".into());
        }
        Ok(HttpResponse {
            status,
            body: String::from_utf8(bytes).map_err(|_| "Service response is not UTF-8")?,
        })
    })
    .await
    .map_err(|e| e.to_string())?;
    if let Some(id) = request_id {
        REQUESTS.lock().map_err(|e| e.to_string())?.remove(&id);
    }
    result
}

fn resolve_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let root = root
        .canonicalize()
        .map_err(|_| "Workspace is unavailable")?;
    if !root.is_dir() {
        return Err("Workspace must be a directory".into());
    }
    let relative = Path::new(relative);
    if relative
        .components()
        .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("Only relative paths without traversal are allowed".into());
    }
    let mut target = root.clone();
    for part in relative.components() {
        target.push(part);
        if let Ok(metadata) = fs::symlink_metadata(&target) {
            if metadata.file_type().is_symlink()
                || !target
                    .canonicalize()
                    .map_err(|_| "Invalid path")?
                    .starts_with(&root)
            {
                return Err("Path escapes the selected workspace".into());
            }
        }
    }
    Ok(target)
}

#[tauri::command]
pub async fn extension_workspace(
    app: AppHandle,
    root: String,
    path: String,
    action: String,
    content: Option<String>,
    expected_hash: Option<String>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let target = resolve_path(Path::new(&root), &path)?;
        if action == "list" {
            let mut entries = Vec::new();
            for entry in fs::read_dir(&target).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let kind = entry.file_type().map_err(|e| e.to_string())?;
                if kind.is_symlink() {
                    continue;
                }
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.') {
                    continue;
                }
                entries.push(serde_json::json!({"name": name, "directory": kind.is_dir()}));
            }
            return Ok(serde_json::Value::Array(entries));
        }
        if fs::metadata(&target).is_ok_and(|metadata| metadata.len() > 32 * 1024 * 1024) {
            return Err("File exceeds 32 MiB".into());
        }
        let current = match fs::read_to_string(&target) {
            Ok(text) => Some(text),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(error.to_string()),
        };
        let checksum = current
            .as_ref()
            .map(|text| format!("{:x}", Sha256::digest(text.as_bytes())));
        if action == "read" {
            return Ok(serde_json::json!({"content": current, "checksum": checksum}));
        }
        if !["write", "delete"].contains(&action.as_str()) {
            return Err("Unknown workspace operation".into());
        }
        if checksum != expected_hash {
            return Err("File changed on disk; reload before applying the operation".into());
        }
        if let Some(text) = &current {
            crate::capture_history(&app, &target.to_string_lossy(), text, true, None)?;
        }
        if action == "delete" {
            if current.is_some() {
                fs::remove_file(&target).map_err(|e| e.to_string())?;
            }
        } else {
            let text = content.ok_or("Missing file content")?;
            if text.len() > 32 * 1024 * 1024 {
                return Err("File exceeds 32 MiB".into());
            }
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            // Check newly created parents again before the atomic replacement.
            let target = resolve_path(Path::new(&root), &path)?;
            crate::atomic_write(&target, text.as_bytes())?;
        }
        Ok(serde_json::json!(true))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_service_addresses_bypass_external_proxy() {
        for address in [
            "http://localhost:4340",
            "http://127.0.0.1:4340",
            "http://192.168.1.2:8787",
            "http://10.0.0.2",
            "http://[::1]",
            "http://[fd00::1]",
        ] {
            assert!(is_local_service(&reqwest::Url::parse(address).unwrap()));
        }
        assert!(!is_local_service(
            &reqwest::Url::parse("https://example.com").unwrap()
        ));
    }
    #[test]
    fn workspace_paths_reject_escape_and_allow_new_descendants() {
        let directory = tempfile::tempdir().unwrap();
        assert!(resolve_path(directory.path(), "../outside").is_err());
        assert!(resolve_path(directory.path(), "/outside").is_err());
        assert!(resolve_path(directory.path(), "folder/file.md")
            .unwrap()
            .starts_with(directory.path().canonicalize().unwrap()));
    }
    #[cfg(unix)]
    #[test]
    fn workspace_paths_reject_symlinks() {
        let directory = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), directory.path().join("link")).unwrap();
        assert!(resolve_path(directory.path(), "link/file.md").is_err());
    }
}
