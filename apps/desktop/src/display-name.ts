import { useSyncExternalStore } from 'react';

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

// Every open tab shares one name, so a change made in one tab is used when another joins.
let current: string | null = null;
const listeners = new Set<() => void>();

export function saveDisplayName(value: string) {
  current = value;
  try {
    localStorage.setItem(key, value);
  } catch {
    // The current window remains usable when storage is unavailable.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  // Other windows announce their changes through storage events.
  const changed = (event: StorageEvent) => {
    if (event.key !== key && event.key !== null) return;
    current = readDisplayName();
    listener();
  };
  listeners.add(listener);
  window.addEventListener('storage', changed);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', changed);
  };
}

function snapshot() {
  current ??= readDisplayName();
  return current;
}

export function useDisplayName(): string {
  return useSyncExternalStore(subscribe, snapshot);
}
