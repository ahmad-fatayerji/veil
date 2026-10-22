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
  it('uses physical keys consistently with native shortcuts, including shifted numbers', () => {
    expect(shortcutFromEvent(key({ key: '!', code: 'Digit1', shiftKey: true }))).toBe(
      'Ctrl+Shift+1',
    );
    expect(shortcutFromEvent(key({ key: 'a', code: 'KeyQ', altKey: true }))).toBe('Ctrl+Alt+Q');
    expect(shortcutFromEvent(key({ key: 'F12', code: 'F12', ctrlKey: false, altKey: true }))).toBe(
      'Alt+F12',
    );
  });

  it('requires a supported non-modifier key with Ctrl or Alt', () => {
    expect(shortcutFromEvent(key({ ctrlKey: false }))).toBeNull();
    expect(shortcutFromEvent(key({ metaKey: true }))).toBeNull();
    for (code of ['Escape', 'ControlLeft', 'Numpad1', 'F13']) {
      expect(shortcutFromEvent(key({ code }))).toBeNull();
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
