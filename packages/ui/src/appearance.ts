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
export function applyAppearance(value = readAppearance()) {
  const resolved =
    value === 'system'
      ? matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : value;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}
export function useAppearance() {
  const [appearance, set] = useState<Appearance>(readAppearance);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const update = () => {
      const value = readAppearance();
      set(value);
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
  };
}
