//! Reads the Windows accent palette so Veil can match the system accent color.

/// The shades Windows derives from the accent color, as `#rrggbb`, lightest first:
/// Light3, Light2, Light1, Accent, Dark1, Dark2 and Dark3. `None` when the system
/// does not provide a palette, in which case Veil keeps its own accent.
#[tauri::command]
pub fn system_accent() -> Option<Vec<String>> {
    #[cfg(windows)]
    {
        let key = windows_registry::CURRENT_USER
            .open(r"Software\Microsoft\Windows\CurrentVersion\Explorer\Accent")
            .ok()?;
        parse_palette(&key.get_value("AccentPalette").ok()?)
    }
    #[cfg(not(windows))]
    {
        None
    }
}

/// `AccentPalette` holds eight RGBA entries; the eighth is not part of the accent ramp.
#[cfg_attr(not(windows), allow(dead_code))]
fn parse_palette(bytes: &[u8]) -> Option<Vec<String>> {
    if bytes.len() < 28 {
        return None;
    }
    let (entries, _) = bytes.as_chunks::<4>();
    Some(
        entries
            .iter()
            .take(7)
            .map(|[red, green, blue, _]| format!("#{red:02x}{green:02x}{blue:02x}"))
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::parse_palette;

    #[test]
    fn reads_the_seven_accent_shades_and_rejects_short_values() {
        let bytes = [
            0xfb, 0x9d, 0x8b, 0, 0xf4, 0x67, 0x62, 0, 0xef, 0x27, 0x33, 0, 0xe8, 0x11, 0x23, 0,
            0xd2, 0x0e, 0x1e, 0, 0x9e, 0x09, 0x12, 0, 0x6f, 0x03, 0x06, 0, 0x69, 0x79, 0x7e, 0,
        ];
        let palette = parse_palette(&bytes).unwrap();
        assert_eq!(palette.len(), 7);
        assert_eq!(palette[3], "#e81123");
        assert_eq!(palette[4], "#d20e1e");
        assert!(parse_palette(&bytes[..20]).is_none());
    }
}
