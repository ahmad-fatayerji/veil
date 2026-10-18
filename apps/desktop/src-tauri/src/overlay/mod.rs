mod platform;
mod settings;

use serde::{Deserialize, Serialize};
use settings::Settings;
use std::{
    path::PathBuf,
    sync::{mpsc, Arc, Mutex},
    time::Duration,
};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const OVERLAY: &str = "overlay";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayCapabilities {
    transparency: bool,
    always_on_top: bool,
    click_through: bool,
    capture_exclusion: &'static str,
}

#[derive(Clone, Debug, Serialize)]
pub struct OverlayError {
    code: &'static str,
    message: String,
}
impl OverlayError {
    fn new(code: &'static str, message: impl ToString) -> Self {
        Self {
            code,
            message: message.to_string(),
        }
    }
    fn native(error: impl ToString) -> Self {
        Self::new("NATIVE_ERROR", error)
    }
    fn storage(error: impl ToString) -> Self {
        Self::new("STORAGE_ERROR", error)
    }
    fn unsupported(message: impl ToString) -> Self {
        Self::new("UNSUPPORTED", message)
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    settings: Settings,
    capabilities: OverlayCapabilities,
    recovery_available: bool,
    hide_shortcut_available: bool,
    warning: Option<String>,
    capture: CaptureStatus,
    capture_test: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct CaptureStatus {
    status: &'static str,
    message: String,
}

fn capture_status(window: &WebviewWindow, enabled: bool, apply: bool) -> CaptureStatus {
    capture_result(platform::capture_exclusion(window, enabled, apply), enabled)
}

fn capture_result(result: Result<(), OverlayError>, enabled: bool) -> CaptureStatus {
    match result {
        Ok(()) => CaptureStatus {
            status: if enabled { "applied" } else { "disabled" },
            message: if enabled {
                "Windows confirmed the exclusion setting. Test your recording or sharing mode; this is not a guarantee."
            } else {
                "Capture exclusion is off. The overlay may appear in recordings and screen sharing."
            }.to_owned(),
        },
        Err(error) => CaptureStatus {
            status: if error.code == "UNSUPPORTED" { "unsupported" } else { "error" },
            message: format!("{} The overlay may be captured.", error.message),
        },
    }
}

fn refresh_capture(
    app: &AppHandle,
    apply: bool,
    refresh_surface: bool,
) -> Result<(), OverlayError> {
    let overlay = window(app)?;
    let preferences = snapshot(app).settings;
    let enabled = preferences.capture_exclusion;
    let result = platform::capture_exclusion(&overlay, enabled, apply).and_then(|()| {
        if enabled && apply && refresh_surface {
            platform::refresh_capture_surface(&overlay, 1.0)?;
            // Showing the HWND must not invalidate its confirmed affinity.
            platform::capture_exclusion(&overlay, enabled, false)?;
        }
        Ok(())
    });
    let capture = capture_result(result, enabled);
    let visible = if enabled && apply && refresh_surface {
        overlay.is_visible().ok()
    } else {
        None
    };
    modify(app, |model| {
        model.capture = capture;
        if let Some(visible) = visible {
            model.settings.visible = visible;
        }
        model.capabilities.capture_exclusion = platform::capabilities().capture_exclusion;
    });
    Ok(())
}

pub struct OverlayState {
    model: Arc<Mutex<Snapshot>>,
    save_requests: mpsc::Sender<Settings>,
    path: PathBuf,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Patch {
    opacity: Option<f64>,
    text_opacity: Option<f64>,
    always_on_top: Option<bool>,
    click_through: Option<bool>,
    font_size: Option<u32>,
    capture_exclusion: Option<bool>,
    close_behavior: Option<crate::lifecycle::CloseBehavior>,
}

fn snapshot(app: &AppHandle) -> Snapshot {
    app.state::<OverlayState>().model.lock().unwrap().clone()
}

fn notify(app: &AppHandle, updated: Snapshot) {
    crate::lifecycle::refresh_overlay_label(app, updated.settings.visible);
    let state = app.state::<OverlayState>();
    let _ = state.save_requests.send(updated.settings.clone());
    let _ = app.emit("overlay-changed", updated);
}

fn modify(app: &AppHandle, change: impl FnOnce(&mut Snapshot)) {
    let updated = {
        let state = app.state::<OverlayState>();
        let mut model = state.model.lock().unwrap();
        change(&mut model);
        model.clone()
    };
    notify(app, updated);
}

fn window(app: &AppHandle) -> Result<WebviewWindow, OverlayError> {
    app.get_webview_window(OVERLAY)
        .ok_or_else(|| OverlayError::new("WINDOW_MISSING", "The overlay window is unavailable."))
}

fn control_only(caller: &WebviewWindow) -> Result<(), OverlayError> {
    if caller.label() == "main" {
        Ok(())
    } else {
        Err(OverlayError::new(
            "FORBIDDEN",
            "Use the control panel to change overlay settings.",
        ))
    }
}

fn areas(window: &WebviewWindow) -> Result<Vec<(i32, i32, u32, u32)>, OverlayError> {
    Ok(window
        .available_monitors()
        .map_err(OverlayError::native)?
        .iter()
        .map(|monitor| {
            let area = monitor.work_area();
            (
                area.position.x,
                area.position.y,
                area.size.width,
                area.size.height,
            )
        })
        .collect())
}

fn apply(
    window: &WebviewWindow,
    settings: &Settings,
    capabilities: &OverlayCapabilities,
) -> Result<(), OverlayError> {
    if capabilities.click_through {
        platform::click_through(window, settings.click_through)?;
    }
    if capabilities.always_on_top {
        platform::always_on_top(window, settings.always_on_top)?;
    }
    // Keep native alpha fully opaque: background and document opacity are separate
    // WebView layers. Toolkit style changes can replace extended styles.
    if capabilities.transparency {
        platform::opacity(window, 1.0)?;
    }
    Ok(())
}

pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let directory = app.path().app_config_dir()?;
    // Native acceptance tests isolate preferences from the user's device settings.
    #[cfg(debug_assertions)]
    let directory = std::env::var_os("VEIL_TEST_SETTINGS_DIR")
        .map(PathBuf::from)
        .unwrap_or(directory);
    let path = directory.join("overlay.json");
    let (mut preferences, mut warning) = match settings::load(&path) {
        Ok(value) => (value, None),
        Err(_) => (
            Settings::default(),
            Some("Saved overlay settings could not be read. Defaults were restored.".to_owned()),
        ),
    };
    let capabilities = platform::capabilities();
    let model = Arc::new(Mutex::new(Snapshot {
        settings: preferences.clone(),
        capabilities: capabilities.clone(),
        recovery_available: false,
        hide_shortcut_available: false,
        warning: warning.clone(),
        capture: CaptureStatus {
            status: "unknown",
            message: "Checking capture capability…".to_owned(),
        },
        capture_test: false,
    }));
    let (sender, receiver) = mpsc::channel::<Settings>();
    // Creating a WebView can pump IPC before setup returns. Register state first.
    app.manage(OverlayState {
        model: model.clone(),
        save_requests: sender,
        path: path.clone(),
    });
    let recover = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyV);
    let hide = Shortcut::new(
        Some(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SHIFT),
        Code::KeyV,
    );
    app.handle().plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, shortcut, event| {
                if event.state() != ShortcutState::Pressed
                    || app.try_state::<OverlayState>().is_none()
                {
                    return;
                }
                let result = if shortcut == &recover {
                    recover_controls(app)
                } else if shortcut == &hide {
                    toggle_visible(app)
                } else {
                    Ok(())
                };
                if let Err(error) = result {
                    modify(app, |model| model.warning = Some(error.message));
                }
            })
            .build(),
    )?;
    let recovery_available = app.global_shortcut().register(recover).is_ok();
    let hide_shortcut_available = app.global_shortcut().register(hide).is_ok();
    if !recovery_available {
        preferences.click_through = false;
        warning = Some("Ctrl+Alt+V is already in use. Click-through is disabled; the control panel can still show or hide the overlay.".to_owned());
    }
    let overlay =
        WebviewWindowBuilder::new(app, OVERLAY, WebviewUrl::App("index.html?overlay".into()))
            .title("Veil overlay")
            .decorations(false)
            .transparent(capabilities.transparency)
            .shadow(false)
            // Windows gestures use our handles and direct HWND updates. A native
            // sizing border could still enter the capture-leaking modal loop.
            .resizable(!cfg!(windows))
            .always_on_top(preferences.always_on_top && capabilities.always_on_top)
            .min_inner_size(280.0, 180.0)
            .visible(false)
            .focused(false)
            .skip_taskbar(true)
            .build()?;
    preferences.fit(&areas(&overlay).map_err(|error| error.message)?);
    overlay.set_size(PhysicalSize::new(preferences.width, preferences.height))?;
    overlay.set_position(PhysicalPosition::new(preferences.x, preferences.y))?;
    if let Err(error) = apply(&overlay, &preferences, &capabilities) {
        preferences.click_through = false;
        let _ = platform::click_through(&overlay, false);
        warning = Some(format!(
            "Some overlay settings could not be applied: {}",
            error.message
        ));
    }
    let capture = capture_status(&overlay, preferences.capture_exclusion, true);
    *model.lock().unwrap() = Snapshot {
        settings: preferences,
        capabilities,
        recovery_available,
        hide_shortcut_available,
        warning,
        capture,
        capture_test: false,
    };
    let _ = app.emit("overlay-changed", model.lock().unwrap().clone());
    let handle = app.handle().clone();
    std::thread::spawn(move || {
        while let Ok(mut pending) = receiver.recv() {
            while let Ok(newer) = receiver.recv_timeout(Duration::from_millis(250)) {
                pending = newer;
            }
            if let Err(error) = settings::save(&path, &pending) {
                let updated = {
                    let mut current = model.lock().unwrap();
                    current.warning = Some(format!(
                        "Could not save overlay settings: {}",
                        error.message
                    ));
                    current.clone()
                };
                let _ = handle.emit("overlay-changed", updated);
            }
        }
    });
    let handle = app.handle().clone();
    overlay.on_window_event(move |event| match event {
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            // Startup can deliver old move/resize events after the saved bounds were applied.
            // Read the current native bounds rather than persisting a stale event payload.
            if let Ok(current) = window(&handle) {
                if let (Ok(position), Ok(size)) = (current.outer_position(), current.inner_size()) {
                    if size.width > 0 && size.height > 0 {
                        modify(&handle, |model| {
                            model.settings.x = position.x;
                            model.settings.y = position.y;
                            model.settings.width = size.width;
                            model.settings.height = size.height;
                        });
                    }
                }
            }
        }
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = set_visible(&handle, false);
        }
        _ => {}
    });
    if snapshot(app.handle()).settings.visible {
        overlay.show()?;
        let current = snapshot(app.handle());
        apply(&overlay, &current.settings, &current.capabilities).map_err(|error| error.message)?;
        refresh_capture(app.handle(), true, true).map_err(|error| error.message)?;
    }
    Ok(())
}

pub fn flush(app: &AppHandle) {
    if let Err(error) = flush_checked(app) {
        eprintln!("Could not save overlay preferences: {}", error.message);
    }
}

pub fn flush_checked(app: &AppHandle) -> Result<(), OverlayError> {
    let state = app.state::<OverlayState>();
    settings::save(&state.path, &snapshot(app).settings)
}

fn set_visible(app: &AppHandle, visible: bool) -> Result<(), OverlayError> {
    let overlay = window(app)?;
    if visible {
        let mut preferences = snapshot(app).settings;
        preferences.fit(&areas(&overlay)?);
        overlay
            .set_size(PhysicalSize::new(preferences.width, preferences.height))
            .map_err(OverlayError::native)?;
        overlay
            .set_position(PhysicalPosition::new(preferences.x, preferences.y))
            .map_err(OverlayError::native)?;
        overlay.show().map_err(OverlayError::native)?;
        apply(&overlay, &preferences, &snapshot(app).capabilities)?;
        modify(app, |model| {
            model.settings = preferences;
            model.settings.visible = true;
        });
        refresh_capture(app, true, true)?;
    } else {
        overlay.hide().map_err(OverlayError::native)?;
        modify(app, |model| model.settings.visible = false);
    }
    Ok(())
}

fn toggle_visible(app: &AppHandle) -> Result<(), OverlayError> {
    set_visible(app, !snapshot(app).settings.visible)
}

pub fn is_visible(app: &AppHandle) -> bool {
    snapshot(app).settings.visible
}

pub fn close_behavior(app: &AppHandle) -> crate::lifecycle::CloseBehavior {
    app.try_state::<OverlayState>()
        .map(|state| state.model.lock().unwrap().settings.close_behavior)
        .unwrap_or_default()
}

pub fn tray_toggle(app: &AppHandle) {
    if let Err(error) = toggle_visible(app) {
        modify(app, |model| model.warning = Some(error.message));
    }
}

fn recover_controls(app: &AppHandle) -> Result<(), OverlayError> {
    let overlay = window(app)?;
    platform::click_through(&overlay, false)?;
    modify(app, |model| model.settings.click_through = false);
    set_visible(app, true)?;
    if let Some(main) = app.get_webview_window("main") {
        main.show().map_err(OverlayError::native)?;
        main.unminimize().map_err(OverlayError::native)?;
        main.set_focus().map_err(OverlayError::native)?;
    }
    Ok(())
}

#[tauri::command]
pub fn overlay_snapshot(app: AppHandle, caller: WebviewWindow) -> Result<Snapshot, OverlayError> {
    if !["main", OVERLAY].contains(&caller.label()) {
        return Err(OverlayError::new("FORBIDDEN", "Unknown desktop window."));
    }
    Ok(snapshot(&app))
}

#[tauri::command]
pub fn overlay_update(
    app: AppHandle,
    caller: WebviewWindow,
    patch: Patch,
) -> Result<Snapshot, OverlayError> {
    control_only(&caller)?;
    let current = snapshot(&app);
    let mut next = current.settings.clone();
    if let Some(value) = patch.opacity {
        if !current.capabilities.transparency {
            return Err(OverlayError::unsupported("Transparency is unavailable."));
        }
        next.opacity = value;
    }
    if let Some(value) = patch.always_on_top {
        if !current.capabilities.always_on_top {
            return Err(OverlayError::unsupported("Always on top is unavailable."));
        }
        next.always_on_top = value;
    }
    if let Some(value) = patch.click_through {
        if !current.capabilities.click_through || !current.recovery_available {
            return Err(OverlayError::unsupported(
                "Click-through requires an available recovery shortcut.",
            ));
        }
        next.click_through = value;
    }
    if let Some(value) = patch.text_opacity {
        next.text_opacity = value;
    }
    if let Some(value) = patch.font_size {
        next.font_size = value;
    }
    if let Some(value) = patch.capture_exclusion {
        next.capture_exclusion = value;
    }
    if let Some(value) = patch.close_behavior {
        next.close_behavior = value;
    }
    next.validate()?;
    // Reapply the appearance after toolkit style changes replace the extended styles.
    let overlay = window(&app)?;
    let style_update = patch.always_on_top.is_some() || patch.click_through.is_some();
    let result = if style_update {
        apply(&overlay, &next, &current.capabilities)
    } else {
        Ok(())
    };
    if let Err(error) = result {
        if apply(&overlay, &current.settings, &current.capabilities).is_err() {
            let _ = platform::click_through(&overlay, false);
            modify(&app, |model| {
                model.settings.click_through = false;
                model.warning = Some(
                    "Overlay settings could not be restored. Click-through was turned off."
                        .to_owned(),
                );
            });
        }
        return Err(error);
    }
    modify(&app, |model| model.settings = next);
    // Toolkit style changes can replace the protected layered surface even when
    // affinity readback matches. Rebuild it as on explicit enable/reapply.
    // Capture failure has its own status and does not disable unrelated controls.
    if patch.capture_exclusion.is_some() || style_update {
        refresh_capture(
            &app,
            true,
            patch.capture_exclusion == Some(true) || style_update,
        )?;
    }
    Ok(snapshot(&app))
}

#[tauri::command]
pub fn overlay_capture_check(
    app: AppHandle,
    caller: WebviewWindow,
) -> Result<Snapshot, OverlayError> {
    control_only(&caller)?;
    refresh_capture(&app, false, false)?;
    Ok(snapshot(&app))
}

#[tauri::command]
pub fn overlay_capture_test(
    app: AppHandle,
    caller: WebviewWindow,
    enabled: bool,
) -> Result<Snapshot, OverlayError> {
    control_only(&caller)?;
    if enabled {
        set_visible(&app, true)?;
    }
    // Local ephemeral card, not shared document content or a persisted test result.
    modify(&app, |model| model.capture_test = enabled);
    Ok(snapshot(&app))
}

#[tauri::command]
pub fn overlay_visibility(
    app: AppHandle,
    caller: WebviewWindow,
    visible: bool,
) -> Result<Snapshot, OverlayError> {
    // The overlay may hide itself, but showing it and all other settings stay
    // under control-panel administration.
    if caller.label() != OVERLAY || visible {
        control_only(&caller)?;
    }
    set_visible(&app, visible)?;
    Ok(snapshot(&app))
}

#[tauri::command]
pub fn overlay_recover(app: AppHandle, caller: WebviewWindow) -> Result<Snapshot, OverlayError> {
    control_only(&caller)?;
    recover_controls(&app)?;
    Ok(snapshot(&app))
}

#[tauri::command]
pub fn overlay_reset_position(
    app: AppHandle,
    caller: WebviewWindow,
) -> Result<Snapshot, OverlayError> {
    control_only(&caller)?;
    let overlay = window(&app)?;
    let mut value = snapshot(&app).settings;
    let monitors = areas(&overlay)?;
    if let Some(&(x, y, _, _)) = monitors.first() {
        value.x = x.saturating_add(80);
        value.y = y.saturating_add(80);
    }
    value.width = 520;
    value.height = 320;
    value.fit(&monitors);
    overlay
        .set_size(PhysicalSize::new(value.width, value.height))
        .map_err(OverlayError::native)?;
    overlay
        .set_position(PhysicalPosition::new(value.x, value.y))
        .map_err(OverlayError::native)?;
    modify(&app, |model| model.settings = value);
    Ok(snapshot(&app))
}

#[tauri::command]
pub async fn overlay_gesture(
    caller: WebviewWindow,
    direction: Option<String>,
) -> Result<(), OverlayError> {
    if caller.label() != OVERLAY {
        return Err(OverlayError::new(
            "FORBIDDEN",
            "Only the overlay can drag or resize itself.",
        ));
    }
    let direction = match direction.as_deref() {
        None => None,
        Some("north") => Some(tauri_runtime::ResizeDirection::North),
        Some("south") => Some(tauri_runtime::ResizeDirection::South),
        Some("east") => Some(tauri_runtime::ResizeDirection::East),
        Some("west") => Some(tauri_runtime::ResizeDirection::West),
        Some("northEast") => Some(tauri_runtime::ResizeDirection::NorthEast),
        Some("northWest") => Some(tauri_runtime::ResizeDirection::NorthWest),
        Some("southEast") => Some(tauri_runtime::ResizeDirection::SouthEast),
        Some("southWest") => Some(tauri_runtime::ResizeDirection::SouthWest),
        _ => {
            return Err(OverlayError::new(
                "INVALID_DIRECTION",
                "Unknown resize direction.",
            ))
        }
    };
    platform::gesture(caller, direction).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_failures_never_report_applied_even_when_preference_is_enabled() {
        let status = capture_result(Err(OverlayError::native("Access denied")), true);
        assert_eq!(status.status, "error");
        assert!(status.message.contains("Access denied"));
        assert!(status.message.contains("may be captured"));
        let status = capture_result(Err(OverlayError::unsupported("Old OS")), true);
        assert_eq!(status.status, "unsupported");
        assert_eq!(
            capture_result(Err(OverlayError::native("Readback failed")), false).status,
            "error"
        );
        assert_eq!(capture_result(Ok(()), true).status, "applied");
        assert!(capture_result(Ok(()), true)
            .message
            .contains("not a guarantee"));
        assert_eq!(capture_result(Ok(()), false).status, "disabled");
    }
}
