use crate::{hosting::Hosting, overlay};
use serde::Serialize;
use std::time::Duration;
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    current_version: String,
    available_version: Option<String>,
    notes: Option<String>,
    session_active: bool,
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
    })
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
