use serde::Serialize;

#[derive(Serialize)]
pub(crate) struct ClipboardContents {
    text: String,
    image: Option<ClipboardImage>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ClipboardImage {
    mime: &'static str,
    content_base64: String,
}

#[tauri::command]
pub(crate) async fn read_clipboard_for_paste(include_image: bool) -> Result<ClipboardContents, String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || windows_clipboard::read(include_image))
            .await
            .map_err(|error| error.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = include_image;
        Err("System clipboard paste is unavailable on this platform".into())
    }
}

#[cfg(windows)]
mod windows_clipboard {
    use super::{ClipboardContents, ClipboardImage};
    use base64::{engine::general_purpose::STANDARD, Engine};
    use std::io;
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, OpenClipboard, RegisterClipboardFormatW,
    };
    use windows_sys::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};

    const CF_DIB: u32 = 8;
    const CF_UNICODETEXT: u32 = 13;
    const CF_DIBV5: u32 = 17;
    const BMP_HEADER_SIZE: u32 = 14;

    struct OpenClipboardGuard;

    impl Drop for OpenClipboardGuard {
        fn drop(&mut self) {
            unsafe { CloseClipboard() };
        }
    }

    pub(super) fn read(include_image: bool) -> Result<ClipboardContents, String> {
        let (text, image) = {
            let clipboard = (0..3).find_map(|attempt| {
                if attempt > 0 {
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
                if unsafe { OpenClipboard(0) } == 0 {
                    None
                } else {
                    Some(OpenClipboardGuard)
                }
            });
            let _clipboard = clipboard.ok_or_else(|| io::Error::last_os_error().to_string())?;
            let text = with_format(CF_UNICODETEXT, |bytes| {
                let units: Vec<_> = bytes
                    .chunks_exact(2)
                    .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
                    .take_while(|unit| *unit != 0)
                    .collect();
                Some(String::from_utf16_lossy(&units))
            })
            .unwrap_or_default();
            let image = if include_image && text.is_empty() {
                read_image()
            } else {
                None
            };
            (text, image)
        };
        Ok(ClipboardContents {
            text,
            image: image.map(|(mime, bytes)| ClipboardImage {
                mime,
                content_base64: STANDARD.encode(bytes),
            }),
        })
    }

    fn with_format<T>(format: u32, read: impl FnOnce(&[u8]) -> Option<T>) -> Option<T> {
        if format == 0 {
            return None;
        }
        // The clipboard stays open throughout. Copy the result before unlocking its buffer.
        unsafe {
            let handle = GetClipboardData(format);
            if handle == 0 {
                return None;
            }
            let handle = handle as windows_sys::Win32::Foundation::HGLOBAL;
            let size = GlobalSize(handle);
            if size == 0 || size > isize::MAX as usize {
                return None;
            }
            let data = GlobalLock(handle).cast::<u8>();
            if data.is_null() {
                return None;
            }
            let result = read(std::slice::from_raw_parts(data, size));
            GlobalUnlock(handle);
            result
        }
    }

    fn read_image() -> Option<(&'static str, Vec<u8>)> {
        const PNG_NAME: [u16; 4] = [b'P' as u16, b'N' as u16, b'G' as u16, 0];
        let png = unsafe { RegisterClipboardFormatW(PNG_NAME.as_ptr()) };
        with_format(png, |bytes| {
            bytes
                .starts_with(b"\x89PNG\r\n\x1a\n")
                .then(|| ("image/png", bytes.to_vec()))
        })
        .or_else(|| {
            [CF_DIBV5, CF_DIB]
                .into_iter()
                .find_map(|format| with_format(format, dib_as_bmp))
                .map(|bytes| ("image/bmp", bytes))
        })
    }

    fn dib_as_bmp(dib: &[u8]) -> Option<Vec<u8>> {
        let word = |start| Some(u16::from_le_bytes(dib.get(start..start + 2)?.try_into().ok()?));
        let dword = |start| Some(u32::from_le_bytes(dib.get(start..start + 4)?.try_into().ok()?));
        let header = dword(0)?;
        let palette_entries = |bits| match bits {
            1 | 4 | 8 => 1u32 << bits,
            _ => 0,
        };
        let pixel_offset = match header {
            12 => header + palette_entries(word(10)?) * 3,
            40.. => {
                let colors = match dword(32)? {
                    0 => palette_entries(word(14)?),
                    colors => colors,
                };
                let masks = match (header, dword(16)?) {
                    (40, 3) => 12, // BI_BITFIELDS stores three DWORD masks after this header.
                    (40, 6) => 16, // BI_ALPHABITFIELDS adds an alpha mask.
                    _ => 0,
                };
                header.checked_add(masks)?.checked_add(colors.checked_mul(4)?)?
            }
            _ => return None,
        };
        let dib_size = u32::try_from(dib.len()).ok()?;
        if pixel_offset >= dib_size {
            return None;
        }
        let size = dib_size.checked_add(BMP_HEADER_SIZE)?;
        let mut bmp = Vec::with_capacity(size as usize);
        bmp.extend_from_slice(b"BM");
        bmp.extend_from_slice(&size.to_le_bytes());
        bmp.extend_from_slice(&[0; 4]);
        bmp.extend_from_slice(&(pixel_offset + BMP_HEADER_SIZE).to_le_bytes());
        bmp.extend_from_slice(dib);
        Some(bmp)
    }
}
