import { useEffect, useState } from 'react';
import { DemoApp } from '@veil/ui';
import { invoke, errorMessage } from './overlay/api';
import { OverlayControls } from './overlay/Controls';
import { DesktopEditor, SessionBridge } from './overlay/session';

interface HostInfo {
  sessionId: string;
  token: string;
  localUrl: string;
  browserUrl: string;
  invitation: string;
  exposure: 'loopback' | 'lan';
  participantLimit: null;
}

export function HostingApp() {
  const [host, setHost] = useState<HostInfo | null>(null);
  const [lan, setLan] = useState(false);
  const [address, setAddress] = useState('');
  const [port, setPort] = useState(4445);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let active = true;
    void invoke<HostInfo | null>('host_status')
      .then((info) => {
        if (active) setHost(info);
      })
      .catch((failure: unknown) => {
        if (active) setError(errorMessage(failure));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function start() {
    setBusy(true);
    setError('');
    setCopied(false);
    try {
      setHost(
        await invoke<HostInfo>('host_start', {
          config: { lanAddress: lan ? address.trim() : null, port, acknowledgeLan: acknowledged },
        }),
      );
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  async function stop() {
    setBusy(true);
    setError('');
    try {
      await invoke('host_stop');
      setHost(null);
    } catch (failure) {
      setError(errorMessage(failure));
      setHost(await invoke<HostInfo | null>('host_status'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <DemoApp
      key={host?.sessionId ?? 'offline'}
      surface="desktop"
      sessionTarget={
        host ? { hostUrl: host.localUrl, sessionId: host.sessionId, token: host.token } : null
      }
      renderEditor={(connection) => (
        <DesktopEditor key={connection.doc.clientID} connection={connection} />
      )}
      desktopControls={(connection) => (
        <>
          <SessionBridge connection={connection} />
          <section className="hosting-panel" aria-label="Host session">
            {host ? (
              <>
                <div className="hosting-heading">
                  <strong>
                    Hosting · {host.exposure === 'lan' ? 'Trusted LAN' : 'This computer only'}
                  </strong>
                  <button className="secondary-button" disabled={busy} onClick={() => void stop()}>
                    End session
                  </button>
                </div>
                <p>
                  Browser address:{' '}
                  <a href={host.browserUrl} target="_blank" rel="noreferrer">
                    {host.browserUrl}
                  </a>
                </p>
                <label htmlFor="host-invitation">Invitation</label>
                <div className="hosting-invitation">
                  <input id="host-invitation" value={host.invitation} readOnly autoComplete="off" />
                  <button
                    className="secondary-button"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(host.invitation)
                        .then(() => setCopied(true))
                        .catch(() => setError('Select and copy the invitation field.'));
                    }}
                  >
                    {copied ? 'Copied' : 'Copy invitation'}
                  </button>
                </div>
                <p>
                  Invite holders can edit. No participant cap is configured. Ending the session or
                  closing Veil discards this document.
                </p>
              </>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void start();
                }}
              >
                <div className="hosting-heading">
                  <strong>Host a session</strong>
                  <button
                    className="primary-button"
                    disabled={busy || (lan && (!address || !acknowledged))}
                  >
                    Start session
                  </button>
                </div>
                <div className="hosting-options">
                  <label>
                    Access
                    <select
                      value={lan ? 'lan' : 'loopback'}
                      onChange={(event) => {
                        setLan(event.target.value === 'lan');
                        setAcknowledged(false);
                      }}
                      disabled={busy}
                    >
                      <option value="loopback">This computer only</option>
                      <option value="lan">Trusted LAN</option>
                    </select>
                  </label>
                  <label>
                    Port
                    <input
                      type="number"
                      min={1024}
                      max={65535}
                      value={port}
                      onChange={(event) => setPort(Number(event.target.value))}
                      required
                      disabled={busy}
                    />
                  </label>
                  {lan && (
                    <label>
                      LAN IPv4 address
                      <input
                        value={address}
                        onChange={(event) => setAddress(event.target.value)}
                        placeholder="192.168.1.20"
                        required
                        disabled={busy}
                      />
                    </label>
                  )}
                </div>
                {lan && (
                  <>
                    <p>
                      Use this PC's private IPv4 address from ipconfig. HTTP on a trusted LAN is
                      unencrypted. Allow Veil through Windows Firewall on private networks only; do
                      not forward this port to the internet.
                    </p>
                    <label className="hosting-acknowledgement">
                      <input
                        type="checkbox"
                        checked={acknowledged}
                        onChange={(event) => setAcknowledged(event.target.checked)}
                      />
                      I trust this network and understand that invitations and document traffic are
                      unencrypted.
                    </label>
                  </>
                )}
              </form>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </section>
          <OverlayControls />
        </>
      )}
    />
  );
}
