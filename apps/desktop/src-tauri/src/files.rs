//! Control-panel-only Markdown files and opt-in local workspace recovery.
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::Mutex;

const LIMIT: u64 = 16 * 1024 * 1024;
static NEXT_FILE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
struct Entry {
    path: PathBuf,
    bytes: Vec<u8>,
}

#[derive(Default)]
pub struct Files {
    entries: Mutex<HashMap<String, Entry>>,
    pending: std::sync::Mutex<Vec<PathBuf>>,
    recovery: Mutex<()>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFile {
    id: String,
    path: String,
    content: String,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SaveResult {
    Cancelled,
    Conflict,
    Saved { file: OpenFile },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveRequest {
    file_id: Option<String>,
    content: String,
    suggested_name: String,
    save_as: bool,
    overwrite: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecoveryTab {
    pub id: String,
    pub path: Option<String>,
    pub markdown: String,
    pub dirty: bool,
    #[serde(default)]
    pub baseline: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Workspace {
    pub tabs: Vec<RecoveryTab>,
    pub active_id: String,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Recovery {
    enabled: bool,
    workspace: Option<Workspace>,
}

#[derive(Serialize)]
pub struct RecoverySnapshot {
    enabled: bool,
    workspace: Option<Workspace>,
    warning: Option<String>,
}

fn authorize(caller: &WebviewWindow) -> Result<(), String> {
    if caller.label() == "main" {
        Ok(())
    } else {
        Err("Only the control panel can manage document files.".into())
    }
}

fn markdown_path(path: &Path) -> Result<(), String> {
    if path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
    {
        Ok(())
    } else {
        Err("Choose a Markdown (.md) file.".into())
    }
}

fn read(path: &Path) -> Result<Vec<u8>, String> {
    let file = std::fs::File::open(path)
        .map_err(|_| "Could not open the file. Check that it exists and you have permission.")?;
    let mut bytes = Vec::new();
    file.take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Could not read the file.")?;
    if bytes.len() as u64 > LIMIT {
        return Err("The file exceeds Veil's 16 MiB document limit.".into());
    }
    Ok(bytes)
}

fn text(bytes: &[u8]) -> Result<String, String> {
    String::from_utf8(bytes.to_vec())
        .map(|s| s.trim_start_matches('\u{feff}').to_owned())
        .map_err(|_| {
            "This file is not UTF-8 Markdown. Convert its encoding before opening it.".into()
        })
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Choose a valid folder.")?;
    let mut file = tempfile::NamedTempFile::new_in(parent)
        .map_err(|_| "Could not create a file in this folder.")?;
    file.write_all(bytes)
        .and_then(|()| file.flush())
        .and_then(|()| file.as_file().sync_all())
        .map_err(|_| "Could not write the file. Check permissions and available disk space.")?;
    file.persist(path)
        .map_err(|_| "Could not replace the file. It may be read-only or in use.")?;
    Ok(())
}

fn unchanged(path: &Path, baseline: &[u8]) -> bool {
    read(path).is_ok_and(|bytes| bytes == baseline)
}

fn response(id: String, entry: &Entry) -> Result<OpenFile, String> {
    let display = entry.path.to_string_lossy();
    let path = if let Some(unc) = display.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else {
        display.strip_prefix(r"\\?\").unwrap_or(&display).to_owned()
    };
    Ok(OpenFile {
        id,
        path,
        content: text(&entry.bytes)?,
    })
}

#[tauri::command]
pub async fn file_open(
    app: AppHandle,
    caller: WebviewWindow,
    state: State<'_, Files>,
    path: Option<String>,
) -> Result<Option<OpenFile>, String> {
    authorize(&caller)?;
    let path = match path {
        Some(path) => PathBuf::from(path),
        None => match app
            .dialog()
            .file()
            .set_parent(&caller)
            .add_filter("Markdown", &["md"])
            .blocking_pick_file()
        {
            Some(path) => path.into_path().map_err(|_| "Choose a local file.")?,
            None => return Ok(None),
        },
    };
    markdown_path(&path)?;
    let path = path
        .canonicalize()
        .map_err(|_| "This file is no longer available.")?;
    let mut entries = state.entries.lock().await;
    if let Some((id, entry)) = entries.iter().find(|(_, entry)| entry.path == path) {
        return response(id.clone(), entry).map(Some);
    }
    let entry = Entry {
        bytes: read(&path)?,
        path,
    };
    let id = format!("file-{}", NEXT_FILE.fetch_add(1, Ordering::Relaxed));
    let result = response(id.clone(), &entry)?;
    entries.insert(id, entry);
    Ok(Some(result))
}

#[tauri::command]
pub async fn file_save(
    app: AppHandle,
    caller: WebviewWindow,
    state: State<'_, Files>,
    request: SaveRequest,
) -> Result<SaveResult, String> {
    authorize(&caller)?;
    let SaveRequest {
        file_id,
        content,
        suggested_name,
        save_as,
        overwrite,
    } = request;
    if content.len() as u64 > LIMIT {
        return Err("The document exceeds Veil's 16 MiB limit.".into());
    }
    let previous = {
        let entries = state.entries.lock().await;
        file_id
            .as_ref()
            .map(|id| {
                entries
                    .get(id)
                    .cloned()
                    .ok_or("This file is no longer open.")
            })
            .transpose()?
    };
    let path = if save_as || previous.is_none() {
        let mut dialog = app
            .dialog()
            .file()
            .set_parent(&caller)
            .add_filter("Markdown", &["md"])
            .set_file_name(&suggested_name);
        if let Some(entry) = &previous {
            if let Some(parent) = entry.path.parent() {
                dialog = dialog.set_directory(parent);
            }
        }
        match dialog.blocking_save_file() {
            Some(path) => {
                let mut path = path.into_path().map_err(|_| "Choose a local file.")?;
                if path.extension().is_none() {
                    path.set_extension("md");
                }
                path
            }
            None => return Ok(SaveResult::Cancelled),
        }
    } else {
        previous
            .as_ref()
            .ok_or("Choose a file location.")?
            .path
            .clone()
    };
    markdown_path(&path)?;
    let path = if path.exists() {
        path.canonicalize()
            .map_err(|_| "Could not access the selected file.")?
    } else {
        path.parent()
            .ok_or("Choose a folder.")?
            .canonicalize()
            .map_err(|_| "This folder is unavailable.")?
            .join(path.file_name().ok_or("Choose a filename.")?)
    };
    let mut entries = state.entries.lock().await;
    if entries
        .iter()
        .any(|(id, entry)| Some(id) != file_id.as_ref() && entry.path == path)
    {
        return Err(
            "This file is already open in another tab. Choose a different filename.".into(),
        );
    }
    if !save_as && !overwrite {
        if let Some(entry) = &previous {
            if !unchanged(&path, &entry.bytes) {
                return Ok(SaveResult::Conflict);
            }
        }
    }
    atomic_write(&path, content.as_bytes())?;
    let id =
        file_id.unwrap_or_else(|| format!("file-{}", NEXT_FILE.fetch_add(1, Ordering::Relaxed)));
    let entry = Entry {
        path,
        bytes: content.into_bytes(),
    };
    let file = response(id.clone(), &entry)?;
    entries.insert(id, entry);
    Ok(SaveResult::Saved { file })
}

#[tauri::command]
pub async fn file_release(
    caller: WebviewWindow,
    state: State<'_, Files>,
    file_id: String,
) -> Result<(), String> {
    authorize(&caller)?;
    state.entries.lock().await.remove(&file_id);
    Ok(())
}

fn recovery_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "Local recovery folder is unavailable.")?;
    #[cfg(debug_assertions)]
    let directory = std::env::var_os("VEIL_TEST_SETTINGS_DIR")
        .map(PathBuf::from)
        .unwrap_or(directory);
    std::fs::create_dir_all(&directory).map_err(|_| "Could not create the recovery folder.")?;
    Ok(directory.join("workspace.json"))
}

fn load_recovery(app: &AppHandle) -> Result<Recovery, String> {
    let path = recovery_path(app)?;
    if !path.exists() {
        return Ok(Recovery::default());
    }
    let bytes = read(&path)?;
    serde_json::from_slice(&bytes).map_err(|_| {
        "Saved workspace recovery is damaged. Existing files have not been changed.".into()
    })
}

#[tauri::command]
pub async fn workspace_load(
    app: AppHandle,
    caller: WebviewWindow,
    state: State<'_, Files>,
) -> Result<RecoverySnapshot, String> {
    authorize(&caller)?;
    let _guard = state.recovery.lock().await;
    Ok(match load_recovery(&app) {
        Ok(recovery) => RecoverySnapshot {
            enabled: recovery.enabled,
            workspace: recovery.workspace,
            warning: None,
        },
        Err(warning) => RecoverySnapshot {
            enabled: false,
            workspace: None,
            warning: Some(warning),
        },
    })
}

#[tauri::command]
pub async fn workspace_store(
    app: AppHandle,
    caller: WebviewWindow,
    state: State<'_, Files>,
    enabled: bool,
    workspace: Option<Workspace>,
) -> Result<(), String> {
    authorize(&caller)?;
    let _guard = state.recovery.lock().await;
    let recovery = Recovery {
        enabled,
        workspace: if enabled { workspace } else { None },
    };
    let bytes =
        serde_json::to_vec(&recovery).map_err(|_| "Could not prepare workspace recovery.")?;
    if bytes.len() as u64 > LIMIT {
        return Err(
            "Workspace recovery exceeds 16 MiB. Save documents to files to keep them.".into(),
        );
    }
    let path = recovery_path(&app)?;
    // Keep damaged recovery available for manual recovery before replacing it.
    if !enabled {
        // These are only backups created by this module, inside the recovery directory.
        for entry in std::fs::read_dir(path.parent().ok_or("Recovery folder is unavailable.")?)
            .map_err(|_| "Could not clear recovery backups.")?
        {
            let entry = entry.map_err(|_| "Could not clear recovery backups.")?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name
                .strip_prefix("workspace-damaged-")
                .and_then(|value| value.strip_suffix(".json"))
                .is_some_and(|stamp| !stamp.is_empty() && stamp.bytes().all(|c| c.is_ascii_digit()))
            {
                std::fs::remove_file(entry.path()).map_err(|_| {
                    "Could not clear a recovery backup. Your current documents are still open."
                })?;
            }
        }
    } else if path.exists() && load_recovery(&app).is_err() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| "Could not back up damaged recovery.")?
            .as_nanos();
        std::fs::rename(
            &path,
            path.with_file_name(format!("workspace-damaged-{stamp}.json")),
        )
        .map_err(|_| "Could not back up damaged recovery. Existing recovery was preserved.")?;
    }
    atomic_write(&path, &bytes)
}

pub fn receive_paths(app: &AppHandle, args: impl IntoIterator<Item = String>, cwd: &Path) {
    let paths: Vec<PathBuf> = args
        .into_iter()
        .filter(|arg| !arg.starts_with('-'))
        .map(PathBuf::from)
        .filter(|path| markdown_path(path).is_ok())
        .map(|path| {
            if path.is_absolute() {
                path
            } else {
                cwd.join(path)
            }
        })
        .collect();
    if let Some(files) = app.try_state::<Files>() {
        if let Ok(mut pending) = files.pending.lock() {
            pending.extend(paths);
        }
        let _ = app.emit_to("main", "files-pending", ());
    }
}

#[tauri::command]
pub fn file_pending(caller: WebviewWindow, state: State<'_, Files>) -> Result<Vec<String>, String> {
    authorize(&caller)?;
    let mut pending = state
        .pending
        .lock()
        .map_err(|_| "Could not receive file paths.")?;
    Ok(pending
        .drain(..)
        .map(|path| path.to_string_lossy().into())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_replacement_keeps_unicode_and_detects_external_edits() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("Réunion 日本語.md");
        atomic_write(&path, b"before").unwrap();
        assert!(unchanged(&path, b"before"));
        std::fs::write(&path, b"external change").unwrap();
        assert!(!unchanged(&path, b"before"));
        atomic_write(&path, "# Réunion\n".as_bytes()).unwrap();
        assert_eq!(text(&read(&path).unwrap()).unwrap(), "# Réunion\n");
        std::fs::remove_file(&path).unwrap();
        assert!(!unchanged(&path, b"before"));
    }

    #[test]
    fn failed_atomic_write_does_not_truncate_the_existing_document() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("notes.md");
        std::fs::write(&path, b"keep this").unwrap();
        assert!(atomic_write(&path.join("invalid.md"), b"replacement").is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"keep this");
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn encoding_size_and_extension_failures_are_explicit() {
        assert!(text(&[0xff, 0xfe]).is_err());
        assert_eq!(text(b"\xef\xbb\xbf# Title").unwrap(), "# Title");
        assert!(markdown_path(Path::new("notes.MD")).is_ok());
        assert!(markdown_path(Path::new("notes.exe")).is_err());
        let file = tempfile::NamedTempFile::new().unwrap();
        file.as_file().set_len(LIMIT + 1).unwrap();
        assert!(read(file.path()).unwrap_err().contains("16 MiB"));
    }

    #[test]
    fn recovery_rejects_unexpected_session_or_credential_fields() {
        assert!(serde_json::from_str::<Recovery>(
            r#"{"enabled":true,"workspace":null,"ticket":"secret"}"#
        )
        .is_err());
        assert!(serde_json::from_str::<RecoveryTab>(
            r#"{"id":"a","path":null,"markdown":"notes","dirty":true,"invitation":"secret"}"#
        )
        .is_err());
    }
}
