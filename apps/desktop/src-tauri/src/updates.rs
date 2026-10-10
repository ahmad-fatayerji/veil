use crate::{hosting::Hosting, overlay};
use serde::{Deserialize, Serialize};
use std::{
    io::Write,
    path::PathBuf,
    sync::{
        atomic::{AtomicU16, Ordering},
        Arc, Mutex as SyncMutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::{watch, Mutex};

mod download;
mod receipt;

#[derive(Default)]
pub struct Gate {
    pub document_active: bool,
    pub network_active: bool,
    pub installing: bool,
}
impl Gate {
    pub fn allow_install(&self, hosting: bool) -> Result<(), String> {
        if self.document_active || self.network_active || hosting {
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
    transfer: SyncMutex<Transfer>,
    completion: SyncMutex<Option<receipt::Completion>>,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    stage: String,
    downloaded: u64,
    total: Option<u64>,
    attempt: u32,
    retry_at: Option<u64>,
}
impl Progress {
    fn busy(&self) -> bool {
        matches!(
            self.stage.as_str(),
            "checking" | "downloading" | "retrying" | "verifying" | "saving" | "launching"
        )
    }
    fn cancellable(&self) -> bool {
        matches!(
            self.stage.as_str(),
            "downloading" | "retrying" | "verifying"
        )
    }
}
#[derive(Default)]
struct Transfer {
    progress: Progress,
    cancel: Option<watch::Sender<bool>>,
    cooldown_until: Option<u64>,
}
impl Updates {
    fn cooldown(&self) -> Result<(), String> {
        let until = self.transfer.lock().unwrap().cooldown_until;
        if until.is_some_and(|until| until > download::now()) {
            Err(
                "GitHub is limiting requests. Wait for the retry countdown before trying again."
                    .into(),
            )
        } else {
            Ok(())
        }
    }
    fn stage(&self, stage: &str) {
        self.transfer.lock().unwrap().progress.stage = stage.into();
    }
}

pub fn setup(app: &AppHandle) -> Result<(), String> {
    let result = receipt::read(&receipt_path(app)?, &app.package_info().version.to_string());
    *app.state::<Updates>().completion.lock().unwrap() = match result {
        Ok(completion) => completion,
        Err(message) => Some(receipt::Completion {
            success: false,
            message,
        }),
    };
    Ok(())
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
fn receipt_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(channel_path(app)?.with_file_name("update-receipt.json"))
}

// Only debug acceptance can use an isolated loopback HTTPS fixture.
fn endpoint(channel: Channel) -> Result<tauri::Url, String> {
    #[cfg(debug_assertions)]
    if std::env::var_os("VEIL_TEST_SETTINGS_DIR").is_some() {
        if let Ok(url) = std::env::var("VEIL_TEST_UPDATE_URL") {
            let url = tauri::Url::parse(&url).map_err(|e| e.to_string())?;
            if url.scheme() != "https" || url.host_str() != Some("127.0.0.1") {
                return Err("Updater test feeds must use loopback HTTPS.".into());
            }
            return Ok(url);
        }
    }
    channel
        .endpoint()
        .parse::<tauri::Url>()
        .map_err(|e| e.to_string())
}
fn configure_client(client: reqwest::ClientBuilder) -> reqwest::ClientBuilder {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = client
        .https_only(true)
        .connect_timeout(Duration::from_secs(30))
        .retry(reqwest::retry::never());
    #[cfg(debug_assertions)]
    if std::env::var_os("VEIL_TEST_SETTINGS_DIR").is_some() {
        if let Some(path) = std::env::var_os("VEIL_TEST_UPDATE_CA") {
            if let Ok(bytes) = std::fs::read(path) {
                if let Ok(certificate) = reqwest::Certificate::from_pem(&bytes) {
                    return client.add_root_certificate(certificate);
                }
            }
        }
    }
    client
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
    save_json(path, &channel)
}
fn save_json(path: &std::path::Path, value: &impl Serialize) -> Result<(), String> {
    let parent = path.parent().ok_or("Missing settings directory.")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    file.write_all(&serde_json::to_vec(value).map_err(|e| e.to_string())?)
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
    progress: Progress,
    busy: bool,
    can_cancel: bool,
    cooldown_until: Option<u64>,
    completion: Option<receipt::Completion>,
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
    let session_active =
        gate.document_active || gate.network_active || app.state::<Hosting>().is_active().await;
    let candidate = state.candidate.lock().await;
    let transfer = state.transfer.lock().unwrap();
    Ok(UpdateInfo {
        current_version: app.package_info().version.to_string(),
        available_version: candidate.as_ref().map(|u| u.version.clone()),
        notes: candidate.as_ref().and_then(|u| u.body.clone()),
        session_active,
        channel: load_channel(&channel_path(&app)?)?,
        progress: transfer.progress.clone(),
        busy: transfer.progress.busy(),
        can_cancel: transfer.progress.cancellable(),
        cooldown_until: transfer.cooldown_until,
        completion: state.completion.lock().unwrap().clone(),
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
    state.cooldown()?;
    state.stage("checking");
    // No startup polling: network access occurs only after an explicit click.
    *state.candidate.lock().await = None;
    let result = find_candidate(&app, &state).await;
    state.stage("idle");
    let candidate = result?;
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
    state.cooldown()?;
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
    let (cancel, receiver) = watch::channel(false);
    {
        let mut transfer = state.transfer.lock().unwrap();
        transfer.cancel = Some(cancel);
        transfer.progress = Progress {
            stage: "downloading".into(),
            ..Default::default()
        };
    }
    let result = install_candidate(&app, &state, candidate, receiver).await;
    state.gate.lock().await.installing = false;
    let mut transfer = state.transfer.lock().unwrap();
    transfer.cancel = None;
    transfer.progress.stage = "idle".into();
    result
}

async fn find_candidate(app: &AppHandle, state: &Updates) -> Result<Option<Update>, String> {
    let endpoint = endpoint(load_channel(&channel_path(app)?)?)?;
    let host = endpoint.host_str().unwrap_or_default().to_owned();
    let status = Arc::new(AtomicU16::new(0));
    let observed_status = status.clone();
    let result = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| e.to_string())?
        .configure_client(move |client| {
            let status = observed_status.clone();
            configure_client(client).retry(reqwest::retry::for_host(host.clone()).classify_fn(
                move |response| {
                    if let Some(code) = response.status() {
                        status.store(code.as_u16(), Ordering::Relaxed);
                    }
                    // Observe status without adding hidden network retries.
                    response.success()
                },
            ))
        })
        // The default hook destroys windows before attempting ShellExecute. Keep the
        // control panel available if launching fails. We flush preferences explicitly;
        // Windows releases process resources after successful installer handoff.
        .on_before_exit(|| {})
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await;
    if result.is_err() && status.load(Ordering::Relaxed) == 429 {
        // Tauri discards response headers. Without the server deadline, require
        // a conservative manual cooldown rather than automatically retrying.
        state.transfer.lock().unwrap().cooldown_until = Some(download::now().saturating_add(60));
        return Err(
            "GitHub is limiting update checks. Wait at least one minute before trying again."
                .into(),
        );
    }
    result.map_err(|error| match error {
            tauri_plugin_updater::Error::Serialization(_)
            | tauri_plugin_updater::Error::Semver(_)
            | tauri_plugin_updater::Error::TargetsNotFound(_)
            | tauri_plugin_updater::Error::TargetNotFound(_) =>
                "The release information is invalid or does not support this device. Try again after the release is corrected.".into(),
            _ => "Unable to check releases. Check your connection, or wait and retry if GitHub is unavailable or limiting requests.".into(),
        })
}

async fn install_candidate(
    app: &AppHandle,
    state: &Updates,
    candidate: Update,
    receiver: watch::Receiver<bool>,
) -> Result<(), String> {
    let client = configure_client(reqwest::Client::builder())
        .user_agent("Veil updater")
        .build()
        .map_err(|_| "Could not initialize the download client.")?;
    let transfer = download::transfer(
        &client,
        &candidate.download_url,
        download::IDLE_TIMEOUT,
        receiver.clone(),
        |downloaded, total, attempt, retry_at| {
            state.transfer.lock().unwrap().progress = Progress {
                stage: if retry_at.is_some() {
                    "retrying"
                } else {
                    "downloading"
                }
                .into(),
                downloaded,
                total,
                attempt,
                retry_at,
            };
        },
    )
    .await;
    let bytes = match transfer {
        Ok(bytes) => bytes,
        Err(failure) => {
            if let download::Failure::RateLimited(until) = failure {
                state.transfer.lock().unwrap().cooldown_until = Some(until);
            }
            if failure == download::Failure::Http(404) {
                *state.candidate.lock().await = None;
            }
            return Err(failure.message());
        }
    };
    state.stage("verifying");
    let key = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|config| config.get("pubkey"))
        .and_then(|key| key.as_str())
        .ok_or("The updater verification key is missing. The update was not installed.")?;
    if let Err(failure) = download::verify(&bytes, &candidate.signature, key, &candidate.version) {
        *state.candidate.lock().await = None;
        return Err(failure.message());
    }
    {
        let mut transfer = state.transfer.lock().unwrap();
        if *receiver.borrow() {
            return Err(download::Failure::Cancelled.message());
        }
        // Cancellation and handoff share this lock. An accepted cancellation can
        // never race with installation. Cancellation ends before writing preferences.
        transfer.progress.stage = "saving".into();
    }
    overlay::flush_checked(app)
        .map_err(|_| "Could not save local preferences. The update was not installed.")?;
    let path = receipt_path(app)?;
    save_json(
        &path,
        &receipt::Receipt {
            from_version: app.package_info().version.to_string(),
            to_version: candidate.version.clone(),
        },
    )
    .map_err(|_| "Could not save the update recovery record. The update was not installed.")?;
    state.stage("launching");
    // On Windows this exits only after the installer has launched successfully.
    let result = candidate.install(bytes).map_err(|e| {
        format!(
            "Could not start the update installer: {e}. Your installed version has not changed."
        )
    });
    if let Err(error) = result {
        if let Err(cleanup) = receipt::remove(&path) {
            return Err(format!("{error} {cleanup}"));
        }
        return Err(error);
    }
    Ok(())
}

#[tauri::command]
pub async fn update_cancel(caller: WebviewWindow, state: State<'_, Updates>) -> Result<(), String> {
    authorize(&caller)?;
    let transfer = state.transfer.lock().unwrap();
    if !transfer.progress.cancellable() {
        return Err("The installer is starting; cancellation is no longer available.".into());
    }
    transfer
        .cancel
        .as_ref()
        .ok_or("No download is running.")?
        .send(true)
        .map_err(|_| "The download has already finished.".to_string())
}

#[tauri::command]
pub async fn update_dismiss_result(
    app: AppHandle,
    caller: WebviewWindow,
    state: State<'_, Updates>,
) -> Result<(), String> {
    authorize(&caller)?;
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| "Wait for the update operation to finish.")?;
    receipt::remove(&receipt_path(&app)?)?;
    *state.completion.lock().unwrap() = None;
    Ok(())
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
        gate.network_active = true;
        assert!(gate.allow_install(false).is_err());
        gate.network_active = false;
        gate.installing = true;
        assert!(gate.allow_install(false).is_err());
        assert!(gate.allow_session().is_err());
    }
}
