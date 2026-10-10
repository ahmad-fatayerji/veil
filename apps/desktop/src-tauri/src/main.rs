#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod hosting;
mod networking;
mod overlay;
mod session;
mod updates;
use tauri::Manager;

fn main() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    tauri::Builder::default()
        .manage(hosting::Hosting::default())
        .manage(networking::Networking::default())
        .manage(updates::Updates::default())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            overlay::setup(app)?;
            updates::setup(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            overlay::overlay_snapshot,
            overlay::overlay_update,
            overlay::overlay_capture_check,
            overlay::overlay_capture_test,
            overlay::overlay_visibility,
            overlay::overlay_recover,
            overlay::overlay_reset_position,
            overlay::overlay_gesture,
            session::document_relay,
            hosting::host_start,
            hosting::host_stop,
            hosting::host_status,
            networking::network_preferences,
            networking::network_configure,
            networking::network_forget,
            networking::network_request,
            networking::network_connect,
            networking::network_send,
            networking::network_disconnect,
            updates::update_status,
            updates::update_check,
            updates::update_install,
            updates::update_set_channel,
            updates::update_cancel,
            updates::update_dismiss_result,
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
