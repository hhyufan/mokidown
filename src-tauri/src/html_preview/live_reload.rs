use super::{valid_id, PreviewServer};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::io::ErrorKind;
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::sync::Weak;
use std::thread;
use std::time::{Duration, Instant};
use tungstenite::{
    accept_hdr,
    handshake::server::{Request, Response},
    Message,
};

pub(super) fn is_web_resource(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "html"
                    | "htm"
                    | "xhtml"
                    | "css"
                    | "js"
                    | "mjs"
                    | "cjs"
                    | "jsx"
                    | "ts"
                    | "tsx"
                    | "json"
                    | "wasm"
                    | "png"
                    | "jpg"
                    | "jpeg"
                    | "gif"
                    | "webp"
                    | "svg"
                    | "ico"
                    | "avif"
                    | "woff"
                    | "woff2"
                    | "ttf"
                    | "otf"
                    | "eot"
            )
        })
}

pub(super) fn listen(listener: TcpListener, state: Weak<PreviewServer>) {
    if let Err(error) = listener.set_nonblocking(true) {
        log::error!("HTML live reload listener failed: {error}");
        return;
    }
    thread::spawn(move || loop {
        if state.upgrade().is_none() {
            break;
        }
        match listener.accept() {
            Ok((stream, _)) => {
                let state = state.clone();
                thread::spawn(move || connection(stream, state));
            }
            Err(error) if error.kind() == ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(30))
            }
            Err(_) => break,
        }
    });
}

#[allow(clippy::result_large_err)] // tungstenite 的握手回调固定返回 ErrorResponse。
fn connection(stream: TcpStream, state: Weak<PreviewServer>) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(1)));
    let mut id = String::new();
    let mut seen = 0;
    let socket = accept_hdr(stream, |request: &Request, response: Response| {
        let path = request
            .uri()
            .path()
            .strip_prefix("/__moki_livereload/")
            .unwrap_or("");
        let Some(server) = state.upgrade() else {
            return Err(reject());
        };
        let origin = format!("http://127.0.0.1:{}", server.port);
        let allowed_origin = request
            .headers()
            .get("Origin")
            .is_none_or(|value| value.as_bytes() == origin.as_bytes());
        if !valid_id(path) || !allowed_origin || !server.previews.lock().unwrap().contains_key(path)
        {
            return Err(reject());
        }
        id = path.into();
        seen = request
            .uri()
            .query()
            .and_then(|query| query.strip_prefix("revision="))
            .and_then(|value| value.parse().ok())
            .unwrap_or(0);
        Ok(response)
    });
    let Ok(mut socket) = socket else {
        return;
    };
    let Ok(Message::Text(hello)) = socket.read() else {
        return;
    };
    let Ok(hello) = serde_json::from_str::<Value>(&hello) else {
        return;
    };
    if hello["command"] != "hello"
        || !hello["protocols"].as_array().is_some_and(|protocols| {
            protocols
                .iter()
                .any(|protocol| protocol == "http://livereload.com/protocols/official-7")
        })
    {
        return;
    }
    let hello = json!({"command":"hello", "protocols":["http://livereload.com/protocols/official-7"], "serverName":"MokiDown"});
    if socket
        .send(Message::Text(hello.to_string().into()))
        .is_err()
    {
        return;
    }
    let _ = socket
        .get_mut()
        .set_read_timeout(Some(Duration::from_millis(80)));
    let mut pending_revision = seen;
    let mut settled_at = Instant::now();
    loop {
        let Some(server) = state.upgrade() else {
            break;
        };
        let snapshot = {
            let previews = server.previews.lock().unwrap();
            let Some(preview) = previews.get(&id) else {
                break;
            };
            let changes = preview.changes.lock().unwrap();
            let mut paths = changes
                .paths
                .iter()
                .filter(|(revision, _)| *revision > seen)
                .map(|(_, path)| path.clone())
                .collect::<BTreeSet<_>>();
            if changes.revision > seen
                && (paths.is_empty()
                    || changes
                        .paths
                        .front()
                        .is_some_and(|(revision, _)| *revision > seen + 1))
            {
                paths.insert(preview.entry.clone());
            }
            (changes.revision, paths)
        };
        drop(server);
        if snapshot.0 != pending_revision {
            pending_revision = snapshot.0;
            settled_at = Instant::now();
        }
        if snapshot.0 != seen && settled_at.elapsed() >= Duration::from_millis(120) {
            let mut paths = snapshot.1;
            // Multiple build output changes need one page refresh. Pure CSS or
            // image changes are handed to the official client's in-place update.
            let full_reload = paths
                .iter()
                .find(|path| {
                    !matches!(
                        Path::new(path)
                            .extension()
                            .and_then(|extension| extension.to_str()),
                        Some(
                            "css"
                                | "png"
                                | "jpg"
                                | "jpeg"
                                | "gif"
                                | "webp"
                                | "svg"
                                | "ico"
                                | "avif"
                        )
                    )
                })
                .cloned();
            if let Some(path) = full_reload {
                paths = BTreeSet::from([path]);
            }
            for path in paths {
                let message = json!({"command":"reload", "path":path, "liveCSS":true, "liveImg":true, "reloadMissingCSS":false});
                if socket
                    .send(Message::Text(message.to_string().into()))
                    .is_err()
                {
                    return;
                }
            }
            seen = snapshot.0;
        }
        match socket.read() {
            Ok(Message::Close(_)) => break,
            Ok(_) => {}
            Err(tungstenite::Error::Io(error))
                if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(_) => break,
        }
    }
    let _ = socket.close(None);
}

fn reject() -> tungstenite::handshake::server::ErrorResponse {
    tungstenite::http::Response::builder()
        .status(403)
        .body(Some("Preview connection not allowed".into()))
        .unwrap()
}
