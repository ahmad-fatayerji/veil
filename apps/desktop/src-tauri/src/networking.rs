//! Narrow, control-panel-only networking. No general-purpose HTTP proxy or
//! remote origin is added to the WebView CSP. Host credentials never reach JS.
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, Message};

#[derive(Default)]
pub struct Networking {
    socket: Mutex<Option<mpsc::Sender<String>>>,
}
#[derive(Serialize, Deserialize, Default)]
pub struct Preferences {
    server: String,
    #[serde(default, skip_deserializing)]
    development: bool,
    #[serde(default, skip_deserializing)]
    legacy: bool,
}
fn authorize(caller: &WebviewWindow) -> Result<(), String> {
    if caller.label() == "main" {
        Ok(())
    } else {
        Err("Only the control panel can manage networking.".into())
    }
}
fn server_url(value: &str) -> Result<reqwest::Url, String> {
    let url =
        reqwest::Url::parse(value.trim()).map_err(|_| "Enter a valid HTTPS server address.")?;
    let local_debug =
        cfg!(debug_assertions) && url.scheme() == "http" && url.host_str() == Some("127.0.0.1");
    if (url.scheme() != "https" && !local_debug)
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err(
            "Use an HTTPS server origin without a path, credentials, query or fragment.".into(),
        );
    }
    Ok(url)
}
fn identity(value: &str) -> bool {
    value.len() == 32
        && value
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}
fn path_allowed(path: &str, method: &str) -> bool {
    if matches!(
        (method, path),
        ("GET", "/v2/capabilities")
            | ("POST", "/v2/sessions")
            | ("POST", "/v2/join")
            | ("POST", "/v3/join")
            | ("POST", "/v2/relay")
            | ("POST", "/v2/path")
            | ("POST", "/v2/leave")
    ) {
        return true;
    }
    let pieces: Vec<_> = path.split('/').collect();
    (pieces.len() == 5
        && pieces[1] == "v3"
        && pieces[2] == "sessions"
        && identity(pieces[3])
        && pieces[4] == "sharing"
        && matches!(method, "POST" | "DELETE"))
        || (pieces.len() == 4
            && pieces[1] == "v2"
            && pieces[2] == "sessions"
            && identity(pieces[3])
            && method == "DELETE")
        || (pieces.len() == 5
            && pieces[1] == "v2"
            && pieces[2] == "sessions"
            && identity(pieces[3])
            && pieces[4] == "invitations"
            && method == "POST")
}
fn entry(server: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new("dev.veil.desktop.networking", server)
        .map_err(|_| "Credential store is unavailable.".into())
}
fn settings_directory(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|_| "Settings directory unavailable.")?;
    #[cfg(debug_assertions)]
    let directory = std::env::var_os("VEIL_TEST_SETTINGS_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or(directory);
    Ok(directory)
}
#[tauri::command]
pub async fn network_preferences(
    app: AppHandle,
    caller: WebviewWindow,
) -> Result<Preferences, String> {
    authorize(&caller)?;
    let path = settings_directory(&app)?.join("networking.json");
    let mut preferences: Preferences = match std::fs::read(path) {
        Ok(bytes) => {
            serde_json::from_slice(&bytes).map_err(|_| "Invalid network settings.".to_string())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Preferences::default()),
        Err(_) => Err("Cannot read network settings.".to_string()),
    }?;
    preferences.development = cfg!(debug_assertions);
    preferences.legacy =
        cfg!(debug_assertions) && std::env::var("VEIL_TEST_LEGACY").as_deref() == Ok("1");
    Ok(preferences)
}
#[tauri::command]
pub async fn network_configure(
    app: AppHandle,
    caller: WebviewWindow,
    server: String,
    credential: Option<String>,
) -> Result<Preferences, String> {
    authorize(&caller)?;
    let server = server_url(&server)?.origin().ascii_serialization();
    if let Some(secret) = credential {
        if !secret.is_empty() {
            if secret.len() != 64
                || !secret
                    .bytes()
                    .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
            {
                return Err("Invalid operator-issued host credential.".into());
            }
            entry(&server)?
                .set_password(&secret)
                .map_err(|_| "Cannot save the host credential securely.")?;
        }
    }
    let directory = settings_directory(&app)?;
    std::fs::create_dir_all(&directory).map_err(|_| "Cannot create settings directory.")?;
    let preferences = Preferences {
        server,
        development: cfg!(debug_assertions),
        legacy: false,
    };
    let temporary =
        tempfile::NamedTempFile::new_in(&directory).map_err(|_| "Cannot save settings.")?;
    serde_json::to_writer(&temporary, &preferences).map_err(|_| "Cannot encode settings.")?;
    temporary
        .persist(directory.join("networking.json"))
        .map_err(|_| "Cannot save settings.")?;
    Ok(preferences)
}
#[tauri::command]
pub async fn network_forget(caller: WebviewWindow, server: String) -> Result<(), String> {
    authorize(&caller)?;
    let origin = server_url(&server)?.origin().ascii_serialization();
    match entry(&origin)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("Cannot remove the saved host credential.".into()),
    }
}
#[tauri::command]
pub async fn network_request(
    caller: WebviewWindow,
    server: String,
    path: String,
    method: String,
    body: Value,
    ticket: Option<String>,
) -> Result<Value, String> {
    authorize(&caller)?;
    if !path_allowed(&path, &method) {
        return Err("Unsupported network operation.".into());
    }
    let origin = server_url(&server)?;
    let url = origin
        .join(&path)
        .map_err(|_| "Invalid network operation.")?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| "Cannot initialize secure networking.")?;
    let mut request = client.request(
        method
            .parse::<reqwest::Method>()
            .map_err(|_| "Unsupported request method.")?,
        url,
    );
    if path == "/v2/sessions" && method == "POST" {
        let credential = entry(&origin.origin().ascii_serialization())?
            .get_password()
            .map_err(|_| "Configure an operator-issued host credential first.")?;
        request = request.bearer_auth(credential);
    } else if let Some(ticket) = ticket {
        if ticket.len() != 64 || !ticket.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("Invalid session authorization.".into());
        }
        request = request.bearer_auth(ticket);
    }
    if method != "GET" {
        let bytes = serde_json::to_vec(&body).map_err(|_| "Invalid request.")?;
        if bytes.len() > 128 * 1024 {
            return Err("Request is too large.".into());
        }
        request = request
            .header("content-type", "application/json")
            .body(bytes);
    }
    let mut response = request
        .send()
        .await
        .map_err(|_| "Server unavailable or HTTPS certificate invalid.")?;
    let status = response.status();
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Server response interrupted.")?
    {
        if bytes.len() + chunk.len() > 128 * 1024 {
            return Err("Server response exceeds the limit.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    if !status.is_success() {
        return Err(match status.as_u16() {
            401 | 403 => "Server authorization rejected or session ended.",
            429 => "Server or relay capacity unavailable.",
            _ => "Server operation failed.",
        }
        .into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "Invalid server response.".into())
}
#[tauri::command]
pub async fn network_connect(
    caller: WebviewWindow,
    state: State<'_, Networking>,
    updates: State<'_, crate::updates::Updates>,
    server: String,
    session_id: String,
    ticket: String,
    connection_id: String,
) -> Result<(), String> {
    authorize(&caller)?;
    if !identity(&session_id)
        || ticket.len() != 64
        || !ticket.bytes().all(|b| b.is_ascii_hexdigit())
        || !identity(&connection_id)
    {
        return Err("Invalid session connection.".into());
    }
    let mut url = server_url(&server)?;
    let scheme = if url.scheme() == "https" { "wss" } else { "ws" };
    url.set_scheme(scheme)
        .map_err(|_| "Invalid socket scheme.")?;
    url.set_path(&format!("/v2/socket/{session_id}"));
    let mut request = url
        .as_str()
        .into_client_request()
        .map_err(|_| "Cannot create secure signaling connection.")?;
    request.headers_mut().insert(
        "authorization",
        format!("Bearer {ticket}")
            .parse()
            .map_err(|_| "Invalid authorization.")?,
    );
    let configuration = tokio_tungstenite::tungstenite::protocol::WebSocketConfig::default()
        .max_message_size(Some(128 * 1024))
        .max_frame_size(Some(128 * 1024));
    let (socket, _) = tokio::time::timeout(
        Duration::from_secs(15),
        tokio_tungstenite::connect_async_with_config(request, Some(configuration), false),
    )
    .await
    .map_err(|_| "Signaling connection timed out.")?
    .map_err(|e| match e {
        tokio_tungstenite::tungstenite::Error::Http(ref response)
            if matches!(response.status().as_u16(), 401 | 403) =>
        {
            "Session authorization rejected."
        }
        _ => "Signaling unavailable or HTTPS certificate invalid.",
    })?;
    {
        let mut gate = updates.gate.lock().await;
        gate.allow_session()?;
        gate.network_active = true;
    }
    let (tx, mut rx) = mpsc::channel::<String>(128);
    *state.socket.lock().await = Some(tx);
    tauri::async_runtime::spawn(async move {
        let (mut sink, mut source) = socket.split();
        loop {
            tokio::select! {
                outgoing=rx.recv()=>{let Some(outgoing)=outgoing else{let _=tokio::time::timeout(Duration::from_secs(5),sink.close()).await;break;}; if !matches!(tokio::time::timeout(Duration::from_secs(5),sink.send(Message::Text(outgoing.into()))).await,Ok(Ok(()))){break;}}
                incoming=source.next()=>{match incoming{
                    Some(Ok(Message::Text(text)))=>{if let Ok(value)=serde_json::from_str::<Value>(&text){let _=caller.emit("veil:network",serde_json::json!({"connectionId":connection_id,"message":value}));}else{break;}}
                    Some(Ok(Message::Ping(data)))=>{if !matches!(tokio::time::timeout(Duration::from_secs(5),sink.send(Message::Pong(data))).await,Ok(Ok(()))){break;}}
                    Some(Ok(Message::Pong(_)))=>{}
                    _=>break,
                }}
            }
        }
        let _ = caller.emit(
            "veil:network",
            serde_json::json!({"connectionId":connection_id,"message":{"kind":"disconnected"}}),
        );
    });
    Ok(())
}
#[tauri::command]
pub async fn network_send(
    caller: WebviewWindow,
    state: State<'_, Networking>,
    message: Value,
) -> Result<(), String> {
    authorize(&caller)?;
    let bytes = message.to_string();
    if bytes.len() > 128 * 1024 {
        return Err("Signaling message exceeds the limit.".into());
    }
    state
        .socket
        .lock()
        .await
        .as_ref()
        .ok_or("Signaling is disconnected.")?
        .try_send(bytes)
        .map_err(|_| "Signaling queue is full or disconnected.".into())
}
#[tauri::command]
pub async fn network_disconnect(
    caller: WebviewWindow,
    state: State<'_, Networking>,
    updates: State<'_, crate::updates::Updates>,
) -> Result<(), String> {
    authorize(&caller)?;
    state.socket.lock().await.take();
    updates.gate.lock().await.network_active = false;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn endpoints_are_scoped() {
        assert!(path_allowed("/v2/sessions", "POST"));
        assert!(!path_allowed("/v2/metrics", "GET"));
        assert!(!path_allowed("/v2/socket/a", "GET"));
        assert!(!path_allowed("/v2/sessions/../metrics", "DELETE"));
    }
    #[test]
    fn origins_reject_credential_exfiltration() {
        assert!(server_url("https://example.com").is_ok());
        for url in [
            "https://user:secret@example.com",
            "https://example.com/path",
            "https://example.com?token=secret",
            "https://example.com#secret",
            "http://example.com",
        ] {
            assert!(server_url(url).is_err());
        }
    }
}
