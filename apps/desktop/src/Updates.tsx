import { useEffect, useState } from 'react';
import { errorMessage, invoke } from './overlay/api';

interface UpdateInfo {
  currentVersion: string;
  availableVersion: string | null;
  notes: string | null;
  sessionActive: boolean;
}

export function Updates({ onBusy }: { onBusy: (busy: boolean) => void }) {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void invoke<UpdateInfo>('update_status')
        .then((value) => {
          if (active) setInfo(value);
        })
        .catch((failure: unknown) => {
          if (active) setError(errorMessage(failure));
        });
    };
    refresh();
    // This only reads local native state. It never contacts GitHub.
    const timer = setInterval(refresh, 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  async function run(install: boolean) {
    setBusy(true);
    onBusy(install);
    setError('');
    setMessage(
      install
        ? 'Downloading and verifying the update. Veil will restart after installation.'
        : 'Checking releases…',
    );
    try {
      if (install) await invoke('update_install');
      else {
        const value = await invoke<UpdateInfo>('update_check');
        setInfo(value);
        setMessage(
          value.availableVersion
            ? `Version ${value.availableVersion} is available.`
            : 'You have the latest version.',
        );
      }
    } catch (failure) {
      setMessage('');
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <details className="desktop-updates">
      <summary>App updates {info && `· ${info.currentVersion}`}</summary>
      <p>
        Check GitHub Releases for a newer version. Updates are signature-verified before
        installation.
      </p>
      <button className="secondary-button" disabled={busy || !info} onClick={() => void run(false)}>
        Check for updates
      </button>
      {info?.availableVersion && (
        <>
          <p>Available: {info.availableVersion}</p>
          {info.notes && <p className="release-notes">{info.notes}</p>}
          <p>
            End or leave your session first. Documents are temporary; copy any text you want to
            keep. Local overlay preferences are retained.
          </p>
          <button
            className="primary-button"
            disabled={busy || info.sessionActive}
            onClick={() => void run(true)}
          >
            Install update and restart
          </button>
        </>
      )}
      {info?.sessionActive && <p>Installation is blocked while a session is open.</p>}
      {message && <p role="status">{message}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}
