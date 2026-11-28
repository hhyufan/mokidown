//! Hosts untrusted top-level pages in an independent WebView2 controller.
//! The controller shares the editor HWND, but is never registered with Tauri.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{cell::RefCell, collections::HashMap, sync::Arc};
#[cfg(not(debug_assertions))]
use tauri::Manager;
use tauri::{ipc::Channel, Webview};
use webview2_com::{
    take_pwstr, CallDevToolsProtocolMethodCompletedHandler, ContentLoadingEventHandler,
    CreateCoreWebView2ControllerCompletedHandler, CreateCoreWebView2EnvironmentCompletedHandler,
    DOMContentLoadedEventHandler, FaviconChangedEventHandler, Microsoft::Web::WebView2::Win32::*,
    NavigationCompletedEventHandler, NavigationStartingEventHandler,
    NewWindowRequestedEventHandler, PermissionRequestedEventHandler, SourceChangedEventHandler,
};
use windows::{
    core::{w, Interface, HSTRING, PCWSTR, PWSTR},
    Win32::{
        Foundation::{HWND, RECT},
        UI::WindowsAndMessaging::{
            CreateWindowExW, DestroyWindow, SetWindowPos, HWND_TOP, SWP_HIDEWINDOW, SWP_NOACTIVATE,
            SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SWP_SHOWWINDOW, WINDOW_EX_STYLE, WS_CHILD,
            WS_CLIPCHILDREN, WS_CLIPSIBLINGS,
        },
    },
};

struct PreviewPane(HWND);

impl PreviewPane {
    fn new(parent: HWND) -> windows::core::Result<Self> {
        unsafe {
            CreateWindowExW(
                WINDOW_EX_STYLE(0),
                w!("STATIC"),
                PCWSTR::null(),
                WS_CHILD | WS_CLIPCHILDREN | WS_CLIPSIBLINGS,
                0,
                0,
                0,
                0,
                Some(parent),
                None,
                None,
                None,
            )
            .map(Self)
        }
    }
}

impl Drop for PreviewPane {
    fn drop(&mut self) {
        unsafe {
            let _ = DestroyWindow(self.0);
        }
    }
}

#[derive(Clone, Copy, Deserialize, PartialEq, Serialize)]
pub(crate) struct WallpaperPlacement {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClientBounds {
    width: i32,
    height: i32,
    fills_bottom: bool,
}

#[derive(Clone, Copy, Deserialize)]
pub(crate) struct Bounds {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    visible: bool,
    wallpaper: Option<WallpaperPlacement>,
    client: Option<ClientBounds>,
}

#[derive(Clone, Copy, Default, Deserialize, PartialEq)]
pub(crate) struct Appearance {
    enabled: bool,
    light: f64,
    dark: f64,
}

impl Appearance {
    fn apply_background(self, controller: &ICoreWebView2Controller) -> windows::core::Result<()> {
        let color = COREWEBVIEW2_COLOR {
            A: if self.enabled { 0 } else { 255 },
            R: 255,
            G: 255,
            B: 255,
        };
        unsafe {
            controller
                .cast::<ICoreWebView2Controller2>()?
                .SetDefaultBackgroundColor(color)
        }
    }
}

impl Bounds {
    fn fit_client(self, size: tauri::PhysicalSize<u32>) -> Self {
        let Some(client) = self.client else {
            return self;
        };
        let fills_right =
            (i64::from(client.width) - i64::from(self.x) - i64::from(self.width)).abs() <= 2;
        Self {
            width: if fills_right {
                self.width
                    .saturating_add((size.width as i32).saturating_sub(client.width))
                    .max(0)
            } else {
                self.width
            },
            height: if client.fills_bottom {
                self.height
                    .saturating_add((size.height as i32).saturating_sub(client.height))
                    .max(0)
            } else {
                self.height
            },
            ..self
        }
    }

    fn is_visible(self) -> bool {
        self.visible && self.width > 0 && self.height > 0
    }

    fn apply(
        self,
        pane: HWND,
        controller: &ICoreWebView2Controller,
        previous: Option<Self>,
    ) -> windows::core::Result<()> {
        let moved = previous.is_none_or(|old| (old.x, old.y) != (self.x, self.y));
        let resized =
            previous.is_none_or(|old| (old.width, old.height) != (self.width, self.height));
        let visible = self.is_visible();
        let visibility_changed = previous.is_none_or(|old| old.is_visible() != visible);
        unsafe {
            if !visible && visibility_changed {
                controller.SetIsVisible(false)?;
            }
            if resized && self.width > 0 && self.height > 0 {
                controller.SetBounds(RECT {
                    left: 0,
                    top: 0,
                    right: self.width,
                    bottom: self.height,
                })?;
            }
            if moved || resized || visibility_changed {
                // Raise newly shown previews once. Ordinary resize messages keep their z-order
                // and do not resend a show notification to the window.
                let (insert, flags) = match (visibility_changed, visible) {
                    (true, true) => (Some(HWND_TOP), SWP_SHOWWINDOW),
                    (true, false) => (None, SWP_NOZORDER | SWP_HIDEWINDOW),
                    (false, _) => (None, SWP_NOZORDER),
                };
                SetWindowPos(
                    pane,
                    insert,
                    self.x,
                    self.y,
                    self.width.max(0),
                    self.height.max(0),
                    SWP_NOACTIVATE | flags,
                )?;
            }
            if visible && visibility_changed {
                controller.SetIsVisible(true)?;
            }
            if moved {
                controller.NotifyParentWindowPositionChanged()?;
            }
            Ok(())
        }
    }
}

#[derive(Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum PreviewEvent {
    Page {
        url: String,
        icons: Vec<String>,
        revision: u64,
    },
    ContentReady {
        navigation_id: u64,
        revision: u64,
    },
    Navigation {
        success: bool,
        status: i32,
        code: i32,
        navigation_id: u64,
        revision: u64,
    },
    Popup {
        url: String,
    },
    Error {
        message: String,
    },
}

struct Session {
    pane: PreviewPane,
    url: String,
    revision: u64,
    bounds: Bounds,
    applied_bounds: Option<Bounds>,
    activation: u64,
    appearance: Appearance,
    wallpaper: Option<Arc<str>>,
    navigation_id: u64,
    navigation_revision: u64,
    document_ready: bool,
    script_context: Option<i64>,
    events: Channel<PreviewEvent>,
    controller: Option<ICoreWebView2Controller>,
}

impl Session {
    fn accept_activation(&mut self, activation: u64) -> bool {
        if activation < self.activation {
            return false;
        }
        self.activation = activation;
        true
    }
}

#[derive(Default)]
struct Host {
    environment: Option<ICoreWebView2Environment>,
    initializing: bool,
    sessions: HashMap<String, Session>,
    client_size: Option<tauri::PhysicalSize<u32>>,
}

thread_local! { static HOST: RefCell<Host> = RefCell::new(Host::default()); }

fn devtools(
    view: &ICoreWebView2,
    method: &str,
    arguments: Value,
    finished: impl FnOnce(Option<Value>) + 'static,
) -> windows::core::Result<()> {
    unsafe {
        view.CallDevToolsProtocolMethod(
            &HSTRING::from(method),
            &HSTRING::from(arguments.to_string()),
            &CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |result, value| {
                finished(result.ok().and_then(|()| serde_json::from_str(&value).ok()));
                Ok(())
            })),
        )
    }
}

fn update_appearance(
    id: &str,
    send_image: bool,
    install_bridge: bool,
) -> windows::core::Result<()> {
    let state = HOST.with(|host| {
        let host = host.borrow();
        let session = host.sessions.get(id)?;
        Some((
            session.controller.clone()?,
            session.script_context?,
            session.appearance,
            session.bounds.wallpaper,
            session.wallpaper.clone(),
        ))
    });
    let Some((controller, context, appearance, placement, wallpaper)) = state else {
        return Ok(());
    };
    let settings = json!({ "enabled": appearance.enabled,
        "light": appearance.light.clamp(0.0, 100.0), "dark": appearance.dark.clamp(0.0, 100.0) });
    let placement = json!(placement);
    let image = if send_image {
        json!(wallpaper.as_deref()).to_string()
    } else {
        "undefined".into()
    };
    let bridge = if install_bridge {
        include_str!("../../src/utils/previewFrameBridge.js")
    } else {
        ""
    };
    // A closed shadow tree is created from an isolated world. The page never receives
    // the wallpaper bytes through its own script context, styles, or network.
    let expression = format!("window.__mokiNativePreview = true;\n{bridge}\nwindow.__mokiSetNativePreview?.({settings}, {placement}, {image})");
    let view = unsafe { controller.CoreWebView2()? };
    devtools(
        &view,
        "Runtime.evaluate",
        json!({
            "contextId": context, "expression": expression, "awaitPromise": true, "returnByValue": true,
        }),
        move |result| {
            if result.is_none_or(|result| result.get("exceptionDetails").is_some()) {
                log::debug!("Could not apply the native web preview appearance");
            }
        },
    )
}

fn current_revision(id: &str, navigation_id: u64) -> Option<u64> {
    HOST.with(|host| {
        host.borrow()
            .sessions
            .get(id)
            .filter(|view| {
                view.navigation_id == navigation_id && view.navigation_revision == view.revision
            })
            .map(|view| view.revision)
    })
}

fn content_ready(id: &str, navigation_id: u64) {
    if let Some(revision) = current_revision(id, navigation_id) {
        send(
            id,
            PreviewEvent::ContentReady {
                navigation_id,
                revision,
            },
        );
    }
}

fn prepare_appearance(
    view: &ICoreWebView2,
    id: &str,
    navigation_id: u64,
) -> windows::core::Result<()> {
    let guest = view.clone();
    let session = id.to_owned();
    devtools(view, "Page.getFrameTree", json!({}), move |result| {
        if current_revision(&session, navigation_id).is_none() {
            return;
        }
        let Some(result) = result else {
            return;
        };
        let Some(frame_id) = result["frameTree"]["frame"]["id"].as_str() else {
            return;
        };
        let target = session.clone();
        let _ = devtools(
            &guest,
            "Page.createIsolatedWorld",
            json!({
                "frameId": frame_id, "worldName": "MokiDown preview appearance",
            }),
            move |result| {
                let context = result.and_then(|result| result["executionContextId"].as_i64());
                let installed = HOST.with(|host| {
                    let mut host = host.borrow_mut();
                    let Some(view) = host.sessions.get_mut(&target).filter(|view| {
                        view.navigation_id == navigation_id
                            && view.navigation_revision == view.revision
                    }) else {
                        return false;
                    };
                    view.script_context = context;
                    context.is_some()
                });
                if installed {
                    let _ = update_appearance(&target, true, true);
                }
            },
        );
    })
}

fn web_url(value: &str) -> Option<reqwest::Url> {
    let url = reqwest::Url::parse(value).ok()?;
    (matches!(url.scheme(), "http" | "https") && url.host().is_some()).then_some(url)
}

fn editor_only(webview: &Webview) -> Result<(), String> {
    if webview.label() == "main" && webview.window().label() == "main" {
        Ok(())
    } else {
        Err("Only the editor can manage web previews".into())
    }
}

fn send(id: &str, event: PreviewEvent) {
    let channel = HOST.with(|host| {
        host.borrow()
            .sessions
            .get(id)
            .map(|view| view.events.clone())
    });
    if let Some(channel) = channel {
        let _ = channel.send(event);
    }
}

fn close(id: &str) {
    let session = HOST.with(|host| host.borrow_mut().sessions.remove(id));
    if let Some(controller) = session
        .as_ref()
        .and_then(|session| session.controller.as_ref())
    {
        unsafe {
            let _ = controller.Close();
        }
    }
}

fn fail(id: &str, message: impl ToString) {
    send(
        id,
        PreviewEvent::Error {
            message: message.to_string(),
        },
    );
    close(id);
}

unsafe fn publish_page(
    id: &str,
    view: &ICoreWebView2,
    same_document: bool,
) -> windows::core::Result<()> {
    let mut source = PWSTR::null();
    view.Source(&mut source)?;
    let Some(url) = web_url(&take_pwstr(source)) else {
        return Ok(());
    };
    let Some((revision, navigation_id, resumed)) = HOST.with(|host| {
        let mut host = host.borrow_mut();
        let session = host.sessions.get_mut(id)?;
        let resumed = session.navigation_revision != session.revision;
        if resumed {
            // A fragment change doesn't fire NavigationStarting or ContentLoading.
            if !same_document || session.url != url.as_str() {
                return None;
            }
            session.navigation_revision = session.revision;
        }
        Some((session.revision, session.navigation_id, resumed))
    }) else {
        return Ok(());
    };
    let mut icons = Vec::new();
    if let Ok(favicons) = view.cast::<ICoreWebView2_15>() {
        let mut icon = PWSTR::null();
        if favicons.FaviconUri(&mut icon).is_ok() {
            let icon = take_pwstr(icon);
            if web_url(&icon).is_some() {
                icons.push(icon);
            }
        }
    }
    send(
        id,
        PreviewEvent::Page {
            url: url.into(),
            icons,
            revision,
        },
    );
    if resumed {
        content_ready(id, navigation_id);
    }
    Ok(())
}

unsafe fn configure(
    id: &str,
    controller: &ICoreWebView2Controller,
) -> windows::core::Result<ICoreWebView2> {
    controller.SetIsVisible(false)?;
    let view = controller.CoreWebView2()?;
    let settings = view.Settings()?;
    settings.SetIsWebMessageEnabled(false)?;
    settings.SetAreHostObjectsAllowed(false)?;
    settings.SetAreDevToolsEnabled(false)?;
    settings.SetIsStatusBarEnabled(false)?;

    let mut token = 0;
    let session = id.to_owned();
    view.add_NavigationStarting(
        &NavigationStartingEventHandler::create(Box::new(move |_, args| {
            if let Some(args) = args {
                let mut uri = PWSTR::null();
                args.Uri(&mut uri)?;
                if web_url(&take_pwstr(uri)).is_none() {
                    args.SetCancel(true)?;
                } else {
                    let mut navigation_id = 0;
                    args.NavigationId(&mut navigation_id)?;
                    HOST.with(|host| {
                        if let Some(view) = host.borrow_mut().sessions.get_mut(&session) {
                            if view.navigation_id != navigation_id {
                                view.script_context = None;
                                view.document_ready = false;
                            }
                            view.navigation_id = navigation_id;
                            view.navigation_revision = view.revision;
                        }
                    });
                }
            }
            Ok(())
        })),
        &mut token,
    )?;
    view.add_PermissionRequested(
        &PermissionRequestedEventHandler::create(Box::new(move |_, args| {
            if let Some(args) = args {
                args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)?;
            }
            Ok(())
        })),
        &mut token,
    )?;

    let session = id.to_owned();
    view.add_NewWindowRequested(
        &NewWindowRequestedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else {
                return Ok(());
            };
            args.SetHandled(true)?;
            let mut initiated = Default::default();
            args.IsUserInitiated(&mut initiated)?;
            if initiated.as_bool() {
                let mut uri = PWSTR::null();
                args.Uri(&mut uri)?;
                if let Some(url) = web_url(&take_pwstr(uri)) {
                    send(&session, PreviewEvent::Popup { url: url.into() });
                }
            }
            Ok(())
        })),
        &mut token,
    )?;

    let session = id.to_owned();
    view.add_SourceChanged(
        &SourceChangedEventHandler::create(Box::new(move |view, args| {
            if let Some(view) = view {
                let mut new_document = Default::default();
                if let Some(args) = args {
                    args.IsNewDocument(&mut new_document)?;
                }
                publish_page(&session, &view, !new_document.as_bool())?;
            }
            Ok(())
        })),
        &mut token,
    )?;

    let session = id.to_owned();
    // Let Chromium paint the new document while it is still parsing the DOM.
    view.add_ContentLoading(
        &ContentLoadingEventHandler::create(Box::new(move |_, args| {
            if let Some(args) = args {
                let mut error_page = Default::default();
                args.IsErrorPage(&mut error_page)?;
                if !error_page.as_bool() {
                    let mut navigation_id = 0;
                    args.NavigationId(&mut navigation_id)?;
                    content_ready(&session, navigation_id);
                }
            }
            Ok(())
        })),
        &mut token,
    )?;

    let session = id.to_owned();
    view.cast::<ICoreWebView2_2>()?.add_DOMContentLoaded(
        &DOMContentLoadedEventHandler::create(Box::new(move |view, args| {
            let mut navigation_id = 0;
            if let Some(args) = args {
                args.NavigationId(&mut navigation_id)?;
            }
            let wallpaper_enabled = HOST.with(|host| {
                let mut host = host.borrow_mut();
                let Some(current) = host.sessions.get_mut(&session).filter(|current| {
                    current.navigation_id == navigation_id
                        && current.navigation_revision == current.revision
                }) else {
                    return false;
                };
                current.document_ready = true;
                current.appearance.enabled
            });
            if let Some(view) = view.filter(|_| wallpaper_enabled) {
                let _ = prepare_appearance(&view, &session, navigation_id);
            }
            Ok(())
        })),
        &mut token,
    )?;

    let session = id.to_owned();
    view.add_NavigationCompleted(
        &NavigationCompletedEventHandler::create(Box::new(move |view, args| {
            let Some(args) = args else {
                return Ok(());
            };
            let mut success = Default::default();
            let mut code = COREWEBVIEW2_WEB_ERROR_STATUS::default();
            let mut status = 0;
            let mut navigation_id = 0;
            args.IsSuccess(&mut success)?;
            args.NavigationId(&mut navigation_id)?;
            args.WebErrorStatus(&mut code)?;
            if let Ok(http) = args.cast::<ICoreWebView2NavigationCompletedEventArgs2>() {
                let _ = http.HttpStatusCode(&mut status);
            }
            let Some(revision) = current_revision(&session, navigation_id) else {
                return Ok(());
            };
            if code != COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED {
                send(
                    &session,
                    PreviewEvent::Navigation {
                        success: success.as_bool() && status < 400,
                        status,
                        code: code.0,
                        navigation_id,
                        revision,
                    },
                );
            }
            if let Some(view) = view {
                publish_page(&session, &view, false)?;
            }
            Ok(())
        })),
        &mut token,
    )?;

    if let Ok(favicons) = view.cast::<ICoreWebView2_15>() {
        let session = id.to_owned();
        favicons.add_FaviconChanged(
            &FaviconChangedEventHandler::create(Box::new(move |view, _| {
                if let Some(view) = view {
                    publish_page(&session, &view, false)?;
                }
                Ok(())
            })),
            &mut token,
        )?;
    }
    Ok(view)
}

fn create_controller(environment: &ICoreWebView2Environment, id: String) {
    let Some(parent) = HOST.with(|host| {
        host.borrow()
            .sessions
            .get(&id)
            .map(|session| session.pane.0)
    }) else {
        return;
    };
    let callback_id = id.clone();
    let callback = CreateCoreWebView2ControllerCompletedHandler::create(Box::new(
        move |result, controller| {
            let id = &callback_id;
            let Some(controller) = controller else {
                fail(
                    id,
                    result.err().map_or_else(
                        || "WebView2 controller unavailable".into(),
                        |error| error.to_string(),
                    ),
                );
                return Ok(());
            };
            let opening = HOST.with(|host| {
                let mut host = host.borrow_mut();
                let session = host.sessions.get_mut(id)?;
                session.controller = Some(controller.clone());
                session.applied_bounds = Some(session.bounds);
                Some((session.url.clone(), session.bounds, session.appearance))
            });
            let Some((url, bounds, appearance)) = opening else {
                unsafe {
                    let _ = controller.Close();
                }
                return Ok(());
            };
            let opened = unsafe {
                configure(id, &controller).and_then(|web| {
                    web.Navigate(&HSTRING::from(url))?;
                    appearance.apply_background(&controller)?;
                    bounds.apply(parent, &controller, None)
                })
            };
            if let Err(error) = opened {
                fail(id, error);
            }
            Ok(())
        },
    ));
    if let Err(error) = unsafe { environment.CreateCoreWebView2Controller(parent, &callback) } {
        fail(&id, error);
    }
}

fn environment_ready(result: Result<ICoreWebView2Environment, String>) {
    let ids = HOST.with(|host| {
        let mut host = host.borrow_mut();
        host.initializing = false;
        host.environment = result.as_ref().ok().cloned();
        host.sessions.keys().cloned().collect::<Vec<_>>()
    });
    for id in ids {
        match &result {
            Ok(environment) => create_controller(environment, id),
            Err(error) => fail(&id, error),
        }
    }
}

fn start(id: String, session: Session, profile: std::path::PathBuf) {
    let (environment, create) = HOST.with(|host| {
        let mut host = host.borrow_mut();
        if host.sessions.contains_key(&id) {
            return (None, false);
        }
        host.sessions.insert(id.clone(), session);
        let create = host.environment.is_none() && !host.initializing;
        host.initializing |= create;
        (host.environment.clone(), create)
    });
    if let Some(environment) = environment {
        create_controller(&environment, id);
    } else if create {
        let callback = CreateCoreWebView2EnvironmentCompletedHandler::create(Box::new(
            |result, environment| {
                environment_ready(result.map_err(|error| error.to_string()).and_then(|_| {
                    environment.ok_or_else(|| "WebView2 environment unavailable".into())
                }));
                Ok(())
            },
        ));
        let path = HSTRING::from(profile.as_os_str());
        let options: ICoreWebView2EnvironmentOptions = {
            let opts = webview2_com::CoreWebView2EnvironmentOptions::default();
            unsafe {
                opts.set_additional_browser_arguments(
                    crate::webview_defaults::WINDOWS_BROWSER_ARGS.to_string(),
                );
            }
            opts.into()
        };
        let result = unsafe {
            CreateCoreWebView2EnvironmentWithOptions(PCWSTR::null(), &path, &options, &callback)
        };
        if let Err(error) = result {
            environment_ready(Err(error.to_string()));
        }
    }
}

#[tauri::command]
pub async fn native_web_preview_open(
    webview: Webview,
    id: String,
    url: String,
    revision: u64,
    bounds: Bounds,
    appearance: Option<Appearance>,
    events: Channel<PreviewEvent>,
) -> Result<(), String> {
    editor_only(&webview)?;
    if id.len() != 36
        || !id
            .bytes()
            .all(|value| value.is_ascii_hexdigit() || value == b'-')
    {
        return Err("Invalid web preview id".into());
    }
    let url = web_url(&url).ok_or("Only HTTP and HTTPS previews are supported")?;
    #[cfg(debug_assertions)]
    let profile = crate::webview_defaults::development_profile("preview");
    #[cfg(not(debug_assertions))]
    let profile = webview
        .app_handle()
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("web-preview-profile");
    webview
        .with_webview(move |editor| {
            let pane = unsafe {
                let mut parent = HWND::default();
                editor
                    .controller()
                    .ParentWindow(&mut parent)
                    .and_then(|()| PreviewPane::new(parent))
            };
            match pane {
                Ok(pane) => start(
                    id,
                    Session {
                        pane,
                        url: url.into(),
                        revision,
                        bounds,
                        applied_bounds: None,
                        activation: 0,
                        appearance: appearance.unwrap_or_default(),
                        wallpaper: None,
                        navigation_id: 0,
                        navigation_revision: revision,
                        document_ready: false,
                        script_context: None,
                        events,
                        controller: None,
                    },
                    profile,
                ),
                Err(error) => {
                    let _ = events.send(PreviewEvent::Error {
                        message: error.to_string(),
                    });
                }
            }
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn native_web_preview_navigate(
    webview: Webview,
    id: String,
    url: String,
    revision: u64,
    reload: bool,
) -> Result<(), String> {
    editor_only(&webview)?;
    let url = web_url(&url).ok_or("Only HTTP and HTTPS previews are supported")?;
    webview
        .run_on_main_thread(move || {
            let controller = HOST.with(|host| {
                let mut host = host.borrow_mut();
                let session = host.sessions.get_mut(&id)?;
                if revision <= session.revision {
                    return None;
                }
                session.revision = revision;
                session.url = url.as_str().to_owned();
                session.controller.clone()
            });
            if let Some(controller) = controller {
                let result = unsafe {
                    controller.CoreWebView2().and_then(|view| {
                        if reload {
                            let mut current = PWSTR::null();
                            view.Source(&mut current)?;
                            if take_pwstr(current) == url.as_str() {
                                return view.Reload();
                            }
                        }
                        view.Navigate(&HSTRING::from(url.as_str()))
                    })
                };
                if let Err(error) = result {
                    fail(&id, error);
                }
            }
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn native_web_preview_layout(
    webview: Webview,
    id: String,
    bounds: Bounds,
    appearance: Option<Appearance>,
    activation: u64,
) -> Result<(), String> {
    editor_only(&webview)?;
    let (applied, mut completion) = tauri::async_runtime::channel(1);
    webview
        .run_on_main_thread(move || {
            let view = HOST.with(|host| {
                let mut host = host.borrow_mut();
                let fitted = host
                    .client_size
                    .map_or(bounds, |size| bounds.fit_client(size));
                let session = host.sessions.get_mut(&id)?;
                if !session.accept_activation(activation) {
                    return None;
                }
                let wallpaper_moved = session.bounds.wallpaper != bounds.wallpaper;
                session.bounds = bounds;
                let changed = appearance.filter(|next| session.appearance != *next);
                if let Some(value) = changed {
                    session.appearance = value;
                }
                Some((
                    session.pane.0,
                    session.controller.clone()?,
                    changed,
                    fitted,
                    session.applied_bounds.replace(fitted),
                    wallpaper_moved,
                ))
            });
            if let Some((pane, controller, changed, fitted, previous, wallpaper_moved)) = view {
                if let Some(value) = changed {
                    if let Err(error) = value.apply_background(&controller) {
                        log::warn!("Could not update web preview appearance: {error}");
                    }
                }
                if let Err(error) = fitted.apply(pane, &controller, previous) {
                    fail(&id, error);
                } else if changed.is_some() || wallpaper_moved {
                    let document = HOST.with(|host| {
                        let host = host.borrow();
                        let current = host.sessions.get(&id)?;
                        (current.document_ready
                            && current.appearance.enabled
                            && current.script_context.is_none()
                            && current.navigation_revision == current.revision
                            && changed.is_some())
                        .then_some(current.navigation_id)
                    });
                    if let Some(navigation_id) = document {
                        if let Ok(view) = unsafe { controller.CoreWebView2() } {
                            let _ = prepare_appearance(&view, &id, navigation_id);
                        }
                    } else {
                        let _ = update_appearance(&id, false, false);
                    }
                }
            }
            let _ = applied.try_send(());
        })
        .map_err(|error| error.to_string())?;
    completion
        .recv()
        .await
        .ok_or_else(|| "Preview layout was interrupted".into())
}

#[tauri::command]
pub fn native_web_preview_hide(
    webview: Webview,
    id: String,
    activation: u64,
) -> Result<(), String> {
    editor_only(&webview)?;
    webview
        .run_on_main_thread(move || hide(&id, activation))
        .map_err(|error| error.to_string())
}

fn hide(id: &str, activation: u64) {
    let view = HOST.with(|host| {
        let mut host = host.borrow_mut();
        let session = host.sessions.get_mut(id)?;
        if !session.accept_activation(activation) {
            return None;
        }
        session.bounds.visible = false;
        if let Some(bounds) = &mut session.applied_bounds {
            bounds.visible = false;
        }
        Some((session.pane.0, session.controller.clone()?))
    });
    if let Some((pane, controller)) = view {
        let result = unsafe {
            SetWindowPos(
                pane,
                None,
                0,
                0,
                0,
                0,
                SWP_HIDEWINDOW | SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOMOVE | SWP_NOSIZE,
            )
            .and_then(|()| controller.SetIsVisible(false))
        };
        if let Err(error) = result {
            fail(id, error);
        }
    }
}

#[tauri::command]
pub async fn native_web_preview_wallpaper(
    webview: Webview,
    id: String,
    image: Option<String>,
) -> Result<(), String> {
    editor_only(&webview)?;
    if image.as_ref().is_some_and(|data| {
        data.len() > 4 * 1024 * 1024
            || !data
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'='))
    }) {
        return Err("Invalid preview wallpaper data".into());
    }
    webview
        .run_on_main_thread(move || {
            let exists = HOST.with(|host| {
                let mut host = host.borrow_mut();
                let Some(view) = host.sessions.get_mut(&id) else {
                    return false;
                };
                view.wallpaper = image.map(Arc::from);
                true
            });
            if exists {
                let _ = update_appearance(&id, true, false);
            }
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn native_web_preview_close(webview: Webview, id: String) -> Result<(), String> {
    editor_only(&webview)?;
    webview
        .run_on_main_thread(move || close(&id))
        .map_err(|error| error.to_string())
}

pub(crate) fn resized(size: tauri::PhysicalSize<u32>) {
    if size.width == 0 || size.height == 0 {
        return;
    }
    // Win32 receives the new client size before the editor's webview lays out.
    // Fill the newly exposed edges while the exact DOM bounds are on their way.
    let views = HOST.with(|host| {
        let mut host = host.borrow_mut();
        host.client_size = Some(size);
        host.sessions
            .iter_mut()
            .filter_map(|(id, session)| {
                let previous = session.applied_bounds?;
                if !session.bounds.is_visible() {
                    return None;
                }
                let fitted = session.bounds.fit_client(size);
                if (fitted.width, fitted.height) == (previous.width, previous.height) {
                    return None;
                }
                session.applied_bounds = Some(fitted);
                Some((
                    id.clone(),
                    session.pane.0,
                    session.controller.clone()?,
                    fitted,
                    previous,
                ))
            })
            .collect::<Vec<_>>()
    });
    for (id, pane, controller, fitted, previous) in views {
        if let Err(error) = fitted.apply(pane, &controller, Some(previous)) {
            fail(&id, error);
        }
    }
}

pub(crate) fn moved() {
    let controllers = HOST.with(|host| {
        host.borrow()
            .sessions
            .values()
            .filter_map(|session| session.controller.clone())
            .collect::<Vec<_>>()
    });
    for controller in controllers {
        unsafe {
            let _ = controller.NotifyParentWindowPositionChanged();
        }
    }
}

pub(crate) fn stop_all() {
    let ids = HOST.with(|host| host.borrow().sessions.keys().cloned().collect::<Vec<_>>());
    for id in ids {
        close(&id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use serde_json::Value;
    use std::{
        sync::mpsc,
        thread,
        time::{Duration, Instant},
    };
    use windows::Win32::{
        Graphics::Gdi::{GetDC, GetPixel, ReleaseDC},
        System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED},
        UI::WindowsAndMessaging::{
            DispatchMessageW, GetTopWindow, GetWindowRect, PeekMessageW, SetProcessDPIAware,
            TranslateMessage, HWND_TOPMOST, MSG, PM_REMOVE, WS_POPUP,
        },
    };

    fn test_wallpaper() -> Arc<str> {
        // Two pixels, magenta on the left and green on the right, in 24-bit BMP.
        let mut bmp = [0u8; 62];
        bmp[..2].copy_from_slice(b"BM");
        bmp[2..6].copy_from_slice(&62u32.to_le_bytes());
        bmp[10..14].copy_from_slice(&54u32.to_le_bytes());
        bmp[14..18].copy_from_slice(&40u32.to_le_bytes());
        bmp[18..22].copy_from_slice(&2u32.to_le_bytes());
        bmp[22..26].copy_from_slice(&1u32.to_le_bytes());
        bmp[26..28].copy_from_slice(&1u16.to_le_bytes());
        bmp[28..30].copy_from_slice(&24u16.to_le_bytes());
        bmp[54..60].copy_from_slice(&[255, 0, 255, 0, 255, 0]);
        base64::engine::general_purpose::STANDARD.encode(bmp).into()
    }

    unsafe fn probe_pixels(parent: HWND) -> (u32, u32) {
        SetWindowPos(
            parent,
            Some(HWND_TOPMOST),
            48,
            80,
            640,
            480,
            SWP_NOACTIVATE | SWP_SHOWWINDOW,
        )
        .unwrap();
        let finish = Instant::now() + Duration::from_secs(1);
        while Instant::now() < finish {
            let mut msg = MSG::default();
            while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            thread::sleep(Duration::from_millis(10));
        }
        let dc = GetDC(None);
        let mut rect = RECT::default();
        GetWindowRect(parent, &mut rect).unwrap();
        let left = GetPixel(dc, rect.left + 124, rect.top + 195).0;
        let right = GetPixel(dc, rect.left + 550, rect.top + 195).0;
        let _ = ReleaseDC(None, dc);
        (left, right)
    }

    fn assert_color(pixel: u32, expected: u32) {
        for shift in [0, 8, 16] {
            assert!(
                ((pixel >> shift) & 255).abs_diff((expected >> shift) & 255) <= 2,
                "expected COLORREF {expected:06x}, got {pixel:06x}"
            );
        }
    }

    fn wait_for_navigation(events: &mpsc::Receiver<Value>) -> Value {
        let deadline = Instant::now() + Duration::from_secs(20);
        while Instant::now() < deadline {
            unsafe {
                let mut message = MSG::default();
                while PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
                    let _ = TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
            }
            for event in events.try_iter() {
                assert_ne!(event["type"], "error", "{event}");
                if event["type"] == "navigation" {
                    return event;
                }
            }
            thread::sleep(Duration::from_millis(10));
        }
        panic!("WebView2 navigation timed out");
    }

    #[test]
    #[ignore = "requires a Windows desktop session with the WebView2 runtime"]
    fn loads_top_level_page_with_frame_blocking_headers() {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let base = format!("http://{}", server.server_addr());
        let server_thread = thread::spawn(move || {
            while let Some(request) = server.recv_timeout(Duration::from_secs(25)).unwrap() {
                let denied = request.url() == "/denied";
                let mut response = tiny_http::Response::from_string(
                    r#"<!doctype html><title>Unexpected host</title><style>html,body{background:#fff;color:#222}</style><script>
                    if (window.top === window && !window.__TAURI_INTERNALS__) document.title = 'Isolated top-level page';
                    </script>"#,
                ).with_status_code(if denied { 403 } else { 200 });
                for (name, value) in [
                    ("Content-Type", "text/html; charset=utf-8"),
                    ("X-Frame-Options", "DENY"),
                    ("Content-Security-Policy", "frame-ancestors 'none'"),
                ] {
                    response.add_header(tiny_http::Header::from_bytes(name, value).unwrap());
                }
                request.respond(response).unwrap();
                if denied {
                    break;
                }
            }
        });
        let test_data = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target");
        std::fs::create_dir_all(&test_data).unwrap();
        let profile = tempfile::tempdir_in(test_data).unwrap();
        let (send_event, events) = mpsc::channel();
        let parent = unsafe {
            if std::env::var_os("MOKI_PREVIEW_PIXEL_PROBE").is_some() {
                let _ = SetProcessDPIAware();
            }
            CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().unwrap();
            CreateWindowExW(
                WINDOW_EX_STYLE(0),
                windows::core::w!("STATIC"),
                PCWSTR::null(),
                WS_POPUP,
                0,
                0,
                640,
                480,
                None,
                None,
                None,
                None,
            )
            .unwrap()
        };
        let pane = PreviewPane::new(parent).unwrap();
        let preview_hwnd = pane.0;
        let covering_editor = PreviewPane::new(parent).unwrap();
        let id = "test";
        let placement = Some(WallpaperPlacement {
            x: -100,
            y: -60,
            width: 640,
            height: 480,
        });
        start(
            id.into(),
            Session {
                pane,
                activation: 0,
                applied_bounds: None,
                url: base.clone(),
                revision: 0,
                appearance: Appearance {
                    enabled: true,
                    light: 46.0,
                    dark: 76.0,
                },
                wallpaper: Some(test_wallpaper()),
                navigation_id: 0,
                navigation_revision: 0,
                document_ready: false,
                script_context: None,
                bounds: Bounds {
                    x: 0,
                    y: 0,
                    width: 640,
                    height: 480,
                    visible: false,
                    wallpaper: placement,
                    client: None,
                },
                events: Channel::new(move |body| {
                    send_event
                        .send(body.deserialize::<Value>().unwrap())
                        .unwrap();
                    Ok(())
                }),
                controller: None,
            },
            profile.path().to_owned(),
        );

        let ok = wait_for_navigation(&events);
        assert_eq!(ok["success"], true, "{ok}");
        assert_eq!(ok["status"], 200, "{ok}");
        let controller = HOST.with(|host| host.borrow().sessions[id].controller.clone().unwrap());
        let mut wallpaper_pixels = None;
        unsafe {
            SetWindowPos(
                covering_editor.0,
                Some(HWND_TOP),
                0,
                0,
                640,
                480,
                SWP_NOACTIVATE | SWP_SHOWWINDOW,
            )
            .unwrap();
            let shown = Bounds {
                x: 100,
                y: 60,
                width: 500,
                height: 400,
                visible: true,
                wallpaper: placement,
                client: None,
            };
            shown.apply(preview_hwnd, &controller, None).unwrap();
            assert_eq!(GetTopWindow(Some(parent)).unwrap(), preview_hwnd);
            let mut background = COREWEBVIEW2_COLOR::default();
            controller
                .cast::<ICoreWebView2Controller2>()
                .unwrap()
                .DefaultBackgroundColor(&mut background)
                .unwrap();
            assert_eq!(background.A, 0);
            let view = controller.CoreWebView2().unwrap();
            let mut title = PWSTR::null();
            view.DocumentTitle(&mut title).unwrap();
            assert_eq!(take_pwstr(title), "Isolated top-level page");
            let settings = view.Settings().unwrap();
            let mut allowed = Default::default();
            settings.IsWebMessageEnabled(&mut allowed).unwrap();
            assert!(!allowed.as_bool());
            settings.AreHostObjectsAllowed(&mut allowed).unwrap();
            assert!(!allowed.as_bool());
            if std::env::var_os("MOKI_PREVIEW_PIXEL_PROBE").is_some() {
                let light = probe_pixels(parent);
                devtools(
                    &view,
                    "Runtime.evaluate",
                    json!({
                        "expression": "document.documentElement.dataset.theme = 'dark'",
                    }),
                    |_| {},
                )
                .unwrap();
                wallpaper_pixels = Some((light, probe_pixels(parent)));
            }
            let mut previous = shown;
            for width in [420, 540, 500] {
                let resized = Bounds {
                    x: 600 - width,
                    width,
                    ..shown
                };
                resized
                    .apply(preview_hwnd, &controller, Some(previous))
                    .unwrap();
                let mut rect = RECT::default();
                controller.Bounds(&mut rect).unwrap();
                assert_eq!(rect.right - rect.left, width);
                GetWindowRect(preview_hwnd, &mut rect).unwrap();
                assert_eq!(rect.right - rect.left, width);
                assert_eq!(GetTopWindow(Some(parent)).unwrap(), preview_hwnd);
                previous = resized;
            }
            let navigation_id = HOST.with(|host| host.borrow().sessions[id].navigation_id);
            HOST.with(|host| {
                let mut host = host.borrow_mut();
                let session = host.sessions.get_mut(id).unwrap();
                session.bounds = Bounds {
                    client: Some(ClientBounds {
                        width: 600,
                        height: 480,
                        fills_bottom: true,
                    }),
                    ..shown
                };
                session.applied_bounds = Some(shown);
            });
            resized(tauri::PhysicalSize::new(740, 560));
            let mut rect = RECT::default();
            controller.Bounds(&mut rect).unwrap();
            assert_eq!((rect.right, rect.bottom), (640, 480));
            resized(tauri::PhysicalSize::new(600, 480));
            controller.Bounds(&mut rect).unwrap();
            assert_eq!((rect.right, rect.bottom), (500, 400));
            hide(id, 2);
            let mut visible = Default::default();
            controller.IsVisible(&mut visible).unwrap();
            assert!(!visible.as_bool());
            HOST.with(|host| {
                let mut host = host.borrow_mut();
                let session = host.sessions.get_mut(id).unwrap();
                assert!(!session.accept_activation(1));
                assert!(session.accept_activation(3));
            });
            shown.apply(preview_hwnd, &controller, None).unwrap();
            hide(id, 2);
            controller.IsVisible(&mut visible).unwrap();
            assert!(visible.as_bool());
            let mut title = PWSTR::null();
            view.DocumentTitle(&mut title).unwrap();
            assert_eq!(take_pwstr(title), "Isolated top-level page");
            HOST.with(|host| assert_eq!(host.borrow().sessions[id].navigation_id, navigation_id));
            view.Navigate(&HSTRING::from(format!("{base}/denied")))
                .unwrap();
        }
        let denied = wait_for_navigation(&events);
        assert_eq!(denied["success"], false, "{denied}");
        assert_eq!(denied["status"], 403, "{denied}");

        drop(covering_editor);
        drop(controller);
        close(id);
        HOST.with(|host| *host.borrow_mut() = Host::default());
        unsafe {
            DestroyWindow(parent).unwrap();
            CoUninitialize();
        }
        server_thread.join().unwrap();
        if let Some(((light_left, light_right), (dark_left, dark_right))) = wallpaper_pixels {
            println!("Composited pixels (COLORREF) light {light_left:06x}/{light_right:06x}, dark {dark_left:06x}/{dark_right:06x}");
            assert_color(light_left, 0xff75ff);
            assert_color(light_right, 0x75ff75);
            assert_color(dark_left, 0x4f124f);
            assert_color(dark_right, 0x124f12);
        }
    }
}
