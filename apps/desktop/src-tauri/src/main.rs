#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod overlay;
mod session;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(overlay::setup)
        .invoke_handler(tauri::generate_handler![
            overlay::overlay_snapshot,
            overlay::overlay_update,
            overlay::overlay_visibility,
            overlay::overlay_recover,
            overlay::overlay_reset_position,
            overlay::overlay_gesture,
            session::document_relay,
        ])
        .on_window_event(|window, event| {
            if window.label() == "main"
                && matches!(event, tauri::WindowEvent::CloseRequested { .. })
            {
                window.app_handle().exit(0);
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build Veil desktop")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                overlay::flush(app);
            }
        });
}
