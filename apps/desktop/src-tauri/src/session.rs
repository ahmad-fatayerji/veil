use serde_json::Value;
use tauri::{AppHandle, Emitter, WebviewWindow};

// In-process relay only. The main window owns the authenticated network connection.
// No document contents or credentials are written to device preferences.
// Run outside the UI thread: initial WebView IPC can arrive during window creation.
#[tauri::command]
pub async fn document_relay(
    app: AppHandle,
    caller: WebviewWindow,
    message: Value,
) -> Result<(), String> {
    let target = match caller.label() {
        "main" => "overlay",
        "overlay" => "main",
        _ => return Err("Unknown desktop window.".into()),
    };
    if serde_json::to_vec(&message)
        .map_err(|e| e.to_string())?
        .len()
        > 16 * 1024 * 1024
    {
        return Err("Document relay message is too large.".into());
    }
    app.emit_to(target, "desktop-document", message)
        .map_err(|e| e.to_string())
}
