use serde::Serialize;
use tauri::{AppHandle, WebviewWindow};
#[cfg(windows)]
use tauri_plugin_autostart::ManagerExt;

#[derive(Serialize)]
pub struct StartupStatus {
    supported: bool,
    enabled: bool,
}

pub fn is_background_launch(args: &[String]) -> bool {
    cfg!(windows)
        && args.iter().any(|arg| arg == "--autostart")
        && !args.iter().any(|arg| arg.starts_with("veil://"))
}

fn authorize(caller: &WebviewWindow) -> Result<(), String> {
    if caller.label() != "main" {
        return Err("Only the control panel can manage Windows startup.".into());
    }
    Ok(())
}

fn status(_app: &AppHandle) -> Result<StartupStatus, String> {
    #[cfg(windows)]
    let enabled = _app
        .autolaunch()
        .is_enabled()
        .map_err(|error| format!("Could not read Windows startup registration: {error}"))?;
    #[cfg(not(windows))]
    let enabled = false;
    Ok(StartupStatus {
        supported: cfg!(windows),
        enabled,
    })
}

#[cfg(windows)]
fn enable(app: &AppHandle) -> Result<(), String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let key = windows_registry::CURRENT_USER
        .create(r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run")
        .map_err(|error| error.to_string())?;
    let manager = app.autolaunch();
    let result = manager
        .enable()
        .map_err(|error| error.to_string())
        .and_then(|()| {
            // The per-user plugin version leaves paths unquoted. Quote the executable
            // so installations under names containing spaces launch the correct file.
            key.set_string("Veil", format!("\"{}\" --autostart", executable.display()))
                .map_err(|error| error.to_string())
        });
    if let Err(error) = result {
        return match manager.disable() {
            Ok(()) => Err(error),
            Err(cleanup) => Err(format!(
                "{error}; could not remove startup registration: {cleanup}"
            )),
        };
    }
    Ok(())
}

#[tauri::command]
pub fn startup_status(app: AppHandle, caller: WebviewWindow) -> Result<StartupStatus, String> {
    authorize(&caller)?;
    status(&app)
}

#[tauri::command]
pub fn startup_configure(
    app: AppHandle,
    caller: WebviewWindow,
    enabled: bool,
) -> Result<StartupStatus, String> {
    authorize(&caller)?;
    #[cfg(windows)]
    {
        let manager = app.autolaunch();
        if enabled {
            enable(&app)
        } else {
            manager.disable().map_err(|error| error.to_string())
        }
        .map_err(|error| format!("Could not change Windows startup registration: {error}"))?;
        status(&app)
    }
    #[cfg(not(windows))]
    {
        let _ = (app, enabled);
        Err("Windows startup is only available on Windows.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::is_background_launch;

    #[test]
    fn ordinary_launch_stays_visible() {
        assert!(!is_background_launch(&["Veil.exe".into()]));
        assert!(!is_background_launch(&[
            "Veil.exe".into(),
            "--autostart-other".into(),
        ]));
    }

    #[test]
    fn sign_in_launch_is_quiet_only_on_windows() {
        assert_eq!(
            is_background_launch(&["Veil.exe".into(), "--autostart".into()]),
            cfg!(windows)
        );
    }

    #[test]
    fn invitation_takes_priority_over_background_flag() {
        assert!(!is_background_launch(&[
            "Veil.exe".into(),
            "--autostart".into(),
            "veil://join/example".into(),
        ]));
    }
}
