#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_icon;
#[cfg(windows)]
mod browser_shortcuts;
mod discord;
mod hosting;
mod lifecycle;
mod networking;
mod overlay;
mod session;
mod startup;
mod updates;
use tauri::Manager;

fn main() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let mut builder = tauri::Builder::default();
    #[cfg(windows)]
    {
        builder = builder.plugin(browser_shortcuts::init());
    }
    let background_launch = startup::is_background_launch(&std::env::args().collect::<Vec<_>>());
    // Acceptance runs intentionally use independent app profiles. Production is
    // one instance, so invitations cannot silently create a second document.
    if !(cfg!(debug_assertions)
        && std::env::var_os("VEIL_TEST_SETTINGS_DIR").is_some()
        && std::env::var_os("VEIL_TEST_SINGLE_INSTANCE").is_none())
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if startup::is_background_launch(&args) {
                return;
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }
    #[cfg(windows)]
    {
        builder = builder.plugin(browser_shortcuts::init());
        builder = builder.plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("Veil")
                .args(["--autostart"])
                .build(),
        );
    }
    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .manage(hosting::Hosting::default())
        .manage(networking::Networking::default())
        .manage(updates::Updates::default())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            overlay::setup(app, background_launch)?;
            updates::setup(app.handle())?;
            lifecycle::setup(app)?;
            discord::setup(app.handle())?;
            if !background_launch {
                lifecycle::show_main(app.handle())?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            lifecycle::app_quit,
            app_icon::app_set_icon_theme,
            startup::startup_status,
            startup::startup_configure,
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
            if let tauri::WindowEvent::ScaleFactorChanged { .. } = event {
                app_icon::scale_changed(window);
            }
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
