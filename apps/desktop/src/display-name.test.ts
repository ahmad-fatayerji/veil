import { afterEach, describe, expect, it, vi } from 'vitest';
import { readDisplayName, saveDisplayName } from './display-name';

afterEach(() => vi.unstubAllGlobals());

describe('device-local display name', () => {
  it('restores the saved name and retains an intentionally empty preference', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    expect(readDisplayName()).toBe('');
    saveDisplayName('Alex');
    expect(readDisplayName()).toBe('Alex');
    saveDisplayName('');
    expect(values.get('veil.display-name')).toBe('');
    expect(readDisplayName()).toBe('');
  });

  it('rejects stored values exceeding the input limit', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'x'.repeat(41) });
    expect(readDisplayName()).toBe('');
  });

  it('keeps the application usable if storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('Unavailable');
      },
      setItem: () => {
        throw new Error('Unavailable');
      },
    });
    expect(readDisplayName()).toBe('');
    expect(() => saveDisplayName('Alex')).not.toThrow();
  });
});
