//! Theme-matched taskbar and tray icons. Windows requests different icon sizes
//! per surface and DPI, so each theme ships as a multi-size ICO with a frame
//! drawn for every common size, and the exact frame Windows asks for is handed
//! over instead of letting it rescale a single large image.
use serde::Deserialize;
use std::sync::Mutex;
use tauri::{image::Image, AppHandle, Manager, WebviewWindow, Window};

const DARK: &[u8] = include_bytes!("../icons/theme/dark.ico");
const LIGHT: &[u8] = include_bytes!("../icons/theme/light.ico");

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum IconTheme {
    Light,
    #[default]
    Dark,
}

impl IconTheme {
    fn ico(self) -> &'static [u8] {
        match self {
            Self::Light => LIGHT,
            Self::Dark => DARK,
        }
    }
}

static CURRENT: Mutex<IconTheme> = Mutex::new(IconTheme::Dark);

/// The PNG frame of an ICO closest to `size`: the smallest frame at least that
/// large, or the largest frame when none is.
fn frame(ico: &'static [u8], size: u32) -> Option<&'static [u8]> {
    let count = u16::from_le_bytes(ico.get(4..6)?.try_into().ok()?) as usize;
    let mut best: Option<(u32, &'static [u8])> = None;
    for index in 0..count {
        let entry = ico.get(6 + index * 16..6 + (index + 1) * 16)?;
        let width = if entry[0] == 0 { 256 } else { entry[0] as u32 };
        let len = u32::from_le_bytes(entry[8..12].try_into().ok()?) as usize;
        let offset = u32::from_le_bytes(entry[12..16].try_into().ok()?) as usize;
        let data = ico.get(offset..offset.checked_add(len)?)?;
        let better = match best {
            None => true,
            Some((current, _)) if current >= size => width >= size && width < current,
            Some((current, _)) => width > current,
        };
        if better {
            best = Some((width, data));
        }
    }
    best.map(|(_, data)| data)
}

fn tray_size() -> u32 {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::UI::{
            HiDpi::{GetDpiForSystem, GetSystemMetricsForDpi},
            WindowsAndMessaging::SM_CXSMICON,
        };
        GetSystemMetricsForDpi(SM_CXSMICON, GetDpiForSystem()).max(16) as u32
    }
    #[cfg(not(windows))]
    32
}

pub fn tray_icon(theme: IconTheme) -> Option<Image<'static>> {
    Image::from_bytes(frame(theme.ico(), tray_size())?).ok()
}

#[cfg(windows)]
fn apply(window: &Window, theme: IconTheme) {
    use windows::Win32::{
        Foundation::{HWND, LPARAM, WPARAM},
        UI::{
            HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi},
            WindowsAndMessaging::{
                CreateIconFromResourceEx, SendMessageW, ICON_BIG, ICON_SMALL, LR_DEFAULTCOLOR,
                SM_CXICON, SM_CXSMICON, WM_SETICON,
            },
        },
    };

    // Created icons are cached for the life of the process: at most a handful
    // of (theme, size) pairs exist, and windows may still reference old ones.
    static ICONS: Mutex<Vec<(IconTheme, i32, isize)>> = Mutex::new(Vec::new());
    fn icon(theme: IconTheme, size: i32) -> Option<isize> {
        let mut cache = ICONS.lock().ok()?;
        if let Some(&(_, _, handle)) = cache.iter().find(|(t, s, _)| *t == theme && *s == size) {
            return Some(handle);
        }
        let png = frame(theme.ico(), size as u32)?;
        let handle = unsafe {
            CreateIconFromResourceEx(png, true, 0x0003_0000, size, size, LR_DEFAULTCOLOR)
        }
        .ok()?
        .0 as isize;
        cache.push((theme, size, handle));
        Some(handle)
    }

    let Ok(handle) = window.hwnd() else { return };
    let hwnd = HWND(handle.0);
    unsafe {
        let dpi = GetDpiForWindow(hwnd);
        for (kind, metric) in [(ICON_SMALL, SM_CXSMICON), (ICON_BIG, SM_CXICON)] {
            if let Some(icon) = icon(theme, GetSystemMetricsForDpi(metric, dpi)) {
                SendMessageW(
                    hwnd,
                    WM_SETICON,
                    Some(WPARAM(kind as usize)),
                    Some(LPARAM(icon)),
                );
            }
        }
    }
}

#[cfg(not(windows))]
fn apply(window: &Window, theme: IconTheme) {
    if let Some(image) = frame(theme.ico(), 256).and_then(|png| Image::from_bytes(png).ok()) {
        let _ = window.set_icon(image);
    }
}

/// Re-applies the current theme's icon after a window moves to a monitor with
/// a different scale factor, so Windows gets frames for the new DPI.
pub fn scale_changed(window: &Window) {
    if let Ok(theme) = CURRENT.lock() {
        apply(window, *theme);
    }
}

/// Matches the taskbar and tray icons to the app's resolved light/dark appearance.
/// Installer, executable and Start menu icons come from the bundle and stay dark.
#[tauri::command]
pub fn app_set_icon_theme(
    app: AppHandle,
    caller: WebviewWindow,
    theme: IconTheme,
) -> Result<(), String> {
    if caller.label() != "main" {
        return Err("Only the control panel can change the app icon.".into());
    }
    if let Ok(mut current) = CURRENT.lock() {
        *current = theme;
    }
    for window in app.webview_windows().values() {
        apply(&window.as_ref().window(), theme);
    }
    if let (Some(tray), Some(icon)) = (app.tray_by_id("veil"), tray_icon(theme)) {
        let _ = tray.set_icon(Some(icon));
    }
    Ok(())
}
