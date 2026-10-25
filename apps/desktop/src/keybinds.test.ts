import { describe, expect, it } from 'vitest';
import { matchesShortcut, shortcutFromEvent } from './keybinds';

function key(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: 'n',
    code: 'KeyN',
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    defaultPrevented: false,
    repeat: false,
    isComposing: false,
    ...overrides,
  } as KeyboardEvent;
}

describe('device-local keybind matching', () => {
  it('keeps number-row shortcuts stable, including shifted numbers', () => {
    expect(shortcutFromEvent(key({ key: '!', code: 'Digit1', shiftKey: true }))).toBe(
      'Ctrl+Shift+1',
    );
    expect(shortcutFromEvent(key({ key: '&', code: 'Digit1' }))).toBe('Ctrl+1');
    expect(shortcutFromEvent(key({ key: 'F12', code: 'F12', ctrlKey: false, altKey: true }))).toBe(
      'Alt+F12',
    );
  });

  it.each([
    ['a', 'KeyQ', 'A'],
    ['q', 'KeyA', 'Q'],
    ['z', 'KeyW', 'Z'],
    ['w', 'KeyZ', 'W'],
    ['m', 'Semicolon', 'M'],
    ['y', 'KeyZ', 'Y'],
    ['b', 'KeyN', 'B'],
  ])('records and matches layout letter %s from physical %s', (letter, code, expected) => {
    const event = key({ key: letter, code, altKey: true });
    expect(shortcutFromEvent(event)).toBe(`Ctrl+Alt+${expected}`);
    expect(matchesShortcut(event, `Ctrl+Alt+${expected}`)).toBe(true);
    expect(matchesShortcut(event, `Ctrl+Alt+${code.replace('Key', '')}`)).toBe(false);
    expect(shortcutFromEvent(key({ key: letter.toUpperCase(), code, shiftKey: true }))).toBe(
      `Ctrl+Shift+${expected}`,
    );
  });

  it('requires a supported non-modifier key with Ctrl or Alt', () => {
    expect(shortcutFromEvent(key({ ctrlKey: false }))).toBeNull();
    expect(shortcutFromEvent(key({ metaKey: true }))).toBeNull();
    for (const [value, code] of [
      ['Escape', 'Escape'],
      ['Control', 'ControlLeft'],
      ['1', 'Numpad1'],
      ['F13', 'F13'],
      ['Dead', 'Quote'],
      ['Unidentified', 'KeyA'],
      [';', 'Semicolon'],
    ]) {
      expect(shortcutFromEvent(key({ key: value, code }))).toBeNull();
    }
  });

  it('matches only the assigned modifiers and ignores consumed, repeated and composing events', () => {
    expect(matchesShortcut(key(), 'Ctrl+N')).toBe(true);
    expect(matchesShortcut(key(), 'Ctrl+J')).toBe(false);
    expect(matchesShortcut(key({ shiftKey: true }), 'Ctrl+N')).toBe(false);
    expect(matchesShortcut(key({ altKey: true }), 'Ctrl+N')).toBe(false);
    for (const overrides of [{ defaultPrevented: true }, { repeat: true }, { isComposing: true }]) {
      expect(matchesShortcut(key(overrides), 'Ctrl+N')).toBe(false);
    }
  });
});
