use serde::Serialize;
use std::{
    fs, io,
    path::{Component, Path},
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub(crate) enum Transfer {
    Unchanged,
    Conflict {
        path: String,
    },
    Finished {
        path: String,
        moved: bool,
        directory: bool,
    },
}

#[cfg(windows)]
fn wide(path: &Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    path.as_os_str().encode_wide().chain(Some(0)).collect()
}

#[cfg(windows)]
fn same_volume(source: &Path, destination: &Path) -> io::Result<bool> {
    use windows::{core::PCWSTR, Win32::Storage::FileSystem::GetVolumePathNameW};
    fn volume(path: &Path) -> io::Result<String> {
        let mut root = vec![0; 32768];
        unsafe { GetVolumePathNameW(PCWSTR(wide(path).as_ptr()), &mut root) }
            .map_err(|error| io::Error::other(error.to_string()))?;
        let end = root
            .iter()
            .position(|&value| value == 0)
            .unwrap_or(root.len());
        Ok(String::from_utf16_lossy(&root[..end]).to_lowercase())
    }
    Ok(volume(source)? == volume(destination)?)
}

#[cfg(unix)]
fn same_volume(source: &Path, destination: &Path) -> io::Result<bool> {
    use std::os::unix::fs::MetadataExt;
    Ok(fs::metadata(source)?.dev() == fs::metadata(destination)?.dev())
}

#[cfg(windows)]
fn move_entry(source: &Path, target: &Path) -> io::Result<()> {
    use windows::{
        core::PCWSTR,
        Win32::Storage::FileSystem::{MoveFileExW, MOVE_FILE_FLAGS},
    };
    unsafe {
        MoveFileExW(
            PCWSTR(wide(source).as_ptr()),
            PCWSTR(wide(target).as_ptr()),
            MOVE_FILE_FLAGS(0),
        )
    }
    .map_err(|error| io::Error::from_raw_os_error(error.code().0 & 0xffff))
}

#[cfg(not(windows))]
fn move_entry(source: &Path, target: &Path) -> io::Result<()> {
    if target.symlink_metadata().is_ok() {
        return Err(io::ErrorKind::AlreadyExists.into());
    }
    fs::rename(source, target)
}

fn copy_contents(source: &Path, target: &Path) -> io::Result<()> {
    let metadata = source.symlink_metadata()?;
    #[cfg(windows)]
    let reparse = {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    };
    #[cfg(not(windows))]
    let reparse = false;
    if metadata.is_symlink() || reparse {
        return Err(io::Error::other("Copying symbolic links is unsupported"));
    }
    if metadata.is_dir() {
        fs::create_dir(target)?;
        for entry in fs::read_dir(source)? {
            let entry = entry?;
            copy_contents(&entry.path(), &target.join(entry.file_name()))?;
        }
        fs::set_permissions(target, metadata.permissions())
    } else if metadata.is_file() {
        fs::copy(source, target).map(|_| ())
    } else {
        Err(io::Error::other("Unsupported file type"))
    }
}

fn transfer(
    source: &Path,
    directory: &Path,
    name: Option<&str>,
    effect: Option<&str>,
) -> io::Result<Transfer> {
    let visible_directory = directory.to_owned();
    let source_name = source
        .file_name()
        .ok_or_else(|| io::Error::other("Invalid source path"))?;
    if source.symlink_metadata()?.is_symlink() {
        return Err(io::Error::other("Symbolic link transfers are unsupported"));
    }
    let source = source.canonicalize()?;
    let directory = directory.canonicalize()?;
    let is_directory = source.is_dir();
    if !directory.is_dir() || (is_directory && directory.starts_with(&source)) {
        return Err(io::Error::other("Invalid destination directory"));
    }
    let filename = match name {
        Some(name)
            if !name.is_empty()
                && !name.contains(['/', '\\', ':'])
                && matches!(
                    Path::new(name).components().next(),
                    Some(Component::Normal(_))
                ) =>
        {
            Path::new(name).as_os_str()
        }
        Some(_) => return Err(io::Error::other("Invalid filename")),
        None => source_name,
    };
    let target = directory.join(filename);
    if target.canonicalize().is_ok_and(|path| path == source) && effect != Some("copy") {
        return Ok(Transfer::Unchanged);
    }
    let path = visible_directory
        .join(filename)
        .to_string_lossy()
        .into_owned();
    match target.symlink_metadata() {
        Ok(_) => return Ok(Transfer::Conflict { path }),
        Err(error) if error.kind() == io::ErrorKind::NotFound => (),
        Err(error) => return Err(error),
    }
    let same = same_volume(&source, &directory)?;
    let moved = same && effect != Some("copy");
    let result = if moved {
        move_entry(&source, &target)
    } else {
        let staging = tempfile::tempdir_in(&directory)?;
        let copy = staging.path().join("entry");
        copy_contents(&source, &copy)?;
        move_entry(&copy, &target)
    };
    match result {
        Ok(()) => Ok(Transfer::Finished {
            path,
            moved,
            directory: is_directory,
        }),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            Ok(Transfer::Conflict { path })
        }
        Err(error) => Err(error),
    }
}

#[tauri::command]
pub(crate) async fn transfer_dropped_entry(
    source: String,
    directory: String,
    name: Option<String>,
    effect: Option<String>,
) -> Result<Transfer, String> {
    tauri::async_runtime::spawn_blocking(move || {
        transfer(
            Path::new(&source),
            Path::new(&directory),
            name.as_deref(),
            effect.as_deref(),
        )
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}

#[cfg(windows)]
pub(crate) fn shell_drag(handle: isize, path: &Path) -> Result<bool, String> {
    use windows::{
        core::PCWSTR,
        Win32::{
            Foundation::HWND,
            System::{
                Com::IDataObject,
                Ole::{OleInitialize, OleUninitialize, DROPEFFECT_COPY, DROPEFFECT_MOVE},
            },
            UI::Shell::{BHID_DataObject, IShellItem, SHCreateItemFromParsingName, SHDoDragDrop},
        },
    };
    struct Ole;
    impl Drop for Ole {
        fn drop(&mut self) {
            unsafe { OleUninitialize() };
        }
    }
    let wide_path = wide(path);
    unsafe {
        OleInitialize(None).map_err(|error| error.to_string())?;
        let _ole = Ole;
        let item: IShellItem = SHCreateItemFromParsingName(PCWSTR(wide_path.as_ptr()), None)
            .map_err(|error| error.to_string())?;
        let object: IDataObject = item
            .BindToHandler(None, &BHID_DataObject)
            .map_err(|error| error.to_string())?;
        if let Err(error) = hide_shell_thumbnail(&object) {
            log::debug!("[file drop] Could not hide the system drag thumbnail: {error}");
        }
        let effect = SHDoDragDrop(
            Some(HWND(handle as *mut _)),
            &object,
            None,
            DROPEFFECT_COPY | DROPEFFECT_MOVE,
        )
        .map_err(|error| error.to_string())?;
        // Explorer can complete an optimized move and report no move effect.
        Ok(effect.0 & DROPEFFECT_MOVE.0 != 0
            || path
                .symlink_metadata()
                .is_err_and(|error| error.kind() == io::ErrorKind::NotFound))
    }
}

#[cfg(windows)]
fn hide_shell_thumbnail(
    object: &windows::Win32::System::Com::IDataObject,
) -> windows::core::Result<()> {
    use windows::Win32::{
        Foundation::{COLORREF, POINT, SIZE},
        Graphics::Gdi::{CreateDIBSection, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS},
        System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER},
        UI::Shell::{CLSID_DragDropHelper, IDragSourceHelper, SHDRAGIMAGE},
    };

    // The existing click-through drag preview window supplies the drag image.
    let bitmap_info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: 1,
            biHeight: -1,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut pixels = std::ptr::null_mut();
    // The drag-image helper takes ownership of the HBITMAP.
    unsafe {
        let helper: IDragSourceHelper =
            CoCreateInstance(&CLSID_DragDropHelper, None, CLSCTX_INPROC_SERVER)?;
        let bitmap = CreateDIBSection(None, &bitmap_info, DIB_RGB_COLORS, &mut pixels, None, 0)?;
        pixels.cast::<u32>().write(0);
        helper.InitializeFromBitmap(
            &SHDRAGIMAGE {
                sizeDragImage: SIZE { cx: 1, cy: 1 },
                ptOffset: POINT { x: 0, y: 0 },
                hbmpDragImage: bitmap,
                crColorKey: COLORREF(0xffffffff),
            },
            object,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn moving_a_directory_keeps_its_contents_and_refuses_to_overwrite() -> io::Result<()> {
        let root = tempfile::tempdir()?;
        let target = root.path().join("target");
        let source = root.path().join("folder");
        fs::create_dir(&target)?;
        fs::create_dir(&source)?;
        fs::create_dir(target.join("folder"))?;
        fs::write(source.join("note.md"), b"file to move")?;
        fs::write(target.join("folder").join("note.md"), b"existing file")?;

        assert!(matches!(
            transfer(&source, &target, None, None)?,
            Transfer::Conflict { .. }
        ));
        assert_eq!(
            fs::read(target.join("folder").join("note.md"))?,
            b"existing file"
        );
        assert!(matches!(
            transfer(&source, &target, Some("folder (2)"), None)?,
            Transfer::Finished {
                moved: true,
                directory: true,
                ..
            }
        ));
        assert!(!source.exists());
        assert_eq!(
            fs::read(target.join("folder (2)").join("note.md"))?,
            b"file to move"
        );
        Ok(())
    }

    #[test]
    fn copying_a_file_preserves_the_source() -> io::Result<()> {
        let root = tempfile::tempdir()?;
        let source = root.path().join("note.md");
        let target = root.path().join("target");
        fs::create_dir(&target)?;
        fs::write(&source, b"file to copy")?;

        assert!(matches!(
            transfer(&source, &target, None, Some("copy"))?,
            Transfer::Finished {
                moved: false,
                directory: false,
                ..
            }
        ));
        assert_eq!(fs::read(&source)?, fs::read(target.join("note.md"))?);
        Ok(())
    }
}
