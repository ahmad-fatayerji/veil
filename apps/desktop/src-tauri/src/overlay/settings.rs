use super::OverlayError;
use serde::{Deserialize, Serialize};
use std::{io::Write, path::Path};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub version: u32,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub opacity: f64,
    pub always_on_top: bool,
    pub click_through: bool,
    pub capture_exclusion: bool,
    pub font_size: u32,
    pub visible: bool,
    pub close_behavior: crate::lifecycle::CloseBehavior,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: 1,
            x: 80,
            y: 80,
            width: 520,
            height: 320,
            opacity: 0.85,
            always_on_top: true,
            click_through: false,
            capture_exclusion: false,
            font_size: 20,
            visible: false,
            close_behavior: crate::lifecycle::CloseBehavior::Tray,
        }
    }
}

impl Settings {
    pub fn validate(&self) -> Result<(), OverlayError> {
        if self.version != 1
            || !self.opacity.is_finite()
            || !(0.2..=1.0).contains(&self.opacity)
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
            let settings: Settings =
                serde_json::from_slice(&bytes).map_err(OverlayError::storage)?;
            settings.validate()?;
            Ok(settings)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
        Err(error) => Err(OverlayError::storage(error)),
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
    fn capture_preference_is_opt_in_and_legacy_settings_still_load() {
        let old = serde_json::json!({"version": 1, "opacity": 0.65, "fontSize": 24});
        let mut settings: Settings = serde_json::from_value(old).unwrap();
        settings.validate().unwrap();
        assert!(!settings.capture_exclusion);
        assert_eq!(
            settings.close_behavior,
            crate::lifecycle::CloseBehavior::Tray
        );
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("overlay.json");
        settings.capture_exclusion = true;
        settings.close_behavior = crate::lifecycle::CloseBehavior::Quit;
        save(&path, &settings).unwrap();
        assert!(load(&path).unwrap().capture_exclusion);
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
            opacity: 0.42,
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
        value.opacity = 0.1;
        assert!(value.validate().is_err());
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
