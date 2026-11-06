//! Bounded, strict text reads shared by editor entry points and local history.
use encoding_rs::{DecoderResult, GB18030};
use serde::Serialize;
use std::fs::File;
use std::io::{self, Read};
use std::path::Path;

pub const MAX_TEXT_BYTES: u64 = 20 * 1024 * 1024;
const HEAD_BYTES: u64 = 8 * 1024;
pub const UTF8_BOM: &[u8] = b"\xef\xbb\xbf";

fn decode_legacy_chinese(bytes: &[u8], partial: bool) -> Option<String> {
    let mut decoder = GB18030.new_decoder_without_bom_handling();
    let mut content =
        String::with_capacity(decoder.max_utf8_buffer_length_without_replacement(bytes.len())?);
    let (result, _) = decoder.decode_to_string_without_replacement(bytes, &mut content, !partial);
    // Require evidence of Chinese text before interpreting ambiguous non-UTF-8 bytes.
    (result == DecoderResult::InputEmpty
        && content
            .matches(|c: char| matches!(c as u32, 0x3400..=0x9fff | 0x20000..=0x323af))
            .take(2)
            .count()
            == 2)
        .then_some(content)
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
    pub encoding: &'static str,
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
                if little { "UTF-16LE" } else { "UTF-16BE" },
            )
        } else {
            let has_bom = bytes.starts_with(UTF8_BOM);
            let body = bytes.strip_prefix(UTF8_BOM).unwrap_or(bytes);
            if body.contains(&0) {
                return Err(TextFileError::new("binary"));
            }
            let encoding = if has_bom { "UTF-8-BOM" } else { "UTF-8" };
            match std::str::from_utf8(body) {
                Ok(text) => (text.to_owned(), encoding),
                Err(error) if partial && error.error_len().is_none() => (
                    std::str::from_utf8(&body[..error.valid_up_to()])
                        .unwrap()
                        .to_owned(),
                    encoding,
                ),
                Err(_) if !has_bom => (
                    decode_legacy_chinese(body, partial)
                        .ok_or_else(|| TextFileError::new("invalid-encoding"))?,
                    "GB18030",
                ),
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
            decode(&[0xff, 0xff], false).unwrap_err().kind,
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
        assert!(decode(head, false).is_err());
        let head = b"AAA\xb2\xe2\xca\xd42\r\n\xd6\xd0\xce";
        let text = decode(head, true).unwrap();
        assert_eq!(text.content, "AAA测试2\r\n中");
        assert_eq!(text.encoding, "GB18030");
        assert!(decode(head, false).is_err());
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
