//! Device-local preferences and a single background Discord connection.
mod transport;

use serde::{Deserialize, Serialize};
use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Condvar, Mutex},
    thread::JoinHandle,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, State, WebviewWindow};

const UPDATE_INTERVAL: Duration = Duration::from_secs(5);
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(15);

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Preferences {
    enabled: bool,
    show_document_title: bool,
    show_participant_count: bool,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            enabled: true,
            show_document_title: true,
            show_participant_count: true,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    document_title: Option<String>,
    others_count: u32,
}

#[derive(Debug, PartialEq)]
struct DisplayActivity {
    details: String,
    state: Option<String>,
}

// Discord fields are limited to 128 bytes. Never split a UTF-8 code point.
fn title(value: &str) -> String {
    let normalized: String = value.chars().filter(|c| !c.is_control()).collect();
    let value = normalized.trim();
    if value.is_empty() {
        return "Untitled document".into();
    }
    let mut end = value.len().min(128);
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_owned()
}

fn display(preferences: Preferences, activity: &Activity) -> DisplayActivity {
    let Some(document_title) = &activity.document_title else {
        return DisplayActivity {
            details: "No document open".into(),
            state: None,
        };
    };
    DisplayActivity {
        details: if preferences.show_document_title {
            title(&format!("Document: {}", title(document_title)))
        } else {
            "Editing a document".into()
        },
        state: preferences.show_participant_count.then(|| {
            match (preferences.show_document_title, activity.others_count) {
                (true, 0) => "Editing solo".into(),
                (true, 1) => "Editing with 1 other".into(),
                (true, count) => format!("Editing with {count} others"),
                (false, 0) => "Solo".into(),
                (false, 1) => "With 1 other".into(),
                (false, count) => format!("With {count} others"),
            }
        }),
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    account_linking: bool,
    activity_invites: bool,
    unavailable_reason: &'static str,
}

impl Default for Capabilities {
    fn default() -> Self {
        // The existing IPC publisher does not authenticate users or expose the
        // Social SDK's friends/invitation APIs. Installing Discord alone does not
        // enable these capabilities. Do not infer availability from presence.
        Self {
            account_linking: false,
            activity_invites: false,
            unavailable_reason: "Connecting an account and sending direct Discord invites are not available in this build. You can still copy a Veil invite link into Discord.",
        }
    }
}

#[derive(Clone, Serialize)]
pub struct Snapshot {
    preferences: Preferences,
    warning: Option<String>,
    capabilities: Capabilities,
}

struct Model {
    snapshot: Snapshot,
    activity: Activity,
    // The primary desktop flow activates publishing; legacy tools do not.
    active: bool,
    urgent: bool,
    stop: bool,
}

type Shared = Arc<(Mutex<Model>, Condvar)>;

pub struct Discord {
    shared: Shared,
    path: PathBuf,
    worker: Mutex<Option<JoinHandle<()>>>,
}

fn load(path: &Path) -> Result<Preferences, String> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|_| "Saved Discord preferences could not be read. Presence is paused until you save a setting.".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Preferences::default()),
        Err(_) => Err("Saved Discord preferences could not be read. Presence is paused until you save a setting.".into()),
    }
}

fn save(path: &Path, preferences: Preferences) -> Result<(), String> {
    let write = || -> Result<(), Box<dyn std::error::Error>> {
        let parent = path.parent().ok_or("Missing preferences directory")?;
        std::fs::create_dir_all(parent)?;
        let mut file = tempfile::NamedTempFile::new_in(parent)?;
        file.write_all(&serde_json::to_vec_pretty(&preferences)?)?;
        file.as_file().sync_all()?;
        file.persist(path)?;
        Ok(())
    };
    write().map_err(|_| "Discord preferences could not be saved. Your changes apply for this run; try again before restarting Veil.".into())
}

pub fn setup(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let directory = app.path().app_config_dir()?;
    #[cfg(debug_assertions)]
    let directory = std::env::var_os("VEIL_TEST_SETTINGS_DIR")
        .map(PathBuf::from)
        .unwrap_or(directory);
    let path = directory.join("discord.json");
    let (preferences, warning) = match load(&path) {
        Ok(preferences) => (preferences, None),
        // Never restore public sharing over an unreadable saved opt-out.
        Err(warning) => (
            Preferences {
                enabled: false,
                ..Preferences::default()
            },
            Some(warning),
        ),
    };
    let shared = Arc::new((
        Mutex::new(Model {
            snapshot: Snapshot {
                preferences,
                warning,
                capabilities: Capabilities::default(),
            },
            activity: Activity::default(),
            active: false,
            urgent: true,
            stop: false,
        }),
        Condvar::new(),
    ));
    let worker_shared = shared.clone();
    let worker = std::thread::Builder::new()
        .name("veil-discord".into())
        .spawn(move || run(worker_shared))?;
    app.manage(Discord {
        shared,
        path,
        worker: Mutex::new(Some(worker)),
    });
    Ok(())
}

// The mutex serializes preference changes with bounded IPC transactions. Once a
// privacy command returns, an older queued activity cannot overwrite its result.
fn run(shared: Shared) {
    let mut client = transport::Client::new();
    let mut connected = false;
    let mut published = None;
    let mut last_sent = Instant::now() - HEARTBEAT_INTERVAL;
    let mut retry_at = Instant::now();
    let mut retry_delay = 1;
    loop {
        let (lock, wake) = &*shared;
        let mut model = lock.lock().unwrap();
        if model.stop || !model.active || !model.snapshot.preferences.enabled {
            if connected {
                let _ = client.clear();
                client.disconnect();
                connected = false;
            }
            published = None;
            if model.stop {
                return;
            }
            retry_at = Instant::now();
            retry_delay = 1;
        } else {
            let desired = display(model.snapshot.preferences, &model.activity);
            let now = Instant::now();
            let due = model.urgent || last_sent.elapsed() >= UPDATE_INTERVAL;
            let changed = published.as_ref() != Some(&desired);
            if now >= retry_at && due && (changed || last_sent.elapsed() >= HEARTBEAT_INTERVAL) {
                let result = (|| {
                    if !connected {
                        client.connect()?;
                        connected = true;
                    }
                    client.publish(&desired)
                })();
                match result {
                    Ok(()) => {
                        published = Some(desired);
                        last_sent = Instant::now();
                        model.urgent = false;
                        retry_delay = 1;
                    }
                    Err(()) => {
                        client.disconnect();
                        connected = false;
                        published = None;
                        retry_at = Instant::now() + Duration::from_secs(retry_delay);
                        retry_delay = (retry_delay * 2).min(30);
                    }
                }
            }
        }
        // A bounded wait also probes an unchanged connection after Discord restarts.
        let _guard = wake
            .wait_timeout(model, Duration::from_millis(250))
            .unwrap();
    }
}

fn authorize(caller: &WebviewWindow) -> Result<(), String> {
    if caller.label() != "main" {
        return Err("Only the control panel can manage Discord Rich Presence.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn discord_preferences(
    caller: WebviewWindow,
    state: State<'_, Discord>,
) -> Result<Snapshot, String> {
    authorize(&caller)?;
    Ok(state.shared.0.lock().unwrap().snapshot.clone())
}

#[tauri::command]
pub async fn discord_configure(
    caller: WebviewWindow,
    state: State<'_, Discord>,
    preferences: Preferences,
) -> Result<Snapshot, String> {
    authorize(&caller)?;
    let shared = state.shared.clone();
    let path = state.path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (lock, wake) = &*shared;
        let mut model = lock.lock().unwrap();
        // Apply privacy even when the disk is full; expose persistence failure.
        model.snapshot.preferences = preferences;
        model.snapshot.warning = save(&path, preferences).err();
        model.urgent = true;
        let snapshot = model.snapshot.clone();
        wake.notify_one();
        snapshot
    })
    .await
    .map_err(|_| "Could not update Discord preferences.".into())
}

#[tauri::command]
pub async fn discord_update(
    caller: WebviewWindow,
    state: State<'_, Discord>,
    mut activity: Activity,
) -> Result<(), String> {
    authorize(&caller)?;
    // Bound what is retained, independently of frontend input and privacy flags.
    activity.document_title = activity.document_title.as_deref().map(title);
    let (lock, wake) = &*state.shared;
    let mut model = lock.lock().unwrap();
    if model.activity.document_title.is_some() != activity.document_title.is_some() {
        model.urgent = true;
    }
    model.activity = activity;
    model.active = true;
    wake.notify_one();
    Ok(())
}

pub fn shutdown(app: &AppHandle) {
    if let Some(state) = app.try_state::<Discord>() {
        let (lock, wake) = &*state.shared;
        lock.lock().unwrap().stop = true;
        wake.notify_one();
        if let Some(worker) = state.worker.lock().unwrap().take() {
            let _ = worker.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn privacy_matrix_never_leaks_hidden_fields() {
        for enabled in [false, true] {
            for show_document_title in [false, true] {
                for show_participant_count in [false, true] {
                    let preferences = Preferences {
                        enabled,
                        show_document_title,
                        show_participant_count,
                    };
                    let activity = Activity {
                        document_title: Some("Private project".into()),
                        others_count: 7,
                    };
                    let rendered = display(preferences, &activity);
                    assert_eq!(
                        rendered.details.contains("Private project"),
                        show_document_title
                    );
                    assert_eq!(rendered.state.is_some(), show_participant_count);
                    if show_participant_count {
                        assert_eq!(
                            rendered.state.as_deref(),
                            Some(if show_document_title {
                                "Editing with 7 others"
                            } else {
                                "With 7 others"
                            })
                        );
                    }
                    let idle = display(preferences, &Activity::default());
                    assert_eq!(idle.details, "No document open");
                    assert!(idle.state.is_none());
                }
            }
        }
    }

    #[test]
    fn participant_wording_and_title_limits() {
        for (count, expected) in [
            (0, "Editing solo"),
            (1, "Editing with 1 other"),
            (2, "Editing with 2 others"),
        ] {
            let rendered = display(
                Preferences::default(),
                &Activity {
                    document_title: Some(" \n ".into()),
                    others_count: count,
                },
            );
            assert_eq!(rendered.details, "Document: Untitled document");
            assert_eq!(rendered.state.as_deref(), Some(expected));
        }
        let long = format!("a{}", "📝".repeat(100));
        let shortened = title(&long);
        assert!(shortened.len() <= 128);
        assert!(long.starts_with(&shortened));
        assert_eq!(title("\n Meeting\t notes \r"), "Meeting notes");
        let labeled = display(
            Preferences::default(),
            &Activity {
                document_title: Some(long),
                others_count: 2,
            },
        );
        assert!(labeled.details.starts_with("Document: a"));
        assert!(labeled.details.len() <= 128);
        let named = display(
            Preferences::default(),
            &Activity {
                document_title: Some("My notes".into()),
                others_count: 1,
            },
        );
        assert_eq!(named.details, "Document: My notes");
        assert_eq!(named.state.as_deref(), Some("Editing with 1 other"));
    }

    #[test]
    fn hidden_titles_do_not_repeat_the_editing_message() {
        let preferences = Preferences {
            show_document_title: false,
            ..Preferences::default()
        };
        for (others_count, expected) in [(0, "Solo"), (1, "With 1 other"), (2, "With 2 others")] {
            let rendered = display(
                preferences,
                &Activity {
                    document_title: Some("Private project".into()),
                    others_count,
                },
            );
            assert_eq!(rendered.details, "Editing a document");
            assert_eq!(rendered.state.as_deref(), Some(expected));
        }
    }

    #[test]
    fn preferences_default_migrate_and_preserve_privacy_when_disabled() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("discord.json");
        assert_eq!(load(&path).unwrap(), Preferences::default());
        let older: Preferences = serde_json::from_str(r#"{"enabled":false}"#).unwrap();
        assert!(!older.enabled);
        assert!(older.show_document_title && older.show_participant_count);
        let private = Preferences {
            enabled: false,
            show_document_title: false,
            show_participant_count: false,
        };
        save(&path, private).unwrap();
        assert_eq!(load(&path).unwrap(), private);
        save(
            &path,
            Preferences {
                enabled: true,
                ..private
            },
        )
        .unwrap();
        let reenabled = load(&path).unwrap();
        assert!(reenabled.enabled);
        assert!(!reenabled.show_document_title && !reenabled.show_participant_count);
        let saved = std::fs::read_to_string(&path).unwrap();
        assert!(saved.contains("showDocumentTitle"));
        assert!(!saved.contains("documentTitle"));
        std::fs::write(&path, b"invalid").unwrap();
        assert!(load(&path).is_err());
    }

    #[test]
    fn save_failure_preserves_the_existing_file() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("not-a-directory");
        std::fs::write(&file, b"original").unwrap();
        assert!(save(&file.join("discord.json"), Preferences::default()).is_err());
        assert_eq!(std::fs::read(file).unwrap(), b"original");
    }
}
