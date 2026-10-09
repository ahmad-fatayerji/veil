#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod hosting;
mod overlay;
mod session;
mod updates;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .manage(hosting::Hosting::default())
        .manage(updates::Updates::default())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(overlay::setup)
        .invoke_handler(tauri::generate_handler![
            overlay::overlay_snapshot,
            overlay::overlay_update,
            overlay::overlay_visibility,
            overlay::overlay_recover,
            overlay::overlay_reset_position,
            overlay::overlay_gesture,
            session::document_relay,
            hosting::host_start,
            hosting::host_stop,
            hosting::host_status,
            updates::update_status,
            updates::update_check,
            updates::update_install,
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
