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
/**
 * 'veil' keeps the tuned accent in tokens.css, 'windows' follows the system accent, and a
 * `#rrggbb` value is a chosen color. Readable light and dark shades are derived for both.
 */
export type Accent = 'veil' | 'windows' | `#${string}`;

/** The Windows Personalization > Colors grid, in the same order. */
export const windowsColors = [
  '#ffb900',
  '#ff8c00',
  '#f7630c',
  '#ca5010',
  '#da3b01',
  '#ef6950',
  '#d13438',
  '#ff4343',
  '#e74856',
  '#e81123',
  '#ea005e',
  '#c30052',
  '#e3008c',
  '#bf0077',
  '#c239b3',
  '#9a0089',
  '#0078d4',
  '#0063b1',
  '#8e8cd8',
  '#6b69d6',
  '#8764b8',
  '#744da9',
  '#b146c2',
  '#881798',
  '#0099bc',
  '#2d7d9a',
  '#00b7c3',
  '#038387',
  '#00b294',
  '#018574',
  '#00cc6a',
  '#10893e',
  '#7a7574',
  '#5d5a58',
  '#68768a',
  '#515c6b',
  '#567c73',
  '#486860',
  '#498205',
  '#107c10',
  '#767676',
  '#4c4a48',
  '#69797e',
  '#4a5459',
  '#647c64',
  '#525e54',
  '#847545',
  '#7e735f',
] as const;

const accentKey = 'veil.accent';
// The control panel stores the Windows palette here so every window can use it.
const systemAccentKey = 'veil.systemAccent';
let memoryAccent: Accent = 'windows';
let memorySystemAccent: string[] | null = null;
const hex = /^#[0-9a-f]{6}$/i;

function stored(name: string) {
  try {
    return localStorage.getItem(name);
  } catch {
    return null;
  }
}
/** Matching Windows is the default; without a system palette it shows Veil blue. */
export function readAccent(): Accent {
  const value = stored(accentKey) ?? memoryAccent;
  return value === 'veil' || hex.test(value) ? (value as Accent) : 'windows';
}
/** Windows' accent ramp, lightest first: Light3, Light2, Light1, Accent, Dark1, Dark2, Dark3. */
export function readSystemAccent(): string[] | null {
  try {
    const value: unknown = JSON.parse(stored(systemAccentKey) ?? 'null');
    return Array.isArray(value) && value.length >= 7 && value.every((shade) => hex.test(shade))
      ? value
      : memorySystemAccent;
  } catch {
    return memorySystemAccent;
  }
}
/** Record the system palette (null when unavailable) and reapply the accent. */
export function setSystemAccent(palette: string[] | null) {
  memorySystemAccent = palette;
  try {
    if (palette) localStorage.setItem(systemAccentKey, JSON.stringify(palette));
    else localStorage.removeItem(systemAccentKey);
  } catch {
    /* This window still uses the palette. */
  }
  applyAccent();
  window.dispatchEvent(new Event('veil-appearance'));
}

const channels = (color: string) =>
  [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16));
function mix(color: string, other: string, amount: number) {
  const [a, b] = [channels(color), channels(other)];
  return `#${a
    .map((value, index) =>
      Math.round(value + (b[index] - value) * amount)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}
function luminance(color: string) {
  const [r, g, b] = channels(color).map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}
/** Move a color toward `target` until it reaches 4.5:1 against `against`. */
function readable(color: string, target: string, against: string) {
  for (let amount = 0; amount <= 1; amount += 0.04) {
    const candidate = mix(color, target, amount);
    if (contrast(candidate, against) >= 4.5) return candidate;
  }
  return mix(color, target, 1);
}

const accentTokens = ['--accent', '--accent-hover', '--on-accent', '--accent-soft'] as const;
/** Light and dark tokens for an accent; on-accent text and the accent stay at WCAG AA. */
export function accentShades(value: Accent, palette = readSystemAccent()) {
  const ramp = value === 'windows' ? palette : hex.test(value) ? null : undefined;
  if (ramp === undefined || (value === 'windows' && !ramp)) return null;
  const base = ramp ? ramp[3] : value;
  // Windows uses Dark1 as the accent in light mode and Light2 in dark mode.
  const lightBase = ramp ? ramp[4] : base;
  const darkBase = ramp ? ramp[1] : base;
  const light = readable(lightBase, '#000000', '#ffffff');
  const dark = readable(readable(darkBase, '#ffffff', '#1c1c1c'), '#ffffff', '#111111');
  return {
    base,
    light: {
      '--accent': light,
      '--accent-hover': mix(light, '#000000', 0.14),
      '--on-accent': '#ffffff',
      '--accent-soft': mix('#ffffff', light, 0.12),
    },
    dark: {
      '--accent': dark,
      '--accent-hover': mix(dark, '#ffffff', 0.16),
      '--on-accent': '#111111',
      '--accent-soft': mix('#1c1c1c', dark, 0.22),
    },
  };
}
export function applyAccent(value = readAccent()) {
  const root = document.documentElement;
  const shades = accentShades(value);
  for (const token of accentTokens) root.style.removeProperty(token);
  if (!shades) return;
  const tokens = root.dataset.theme === 'dark' ? shades.dark : shades.light;
  for (const token of accentTokens) root.style.setProperty(token, tokens[token]);
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
  const [systemAccent, setSystemAccentState] = useState(readSystemAccent);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    // Storage events keep the theme and accent in sync between the app's windows.
    const update = () => {
      const value = readAppearance();
      set(value);
      setAccentState(readAccent());
      setSystemAccentState(readSystemAccent());
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
    /** The Windows accent ramp when available, for previews and the Match Windows option. */
    systemAccent,
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
