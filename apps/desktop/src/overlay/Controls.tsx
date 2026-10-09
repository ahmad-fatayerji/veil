import { useState } from 'react';
import { errorMessage, invoke, useOverlay, type OverlayPatch, type OverlaySnapshot } from './api';

export function OverlayControls() {
  const { state, setState, error, setError } = useOverlay();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  async function run(command: string, args?: Record<string, unknown>) {
    setBusy(true);
    setError('');
    try {
      setState(await invoke<OverlaySnapshot>(command, args));
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  const update = (patch: OverlayPatch) => run('overlay_update', { patch });
  return (
    <section className="overlay-controls" aria-label="Overlay controls">
      <div className="overlay-controls-row">
        <span className="overlay-controls-title">Desktop overlay</span>
        <span className="overlay-controls-status">
          {state?.settings.visible ? 'Visible' : 'Hidden'}
        </span>
        <button
          className="outline-button"
          disabled={!state || busy}
          onClick={() => void run('overlay_visibility', { visible: !state?.settings.visible })}
        >
          {state?.settings.visible ? 'Hide overlay' : 'Show overlay'}
        </button>
        <button
          className="quiet-button"
          aria-expanded={expanded}
          aria-controls="overlay-settings"
          onClick={() => setExpanded(!expanded)}
        >
          Settings
        </button>
      </div>
      {expanded && state && (
        <div id="overlay-settings" className="overlay-settings">
          <div className="overlay-settings-grid">
            <label className="overlay-range" htmlFor="overlay-opacity">
              Opacity <output>{Math.round(state.settings.opacity * 100)}%</output>
              <input
                id="overlay-opacity"
                type="range"
                min="20"
                max="100"
                step="5"
                value={Math.round(state.settings.opacity * 100)}
                disabled={!state.capabilities.transparency || busy}
                onChange={(event) => void update({ opacity: Number(event.target.value) / 100 })}
              />
            </label>
            <label className="overlay-range" htmlFor="overlay-font-size">
              Font size <output>{state.settings.fontSize}px</output>
              <input
                id="overlay-font-size"
                type="range"
                min="12"
                max="48"
                step="2"
                value={state.settings.fontSize}
                disabled={busy}
                onChange={(event) => void update({ fontSize: Number(event.target.value) })}
              />
            </label>
            <label className="overlay-check">
              <input
                type="checkbox"
                checked={state.settings.alwaysOnTop}
                disabled={!state.capabilities.alwaysOnTop || busy}
                onChange={(event) => void update({ alwaysOnTop: event.target.checked })}
              />{' '}
              Always on top
            </label>
            <label className="overlay-check">
              <input
                type="checkbox"
                checked={state.settings.clickThrough}
                disabled={!state.capabilities.clickThrough || !state.recoveryAvailable || busy}
                onChange={(event) => void update({ clickThrough: event.target.checked })}
              />{' '}
              Click-through
            </label>
          </div>
          <div className="overlay-settings-actions">
            <button
              className="quiet-button"
              disabled={busy}
              onClick={() => void run('overlay_recover')}
            >
              Restore interaction
            </button>
            <button
              className="quiet-button"
              disabled={busy}
              onClick={() => void run('overlay_reset_position')}
            >
              Reset position & size
            </button>
            <span>
              {state.settings.width} × {state.settings.height}
            </span>
          </div>
          <p className="overlay-help">
            Drag the overlay header to move it, or an edge to resize it. Appearance is saved on this
            device.
          </p>
          <p className="overlay-help">
            {state.recoveryAvailable ? (
              <>
                <kbd>Ctrl+Alt+V</kbd> restores interaction and opens this control panel.
              </>
            ) : (
              'Recovery shortcut unavailable. Click-through is disabled.'
            )}{' '}
            {state.hideShortcutAvailable && (
              <>
                <kbd>Ctrl+Alt+Shift+V</kbd> hides or shows the overlay.
              </>
            )}
          </p>
          {(!state.capabilities.transparency ||
            !state.capabilities.alwaysOnTop ||
            !state.capabilities.clickThrough) && (
            <p className="overlay-help">Some window controls are unavailable on this platform.</p>
          )}
          <p className="overlay-help">
            M1 uses preview text. Live shared-document display is planned for M3.
          </p>
        </div>
      )}
      {(error || state?.warning) && (
        <p className="overlay-error" role="alert">
          {error || state?.warning}
        </p>
      )}
    </section>
  );
}
