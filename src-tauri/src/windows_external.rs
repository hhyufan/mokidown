use std::{io, mem::size_of};
use windows::{
    core::{w, Error, Interface, BSTR, HSTRING, PCWSTR},
    Win32::{
        System::{
            Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
                COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
            },
            Variant::VARIANT,
        },
        UI::{
            Shell::{
                IShellDispatch, IShellDispatch2, IShellFolderViewDual, IShellWindows, IWebBrowser,
                Shell, ShellExecuteW, CSIDL_DESKTOP, SWC_DESKTOP, SWFO_NEEDDISPATCH,
            },
            WindowsAndMessaging::SW_SHOWNORMAL,
        },
    },
};
use windows_sys::Win32::{
    Foundation::CloseHandle,
    Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY},
    System::Threading::{GetCurrentProcess, OpenProcessToken},
};

fn is_elevated() -> io::Result<bool> {
    unsafe {
        let mut token = 0;
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return Err(io::Error::last_os_error());
        }
        let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut length = 0;
        let result = GetTokenInformation(
            token,
            TokenElevation,
            (&mut elevation as *mut TOKEN_ELEVATION).cast(),
            size_of::<TOKEN_ELEVATION>() as u32,
            &mut length,
        );
        let error = (result == 0).then(io::Error::last_os_error);
        CloseHandle(token);
        match error {
            Some(error) => Err(error),
            None => Ok(elevation.TokenIsElevated != 0),
        }
    }
}

fn shell_error(step: &str) -> impl FnOnce(Error) -> Error + '_ {
    move |error| Error::new(error.code(), format!("{step}: {error}"))
}

// Use the Explorer desktop in the interactive session so Windows resolves the
// default browser using the signed-in user's settings and permissions.
fn desktop_shell() -> windows::core::Result<IShellDispatch2> {
    unsafe {
        let shell: IShellDispatch = CoCreateInstance(&Shell, None, CLSCTX_INPROC_SERVER)
            .map_err(shell_error("Access Windows Shell"))?;
        let shell_windows: IShellWindows = shell
            .Windows()
            .and_then(|windows| windows.cast())
            .map_err(shell_error("Get Explorer windows"))?;
        let mut desktop_window = 0;
        let desktop = shell_windows
            .FindWindowSW(
                &VARIANT::from(CSIDL_DESKTOP as i32),
                &VARIANT::default(),
                SWC_DESKTOP,
                &mut desktop_window,
                SWFO_NEEDDISPATCH,
            )
            .map_err(shell_error("Find the Explorer desktop"))?;
        let folder: IShellFolderViewDual = desktop
            .cast::<IWebBrowser>()
            .and_then(|browser| browser.Document())
            .and_then(|document| document.cast())
            .map_err(shell_error("Get Explorer desktop automation"))?;
        folder
            .Application()
            .and_then(|application| application.cast())
            .map_err(shell_error("Get the Explorer URL handler"))
    }
}

#[cfg(test)]
#[test]
#[ignore = "requires the interactive Windows Explorer desktop"]
fn resolves_interactive_desktop_shell() {
    is_elevated().unwrap();
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().unwrap();
        let result = desktop_shell().map(drop);
        CoUninitialize();
        result.unwrap();
    }
}

pub(crate) fn open(url: &str) -> Result<(), String> {
    let elevated = is_elevated().map_err(|error| error.to_string())?;
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE)
            .ok()
            .map_err(|error| error.to_string())?;
        let result = if elevated {
            let empty = VARIANT::default();
            desktop_shell()
                .and_then(|shell| {
                    shell.ShellExecute(
                        &BSTR::from(url),
                        &empty,
                        &empty,
                        &VARIANT::from("open"),
                        &VARIANT::from(SW_SHOWNORMAL.0),
                    )
                })
                .map_err(|error| format!("Windows Explorer could not open the URL: {error}"))
        } else {
            let result = ShellExecuteW(
                None,
                w!("open"),
                &HSTRING::from(url),
                PCWSTR::null(),
                PCWSTR::null(),
                SW_SHOWNORMAL,
            )
            .0 as isize;
            if result > 32 {
                Ok(())
            } else {
                Err(format!("Failed to open URL (Windows Shell error {result})"))
            }
        };
        CoUninitialize();
        result
    }
}
