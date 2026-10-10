import { useRef, useState } from 'react';
import { errorMessage, invoke, useOverlay, type OverlayPatch, type OverlaySnapshot } from './api';

export function OverlayControls({ settingsOnly = false }: { settingsOnly?: boolean }) {
  const { state, setState, error, setError } = useOverlay();
  const [expanded, setExpanded] = useState(settingsOnly);
  const [captureExpanded, setCaptureExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<OverlayPatch>({});
  const pending = useRef<OverlayPatch>({});
  const saving = useRef<Promise<void> | null>(null);
  function flushRanges(): Promise<void> {
    if (saving.current) return saving.current;
    saving.current = (async () => {
      while (Object.keys(pending.current).length) {
        const patch = pending.current;
        pending.current = {};
        try {
          setState(await invoke<OverlaySnapshot>('overlay_update', { patch }));
        } catch (failure) {
          setError(errorMessage(failure));
        }
        setDraft((current) => {
          const next = { ...current };
          for (const key of ['opacity', 'fontSize'] as const) {
            if (next[key] === patch[key]) delete next[key];
          }
          return next;
        });
      }
    })().finally(() => {
      saving.current = null;
    });
    return saving.current;
  }
  function range(patch: OverlayPatch) {
    setError('');
    setDraft((current) => ({ ...current, ...patch }));
    pending.current = { ...pending.current, ...patch };
    void flushRanges();
  }
  async function run(command: string, args?: Record<string, unknown>) {
    setBusy(true);
    setError('');
    try {
      await flushRanges();
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
        {!settingsOnly && (
          <button
            className="quiet-button"
            aria-expanded={expanded}
            aria-controls="overlay-settings"
            onClick={() => setExpanded(!expanded)}
          >
            Settings
          </button>
        )}
      </div>
      {expanded && state && (
        <div id="overlay-settings" className="overlay-settings">
          <div className="overlay-settings-grid">
            <label className="overlay-range" htmlFor="overlay-opacity">
              Opacity{' '}
              <output>{Math.round((draft.opacity ?? state.settings.opacity) * 100)}%</output>
              <input
                id="overlay-opacity"
                type="range"
                min="20"
                max="100"
                step="1"
                value={Math.round((draft.opacity ?? state.settings.opacity) * 100)}
                disabled={!state.capabilities.transparency}
                onChange={(event) => range({ opacity: Number(event.target.value) / 100 })}
              />
            </label>
            <label className="overlay-range" htmlFor="overlay-font-size">
              Font size <output>{draft.fontSize ?? state.settings.fontSize}px</output>
              <input
                id="overlay-font-size"
                type="range"
                min="12"
                max="48"
                step="2"
                value={draft.fontSize ?? state.settings.fontSize}
                onChange={(event) => range({ fontSize: Number(event.target.value) })}
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
            The overlay edits the same document. Turn off click-through to write in it.
          </p>
          <div className="capture-settings">
            <label className="overlay-check">
              <input
                type="checkbox"
                checked={state.settings.captureExclusion}
                disabled={
                  busy ||
                  (state.capabilities.captureExclusion === 'unsupported' &&
                    !state.settings.captureExclusion)
                }
                onChange={(event) => void update({ captureExclusion: event.target.checked })}
              />
              Exclude overlay from compatible captures
            </label>
            <p className="overlay-help" role="status" data-capture-status={state.capture.status}>
              {state.capture.message}
            </p>
            <p className="overlay-help">
              Applies only to the overlay. The control panel remains capturable. Results depend on
              the recording or sharing tool and mode; test before sharing sensitive content.
            </p>
            <button
              className="quiet-button"
              aria-expanded={captureExpanded}
              aria-controls="capture-compatibility"
              onClick={() => setCaptureExpanded(!captureExpanded)}
            >
              Capture compatibility test
            </button>
            {captureExpanded && (
              <section
                id="capture-compatibility"
                className="capture-compatibility"
                aria-label="Capture compatibility test"
              >
                <h3>Check your capture mode</h3>
                <ol>
                  <li>
                    Show the test card. It temporarily replaces the overlay document on this device.
                  </li>
                  <li>
                    With exclusion off, record or share the screen containing the overlay. Confirm
                    the card appears in the recorded output or on another device.
                  </li>
                  <li>
                    Enable exclusion and repeat with the same tool and mode. Compare the actual
                    output, not just your desktop or the native status.
                  </li>
                  <li>
                    Record your Windows build, tool version, capture mode and result: excluded,
                    visible, blank/black or not tested. Repeat after changing tools or modes.
                  </li>
                </ol>
                <div className="capture-actions">
                  <button
                    className="outline-button"
                    disabled={busy}
                    onClick={() =>
                      void run('overlay_capture_test', { enabled: !state.captureTest })
                    }
                  >
                    {state.captureTest ? 'Return to document' : 'Show test card'}
                  </button>
                  <button
                    className="quiet-button"
                    disabled={busy}
                    onClick={() => void run('overlay_capture_check')}
                  >
                    Recheck native setting
                  </button>
                  {state.capture.status === 'error' && (
                    <button
                      className="quiet-button"
                      disabled={busy}
                      onClick={() =>
                        void update({ captureExclusion: state.settings.captureExclusion })
                      }
                    >
                      Reapply setting
                    </button>
                  )}
                </div>
                <p className="overlay-help">
                  A confirmed native setting does not certify OBS, Teams, Discord or every capture
                  method. A visible or black card means this mode did not exclude it as expected.
                </p>
              </section>
            )}
          </div>
        </div>
      )}
      {(error || state?.warning) && (
        <p className="overlay-error" role="alert">
          {error || state?.warning}
        </p>
      )}
      {!expanded &&
        state?.settings.captureExclusion &&
        (state.capture.status === 'error' || state.capture.status === 'unsupported') && (
          <p className="overlay-error" role="alert">
            {state.capture.message}
          </p>
        )}
    </section>
  );
}
