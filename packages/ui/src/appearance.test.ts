import { describe, expect, it } from 'vitest';
import { accentShades, windowsColors } from './appearance';

function luminance(color: string) {
  const [r, g, b] = [1, 3, 5].map((index) => {
    const channel = parseInt(color.slice(index, index + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};

describe('accent colors', () => {
  // A Windows AccentPalette for red, lightest first.
  const palette = ['#fb9d8b', '#f46762', '#ef2733', '#e81123', '#d20e1e', '#9e0912', '#6f0306'];

  it('keeps every Windows color readable in light and dark themes', () => {
    for (const color of windowsColors) {
      const shades = accentShades(color, null)!;
      expect(contrast(shades.light['--accent'], '#ffffff')).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(shades.light['--accent'], shades.light['--on-accent']),
      ).toBeGreaterThanOrEqual(4.5);
      expect(contrast(shades.dark['--accent'], '#1c1c1c')).toBeGreaterThanOrEqual(4.5);
      expect(contrast(shades.dark['--accent'], shades.dark['--on-accent'])).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it('follows the Windows ramp, falling back to Veil blue without one', () => {
    const shades = accentShades('windows', palette)!;
    expect(shades.base).toBe('#e81123');
    // Windows uses Dark1 in light mode and Light2 in dark mode; both are already readable.
    expect(shades.light['--accent']).toBe('#d20e1e');
    expect(shades.dark['--accent']).toBe('#f46762');
    expect(accentShades('windows', null)).toBeNull();
    expect(accentShades('veil', palette)).toBeNull();
  });
});
