use crate::{hosting::Hosting, overlay};
use serde::{Deserialize, Serialize};
use std::{io::Write, path::PathBuf, time::Duration};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::Mutex;

#[derive(Default)]
pub struct Gate {
    pub document_active: bool,
    pub installing: bool,
}
impl Gate {
    pub fn allow_install(&self, hosting: bool) -> Result<(), String> {
        if self.document_active || hosting {
            Err("End or leave the current session before installing an update. Documents are not saved automatically.".into())
        } else if self.installing {
            Err("An update is already installing.".into())
        } else {
            Ok(())
        }
    }
    pub fn allow_session(&self) -> Result<(), String> {
        if self.installing {
            Err("Wait until the update finishes before starting a session.".into())
        } else {
            Ok(())
        }
    }
}

#[derive(Default)]
pub struct Updates {
    pub gate: Mutex<Gate>,
    operation: Mutex<()>,
    candidate: Mutex<Option<Update>>,
}

#[derive(Clone, Copy, Default, Deserialize, Serialize, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Channel {
    #[default]
    Stable,
    Beta,
}
impl Channel {
    fn endpoint(self) -> &'static str {
        match self {
            Self::Stable => {
                "https://github.com/ahmad-fatayerji/veil/releases/latest/download/latest.json"
            }
            Self::Beta => {
                "https://raw.githubusercontent.com/ahmad-fatayerji/veil/main/updates/beta.json"
            }
        }
    }
}
fn channel_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app.path().app_config_dir().map_err(|e| e.to_string())?;
    #[cfg(debug_assertions)]
    let directory = std::env::var_os("VEIL_TEST_SETTINGS_DIR")
        .map(PathBuf::from)
        .unwrap_or(directory);
    Ok(directory.join("update-channel.json"))
}
fn load_channel(path: &std::path::Path) -> Result<Channel, String> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|_| "Saved update channel could not be read.".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Channel::Stable),
        Err(e) => Err(e.to_string()),
    }
}
fn save_channel(path: &std::path::Path, channel: Channel) -> Result<(), String> {
    let parent = path.parent().ok_or("Missing settings directory.")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    file.write_all(&serde_json::to_vec(&channel).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    current_version: String,
    available_version: Option<String>,
    notes: Option<String>,
    session_active: bool,
    channel: Channel,
}

fn authorize(caller: &WebviewWindow) -> Result<(), String> {
    if caller.label() == "main" {
        Ok(())
    } else {
        Err("Only the control panel can manage updates.".into())
    }
}

#[tauri::command]
pub async fn update_status(
    app: AppHandle,
    caller: WebviewWindow,
    state: State<'_, Updates>,
) -> Result<UpdateInfo, String> {
    authorize(&caller)?;
    let gate = state.gate.lock().await;
    let session_active = gate.document_active || app.state::<Hosting>().is_active().await;
    let candidate = state.candidate.lock().await;
    Ok(UpdateInfo {
        current_version: app.package_info().version.to_string(),
        available_version: candidate.as_ref().map(|u| u.version.clone()),
        notes: candidate.as_ref().and_then(|u| u.body.clone()),
        session_active,
        channel: load_channel(&channel_path(&app)?)?,
    })
}

#[tauri::command]
pub async fn update_set_channel(
    app: AppHandle,
    caller: WebviewWindow,
    state: State<'_, Updates>,
    channel: Channel,
) -> Result<UpdateInfo, String> {
    authorize(&caller)?;
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| "An update operation is already running.")?;
    save_channel(&channel_path(&app)?, channel)?;
    *state.candidate.lock().await = None;
    update_status(app, caller, state.clone()).await
}

#[tauri::command]
pub async fn update_check(
    app: AppHandle,
    caller: WebviewWindow,
    state: State<'_, Updates>,
) -> Result<UpdateInfo, String> {
    authorize(&caller)?;
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| "An update operation is already running.")?;
    // No startup polling: network access occurs only after an explicit click.
    *state.candidate.lock().await = None;
    let candidate = app
        .updater_builder()
        .endpoints(vec![load_channel(&channel_path(&app)?)?
            .endpoint()
            .parse::<tauri::Url>()
            .map_err(|e| e.to_string())?])
        .map_err(|e| e.to_string())?
        .configure_client(|client| client.https_only(true))
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|_| "Unable to check releases. Check internet access and try again.")?;
    if let Some(ref update) = candidate {
        if update.download_url.scheme() != "https" {
            return Err("The release download must use HTTPS.".into());
        }
    }
    *state.candidate.lock().await = candidate;
    update_status(app, caller, state.clone()).await
}

#[tauri::command]
pub async fn update_install(
    app: AppHandle,
    caller: WebviewWindow,
    state: State<'_, Updates>,
) -> Result<(), String> {
    authorize(&caller)?;
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| "An update operation is already running.")?;
    let mut gate = state.gate.lock().await;
    gate.allow_install(app.state::<Hosting>().is_active().await)?;
    let candidate = state
        .candidate
        .lock()
        .await
        .clone()
        .ok_or("Check for an update first.")?;
    gate.installing = true;
    drop(gate);
    let result: Result<(), String> = async {
        // Tauri verifies the package signature before returning these bytes.
        let bytes = candidate.download(|_, _| {}, || {}).await.map_err(|_| {
            "Download or signature verification failed. The update was not installed."
        })?;
        overlay::flush_checked(&app)
            .map_err(|_| "Could not save local preferences. The update was not installed.")?;
        // Windows updater starts the installer and relaunches Veil after success.
        candidate
            .install(bytes)
            .map_err(|e| format!("Could not start the update installer: {e}"))
    }
    .await;
    state.gate.lock().await.installing = false;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn channels_persist_and_use_separate_fixed_https_feeds() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("update-channel.json");
        assert_eq!(load_channel(&path).unwrap(), Channel::Stable);
        save_channel(&path, Channel::Beta).unwrap();
        assert_eq!(load_channel(&path).unwrap(), Channel::Beta);
        save_channel(&path, Channel::Stable).unwrap();
        assert_eq!(load_channel(&path).unwrap(), Channel::Stable);
        assert_ne!(Channel::Stable.endpoint(), Channel::Beta.endpoint());
        assert!(Channel::Beta.endpoint().starts_with("https://"));
        std::fs::write(&path, b"\"unknown\"").unwrap();
        assert!(load_channel(&path).is_err());
    }
    #[test]
    fn updates_never_replace_active_documents_or_hosts() {
        let mut gate = Gate::default();
        assert!(gate.allow_install(false).is_ok());
        assert!(gate.allow_install(true).is_err());
        gate.document_active = true;
        assert!(gate.allow_install(false).is_err());
        gate.document_active = false;
        gate.installing = true;
        assert!(gate.allow_install(false).is_err());
        assert!(gate.allow_session().is_err());
    }
}
