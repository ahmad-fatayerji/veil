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
use tauri_runtime::ResizeDirection;

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
    always_on_top: Option<bool>,
    click_through: Option<bool>,
    font_size: Option<u32>,
}

fn snapshot(app: &AppHandle) -> Snapshot {
    app.state::<OverlayState>().model.lock().unwrap().clone()
}

fn notify(app: &AppHandle, updated: Snapshot) {
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
    // Toolkit style changes can replace extended styles; apply layered opacity last.
    if capabilities.transparency {
        platform::opacity(window, settings.opacity)?;
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
            .resizable(true)
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
    *model.lock().unwrap() = Snapshot {
        settings: preferences,
        capabilities,
        recovery_available,
        hide_shortcut_available,
        warning,
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
    }
    Ok(())
}

pub fn flush(app: &AppHandle) {
    let state = app.state::<OverlayState>();
    if let Err(error) = settings::save(&state.path, &snapshot(app).settings) {
        eprintln!("Could not save overlay preferences: {}", error.message);
    }
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
    } else {
        overlay.hide().map_err(OverlayError::native)?;
        modify(app, |model| model.settings.visible = false);
    }
    Ok(())
}

fn toggle_visible(app: &AppHandle) -> Result<(), OverlayError> {
    set_visible(app, !snapshot(app).settings.visible)
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
    if let Some(value) = patch.font_size {
        next.font_size = value;
    }
    next.validate()?;
    // Reapply the appearance after toolkit style changes replace the extended styles.
    let overlay = window(&app)?;
    if let Err(error) = apply(&overlay, &next, &current.capabilities) {
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
    Ok(snapshot(&app))
}

#[tauri::command]
pub fn overlay_visibility(
    app: AppHandle,
    caller: WebviewWindow,
    visible: bool,
) -> Result<Snapshot, OverlayError> {
    control_only(&caller)?;
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
pub fn overlay_gesture(
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
        None => return caller.start_dragging().map_err(OverlayError::native),
        Some("north") => ResizeDirection::North,
        Some("south") => ResizeDirection::South,
        Some("east") => ResizeDirection::East,
        Some("west") => ResizeDirection::West,
        Some("northEast") => ResizeDirection::NorthEast,
        Some("northWest") => ResizeDirection::NorthWest,
        Some("southEast") => ResizeDirection::SouthEast,
        Some("southWest") => ResizeDirection::SouthWest,
        _ => {
            return Err(OverlayError::new(
                "INVALID_DIRECTION",
                "Unknown resize direction.",
            ))
        }
    };
    caller
        .as_ref()
        .window()
        .start_resize_dragging(direction)
        .map_err(OverlayError::native)
}
