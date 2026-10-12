use super::OverlayError;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::WebviewWindow;
use tauri_runtime::ResizeDirection;
use windows::Wdk::System::SystemServices::RtlGetVersion;
use windows::Win32::{
    Foundation::{GetLastError, SetLastError, COLORREF, HWND, WIN32_ERROR},
    Graphics::Dwm::DwmIsCompositionEnabled,
    System::SystemInformation::OSVERSIONINFOW,
    UI::WindowsAndMessaging::{
        GetWindowDisplayAffinity, GetWindowLongPtrW, SetLayeredWindowAttributes,
        SetWindowDisplayAffinity, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, HWND_NOTOPMOST,
        HWND_TOPMOST, LWA_ALPHA, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, WDA_EXCLUDEFROMCAPTURE,
        WDA_MONITOR, WDA_NONE, WINDOW_DISPLAY_AFFINITY, WS_EX_LAYERED,
    },
};

static GESTURE_ACTIVE: AtomicBool = AtomicBool::new(false);

struct GestureGuard;
impl Drop for GestureGuard {
    fn drop(&mut self) {
        GESTURE_ACTIVE.store(false, Ordering::Release);
    }
}

// Avoid the Windows modal move/size loop: its desktop drag rectangle and snap
// previews are separate from our HWND and do not inherit its display affinity.
pub async fn gesture(
    window: WebviewWindow,
    direction: Option<ResizeDirection>,
) -> Result<(), OverlayError> {
    use windows::Win32::{
        Foundation::{POINT, RECT},
        UI::{
            Input::KeyboardAndMouse::{GetAsyncKeyState, VK_ESCAPE, VK_LBUTTON, VK_RBUTTON},
            WindowsAndMessaging::{
                GetCursorPos, GetForegroundWindow, GetSystemMetrics, GetWindowRect,
                IsWindowVisible, SM_SWAPBUTTON, SWP_ASYNCWINDOWPOS, SWP_NOZORDER,
            },
        },
    };
    if GESTURE_ACTIVE.swap(true, Ordering::AcqRel) {
        return Err(OverlayError::new(
            "GESTURE_ACTIVE",
            "An overlay gesture is already active.",
        ));
    }
    let guard = GestureGuard;
    let handle = window.hwnd().map_err(OverlayError::native)?.0 as usize;
    let scale = window.scale_factor().map_err(OverlayError::native)?;
    let minimum = ((280.0 * scale).ceil() as i32, (180.0 * scale).ceil() as i32);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        // Keep the WebviewWindow alive for the gesture. Window closure/hide or
        // focus loss ends it; polling also sees release outside the WebView.
        let _window = window;
        let handle = HWND(handle as *mut std::ffi::c_void);
        unsafe {
            let button = if GetSystemMetrics(SM_SWAPBUTTON) != 0 {
                VK_RBUTTON
            } else {
                VK_LBUTTON
            };
            let mut origin = POINT::default();
            let mut initial = RECT::default();
            GetCursorPos(&mut origin).map_err(OverlayError::native)?;
            GetWindowRect(handle, &mut initial).map_err(OverlayError::native)?;
            let mut previous = (origin.x, origin.y);
            // WebView pointer delivery can precede native foreground activation.
            // Allow that initial activation, then stop as soon as focus is lost.
            let activation_deadline =
                std::time::Instant::now() + std::time::Duration::from_millis(200);
            let mut activated = false;
            while GetAsyncKeyState(button.0 as i32) < 0 && IsWindowVisible(handle).as_bool() {
                if GetForegroundWindow() == handle {
                    activated = true;
                } else if activated || std::time::Instant::now() >= activation_deadline {
                    break;
                } else {
                    std::thread::sleep(std::time::Duration::from_millis(8));
                    continue;
                }
                let cancelled = GetAsyncKeyState(VK_ESCAPE.0 as i32) < 0;
                let mut cursor = POINT::default();
                GetCursorPos(&mut cursor).map_err(OverlayError::native)?;
                if cancelled || (cursor.x, cursor.y) != previous {
                    let bounds = if cancelled {
                        initial
                    } else {
                        gesture_bounds(
                            initial,
                            direction,
                            cursor.x - origin.x,
                            cursor.y - origin.y,
                            minimum,
                        )
                    };
                    SetWindowPos(
                        handle,
                        None,
                        bounds.left,
                        bounds.top,
                        bounds.right - bounds.left,
                        bounds.bottom - bounds.top,
                        // The UI owns this HWND. Post the update so its message
                        // processing cannot block button-release/focus polling.
                        SWP_ASYNCWINDOWPOS | SWP_NOACTIVATE | SWP_NOZORDER,
                    )
                    .map_err(OverlayError::native)?;
                    previous = (cursor.x, cursor.y);
                }
                if cancelled {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(8));
            }
            Ok(())
        }
    })
    .await
    .map_err(OverlayError::native)?
}

fn gesture_bounds(
    mut bounds: windows::Win32::Foundation::RECT,
    direction: Option<ResizeDirection>,
    dx: i32,
    dy: i32,
    minimum: (i32, i32),
) -> windows::Win32::Foundation::RECT {
    use ResizeDirection::*;
    let Some(direction) = direction else {
        bounds.left += dx;
        bounds.right += dx;
        bounds.top += dy;
        bounds.bottom += dy;
        return bounds;
    };
    if matches!(direction, West | NorthWest | SouthWest) {
        bounds.left = (bounds.left + dx).min(bounds.right - minimum.0);
    }
    if matches!(direction, East | NorthEast | SouthEast) {
        bounds.right = (bounds.right + dx).max(bounds.left + minimum.0);
    }
    if matches!(direction, North | NorthWest | NorthEast) {
        bounds.top = (bounds.top + dy).min(bounds.bottom - minimum.1);
    }
    if matches!(direction, South | SouthWest | SouthEast) {
        bounds.bottom = (bounds.bottom + dy).max(bounds.top + minimum.1);
    }
    bounds
}

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

fn apply_capture_affinity(
    enabled: bool,
    mut set: impl FnMut(WINDOW_DISPLAY_AFFINITY) -> Result<(), OverlayError>,
) -> Result<(), OverlayError> {
    if enabled {
        // Repeating EXCLUDEFROMCAPTURE can leave the compositor's stale black
        // surface unchanged after hidden-window/style initialization (#22).
        // Force a protected affinity transition rather than briefly making the
        // overlay capturable with NONE, as the manual off/on workaround does.
        // MONITOR is only an intermediate reset on supported Windows, never a
        // successful fallback: EXCLUDEFROMCAPTURE must succeed and read back.
        set(WDA_MONITOR)?;
        set(WDA_EXCLUDEFROMCAPTURE)
    } else {
        set(WDA_NONE)
    }
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
            apply_capture_affinity(enabled, |affinity| {
                SetWindowDisplayAffinity(handle, affinity).map_err(OverlayError::native)
            })?;
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
    fn gestures_preserve_opposite_edges_and_scaled_minimum_size() {
        use windows::Win32::Foundation::RECT;
        use ResizeDirection::*;
        let initial = RECT {
            left: -600,
            top: -200,
            right: 200,
            bottom: 400,
        };
        let moved = gesture_bounds(initial, None, 30, -50, (420, 270));
        assert_eq!(
            (moved.left, moved.top, moved.right, moved.bottom),
            (-570, -250, 230, 350)
        );
        for direction in [
            North, South, East, West, NorthEast, NorthWest, SouthEast, SouthWest,
        ] {
            let west = matches!(direction, West | NorthWest | SouthWest);
            let north = matches!(direction, North | NorthWest | NorthEast);
            let east = matches!(direction, East | NorthEast | SouthEast);
            let south = matches!(direction, South | SouthWest | SouthEast);
            let resized = gesture_bounds(
                initial,
                Some(direction),
                if west { 1000 } else { -1000 },
                if north { 1000 } else { -1000 },
                (420, 270),
            );
            assert_eq!(
                resized.right - resized.left,
                if west || east { 420 } else { 800 }
            );
            assert_eq!(
                resized.bottom - resized.top,
                if north || south { 270 } else { 600 }
            );
            if west {
                assert_eq!(resized.right, initial.right);
            }
            if east {
                assert_eq!(resized.left, initial.left);
            }
            if north {
                assert_eq!(resized.bottom, initial.bottom);
            }
            if south {
                assert_eq!(resized.top, initial.top);
            }
        }
    }

    #[test]
    fn capture_exclusion_rejects_old_monitor_only_behavior() {
        assert!(!supports_capture_version(6, 9600));
        assert!(!supports_capture_version(10, 18363));
        assert!(supports_capture_version(10, 19041));
        assert!(supports_capture_version(10, 26100));
        assert!(supports_capture_version(11, 100));
    }

    #[test]
    fn capture_refresh_never_temporarily_allows_capture() {
        let mut calls = Vec::new();
        apply_capture_affinity(true, |affinity| {
            calls.push(affinity);
            Ok(())
        })
        .unwrap();
        assert_eq!(calls, [WDA_MONITOR, WDA_EXCLUDEFROMCAPTURE]);
        assert!(!calls.contains(&WDA_NONE));
        calls.clear();
        apply_capture_affinity(false, |affinity| {
            calls.push(affinity);
            Ok(())
        })
        .unwrap();
        assert_eq!(calls, [WDA_NONE]);
    }

    #[test]
    fn capture_refresh_propagates_failures_without_unprotected_fallback() {
        for failure in [WDA_MONITOR, WDA_EXCLUDEFROMCAPTURE] {
            let mut calls = Vec::new();
            let result = apply_capture_affinity(true, |affinity| {
                calls.push(affinity);
                if affinity == failure {
                    Err(OverlayError::native("affinity failure"))
                } else {
                    Ok(())
                }
            });
            assert_eq!(result.unwrap_err().code, "NATIVE_ERROR");
            assert_eq!(calls.last(), Some(&failure));
            assert!(!calls.contains(&WDA_NONE));
        }
    }
}
