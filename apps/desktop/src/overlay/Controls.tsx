import { useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Eye, EyeOff, RotateCcw } from 'lucide-react';
import { Button, Slider, Switch } from '@veil/ui';
import { errorMessage, invoke, useOverlay, type OverlayPatch, type OverlaySnapshot } from './api';

function ToggleRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <label className="setting-row overlay-toggle-row">
      <span className="setting-row-text">
        <span className="setting-row-label">{label}</span>
        <span className="setting-row-hint">{description}</span>
      </span>
      {children}
    </label>
  );
}

function RangeRow({
  id,
  label,
  description,
  output,
  children,
}: {
  id: string;
  label: string;
  description?: string;
  output: string;
  children: ReactNode;
}) {
  return (
    <div className="overlay-range">
      <div className="overlay-range-heading">
        <label className="setting-row-label" htmlFor={id}>
          {label}
        </label>
        <output htmlFor={id}>{output}</output>
      </div>
      {description && <p>{description}</p>}
      {children}
    </div>
  );
}

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
    // Only show the busy (disabled) state for slow commands; flashing every control
    // greyed-out on each quick toggle reads as flicker.
    const showBusy = setTimeout(() => setBusy(true), 350);
    setError('');
    try {
      await flushRanges();
      setState(await invoke<OverlaySnapshot>(command, args));
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      clearTimeout(showBusy);
      setBusy(false);
    }
  }
  const update = (patch: OverlayPatch) => run('overlay_update', { patch });
  const windowOpacity = Math.round((draft.opacity ?? state?.settings.opacity ?? 0.85) * 100);
  const textOpacity = Math.round((draft.textOpacity ?? state?.settings.textOpacity ?? 1) * 100);
  const fontSize = draft.fontSize ?? state?.settings.fontSize ?? 20;
  const visible = !!state?.settings.visible;
  return (
    <section className="overlay-controls" aria-label="Overlay controls">
      <div className="overlay-controls-row">
        <div className="overlay-heading">
          <span className="overlay-controls-title">Desktop overlay</span>
          <span className="overlay-controls-subtitle">
            Your document in a window above other apps.
          </span>
        </div>
        <Button
          icon={
            visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />
          }
          disabled={!state || busy}
          onClick={() => void run('overlay_visibility', { visible: !visible })}
        >
          {visible ? 'Hide overlay' : 'Show overlay'}
        </Button>
        {!settingsOnly && (
          <Button
            variant="ghost"
            aria-expanded={expanded}
            aria-controls="overlay-settings"
            onClick={() => setExpanded(!expanded)}
          >
            Settings
          </Button>
        )}
      </div>
      {expanded && state && (
        <div id="overlay-settings" className="overlay-settings">
          <section className="overlay-setting-group" aria-labelledby="overlay-appearance-heading">
            <div className="overlay-group-heading">
              <h4 id="overlay-appearance-heading">Appearance</h4>
              <span>Saved on this device</span>
            </div>
            <div className="settings-card overlay-ranges">
              <RangeRow
                id="overlay-opacity"
                label="Window opacity"
                description="Background only"
                output={`${windowOpacity}%`}
              >
                <Slider
                  id="overlay-opacity"
                  aria-label="Window opacity"
                  aria-valuetext={`${windowOpacity}%`}
                  step={1}
                  value={windowOpacity}
                  disabled={!state.capabilities.transparency}
                  onChange={(event) => range({ opacity: Number(event.target.value) / 100 })}
                />
              </RangeRow>
              <RangeRow
                id="overlay-text-opacity"
                label="Text opacity"
                description="Independent of the background"
                output={`${textOpacity}%`}
              >
                <Slider
                  id="overlay-text-opacity"
                  aria-label="Text opacity"
                  aria-valuetext={`${textOpacity}%`}
                  step={1}
                  value={textOpacity}
                  onChange={(event) => range({ textOpacity: Number(event.target.value) / 100 })}
                />
              </RangeRow>
              <RangeRow id="overlay-font-size" label="Font size" output={`${fontSize} px`}>
                <Slider
                  id="overlay-font-size"
                  aria-label="Font size"
                  aria-valuetext={`${fontSize} pixels`}
                  min={12}
                  max={48}
                  step={2}
                  value={fontSize}
                  onChange={(event) => range({ fontSize: Number(event.target.value) })}
                />
              </RangeRow>
            </div>
          </section>
          <section className="overlay-setting-group" aria-labelledby="overlay-behavior-heading">
            <div className="overlay-group-heading">
              <h4 id="overlay-behavior-heading">Window behavior</h4>
            </div>
            <div className="settings-card">
              <ToggleRow label="Always on top" description="Keep the overlay above other windows.">
                <Switch
                  aria-label="Always on top"
                  checked={state.settings.alwaysOnTop}
                  disabled={!state.capabilities.alwaysOnTop || busy}
                  onChange={(event) => void update({ alwaysOnTop: event.target.checked })}
                />
              </ToggleRow>
              <ToggleRow
                label="Click-through"
                description="Send clicks to the window underneath. Turn off to edit."
              >
                <Switch
                  aria-label="Click-through"
                  checked={state.settings.clickThrough}
                  disabled={!state.capabilities.clickThrough || !state.recoveryAvailable || busy}
                  onChange={(event) => void update({ clickThrough: event.target.checked })}
                />
              </ToggleRow>
              {!state.recoveryAvailable && (
                <div className="setting-row">
                  <p className="overlay-help">
                    Recovery shortcut unavailable. Click-through is disabled.
                  </p>
                </div>
              )}
            </div>
            <div className="overlay-settings-actions">
              <Button disabled={busy} onClick={() => void run('overlay_recover')}>
                Restore interaction
              </Button>
              <Button
                variant="ghost"
                icon={<RotateCcw size={14} aria-hidden="true" />}
                disabled={busy}
                onClick={() => void run('overlay_reset_position')}
              >
                Reset position & size
              </Button>
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
          <section
            className="capture-settings overlay-setting-group"
            aria-labelledby="overlay-capture-heading"
          >
            <div className="overlay-group-heading">
              <h4 id="overlay-capture-heading">Screen capture</h4>
            </div>
            <div className="settings-card">
              <ToggleRow
                label="Capture exclusion"
                description="Exclude the overlay from compatible captures."
              >
                <Switch
                  aria-label="Exclude overlay from compatible captures"
                  checked={state.settings.captureExclusion}
                  disabled={
                    busy ||
                    (state.capabilities.captureExclusion === 'unsupported' &&
                      !state.settings.captureExclusion)
                  }
                  onChange={(event) => void update({ captureExclusion: event.target.checked })}
                />
              </ToggleRow>
              <div className="setting-row">
                <p
                  className="overlay-help overlay-capture-status"
                  role="status"
                  data-capture-status={state.capture.status}
                >
                  {state.capture.message}
                </p>
              </div>
            </div>
            <p className="overlay-help">
              The control panel remains capturable. Results vary by tool and mode; test before
              sharing.
            </p>
            <button
              type="button"
              className="overlay-disclosure"
              aria-expanded={captureExpanded}
              aria-controls="capture-compatibility"
              onClick={() => setCaptureExpanded(!captureExpanded)}
            >
              Capture compatibility test
              <ChevronDown size={16} aria-hidden="true" />
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
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void run('overlay_capture_test', { enabled: !state.captureTest })
                    }
                  >
                    {state.captureTest ? 'Return to document' : 'Show test card'}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void run('overlay_capture_check')}
                  >
                    Recheck native setting
                  </Button>
                  {(state.settings.captureExclusion || state.capture.status === 'error') && (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void update({ captureExclusion: state.settings.captureExclusion })
                      }
                    >
                      Reapply setting
                    </Button>
                  )}
                </div>
                <p className="overlay-help">
                  A confirmed native setting does not certify OBS, Teams, Discord or every capture
                  method. A visible or black card means this mode did not exclude it as expected.
                </p>
              </section>
            )}
          </section>
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
