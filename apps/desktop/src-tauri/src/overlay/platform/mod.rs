use super::{OverlayCapabilities, OverlayError};
use tauri::WebviewWindow;

#[cfg(windows)]
mod windows;

#[cfg(windows)]
mod context_menu;

pub fn install_context_menu(window: &WebviewWindow) -> Result<(), OverlayError> {
    #[cfg(windows)]
    context_menu::install(window).map_err(OverlayError::native)?;
    #[cfg(not(windows))]
    let _ = window;
    Ok(())
}

pub async fn gesture(
    window: WebviewWindow,
    direction: Option<tauri_runtime::ResizeDirection>,
) -> Result<(), OverlayError> {
    #[cfg(windows)]
    return windows::gesture(window, direction).await;
    #[cfg(not(windows))]
    match direction {
        None => window.start_dragging().map_err(OverlayError::native),
        Some(direction) => window
            .as_ref()
            .window()
            .start_resize_dragging(direction)
            .map_err(OverlayError::native),
    }
}

pub fn capabilities() -> OverlayCapabilities {
    OverlayCapabilities {
        transparency: cfg!(windows),
        always_on_top: cfg!(windows),
        click_through: cfg!(windows),
        capture_exclusion: capture_capability(),
    }
}

fn capture_capability() -> &'static str {
    #[cfg(windows)]
    return match windows::capture_support() {
        Ok(()) => "supported",
        Err(error) if error.code == "UNSUPPORTED" => "unsupported",
        Err(_) => "unknown",
    };
    #[cfg(not(windows))]
    "unsupported"
}

pub fn capture_exclusion(
    window: &WebviewWindow,
    enabled: bool,
    apply: bool,
) -> Result<(), OverlayError> {
    #[cfg(windows)]
    return windows::capture_exclusion(window, enabled, apply);
    #[cfg(not(windows))]
    {
        let _ = (window, enabled, apply);
        Err(OverlayError::unsupported(
            "Capture exclusion is unavailable on this platform.",
        ))
    }
}

pub fn opacity(window: &WebviewWindow, value: f64) -> Result<(), OverlayError> {
    #[cfg(windows)]
    return windows::opacity(window, value);
    #[cfg(not(windows))]
    {
        let _ = (window, value);
        Err(OverlayError::unsupported(
            "Transparency is not available on this platform.",
        ))
    }
}

pub fn always_on_top(window: &WebviewWindow, enabled: bool) -> Result<(), OverlayError> {
    if !capabilities().always_on_top {
        return Err(OverlayError::unsupported(
            "Always on top is not available on this platform.",
        ));
    }
    #[cfg(windows)]
    return windows::always_on_top(window, enabled);
    #[cfg(not(windows))]
    window
        .set_always_on_top(enabled)
        .map_err(OverlayError::native)
}

pub fn click_through(window: &WebviewWindow, enabled: bool) -> Result<(), OverlayError> {
    if !capabilities().click_through {
        return Err(OverlayError::unsupported(
            "Click-through is not available on this platform.",
        ));
    }
    window
        .set_ignore_cursor_events(enabled)
        .map_err(OverlayError::native)
}
