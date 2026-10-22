import { useState } from 'react';
import { Banner, Button, Kbd } from '@veil/ui';
import {
  defaultKeybinds,
  keybindActions,
  shortcutFromEvent,
  type KeybindAction,
} from '../keybinds';
import { errorMessage, invoke, useOverlay, type OverlaySnapshot } from '../overlay/api';
import { SettingRow } from './SettingRow';

export function KeybindSettings({ disabled }: { disabled: boolean }) {
  const { state, setState, error, setError } = useOverlay();
  const [recording, setRecording] = useState<KeybindAction | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const bindings = state?.settings.keybinds ?? defaultKeybinds;
  async function save(next: typeof bindings) {
    setRecording(null);
    setSaving(true);
    setError('');
    setStatus('');
    try {
      setState(await invoke<OverlaySnapshot>('overlay_update', { patch: { keybinds: next } }));
      setStatus('Keybinds saved.');
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <h3>Keybinds</h3>
      <p>
        Choose a shortcut, then press Ctrl or Alt, optionally with Shift, plus a letter, number, or
        F1-F12. Press Escape to cancel.
      </p>
      <div className="settings-card">
        {keybindActions.map(({ id, label, description }) => (
          <SettingRow key={id} label={label} description={description}>
            <div className="keybind-actions">
              <Button
                aria-label={`Rebind ${label}: ${bindings[id]}`}
                aria-pressed={recording === id}
                disabled={disabled || saving || !state}
                onClick={() => {
                  setRecording(recording === id ? null : id);
                  setError('');
                  setStatus('');
                }}
                onBlur={() => setRecording(null)}
                onKeyDown={(event) => {
                  if (recording !== id) return;
                  if (event.key === 'Tab') {
                    setRecording(null);
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  if (event.key === 'Escape') {
                    setRecording(null);
                    return;
                  }
                  if (event.repeat || event.nativeEvent.isComposing) return;
                  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;
                  const shortcut = shortcutFromEvent(event);
                  if (!shortcut) {
                    setError('Use Ctrl or Alt with a letter, number, or F1-F12 key.');
                    return;
                  }
                  const conflict = keybindActions.find(
                    (action) => action.id !== id && bindings[action.id] === shortcut,
                  );
                  if (conflict) {
                    setError(`${shortcut} is already assigned to ${conflict.label}.`);
                    return;
                  }
                  void save({ ...bindings, [id]: shortcut });
                }}
              >
                {recording === id ? 'Press shortcut...' : <Kbd>{bindings[id]}</Kbd>}
              </Button>
              <Button
                variant="ghost"
                disabled={disabled || saving || !state || bindings[id] === defaultKeybinds[id]}
                aria-label={`Reset ${label}`}
                onClick={() => void save({ ...bindings, [id]: defaultKeybinds[id] })}
              >
                Reset
              </Button>
            </div>
          </SettingRow>
        ))}
      </div>
      <div className="dialog-actions dialog-actions-start">
        <Button
          disabled={disabled || saving || !state}
          onClick={() => void save({ ...defaultKeybinds })}
        >
          Reset all keybinds
        </Button>
      </div>
      {state && (!state.recoveryAvailable || !state.hideShortcutAvailable) && (
        <Banner tone="danger">
          A global shortcut is unavailable. Choose a different combination or reset keybinds. You
          can restore controls from the tray menu.
        </Banner>
      )}
      {error && <Banner tone="danger">{error}</Banner>}
      <p role="status" aria-live="polite">
        {recording
          ? 'Listening for a shortcut. Escape cancels.'
          : saving
            ? 'Saving keybinds...'
            : status}
      </p>
    </>
  );
}
