import { useEffect, useState } from 'react';
import { Banner, Button, Select } from '@veil/ui';
import { errorMessage, invoke } from './overlay/api';
import { progressLabel, type UpdateProgress } from './update-progress';

export interface UpdateInfo {
  currentVersion: string;
  availableVersion: string | null;
  notes: string | null;
  sessionActive: boolean;
  channel: 'stable' | 'beta';
  progress: UpdateProgress;
  busy: boolean;
  canCancel: boolean;
  cooldownUntil: number | null;
  checkError: string | null;
  completion: { success: boolean; message: string } | null;
}

// This stays mounted in the control panel even when Settings is closed.
export function useUpdateAttention() {
  const [attention, setAttention] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void invoke<UpdateInfo>('update_status')
        .then((value) => {
          if (active) setAttention(!!value.availableVersion || value.completion?.success === false);
        })
        .catch(() => {});
    };
    refresh();
    const timer = setInterval(refresh, 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  return attention;
}

export function Updates({
  onBusy,
  settingsView = false,
}: {
  onBusy: (busy: boolean) => void;
  settingsView?: boolean;
}) {
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
  const body = (
    <>
      <div className="settings-card">
        <div className="setting-row">
          <div className="setting-row-text">
            <span className="setting-row-label">
              {info ? `Veil ${info.currentVersion}` : 'Veil'}
            </span>
            <p>Updates are downloaded over HTTPS and signature-verified before installation.</p>
          </div>
          <Button
            loading={pending && !installing}
            disabled={busy || !info || cooldown > 0}
            onClick={() => void run(false)}
          >
            Check for updates
          </Button>
        </div>
        <div className="setting-row">
          <div className="setting-row-text">
            <label className="setting-row-label" htmlFor="update-channel">
              Update channel
            </label>
            <p>
              {info?.channel === 'beta'
                ? 'Beta updates are experimental builds for testing.'
                : 'Switching to stable does not downgrade a newer beta.'}
            </p>
          </div>
          <Select
            id="update-channel"
            value={info?.channel ?? 'stable'}
            disabled={busy || !info}
            onChange={(event) => void setChannel(event.target.value as 'stable' | 'beta')}
          >
            <option value="stable">Stable</option>
            <option value="beta">Beta</option>
          </Select>
        </div>
      </div>
      {info?.availableVersion && (
        <div className="settings-card update-available">
          <div className="setting-row">
            <div className="setting-row-text">
              <span className="setting-row-label">
                Version {info.availableVersion} is available
              </span>
              <p>
                Save your documents and close all tabs and sessions first. Local overlay preferences
                are retained.
              </p>
            </div>
            <Button
              variant="primary"
              loading={installing}
              disabled={busy || info.sessionActive || cooldown > 0}
              onClick={() => void run(true)}
            >
              Install update and restart
            </Button>
          </div>
          {info.notes && <p className="release-notes">{info.notes}</p>}
        </div>
      )}
      {info?.sessionActive && (
        <p className="update-note">Installation is blocked while a session is open.</p>
      )}
      {cooldown > 0 && (
        <p className="update-note" role="status">
          GitHub is limiting requests. Retry in {cooldown} seconds.
        </p>
      )}
      {busy && info?.progress.stage === 'downloading' && (
        <progress
          aria-label="Update download progress"
          max={info.progress.total || undefined}
          value={info.progress.total ? info.progress.downloaded : undefined}
        />
      )}
      {info?.canCancel && (
        <div>
          <Button disabled={cancelling} onClick={() => void cancel()}>
            {cancelling ? 'Cancelling…' : 'Cancel download'}
          </Button>
        </div>
      )}
      {(stageMessage || message) && (
        <p className="update-note" role="status">
          {cancelling ? 'Cancelling download…' : stageMessage || message}
        </p>
      )}
      {(error || info?.checkError) && (
        <p className="error" role="alert">
          {error || info?.checkError}
        </p>
      )}
    </>
  );
  return (
    <div className="desktop-updates">
      {info?.completion && (
        <Banner
          tone={info.completion.success ? 'info' : 'warning'}
          role={info.completion.success ? 'status' : 'alert'}
          actions={
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void dismissResult()}>
              Dismiss update result
            </Button>
          }
        >
          {info.completion.message}
        </Banner>
      )}
      {settingsView ? (
        body
      ) : (
        <details>
          <summary>App updates {info && `· ${info.currentVersion}`}</summary>
          {body}
        </details>
      )}
    </div>
  );
}
