use crate::script_runner::ProcessTree;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, LazyLock, Mutex};
use std::thread;
use tauri::{ipc::Channel, Manager, WebviewWindow};

static TERMINALS: LazyLock<Mutex<HashMap<String, Arc<Session>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

struct Session {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    process_tree: ProcessTree,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TerminalEvent {
    Data { bytes: Vec<u8> },
    Exit { code: Option<u32> },
}

fn check_window(window: &WebviewWindow) -> Result<(), String> {
    (window.label() == "main")
        .then_some(())
        .ok_or_else(|| "The terminal is only available in the main editor".into())
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        cols: cols.clamp(2, 1000),
        rows: rows.clamp(1, 1000),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn shell() -> CommandBuilder {
    #[cfg(windows)]
    let mut command = {
        let program = std::env::var_os("SystemRoot")
            .map(PathBuf::from)
            .map(|root| root.join("System32/WindowsPowerShell/v1.0/powershell.exe"))
            .filter(|path| path.is_file())
            .unwrap_or_else(|| PathBuf::from("powershell.exe"));
        let mut shell = CommandBuilder::new(program);
        shell.arg("-NoLogo");
        shell
    };
    #[cfg(not(windows))]
    let mut command = CommandBuilder::new_default_prog();
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    command
}

fn attach_tree(child: &(dyn Child + Send + Sync)) -> Result<ProcessTree, String> {
    #[cfg(windows)]
    {
        let handle = child
            .as_raw_handle()
            .ok_or("Terminal process has no handle")?;
        ProcessTree::attach_handle(handle as isize)
    }
    #[cfg(not(windows))]
    {
        let pid = child
            .process_id()
            .ok_or("Terminal process has no process ID")?;
        Ok(ProcessTree::for_process_group(pid))
    }
}

fn take_session(id: &str) -> Option<Arc<Session>> {
    TERMINALS.lock().unwrap().remove(id)
}

fn session(id: &str) -> Result<Arc<Session>, String> {
    TERMINALS
        .lock()
        .unwrap()
        .get(id)
        .cloned()
        .ok_or_else(|| "Terminal session has ended".into())
}

fn start(
    id: String,
    cwd: Option<PathBuf>,
    dimensions: PtySize,
    mut command: CommandBuilder,
    events: impl Fn(TerminalEvent) -> bool + Clone + Send + 'static,
) -> Result<(), String> {
    let mut sessions = TERMINALS.lock().unwrap();
    if sessions.contains_key(&id) {
        return Err("This terminal session is already open".into());
    }
    if sessions.len() >= 16 {
        return Err("Close an existing terminal before opening another directory".into());
    }
    let pair = native_pty_system()
        .openpty(dimensions)
        .map_err(|error| error.to_string())?;
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| error.to_string())?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| error.to_string())?;
    if let Some(cwd) = cwd {
        command.cwd(cwd);
    }
    let mut child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| error.to_string())?;
    drop(pair.slave);
    let process_tree = match attach_tree(&*child) {
        Ok(tree) => tree,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };
    sessions.insert(
        id.clone(),
        Arc::new(Session {
            master: Mutex::new(pair.master),
            writer: Mutex::new(writer),
            process_tree,
        }),
    );
    drop(sessions);

    let output = events.clone();
    let output_id = id.clone();
    let drain = thread::spawn(move || {
        let mut bytes = [0; 8192];
        let mut connected = true;
        loop {
            let count = match reader.read(&mut bytes) {
                Ok(0) => break,
                Ok(count) => count,
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            };
            if connected
                && !output(TerminalEvent::Data {
                    bytes: bytes[..count].to_vec(),
                })
            {
                connected = false;
                // ConPTY shutdown can block until its remaining output is drained.
                let id = output_id.clone();
                thread::spawn(move || close(&id));
            }
        }
    });
    thread::spawn(move || {
        let code = child.wait().ok().map(|status| status.exit_code());
        // Closing the master releases the ConPTY output pipe. Keep draining
        // until it closes so the final command's output precedes the exit notice.
        close(&id);
        let _ = drain.join();
        events(TerminalEvent::Exit { code });
    });
    Ok(())
}

fn close(id: &str) {
    if let Some(session) = take_session(id) {
        session.process_tree.terminate();
    }
}

pub fn stop_all() {
    let sessions = std::mem::take(&mut *TERMINALS.lock().unwrap());
    for session in sessions.into_values() {
        session.process_tree.terminate();
    }
}

#[tauri::command]
pub async fn terminal_start(
    window: WebviewWindow,
    id: String,
    cwd: Option<PathBuf>,
    cols: u16,
    rows: u16,
    events: Channel<TerminalEvent>,
) -> Result<(), String> {
    check_window(&window)?;
    let home = window.path().home_dir().ok();
    tauri::async_runtime::spawn_blocking(move || {
        let cwd = cwd
            .filter(|path| path.is_absolute() && path.is_dir())
            .or(home);
        start(id, cwd, size(cols, rows), shell(), move |event| {
            events.send(event).is_ok()
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn terminal_write(window: WebviewWindow, id: String, data: String) -> Result<(), String> {
    check_window(&window)?;
    if data.len() > 1024 * 1024 {
        return Err("Terminal input exceeds 1 MiB".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        session(&id)?
            .writer
            .lock()
            .unwrap()
            .write_all(data.as_bytes())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn terminal_resize(
    window: WebviewWindow,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    check_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        session(&id)?
            .master
            .lock()
            .unwrap()
            .resize(size(cols, rows))
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn terminal_close(window: WebviewWindow, id: String) -> Result<(), String> {
    check_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || close(&id))
        .await
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    #[test]
    fn shell_accepts_input_resizes_and_drains_output_on_exit() {
        struct Shutdown;
        impl Drop for Shutdown {
            fn drop(&mut self) {
                stop_all();
            }
        }
        let _shutdown = Shutdown;
        let (send, receive) = mpsc::channel();
        let id = "terminal-smoke";
        #[cfg(windows)]
        let mut command = shell();
        #[cfg(windows)]
        command.args([
            "-NoProfile",
            "-NoExit",
            "-Command",
            "function prompt { 'moki-ready>' }",
        ]);
        #[cfg(not(windows))]
        let command = {
            let mut command = CommandBuilder::new("/bin/sh");
            command.arg("-i");
            command.env("PS1", "moki-ready>");
            command
        };
        start(id.into(), None, size(80, 24), command, move |event| {
            send.send(event).is_ok()
        })
        .unwrap();
        let current = session(id).unwrap();
        let timeout = Duration::from_secs(20);
        let expires_at = Instant::now() + timeout;
        let mut output = Vec::new();
        let mut answered_cursor = false;
        // Wait for the interactive shell to hand input off from its startup code.
        loop {
            match receive
                .recv_timeout(expires_at.saturating_duration_since(Instant::now()))
                .unwrap_or_else(|error| {
                    panic!(
                        "interactive shell did not show a prompt ({error}), received {} bytes",
                        output.len()
                    )
                }) {
                TerminalEvent::Data { bytes } => {
                    output.extend(bytes);
                    if !answered_cursor && output.windows(4).any(|bytes| bytes == b"\x1b[6n") {
                        // ConPTY waits for the initial cursor report. In the app
                        // xterm answers this request automatically.
                        current
                            .writer
                            .lock()
                            .unwrap()
                            .write_all(b"\x1b[1;1R")
                            .unwrap();
                        answered_cursor = true;
                    }
                    let prompt = String::from_utf8_lossy(&output);
                    if prompt.contains("moki-ready>") {
                        break;
                    }
                }
                TerminalEvent::Exit { code } => {
                    panic!("interactive shell exited during startup: {code:?}")
                }
            }
        }
        current.master.lock().unwrap().resize(size(90, 30)).unwrap();
        assert_eq!(current.master.lock().unwrap().get_size().unwrap().rows, 30);
        let command = if cfg!(windows) {
            "Write-Output ('Moki'+'TerminalReady'); exit\r"
        } else {
            "printf '%s%s\\n' Moki TerminalReady; exit\r"
        };
        current
            .writer
            .lock()
            .unwrap()
            .write_all(command.as_bytes())
            .unwrap();
        drop(current);

        let expires_at = Instant::now() + timeout;
        loop {
            match receive
                .recv_timeout(expires_at.saturating_duration_since(Instant::now()))
                .unwrap_or_else(|error| {
                    panic!(
                        "terminal did not shut down ({error}), command output received: {}",
                        String::from_utf8_lossy(&output).contains("MokiTerminalReady")
                    )
                }) {
                TerminalEvent::Data { bytes } => output.extend(bytes),
                TerminalEvent::Exit { code } => {
                    assert_eq!(code, Some(0));
                    break;
                }
            }
        }
        assert!(String::from_utf8_lossy(&output).contains("MokiTerminalReady"));
        assert!(session(id).is_err());
    }
}
