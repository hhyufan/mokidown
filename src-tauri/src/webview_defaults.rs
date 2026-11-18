use tauri::{plugin, Wry};
#[cfg(windows)]
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2Controller, ICoreWebView2Settings3, ICoreWebView2Settings4,
    ICoreWebView2Settings5, ICoreWebView2Settings6,
};
#[cfg(windows)]
use windows::core::{Interface, Result, HSTRING};

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
        settings.SetAreDevToolsEnabled(false)?;
        settings.SetIsStatusBarEnabled(false)?;
        settings.SetIsZoomControlEnabled(false)?;
        if let Ok(shortcuts) = settings.cast::<ICoreWebView2Settings3>() {
            shortcuts.SetAreBrowserAcceleratorKeysEnabled(false)?;
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
