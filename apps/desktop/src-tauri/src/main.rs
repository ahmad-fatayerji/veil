#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // M0 shares the editor UI. Embedded host lifecycle and native overlay are later milestones.
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("failed to run Veil desktop");
}
