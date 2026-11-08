use serde::Serialize;
use std::collections::VecDeque;
#[cfg(not(test))]
use std::io::Write;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const CAPACITY: usize = 200;
static LOGGER: RuntimeLogger = RuntimeLogger(Mutex::new(VecDeque::new()));

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
