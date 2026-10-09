import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  connectDemo,
  readParticipants,
  type DemoConnection,
  type Participant,
} from '@veil/collaboration';
import { SharedEditor } from '@veil/editor';
import { roadmap } from './roadmap';
import veilIcon from './assets/veil-icon-small.png';

type Status = 'offline' | 'connecting' | 'connected' | 'disconnected' | 'synced';
const activityLabels = {
  typing: 'Typing…',
  selecting: 'Selecting text',
  document: 'In document',
  away: 'Away from document',
};

function Avatar({ person }: { person: Participant }) {
  return (
    <span
      className="avatar"
      style={{ '--person-color': person.color } as CSSProperties}
      title={person.name}
    >
      {person.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function DemoApp({
  surface,
  desktopControls,
  renderEditor,
}: {
  surface: 'browser' | 'desktop';
  desktopControls?: ReactNode | ((connection: DemoConnection | null) => ReactNode);
  renderEditor?: (connection: DemoConnection) => ReactNode;
}) {
  const [name, setName] = useState('');
  const [connection, setConnection] = useState<DemoConnection | null>(null);
  const [status, setStatus] = useState<Status>('offline');
  const [error, setError] = useState('');
  const [joinRequest, setJoinRequest] = useState<{ name: string } | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [showPeople, setShowPeople] = useState(true);
  const roadmapDialog = useRef<HTMLDialogElement>(null);
  const joining = joinRequest !== null;

  useEffect(() => {
    if (!joinRequest) return;
    const abort = new AbortController();
    let active: DemoConnection | undefined;
    connectDemo(joinRequest.name, abort.signal)
      .then((session) => {
        if (abort.signal.aborted) {
          session.destroy();
          return;
        }
        active = session;
        const updateParticipants = () => {
          if (!abort.signal.aborted) setParticipants(readParticipants(session));
        };
        session.provider.on('status', ({ status }: { status: Status }) => {
          if (!abort.signal.aborted) setStatus(status);
        });
        session.provider.on('sync', (synced: boolean) => {
          if (synced && !abort.signal.aborted) setStatus('synced');
        });
        session.provider.awareness.on('change', updateParticipants);
        updateParticipants();
        setConnection(session);
        session.provider.connect();
      })
      .catch(() => {
        if (!abort.signal.aborted) {
          setError('Could not reach the local host. Start pnpm dev:host, then try again.');
          setJoinRequest(null);
          setStatus('offline');
        }
      });
    return () => {
      abort.abort();
      active?.destroy();
    };
  }, [joinRequest]);

  function leave() {
    setJoinRequest(null);
    setConnection(null);
    setParticipants([]);
    setStatus('offline');
  }
  const statusText =
    status === 'synced'
      ? 'Connected'
      : status === 'disconnected'
        ? 'Disconnected'
        : status === 'offline'
          ? 'Not connected'
          : status === 'connecting'
            ? 'Connecting…'
            : 'Synchronizing…';

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="brand">
          <img className="brand-icon" src={veilIcon} alt="" width="30" height="30" />
          <span>
            veil<span className="brand-dot">.</span>
          </span>
        </span>
        <span className="header-divider" />
        <span className="session-label">Local session</span>
        <span className={`status status-${status}`} role="status">
          <span className="status-dot" />
          {statusText}
        </span>
        <div className="header-actions">
          {connection && (
            <button
              className="people-toggle"
              aria-label="People"
              aria-expanded={showPeople}
              onClick={() => setShowPeople(!showPeople)}
            >
              <span className="avatar-stack" aria-hidden="true">
                {participants.slice(0, 4).map((person) => (
                  <Avatar key={person.id} person={person} />
                ))}
              </span>
              <span>
                {participants.length} {participants.length === 1 ? 'person' : 'people'}
              </span>
            </button>
          )}
          <button className="quiet-button" onClick={() => roadmapDialog.current?.showModal()}>
            Roadmap
          </button>
        </div>
      </header>

      {typeof desktopControls === 'function' ? desktopControls(connection) : desktopControls}

      <main className={`workspace ${connection && showPeople ? 'with-sidebar' : ''}`}>
        <section className="document-workspace" aria-label="Collaborative workspace">
          <div className="document-heading">
            <h1>Untitled document</h1>
            <span>{surface === 'desktop' ? 'Desktop' : 'Browser'}</span>
          </div>
          <div className="document-panel">
            {connection ? (
              renderEditor ? (
                renderEditor(connection)
              ) : (
                <SharedEditor connection={connection} />
              )
            ) : (
              <div className="join-screen">
                <h2>Join the document.</h2>
                <p>Write together in a session on this computer.</p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    setError('');
                    setJoinRequest({ name });
                    setStatus('connecting');
                  }}
                >
                  <label htmlFor="name">Your name</label>
                  <input
                    id="name"
                    placeholder="e.g. Alex"
                    value={name}
                    maxLength={40}
                    disabled={joining}
                    autoComplete="nickname"
                    onChange={(event) => setName(event.target.value)}
                  />
                  <button className="primary-button" type="submit" disabled={joining}>
                    {joining ? 'Connecting…' : 'Join local session'}
                  </button>
                  {error && (
                    <p className="error" role="alert">
                      {error}
                    </p>
                  )}
                </form>
                <p className="join-note">Open a second window to collaborate with another name.</p>
              </div>
            )}
          </div>
          <footer className="document-footer">
            <span>Temporary document · not saved to disk</span>
            <span>Local only</span>
          </footer>
        </section>

        {connection && showPeople && (
          <aside className="people-panel" aria-label="Session">
            <div className="panel-heading">
              <h2>People</h2>
              <button
                className="icon-button"
                aria-label="Hide people"
                onClick={() => setShowPeople(false)}
              >
                ×
              </button>
            </div>
            <p className="panel-hint">Cursors and selections appear in each person's color.</p>
            <ul aria-label="Participants">
              {participants.map((person) => (
                <li key={person.id} data-participant-name={person.name}>
                  <Avatar person={person} />
                  <span className="participant-detail">
                    <span className="participant-name">
                      {person.name}
                      {person.local && <span className="you-label">you</span>}
                    </span>
                    <span className={`participant-activity activity-${person.activity}`}>
                      {activityLabels[person.activity]}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="session-controls">
              <button
                className="secondary-button"
                onClick={() => {
                  if (connection.provider.shouldConnect) connection.provider.disconnect();
                  else connection.provider.connect();
                }}
              >
                {status === 'disconnected' ? 'Reconnect' : 'Disconnect'}
              </button>
              <button className="quiet-button" onClick={leave}>
                Leave session
              </button>
            </div>
            <p className="panel-footnote">
              Saved documents and invitations are still in development.
            </p>
          </aside>
        )}
      </main>

      <dialog ref={roadmapDialog} className="roadmap-dialog" aria-labelledby="roadmap-title">
        <div className="roadmap-heading">
          <div>
            <span className="overline">PROJECT STATUS</span>
            <h2 id="roadmap-title">What's left to build</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close roadmap"
            onClick={() => roadmapDialog.current?.close()}
          >
            ×
          </button>
        </div>
        <p className="roadmap-intro">
          Local collaboration and the Windows overlay are built. Hosting and invitations are next.
        </p>
        <ol className="roadmap-list">
          {roadmap.map((milestone) => (
            <li key={milestone.id}>
              <span className={`milestone-marker marker-${milestone.status.toLowerCase()}`}>
                {milestone.id}
              </span>
              <div>
                <div className="milestone-heading">
                  <h3>{milestone.title}</h3>
                  <span className={`milestone-status ${milestone.status.toLowerCase()}`}>
                    {milestone.status}
                  </span>
                </div>
                <p>{milestone.detail}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="roadmap-note">
          For now, start the local host in a terminal with <code>pnpm dev:host</code>. Closing the
          host loses the document.
        </p>
      </dialog>
    </div>
  );
}
