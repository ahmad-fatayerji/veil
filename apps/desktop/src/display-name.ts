const key = 'veil.display-name';

// Preferences are local to this WebView profile, like the appearance setting.
export function readDisplayName(): string {
  try {
    const value = localStorage.getItem(key);
    return value !== null && value.length <= 40 ? value : '';
  } catch {
    return '';
  }
}

export function saveDisplayName(value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The current window remains usable when storage is unavailable.
  }
}
