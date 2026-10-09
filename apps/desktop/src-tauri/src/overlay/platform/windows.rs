use super::OverlayError;
use tauri::WebviewWindow;
use windows::Win32::{
    Foundation::{GetLastError, SetLastError, COLORREF, HWND, WIN32_ERROR},
    UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetLayeredWindowAttributes, SetWindowLongPtrW, SetWindowPos,
        GWL_EXSTYLE, HWND_NOTOPMOST, HWND_TOPMOST, LWA_ALPHA, SWP_NOACTIVATE, SWP_NOMOVE,
        SWP_NOSIZE, WS_EX_LAYERED,
    },
};

pub fn opacity(window: &WebviewWindow, value: f64) -> Result<(), OverlayError> {
    let handle = window.hwnd().map_err(OverlayError::native)?;
    let handle = HWND(handle.0);
    // The HWND belongs to this app's overlay. Preserve all unrelated extended styles.
    unsafe {
        let style = GetWindowLongPtrW(handle, GWL_EXSTYLE);
        SetLastError(WIN32_ERROR(0));
        let previous = SetWindowLongPtrW(handle, GWL_EXSTYLE, style | WS_EX_LAYERED.0 as isize);
        if previous == 0 && GetLastError().0 != 0 {
            return Err(OverlayError::native(windows::core::Error::from_win32()));
        }
        SetLayeredWindowAttributes(
            handle,
            COLORREF(0),
            (value * 255.0).round() as u8,
            LWA_ALPHA,
        )
        .map_err(OverlayError::native)?;
    }
    Ok(())
}

pub fn always_on_top(window: &WebviewWindow, enabled: bool) -> Result<(), OverlayError> {
    window
        .set_always_on_top(enabled)
        .map_err(OverlayError::native)?;
    let handle = window.hwnd().map_err(OverlayError::native)?;
    // Enforce z-order even when the toolkit already records the same preference.
    unsafe {
        SetWindowPos(
            HWND(handle.0),
            Some(if enabled {
                HWND_TOPMOST
            } else {
                HWND_NOTOPMOST
            }),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        )
        .map_err(OverlayError::native)
    }
}
