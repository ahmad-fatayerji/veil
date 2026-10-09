import { useState } from 'react';
import { HostingApp } from './Hosting';
import { PeerApp } from './PeerApp';
import { Updates } from './Updates';
import { errorMessage, invoke } from './overlay/api';

export function DesktopApp() {
  const [mode, setMode] = useState<'peer' | 'browser'>('peer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [updating, setUpdating] = useState(false);
  async function change(next: typeof mode) {
    if (next === mode) return;
    setBusy(true);
    setError('');
    try {
      await invoke('host_stop');
      setMode(next);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Updates onBusy={setUpdating} />
      <div inert={updating} aria-busy={updating}>
        <nav className="connection-modes" aria-label="Connection mode">
          <button
            className="quiet-button"
            aria-pressed={mode === 'peer'}
            disabled={busy}
            onClick={() => void change('peer')}
          >
            Desktop P2P
          </button>
          <button
            className="quiet-button"
            aria-pressed={mode === 'browser'}
            disabled={busy}
            onClick={() => void change('browser')}
          >
            LAN / browser
          </button>
          <span>Switching mode ends the current session.</span>
        </nav>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {mode === 'peer' ? <PeerApp /> : <HostingApp />}
      </div>
    </>
  );
}
