use tauri::{WebviewWindow, Wry};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_TRANSITIONS_FORCEDISABLED,
    DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromRect, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongW, GetWindowRect, IsZoomed, GWL_STYLE, SWP_NOMOVE, SWP_NOSIZE, WINDOWPOS,
    WM_NCDESTROY, WM_WINDOWPOSCHANGING, WS_THICKFRAME,
};

const DWMWA_COLOR_NONE: u32 = 0xFFFF_FFFE;

unsafe fn keep_maximized_window_in_work_area(hwnd: HWND, position: &mut WINDOWPOS) {
    // Tao removes WS_THICKFRAME in fullscreen. Leave that mode and ordinary
    // movement/resizing to Windows, including moves that only change Z order.
    if position.flags.contains(SWP_NOSIZE)
        || !IsZoomed(hwnd).as_bool()
        || GetWindowLongW(hwnd, GWL_STYLE) as u32 & WS_THICKFRAME.0 == 0
    {
        return;
    }

    let (left, top) = if position.flags.contains(SWP_NOMOVE) {
        let mut current = RECT::default();
        if GetWindowRect(hwnd, &mut current).is_err() {
            return;
        }
        (current.left, current.top)
    } else {
        (position.x, position.y)
    };
    let proposed = RECT {
        left,
        top,
        right: left + position.cx,
        bottom: top + position.cy,
    };
    // Use the monitor of the new rectangle, which can differ from the window's
    // current monitor when maximizing or moving between displays.
    let monitor = MonitorFromRect(&proposed, MONITOR_DEFAULTTONEAREST);
    let mut info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    if !GetMonitorInfoW(monitor, &mut info).as_bool() || info.rcWork == info.rcMonitor {
        return;
    }

    // Tao already limits the WebView client area. Also keep the outer HWND
    // out of the taskbar's reserved space, which can otherwise be painted black.
    let work = info.rcWork;
    let x = proposed.left.max(work.left);
    let y = proposed.top.max(work.top);
    let width = proposed.right.min(work.right) - x;
    let height = proposed.bottom.min(work.bottom) - y;
    if width <= 0 || height <= 0 {
        return;
    }
    if x != left || y != top {
        position.flags &= !SWP_NOMOVE;
        position.x = x;
        position.y = y;
    }
    position.cx = width;
    position.cy = height;
}

unsafe extern "system" fn window_frame_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    subclass_id: usize,
    _: usize,
) -> LRESULT {
    if message == WM_NCDESTROY {
        let _ = RemoveWindowSubclass(hwnd, Some(window_frame_proc), subclass_id);
    }
    let result = DefSubclassProc(hwnd, message, wparam, lparam);
    if message == WM_WINDOWPOSCHANGING && lparam.0 != 0 {
        keep_maximized_window_in_work_area(hwnd, &mut *(lparam.0 as *mut WINDOWPOS));
    }
    result
}

pub(crate) fn configure(window: &WebviewWindow<Wry>, opaque: bool) {
    let frame_window = window.clone();
    if let Err(error) = window.run_on_main_thread(move || unsafe {
        let Ok(hwnd) = frame_window.hwnd() else {
            return;
        };
        let set_attribute = |attribute, value: u32| {
            DwmSetWindowAttribute(
                hwnd,
                attribute,
                std::ptr::addr_of!(value).cast(),
                std::mem::size_of::<u32>() as u32,
            )
        };
        let _ = set_attribute(DWMWA_TRANSITIONS_FORCEDISABLED, 1);
        let _ = set_attribute(DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE);
        if opaque {
            // DWM antialiases these corners and squares them for maximize and snap.
            let _ = set_attribute(DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND.0 as u32);
            if !SetWindowSubclass(hwnd, Some(window_frame_proc), 0, 0).as_bool() {
                log::warn!("Could not install the window work-area handler");
            }
        }
    }) {
        log::warn!("Could not configure the window frame: {error}");
    }
}
