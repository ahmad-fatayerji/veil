use tauri::{State, WebviewWindow};
use tokio::sync::Mutex;
use veil_host::{HostConfig, HostInfo, HostedSession};

#[derive(Default)]
pub struct Hosting(Mutex<Option<HostedSession>>);

impl Hosting {
    /// Callers hold the update gate, which quitting also needs, so never wait here.
    /// A held lock means a host is starting or stopping, which counts as active.
    pub fn is_active(&self) -> bool {
        self.0.try_lock().map_or(true, |session| session.is_some())
    }
}

fn authorize(caller: &WebviewWindow) -> Result<(), String> {
    if caller.label() == "main" {
        Ok(())
    } else {
        Err("Only the control panel can manage hosting.".into())
    }
}

#[tauri::command]
pub async fn host_start(
    updates: State<'_, crate::updates::Updates>,
    caller: WebviewWindow,
    state: State<'_, Hosting>,
    config: HostConfig,
) -> Result<HostInfo, String> {
    authorize(&caller)?;
    let gate = updates.gate.lock().await;
    gate.allow_session()?;
    let mut session = state.0.lock().await;
    if session.is_some() {
        return Err("A session is already running.".into());
    }
    // The held session lock keeps installs out; release the gate so quitting is not blocked.
    drop(gate);
    let running = veil_host::start_host(config).await?;
    let info = running.info.clone();
    *session = Some(running);
    Ok(info)
}

#[tauri::command]
pub async fn host_stop(caller: WebviewWindow, state: State<'_, Hosting>) -> Result<(), String> {
    authorize(&caller)?;
    let mut session = state.0.lock().await;
    if let Some(running) = session.take() {
        running.stop().await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn host_status(
    caller: WebviewWindow,
    state: State<'_, Hosting>,
) -> Result<Option<HostInfo>, String> {
    authorize(&caller)?;
    Ok(state.0.lock().await.as_ref().map(|s| s.info.clone()))
}
