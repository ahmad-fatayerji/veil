use super::OverlayError;
use serde::{Deserialize, Serialize};
use std::{io::Write, path::Path};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct Keybinds {
    pub new_document: String,
    pub open_document: String,
    pub save_document: String,
    pub save_document_as: String,
    pub join_document: String,
    pub copy_invite: String,
    pub close_document: String,
    pub recover_controls: String,
    pub toggle_overlay: String,
}

impl Default for Keybinds {
    fn default() -> Self {
        Self {
            new_document: "Ctrl+N".into(),
            open_document: "Ctrl+O".into(),
            save_document: "Ctrl+S".into(),
            save_document_as: "Ctrl+Shift+S".into(),
            join_document: "Ctrl+J".into(),
            copy_invite: "Ctrl+Shift+C".into(),
            close_document: "Ctrl+W".into(),
            recover_controls: "Ctrl+Alt+V".into(),
            toggle_overlay: "Ctrl+Alt+Shift+V".into(),
        }
    }
}

impl Keybinds {
    pub fn validate(&self) -> Result<(), OverlayError> {
        let bindings = [
            &self.new_document,
            &self.open_document,
            &self.save_document,
            &self.save_document_as,
            &self.join_document,
            &self.copy_invite,
            &self.close_document,
            &self.recover_controls,
            &self.toggle_overlay,
        ];
        let mut used = std::collections::HashSet::new();
        for binding in bindings {
            let parts: Vec<_> = binding.split('+').collect();
            let key = *parts.last().unwrap_or(&"");
            let modifiers = &parts[..parts.len().saturating_sub(1)];
            let canonical: Vec<_> = ["Ctrl", "Alt", "Shift"]
                .into_iter()
                .filter(|modifier| modifiers.contains(modifier))
                .collect();
            let valid_key = (key.len() == 1
                && key
                    .bytes()
                    .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()))
                || (1..=12).any(|n| key == format!("F{n}"));
            if !valid_key
                || modifiers != canonical.as_slice()
                || !(modifiers.contains(&"Ctrl") || modifiers.contains(&"Alt"))
            {
                return Err(OverlayError::new(
                    "INVALID_KEYBIND",
                    "Use Ctrl or Alt with a letter, number, or F1-F12 key.",
                ));
            }
            let shortcut = binding
                .parse::<tauri_plugin_global_shortcut::Shortcut>()
                .map_err(|_| OverlayError::new("INVALID_KEYBIND", "Unsupported shortcut."))?;
            if !used.insert(shortcut.id()) {
                return Err(OverlayError::new(
                    "KEYBIND_CONFLICT",
                    "Each action must have a different shortcut.",
                ));
            }
        }
        Ok(())
    }
}

/// How the overlay offers text formatting; shortcuts and Markdown typing always work.
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Formatting {
    /// A floating toolbar above a text selection.
    Bubble,
    /// A compact toolbar row below the overlay header.
    #[default]
    Toolbar,
    /// Keyboard shortcuts only.
    None,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub version: u32,
    pub keybinds: Keybinds,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub opacity: f64,
    pub text_opacity: f64,
    pub opacity_linked: bool,
    pub always_on_top: bool,
    pub click_through: bool,
    pub capture_exclusion: bool,
    pub font_size: u32,
    pub formatting: Formatting,
    pub visible: bool,
    pub close_behavior: crate::lifecycle::CloseBehavior,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: 1,
            keybinds: Keybinds::default(),
            x: 80,
            y: 80,
            width: 520,
            height: 320,
            opacity: 0.85,
            text_opacity: 1.0,
            opacity_linked: false,
            always_on_top: true,
            click_through: false,
            capture_exclusion: true,
            font_size: 20,
            formatting: Formatting::Toolbar,
            visible: false,
            close_behavior: crate::lifecycle::CloseBehavior::Tray,
        }
    }
}

impl Settings {
    pub fn validate(&self) -> Result<(), OverlayError> {
        self.keybinds.validate()?;
        if self.version != 1
            || !self.opacity.is_finite()
            || !(0.0..=1.0).contains(&self.opacity)
            || !self.text_opacity.is_finite()
            || !(0.0..=1.0).contains(&self.text_opacity)
            || !(280..=4096).contains(&self.width)
            || !(180..=4096).contains(&self.height)
            || !(12..=48).contains(&self.font_size)
        {
            return Err(OverlayError::new(
                "INVALID_SETTINGS",
                "Overlay settings are outside the supported range.",
            ));
        }
        Ok(())
    }

    // Work areas use physical pixels, like the stored bounds. Keep the complete window reachable.
    pub fn fit(&mut self, areas: &[(i32, i32, u32, u32)]) {
        let selected = areas
            .iter()
            .find(|(x, y, w, h)| {
                self.x as i64 + self.width as i64 > *x as i64
                    && (self.x as i64) < *x as i64 + *w as i64
                    && self.y as i64 + self.height as i64 > *y as i64
                    && (self.y as i64) < *y as i64 + *h as i64
            })
            .or_else(|| areas.first());
        if let Some(&(x, y, w, h)) = selected {
            self.width = self.width.min(w.max(280));
            self.height = self.height.min(h.max(180));
            self.x = (self.x as i64).clamp(x as i64, x as i64 + w.saturating_sub(self.width) as i64)
                as i32;
            self.y = (self.y as i64)
                .clamp(y as i64, y as i64 + h.saturating_sub(self.height) as i64)
                as i32;
        }
    }
}

pub fn load(path: &Path) -> Result<Settings, OverlayError> {
    match std::fs::read(path) {
        Ok(bytes) => {
            let raw: serde_json::Value =
                serde_json::from_slice(&bytes).map_err(OverlayError::storage)?;
            let mut settings: Settings =
                serde_json::from_value(raw.clone()).map_err(OverlayError::storage)?;
            migrate_file_bindings(&mut settings.keybinds, raw.get("keybinds"));
            settings.validate()?;
            Ok(settings)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
        Err(error) => Err(OverlayError::storage(error)),
    }
}

// Older preferences could already assign Ctrl+O/S/Shift+S to another action.
// Keep those choices, assigning a free shortcut only to newly introduced actions.
fn migrate_file_bindings(bindings: &mut Keybinds, saved: Option<&serde_json::Value>) {
    let mut used: std::collections::HashSet<String> = [
        &bindings.new_document,
        &bindings.join_document,
        &bindings.copy_invite,
        &bindings.close_document,
        &bindings.recover_controls,
        &bindings.toggle_overlay,
    ]
    .into_iter()
    .cloned()
    .collect();
    for (name, value) in [
        ("openDocument", &bindings.open_document),
        ("saveDocument", &bindings.save_document),
        ("saveDocumentAs", &bindings.save_document_as),
    ] {
        if saved.and_then(|saved| saved.get(name)).is_some() {
            used.insert(value.clone());
        }
    }
    for (name, value) in [
        ("openDocument", &mut bindings.open_document),
        ("saveDocument", &mut bindings.save_document),
        ("saveDocumentAs", &mut bindings.save_document_as),
    ] {
        if saved.and_then(|saved| saved.get(name)).is_none() {
            if used.contains(value) {
                if let Some(free) = (1..=12)
                    .map(|n| format!("Alt+Shift+F{n}"))
                    .find(|candidate| !used.contains(candidate))
                {
                    *value = free;
                }
            }
            used.insert(value.clone());
        }
    }
}

pub fn save(path: &Path, settings: &Settings) -> Result<(), OverlayError> {
    settings.validate()?;
    let parent = path
        .parent()
        .ok_or_else(|| OverlayError::storage("Missing settings directory"))?;
    std::fs::create_dir_all(parent).map_err(OverlayError::storage)?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(OverlayError::storage)?;
    let bytes = serde_json::to_vec_pretty(settings).map_err(OverlayError::storage)?;
    file.write_all(&bytes).map_err(OverlayError::storage)?;
    file.as_file().sync_all().map_err(OverlayError::storage)?;
    file.persist(path).map_err(OverlayError::storage)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_custom_shortcuts_survive_new_file_actions() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("overlay.json");
        std::fs::write(
            &path,
            br#"{"version":1,"keybinds":{"newDocument":"Ctrl+S","joinDocument":"Ctrl+O"}}"#,
        )
        .unwrap();
        let settings = load(&path).unwrap();
        assert_eq!(settings.keybinds.new_document, "Ctrl+S");
        assert_eq!(settings.keybinds.join_document, "Ctrl+O");
        assert_ne!(settings.keybinds.save_document, "Ctrl+S");
        assert_ne!(settings.keybinds.open_document, "Ctrl+O");
        settings.validate().unwrap();
        save(&path, &settings).unwrap();
        assert_eq!(load(&path).unwrap(), settings);
    }

    #[test]
    fn keybinds_migrate_and_persist_independently_of_documents() {
        let old: Settings =
            serde_json::from_value(serde_json::json!({"version": 1, "opacity": 0.65})).unwrap();
        assert_eq!(old.keybinds, Keybinds::default());
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("overlay.json");
        let mut next = old;
        next.keybinds.recover_controls = "Ctrl+Alt+R".into();
        next.keybinds.new_document = "Alt+Shift+F12".into();
        save(&path, &next).unwrap();
        assert_eq!(load(&path).unwrap(), next);
    }

    #[test]
    fn keybinds_reject_duplicates_and_unsupported_combinations() {
        let mut bindings = Keybinds::default();
        bindings.validate().unwrap();
        bindings.new_document = bindings.recover_controls.clone();
        assert!(bindings.validate().is_err());
        for value in [
            "N",
            "Shift+N",
            "Ctrl+Ctrl+N",
            "Alt+Ctrl+N",
            "Ctrl+F13",
            "Ctrl+Escape",
            "Ctrl+",
            "",
        ] {
            bindings.new_document = value.into();
            assert!(bindings.validate().is_err(), "{value}");
        }
        for value in ["Ctrl+Alt+Shift+1", "Alt+F12", "Ctrl+0"] {
            bindings.new_document = value.into();
            bindings.validate().unwrap();
        }
    }

    #[test]
    fn capture_preference_defaults_on_and_preserves_saved_choices() {
        let old = serde_json::json!({"version": 1, "opacity": 0.65, "fontSize": 24});
        let mut settings: Settings = serde_json::from_value(old).unwrap();
        settings.validate().unwrap();
        assert!(Settings::default().capture_exclusion);
        assert!(settings.capture_exclusion);
        assert_eq!(settings.text_opacity, 1.0);
        assert!(!settings.opacity_linked);
        assert_eq!(settings.formatting, Formatting::Toolbar);
        assert_eq!(
            settings.close_behavior,
            crate::lifecycle::CloseBehavior::Tray
        );
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("overlay.json");
        settings.capture_exclusion = false;
        save(&path, &settings).unwrap();
        assert!(!load(&path).unwrap().capture_exclusion);
        settings.capture_exclusion = true;
        settings.close_behavior = crate::lifecycle::CloseBehavior::Quit;
        settings.opacity_linked = true;
        settings.formatting = Formatting::Bubble;
        save(&path, &settings).unwrap();
        assert!(load(&path).unwrap().capture_exclusion);
        assert!(load(&path).unwrap().opacity_linked);
        assert_eq!(load(&path).unwrap().formatting, Formatting::Bubble);
        assert_eq!(
            serde_json::to_value(Formatting::None).unwrap(),
            serde_json::json!("none")
        );
        assert_eq!(
            load(&path).unwrap().close_behavior,
            crate::lifecycle::CloseBehavior::Quit
        );
        assert_eq!(load(&path).unwrap().opacity, 0.65);
    }

    #[test]
    fn settings_replace_atomically_and_reject_corruption() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("overlay.json");
        assert_eq!(load(&path).unwrap(), Settings::default());
        let mut value = Settings {
            x: -1200,
            opacity: 0.0,
            text_opacity: 0.42,
            click_through: true,
            ..Settings::default()
        };
        save(&path, &value).unwrap();
        assert_eq!(load(&path).unwrap(), value);
        value.font_size = 32;
        save(&path, &value).unwrap();
        assert_eq!(load(&path).unwrap(), value);
        assert_eq!(std::fs::read_dir(folder.path()).unwrap().count(), 1);
        std::fs::write(&path, b"{broken").unwrap();
        assert!(load(&path).is_err());
        value.opacity = f64::NAN;
        assert!(save(&path, &value).is_err());
        value.opacity = -0.1;
        assert!(value.validate().is_err());
        value.opacity = 1.0;
        for opacity in [0.0, 1.0] {
            value.text_opacity = opacity;
            value.validate().unwrap();
        }
        for opacity in [f64::NAN, -0.1, 1.1] {
            value.text_opacity = opacity;
            assert!(value.validate().is_err());
        }
    }

    #[test]
    fn bounds_recover_after_monitor_removal_and_support_negative_coordinates() {
        let mut value = Settings {
            x: -2000,
            y: 9000,
            width: 3000,
            ..Settings::default()
        };
        value.fit(&[(0, 0, 1920, 1080)]);
        assert_eq!((value.x, value.y, value.width), (0, 760, 1920));
        value.x = -900;
        value.y = 100;
        value.width = 520;
        value.fit(&[(-1280, 0, 1280, 1024), (0, 0, 1920, 1080)]);
        assert_eq!((value.x, value.y), (-900, 100));
    }
}
