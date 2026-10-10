import { useEffect, useRef, useState } from 'react';
import {
  hostAutomatic,
  joinAutomatic,
  type AutomaticSession,
  type PeerSummary,
} from '@veil/collaboration';
import { DemoApp } from '@veil/ui';
import { nativeSignaling } from './networking';
import { DesktopEditor, SessionBridge } from './overlay/session';
import { OverlayControls } from './overlay/Controls';
import { errorMessage, invoke } from './overlay/api';

export function AutomaticApp() {
  const [session, setSession] = useState<AutomaticSession | null>(null);
  const active = useRef<AutomaticSession | null>(null);
  const [server, setServer] = useState('');
  const [credential, setCredential] = useState('');
  const [name, setName] = useState('');
  const [invitation, setInvitation] = useState('');
  const [outgoing, setOutgoing] = useState('');
  const [peers, setPeers] = useState<PeerSummary[]>([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [development, setDevelopment] = useState(false);
  useEffect(() => {
    void invoke<{ server: string; development: boolean }>('network_preferences')
      .then((preferences) => {
        setServer(preferences.server);
        setDevelopment(preferences.development);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
    return () => {
      void active.current?.close();
    };
  }, []);
  useEffect(() => {
    if (!session) return;
    const changed = () => setPeers(session.session.provider.summaries());
    const failed = (message: string) => setError(message);
    session.session.provider.on('peers', changed);
    session.session.provider.on('error', failed);
    changed();
    return () => {
      session.session.provider.off('peers', changed);
      session.session.provider.off('error', failed);
    };
  }, [session]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function start(role: 'host' | 'guest') {
    if (active.current) throw new Error('Leave the current session first.');
    if (!name.trim()) throw new Error('Enter your name.');
    let current: AutomaticSession;
    if (role === 'host') {
      const settings = await invoke<{ server: string }>('network_configure', {
        server,
        credential: credential || null,
      });
      setServer(settings.server);
      setCredential('');
      current = await hostAutomatic(
        settings.server,
        name,
        nativeSignaling(),
        setNotice,
        development,
      );
    } else
      current = await joinAutomatic(invitation, name, nativeSignaling(), setNotice, development);
    active.current = current;
    setSession(current);
    setInvitation('');
    setNotice(
      role === 'host'
        ? 'Session created. Make a separate invitation for each friend.'
        : 'Joining automatically. Trying a direct connection first.',
    );
  }
  async function leave() {
    const current = active.current;
    active.current = null;
    if (current) await current.close();
    setSession(null);
    setPeers([]);
    setOutgoing('');
    setNotice('');
    setError('');
  }
  return (
    <DemoApp
      surface="desktop"
      providedConnection={session?.session ?? null}
      joinIntroduction={
        <>
          <h2>Create or join a session.</h2>
          <p>Paste a friend's invitation, or create a session using your operator's server.</p>
          <p className="join-note">Connections go directly between peers when possible.</p>
        </>
      }
      onProvidedLeave={() => {
        void run(leave);
      }}
      renderEditor={(connection) => (
        <DesktopEditor key={connection.doc.clientID} connection={connection} />
      )}
      desktopControls={(connection) => (
        <>
          <SessionBridge connection={connection} />
          <section className="hosting-panel peer-panel" aria-label="Veil connection">
            <div className="hosting-heading">
              <strong>
                {session
                  ? session.role === 'host'
                    ? 'Hosting a session'
                    : 'Joined session'
                  : 'Connect with friends'}
              </strong>
              {session && (
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void run(leave)}
                >
                  {session.role === 'host' ? 'End session' : 'Leave session'}
                </button>
              )}
            </div>
            {!session && (
              <>
                <label htmlFor="automatic-name">Your name</label>
                <input
                  id="automatic-name"
                  value={name}
                  maxLength={40}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="nickname"
                  disabled={busy}
                />
                <details open>
                  <summary>Hosting server</summary>
                  <p>
                    Set up once to create sessions. Your server operator provides the address and
                    host access credential. Friends only need an invitation.
                  </p>
                  <label htmlFor="automatic-server">Server address</label>
                  <input
                    id="automatic-server"
                    value={server}
                    onChange={(e) => setServer(e.target.value)}
                    placeholder="https://signal.example.com"
                    disabled={busy}
                    autoComplete="off"
                  />
                  <label htmlFor="automatic-credential">Host access credential</label>
                  <input
                    id="automatic-credential"
                    type="password"
                    value={credential}
                    onChange={(e) => setCredential(e.target.value)}
                    placeholder="Leave empty to use your saved credential"
                    disabled={busy}
                    autoComplete="off"
                  />
                  <button
                    className="secondary-button"
                    disabled={busy || !server.trim()}
                    onClick={() =>
                      void run(async () => {
                        await invoke('network_forget', { server });
                        setCredential('');
                        setNotice('Saved host credential removed from this computer.');
                      })
                    }
                  >
                    Forget saved host credential
                  </button>
                </details>
                <div className="peer-actions">
                  <button
                    className="primary-button"
                    disabled={busy || !name.trim() || !server.trim()}
                    onClick={() => void run(() => start('host'))}
                  >
                    Create session
                  </button>
                </div>
                <label htmlFor="automatic-invitation">Invitation</label>
                <textarea
                  id="automatic-invitation"
                  value={invitation}
                  onChange={(e) => setInvitation(e.target.value)}
                  maxLength={4096}
                  placeholder="Paste a veil-invite:v2: invitation"
                  disabled={busy}
                />
                <button
                  className="primary-button"
                  disabled={busy || !name.trim() || !invitation.trim()}
                  onClick={() => void run(() => start('guest'))}
                >
                  Join
                </button>
              </>
            )}
            {session?.role === 'host' && (
              <>
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      setOutgoing(await session.createInvitation());
                      setNotice(
                        'Send this invitation privately to one friend. It expires in ten minutes.',
                      );
                    })
                  }
                >
                  Create invitation
                </button>
                {outgoing && (
                  <>
                    <textarea aria-label="Invitation to share" value={outgoing} readOnly />
                    <button
                      className="secondary-button"
                      onClick={() => void run(() => navigator.clipboard.writeText(outgoing))}
                    >
                      Copy invitation
                    </button>
                  </>
                )}
              </>
            )}
            {session && (
              <>
                <p>
                  Server: {session.server}. The host must stay open; documents remain in memory.
                </p>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void run(() => session.reconnect())}
                >
                  Reconnect
                </button>
              </>
            )}
            {notice && <p role="status">{notice}</p>}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            {peers.length > 0 && (
              <ul>
                {peers.map((peer) => (
                  <li key={peer.id}>
                    {peer.name}: {peer.state} ·{' '}
                    {peer.path === 'direct'
                      ? 'Direct'
                      : peer.path === 'relay'
                        ? 'Relayed'
                        : 'Checking'}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <OverlayControls />
        </>
      )}
    />
  );
}
