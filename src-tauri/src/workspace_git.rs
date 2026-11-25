use crate::{process, text_file};
use serde::{Deserialize, Serialize};
use std::{
    cmp::Reverse,
    collections::HashSet,
    env,
    ffi::OsString,
    path::{Component, Path, PathBuf},
    process::{Output, Stdio},
};

#[derive(Clone, Copy, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Layer {
    Index,
    Worktree,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Change {
    path: String,
    old_path: Option<String>,
    code: char,
    layer: Layer,
    /// 文件最后修改时间（Unix 毫秒），用于按时间连接变动文件。
    mtime: i64,
}

#[derive(Serialize)]
pub(crate) struct Workspace {
    executable: PathBuf,
    version: String,
    repository: Option<Repository>,
}

#[derive(Serialize)]
struct Repository {
    root: PathBuf,
    branch: Option<String>,
    branches: Vec<String>,
    refs: Vec<String>,
    changes: Vec<Change>,
    /// remote.origin.url 解析出的 GitHub 页面地址；本地仓库为 None。
    github: Option<String>,
}

#[derive(Serialize)]
pub(crate) struct Comparison {
    original: String,
    modified: String,
}

fn executable(configured: &str) -> Result<PathBuf, String> {
    let name = if cfg!(windows) { "git.exe" } else { "git" };
    let configured = configured.trim();
    if !configured.is_empty() {
        let path = PathBuf::from(configured);
        if !path.is_absolute() {
            return Err("gitPathMustBeAbsolute".into());
        }
        let path = if path.is_dir() { path.join(name) } else { path };
        #[cfg(windows)]
        if !path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
        {
            return Err("gitNotFound".into());
        }
        return path
            .is_file()
            .then_some(path)
            .ok_or_else(|| "gitNotFound".into());
    }
    let search_path = env::var_os("PATH").unwrap_or_default();
    env::split_paths(&search_path)
        .filter(|dir| dir.is_absolute())
        .map(|dir| dir.join(name))
        .chain(
            ["ProgramFiles", "ProgramFiles(x86)", "LocalAppData"]
                .into_iter()
                .filter_map(env::var_os)
                .map(|dir| PathBuf::from(dir).join("Git").join("cmd").join(name)),
        )
        .find(|path| path.is_file())
        .ok_or_else(|| "gitNotFound".into())
}

fn git<I, S>(exe: &Path, root: Option<&Path>, args: I) -> Result<Output, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    let mut command = process::hidden(exe);
    command
        .stdin(Stdio::null())
        .args([
            "--no-pager",
            "--literal-pathspecs",
            "-c",
            "core.fsmonitor=false",
        ])
        .env("LC_ALL", "C")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_NO_LAZY_FETCH", "1");
    for key in [
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_COMMON_DIR",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    ] {
        command.env_remove(key);
    }
    if let Some(root) = root {
        command.arg("-C").arg(root);
    }
    command
        .args(args)
        .output()
        .map_err(|error| error.to_string())
}

fn stdout(result: Output) -> Result<Vec<u8>, String> {
    if result.status.success() {
        Ok(result.stdout)
    } else {
        Err(String::from_utf8_lossy(&result.stderr).trim().to_owned())
    }
}

fn repository_root(exe: &Path, directory: &str) -> Result<PathBuf, String> {
    let directory = Path::new(directory);
    if !directory.is_absolute() || !directory.is_dir() {
        return Err("noRepository".into());
    }
    let result = git(exe, Some(directory), ["rev-parse", "--show-toplevel"])?;
    if !result.status.success()
        && String::from_utf8_lossy(&result.stderr).contains("not a git repository")
    {
        return Err("noRepository".into());
    }
    let root = String::from_utf8(stdout(result)?).map_err(|error| error.to_string())?;
    Ok(PathBuf::from(root.trim_end_matches(['\n', '\r'])))
}

fn github_remote(executable: &Path, root: &Path) -> Option<String> {
    let output = git(
        executable,
        Some(root),
        ["config", "--get", "remote.origin.url"],
    )
    .ok()?;
    if !output.status.success() {
        return None;
    }
    let remote = String::from_utf8_lossy(&output.stdout)
        .trim()
        .trim_end_matches(".git")
        .to_string();
    let path = remote
        .strip_prefix("git@github.com:")
        .or_else(|| remote.strip_prefix("https://github.com/"))
        .or_else(|| remote.strip_prefix("http://github.com/"))?;
    Some(format!("https://github.com/{path}"))
}

fn changes(exe: &Path, root: &Path) -> Result<Vec<Change>, String> {
    let list = stdout(git(
        exe,
        Some(root),
        [
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--ignore-submodules=all",
        ],
    )?)?;
    parse_changes(&list)
}

fn parse_changes(list: &[u8]) -> Result<Vec<Change>, String> {
    let mut entries = list
        .split(|byte| *byte == 0)
        .filter(|entry| !entry.is_empty());
    let mut changes = Vec::new();
    while let Some(entry) = entries.next() {
        let [index, working, b' ', path @ ..] = entry else {
            return Err("invalidGitStatus".into());
        };
        let path = String::from_utf8(path.to_vec()).map_err(|_| "invalidGitPath")?;
        let old_path = if [*index, *working]
            .iter()
            .any(|code| matches!(code, b'R' | b'C'))
        {
            let source = entries.next().ok_or("invalidGitStatus")?;
            Some(String::from_utf8(source.to_vec()).map_err(|_| "invalidGitPath")?)
        } else {
            None
        };
        if matches!(
            (*index, *working),
            (b'?', b'?') | (b'A', b'A') | (b'D', b'D') | (b'U', _) | (_, b'U')
        ) {
            changes.push(Change {
                path,
                old_path: None,
                code: if *index == b'?' { '?' } else { 'U' },
                layer: Layer::Worktree,
                mtime: 0,
            });
            continue;
        }
        for (layer, code) in [(Layer::Index, *index), (Layer::Worktree, *working)] {
            if code != b' ' && code != b'!' {
                changes.push(Change {
                    path: path.clone(),
                    old_path: matches!(code, b'R' | b'C')
                        .then(|| old_path.clone())
                        .flatten(),
                    code: char::from(code),
                    layer,
                    mtime: 0,
                });
            }
        }
    }
    Ok(changes)
}

fn blob(exe: &Path, root: &Path, spec: &str, optional: bool) -> Result<String, String> {
    let resolved = git(
        exe,
        Some(root),
        ["rev-parse", "--verify", "--end-of-options", spec],
    )?;
    if optional && !resolved.status.success() {
        return Ok(String::new());
    }
    let id = String::from_utf8(stdout(resolved)?).map_err(|error| error.to_string())?;
    let id = id.trim();
    if !matches!(id.len(), 40 | 64) || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("invalidGitObject".into());
    }
    let size = stdout(git(exe, Some(root), ["cat-file", "-s", id])?)?;
    let size: u64 = String::from_utf8_lossy(&size)
        .trim()
        .parse()
        .map_err(|_| "invalidGitObject")?;
    if size > text_file::MAX_TEXT_BYTES {
        return Err("comparisonTooLarge".into());
    }
    let bytes = stdout(git(exe, Some(root), ["cat-file", "blob", id])?)?;
    text_file::decode(&bytes, false)
        .map(|text| text.content)
        .map_err(|error| error.kind.into())
}

fn working_text(root: &Path, path: &str) -> Result<String, String> {
    let path = Path::new(path);
    if !path
        .components()
        .all(|part| matches!(part, Component::Normal(_)))
    {
        return Err("invalidGitPath".into());
    }
    let target = root.join(path);
    let canonical = |path: &Path| path.canonicalize().map_err(|error| error.to_string());
    if !canonical(target.parent().ok_or("invalidGitPath")?)?.starts_with(canonical(root)?) {
        return Err("invalidGitPath".into());
    }
    if let Ok(link) = std::fs::read_link(&target) {
        return Ok(link.to_string_lossy().into_owned());
    }
    text_file::read(&target)
        .map(|text| text.content)
        .map_err(|error| error.kind.into())
}

async fn background<T: Send + 'static>(
    run: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(run)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn git_workspace_available(directory: String, git_path: String) -> bool {
    background(move || {
        let folder = Path::new(&directory);
        if !folder.is_absolute() || !folder.is_dir() {
            return Ok(false);
        }
        if let Ok(exe) = executable(&git_path) {
            return Ok(match repository_root(&exe, &directory) {
                Ok(_) => true,
                Err(error) if error == "noRepository" => false,
                Err(_) => folder
                    .ancestors()
                    .any(|parent| parent.join(".git").exists()),
            });
        }
        // A worktree can still expose Git setup when the executable is missing.
        Ok(folder
            .ancestors()
            .any(|parent| parent.join(".git").exists()))
    })
    .await
    .unwrap_or(false)
}

#[tauri::command]
pub(crate) async fn git_workspace_status(
    directory: String,
    git_path: String,
) -> Result<Workspace, String> {
    background(move || {
        let executable = executable(&git_path)?;
        let version = String::from_utf8_lossy(&stdout(git(&executable, None, ["--version"])?)?)
            .trim()
            .to_owned();
        let root = match repository_root(&executable, &directory) {
            Ok(root) => root,
            Err(error) if error == "noRepository" => {
                return Ok(Workspace {
                    executable,
                    version,
                    repository: None,
                })
            }
            Err(error) => return Err(error),
        };
        let branch = git(
            &executable,
            Some(&root),
            ["symbolic-ref", "--quiet", "--short", "HEAD"],
        )?;
        let branch = branch
            .status
            .success()
            .then(|| String::from_utf8_lossy(&branch.stdout).trim().to_owned());
        let branches = stdout(git(
            &executable,
            Some(&root),
            [
                "for-each-ref",
                "--format=%(refname:lstrip=2)",
                "refs/heads/",
            ],
        )?)?;
        let branches = String::from_utf8_lossy(&branches)
            .lines()
            .map(str::to_owned)
            .collect();
        let refs = stdout(git(
            &executable,
            Some(&root),
            [
                "for-each-ref",
                "--format=%(refname)%09%(symref)",
                "refs/heads/",
                "refs/remotes/",
            ],
        )?)?;
        let refs = String::from_utf8_lossy(&refs)
            .lines()
            .filter_map(|entry| entry.split_once('\t'))
            .filter(|(_, symbolic)| symbolic.is_empty())
            .map(|(reference, _)| reference.to_owned())
            .collect();
        let github = github_remote(&executable, &root);
        let mut changes = changes(&executable, &root)?;
        for change in &mut changes {
            change.mtime = std::fs::metadata(root.join(&change.path))
                .and_then(|metadata| metadata.modified())
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis() as i64)
                .unwrap_or(0);
        }
        Ok(Workspace {
            executable,
            version,
            repository: Some(Repository {
                root,
                branch,
                branches,
                refs,
                changes,
                github,
            }),
        })
    })
    .await
}

#[tauri::command]
pub(crate) async fn git_workspace_diff(
    directory: String,
    git_path: String,
    path: String,
    layer: Layer,
) -> Result<Comparison, String> {
    background(move || {
        let exe = executable(&git_path)?;
        let root = repository_root(&exe, &directory)?;
        let change = changes(&exe, &root)?
            .into_iter()
            .find(|change| change.path == path && change.layer == layer)
            .ok_or("changeMissing")?;
        let old_path = change.old_path.as_deref().unwrap_or(&path);
        let original = match (layer, change.code) {
            (_, '?' | 'A') => String::new(),
            (Layer::Index, _) => blob(&exe, &root, &format!("HEAD:{old_path}"), false)?,
            (Layer::Worktree, 'U') => blob(&exe, &root, &format!("HEAD:{old_path}"), true)?,
            (Layer::Worktree, _) => blob(&exe, &root, &format!(":0:{old_path}"), false)?,
        };
        let modified = match (layer, change.code) {
            (_, 'D') => String::new(),
            (Layer::Index, _) => blob(&exe, &root, &format!(":0:{path}"), false)?,
            (Layer::Worktree, _) => working_text(&root, &path)?,
        };
        Ok(Comparison { original, modified })
    })
    .await
}

#[tauri::command]
pub(crate) async fn git_workspace_switch(
    directory: String,
    git_path: String,
    name: String,
    create: bool,
) -> Result<(), String> {
    background(move || {
        let exe = executable(&git_path)?;
        let root = repository_root(&exe, &directory)?;
        if name.starts_with('-') || name == "HEAD" {
            return Err("invalidBranch".into());
        }
        stdout(git(
            &exe,
            Some(&root),
            ["check-ref-format", &format!("refs/heads/{name}")],
        )?)
        .map_err(|_| "invalidBranch")?;
        let mut args = vec![
            OsString::from("-c"),
            OsString::from("core.hooksPath=/dev/null"),
            OsString::from("switch"),
            OsString::from("--no-guess"),
        ];
        args.push(OsString::from(if create { "-c" } else { "--" }));
        args.push(name.into());
        stdout(git(&exe, Some(&root), args)?).map(|_| ())
    })
    .await
}

fn commit(exe: &Path, root: &Path, reference: &str) -> Result<String, String> {
    let object_id = matches!(reference.len(), 40 | 64)
        && reference.bytes().all(|byte| byte.is_ascii_hexdigit());
    if !object_id
        && !reference.starts_with("refs/heads/")
        && !reference.starts_with("refs/remotes/")
    {
        return Err("invalidBranch".into());
    }
    let value = stdout(git(
        exe,
        Some(root),
        [
            "rev-parse",
            "--verify",
            "--end-of-options",
            &format!("{reference}^{{commit}}"),
        ],
    )?)?;
    Ok(String::from_utf8_lossy(&value).trim().to_owned())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BranchComparison {
    original: String,
    modified: String,
    original_only: usize,
    modified_only: usize,
    merge_bases: Vec<String>,
    graph: String,
    changes: Vec<Change>,
}

#[tauri::command]
pub(crate) async fn git_compare_branches(
    directory: String,
    git_path: String,
    original: String,
    modified: String,
) -> Result<BranchComparison, String> {
    background(move || {
        let exe = executable(&git_path)?;
        let root = repository_root(&exe, &directory)?;
        let original = commit(&exe, &root, &original)?;
        let modified = commit(&exe, &root, &modified)?;
        let range = format!("{original}...{modified}");
        let counts = stdout(git(
            &exe,
            Some(&root),
            ["rev-list", "--left-right", "--count", &range],
        )?)?;
        let counts = String::from_utf8_lossy(&counts);
        let (left, right) = counts.trim().split_once('\t').ok_or("invalidGitStatus")?;
        let base = git(
            &exe,
            Some(&root),
            ["merge-base", "--all", &original, &modified],
        )?;
        let merge_bases = if base.status.code() == Some(1) {
            Vec::new()
        } else {
            String::from_utf8_lossy(&stdout(base)?)
                .lines()
                .map(str::to_owned)
                .collect()
        };
        let graph = stdout(git(
            &exe,
            Some(&root),
            [
                "log",
                "--no-color",
                "--no-show-signature",
                "--no-decorate",
                "--graph",
                "--topo-order",
                "--max-count=35",
                "--format=%h %s",
                &original,
                &modified,
                "--",
            ],
        )?)?;
        let files = stdout(git(
            &exe,
            Some(&root),
            [
                "diff",
                "--no-ext-diff",
                "--no-textconv",
                "--find-renames",
                "--name-status",
                "-z",
                &original,
                &modified,
                "--",
            ],
        )?)?;
        let mut fields = files
            .split(|byte| *byte == 0)
            .filter(|field| !field.is_empty());
        let mut changes = Vec::new();
        while let Some(status) = fields.next() {
            let code = *status.first().ok_or("invalidGitStatus")? as char;
            let path = String::from_utf8(fields.next().ok_or("invalidGitStatus")?.to_vec())
                .map_err(|_| "invalidGitPath")?;
            let (path, old_path) = if code == 'R' || code == 'C' {
                (
                    String::from_utf8(fields.next().ok_or("invalidGitStatus")?.to_vec())
                        .map_err(|_| "invalidGitPath")?,
                    Some(path),
                )
            } else {
                (path, None)
            };
            changes.push(Change {
                path,
                old_path,
                code,
                layer: Layer::Worktree,
                mtime: 0,
            });
        }
        Ok(BranchComparison {
            original,
            modified,
            original_only: left.parse().map_err(|_| "invalidGitStatus")?,
            modified_only: right.parse().map_err(|_| "invalidGitStatus")?,
            merge_bases,
            graph: String::from_utf8_lossy(&graph).into_owned(),
            changes,
        })
    })
    .await
}

#[tauri::command]
pub(crate) async fn git_compare_revisions(
    directory: String,
    git_path: String,
    original: Option<String>,
    modified: Option<String>,
    original_path: String,
    modified_path: String,
) -> Result<Comparison, String> {
    background(move || {
        let exe = executable(&git_path)?;
        let root = repository_root(&exe, &directory)?;
        let read = |reference: Option<String>, path: &str| -> Result<String, String> {
            match reference {
                Some(reference) => {
                    let id = commit(&exe, &root, &reference)?;
                    blob(&exe, &root, &format!("{id}:{path}"), true)
                }
                None => Ok(String::new()),
            }
        };
        Ok(Comparison {
            original: read(original, &original_path)?,
            modified: read(modified, &modified_path)?,
        })
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileRevision {
    hash: String,
    parent: Option<String>,
    time: String,
    author: String,
    subject: String,
    path: String,
    previous_path: String,
    #[serde(skip)]
    commit_time: u64,
}

fn file_revisions(
    exe: &Path,
    root: &Path,
    path: &str,
    offset: usize,
) -> Result<Vec<FileRevision>, String> {
    let max_count = format!("--max-count={}", offset.saturating_add(51));
    let head = git(exe, Some(root), ["rev-parse", "--verify", "HEAD"])?;
    let mut searched = HashSet::from([path.to_owned()]);
    let mut paths = vec![path.to_owned()];
    let mut seen = HashSet::new();
    let mut revisions = Vec::new();
    while let Some(path) = paths.pop() {
        let mut args = vec![
            "log",
            "--branches",
            "--remotes",
            "--follow",
            "--find-renames",
            "--no-show-signature",
            "--no-color",
            &max_count,
            "--format=%x1e%H%x00%P%x00%ct%x00%aI%x00%an%x00%s",
            "--name-status",
            "-z",
        ];
        if head.status.success() {
            args.push("HEAD");
        }
        args.extend(["--", &path]);
        let output = stdout(git(exe, Some(root), args)?)?;
        for record in output.split(|byte| *byte == 0x1e).skip(1) {
            let mut fields = record
                .split(|byte| *byte == 0)
                .map(|bytes| String::from_utf8_lossy(bytes).into_owned());
            let (
                Some(hash),
                Some(parents),
                Some(commit_time),
                Some(time),
                Some(author),
                Some(subject),
            ) = (
                fields.next(),
                fields.next(),
                fields.next(),
                fields.next(),
                fields.next(),
                fields.next(),
            )
            else {
                continue;
            };
            let status = fields
                .find(|field| !field.trim().is_empty())
                .unwrap_or_default();
            let previous_path = fields
                .next()
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| path.clone());
            let current_path = if status.trim_start().starts_with('R') {
                // A sibling branch can still use the old name after the rename.
                if searched.insert(previous_path.clone()) {
                    paths.push(previous_path.clone());
                }
                fields.next().unwrap_or_else(|| previous_path.clone())
            } else {
                previous_path.clone()
            };
            if seen.insert(hash.clone()) {
                revisions.push(FileRevision {
                    hash,
                    parent: parents.split_whitespace().next().map(str::to_owned),
                    time,
                    author,
                    subject,
                    path: current_path,
                    previous_path,
                    commit_time: commit_time.parse().unwrap_or_default(),
                });
            }
        }
    }
    revisions.sort_by_key(|entry| Reverse(entry.commit_time));
    Ok(revisions.into_iter().skip(offset).take(51).collect())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileHistory {
    root: PathBuf,
    path: String,
    github_remote: Option<String>,
    github_ref: Option<String>,
    revisions: Vec<FileRevision>,
    has_more: bool,
}

#[tauri::command]
pub(crate) async fn git_file_history(
    file: String,
    git_path: String,
    offset: usize,
) -> Result<Option<FileHistory>, String> {
    background(move || {
        let exe = executable(&git_path)?;
        let file = Path::new(&file);
        if !file.is_absolute() {
            return Ok(None);
        }
        let folder = file
            .parent()
            .and_then(Path::to_str)
            .ok_or("invalidGitPath")?;
        let root = match repository_root(&exe, folder) {
            Ok(root) => root,
            Err(error) if error == "noRepository" => return Ok(None),
            Err(error) => return Err(error),
        };
        let relative = file
            .strip_prefix(&root)
            .map(Path::to_path_buf)
            .or_else(|_| {
                file.canonicalize().and_then(|item| {
                    Ok(item
                        .strip_prefix(root.canonicalize()?)
                        .map_err(std::io::Error::other)?
                        .to_owned())
                })
            });
        let path = relative
            .map_err(|_| "invalidGitPath")?
            .to_str()
            .ok_or("invalidGitPath")?
            .replace(std::path::MAIN_SEPARATOR, "/");
        let tracked = git(
            &exe,
            Some(&root),
            ["ls-files", "--error-unmatch", "--", &path],
        )?;
        let mut revisions = file_revisions(&exe, &root, &path, offset)?;
        if revisions.is_empty() && offset == 0 && !tracked.status.success() {
            return Ok(None);
        }
        let read_config = |args| {
            git(&exe, Some(&root), args)
                .ok()
                .filter(|output| output.status.success())
                .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
        };
        let upstream = read_config(vec!["rev-parse", "--abbrev-ref", "@{upstream}"]);
        let remote = upstream
            .as_deref()
            .and_then(|value| value.split_once('/'))
            .map(|(remote, _)| remote)
            .unwrap_or("origin");
        let remote_key = format!("remote.{remote}.url");
        let github_remote = read_config(vec!["config", "--get", &remote_key]);
        let github_ref = upstream
            .as_deref()
            .and_then(|value| value.split_once('/'))
            .map(|(_, branch)| branch.to_owned())
            .or_else(|| read_config(vec!["symbolic-ref", "--short", "HEAD"]));
        let has_more = revisions.len() > 50;
        revisions.truncate(50);
        Ok(Some(FileHistory {
            root,
            path,
            github_remote,
            github_ref,
            revisions,
            has_more,
        }))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_preserves_rename_sources_and_independent_index_changes() {
        let entries =
            parse_changes(b"RM doc new.md\0doc old.md\0 D removed.md\0?? untracked.md\0").unwrap();
        assert_eq!(entries.len(), 4);
        assert_eq!(entries[0].path, "doc new.md");
        assert_eq!(entries[0].old_path.as_deref(), Some("doc old.md"));
        assert!(entries[0].layer == Layer::Index);
        assert!(entries[1].layer == Layer::Worktree);
        assert!(entries[1].old_path.is_none());
        assert_eq!(entries[2].code, 'D');
        assert_eq!(entries[3].code, '?');
    }

    #[test]
    fn git_compares_head_index_and_working_tree_independently() {
        let Ok(exe) = executable("") else { return };
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let run = |args| stdout(git(&exe, Some(root), args).unwrap()).unwrap();
        run(vec!["init", "-q"]);
        let file = root.join("a note.md");
        std::fs::write(&file, "original\n").unwrap();
        run(vec!["add", "--", "a note.md"]);
        run(vec![
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-qm",
            "Fixture",
        ]);
        std::fs::write(&file, "staged\n").unwrap();
        run(vec!["add", "--", "a note.md"]);
        std::fs::write(&file, "working\n").unwrap();
        let compare = |layer| {
            tauri::async_runtime::block_on(git_workspace_diff(
                root.to_string_lossy().into_owned(),
                exe.to_string_lossy().into_owned(),
                "a note.md".into(),
                layer,
            ))
            .unwrap()
        };
        let staged = compare(Layer::Index);
        assert_eq!(staged.original.trim_end(), "original");
        assert_eq!(staged.modified.trim_end(), "staged");
        let working = compare(Layer::Worktree);
        assert_eq!(working.original.trim_end(), "staged");
        assert_eq!(working.modified.trim_end(), "working");

        let switch = |name: &str, create| {
            tauri::async_runtime::block_on(git_workspace_switch(
                root.to_string_lossy().into_owned(),
                exe.to_string_lossy().into_owned(),
                name.into(),
                create,
            ))
            .unwrap()
        };
        let initial_branch =
            String::from_utf8(run(vec!["symbolic-ref", "--short", "HEAD"])).unwrap();
        switch("review/notes", true);
        assert_eq!(
            run(vec!["symbolic-ref", "--short", "HEAD"]),
            b"review/notes\n"
        );
        switch(initial_branch.trim(), false);
        assert_eq!(std::fs::read_to_string(file).unwrap(), "working\n");
    }

    #[test]
    fn compares_diverged_branches_and_reads_history_across_a_rename() {
        let Ok(exe) = executable("") else { return };
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let run = |args| stdout(git(&exe, Some(root), args).unwrap()).unwrap();
        run(vec!["init", "-q", "-b", "base"]);
        run(vec!["config", "user.name", "Test"]);
        run(vec!["config", "user.email", "test@example.invalid"]);
        run(vec!["config", "commit.gpgsign", "false"]);
        let text = "first line\nsecond line\nthird line\nfourth line\n";
        std::fs::write(root.join("old note.md"), text).unwrap();
        run(vec!["add", "--", "old note.md"]);
        run(vec!["commit", "-qm", "Initial note"]);
        run(vec!["switch", "-qc", "topic"]);
        run(vec!["mv", "old note.md", "new note.md"]);
        run(vec!["commit", "-qm", "Move note"]);
        run(vec!["switch", "-q", "base"]);
        std::fs::write(root.join("old note.md"), format!("{text}base addition\n")).unwrap();
        run(vec!["commit", "-qam", "Base edit"]);
        run(vec!["switch", "-q", "topic"]);
        std::fs::write(root.join("new note.md"), format!("{text}backup only\n")).unwrap();
        run(vec!["stash", "push", "-qm", "Backup change"]);

        let root_path = root.to_string_lossy().into_owned();
        let executable_path = exe.to_string_lossy().into_owned();
        let relation = tauri::async_runtime::block_on(git_compare_branches(
            root_path.clone(),
            executable_path.clone(),
            "refs/heads/base".into(),
            "refs/heads/topic".into(),
        ))
        .unwrap();
        assert_eq!((relation.original_only, relation.modified_only), (1, 1));
        assert_eq!(relation.merge_bases.len(), 1);
        assert!(relation.graph.contains("Move note"));
        assert_eq!(relation.changes.len(), 1);
        assert_eq!(relation.changes[0].old_path.as_deref(), Some("old note.md"));
        assert_eq!(relation.changes[0].path, "new note.md");
        let history = tauri::async_runtime::block_on(git_file_history(
            root.join("new note.md").to_string_lossy().into_owned(),
            executable_path.clone(),
            0,
        ))
        .unwrap()
        .unwrap();
        let rename = history
            .revisions
            .iter()
            .find(|entry| entry.subject == "Move note")
            .unwrap();
        assert_eq!(
            (rename.previous_path.as_str(), rename.path.as_str()),
            ("old note.md", "new note.md")
        );
        assert!(history
            .revisions
            .iter()
            .any(|entry| entry.subject == "Initial note"));
        assert!(history
            .revisions
            .iter()
            .any(|entry| entry.subject == "Base edit"));
        assert!(!history
            .revisions
            .iter()
            .any(|entry| entry.subject.contains("Backup change")));
        let compare = tauri::async_runtime::block_on(git_compare_revisions(
            root_path,
            executable_path,
            Some(relation.original),
            Some(relation.modified),
            "old note.md".into(),
            "new note.md".into(),
        ))
        .unwrap();
        assert!(compare.original.contains("base addition"));
        assert_eq!(compare.modified.replace("\r\n", "\n"), text);
    }
}
