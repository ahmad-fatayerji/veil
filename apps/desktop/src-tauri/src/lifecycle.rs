use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WebviewWindow,
};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum CloseBehavior {
    #[default]
    Tray,
    Quit,
}

struct TrayState {
    overlay: MenuItem<tauri::Wry>,
}

pub fn refresh_overlay_label(app: &AppHandle, visible: bool) {
    if let Some(state) = app.try_state::<TrayState>() {
        let _ = state.overlay.set_text(if visible {
            "Hide overlay"
        } else {
            "Show overlay"
        });
    }
}

pub fn quit_immediately(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = quit(&app).await {
            let _ = show_main(&app);
            let _ = app.emit_to("main", "app-quit-failed", error);
        }
    });
}

fn show_main(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        window.show()?;
        window.unminimize()?;
        window.set_focus()?;
    }
    Ok(())
}

pub fn setup(app: &mut tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Open Veil", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Veil", true, None::<&str>)?;
    let overlay = MenuItem::with_id(app, "overlay", "Show overlay", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &overlay, &quit])?;
    app.manage(TrayState { overlay });
    refresh_overlay_label(app.handle(), crate::overlay::is_visible(app.handle()));
    let mut tray = TrayIconBuilder::with_id("veil")
        .tooltip("Veil")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                let _ = show_main(app);
            }
            "quit" => {
                quit_immediately(app);
            }
            "overlay" => crate::overlay::tray_toggle(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                let _ = show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[tauri::command]
pub async fn app_quit(app: AppHandle, caller: WebviewWindow) -> Result<(), String> {
    if caller.label() != "main" {
        return Err("Only the control panel can quit Veil.".into());
    }
    quit(&app).await
}

async fn quit(app: &AppHandle) -> Result<(), String> {
    let updates = app.state::<crate::updates::Updates>();
    let gate = updates.gate.lock().await;
    if gate.installing {
        return Err("Wait for the update to finish before quitting Veil.".into());
    }
    crate::overlay::flush_checked(app)
        .map_err(|_| "Could not save preferences. Try quitting Veil again.".to_owned())?;
    app.exit(0);
    Ok(())
}
