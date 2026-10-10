use super::OverlayError;
use tauri::WebviewWindow;
use windows::Wdk::System::SystemServices::RtlGetVersion;
use windows::Win32::{
    Foundation::{GetLastError, SetLastError, COLORREF, HWND, WIN32_ERROR},
    Graphics::Dwm::DwmIsCompositionEnabled,
    System::SystemInformation::OSVERSIONINFOW,
    UI::WindowsAndMessaging::{
        GetWindowDisplayAffinity, GetWindowLongPtrW, SetLayeredWindowAttributes,
        SetWindowDisplayAffinity, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, HWND_NOTOPMOST,
        HWND_TOPMOST, LWA_ALPHA, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, WDA_EXCLUDEFROMCAPTURE,
        WDA_NONE, WS_EX_LAYERED,
    },
};

pub fn capture_support() -> Result<(), OverlayError> {
    let mut version = OSVERSIONINFOW {
        dwOSVersionInfoSize: std::mem::size_of::<OSVERSIONINFOW>() as u32,
        ..Default::default()
    };
    // RtlGetVersion reports the actual build without manifest-dependent version emulation.
    unsafe { RtlGetVersion(&mut version) }
        .ok()
        .map_err(OverlayError::native)?;
    if !supports_capture_version(version.dwMajorVersion, version.dwBuildNumber) {
        return Err(OverlayError::unsupported(
            "Capture exclusion requires Windows 10 version 2004 or later.",
        ));
    }
    if !unsafe { DwmIsCompositionEnabled() }
        .map_err(OverlayError::native)?
        .as_bool()
    {
        return Err(OverlayError::unsupported(
            "Desktop composition is unavailable.",
        ));
    }
    Ok(())
}

fn supports_capture_version(major: u32, build: u32) -> bool {
    (major, build) >= (10, 19041)
}

pub fn capture_exclusion(
    window: &WebviewWindow,
    enabled: bool,
    apply: bool,
) -> Result<(), OverlayError> {
    // Do not silently downgrade to WDA_MONITOR (black capture) on older Windows.
    if enabled {
        capture_support()?;
    }
    let handle = HWND(window.hwnd().map_err(OverlayError::native)?.0);
    let expected = if enabled {
        WDA_EXCLUDEFROMCAPTURE
    } else {
        WDA_NONE
    };
    // This top-level HWND is owned by the desktop, never provided by the frontend.
    unsafe {
        if apply {
            SetWindowDisplayAffinity(handle, expected).map_err(OverlayError::native)?;
        }
        let mut actual = 0;
        GetWindowDisplayAffinity(handle, &mut actual).map_err(OverlayError::native)?;
        if actual != expected.0 {
            return Err(OverlayError::new("CAPTURE_MISMATCH", "Windows did not confirm the requested capture setting. Reapply it and test your capture mode."));
        }
    }
    Ok(())
}

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_exclusion_rejects_old_monitor_only_behavior() {
        assert!(!supports_capture_version(6, 9600));
        assert!(!supports_capture_version(10, 18363));
        assert!(supports_capture_version(10, 19041));
        assert!(supports_capture_version(10, 26100));
        assert!(supports_capture_version(11, 100));
    }
}
