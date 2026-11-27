use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use percent_encoding::{percent_decode_str, utf8_percent_encode, NON_ALPHANUMERIC};
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::fs::{self, File};
use std::net::TcpListener;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
use std::thread;
use std::time::Duration;
use tauri::WebviewWindow;
use tiny_http::{Header, Method, Request, Response, Server};

mod live_reload;

const MAX_SOURCE_BYTES: usize = 16 * 1024 * 1024;
const PATH_SEGMENT: &percent_encoding::AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'.')
    .remove(b'_')
    .remove(b'~');

struct Changes {
    revision: u64,
    paths: VecDeque<(u64, String)>,
}

impl Changes {
    fn record(&mut self, paths: impl IntoIterator<Item = String>) {
        self.revision += 1;
        for path in paths {
            self.paths.push_back((self.revision, path));
        }
        while self.paths.len() > 256 {
            self.paths.pop_front();
        }
    }
}

struct Preview {
    root: Option<PathBuf>,
    entry: String,
    source: String,
    client_script: String,
    changes: Arc<Mutex<Changes>>,
    _watcher: Option<RecommendedWatcher>,
}

struct PreviewServer {
    server: Arc<Server>,
    requested_port: u16,
    port: u16,
    websocket_port: u16,
    initial_root: Option<PathBuf>,
    active_id: Mutex<String>,
    previews: Mutex<HashMap<String, Preview>>,
}

impl Drop for PreviewServer {
    fn drop(&mut self) {
        self.server.unblock();
    }
}

static SERVERS: LazyLock<Mutex<Vec<Arc<PreviewServer>>>> = LazyLock::new(|| Mutex::new(Vec::new()));

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewLocation {
    url: String,
    port: u16,
    revision: u64,
}

fn check_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("HTML previews can only be changed by the editor".into())
    }
}

fn valid_id(id: &str) -> bool {
    (24..=80).contains(&id.len())
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("static HTTP header")
}

fn asset_path(root: &Path, relative: &str) -> Option<PathBuf> {
    let decoded = percent_decode_str(relative).decode_utf8().ok()?;
    if decoded.contains(['\\', '\0']) {
        return None;
    }
    let mut path = PathBuf::new();
    for part in Path::new(decoded.as_ref()).components() {
        match part {
            Component::Normal(name) => path.push(name),
            Component::CurDir => {}
            Component::ParentDir if path.pop() => {}
            _ => return None,
        }
    }
    let mut target = root.join(path).canonicalize().ok()?;
    if target.is_dir() {
        target = target.join("index.html").canonicalize().ok()?;
    }
    target.starts_with(root).then_some(target)
}

fn response_headers(content_type: &str) -> Vec<Header> {
    vec![
        header("Content-Type", content_type),
        header("Cache-Control", "no-store"),
        header("X-Content-Type-Options", "nosniff"),
        header("Referrer-Policy", "same-origin"),
    ]
}

fn respond_text(request: Request, body: String, content_type: &str, status: u16) {
    let mut response = Response::from_string(body).with_status_code(status);
    for item in response_headers(content_type) {
        response.add_header(item);
    }
    let _ = request.respond(response);
}

fn render_html(source: &str, id: &str, port: u16, revision: u64) -> String {
    let script =
        format!("<script data-revision=\"{revision}\" src=\"http://127.0.0.1:{port}/__moki_livereload.js?session={id}&amp;revision={revision}\"></script>");
    // The browser inserts a trailing script into the document body for both
    // complete documents and HTML fragments. Source is served from memory.
    format!("{source}\n{script}")
}

fn serve(request: Request, state: &PreviewServer) {
    let host = request
        .headers()
        .iter()
        .find(|item| item.field.equiv("Host"));
    let expected_host = format!("127.0.0.1:{}", state.port);
    if host.is_none_or(|item| item.value.as_str() != expected_host)
        || !matches!(request.method(), Method::Get | Method::Head)
    {
        respond_text(
            request,
            "Request not allowed".into(),
            "text/plain; charset=utf-8",
            403,
        );
        return;
    }
    let Ok(url) = reqwest::Url::parse(&format!("http://{expected_host}{}", request.url())) else {
        respond_text(request, "Invalid preview URL".into(), "text/plain", 400);
        return;
    };
    let path = url.path().trim_start_matches('/');
    let previews = state.previews.lock().unwrap();
    if path == "__moki_livereload.js" {
        let id = url
            .query_pairs()
            .find(|(name, _)| name == "session")
            .map(|(_, value)| value.into_owned());
        let Some((id, preview)) = id.and_then(|id| previews.get_key_value(&id)) else {
            drop(previews);
            respond_text(request, "Preview closed".into(), "text/plain", 404);
            return;
        };
        let revision = url
            .query_pairs()
            .find(|(name, _)| name == "revision")
            .and_then(|(_, value)| value.parse::<u64>().ok())
            .unwrap_or(0);
        let options = serde_json::json!({"host":"127.0.0.1", "port":state.websocket_port,
            "path": format!("__moki_livereload/{id}?revision={revision}"), "snipver":1});
        let script = format!(
            "window.LiveReloadOptions={options};\n{}",
            preview.client_script
        );
        drop(previews);
        respond_text(request, script, "text/javascript; charset=utf-8", 200);
        return;
    }
    let decoded = percent_decode_str(path).decode_utf8().ok();
    let active_id = state.active_id.lock().unwrap();
    let active = previews.get_key_value(active_id.as_str());
    let referer = request
        .headers()
        .iter()
        .find(|item| item.field.equiv("Referer"))
        .and_then(|item| reqwest::Url::parse(item.value.as_str()).ok())
        .filter(|url| url.host_str() == Some("127.0.0.1") && url.port() == Some(state.port));
    let referer_path = referer.as_ref().and_then(|url| {
        percent_decode_str(url.path().trim_start_matches('/'))
            .decode_utf8()
            .ok()
            .map(|path| path.into_owned())
    });
    let session = |url: &reqwest::Url| {
        url.query_pairs()
            .find(|(name, _)| name == "__moki_preview")
            .and_then(|(_, id)| previews.get_key_value(id.as_ref()))
    };
    let selected = if url.query_pairs().any(|(name, _)| name == "__moki_preview") {
        session(&url)
    } else {
        referer
            .as_ref()
            .and_then(session)
            .or_else(|| {
                active.filter(|(_, preview)| {
                    path.is_empty() || decoded.as_deref() == Some(preview.entry.as_str())
                })
            })
            .or_else(|| {
                previews
                    .iter()
                    .find(|(_, preview)| decoded.as_deref() == Some(preview.entry.as_str()))
            })
            .or_else(|| {
                previews
                    .iter()
                    .find(|(_, preview)| referer_path.as_deref() == Some(preview.entry.as_str()))
            })
            .or(active)
    };
    let Some((id, preview)) = selected else {
        drop(active_id);
        drop(previews);
        respond_text(
            request,
            "Preview closed".into(),
            "text/plain; charset=utf-8",
            404,
        );
        return;
    };
    let id = id.clone();
    let revision = preview.changes.lock().unwrap().revision;
    if path.is_empty() || decoded.as_deref() == Some(preview.entry.as_str()) {
        let html = render_html(&preview.source, &id, state.port, revision);
        drop(active_id);
        drop(previews);
        respond_text(request, html, "text/html; charset=utf-8", 200);
        return;
    }
    let asset = preview
        .root
        .as_ref()
        .and_then(|root| asset_path(root, path));
    drop(active_id);
    drop(previews);
    let Some(asset) = asset else {
        respond_text(
            request,
            "Resource not found".into(),
            "text/plain; charset=utf-8",
            404,
        );
        return;
    };
    if matches!(
        asset.extension().and_then(|extension| extension.to_str()),
        Some("html" | "htm")
    ) {
        if let Ok(html) = fs::read_to_string(&asset) {
            respond_text(
                request,
                render_html(&html, &id, state.port, revision),
                "text/html; charset=utf-8",
                200,
            );
            return;
        }
    }
    if let Ok(file) = File::open(&asset) {
        let mut response = Response::from_file(file);
        let mime = mime_guess::from_path(asset).first_or_octet_stream();
        for item in response_headers(mime.as_ref()) {
            response.add_header(item);
        }
        let _ = request.respond(response);
    } else {
        respond_text(
            request,
            "Resource not found".into(),
            "text/plain; charset=utf-8",
            404,
        );
    }
}

fn find_server(
    servers: &mut Vec<Arc<PreviewServer>>,
    port: u16,
    root: &Option<PathBuf>,
) -> Result<Arc<PreviewServer>, String> {
    if let Some(server) = servers.iter().find(|server| {
        if port == 0 {
            server.requested_port == 0 && server.initial_root == *root
        } else {
            server.requested_port == port || server.port == port
        }
    }) {
        return Ok(server.clone());
    }
    let server = Server::http(("127.0.0.1", port))
        .map_err(|error| format!("Could not open HTML preview port {port}: {error}"))?;
    let port_number = server
        .server_addr()
        .to_ip()
        .ok_or("Preview listener has no TCP address")?
        .port();
    let websocket = TcpListener::bind(("127.0.0.1", 0)).map_err(|error| error.to_string())?;
    let state = Arc::new(PreviewServer {
        server: Arc::new(server),
        port: port_number,
        requested_port: port,
        websocket_port: websocket
            .local_addr()
            .map_err(|error| error.to_string())?
            .port(),
        initial_root: root.clone(),
        active_id: Mutex::new(String::new()),
        previews: Mutex::new(HashMap::new()),
    });
    live_reload::listen(websocket, Arc::downgrade(&state));
    for _ in 0..4 {
        let weak = Arc::downgrade(&state);
        let listener = state.server.clone();
        thread::spawn(move || loop {
            let Ok(Some(request)) = listener.recv_timeout(Duration::from_millis(250)) else {
                if weak.upgrade().is_none() {
                    break;
                }
                continue;
            };
            let Some(state) = weak.upgrade() else {
                break;
            };
            serve(request, &state);
        });
    }
    servers.push(state.clone());
    Ok(state)
}

fn update(
    id: String,
    source: String,
    file_path: Option<PathBuf>,
    root: Option<PathBuf>,
    port: u16,
    client_script: Option<String>,
    live_reload: bool,
) -> Result<PreviewLocation, String> {
    if !valid_id(&id) || source.len() > MAX_SOURCE_BYTES {
        return Err("Invalid HTML preview source".into());
    }
    let file_name = file_path
        .as_ref()
        .and_then(|path| path.file_name())
        .map(|name| name.to_string_lossy().into_owned());
    let file_parent = file_path
        .as_ref()
        .and_then(|path| path.parent())
        .and_then(|path| path.canonicalize().ok());
    let root = root
        .and_then(|path| path.canonicalize().ok())
        .filter(|path| path.is_dir())
        .filter(|path| {
            file_parent
                .as_ref()
                .is_none_or(|parent| parent.starts_with(path))
        })
        .or(file_parent);
    let file_path = file_path.and_then(|file| {
        file.parent()?
            .canonicalize()
            .ok()
            .map(|parent| parent.join(file.file_name().unwrap_or_default()))
    });
    let entry = file_path
        .as_ref()
        .and_then(|file| root.as_ref().and_then(|root| file.strip_prefix(root).ok()))
        .map(|path| path.to_string_lossy().replace('\\', "/"))
        .filter(|path| !path.is_empty())
        .unwrap_or_else(|| file_name.unwrap_or_else(|| "index.html".into()));
    let mut servers = SERVERS.lock().unwrap();
    servers.retain(|server| {
        server.requested_port == port || !server.previews.lock().unwrap().is_empty()
    });
    let existing = servers
        .iter()
        .find(|server| server.previews.lock().unwrap().contains_key(&id))
        .cloned();
    let server = match existing {
        Some(server) => server,
        None => find_server(&mut servers, port, &root).or_else(|error| {
            if port == 0 {
                Err(error)
            } else {
                log::warn!("{error}; using an available HTML preview port");
                find_server(&mut servers, 0, &root)
            }
        })?,
    };
    let mut previews = server.previews.lock().unwrap();
    if let Some(preview) = previews.get_mut(&id) {
        if preview.source != source {
            preview.source = source;
            preview
                .changes
                .lock()
                .unwrap()
                .record([preview.entry.clone()]);
        }
    } else {
        let client_script = client_script.ok_or("Missing HTML preview client")?;
        let changes = Arc::new(Mutex::new(Changes {
            revision: 1,
            paths: VecDeque::new(),
        }));
        let changed = changes.clone();
        let watched_root = root.clone();
        let watcher = match root.as_ref().filter(|_| live_reload) {
            Some(root) => {
                let watcher = notify::recommended_watcher(
                    move |event: Result<notify::Event, notify::Error>| {
                        if let Ok(event) = event {
                            if matches!(
                                event.kind,
                                EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_)
                            ) {
                                let paths: Vec<_> = event
                                    .paths
                                    .iter()
                                    .filter(|path| live_reload::is_web_resource(path))
                                    .map(|path| {
                                        path.strip_prefix(watched_root.as_ref().unwrap())
                                            .unwrap_or(path)
                                            .to_string_lossy()
                                            .replace('\\', "/")
                                    })
                                    .collect();
                                if !paths.is_empty() {
                                    changed.lock().unwrap().record(paths);
                                }
                            }
                        }
                    },
                )
                .and_then(|mut watcher| {
                    watcher.watch(root, RecursiveMode::Recursive)?;
                    Ok(watcher)
                });
                match watcher {
                    Ok(watcher) => Some(watcher),
                    Err(error) => {
                        log::warn!("Could not watch assets for HTML preview: {error}");
                        None
                    }
                }
            }
            None => None,
        };
        previews.insert(
            id.clone(),
            Preview {
                root,
                entry: entry.clone(),
                source,
                client_script,
                changes,
                _watcher: watcher,
            },
        );
    }
    *server.active_id.lock().unwrap() = id.clone();
    let entry = previews
        .get(&id)
        .unwrap()
        .entry
        .split('/')
        .map(|part| utf8_percent_encode(part, PATH_SEGMENT).to_string())
        .collect::<Vec<_>>()
        .join("/");
    let revision = previews.get(&id).unwrap().changes.lock().unwrap().revision;
    Ok(PreviewLocation {
        url: format!("http://127.0.0.1:{}/{entry}", server.port),
        port: server.port,
        revision,
    })
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn html_preview_update(
    window: WebviewWindow,
    id: String,
    source: String,
    file_path: Option<PathBuf>,
    root: Option<PathBuf>,
    port: u16,
    client_script: Option<String>,
    live_reload: Option<bool>,
) -> Result<PreviewLocation, String> {
    check_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        update(
            id,
            source,
            file_path,
            root,
            port,
            client_script,
            live_reload.unwrap_or(true),
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn html_preview_close(window: WebviewWindow, id: String) -> Result<(), String> {
    check_window(&window)?;
    let mut servers = SERVERS.lock().unwrap();
    for server in servers.iter() {
        server.previews.lock().unwrap().remove(&id);
    }
    servers.retain(|server| !server.previews.lock().unwrap().is_empty());
    Ok(())
}

pub fn stop_all() {
    SERVERS.lock().unwrap().clear();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_serves_unsaved_html_scoped_assets_and_new_revisions() {
        let folder = tempfile::tempdir().unwrap();
        fs::create_dir(folder.path().join("nested")).unwrap();
        fs::write(folder.path().join("style.css"), "body { color: green; }").unwrap();
        let entry = folder.path().join("nested/page.html");
        fs::write(&entry, "disk version").unwrap();
        let id = "html-preview-smoke-abcdefghijkl";
        let result = update(
            id.into(),
            "<h1>unsaved</h1>".into(),
            Some(entry.clone()),
            Some(folder.path().into()),
            0,
            Some("/* LiveReload test client */".into()),
            true,
        )
        .unwrap();
        let client = reqwest::blocking::Client::builder()
            .no_proxy()
            .build()
            .unwrap();
        let page = client.get(&result.url).send().unwrap();
        assert_eq!(page.status(), 200);
        let html = page.text().unwrap();
        assert!(html.contains("<h1>unsaved</h1>"));
        assert!(html.contains("data-revision=\"1\""));
        let websocket_port = SERVERS
            .lock()
            .unwrap()
            .iter()
            .find(|server| server.port == result.port)
            .unwrap()
            .websocket_port;
        let stream = std::net::TcpStream::connect(("127.0.0.1", websocket_port)).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(4)))
            .unwrap();
        let (mut websocket, _) = tungstenite::client(
            format!("ws://127.0.0.1:{websocket_port}/__moki_livereload/{id}?revision=1"),
            stream,
        )
        .unwrap();
        websocket
            .send(tungstenite::Message::Text(
                serde_json::json!({"command":"hello",
            "protocols":["http://livereload.com/protocols/official-7"]})
                .to_string()
                .into(),
            ))
            .unwrap();
        let hello: serde_json::Value =
            serde_json::from_str(websocket.read().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(hello["command"], "hello");
        fs::write(folder.path().join("style.css"), "body { color: blue; }").unwrap();
        let changed: serde_json::Value =
            serde_json::from_str(websocket.read().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(changed["command"], "reload");
        assert!(changed["path"].as_str().unwrap().ends_with("style.css"));
        assert_eq!(changed["liveCSS"], true);
        assert!(result.url.ends_with("/nested/page.html"));
        assert!(!result.url.contains(id));
        let base = format!("http://127.0.0.1:{}/", result.port);
        let style = client.get(format!("{base}style.css")).send().unwrap();
        assert!(style
            .headers()
            .get("content-type")
            .unwrap()
            .to_str()
            .unwrap()
            .starts_with("text/css"));
        assert!(style.text().unwrap().contains("blue"));
        let absolute = client
            .get(format!("http://127.0.0.1:{}/style.css", result.port))
            .header("Referer", &result.url)
            .send()
            .unwrap();
        assert_eq!(absolute.status(), 200);
        update(
            id.into(),
            "<h1>edited again</h1>".into(),
            Some(entry),
            Some(folder.path().into()),
            0,
            None,
            true,
        )
        .unwrap();
        assert!(client
            .get(&result.url)
            .send()
            .unwrap()
            .text()
            .unwrap()
            .contains("edited again"));
        let root = folder.path().canonicalize().unwrap();
        assert!(asset_path(&root, "../Cargo.toml").is_none());
        assert!(asset_path(&root, "%2e%2e%2fCargo.toml").is_none());
        assert!(asset_path(&root, "C:%5cWindows%5cwin.ini").is_none());
        let forbidden = client
            .get(&result.url)
            .header("Host", "untrusted.test")
            .send()
            .unwrap();
        assert_eq!(forbidden.status(), 403);
        stop_all();
    }
}
