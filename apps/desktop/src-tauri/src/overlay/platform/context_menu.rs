use tauri::{Manager, WebviewWindow};
use webview2_com::{
    ContextMenuRequestedEventHandler, CustomItemSelectedEventHandler,
    Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment9, ICoreWebView2_11, COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_COMMAND,
        COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SEPARATOR,
    },
};
use windows_core::{w, Interface};

// Extend only the overlay's default WebView2 menu. Let WebView2 keep handling
// editing commands, selection, menu placement, keyboard navigation and dismissal.
pub fn install(window: &WebviewWindow) -> tauri::Result<()> {
    let app = window.app_handle().clone();
    window.with_webview(move |webview| {
        let result = (|| -> windows_core::Result<()> {
            // COM interfaces and callbacks are created and used on the WebView UI thread.
            unsafe {
                let core: ICoreWebView2_11 = webview.controller().CoreWebView2()?.cast()?;
                let environment: ICoreWebView2Environment9 = webview.environment().cast()?;
                let hide = environment.CreateContextMenuItem(
                    w!("Hide overlay"),
                    None,
                    COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_COMMAND,
                )?;
                let separator = environment.CreateContextMenuItem(
                    w!(""),
                    None,
                    COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SEPARATOR,
                )?;
                let selected_app = app.clone();
                let mut token = 0;
                hide.add_CustomItemSelected(
                    &CustomItemSelectedEventHandler::create(Box::new(move |_, _| {
                        // Hide after handing control back to the native menu loop.
                        let app = selected_app.clone();
                        std::thread::spawn(move || {
                            if let Err(error) = super::super::set_visible(&app, false) {
                                super::super::modify(&app, |model| model.warning = Some(error.message));
                            }
                        });
                        Ok(())
                    })),
                    &mut token,
                )?;
                core.add_ContextMenuRequested(
                    &ContextMenuRequestedEventHandler::create(Box::new(move |_, args| {
                        if let Some(args) = args {
                            let items = args.MenuItems()?;
                            let mut count = 0;
                            items.Count(&mut count)?;
                            if count > 0 {
                                items.InsertValueAtIndex(count, &separator)?;
                                count += 1;
                            }
                            items.InsertValueAtIndex(count, &hide)?;
                        }
                        Ok(())
                    })),
                    &mut token,
                )?;
            }
            Ok(())
        })();
        if result.is_err() {
            super::super::modify(&app, |model| {
                model.warning = Some(
                    "The overlay right-click menu is unavailable. Use its close button or visibility controls instead."
                        .to_owned(),
                );
            });
        }
    })
}
