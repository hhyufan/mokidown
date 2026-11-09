use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
#[cfg(windows)]
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow};

// Android 上 WebviewWindow 没有桌面窗口 API（close/show/set_focus…）。
// reader 的窗口逻辑在移动端不会运行，这里提供同名的 no-op 扩展方法，
// 让整个模块能跨平台编译；窗口相关函数在 Android 下不会被调用。
#[cfg(target_os = "android")]
mod android_window_shim {
    use tauri::{Manager, Runtime, WebviewWindow, WebviewWindowBuilder};

    pub trait DesktopWindow {
        fn close(&self) -> Result<(), tauri::Error> { Ok(()) }
        fn show(&self) -> Result<(), tauri::Error> { Ok(()) }
        fn hide(&self) -> Result<(), tauri::Error> { Ok(()) }
        fn set_focus(&self) -> Result<(), tauri::Error> { Ok(()) }
        fn unminimize(&self) -> Result<(), tauri::Error> { Ok(()) }
        fn set_skip_taskbar(&self, _skip: bool) -> Result<(), tauri::Error> { Ok(()) }
        fn set_min_size<S>(&self, _size: Option<S>) -> Result<(), tauri::Error> { Ok(()) }
        fn set_position<P: Into<tauri::Position>>(&self, _position: P) -> Result<(), tauri::Error> { Ok(()) }
    }

    impl<R: Runtime> DesktopWindow for WebviewWindow<R> {}

    pub trait DialogTitle {
        fn title<T: Into<String>>(self, _title: T) -> Self;
        fn inner_size(self, _width: f64, _height: f64) -> Self;
        fn min_inner_size(self, _width: f64, _height: f64) -> Self;
        fn decorations(self, _value: bool) -> Self;
        fn shadow(self, _value: bool) -> Self;
        fn focused(self, _value: bool) -> Self;
        fn skip_taskbar(self, _value: bool) -> Self;
        fn visible(self, _value: bool) -> Self;
        fn transparent(self, _value: bool) -> Self;
        fn position(self, _x: f64, _y: f64) -> Self;
    }

    impl<'a, R: Runtime, M: Manager<R>> DialogTitle for WebviewWindowBuilder<'a, R, M> {
        fn title<T: Into<String>>(self, _title: T) -> Self { self }
        fn inner_size(self, _width: f64, _height: f64) -> Self { self }
        fn min_inner_size(self, _width: f64, _height: f64) -> Self { self }
        fn decorations(self, _value: bool) -> Self { self }
        fn shadow(self, _value: bool) -> Self { self }
        fn focused(self, _value: bool) -> Self { self }
        fn skip_taskbar(self, _value: bool) -> Self { self }
        fn visible(self, _value: bool) -> Self { self }
        fn transparent(self, _value: bool) -> Self { self }
        fn position(self, _x: f64, _y: f64) -> Self { self }
    }
}

#[cfg(target_os = "android")]
use android_window_shim::{DesktopWindow, DialogTitle};

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderDocument {
    pub id: String,
    pub name: String,
    pub path: String,
    pub content: Option<String>,
    #[serde(default)]
    pub modified: bool,
    #[serde(default)]
    pub keep_source: bool,
    pub encoding: Option<String>,
    pub line_ending: Option<String>,
    #[serde(default)]
    pub opening: Option<ReaderOpening>,
    #[serde(default)]
    pub prerender: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderOpening {
    pub x: f64,
    pub y: f64,
    pub preview: DragPreview,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderDetachDrop {
    pub document: ReaderDocument,
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DragPreview {
    pub name: String,
    pub icon: String,
    pub background: String,
    pub color: String,
    pub border: String,
    #[serde(default)]
    pub token: String,
    #[serde(default)]
    pub width: f64,
    #[serde(default)]
    pub height: f64,
    #[serde(default)]
    pub offset_x: f64,
    #[serde(default)]
    pub offset_y: f64,
    #[serde(default)]
    pub appearance: HashMap<String, String>,
    #[serde(default)]
    pub markup: String,
}

#[derive(Default)]
pub struct ReaderState {
    documents: Mutex<HashMap<String, ReaderDocument>>,
    handover: Mutex<Vec<ReaderDocument>>,
    main_is_reader: Mutex<bool>,
    detach_watchers: Mutex<HashMap<String, Arc<AtomicBool>>>,
    previews: Mutex<HashMap<String, (DragPreview, Arc<AtomicBool>)>>,
    prepared_readers: Mutex<HashMap<String, String>>,
    idle_reader: Mutex<Option<String>>,
    idle_building: AtomicBool,
}

static NEXT_WINDOW: AtomicU64 = AtomicU64::new(1);

#[cfg(any(windows, test))]
struct ReaderBuildPermit<'a>(&'a AtomicBool);

#[cfg(any(windows, test))]
impl<'a> ReaderBuildPermit<'a> {
    fn acquire(flag: &'a AtomicBool) -> Option<Self> {
        flag.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| Self(flag))
    }
}

#[cfg(any(windows, test))]
impl Drop for ReaderBuildPermit<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

fn preference_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("associated-open-mode.json"))
}

pub fn associated_reader_mode(app: &AppHandle) -> bool {
    preference_path(app)
        .ok()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .is_some_and(|value| value == "\"reader\"")
}

#[tauri::command]
pub fn set_associated_open_mode(app: AppHandle, mode: String) -> Result<(), String> {
    let value = match mode.as_str() {
        "reader" => "\"reader\"",
        "editor" => "\"editor\"",
        _ => return Err("Invalid associated open mode".into()),
    };
    let path = preference_path(&app)?;
    if std::fs::read_to_string(&path).ok().as_deref() == Some(value) {
        return Ok(());
    }
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(path, value).map_err(|e| e.to_string())
}

pub fn from_path(path: String) -> ReaderDocument {
    ReaderDocument {
        id: path.clone(),
        name: std::path::Path::new(&path)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        path,
        ..Default::default()
    }
}

#[tauri::command]
pub async fn reader_bootstrap(
    app: AppHandle,
    window: WebviewWindow,
    mode: String,
    editor: bool,
) -> Result<Option<ReaderDocument>, String> {
    if window.label() != "main" {
        return Ok(app
            .state::<ReaderState>()
            .documents
            .lock()
            .unwrap()
            .get(window.label())
            .cloned());
    }
    set_associated_open_mode(app.clone(), mode)?;
    if editor || !associated_reader_mode(&app) {
        return Ok(None);
    }
    // Keep the primary reader stable across reloads.
    if let Some(document) = app
        .state::<ReaderState>()
        .documents
        .lock()
        .unwrap()
        .get("main")
        .cloned()
    {
        return Ok(Some(document));
    }
    let cwd = std::env::current_dir().ok();
    let paths = crate::collect_markdown_paths(std::env::args().skip(1), cwd.as_deref());
    let mut paths = paths.into_iter();
    let Some(first) = paths.next() else {
        return Ok(None);
    };
    let document = from_path(first);
    app.state::<ReaderState>()
        .documents
        .lock()
        .unwrap()
        .insert("main".into(), document.clone());
    *app.state::<ReaderState>().main_is_reader.lock().unwrap() = true;
    for path in paths {
        create_reader(&app, from_path(path), None, None)?;
    }
    if let Some(splash) = app.get_webview_window("splash") {
        let _ = splash.close();
    }
    Ok(Some(document))
}

pub fn create_reader(
    app: &AppHandle,
    document: ReaderDocument,
    x: Option<f64>,
    y: Option<f64>,
) -> Result<String, String> {
    if document
        .content
        .as_ref()
        .is_some_and(|text| text.len() > crate::text_file::MAX_TEXT_BYTES as usize)
    {
        return Err("Document exceeds the text size limit".into());
    }
    let label = format!("reader-{}", NEXT_WINDOW.fetch_add(1, Ordering::Relaxed));
    app.state::<ReaderState>()
        .documents
        .lock()
        .unwrap()
        .insert(label.clone(), document.clone());
    let result = (|| {
        let mut builder = tauri::WebviewWindowBuilder::new(
            app,
            &label,
            WebviewUrl::App("index.html?reader=1".into()),
        )
        .title(format!("{} - MokiDown", document.name))
        .inner_size(900.0, 720.0)
        .decorations(false)
        .shadow(false)
        .focused(false)
        .skip_taskbar(document.prerender)
        .visible(false);
        if let Some(opening) = &document.opening {
            builder = builder
                .transparent(true)
                .inner_size(
                    if document.prerender {
                        900.0
                    } else {
                        opening.preview.width.max(32.0)
                    },
                    if document.prerender {
                        720.0
                    } else {
                        opening.preview.height.max(20.0)
                    },
                )
                .min_inner_size(1.0, 1.0)
                .position(opening.x, opening.y);
        } else if let (Some(x), Some(y)) = (x, y) {
            if x.is_finite() && y.is_finite() {
                builder = builder.position(x - 100.0, y - 20.0);
            }
        }
        if document.opening.is_none() {
            builder = builder.min_inner_size(360.0, 240.0);
        }
        let window = builder.build().map_err(|e| e.to_string())?;
        #[cfg(windows)]
        crate::style_window_frame(&window);
        Ok::<_, String>(label.clone())
    })();
    if result.is_err() {
        app.state::<ReaderState>()
            .documents
            .lock()
            .unwrap()
            .remove(&label);
    }
    result
}

#[tauri::command]
pub async fn open_reader_window(
    app: AppHandle,
    document: ReaderDocument,
    x: Option<f64>,
    y: Option<f64>,
) -> Result<String, String> {
    if let Some(opening) = &document.opening {
        let prepared = app
            .state::<ReaderState>()
            .prepared_readers
            .lock()
            .unwrap()
            .remove(&opening.preview.token);
        if let Some(label) = prepared {
            if let Some(window) = app.get_webview_window(&label) {
                app.state::<ReaderState>()
                    .documents
                    .lock()
                    .unwrap()
                    .insert(label.clone(), document);
                window
                    .set_skip_taskbar(false)
                    .map_err(|error| error.to_string())?;
                window
                    .emit("reader:activate", ())
                    .map_err(|error| error.to_string())?;
                return Ok(label);
            }
        }
    }
    acquire_reader(&app, document, x, y)
}

fn discard_prepared_reader(app: &AppHandle, token: &str) {
    let label = app
        .state::<ReaderState>()
        .prepared_readers
        .lock()
        .unwrap()
        .remove(token);
    if let Some(label) = label {
        if let Some(window) = app.get_webview_window(&label) {
            let state = app.state::<ReaderState>();
            let mut idle = state.idle_reader.lock().unwrap();
            if idle.is_none() {
                *idle = Some(label.clone());
                drop(idle);
                let document = idle_document(0.0, 0.0);
                app.state::<ReaderState>()
                    .documents
                    .lock()
                    .unwrap()
                    .insert(label, document.clone());
                if window.emit("reader:prepare", document).is_err() {
                    let _ = window.close();
                }
            } else {
                drop(idle);
                let _ = window.close();
            }
        }
    }
}

fn idle_document(x: f64, y: f64) -> ReaderDocument {
    ReaderDocument {
        id: "reader-idle".into(),
        name: "Untitled.md".into(),
        content: Some(String::new()),
        prerender: true,
        opening: Some(ReaderOpening {
            x,
            y,
            preview: DragPreview {
                width: 180.0,
                height: 36.0,
                ..Default::default()
            },
        }),
        ..Default::default()
    }
}

#[cfg(windows)]
fn ensure_idle_reader(app: &AppHandle, source: &WebviewWindow) -> Result<(), String> {
    let state = app.state::<ReaderState>();
    let Some(_permit) = ReaderBuildPermit::acquire(&state.idle_building) else {
        return Ok(());
    };
    let idle_snapshot = state.idle_reader.lock().unwrap().clone();
    if idle_snapshot
        .as_ref()
        .is_some_and(|label| app.get_webview_window(label).is_some())
    {
        return Ok(());
    }
    let origin = source.outer_position().map_err(|error| error.to_string())?;
    let scale = source.scale_factor().map_err(|error| error.to_string())?;
    let label = create_reader(
        app,
        idle_document(f64::from(origin.x) / scale, f64::from(origin.y) / scale),
        None,
        None,
    )?;
    // WebView creation may wait on the UI thread. Never hold a state mutex there.
    let retained = {
        let mut idle = state.idle_reader.lock().unwrap();
        if idle.is_none() || *idle == idle_snapshot {
            *idle = Some(label.clone());
            true
        } else {
            false
        }
    };
    if !retained {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.close();
        }
    }
    Ok(())
}

fn acquire_reader(
    app: &AppHandle,
    document: ReaderDocument,
    x: Option<f64>,
    y: Option<f64>,
) -> Result<String, String> {
    if document
        .content
        .as_ref()
        .is_some_and(|text| text.len() > crate::text_file::MAX_TEXT_BYTES as usize)
    {
        return Err("Document exceeds the text size limit".into());
    }
    let idle = app
        .state::<ReaderState>()
        .idle_reader
        .lock()
        .unwrap()
        .take();
    if let Some(label) = idle {
        if let Some(window) = app.get_webview_window(&label) {
            // Configure the hidden host before publishing the next session.
            let configured = (|| {
                window
                    .set_skip_taskbar(document.prerender)
                    .map_err(|error| error.to_string())?;
                window
                    .set_min_size(Some(tauri::LogicalSize::new(
                        if document.opening.is_some() {
                            1.0
                        } else {
                            360.0
                        },
                        if document.opening.is_some() {
                            1.0
                        } else {
                            240.0
                        },
                    )))
                    .map_err(|error| error.to_string())?;
                if let Some(opening) = &document.opening {
                    window
                        .set_position(tauri::LogicalPosition::new(opening.x, opening.y))
                        .map_err(|error| error.to_string())?;
                } else if let (Some(x), Some(y)) = (x, y) {
                    if x.is_finite() && y.is_finite() {
                        window
                            .set_position(tauri::LogicalPosition::new(x - 100.0, y - 20.0))
                            .map_err(|error| error.to_string())?;
                    }
                }
                Ok::<_, String>(())
            })();
            if configured.is_err() {
                let _ = window.close();
                return create_reader(app, document, x, y);
            }
            app.state::<ReaderState>()
                .documents
                .lock()
                .unwrap()
                .insert(label.clone(), document.clone());
            if window.emit("reader:prepare", &document).is_ok() {
                return Ok(label);
            }
            let _ = window.close();
        }
    }
    create_reader(app, document, x, y)
}

#[tauri::command]
pub fn reader_current_document(app: AppHandle, window: WebviewWindow) -> Option<ReaderDocument> {
    app.state::<ReaderState>()
        .documents
        .lock()
        .unwrap()
        .get(window.label())
        .cloned()
}

#[tauri::command]
pub fn reader_replace_document(
    app: AppHandle,
    window: WebviewWindow,
    mut document: ReaderDocument,
) -> Result<(), String> {
    if document
        .content
        .as_ref()
        .is_some_and(|text| text.len() > crate::text_file::MAX_TEXT_BYTES as usize)
    {
        return Err("Document exceeds the text size limit".into());
    }
    document.opening = None;
    document.prerender = false;
    let state = app.state::<ReaderState>();
    let mut documents = state.documents.lock().unwrap();
    let current = documents
        .get_mut(window.label())
        .ok_or_else(|| "Only a reader can replace its current document".to_string())?;
    *current = document;
    Ok(())
}

#[tauri::command]
pub async fn prepare_drag_preview(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Ok(());
    }
    #[cfg(windows)]
    {
        ensure_drag_preview(&app, &window)?;
        ensure_idle_reader(&app, &window)?;
    }
    #[cfg(not(windows))]
    let _ = app;
    Ok(())
}

#[cfg(windows)]
fn ensure_drag_preview(app: &AppHandle, source: &WebviewWindow) -> Result<WebviewWindow, String> {
    if let Some(preview) = app.get_webview_window("drag-preview") {
        return Ok(preview);
    }
    let origin = source.outer_position().map_err(|error| error.to_string())?;
    let scale = source.scale_factor().map_err(|error| error.to_string())?;
    let preview = tauri::WebviewWindowBuilder::new(
        app,
        "drag-preview",
        WebviewUrl::App("drag-preview.html".into()),
    )
    .title("MokiDown drag preview")
    .inner_size(308.0, 84.0)
    .position(f64::from(origin.x) / scale, f64::from(origin.y) / scale)
    .decorations(false)
    .shadow(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .focusable(false)
    .visible(false)
    .build()
    .map_err(|error| error.to_string())?;
    if let Err(error) = preview.set_ignore_cursor_events(true) {
        let _ = preview.close();
        return Err(error.to_string());
    }
    Ok(preview)
}

#[tauri::command]
pub async fn begin_reader_tab_detach_watch(
    app: AppHandle,
    window: WebviewWindow,
    document: ReaderDocument,
    preview: Option<DragPreview>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Ok(());
    }

    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::POINT;
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
            GetAsyncKeyState, VK_ESCAPE, VK_LBUTTON,
        };
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetCursorPos, SetWindowPos, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER,
        };

        let origin = window.outer_position().map_err(|error| error.to_string())?;
        let size = window.outer_size().map_err(|error| error.to_string())?;
        let scale = window.scale_factor().map_err(|error| error.to_string())?;
        let label = window.label().to_string();
        let cancelled = Arc::new(AtomicBool::new(false));
        let preview_label = "drag-preview".to_string();
        let ready = Arc::new(AtomicBool::new(false));
        let token = preview
            .as_ref()
            .map(|preview| preview.token.clone())
            .unwrap_or_default();
        let offset_x = preview.as_ref().map_or(0.0, |preview| preview.offset_x) * scale;
        let offset_y = preview.as_ref().map_or(0.0, |preview| preview.offset_y) * scale;
        let warm_preview = preview.clone();
        let warm_document = document.clone();
        if let Some(previous) = app
            .state::<ReaderState>()
            .detach_watchers
            .lock()
            .unwrap()
            .get(&label)
        {
            previous.store(true, Ordering::Release);
        }
        let preview_window = if let Some(preview) = preview {
            let width = if preview.width > 0.0 {
                preview.width.clamp(32.0, 1200.0)
            } else {
                260.0
            };
            let height = if preview.height > 0.0 {
                preview.height.clamp(20.0, 200.0)
            } else {
                36.0
            };
            let preview_window = ensure_drag_preview(&app, &window)?;
            preview_window.hide().map_err(|error| error.to_string())?;
            preview_window
                .set_size(tauri::PhysicalSize::new(
                    ((width + 48.0) * scale).round() as u32,
                    ((height + 48.0) * scale).round() as u32,
                ))
                .map_err(|error| error.to_string())?;
            app.state::<ReaderState>()
                .previews
                .lock()
                .unwrap()
                .insert(preview_label.clone(), (preview.clone(), Arc::clone(&ready)));
            preview_window
                .emit("reader:preview-update", preview)
                .map_err(|error| error.to_string())?;
            Some(preview_window)
        } else {
            None
        };
        if let Some(previous) = app
            .state::<ReaderState>()
            .detach_watchers
            .lock()
            .unwrap()
            .insert(label.clone(), Arc::clone(&cancelled))
        {
            previous.store(true, Ordering::Release);
        }

        let monitor_app = app.clone();
        let preview_hwnd = preview_window
            .as_ref()
            .and_then(|window| window.hwnd().ok())
            .map(|hwnd| hwnd.0 as isize);
        let monitor_flag = Arc::clone(&cancelled);
        let cleanup_label = label.clone();
        let failed_preview_label = preview_label.clone();
        let spawn = std::thread::Builder::new()
            .name("reader-tab-detach".into())
            .spawn(move || {
                let mut document = document;
                let started = Instant::now();
                let mut visible = false;
                let mut preview_failed = false;
                let mut previous_position = None;
                let mut handover = false;
                loop {
                    if monitor_flag.load(Ordering::Acquire)
                        || started.elapsed() > Duration::from_secs(120)
                        || unsafe { GetAsyncKeyState(i32::from(VK_ESCAPE)) } < 0
                        || monitor_app.get_webview_window("main").is_none()
                    {
                        break;
                    }
                    let mut cursor = POINT { x: 0, y: 0 };
                    // SAFETY: GetCursorPos writes one valid POINT to the supplied pointer.
                    let cursor_valid = unsafe { GetCursorPos(&mut cursor) } != 0;
                    if !cursor_valid {
                        break;
                    }
                    // SAFETY: GetAsyncKeyState only reads the current left-button state.
                    let button_down = unsafe { GetAsyncKeyState(i32::from(VK_LBUTTON)) } < 0;
                    let left = i64::from(origin.x);
                    let top = i64::from(origin.y);
                    let right = left + i64::from(size.width);
                    let bottom = top + i64::from(size.height);
                    let outside = i64::from(cursor.x) < left
                        || i64::from(cursor.x) >= right
                        || i64::from(cursor.y) < top
                        || i64::from(cursor.y) >= bottom;
                    if let Some(preview_window) = &preview_window {
                        let state = monitor_app.state::<ReaderState>();
                        let previews = state.previews.lock().unwrap();
                        if !previews.get(&preview_label).is_some_and(|(_, flag)| Arc::ptr_eq(flag, &ready)) {
                            break;
                        }
                        drop(previews);
                        if !ready.load(Ordering::Acquire) && !preview_failed
                            && started.elapsed() > Duration::from_millis(750) {
                            preview_failed = true;
                            log::warn!("[reader] Drag preview did not become ready; restoring the in-window preview");
                            let _ = monitor_app.emit_to("main", "reader:native-preview-failed", &token);
                        }
                        // Keep the grabbed point fixed; the 24px inset leaves room for the shadow.
                        let position = (
                            (f64::from(cursor.x) - offset_x - 24.0 * scale).round() as i32,
                            (f64::from(cursor.y) - offset_y - 24.0 * scale).round() as i32,
                        );
                        if previous_position != Some(position) {
                            if let Some(hwnd) = preview_hwnd {
                                // SAFETY: the monitor owns this live window until the loop ends.
                                // Moving the HWND directly avoids a queued WebView/main-thread hop.
                                unsafe {
                                    SetWindowPos(
                                        hwnd,
                                        0,
                                        position.0,
                                        position.1,
                                        0,
                                        0,
                                        SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
                                    );
                                }
                            }
                            previous_position = Some(position);
                        }
                        let should_show = (button_down || outside) && !preview_failed && ready.load(Ordering::Acquire);
                        if should_show != visible {
                            if should_show {
                                if let Err(error) = preview_window.show() {
                                    preview_failed = true;
                                    log::error!("[reader] Could not show drag preview: {error}");
                                    let _ = monitor_app.emit_to("main", "reader:native-preview-failed", &token);
                                }
                            } else {
                                let _ = preview_window.hide();
                            }
                            visible = should_show && !preview_failed;
                        }
                    }
                    if !button_down {
                        if outside {
                            if visible {
                                if let Some((preview, _)) = monitor_app.state::<ReaderState>().previews.lock().unwrap().get(&preview_label) {
                                    document.opening = Some(ReaderOpening {
                                        x: f64::from(cursor.x) / scale - preview.offset_x,
                                        y: f64::from(cursor.y) / scale - preview.offset_y,
                                        preview: preview.clone(),
                                    });
                                }
                            }
                            let has_opening = document.opening.is_some();
                            let drop = ReaderDetachDrop {
                                document,
                                x: f64::from(cursor.x) / scale,
                                y: f64::from(cursor.y) / scale,
                            };
                            match monitor_app.emit_to("main", "reader:tab-detach-drop", drop) {
                                Ok(()) => handover = has_opening,
                                Err(error) => log::error!("[reader] Could not deliver detached tab: {error}"),
                            }
                        }
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(8));
                }

                let state = monitor_app.state::<ReaderState>();
                let hide_preview = {
                    let mut previews = state.previews.lock().unwrap();
                    if !handover && previews.get(&preview_label).is_some_and(|(_, flag)| Arc::ptr_eq(flag, &ready)) {
                        previews.remove(&preview_label);
                        true
                    } else { false }
                };
                if hide_preview {
                    if let Some(preview_window) = preview_window { let _ = preview_window.hide(); }
                }
                if !handover { discard_prepared_reader(&monitor_app, &token); }
                let _ = monitor_app.emit_to("main", "reader:native-drag-end", &token);
                let mut watchers = state.detach_watchers.lock().unwrap();
                if watchers
                    .get(&cleanup_label)
                    .is_some_and(|watcher| Arc::ptr_eq(watcher, &monitor_flag))
                {
                    watchers.remove(&cleanup_label);
                }
                drop(watchers);
                if handover {
                    // A failed or stalled reader must not leave an orphaned preview.
                    std::thread::sleep(Duration::from_secs(10));
                    close_preview_for_token(&monitor_app, &token);
                }
            });
        if let Err(error) = spawn {
            cancelled.store(true, Ordering::Release);
            app.state::<ReaderState>()
                .detach_watchers
                .lock()
                .unwrap()
                .remove(&label);
            // The closure is dropped on spawn failure; hide the cached preview by label.
            if let Some(preview) = app.get_webview_window(&failed_preview_label) {
                let _ = preview.hide();
            }
            app.state::<ReaderState>()
                .previews
                .lock()
                .unwrap()
                .remove(&failed_preview_label);
            return Err(error.to_string());
        }
        if let Some(preview) = warm_preview {
            let warm_app = app.clone();
            let warm_flag = Arc::clone(&cancelled);
            tauri::async_runtime::spawn(async move {
                if warm_flag.load(Ordering::Acquire) {
                    return;
                }
                let mut document = warm_document;
                document.prerender = true;
                document.opening = Some(ReaderOpening {
                    x: f64::from(origin.x) / scale,
                    y: f64::from(origin.y) / scale,
                    preview: preview.clone(),
                });
                match acquire_reader(&warm_app, document, None, None) {
                    Ok(label) => {
                        // Watcher may have finished while the hidden WebView was being created.
                        let state = warm_app.state::<ReaderState>();
                        let watchers = state.detach_watchers.lock().unwrap();
                        let active = watchers
                            .get("main")
                            .is_some_and(|flag| Arc::ptr_eq(flag, &warm_flag))
                            && !warm_flag.load(Ordering::Acquire);
                        if active {
                            state
                                .prepared_readers
                                .lock()
                                .unwrap()
                                .insert(preview.token, label);
                        } else {
                            drop(watchers);
                            if let Some(window) = warm_app.get_webview_window(&label) {
                                let _ = window.close();
                            }
                        }
                    }
                    Err(error) => {
                        log::warn!("[reader] Could not pre-render dragged document: {error}")
                    }
                }
            });
        }
    }

    #[cfg(not(windows))]
    {
        let _ = (app, document, preview);
    }

    Ok(())
}

#[tauri::command]
pub fn drag_preview_bootstrap(app: AppHandle, window: WebviewWindow) -> Option<DragPreview> {
    app.state::<ReaderState>()
        .previews
        .lock()
        .unwrap()
        .get(window.label())
        .map(|(preview, _)| preview.clone())
}

#[tauri::command]
pub fn drag_preview_ready(app: AppHandle, window: WebviewWindow, token: String) {
    if let Some((preview, ready)) = app
        .state::<ReaderState>()
        .previews
        .lock()
        .unwrap()
        .get(window.label())
    {
        if preview.token == token {
            ready.store(true, Ordering::Release);
        }
    }
}

#[tauri::command]
pub fn cancel_reader_tab_detach_watch(app: AppHandle, window: WebviewWindow) {
    if let Some(watcher) = app
        .state::<ReaderState>()
        .detach_watchers
        .lock()
        .unwrap()
        .get(window.label())
    {
        watcher.store(true, Ordering::Release);
    }
}

#[tauri::command]
pub fn close_drag_preview(app: AppHandle, token: String) {
    close_preview_for_token(&app, &token);
}

fn close_preview_for_token(app: &AppHandle, token: &str) {
    let state = app.state::<ReaderState>();
    let hide_preview = {
        let mut previews = state.previews.lock().unwrap();
        if previews
            .get("drag-preview")
            .is_some_and(|(preview, _)| preview.token == token)
        {
            previews.remove("drag-preview");
            true
        } else {
            false
        }
    };
    if hide_preview {
        if let Some(window) = app.get_webview_window("drag-preview") {
            let _ = window.hide();
        }
    }
    discard_prepared_reader(app, token);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderExpansion {
    offset_x: f64,
    offset_y: f64,
    activated: bool,
}

#[tauri::command]
pub fn reader_present(app: AppHandle, window: WebviewWindow, focus: bool) -> Result<(), String> {
    window.show().map_err(|error| error.to_string())?;
    if focus {
        if let Some(document) = app
            .state::<ReaderState>()
            .documents
            .lock()
            .unwrap()
            .get_mut(window.label())
        {
            document.opening = None;
            document.prerender = false;
        }
        window.set_focus().map_err(|error| error.to_string())?;
        #[cfg(windows)]
        {
            let warm_app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Some(main) = warm_app.get_webview_window("main") {
                    if let Err(error) = ensure_idle_reader(&warm_app, &main) {
                        log::warn!("[reader] Could not replenish warm reader: {error}");
                    }
                }
            });
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn reader_ready(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Option<ReaderExpansion>, String> {
    if app
        .state::<ReaderState>()
        .documents
        .lock()
        .unwrap()
        .get(window.label())
        .is_some_and(|document| document.prerender)
    {
        return Ok(Some(ReaderExpansion {
            offset_x: 0.0,
            offset_y: 0.0,
            activated: false,
        }));
    }
    let opening = app
        .state::<ReaderState>()
        .documents
        .lock()
        .unwrap()
        .get_mut(window.label())
        .and_then(|document| document.opening.clone());
    #[cfg(windows)]
    if let Some(opening) = opening {
        return tauri::async_runtime::spawn_blocking(move || {
            use windows_sys::Win32::UI::WindowsAndMessaging::{
                SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER,
            };
            let scale = window.scale_factor().map_err(|error| error.to_string())?;
            let start = [
                opening.x * scale,
                opening.y * scale,
                opening.preview.width.max(32.0) * scale,
                opening.preview.height.max(20.0) * scale,
            ];
            let mut end = [start[0], start[1], 900.0 * scale, 720.0 * scale];
            if let Some(monitor) = window
                .current_monitor()
                .map_err(|error| error.to_string())?
            {
                end[2] = end[2].min(f64::from(monitor.size().width));
                end[3] = end[3].min(f64::from(monitor.size().height));
                // 展开锚点就是松手时卡片的左上角，不为容纳整窗而二次平移。
            }
            let hwnd = window.hwnd().map_err(|error| error.to_string())?.0 as isize;
            // Resize once while hidden; WebView reveals a fixed-size surface.
            // SAFETY: this reader owns the live HWND.
            if unsafe {
                SetWindowPos(
                    hwnd,
                    0,
                    end[0].round() as i32,
                    end[1].round() as i32,
                    end[2].round() as i32,
                    end[3].round() as i32,
                    SWP_NOACTIVATE | SWP_NOZORDER,
                )
            } == 0
            {
                return Err(std::io::Error::last_os_error().to_string());
            }
            window
                .set_min_size(Some(tauri::LogicalSize::new(360.0, 240.0)))
                .map_err(|error| error.to_string())?;
            Ok(Some(ReaderExpansion {
                offset_x: (start[0] - end[0]) / scale,
                offset_y: (start[1] - end[1]) / scale,
                activated: true,
            }))
        })
        .await
        .map_err(|error| error.to_string())?;
    }
    #[cfg(not(windows))]
    let _ = opening;
    // 这里只准备布局，正文渲染完成后由 reader_present 显示窗口。
    Ok(None)
}

fn ensure_main(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(main) = app.get_webview_window("main") {
        return Ok(main);
    }
    let main = tauri::WebviewWindowBuilder::new(
        app,
        "main",
        WebviewUrl::App("index.html?editor=1".into()),
    )
    .title("MokiDown")
    .inner_size(1200.0, 800.0)
    .min_inner_size(800.0, 600.0)
    .decorations(false)
    .shadow(false)
    .build()
    .map_err(|e| e.to_string())?;
    #[cfg(windows)]
    crate::style_window_frame(&main);
    Ok(main)
}

pub fn open_in_editor(app: &AppHandle, document: ReaderDocument) -> Result<(), String> {
    let existing = app.get_webview_window("main").is_some();
    let main_is_reader = *app.state::<ReaderState>().main_is_reader.lock().unwrap();
    app.state::<ReaderState>()
        .handover
        .lock()
        .unwrap()
        .push(document);
    if main_is_reader || !existing {
        *app.state::<ReaderState>().main_is_reader.lock().unwrap() = false;
        let main = ensure_main(app)?;
        if existing {
            let mut url = main.url().map_err(|e| e.to_string())?;
            url.set_query(Some("editor=1"));
            main.navigate(url).map_err(|e| e.to_string())?;
        }
    } else {
        ensure_main(app)?
            .emit("reader:open-in-editor", ())
            .map_err(|e| e.to_string())?;
    }
    let main = ensure_main(app)?;
    main.show().map_err(|e| e.to_string())?;
    main.unminimize().map_err(|e| e.to_string())?;
    main.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reader_return_to_editor(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    let document = app
        .state::<ReaderState>()
        .documents
        .lock()
        .unwrap()
        .get(window.label())
        .cloned()
        .ok_or_else(|| "Reader document not found".to_string())?;
    open_in_editor(&app, document)?;
    if window.label() != "main" {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn reader_editor_handover(app: AppHandle, window: WebviewWindow) -> Vec<ReaderDocument> {
    if window.label() != "main" {
        return Vec::new();
    }
    std::mem::take(&mut *app.state::<ReaderState>().handover.lock().unwrap())
}

pub fn forget_window(app: &AppHandle, label: &str) {
    app.state::<ReaderState>()
        .documents
        .lock()
        .unwrap()
        .remove(label);
    if label == "main" {
        *app.state::<ReaderState>().main_is_reader.lock().unwrap() = false;
        if let Some(watcher) = app
            .state::<ReaderState>()
            .detach_watchers
            .lock()
            .unwrap()
            .get(label)
        {
            watcher.store(true, Ordering::Release);
        }
        if let Some(preview) = app.get_webview_window("drag-preview") {
            let _ = preview.close();
        }
        let prepared =
            std::mem::take(&mut *app.state::<ReaderState>().prepared_readers.lock().unwrap());
        for (_, label) in prepared {
            if let Some(window) = app.get_webview_window(&label) {
                let _ = window.close();
            }
        }
        let idle = app
            .state::<ReaderState>()
            .idle_reader
            .lock()
            .unwrap()
            .take();
        if let Some(label) = idle {
            if let Some(window) = app.get_webview_window(&label) {
                let _ = window.close();
            }
        }
    }
}

pub fn route_associated_paths(app: &AppHandle, paths: Vec<String>) {
    if crate::startup::is_starting(app) {
        return;
    }
    if associated_reader_mode(app) {
        for path in paths {
            if let Err(error) = create_reader(app, from_path(path), None, None) {
                log::error!("[reader] Could not open associated document: {error}");
            }
        }
    } else {
        for path in paths {
            if let Err(error) = open_in_editor(app, from_path(path)) {
                log::error!("[reader] Could not open in editor: {error}");
            }
        }
    }
}

#[cfg(test)]
mod reader_lock_tests {
    use super::*;

    #[test]
    fn concurrent_window_warmup_does_not_wait_on_the_builder() {
        let state = ReaderState::default();
        let permit = ReaderBuildPermit::acquire(&state.idle_building).unwrap();
        assert!(ReaderBuildPermit::acquire(&state.idle_building).is_none());
        // UI callbacks remain free to access the cache while a builder is pending.
        assert!(state.idle_reader.try_lock().is_ok());
        drop(permit);
        assert!(ReaderBuildPermit::acquire(&state.idle_building).is_some());
    }

    #[test]
    fn failed_window_creation_releases_the_build_reservation() {
        let building = AtomicBool::new(false);
        let failed = || -> Result<(), ()> {
            let _permit = ReaderBuildPermit::acquire(&building).unwrap();
            Err(())
        };
        assert!(failed().is_err());
        assert!(ReaderBuildPermit::acquire(&building).is_some());
    }
}
