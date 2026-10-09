use super::{OverlayCapabilities, OverlayError};
use tauri::WebviewWindow;

#[cfg(windows)]
mod windows;

pub fn capabilities() -> OverlayCapabilities {
    OverlayCapabilities {
        transparency: cfg!(windows),
        always_on_top: cfg!(windows),
        click_through: cfg!(windows),
        capture_exclusion: if cfg!(windows) {
            "unknown"
        } else {
            "unsupported"
        },
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
