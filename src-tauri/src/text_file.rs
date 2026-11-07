//! Bounded, strict text reads shared by editor entry points and local history.
#[cfg(not(windows))]
use encoding_rs::{DecoderResult, Encoding, UTF_8};
use serde::Serialize;
use std::fs::File;
use std::io::{self, Read};
use std::path::Path;

pub const MAX_TEXT_BYTES: u64 = 20 * 1024 * 1024;
const HEAD_BYTES: u64 = 8 * 1024;
pub const UTF8_BOM: &[u8] = b"\xef\xbb\xbf";

#[cfg(windows)]
fn decode_code_page(bytes: &[u8], code_page: u32) -> Option<String> {
    use windows_sys::Win32::Globalization::{MultiByteToWideChar, MB_ERR_INVALID_CHARS};
    let len = i32::try_from(bytes.len()).ok()?;
    let mut wide = vec![0; bytes.len()];
    // The number of UTF-16 units never exceeds the number of bytes in an ANSI code page.
    let written = unsafe {
        MultiByteToWideChar(
            code_page,
            MB_ERR_INVALID_CHARS,
            bytes.as_ptr(),
            len,
            wide.as_mut_ptr(),
            len,
        )
    };
    (written > 0)
        .then(|| String::from_utf16(&wide[..written as usize]).ok())
        .flatten()
}

#[cfg(windows)]
fn decode_system_text(bytes: &[u8], partial: bool) -> Option<(String, String)> {
    let code_page = unsafe { windows_sys::Win32::Globalization::GetACP() };
    if code_page == 65001 {
        return None;
    }
    let trailing = if partial {
        3.min(bytes.len().saturating_sub(1))
    } else {
        0
    };
    (0..=trailing)
        .find_map(|cut| decode_code_page(&bytes[..bytes.len() - cut], code_page))
        .map(|content| (content, format!("CP{code_page}")))
}

#[cfg(not(windows))]
fn decode_system_text(bytes: &[u8], partial: bool) -> Option<(String, String)> {
    let locale = ["LC_ALL", "LC_CTYPE", "LANG"]
        .iter()
        .find_map(|name| std::env::var(name).ok().filter(|value| !value.is_empty()))?;
    let (_, label) = locale.split_once('.')?;
    let label = label.split('@').next()?;
    let encoding = Encoding::for_label(label.as_bytes())?;
    if encoding == UTF_8 {
        return None;
    }
    let mut decoder = encoding.new_decoder_without_bom_handling();
    let mut content =
        String::with_capacity(decoder.max_utf8_buffer_length_without_replacement(bytes.len())?);
    let (result, _) = decoder.decode_to_string_without_replacement(bytes, &mut content, !partial);
    (result == DecoderResult::InputEmpty).then(|| (content, encoding.name().to_owned()))
}

#[cfg(windows)]
pub fn encode_code_page(content: &str, code_page: u32) -> Result<Vec<u8>, String> {
    use std::ptr::null;
    use windows_sys::Win32::Globalization::{WideCharToMultiByte, WC_NO_BEST_FIT_CHARS};
    if content.is_empty() {
        return Ok(Vec::new());
    }
    let wide: Vec<u16> = content.encode_utf16().collect();
    let len = i32::try_from(wide.len()).map_err(|error| error.to_string())?;
    let mut used_default = 0;
    let size = unsafe {
        WideCharToMultiByte(
            code_page,
            WC_NO_BEST_FIT_CHARS,
            wide.as_ptr(),
            len,
            std::ptr::null_mut(),
            0,
            null(),
            &mut used_default,
        )
    };
    if size <= 0 || used_default != 0 {
        return Err(format!("Text cannot be represented in CP{code_page}"));
    }
    let mut bytes = vec![0; size as usize];
    let written = unsafe {
        WideCharToMultiByte(
            code_page,
            WC_NO_BEST_FIT_CHARS,
            wide.as_ptr(),
            len,
            bytes.as_mut_ptr(),
            size,
            null(),
            &mut used_default,
        )
    };
    if written != size || used_default != 0 {
        return Err(format!("Text cannot be represented in CP{code_page}"));
    }
    Ok(bytes)
}

#[derive(Debug, Serialize)]
pub struct TextFileError {
    pub kind: &'static str,
    pub message: String,
}

impl TextFileError {
    fn new(kind: &'static str) -> Self {
        Self {
            kind,
            message: format!("Cannot read file as text: {kind}"),
        }
    }
}

fn io_error(error: io::Error) -> TextFileError {
    TextFileError {
        kind: if error.kind() == io::ErrorKind::NotFound {
            "missing"
        } else {
            "unreadable"
        },
        message: error.to_string(),
    }
}

#[derive(Debug)]
pub struct TextDocument {
    pub content: String,
    pub encoding: String,
}

fn decode(bytes: &[u8], partial: bool) -> Result<TextDocument, TextFileError> {
    if bytes.starts_with(&[0xff, 0xfe, 0, 0]) || bytes.starts_with(&[0, 0, 0xfe, 0xff]) {
        return Err(TextFileError::new("invalid-encoding"));
    }
    let (content, encoding) =
        if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
            let little = bytes[0] == 0xff;
            let body = &bytes[2..];
            if !partial && !body.len().is_multiple_of(2) {
                return Err(TextFileError::new("invalid-encoding"));
            }
            let mut units: Vec<u16> = body
                .chunks_exact(2)
                .map(|pair| {
                    if little {
                        u16::from_le_bytes([pair[0], pair[1]])
                    } else {
                        u16::from_be_bytes([pair[0], pair[1]])
                    }
                })
                .collect();
            if partial
                && units
                    .last()
                    .is_some_and(|unit| (0xd800..=0xdbff).contains(unit))
            {
                units.pop();
            }
            (
                String::from_utf16(&units).map_err(|_| TextFileError::new("invalid-encoding"))?,
                if little { "UTF-16LE" } else { "UTF-16BE" }.to_owned(),
            )
        } else {
            let has_bom = bytes.starts_with(UTF8_BOM);
            let body = bytes.strip_prefix(UTF8_BOM).unwrap_or(bytes);
            if body.contains(&0) {
                return Err(TextFileError::new("binary"));
            }
            let encoding = if has_bom { "UTF-8-BOM" } else { "UTF-8" };
            match std::str::from_utf8(body) {
                Ok(text) => (text.to_owned(), encoding.to_owned()),
                Err(error) if partial && error.error_len().is_none() => (
                    std::str::from_utf8(&body[..error.valid_up_to()])
                        .unwrap()
                        .to_owned(),
                    encoding.to_owned(),
                ),
                Err(_) if !has_bom => decode_system_text(body, partial)
                    .ok_or_else(|| TextFileError::new("invalid-encoding"))?,
                Err(_) => return Err(TextFileError::new("invalid-encoding")),
            }
        };
    let mut controls = 0;
    let mut length = 0;
    for character in content.chars() {
        if character == '\0' {
            return Err(TextFileError::new("binary"));
        }
        let code = character as u32;
        if code < 9 || (code > 13 && code < 32) || code == 127 {
            controls += 1;
        }
        length += 1;
    }
    if length > 0 && controls as f64 / length as f64 > 0.3 {
        return Err(TextFileError::new("binary"));
    }
    Ok(TextDocument { content, encoding })
}

fn read_bounded(path: &Path, limit: u64) -> Result<(Vec<u8>, bool), TextFileError> {
    // Reject directories/special files before opening (e.g. a FIFO must not hang).
    let metadata = std::fs::metadata(path).map_err(io_error)?;
    if !metadata.is_file() {
        return Err(TextFileError::new("not-file"));
    }
    let file = File::open(path).map_err(io_error)?;
    let metadata = file.metadata().map_err(io_error)?;
    if !metadata.is_file() {
        return Err(TextFileError::new("not-file"));
    }
    if metadata.len() > MAX_TEXT_BYTES {
        return Err(TextFileError::new("too-large"));
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(io_error)?;
    if bytes.len() as u64 > MAX_TEXT_BYTES {
        return Err(TextFileError::new("too-large"));
    }
    let partial = bytes.len() as u64 > limit;
    bytes.truncate(limit as usize);
    Ok((bytes, partial))
}

pub fn read(path: &Path) -> Result<TextDocument, TextFileError> {
    let (bytes, _) = read_bounded(path, MAX_TEXT_BYTES)?;
    decode(&bytes, false)
}

pub fn check_head(path: &Path) -> Result<(), TextFileError> {
    let (bytes, partial) = read_bounded(path, HEAD_BYTES)?;
    decode(&bytes, partial).map(|_| ())
}

pub fn encode_utf16(content: &str, little: bool) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(2 + content.len() * 2);
    bytes.extend(if little { [0xff, 0xfe] } else { [0xfe, 0xff] });
    for unit in content.encode_utf16() {
        bytes.extend(if little {
            unit.to_le_bytes()
        } else {
            unit.to_be_bytes()
        });
    }
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bom_does_not_bypass_validation() {
        for bytes in [&b"\xef\xbb\xbfhello\0binary"[..], &b"\xff\xfe\0\0"[..]] {
            assert!(decode(bytes, false).is_err());
        }
        assert_eq!(
            decode(&[0xef, 0xbb, 0xbf, 0xff, 0xff], false)
                .unwrap_err()
                .kind,
            "invalid-encoding"
        );
    }

    #[test]
    fn utf16_round_trips_without_replacement_characters() {
        for little in [true, false] {
            let bytes = encode_utf16("中文 😀\r\nnext", little);
            let text = decode(&bytes, false).unwrap();
            assert_eq!(text.content, "中文 😀\r\nnext");
            assert_eq!(text.encoding, if little { "UTF-16LE" } else { "UTF-16BE" });
            assert_eq!(
                decode(&[&bytes[..], &[0]].concat(), false)
                    .unwrap_err()
                    .kind,
                "invalid-encoding"
            );
        }
    }

    #[test]
    fn only_sampled_heads_allow_incomplete_trailing_characters() {
        let head = b"text \xf0\x9f";
        assert_eq!(decode(head, true).unwrap().content, "text ");
        assert!(decode(&[UTF8_BOM, head].concat(), false).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn ansi_code_pages_round_trip_without_best_fit_substitution() {
        assert_eq!(decode_code_page(b"caf\xe9", 1252).as_deref(), Some("café"));
        assert_eq!(encode_code_page("café", 1252).unwrap(), b"caf\xe9");
        assert_eq!(decode_code_page(b"\x93\xfa", 932).as_deref(), Some("日"));
        assert_eq!(encode_code_page("日", 932).unwrap(), b"\x93\xfa");
        assert!(decode_code_page(b"\x93", 932).is_none());
        assert!(encode_code_page("日", 1252).is_err());
    }

    #[test]
    fn all_text_readers_reject_binary_large_missing_and_directory_paths() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("renamed.md");
        std::fs::write(&path, b"hello\0binary").unwrap();
        assert_eq!(read(&path).unwrap_err().kind, "binary");
        assert!(check_head(&path).is_err());
        // A binary payload past the sampled head still cannot enter the editor/history.
        let mut bytes = vec![b'a'; HEAD_BYTES as usize + 5];
        bytes.push(0);
        std::fs::write(&path, bytes).unwrap();
        assert_eq!(read(&path).unwrap_err().kind, "binary");
        File::create(&path)
            .unwrap()
            .set_len(MAX_TEXT_BYTES + 1)
            .unwrap();
        assert_eq!(read(&path).unwrap_err().kind, "too-large");
        assert_eq!(read(root.path()).unwrap_err().kind, "not-file");
        assert_eq!(
            read(&root.path().join("missing")).unwrap_err().kind,
            "missing"
        );
        std::fs::write(&path, b"").unwrap();
        assert_eq!(read(&path).unwrap().content, "");
    }
}
