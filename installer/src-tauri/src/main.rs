#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{Emitter, Manager};

const PAYLOAD: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/payload.exe"));
#[derive(Clone)]
struct InstallState {
    work_dir: PathBuf,
    running: Arc<AtomicBool>,
    installed: Arc<Mutex<Option<PathBuf>>>,
}
#[derive(Clone, serde::Serialize)]
struct Progress { stage: String, percent: u8 }
/// 启动时的上下文：是不是被更新器拉起来的，以及该装到哪个目录。
#[derive(Clone, serde::Serialize)]
struct StartupInfo { update: bool, directory: String }

fn emit(app: &tauri::AppHandle, stage: &str, percent: u8) {
    let _ = app.emit("install-progress", Progress { stage: stage.into(), percent });
}
fn local_data_directory() -> Option<PathBuf> {
    dirs::data_local_dir()
        .or_else(|| std::env::var_os("LOCALAPPDATA").map(PathBuf::from))
        .filter(|path| path.is_absolute())
}

fn default_directory() -> Option<PathBuf> {
    local_data_directory().map(|path| path.join("mokidown"))
}

fn installer_workspace() -> Result<tempfile::TempDir, String> {
    let system_temp = std::env::temp_dir();
    let roots = [
        local_data_directory().map(|path| path.join("com.mokidown.installer").join("work")),
        std::env::var_os("TEMP")
            .map(PathBuf::from)
            .filter(|path| path != &system_temp),
        Some(system_temp),
        // The user's profile may still be writable if both AppData and TEMP are redirected.
        dirs::home_dir().map(|path| path.join(".mokidown").join("installer")),
    ];
    let mut errors = Vec::new();
    for root in roots.into_iter().flatten().filter(|path| path.is_absolute()) {
        let workspace = (|| {
            std::fs::create_dir_all(&root)?;
            let workspace = tempfile::Builder::new()
                .prefix("mokidown-setup-")
                .tempdir_in(&root)?;
            tempfile::NamedTempFile::new_in(workspace.path())?.close()?;
            Ok::<_, std::io::Error>(workspace)
        })();
        match workspace {
            Ok(workspace) => return Ok(workspace),
            Err(error) => errors.push(format!("{}\n{error}", root.display())),
        }
    }
    if errors.is_empty() {
        return Err("无法找到当前用户的缓存目录。".into());
    }
    Err(format!(
        "无法创建可写的安装缓存。已尝试以下目录：\n\n{}",
        errors.join("\n\n")
    ))
}

fn stage_payload(root: &Path) -> Result<tempfile::TempDir, String> {
    if PAYLOAD.is_empty() {
        return Err("当前开发构建未包含安装文件，请运行 npm run installer:bundle".into());
    }
    let stage = tempfile::Builder::new()
        .prefix("payload-")
        .tempdir_in(root)
        .map_err(|error| format!("无法创建安装缓存：{error}"))?;
    std::fs::write(stage.path().join("setup.exe"), PAYLOAD)
        .map_err(|error| format!("无法解包安装文件：{error}"))?;
    Ok(stage)
}

fn silent_payload_command(stage: &tempfile::TempDir) -> Command {
    let mut command = Command::new(stage.path().join("setup.exe"));
    // NSIS unpacks its plugins into TEMP. The wrapper launches the editor
    // separately from a silent install, with the original environment.
    command
        .arg("/S")
        .env("TEMP", stage.path())
        .env("TMP", stage.path());
    command
}

#[cfg(windows)]
fn webview2_available() -> std::io::Result<bool> {
    use std::io::ErrorKind;
    use winreg::{
        enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY},
        RegKey,
    };
    let key = r"Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
    let mut probe_error = None;
    for (hive, flags) in [
        (HKEY_CURRENT_USER, KEY_READ),
        (HKEY_LOCAL_MACHINE, KEY_READ | KEY_WOW64_32KEY),
    ] {
        match RegKey::predef(hive)
            .open_subkey_with_flags(key, flags)
            .and_then(|key| key.get_value::<String, _>("pv"))
        {
            Ok(version) if version.split('.').any(|part| part.parse::<u32>().is_ok_and(|n| n > 0)) => {
                return Ok(true);
            }
            Err(error) if error.kind() != ErrorKind::NotFound => probe_error = Some(error),
            _ => {}
        }
    }
    probe_error.map_or(Ok(false), Err)
}

#[cfg(windows)]
fn run_embedded_installer(root: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    let stage = stage_payload(root)?;
    let update = is_update_launch();
    let mut installer = if update {
        silent_payload_command(&stage)
    } else {
        Command::new(stage.path().join("setup.exe"))
    };
    let update_target = if update {
        let folder = updater_directory()
            .or_else(default_directory)
            .ok_or("无法读取当前用户的安装目录")?;
        let folder = validate_directory(&folder.to_string_lossy())?;
        check_install_directory(&folder)?;
        installer
            .arg("/UPDATE")
            .raw_arg(format!("/D={}", folder.display()));
        Some(folder.join("mokidown.exe"))
    } else {
        None
    };
    let status = installer
        .status()
        .map_err(|error| format!("无法启动安装程序：{error}"))?;
    if !status.success() {
        return Err(format!(
            "安装程序已退出（代码 {}）。",
            status.code().unwrap_or(-1)
        ));
    }
    if let Some(app) = update_target {
        Command::new(app)
            .arg("--moki-after-update")
            .spawn()
            .map_err(|error| format!("无法启动 MokiDown：{error}"))?;
    }
    Ok(())
}

fn show_startup_error(error: &str) {
    eprintln!("MokiDown Setup: {error}");
    #[cfg(windows)]
    {
        #[link(name = "user32")]
        extern "system" {
            fn MessageBoxW(
                hwnd: *mut std::ffi::c_void,
                message: *const u16,
                title: *const u16,
                flags: u32,
            ) -> i32;
        }
        let title: Vec<_> = "MokiDown 安装".encode_utf16().chain([0]).collect();
        let message: Vec<_> = format!("无法启动安装程序。\n\n{error}")
            .encode_utf16()
            .chain([0])
            .collect();
        unsafe {
            MessageBoxW(std::ptr::null_mut(), message.as_ptr(), title.as_ptr(), 0x10);
        }
    }
}

#[cfg(windows)]
fn is_low_integrity_process() -> bool {
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use windows_sys::Win32::{
        Security::{
            GetSidSubAuthority, GetSidSubAuthorityCount, GetTokenInformation,
            TokenIntegrityLevel, SECURITY_MAX_SID_SIZE, TOKEN_MANDATORY_LABEL, TOKEN_QUERY,
        },
        System::{
            SystemServices::SECURITY_MANDATORY_MEDIUM_RID,
            Threading::{GetCurrentProcess, OpenProcessToken},
        },
    };

    #[repr(C)]
    struct IntegrityInfo {
        label: TOKEN_MANDATORY_LABEL,
        sid: [u8; SECURITY_MAX_SID_SIZE as usize],
    }

    unsafe {
        let mut token = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return false;
        }
        let token = OwnedHandle::from_raw_handle(token);
        let mut integrity: IntegrityInfo = std::mem::zeroed();
        let mut written = 0;
        if GetTokenInformation(
            token.as_raw_handle(),
            TokenIntegrityLevel,
            (&mut integrity as *mut IntegrityInfo).cast(),
            std::mem::size_of::<IntegrityInfo>() as u32,
            &mut written,
        ) == 0
        {
            return false;
        }
        let sid = integrity.label.Label.Sid;
        let count = *GetSidSubAuthorityCount(sid);
        count != 0
            && *GetSidSubAuthority(sid, u32::from(count - 1)) < SECURITY_MANDATORY_MEDIUM_RID as u32
    }
}
/**
 * 是不是被更新器拉起来的。
 *
 * tauri-plugin-updater 在 Windows 上会把 NSIS 那套参数传给它启动的程序，
 * 其中就包含 /UPDATE（见插件 updater.rs 的 WindowsUpdaterType::Nsis 分支）。
 * 我们要把 /UPDATE 继续转发给内嵌的 NSIS，否则 NSIS 会走「先卸载再装」那条路，
 * 而 /UPDATE 的语义是原地升级：不卸载、保留快捷方式、保留开机启动项与安装位置。
 */
fn is_update_launch() -> bool {
    std::env::args().any(|arg| arg.eq_ignore_ascii_case("/UPDATE"))
}
/**
 * 读注册表里上次的安装位置。
 *
 * Tauri 的 NSIS 模板把安装目录写在 ${MANUPRODUCTKEY}（即 Software\MokiDown\mokidown）
 * 的默认值上，模板里的 RestorePreviousInstallLocation 也是读它。更新时用户装过哪个
 * 目录就以哪个为准，不能让用户重选——重选会装出第二份。
 *
 * 使用原生注册表接口保留中文和空格，不解析命令行工具的本地编码输出。
 */
/// 读取某个注册表分支下默认值里的安装路径；读不到返回 None。
#[cfg(windows)]
fn read_reg_default(hive: &str) -> Option<String> {
    use winreg::{RegKey, enums::{HKEY_CURRENT_USER,HKEY_LOCAL_MACHINE}};
    let registry=RegKey::predef(if hive=="HKCU" {HKEY_CURRENT_USER} else {HKEY_LOCAL_MACHINE});
    if let Ok(key)=registry.open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\mokidown") {
        if let Ok(value)=key.get_value::<String,_>("InstallLocation") {
            let path=value.trim().trim_matches('"');
            if !path.is_empty() { return Some(path.to_owned()); }
        }
    }
    for key in ["Software\\hhyufan\\mokidown","Software\\MokiDown\\mokidown"] {
        if let Ok(key)=registry.open_subkey(key) {
            if let Ok(value)=key.get_value::<String,_>("") {
                if !value.is_empty() { return Some(value); }
            }
        }
    }
    None
}
#[cfg(not(windows))]
fn read_reg_default(_hive: &str) -> Option<String> { None }
/// 依次找 HKCU、HKLM：Tauri 的 NSIS 默认按当前用户安装，所以 HKCU 先。
fn previous_install_directory() -> Option<PathBuf> {
    ["HKCU", "HKLM"].iter().find_map(|hive| read_reg_default(hive)).map(PathBuf::from)
}
// The running app passes its own location; base64 keeps Unicode and spaces intact
// through ShellExecute/NSIS command-line quoting. Older clients use the registry.
fn updater_directory() -> Option<PathBuf> {
    use base64::Engine;
    std::env::args().find_map(|argument| {
        let encoded = argument.strip_prefix("/MOKI_DIRECTORY=")?;
        let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(encoded).ok()?;
        let directory = String::from_utf8(bytes).ok()?;
        validate_directory(&directory).ok()
    }).or_else(previous_install_directory)
}
fn validate_directory(value: &str) -> Result<PathBuf,String> {
    let path = PathBuf::from(value);
    if !path.is_absolute() || path.parent().is_none() || value.contains(['\r','\n','"']) || path.components().any(|c|matches!(c,std::path::Component::ParentDir)) {
        return Err("请选择有效的绝对安装路径".into());
    }
    if path.is_file() { return Err("安装位置指向一个文件，请选择文件夹".into()); }
    Ok(path)
}
fn check_install_directory(path: &Path) -> Result<(), String> {
    std::fs::create_dir_all(path)
        .and_then(|_| tempfile::NamedTempFile::new_in(path))
        .and_then(tempfile::NamedTempFile::close)
        .map_err(|error| format!("无法写入安装目录 {}：{error}", path.display()))
}
fn read_progress(app: &tauri::AppHandle, file: &std::path::Path, previous: &mut String) {
    if let Ok(content)=std::fs::read_to_string(file) {
        // Read complete ASCII records only; NSIS may still be appending a line.
        if let Some(line)=content.rsplit_once('\n').and_then(|(complete,_)|complete.lines().next_back()) {
            if line!=previous {
                if let Some((number,stage))=line.trim().split_once('|') {
                    if let Ok(percent)=number.parse::<u8>() {
                        if percent<=100 { emit(app,stage,percent); *previous=line.into(); }
                    }
                }
            }
        }
    }
}
#[tauri::command]
fn startup_info() -> Result<StartupInfo,String> {
    let update = is_update_launch();
    // 更新时必须沿用上次装的位置；读不到才退回默认目录。
    let directory = if update { updater_directory().or_else(default_directory) } else { previous_install_directory().or_else(default_directory) };
    directory
        .map(|path|StartupInfo{update,directory:path.to_string_lossy().into_owned()})
        .ok_or_else(||"无法读取当前用户的安装目录".into())
}
#[tauri::command]
async fn install_application(app: tauri::AppHandle, state: tauri::State<'_,InstallState>, directory:String) -> Result<(),String> {
    let folder=validate_directory(&directory)?;
    let update=is_update_launch();
    if state.running.swap(true,Ordering::SeqCst) { return Err("安装正在进行".into()); }
    let state=state.inner().clone();
    let running=state.running.clone();
    let result=tauri::async_runtime::spawn_blocking(move || {
        emit(&app,"preparing",3);
        check_install_directory(&folder)?;
        let temp = stage_payload(&state.work_dir)?;
        let progress=temp.path().join("progress.txt");
        let mut command=silent_payload_command(&temp);
        command.arg(format!("/MOKI_PROGRESS={}",progress.display()));
        // 转发 /UPDATE：让 NSIS 走原地升级，不卸载、保留快捷方式与安装位置。
        if update { command.arg("/UPDATE"); }
        #[cfg(windows)] {
            use std::os::windows::process::CommandExt;
            // NSIS requires /D to be last and unquoted. No shell is involved.
            command.raw_arg(format!("/D={}",folder.display())).creation_flags(0x08000000);
        }
        #[cfg(not(windows))] command.arg(format!("/D={}",folder.display()));
        let mut child=command.spawn().map_err(|e|e.to_string())?;
        let mut previous=String::new();
        loop {
            read_progress(&app,&progress,&mut previous);
            match child.try_wait().map_err(|e|e.to_string())? {
                Some(status)=>{
                    if !status.success() { return Err(format!("安装未完成（代码 {}）。请先关闭正在运行的 MokiDown，并确认所选目录可写后重试。",status.code().unwrap_or(-1))); }
                    let executable=folder.join("mokidown.exe");
                    if !executable.is_file() { return Err("安装程序未在所选目录创建应用，请检查安装路径".into()); }
                    *state.installed.lock().map_err(|e|e.to_string())?=Some(executable);
                    emit(&app,"complete",100);return Ok(());
                },
                None=>std::thread::sleep(Duration::from_millis(150)),
            }
        }
    }).await.map_err(|e|e.to_string()).and_then(|result|result);
    running.store(false,Ordering::SeqCst);
    result
}
#[tauri::command]
fn launch_application(state:tauri::State<'_,InstallState>, after_update:Option<bool>)->Result<(),String> {
    let app=state.installed.lock().map_err(|e|e.to_string())?.clone().ok_or("请先完成安装")?;
    let mut command=Command::new(app);
    // 更新流程拉起应用时带上这个标志。主程序据此跳过原生启动动画，
    // 改在主窗口里播一段工作区入场动画（用户刚看过安装流程，再放一遍开屏是重复的）。
    // 常量与 src-tauri/src/startup.rs 的 AFTER_UPDATE_FLAG 必须一致。
    if after_update.unwrap_or(false) { command.arg("--moki-after-update"); }
    command.spawn().map_err(|e|e.to_string())?;Ok(())
}
fn main() -> std::process::ExitCode {
    use std::process::ExitCode;

    #[cfg(windows)]
    if is_low_integrity_process() {
        show_startup_error("Windows 以低完整性运行了此安装器，限制了对用户目录的写入。请使用输出到普通用户目录的安装包，例如在「下载」中生成的版本。");
        return ExitCode::FAILURE;
    }

    let workspace = match installer_workspace() {
        Ok(workspace) => workspace,
        Err(error) => {
            show_startup_error(&error);
            return ExitCode::FAILURE;
        }
    };
    #[cfg(windows)]
    let runtime = webview2_available();
    #[cfg(windows)]
    if matches!(runtime, Ok(false)) {
        if let Err(error) = run_embedded_installer(workspace.path()) {
            show_startup_error(&error);
            return ExitCode::FAILURE;
        }
        return ExitCode::SUCCESS;
    }
    let profile_path = workspace.path().join("webview2");
    let mut context = tauri::generate_context!();
    let window = context.config().app.windows[0].clone();
    context.config_mut().app.windows[0].create = false;
    let app = tauri::Builder::default()
        .manage(InstallState {
            work_dir: workspace.path().to_path_buf(),
            running: Arc::default(),
            installed: Arc::default(),
        })
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            let result = tauri::WebviewWindowBuilder::from_config(app, &window)
                .and_then(|builder| builder.data_directory(profile_path).build());
            if let Err(error) = result {
                show_startup_error(&error.to_string());
                app.handle().exit(1);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            startup_info,
            install_application,
            launch_application
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window
                    .state::<InstallState>()
                    .running
                    .load(Ordering::SeqCst)
                {
                    api.prevent_close();
                }
            }
        })
        .build(context);
    match app {
        Ok(app) => {
            let code = app.run_return(|_, _| {});
            drop(workspace);
            if code == 0 {
                ExitCode::SUCCESS
            } else {
                ExitCode::FAILURE
            }
        }
        Err(error) => {
            #[cfg(windows)]
            if let Err(probe_error) = runtime {
                show_startup_error(&format!("WebView2 检测失败：{probe_error}\n\n{error}"));
                return ExitCode::FAILURE;
            }
            show_startup_error(&error.to_string());
            ExitCode::FAILURE
        }
    }
}
