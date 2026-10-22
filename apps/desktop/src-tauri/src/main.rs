#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod discord;
mod hosting;
mod lifecycle;
mod networking;
mod overlay;
mod session;
mod updates;
use tauri::Manager;

fn main() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let mut builder = tauri::Builder::default();
    // Acceptance runs intentionally use independent app profiles. Production is
    // one instance, so invitations cannot silently create a second document.
    if !(cfg!(debug_assertions)
        && std::env::var_os("VEIL_TEST_SETTINGS_DIR").is_some()
        && std::env::var_os("VEIL_TEST_SINGLE_INSTANCE").is_none())
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }
    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .manage(hosting::Hosting::default())
        .manage(networking::Networking::default())
        .manage(updates::Updates::default())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            overlay::setup(app)?;
            updates::setup(app.handle())?;
            lifecycle::setup(app)?;
            discord::setup(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            lifecycle::app_quit,
            discord::discord_preferences,
            discord::discord_configure,
            discord::discord_update,
            overlay::overlay_snapshot,
            overlay::overlay_update,
            overlay::overlay_capture_check,
            overlay::overlay_capture_test,
            overlay::overlay_visibility,
            overlay::overlay_recover,
            overlay::overlay_reset_position,
            overlay::overlay_gesture,
            session::document_relay,
            session::document_open,
            session::document_closed,
            hosting::host_start,
            hosting::host_stop,
            hosting::host_status,
            networking::network_preferences,
            networking::network_configure,
            networking::network_forget,
            networking::network_test,
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
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    if overlay::close_behavior(window.app_handle())
                        == lifecycle::CloseBehavior::Quit
                    {
                        lifecycle::quit_immediately(window.app_handle());
                        return;
                    }
                    // A pending WebView focus restoration (for example after a dialog)
                    // can show a hidden normal window again. Minimize before hiding;
                    // tray reopening explicitly restores the window.
                    let _ = window.minimize();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build Veil desktop")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                discord::shutdown(app);
                overlay::flush(app);
            }
        });
}
