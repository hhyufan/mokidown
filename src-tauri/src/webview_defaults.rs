use tauri::{plugin, Wry};
#[cfg(windows)]
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2Controller, ICoreWebView2Settings3, ICoreWebView2Settings4,
    ICoreWebView2Settings5, ICoreWebView2Settings6,
};
#[cfg(windows)]
use windows::core::{Interface, Result, HSTRING};

/// Keep wry's default disabled features and autoplay policy while bypassing Windows
/// DirectComposition visual-tree presentation, which can flash a blank frame seconds
/// after maximizing on Windows 11 when DWM promotes/demotes the swapchain/MPO plane.
#[cfg(windows)]
pub(crate) const WINDOWS_BROWSER_ARGS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required --disable-direct-composition";

/// The development checkout keeps its Chromium state independent of installed builds.
#[cfg(all(windows, debug_assertions))]
pub(crate) fn development_profile(name: &str) -> std::path::PathBuf {
    crate::development_cache_dir().join("webview2").join(name)
}

pub(crate) fn app_window<'a, M: tauri::Manager<Wry>>(
    builder: tauri::WebviewWindowBuilder<'a, Wry, M>,
) -> tauri::WebviewWindowBuilder<'a, Wry, M> {
    #[cfg(windows)]
    let builder = builder.additional_browser_args(WINDOWS_BROWSER_ARGS);
    #[cfg(all(windows, debug_assertions))]
    let builder = builder.data_directory(development_profile("editor"));
    builder
}

#[cfg(windows)]
pub(crate) fn prepare_editor_resize(window: &tauri::WebviewWindow<Wry>) {
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
    use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClassLongW, GetClientRect, GetParent, GetWindowLongW, IsWindowVisible, SetClassLongW,
        SetWindowLongW, SetWindowPos, CS_HREDRAW, CS_VREDRAW, GCL_STYLE, GWL_STYLE, SIZE_MINIMIZED,
        STYLESTRUCT, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOREDRAW, SWP_NOZORDER, WM_ERASEBKGND,
        WM_NCDESTROY, WM_SIZE, WM_STYLECHANGING, WS_CLIPCHILDREN,
    };

    unsafe extern "system" fn resize_container_first(
        host: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        subclass_id: usize,
        container: usize,
    ) -> LRESULT {
        let container = HWND(container as *mut _);
        if message == WM_STYLECHANGING && wparam.0 as i32 == GWL_STYLE.0 && lparam.0 != 0 {
            // Preserve WS_CLIPCHILDREN across tao style updates (e.g. fullscreen toggles)
            // so parent WM_ERASEBKGND never paints over the WebView child surface.
            let styles = &mut *(lparam.0 as *mut STYLESTRUCT);
            styles.styleNew |= WS_CLIPCHILDREN.0;
        } else if message == WM_ERASEBKGND {
            let mut viewport = RECT::default();
            let mut current = RECT::default();
            if IsWindowVisible(container).as_bool()
                && GetClientRect(host, &mut viewport).is_ok()
                && GetClientRect(container, &mut current).is_ok()
                && viewport.right > 0
                && viewport.bottom > 0
                && viewport == current
            {
                return LRESULT(1);
            }
        } else if message == WM_SIZE && wparam.0 != SIZE_MINIMIZED as usize {
            let mut viewport = RECT::default();
            let mut current = RECT::default();
            // Wry sets the controller bounds before resizing its container. Enlarge
            // the container first (without synchronous redraw) so it cannot clip the
            // new frame to the old size or flash an intermediate background erase.
            if GetClientRect(host, &mut viewport).is_ok()
                && GetClientRect(container, &mut current).is_ok()
                && viewport.right > 0
                && viewport.bottom > 0
                && viewport != current
            {
                let _ = SetWindowPos(
                    container,
                    None,
                    0,
                    0,
                    viewport.right,
                    viewport.bottom,
                    SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOZORDER | SWP_NOREDRAW,
                );
            }
        } else if message == WM_NCDESTROY {
            let _ = RemoveWindowSubclass(host, Some(resize_container_first), subclass_id);
        }
        DefSubclassProc(host, message, wparam, lparam)
    }

    let Ok(host) = window.hwnd() else { return };
    // The editor has its own window class. Retain its painted client area
    // while the WebView submits a frame at the new size, and clip child HWNDs
    // so parent background erases cannot paint over the WebView surface.
    unsafe {
        let style = GetClassLongW(host, GCL_STYLE);
        let redraw_styles = (CS_HREDRAW | CS_VREDRAW).0;
        if style & redraw_styles != 0
            && SetClassLongW(host, GCL_STYLE, (style & !redraw_styles) as i32) == 0
        {
            log::warn!("Could not disable full-window redraws on editor resize");
        }
        let win_style = GetWindowLongW(host, GWL_STYLE) as u32;
        if win_style & WS_CLIPCHILDREN.0 == 0 {
            SetWindowLongW(host, GWL_STYLE, (win_style | WS_CLIPCHILDREN.0) as i32);
        }
    }

    let host = host.0 as usize;
    if let Err(error) = window.with_webview(move |webview| unsafe {
        let host = HWND(host as *mut _);
        let mut container = HWND::default();
        if webview.controller().ParentWindow(&mut container).is_ok()
            && GetParent(container).is_ok_and(|parent| parent == host)
        {
            let container_cls = GetClassLongW(container, GCL_STYLE);
            let redraw_styles = (CS_HREDRAW | CS_VREDRAW).0;
            if container_cls & redraw_styles != 0 {
                SetClassLongW(
                    container,
                    GCL_STYLE,
                    (container_cls & !redraw_styles) as i32,
                );
            }
            // Keep Wry's default sibling painting. Tauri puts an input-only
            // resize HWND above the WebView, and WS_CLIPSIBLINGS would prevent
            // the WebView from repainting the visible pixels behind it.
            if !SetWindowSubclass(host, Some(resize_container_first), 1, container.0 as usize)
                .as_bool()
            {
                log::warn!("Could not install the editor WebView resize handler");
            }
        }
    }) {
        log::warn!("Could not access the editor WebView: {error}");
    }
}

#[cfg(windows)]
fn disable_browser_ui(controller: ICoreWebView2Controller) -> Result<()> {
    // Tauri invokes this on the owning UI thread. Editing and clipboard input
    // are still delivered to the application with browser accelerators off.
    unsafe {
        let bridge = HSTRING::from(include_str!("../../src/utils/previewFrameBridge.js"));
        controller
            .CoreWebView2()?
            .AddScriptToExecuteOnDocumentCreated(
                &bridge,
                &webview2_com::AddScriptToExecuteOnDocumentCreatedCompletedHandler::create(
                    Box::new(|result, _| result),
                ),
            )?;
        let settings = controller.CoreWebView2()?.Settings()?;
        settings.SetAreDefaultContextMenusEnabled(false)?;
        settings.SetAreDefaultScriptDialogsEnabled(false)?;
        settings.SetAreDevToolsEnabled(cfg!(debug_assertions))?;
        settings.SetIsStatusBarEnabled(false)?;
        settings.SetIsZoomControlEnabled(false)?;
        if let Ok(shortcuts) = settings.cast::<ICoreWebView2Settings3>() {
            shortcuts.SetAreBrowserAcceleratorKeysEnabled(cfg!(debug_assertions))?;
        }
        if let Ok(autofill) = settings.cast::<ICoreWebView2Settings4>() {
            autofill.SetIsGeneralAutofillEnabled(false)?;
            autofill.SetIsPasswordAutosaveEnabled(false)?;
        }
        if let Ok(zoom) = settings.cast::<ICoreWebView2Settings5>() {
            zoom.SetIsPinchZoomEnabled(false)?;
        }
        if let Ok(navigation) = settings.cast::<ICoreWebView2Settings6>() {
            navigation.SetIsSwipeNavigationEnabled(false)?;
        }
    }
    Ok(())
}

pub fn plugin() -> plugin::TauriPlugin<Wry> {
    let builder = plugin::Builder::new("moki-webview-defaults").js_init_script(
        "document.addEventListener('contextmenu', (event) => event.preventDefault());",
    );
    #[cfg(windows)]
    let builder = builder.on_webview_ready(|webview| {
        if let Err(error) = webview.with_webview(|platform| {
            if let Err(error) = disable_browser_ui(platform.controller()) {
                log::warn!("Could not disable default WebView controls: {error}");
            }
        }) {
            log::warn!("Could not access WebView controls: {error}");
        }
    });
    builder.build()
}
