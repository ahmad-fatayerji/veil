import { useEffect, useState } from 'react';
import { errorMessage, invoke } from './overlay/api';
import { progressLabel, type UpdateProgress } from './update-progress';

interface UpdateInfo {
  currentVersion: string;
  availableVersion: string | null;
  notes: string | null;
  sessionActive: boolean;
  channel: 'stable' | 'beta';
  progress: UpdateProgress;
  busy: boolean;
  canCancel: boolean;
  cooldownUntil: number | null;
  completion: { success: boolean; message: string } | null;
}

export function Updates({ onBusy }: { onBusy: (busy: boolean) => void }) {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [pending, setPending] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const busy = pending || !!info?.busy;
  const cooldown = Math.max(0, (info?.cooldownUntil ?? 0) - now);
  const stageMessage = info ? progressLabel(info.progress, now) : '';
  useEffect(() => {
    onBusy(installing || (!!info?.busy && info.progress.stage !== 'checking'));
  }, [installing, info?.busy, info?.progress.stage, onBusy]);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      setNow(Math.floor(Date.now() / 1000));
      void invoke<UpdateInfo>('update_status')
        .then((value) => {
          if (active) setInfo(value);
        })
        .catch((failure: unknown) => {
          if (active) setError(errorMessage(failure));
        });
    };
    refresh();
    // Reads local state only; no GitHub polling.
    const timer = setInterval(refresh, 250);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  async function run(install: boolean) {
    setPending(true);
    setInstalling(install);
    setCancelling(false);
    setError('');
    setMessage(install ? 'Connecting to the download server…' : 'Checking releases…');
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
      setInfo(await invoke<UpdateInfo>('update_status').catch(() => null));
      setPending(false);
      setInstalling(false);
      setCancelling(false);
    }
  }
  async function setChannel(channel: 'stable' | 'beta') {
    setPending(true);
    setError('');
    setMessage('');
    try {
      setInfo(await invoke<UpdateInfo>('update_set_channel', { channel }));
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setPending(false);
    }
  }
  async function cancel() {
    setCancelling(true);
    try {
      await invoke('update_cancel');
    } catch (failure) {
      setError(errorMessage(failure));
      setCancelling(false);
    }
  }
  async function dismissResult() {
    try {
      await invoke('update_dismiss_result');
      setInfo(await invoke<UpdateInfo>('update_status'));
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }
  return (
    <div className="desktop-updates">
      {info?.completion && (
        <div
          className={`update-result ${info.completion.success ? 'update-success' : 'update-warning'}`}
        >
          <p role={info.completion.success ? 'status' : 'alert'}>{info.completion.message}</p>
          <button className="secondary-button" disabled={busy} onClick={() => void dismissResult()}>
            Dismiss update result
          </button>
        </div>
      )}
      <details>
        <summary>App updates {info && `· ${info.currentVersion}`}</summary>
        <p>Updates are downloaded over HTTPS and signature-verified before installation.</p>
        <label>
          Update channel{' '}
          <select
            value={info?.channel ?? 'stable'}
            disabled={busy || !info}
            onChange={(event) => void setChannel(event.target.value as 'stable' | 'beta')}
          >
            <option value="stable">Stable</option>
            <option value="beta">Beta</option>
          </select>
        </label>
        {info?.channel === 'beta' && <p>Beta updates are experimental builds for testing.</p>}
        <p>Switching to stable does not downgrade a newer beta.</p>
        <button
          className="secondary-button"
          disabled={busy || !info || cooldown > 0}
          onClick={() => void run(false)}
        >
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
              disabled={busy || info.sessionActive || cooldown > 0}
              onClick={() => void run(true)}
            >
              Install update and restart
            </button>
          </>
        )}
        {info?.sessionActive && <p>Installation is blocked while a session is open.</p>}
        {cooldown > 0 && (
          <p role="status">GitHub is limiting requests. Retry in {cooldown} seconds.</p>
        )}
        {busy && info?.progress.stage === 'downloading' && (
          <progress
            aria-label="Update download progress"
            max={info.progress.total || undefined}
            value={info.progress.total ? info.progress.downloaded : undefined}
          />
        )}
        {info?.canCancel && (
          <button className="secondary-button" disabled={cancelling} onClick={() => void cancel()}>
            {cancelling ? 'Cancelling…' : 'Cancel download'}
          </button>
        )}
        {(stageMessage || message) && (
          <p role="status">{cancelling ? 'Cancelling download…' : stageMessage || message}</p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </details>
    </div>
  );
}
