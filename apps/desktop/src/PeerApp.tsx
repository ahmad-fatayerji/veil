import { useEffect, useRef, useState } from 'react';
import { createPeerSession, type PeerSession, type PeerSummary } from '@veil/collaboration';
import { decodePeerCode, validateIceServerUrl, PEER_CODE_LIMIT } from '@veil/protocol';
import { DemoApp } from '@veil/ui';
import { DesktopEditor, SessionBridge } from './overlay/session';
import { OverlayControls } from './overlay/Controls';
import { errorMessage } from './overlay/api';

export function PeerApp() {
  const [session, setSession] = useState<PeerSession | null>(null);
  const active = useRef<PeerSession | null>(null);
  const [name, setName] = useState('');
  const [offer, setOffer] = useState('');
  const [answer, setAnswer] = useState('');
  const [outgoing, setOutgoing] = useState('');
  const [peers, setPeers] = useState<PeerSummary[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [stun, setStun] = useState('');
  const [turn, setTurn] = useState('');
  const [relayUser, setRelayUser] = useState('');
  const [relayPassword, setRelayPassword] = useState('');
  const [useServers, setUseServers] = useState(false);

  useEffect(
    () => () => {
      active.current?.destroy();
      active.current = null;
    },
    [],
  );
  useEffect(() => {
    if (!session) return;
    const changed = () => setPeers(session.provider.summaries());
    const failed = (message: string) => setError(message);
    session.provider.on('peers', changed);
    session.provider.on('error', failed);
    return () => {
      session.provider.off('peers', changed);
      session.provider.off('error', failed);
    };
  }, [session]);

  function servers(): RTCIceServer[] {
    const result: RTCIceServer[] = [];
    if ((stun || turn) && !useServers)
      throw new Error('Confirm use of the network servers you entered.');
    if (stun) result.push({ urls: validateIceServerUrl(stun, 'stun') });
    if (turn) {
      if (!relayUser.trim() || !relayPassword)
        throw new Error('Enter the relay username and credential.');
      result.push({
        urls: validateIceServerUrl(turn, 'turn'),
        username: relayUser.trim(),
        credential: relayPassword,
      });
    }
    return result;
  }
  function create(role: 'host' | 'guest') {
    if (active.current) throw new Error('Leave the current session first.');
    if (!name.trim()) throw new Error('Enter your name.');
    const current = createPeerSession(role, name, servers());
    active.current = current;
    setSession(current);
    setPeers([]);
    return current;
  }
  function leave() {
    active.current?.destroy();
    active.current = null;
    setSession(null);
    setPeers([]);
    setOffer('');
    setAnswer('');
    setOutgoing('');
    setNotice('');
    setError('');
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  function host() {
    const current = create('host');
    setNotice('Peer session started. Generate an invitation for each friend.');
    return current;
  }
  async function guest() {
    // Validate before creating a resource, so a bad paste does not trap the join form.
    decodePeerCode(offer, 'offer');
    const current = active.current ?? create('guest');
    setOutgoing(await current.provider.answerInvitation(offer));
    setNotice('Send this response to the host. They paste it and click Connect friend.');
    setPeers(current.provider.summaries());
  }
  const role = session?.provider.role;
  return (
    <DemoApp
      surface="desktop"
      providedConnection={session}
      onProvidedLeave={leave}
      renderEditor={(connection) => (
        <DesktopEditor key={connection.doc.clientID} connection={connection} />
      )}
      desktopControls={(connection) => (
        <>
          <SessionBridge connection={connection} />
          <section className="hosting-panel peer-panel" aria-label="Peer connection">
            <div className="hosting-heading">
              <strong>
                {role === 'host'
                  ? 'Hosting a peer session'
                  : role === 'guest'
                    ? 'Joining a peer session'
                    : 'Desktop peer connection'}
              </strong>
              {session && (
                <button className="secondary-button" disabled={busy} onClick={leave}>
                  {role === 'host' ? 'End peer session' : 'Leave peer session'}
                </button>
              )}
            </div>
            {!session && (
              <>
                <label htmlFor="peer-name">Your name</label>
                <input
                  id="peer-name"
                  value={name}
                  maxLength={40}
                  onChange={(event) => setName(event.target.value)}
                  disabled={busy}
                  autoComplete="nickname"
                />
                <details className="peer-network">
                  <summary>Network options (optional)</summary>
                  <p>
                    By default, Veil contacts no discovery or relay service. Direct internet
                    connections depend on both networks. Enter your own servers if needed. Each
                    participant configures their own options; credentials stay in memory.
                  </p>
                  <label htmlFor="peer-stun">Discovery server (STUN)</label>
                  <input
                    id="peer-stun"
                    value={stun}
                    onChange={(event) => setStun(event.target.value)}
                    placeholder="stun:your-server:3478"
                    disabled={busy}
                    autoComplete="off"
                  />
                  <label htmlFor="peer-turn">Relay server (TURN)</label>
                  <input
                    id="peer-turn"
                    value={turn}
                    onChange={(event) => setTurn(event.target.value)}
                    placeholder="turn:your-server:3478"
                    disabled={busy}
                    autoComplete="off"
                  />
                  <label htmlFor="peer-relay-user">Relay username</label>
                  <input
                    id="peer-relay-user"
                    value={relayUser}
                    onChange={(event) => setRelayUser(event.target.value)}
                    disabled={busy}
                    autoComplete="off"
                  />
                  <label htmlFor="peer-relay-password">Relay credential</label>
                  <input
                    id="peer-relay-password"
                    type="password"
                    value={relayPassword}
                    onChange={(event) => setRelayPassword(event.target.value)}
                    disabled={busy}
                    autoComplete="off"
                  />
                  <label className="hosting-acknowledgement">
                    <input
                      type="checkbox"
                      checked={useServers}
                      onChange={(event) => setUseServers(event.target.checked)}
                      disabled={busy}
                    />
                    Use these network servers; they receive connection metadata and may relay
                    encrypted traffic.
                  </label>
                </details>
                <div className="peer-actions">
                  <button
                    className="primary-button"
                    disabled={busy || !name.trim()}
                    onClick={() => {
                      try {
                        host();
                      } catch (failure) {
                        setError(errorMessage(failure));
                      }
                    }}
                  >
                    Start peer session
                  </button>
                </div>
              </>
            )}
            {role === 'host' && session ? (
              <>
                <p>
                  1. Generate an invitation and send it privately to one friend. Invitations expire
                  after 10 minutes. Generate a separate invitation for each additional friend.
                </p>
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      setOutgoing('');
                      setAnswer('');
                      setOutgoing(await session.provider.createInvitation());
                      setPeers(session.provider.summaries());
                      setNotice('Send the invitation to your friend and wait for their response.');
                    })
                  }
                >
                  {busy ? 'Preparing connection…' : 'Generate invitation'}
                </button>
                <label htmlFor="peer-response">2. Paste your friend's response</label>
                <textarea
                  id="peer-response"
                  value={answer}
                  maxLength={PEER_CODE_LIMIT}
                  onChange={(event) => setAnswer(event.target.value)}
                  disabled={busy}
                  spellCheck={false}
                  autoComplete="off"
                />
                <button
                  className="secondary-button"
                  disabled={busy || !answer.trim()}
                  onClick={() =>
                    void run(async () => {
                      await session.provider.acceptResponse(answer);
                      setAnswer('');
                      setOutgoing('');
                      setNotice('Response accepted.');
                    })
                  }
                >
                  Connect friend
                </button>
              </>
            ) : (
              <>
                <label htmlFor="peer-offer">Host invitation</label>
                <textarea
                  id="peer-offer"
                  value={offer}
                  maxLength={PEER_CODE_LIMIT}
                  onChange={(event) => setOffer(event.target.value)}
                  disabled={busy}
                  spellCheck={false}
                  autoComplete="off"
                />
                <button
                  className="secondary-button"
                  disabled={busy || !offer.trim() || (!session && !name.trim())}
                  onClick={() => void run(guest)}
                >
                  {busy
                    ? 'Preparing connection…'
                    : session
                      ? 'Respond to fresh invitation'
                      : 'Create response'}
                </button>
                <p>
                  Paste the host's invitation, create a response, and send it back. The host then
                  accepts your response. To reconnect, ask for a fresh invitation; keep this session
                  open to retain unsent edits.
                </p>
                {session && (
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => {
                      session.provider.disconnect();
                      setOutgoing('');
                      setNotice(
                        'Connection paused. Ask the host for a fresh invitation to reconnect.',
                      );
                    }}
                  >
                    Pause connection
                  </button>
                )}
              </>
            )}
            {outgoing && (
              <>
                <label htmlFor="peer-outgoing">
                  {role === 'host' ? 'Peer invitation' : 'Peer response'}
                </label>
                <textarea
                  id="peer-outgoing"
                  value={outgoing}
                  readOnly
                  spellCheck={false}
                  autoComplete="off"
                />
                <button
                  className="secondary-button"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(outgoing)
                      .then(() => setNotice('Copied. Send it through a trusted private channel.'))
                      .catch(() => setError('Select and copy the code field.'))
                  }
                >
                  Copy {role === 'host' ? 'invitation' : 'response'}
                </button>
              </>
            )}
            {notice && (
              <p className="peer-notice" role="status">
                {notice}
              </p>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {session && (
              <ul className="peer-connections" aria-label="Peer connections">
                {peers.map((peer) => (
                  <li key={peer.id}>
                    {peer.name} ·{' '}
                    {peer.state === 'waiting'
                      ? 'Waiting for response'
                      : peer.state === 'connecting'
                        ? 'Connecting'
                        : 'Connected'}{' '}
                    ·{' '}
                    {peer.path === 'checking'
                      ? 'Checking connection path'
                      : peer.path === 'relay'
                        ? 'Encrypted relay'
                        : 'Encrypted direct connection'}
                  </li>
                ))}
              </ul>
            )}
            <p>
              Everyone can edit. No participant cap is configured. Ending or leaving discards this
              local document. Connection codes contain credentials and network addresses; share them
              only with people you trust.
            </p>
          </section>
          <OverlayControls />
        </>
      )}
    />
  );
}
