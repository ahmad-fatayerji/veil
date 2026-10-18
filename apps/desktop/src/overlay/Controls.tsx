import { useRef, useState, type CSSProperties } from 'react';
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
          for (const key of ['opacity', 'textOpacity', 'fontSize'] as const) {
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
  const windowOpacity = Math.round((draft.opacity ?? state?.settings.opacity ?? 0.85) * 100);
  const textOpacity = Math.round((draft.textOpacity ?? state?.settings.textOpacity ?? 1) * 100);
  const fontSize = draft.fontSize ?? state?.settings.fontSize ?? 20;
  return (
    <section className="overlay-controls" aria-label="Overlay controls">
      <div className="overlay-controls-row">
        <div className="overlay-heading">
          <span className="overlay-controls-title">Desktop overlay</span>
          <span className="overlay-controls-subtitle">Your document, above other windows.</span>
        </div>
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
          <section className="overlay-setting-group" aria-labelledby="overlay-appearance-heading">
            <div className="overlay-group-heading">
              <h4 id="overlay-appearance-heading">Appearance</h4>
              <span>Saved on this device</span>
            </div>
            <div className="overlay-settings-grid">
              <label className="overlay-range" htmlFor="overlay-opacity">
                Window opacity <output>{windowOpacity}%</output>
                <span className="overlay-range-description">Background only</span>
                <input
                  id="overlay-opacity"
                  aria-label="Window opacity"
                  aria-valuetext={`${windowOpacity}%`}
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={windowOpacity}
                  disabled={!state.capabilities.transparency}
                  style={{ '--range-progress': `${windowOpacity}%` } as CSSProperties}
                  onChange={(event) => range({ opacity: Number(event.target.value) / 100 })}
                />
              </label>
              <label className="overlay-range" htmlFor="overlay-text-opacity">
                Text opacity <output>{textOpacity}%</output>
                <span className="overlay-range-description">Independent of background</span>
                <input
                  id="overlay-text-opacity"
                  aria-label="Text opacity"
                  aria-valuetext={`${textOpacity}%`}
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={textOpacity}
                  style={{ '--range-progress': `${textOpacity}%` } as CSSProperties}
                  onChange={(event) => range({ textOpacity: Number(event.target.value) / 100 })}
                />
              </label>
              <label className="overlay-range overlay-font-range" htmlFor="overlay-font-size">
                Font size <output>{fontSize} px</output>
                <input
                  id="overlay-font-size"
                  aria-label="Font size"
                  aria-valuetext={`${fontSize} pixels`}
                  type="range"
                  min="12"
                  max="48"
                  step="2"
                  value={fontSize}
                  style={
                    { '--range-progress': `${((fontSize - 12) / 36) * 100}%` } as CSSProperties
                  }
                  onChange={(event) => range({ fontSize: Number(event.target.value) })}
                />
                <span className="overlay-range-limits" aria-hidden="true">
                  <span>A</span>
                  <span>A</span>
                </span>
              </label>
            </div>
          </section>
          <section className="overlay-setting-group" aria-labelledby="overlay-behavior-heading">
            <div className="overlay-group-heading">
              <h4 id="overlay-behavior-heading">Window behavior</h4>
            </div>
            <label className="overlay-toggle-row">
              <span>
                <strong>Always on top</strong>
                <small>Keep the overlay above other windows.</small>
              </span>
              <input
                type="checkbox"
                aria-label="Always on top"
                checked={state.settings.alwaysOnTop}
                disabled={!state.capabilities.alwaysOnTop || busy}
                onChange={(event) => void update({ alwaysOnTop: event.target.checked })}
              />
            </label>
            <label className="overlay-toggle-row">
              <span>
                <strong>Click-through</strong>
                <small>Send clicks to the window underneath. Turn off to edit.</small>
              </span>
              <input
                type="checkbox"
                aria-label="Click-through"
                checked={state.settings.clickThrough}
                disabled={!state.capabilities.clickThrough || !state.recoveryAvailable || busy}
                onChange={(event) => void update({ clickThrough: event.target.checked })}
              />
            </label>
            <div className="overlay-shortcuts">
              {state.recoveryAvailable ? (
                <div>
                  <span>Restore interaction</span>
                  <kbd>Ctrl+Alt+V</kbd>
                </div>
              ) : (
                <p className="overlay-help">
                  Recovery shortcut unavailable. Click-through is disabled.
                </p>
              )}
              {state.hideShortcutAvailable && (
                <div>
                  <span>Show / hide overlay</span>
                  <kbd>Ctrl+Alt+Shift+V</kbd>
                </div>
              )}
            </div>
            <div className="overlay-settings-actions">
              <button
                className="outline-button"
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
                {state.settings.width} &times; {state.settings.height} px
              </span>
            </div>
            <p className="overlay-help">
              Drag the overlay header to move it, or an edge to resize.
            </p>
            {(!state.capabilities.transparency ||
              !state.capabilities.alwaysOnTop ||
              !state.capabilities.clickThrough) && (
              <p className="overlay-help">Some window controls are unavailable on this platform.</p>
            )}
          </section>
          <div className="capture-settings overlay-setting-group">
            <div className="overlay-group-heading">
              <h4>Screen capture</h4>
            </div>
            <label className="overlay-toggle-row">
              <span>
                <strong>Capture exclusion</strong>
                <small>Exclude the overlay from compatible captures.</small>
              </span>
              <input
                type="checkbox"
                aria-label="Exclude overlay from compatible captures"
                checked={state.settings.captureExclusion}
                disabled={
                  busy ||
                  (state.capabilities.captureExclusion === 'unsupported' &&
                    !state.settings.captureExclusion)
                }
                onChange={(event) => void update({ captureExclusion: event.target.checked })}
              />
            </label>
            <p
              className="overlay-help overlay-capture-status"
              role="status"
              data-capture-status={state.capture.status}
            >
              {state.capture.message}
            </p>
            <p className="overlay-help">
              The control panel remains capturable. Results vary by tool and mode; test before
              sharing.
            </p>
            <button
              className="quiet-button overlay-disclosure"
              aria-expanded={captureExpanded}
              aria-controls="capture-compatibility"
              onClick={() => setCaptureExpanded(!captureExpanded)}
            >
              Capture compatibility test{' '}
              <span aria-hidden="true">{captureExpanded ? '\u2212' : '+'}</span>
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
                  {(state.settings.captureExclusion || state.capture.status === 'error') && (
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
