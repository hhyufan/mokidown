//! Disk-backed, naturally sorted directory snapshots. Neither enumeration,
//! sorting nor random page reads require retaining the directory in RAM.
use crate::FileInfo;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;
use tempfile::TempDir;

const CHUNK_SIZE: usize = 4096;
const MERGE_WIDTH: usize = 32;
const PAGE_SIZE: usize = 256;
// The default scope is the file browser. Project trees give each expanded
// directory its own scope, so loading children never invalidates their parent.
static ACTIVE: Lazy<Mutex<HashMap<String, IndexState>>> = Lazy::new(|| Mutex::new(HashMap::new()));
// Only one build performs disk IO at a time; superseded builds exit promptly.
static BUILD_LOCK: Mutex<()> = Mutex::new(());

struct Job {
    id: String,
    cancelled: Arc<AtomicBool>,
    snapshot: Option<Arc<Snapshot>>,
}

#[derive(Default)]
struct IndexState {
    generation: u64,
    job: Option<Job>,
}

impl IndexState {
    fn begin(
        &mut self,
        generation: u64,
        id: String,
        cancelled: Arc<AtomicBool>,
    ) -> Result<(), String> {
        if generation <= self.generation {
            return Err("Directory index expired".into());
        }
        self.generation = generation;
        if let Some(previous) = self.job.take() {
            previous.cancelled.store(true, AtomicOrdering::Relaxed);
        }
        self.job = Some(Job {
            id,
            cancelled,
            snapshot: None,
        });
        Ok(())
    }

    fn close(&mut self, generation: u64, id: &str) {
        // Retain a tombstone even if close arrives before its async open command.
        if generation > self.generation
            || (generation == self.generation && self.job.as_ref().is_some_and(|job| job.id == id))
        {
            self.generation = generation;
            if let Some(job) = self.job.take() {
                job.cancelled.store(true, AtomicOrdering::Relaxed);
            }
        }
    }
}

struct Snapshot {
    directory: TempDir,
    total: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IndexInfo {
    id: String,
    total: usize,
    page_size: usize,
    canonical_path: String,
}

#[derive(Clone, Copy)]
enum Field {
    Name,
    Size,
    Time,
}

#[derive(Clone, Copy)]
struct Sort {
    field: Field,
    descending: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Entry {
    #[serde(flatten)]
    info: FileInfo,
    #[serde(skip)]
    key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    directory_state: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    directory_error: Option<String>,
}

impl std::ops::Deref for Entry {
    type Target = FileInfo;
    fn deref(&self) -> &Self::Target {
        &self.info
    }
}

fn inspect_directory(path: &Path) -> (String, Option<String>) {
    match fs::read_dir(path).and_then(|mut entries| entries.next().transpose()) {
        Ok(None) => ("empty".into(), None),
        Ok(Some(_)) => ("readable".into(), None),
        Err(error) => ("unreadable".into(), Some(error.to_string())),
    }
}

impl Entry {
    fn new(info: FileInfo) -> Self {
        let (directory_state, directory_error) = if info.is_dir {
            let (state, error) = inspect_directory(Path::new(&info.path));
            (Some(state), error)
        } else {
            (None, None)
        };
        Self {
            key: info.name.to_lowercase(),
            info,
            directory_state,
            directory_error,
        }
    }
}

// Compare digit runs by magnitude, without parsing potentially overflowing integers.
fn natural(left: &str, right: &str) -> Ordering {
    let (a, b) = (left.as_bytes(), right.as_bytes());
    let (mut i, mut j) = (0, 0);
    while i < a.len() && j < b.len() {
        if a[i].is_ascii_digit() && b[j].is_ascii_digit() {
            let (start_a, start_b) = (i, j);
            while i < a.len() && a[i].is_ascii_digit() {
                i += 1;
            }
            while j < b.len() && b[j].is_ascii_digit() {
                j += 1;
            }
            let mut x = start_a;
            let mut y = start_b;
            while x < i && a[x] == b'0' {
                x += 1;
            }
            while y < j && b[y] == b'0' {
                y += 1;
            }
            let order = (i - x).cmp(&(j - y)).then_with(|| a[x..i].cmp(&b[y..j]));
            if order != Ordering::Equal {
                return order;
            }
        } else {
            let order = a[i].cmp(&b[j]);
            if order != Ordering::Equal {
                return order;
            }
            i += 1;
            j += 1;
        }
    }
    (a.len() - i).cmp(&(b.len() - j))
}

impl Sort {
    fn compare(self, a: &Entry, b: &Entry) -> Ordering {
        let folders = b.info.is_dir.cmp(&a.info.is_dir);
        if folders != Ordering::Equal {
            return folders;
        }
        let order = match self.field {
            Field::Name => Ordering::Equal,
            Field::Size => a.info.size.cmp(&b.info.size),
            Field::Time => a.info.modified.cmp(&b.info.modified),
        }
        .then_with(|| natural(&a.key, &b.key))
        .then_with(|| a.info.name.cmp(&b.info.name))
        .then_with(|| a.info.path.cmp(&b.info.path));
        if self.descending {
            order.reverse()
        } else {
            order
        }
    }
}

struct Head {
    entry: Entry,
    run: usize,
    sort: Sort,
}
impl PartialEq for Head {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}
impl Eq for Head {}
impl PartialOrd for Head {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Head {
    fn cmp(&self, other: &Self) -> Ordering {
        self.sort
            .compare(&other.entry, &self.entry)
            .then_with(|| other.run.cmp(&self.run))
    }
}

fn check_cancelled(cancelled: &AtomicBool) -> Result<(), String> {
    if cancelled.load(AtomicOrdering::Relaxed) {
        Err("Directory indexing cancelled".into())
    } else {
        Ok(())
    }
}

fn read_entry(reader: &mut impl BufRead) -> Result<Option<Entry>, String> {
    let mut line = String::new();
    if reader.read_line(&mut line).map_err(|e| e.to_string())? == 0 {
        return Ok(None);
    }
    serde_json::from_str(&line)
        .map(|mut entry: Entry| {
            entry.key = entry.info.name.to_lowercase();
            entry
        })
        .map(Some)
        .map_err(|e| e.to_string())
}

fn write_entry(writer: &mut impl Write, info: &Entry) -> Result<u64, String> {
    let record = serde_json::to_vec(info).map_err(|e| e.to_string())?;
    writer
        .write_all(&record)
        .and_then(|()| writer.write_all(b"\n"))
        .map_err(|e| e.to_string())?;
    Ok(record.len() as u64 + 1)
}

fn write_chunk(path: &Path, chunk: &mut Vec<Entry>, sort: Sort) -> Result<(), String> {
    chunk.sort_unstable_by(|a, b| sort.compare(a, b));
    let mut writer = BufWriter::new(File::create(path).map_err(|e| e.to_string())?);
    for entry in chunk.drain(..) {
        write_entry(&mut writer, &entry)?;
    }
    writer.flush().map_err(|e| e.to_string())
}

fn merge(
    runs: &[PathBuf],
    output: &Path,
    sort: Sort,
    cancelled: &AtomicBool,
) -> Result<(), String> {
    let mut readers = runs
        .iter()
        .map(|path| File::open(path).map(BufReader::new))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut heap = BinaryHeap::new();
    for (run, reader) in readers.iter_mut().enumerate() {
        if let Some(entry) = read_entry(reader)? {
            heap.push(Head { entry, run, sort });
        }
    }
    let mut writer = BufWriter::new(File::create(output).map_err(|e| e.to_string())?);
    while let Some(Head { entry, run, .. }) = heap.pop() {
        check_cancelled(cancelled)?;
        write_entry(&mut writer, &entry)?;
        if let Some(entry) = read_entry(&mut readers[run])? {
            heap.push(Head { entry, run, sort });
        }
    }
    writer.flush().map_err(|e| e.to_string())
}

fn build(
    entries: impl Iterator<Item = Result<FileInfo, String>>,
    sort: Sort,
    cancelled: &AtomicBool,
) -> Result<Snapshot, String> {
    let directory = tempfile::tempdir().map_err(|e| e.to_string())?;
    let mut runs = Vec::new();
    let mut chunk = Vec::with_capacity(CHUNK_SIZE);
    for info in entries {
        check_cancelled(cancelled)?;
        chunk.push(Entry::new(info?));
        if chunk.len() == CHUNK_SIZE {
            let path = directory.path().join(format!("run-{}", runs.len()));
            write_chunk(&path, &mut chunk, sort)?;
            runs.push(path);
        }
    }
    if !chunk.is_empty() {
        let path = directory.path().join(format!("run-{}", runs.len()));
        write_chunk(&path, &mut chunk, sort)?;
        runs.push(path);
    }
    let mut pass = 0;
    while runs.len() > 1 {
        let mut next = Vec::new();
        for (group, inputs) in runs.chunks(MERGE_WIDTH).enumerate() {
            check_cancelled(cancelled)?;
            let output = directory.path().join(format!("merge-{pass}-{group}"));
            merge(inputs, &output, sort, cancelled)?;
            for input in inputs {
                fs::remove_file(input).map_err(|e| e.to_string())?;
            }
            next.push(output);
        }
        runs = next;
        pass += 1;
    }
    let data = directory.path().join("data");
    if let Some(run) = runs.pop() {
        fs::rename(run, &data).map_err(|e| e.to_string())?;
    } else {
        File::create(&data).map_err(|e| e.to_string())?;
    }
    let mut reader = BufReader::new(File::open(&data).map_err(|e| e.to_string())?);
    let mut offsets =
        BufWriter::new(File::create(directory.path().join("offsets")).map_err(|e| e.to_string())?);
    let (mut offset, mut total) = (0u64, 0usize);
    let mut record = Vec::new();
    loop {
        check_cancelled(cancelled)?;
        record.clear();
        let bytes = reader
            .read_until(b'\n', &mut record)
            .map_err(|e| e.to_string())?;
        if bytes == 0 {
            break;
        }
        if total % PAGE_SIZE == 0 {
            offsets
                .write_all(&offset.to_le_bytes())
                .map_err(|e| e.to_string())?;
        }
        offset += bytes as u64;
        total += 1;
    }
    offsets.flush().map_err(|e| e.to_string())?;
    Ok(Snapshot { directory, total })
}

impl Snapshot {
    fn locate(&self, path: &str, cancelled: &AtomicBool) -> Result<Option<usize>, String> {
        let mut reader = BufReader::new(
            File::open(self.directory.path().join("data")).map_err(|e| e.to_string())?,
        );
        let mut index = 0;
        while let Some(entry) = read_entry(&mut reader)? {
            check_cancelled(cancelled)?;
            if entry.info.path == path {
                return Ok(Some(index));
            }
            index += 1;
        }
        Ok(None)
    }

    fn page(&self, offset: usize, limit: usize) -> Result<Vec<Entry>, String> {
        let count = limit.min(PAGE_SIZE).min(self.total.saturating_sub(offset));
        if count == 0 {
            return Ok(Vec::new());
        }
        let mut offsets =
            File::open(self.directory.path().join("offsets")).map_err(|e| e.to_string())?;
        offsets
            .seek(SeekFrom::Start((offset / PAGE_SIZE * 8) as u64))
            .map_err(|e| e.to_string())?;
        let mut bytes = [0u8; 8];
        offsets.read_exact(&mut bytes).map_err(|e| e.to_string())?;
        let mut reader = BufReader::new(
            File::open(self.directory.path().join("data")).map_err(|e| e.to_string())?,
        );
        reader
            .seek(SeekFrom::Start(u64::from_le_bytes(bytes)))
            .map_err(|e| e.to_string())?;
        for _ in 0..offset % PAGE_SIZE {
            read_entry(&mut reader)?;
        }
        let mut result = Vec::with_capacity(count);
        for _ in 0..count {
            if let Some(entry) = read_entry(&mut reader)? {
                result.push(entry);
            }
        }
        Ok(result)
    }
}

fn directory_entries(
    path: &Path,
) -> Result<impl Iterator<Item = Result<FileInfo, String>>, String> {
    Ok(fs::read_dir(path)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => return Some(Err(error.to_string())),
            };
            // Keep denied metadata rows so unreadable folders are not omitted.
            let kind = entry.file_type().ok()?;
            let metadata = entry.metadata().ok();
            let modified = metadata
                .as_ref()
                .and_then(|metadata| metadata.modified().ok())
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .unwrap_or_default();
            Some(Ok(FileInfo {
                name: entry.file_name().to_string_lossy().into_owned(),
                path: entry.path().to_string_lossy().into_owned(),
                size: metadata.as_ref().map_or(0, fs::Metadata::len),
                is_file: metadata
                    .as_ref()
                    .map_or(kind.is_file(), fs::Metadata::is_file),
                is_dir: metadata
                    .as_ref()
                    .map_or(kind.is_dir(), fs::Metadata::is_dir),
                modified: modified.as_secs(),
                modified_ms: modified.as_millis() as u64,
            }))
        }))
}

#[tauri::command]
pub(crate) async fn open_directory_index(
    id: String,
    generation: u64,
    dir_path: String,
    sort_by: String,
    sort_order: String,
    scope: Option<String>,
) -> Result<IndexInfo, String> {
    let sort = Sort {
        field: match sort_by.as_str() {
            "name" => Field::Name,
            "size" => Field::Size,
            "time" => Field::Time,
            _ => return Err("Invalid directory sort field".into()),
        },
        descending: match sort_order.as_str() {
            "asc" => false,
            "desc" => true,
            _ => return Err("Invalid directory sort order".into()),
        },
    };
    let cancelled = Arc::new(AtomicBool::new(false));
    let scope = scope.unwrap_or_default();
    {
        let mut active = ACTIVE.lock().map_err(|e| e.to_string())?;
        active.entry(scope.clone()).or_default().begin(
            generation,
            id.clone(),
            cancelled.clone(),
        )?;
    }
    tauri::async_runtime::spawn_blocking(move || {
        let _build = BUILD_LOCK.lock().map_err(|e| e.to_string())?;
        check_cancelled(&cancelled)?;
        let snapshot = Arc::new(build(
            directory_entries(Path::new(&dir_path))?,
            sort,
            &cancelled,
        )?);
        let mut active = ACTIVE.lock().map_err(|e| e.to_string())?;
        check_cancelled(&cancelled)?;
        let job = active
            .get_mut(&scope)
            .and_then(|state| state.job.as_mut())
            .filter(|job| job.id == id)
            .ok_or("Directory index expired")?;
        let result = IndexInfo {
            id,
            total: snapshot.total,
            page_size: PAGE_SIZE,
            canonical_path: fs::canonicalize(&dir_path)
                .map_err(|error| error.to_string())?
                .to_string_lossy()
                .into_owned(),
        };
        job.snapshot = Some(snapshot);
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn read_directory_page(
    id: String,
    offset: usize,
    limit: usize,
    scope: Option<String>,
) -> Result<Vec<Entry>, String> {
    let snapshot = ACTIVE
        .lock()
        .map_err(|e| e.to_string())?
        .get(&scope.unwrap_or_default())
        .and_then(|state| state.job.as_ref())
        .filter(|job| job.id == id)
        .and_then(|job| job.snapshot.clone())
        .ok_or("Directory index expired")?;
    tauri::async_runtime::spawn_blocking(move || snapshot.page(offset, limit))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn locate_directory_entry(
    id: String,
    path: String,
    scope: Option<String>,
) -> Result<Option<usize>, String> {
    let (snapshot, cancelled) = {
        let active = ACTIVE.lock().map_err(|e| e.to_string())?;
        let job = active
            .get(&scope.unwrap_or_default())
            .and_then(|state| state.job.as_ref())
            .filter(|job| job.id == id)
            .ok_or("Directory index expired")?;
        (
            job.snapshot.clone().ok_or("Directory index expired")?,
            job.cancelled.clone(),
        )
    };
    tauri::async_runtime::spawn_blocking(move || snapshot.locate(&path, &cancelled))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) fn close_directory_index(
    id: String,
    generation: u64,
    scope: Option<String>,
) -> Result<(), String> {
    let mut active = ACTIVE.lock().map_err(|e| e.to_string())?;
    active
        .entry(scope.unwrap_or_default())
        .or_default()
        .close(generation, &id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parent_snapshot_contains_child_directory_states_before_expanding_children() {
        let root = tempfile::tempdir().unwrap();
        let empty = root.path().join("empty");
        let full = root.path().join("full");
        fs::create_dir(&empty).unwrap();
        fs::create_dir(&full).unwrap();
        fs::write(full.join("child.txt"), "one").unwrap();
        let snapshot = build(
            directory_entries(root.path()).unwrap(),
            name_sort(),
            &AtomicBool::new(false),
        )
        .unwrap();
        let entries = snapshot.page(0, PAGE_SIZE).unwrap();
        assert_eq!(entries[0].name, "empty");
        assert_eq!(entries[0].directory_state.as_deref(), Some("empty"));
        assert_eq!(entries[1].directory_state.as_deref(), Some("readable"));
        let json = serde_json::to_value(&entries[0]).unwrap();
        assert_eq!(json["directoryState"], "empty");
        assert_eq!(json["is_dir"], true);
        assert!(json.get("key").is_none());
        let (state, error) = inspect_directory(&root.path().join("unavailable"));
        assert_eq!(state, "unreadable");
        assert!(error.is_some());
    }
    #[test]
    fn project_children_do_not_invalidate_parent_or_file_browser() {
        let mut scopes = HashMap::<String, IndexState>::new();
        let root = Arc::new(AtomicBool::new(false));
        let child = Arc::new(AtomicBool::new(false));
        scopes
            .entry(String::new())
            .or_default()
            .begin(10, "root".into(), root.clone())
            .unwrap();
        scopes
            .entry("src".into())
            .or_default()
            .begin(20, "child".into(), child.clone())
            .unwrap();
        scopes.get_mut("src").unwrap().close(20, "child");
        assert!(child.load(AtomicOrdering::Relaxed));
        assert!(!root.load(AtomicOrdering::Relaxed));
        assert_eq!(scopes.get("").unwrap().job.as_ref().unwrap().id, "root");
    }
    #[test]
    fn out_of_order_opens_and_closes_cannot_replace_a_newer_directory() {
        let mut state = IndexState::default();
        let current = Arc::new(AtomicBool::new(false));
        state.begin(20, "new".into(), current.clone()).unwrap();
        assert!(state
            .begin(10, "old".into(), Arc::new(AtomicBool::new(false)))
            .is_err());
        state.close(10, "old");
        assert!(!current.load(AtomicOrdering::Relaxed));
        state.close(30, "closed-before-open");
        assert!(current.load(AtomicOrdering::Relaxed));
        assert!(state
            .begin(
                30,
                "closed-before-open".into(),
                Arc::new(AtomicBool::new(false))
            )
            .is_err());
        assert!(state.job.is_none());
    }
    fn entry(number: usize) -> FileInfo {
        FileInfo {
            name: format!("note{number}.md"),
            path: format!("/notes/note{number}.md"),
            size: number as u64,
            is_file: true,
            is_dir: false,
            modified: number as u64,
            modified_ms: number as u64 * 1000,
        }
    }
    fn name_sort() -> Sort {
        Sort {
            field: Field::Name,
            descending: false,
        }
    }

    #[test]
    fn natural_names_and_folders_first_in_both_directions() {
        assert_eq!(natural("note2", "note10"), Ordering::Less);
        assert_eq!(
            natural("n999999999999999999999", "n1000000000000000000000"),
            Ordering::Less
        );
        let mut folder = entry(99);
        folder.is_dir = true;
        folder.is_file = false;
        for descending in [false, true] {
            let sort = Sort {
                descending,
                ..name_sort()
            };
            let snapshot = build(
                vec![Ok(entry(10)), Ok(folder.clone()), Ok(entry(2))].into_iter(),
                sort,
                &AtomicBool::new(false),
            )
            .unwrap();
            let rows = snapshot.page(0, PAGE_SIZE).unwrap();
            assert!(rows[0].is_dir);
            assert_eq!(rows[1].size, if descending { 10 } else { 2 });
        }
    }

    #[test]
    fn external_sort_multiple_passes_random_access_and_page_limit() {
        let count = CHUNK_SIZE * (MERGE_WIDTH + 1) + 17;
        let snapshot = build(
            (0..count).rev().map(|n| Ok(entry(n))),
            name_sort(),
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(snapshot.total, count);
        for start in [0, PAGE_SIZE - 1, count / 2, count - 2, count, usize::MAX] {
            let rows = snapshot.page(start, usize::MAX).unwrap();
            assert_eq!(rows.len(), PAGE_SIZE.min(count.saturating_sub(start)));
            for (index, row) in rows.iter().enumerate() {
                assert_eq!(row.name, format!("note{}.md", start + index));
            }
        }
        let path = snapshot.directory.path().to_owned();
        drop(snapshot);
        assert!(!path.exists());
    }

    #[test]
    fn empty_cancelled_and_metadata_sorts() {
        assert_eq!(
            build(std::iter::empty(), name_sort(), &AtomicBool::new(false))
                .unwrap()
                .total,
            0
        );
        assert!(build(
            (0..10).map(|n| Ok(entry(n))),
            name_sort(),
            &AtomicBool::new(true)
        )
        .is_err());
        for field in [Field::Size, Field::Time] {
            let snapshot = build(
                (0..10).map(|n| Ok(entry(n))),
                Sort {
                    field,
                    descending: true,
                },
                &AtomicBool::new(false),
            )
            .unwrap();
            assert_eq!(snapshot.page(0, 1).unwrap()[0].size, 9);
        }
    }

    #[test]
    fn locates_off_page_results_and_honors_cancellation() {
        let snapshot = build(
            (0..1000).map(|n| Ok(entry(n))),
            name_sort(),
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(
            snapshot
                .locate("/notes/note999.md", &AtomicBool::new(false))
                .unwrap(),
            Some(999)
        );
        assert_eq!(
            snapshot
                .locate("/notes/missing.md", &AtomicBool::new(false))
                .unwrap(),
            None
        );
        assert!(snapshot
            .locate("/notes/note999.md", &AtomicBool::new(true))
            .is_err());
    }
}
