use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
#[cfg(not(test))]
use std::io::Write;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

const CAPACITY: usize = 200;
static LOGGER: RuntimeLogger = RuntimeLogger(Mutex::new(VecDeque::new()));
static SHARED_LOGS: Mutex<SharedLogs> = Mutex::new(SharedLogs {
    version: 0,
    native_cursor: 0,
    entries: Vec::new(),
});

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SharedLogEntry {
    id: String,
    timestamp: u64,
    level: String,
    source: String,
    message: String,
    #[serde(default)]
    stack: String,
    #[serde(default)]
    detail: String,
    #[serde(default = "one")]
    count: u64,
    native_id: Option<u64>,
}

fn one() -> u64 {
    1
}

struct SharedLogs {
    version: u64,
    native_cursor: u64,
    entries: Vec<SharedLogEntry>,
}

#[derive(Clone, Serialize)]
pub(crate) struct SharedLogSnapshot {
    version: u64,
    entries: Vec<SharedLogEntry>,
}

impl SharedLogs {
    fn snapshot(&self) -> SharedLogSnapshot {
        SharedLogSnapshot {
            version: self.version,
            entries: self.entries.clone(),
        }
    }

    fn record(&mut self, mut entry: SharedLogEntry) {
        if let Some(id) = entry.native_id {
            // 多个 WebView 轮询同一条原生日志，只接收一次；清空后也不重放。
            if id <= self.native_cursor {
                return;
            }
            self.native_cursor = id;
        }
        if self.entries.iter().any(|old| old.id == entry.id) {
            return;
        }
        entry.message = entry.message.chars().take(4096).collect();
        entry.stack = entry.stack.chars().take(10000).collect();
        entry.detail = entry.detail.chars().take(1024).collect();
        entry.source = entry.source.chars().take(160).collect();
        entry.id = entry.id.chars().take(160).collect();
        entry.count = 1;
        if let Some(index) = self.entries.iter().position(|old| {
            old.message == entry.message
                && old.level == entry.level
                && old.timestamp.abs_diff(entry.timestamp) <= 5000
        }) {
            let old = self.entries.remove(index);
            entry.id = old.id;
            entry.count = old.count.saturating_add(1);
            if entry.stack.is_empty() {
                entry.stack = old.stack;
            }
            if entry.detail.is_empty() {
                entry.detail = old.detail;
            }
        }
        self.entries.insert(0, entry);
        self.entries.truncate(CAPACITY);
        self.version += 1;
    }
}

#[tauri::command]
pub(crate) fn shared_runtime_logs() -> SharedLogSnapshot {
    SHARED_LOGS.lock().unwrap().snapshot()
}

#[tauri::command]
pub(crate) fn record_runtime_log(app: AppHandle, entry: SharedLogEntry) -> SharedLogSnapshot {
    let snapshot = {
        let mut logs = SHARED_LOGS.lock().unwrap();
        logs.record(entry);
        logs.snapshot()
    };
    // 广播必须在释放日志锁之后，避免窗口线程与日志写入互相等待。
    let _ = app.emit("runtime-logs:changed", &snapshot);
    snapshot
}

#[tauri::command]
pub(crate) fn clear_runtime_logs(app: AppHandle) -> SharedLogSnapshot {
    let snapshot = {
        let mut logs = SHARED_LOGS.lock().unwrap();
        logs.entries.clear();
        logs.version += 1;
        logs.snapshot()
    };
    let _ = app.emit("runtime-logs:changed", &snapshot);
    snapshot
}

#[derive(Clone, Serialize)]
pub(crate) struct NativeLogEntry {
    id: u64,
    timestamp: u64,
    level: &'static str,
    message: String,
    target: String,
}

struct RuntimeLogger(Mutex<VecDeque<NativeLogEntry>>);

impl log::Log for RuntimeLogger {
    fn enabled(&self, metadata: &log::Metadata<'_>) -> bool {
        metadata.level() <= log::Level::Warn
    }

    fn log(&self, record: &log::Record<'_>) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let message: String = record.args().to_string().chars().take(4096).collect();
        let target = record.target();
        #[cfg(not(test))]
        let _ = writeln!(std::io::stderr().lock(), "[{target}] {message}");
        let mut entries = self.0.lock().unwrap_or_else(|error| error.into_inner());
        let id = entries.back().map_or(1, |last| last.id + 1);
        if entries.len() >= CAPACITY {
            entries.pop_front();
        }
        entries.push_back(NativeLogEntry {
            id,
            timestamp: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            level: if record.level() == log::Level::Error {
                "error"
            } else {
                "warning"
            },
            message,
            target: target.chars().take(160).collect(),
        });
    }

    fn flush(&self) {}
}

pub(crate) fn init() {
    if log::set_logger(&LOGGER).is_ok() {
        log::set_max_level(log::LevelFilter::Warn);
    }
}

#[tauri::command]
pub(crate) fn read_runtime_logs(after: u64) -> Vec<NativeLogEntry> {
    LOGGER
        .0
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .iter()
        .filter(|entry| entry.id > after)
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use log::{Level, Log, Record};

    #[test]
    fn captures_warnings_and_errors_in_a_bounded_ring() {
        let logger = RuntimeLogger(Mutex::new(VecDeque::new()));
        logger.log(
            &Record::builder()
                .level(Level::Info)
                .args(format_args!("skip"))
                .build(),
        );
        for _ in 0..=CAPACITY {
            logger.log(
                &Record::builder()
                    .level(Level::Warn)
                    .args(format_args!("warning"))
                    .build(),
            );
        }
        logger.log(
            &Record::builder()
                .level(Level::Error)
                .args(format_args!("error"))
                .build(),
        );
        let entries = logger.0.lock().unwrap();
        assert_eq!(entries.len(), CAPACITY);
        assert_eq!(entries.front().unwrap().id, 3);
        assert_eq!(entries.back().unwrap().level, "error");
    }
}
