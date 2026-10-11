import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type MouseEventHandler,
} from 'react';
import { readParticipants, type DemoConnection, type PeerSummary } from '@veil/collaboration';
import { DOCUMENT_FRAGMENT } from '@veil/protocol';
import veilIcon from './assets/veil-icon-small.png';
import { version as appVersion } from '../../../package.json';
export function Brand() {
  return (
    <span className="brand">
      <img className="brand-icon" src={veilIcon} alt="" width="28" height="28" />
      <span>
        veil<span className="brand-dot">.</span>
      </span>
    </span>
  );
}
export function Dialog({
  open,
  title,
  onClose,
  children,
  wide = false,
  locked = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  locked?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog?.open) dialog?.showModal();
    else if (!open && dialog?.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`app-dialog ${wide ? 'dialog-wide' : ''}`}
      aria-labelledby={id}
      onCancel={(event) => {
        if (locked) event.preventDefault();
        else onClose();
      }}
      onClose={onClose}
    >
      <div className="dialog-heading">
        <h2 id={id}>{title}</h2>
        <button
          className="icon-button"
          aria-label={`Close ${title}`}
          onClick={onClose}
          disabled={locked}
        >
          {'\u00d7'}
        </button>
      </div>
      {children}
    </dialog>
  );
}
const activityLabels = {
  typing: 'Typing' + '\u2026',
  selecting: 'Selecting text',
  document: 'In document',
  away: 'Away from document',
};
export function PeoplePanel({
  connection,
  peers = [],
  role,
  onClose,
  children,
}: {
  connection: DemoConnection;
  peers?: PeerSummary[];
  role?: 'host' | 'guest';
  onClose: () => void;
  children?: ReactNode;
}) {
  const [participants, set] = useState(() => readParticipants(connection));
  useEffect(() => {
    const update = () => set(readParticipants(connection));
    update();
    connection.provider.awareness.on('change', update);
    return () => connection.provider.awareness.off('change', update);
  }, [connection]);
  return (
    <aside className="people-panel" aria-label="Session">
      <div className="panel-heading">
        <h2>
          People <span className="count">{participants.length}</span>
        </h2>
        <button className="icon-button" aria-label="Hide people" onClick={onClose}>
          {'\u00d7'}
        </button>
      </div>
      <ul aria-label="Participants">
        {participants.map((person) => {
          const peer = peers.find((p) => p.clientId === person.id);
          return (
            <li key={person.id} data-participant-name={person.name}>
              <span className="avatar" style={{ '--person-color': person.color } as CSSProperties}>
                {person.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="participant-detail">
                <span className="participant-name">
                  {person.name}
                  {person.local && <span className="you-label">you</span>}
                </span>
                <span className="participant-activity">{activityLabels[person.activity]}</span>
                {peer && (
                  <span className="connection-path">
                    {peer.state !== 'connected'
                      ? 'Connecting'
                      : peer.path === 'direct'
                        ? 'Direct'
                        : peer.path === 'relay'
                          ? 'Relayed'
                          : 'Connecting'}
                    {role === 'guest' ? ' ' + '\u00b7' + ' to host' : ''}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {peers
        .filter((peer) => !participants.some((person) => person.id === peer.clientId))
        .map((peer) => (
          <p key={peer.id} className="panel-hint">
            {peer.name} - Connecting
          </p>
        ))}
      {children}
    </aside>
  );
}
export function hasDocumentContent(connection: Pick<DemoConnection, 'doc'>) {
  const fragment = connection.doc.getXmlFragment(DOCUMENT_FRAGMENT);
  // Inspect actual editor fragment below rather than document updates/presence.
  const meaningful = (value: { toString(): string }) =>
    /<(?:horizontalrule|image|table)(?:[ >])/i.test(value.toString()) ||
    value
      .toString()
      .replace(/<[^>]*>/g, '')
      .trim().length > 0;
  return fragment.length > 0 && meaningful(fragment);
}

export function DeveloperCredit({ onVisit }: { onVisit?: MouseEventHandler<HTMLAnchorElement> }) {
  return (
    <div className="developer-credit">
      <p>Developed by Ahmad Fatayerji.</p>
      <a
        href="https://ahmadfatayerji.com"
        target="_blank"
        rel="noopener noreferrer"
        onClick={onVisit}
      >
        ahmadfatayerji.com
      </a>
    </div>
  );
}

export function AppVersion() {
  return <p>Version {appVersion}</p>;
}
