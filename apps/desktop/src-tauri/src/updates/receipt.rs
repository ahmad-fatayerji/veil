use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    pub from_version: String,
    pub to_version: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Completion {
    pub success: bool,
    pub message: String,
}

pub fn read(path: &Path, current: &str) -> Result<Option<Completion>, String> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("The previous update result could not be read.".into()),
    };
    let receipt: Receipt = serde_json::from_slice(&bytes).map_err(|_| {
        "The previous update record is damaged. Check the installed version in App updates."
    })?;
    let success = receipt.to_version == current;
    Ok(Some(Completion {
        success,
        message: if success {
            format!(
                "Veil updated successfully from {} to {}.",
                receipt.from_version, current
            )
        } else {
            format!("The update to {} did not complete as expected. Veil is running {}. Check for updates to try again.", receipt.to_version, current)
        },
    }))
}

pub fn remove(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("Could not dismiss the saved update result. Try again.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn relaunch_confirms_exact_version_and_keeps_feedback_until_dismissed() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("receipt.json");
        assert!(read(&path, "0.2.0").unwrap().is_none());
        let record = Receipt {
            from_version: "0.1.0".into(),
            to_version: "0.2.0".into(),
        };
        crate::updates::save_json(&path, &record).unwrap();
        assert!(read(&path, "0.2.0").unwrap().unwrap().success);
        assert!(read(&path, "0.2.0").unwrap().unwrap().success);
        assert!(!read(&path, "0.1.0").unwrap().unwrap().success);
        assert!(!read(&path, "0.3.0").unwrap().unwrap().success);
        remove(&path).unwrap();
        assert!(read(&path, "0.2.0").unwrap().is_none());
        std::fs::write(&path, b"damaged").unwrap();
        assert!(read(&path, "0.2.0").is_err());
    }
}
