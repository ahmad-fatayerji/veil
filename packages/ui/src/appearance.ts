import { useEffect, useState } from 'react';
export type Appearance = 'system' | 'light' | 'dark';
const key = 'veil.appearance';
let memoryAppearance: Appearance = 'system';
export function readAppearance(): Appearance {
  try {
    const value = localStorage.getItem(key);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return memoryAppearance;
  }
}
/** Accent colors; each has tuned light and dark values in tokens.css. */
export const accents = ['blue', 'purple', 'pink', 'orange', 'green', 'teal', 'graphite'] as const;
export type Accent = (typeof accents)[number];
const accentKey = 'veil.accent';
let memoryAccent: Accent = 'blue';
export function readAccent(): Accent {
  try {
    const value = localStorage.getItem(accentKey);
    return accents.find((accent) => accent === value) ?? 'blue';
  } catch {
    return memoryAccent;
  }
}
export function applyAccent(value = readAccent()) {
  document.documentElement.dataset.accent = value;
}
export function applyAppearance(value = readAppearance()) {
  const resolved =
    value === 'system'
      ? matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : value;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  applyAccent();
}
export function useAppearance() {
  const [appearance, set] = useState<Appearance>(readAppearance);
  const [accent, setAccentState] = useState<Accent>(readAccent);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    // Storage events keep the theme and accent in sync between the app's windows.
    const update = () => {
      const value = readAppearance();
      set(value);
      setAccentState(readAccent());
      applyAppearance(value);
    };
    update();
    media.addEventListener('change', update);
    window.addEventListener('storage', update);
    window.addEventListener('veil-appearance', update);
    return () => {
      media.removeEventListener('change', update);
      window.removeEventListener('storage', update);
      window.removeEventListener('veil-appearance', update);
    };
  }, []);
  return {
    appearance,
    setAppearance(value: Appearance) {
      memoryAppearance = value;
      try {
        localStorage.setItem(key, value);
      } catch {
        /* Appearance still works for this window. */
      }
      set(value);
      applyAppearance(value);
      window.dispatchEvent(new Event('veil-appearance'));
    },
    accent,
    setAccent(value: Accent) {
      memoryAccent = value;
      try {
        localStorage.setItem(accentKey, value);
      } catch {
        /* The accent still applies to this window. */
      }
      setAccentState(value);
      applyAccent(value);
      window.dispatchEvent(new Event('veil-appearance'));
    },
  };
}
