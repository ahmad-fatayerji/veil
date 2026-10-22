use tauri::plugin::{Builder, TauriPlugin};
use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
use windows_core::Interface;

pub fn init() -> TauriPlugin<tauri::Wry> {
    Builder::new("browser-shortcuts")
        .on_webview_ready(|webview| {
            // Apply to every desktop WebView, including the separately created overlay.
            if let Err(error) = webview.with_webview(|platform| {
                // WebView2 browser commands (e.g. Ctrl+J Downloads and Ctrl+Shift+C
                // DevTools) compete with app keybinds, even outside their action's
                // screen. Disable browser accelerators at the native layer while
                // retaining DOM keyboard events and standard text-editing shortcuts.
                let result = (|| -> windows_core::Result<()> {
                    unsafe {
                        let settings = platform.controller().CoreWebView2()?.Settings()?;
                        let settings: ICoreWebView2Settings3 = settings.cast()?;
                        settings.SetAreBrowserAcceleratorKeysEnabled(false)
                    }
                })();
                if let Err(error) = result {
                    eprintln!("Could not disable WebView2 browser shortcuts: {error}");
                }
            }) {
                eprintln!("Could not configure WebView2 browser shortcuts: {error}");
            }
        })
        .build()
}
