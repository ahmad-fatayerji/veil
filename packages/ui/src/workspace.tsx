import { useEffect, useId, useRef, useState, type ReactNode, type MouseEventHandler } from 'react';
import { X } from 'lucide-react';
import { readParticipants, type DemoConnection, type PeerSummary } from '@veil/collaboration';
import { DOCUMENT_FRAGMENT, DOCUMENT_TITLE } from '@veil/protocol';
import { Avatar, activityLabels } from './components/people';
import { version as appVersion } from '../../../package.json';

// Same drawing as the 40 px Windows icon frame; colours follow the theme tokens.
export function BrandMark({ size = 20 }: { size?: number }) {
  return (
    <svg className="brand-mark" viewBox="2 2 36 36" width={size} height={size} aria-hidden="true">
      <rect x="2.5" y="2.5" width="35" height="35" rx="7.5" />
      <path d="M8 10 L15 10 L23.5 32 L16.5 32 Z M25 10 L32 10 L24.5 29.41 L21 20.35 Z" />
    </svg>
  );
}

export function Dialog({
  open,
  title,
  onClose,
  children,
  wide = false,
  locked = false,
  dismissOnBackdrop = false,
  className = '',
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  locked?: boolean;
  dismissOnBackdrop?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const backdropPointer = useRef<number | null>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog?.open) {
      dialog?.showModal();
      // Native dialogs focus their first control (the close button); prefer a marked one.
      dialog?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    } else if (!open && dialog?.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`app-dialog ${wide ? 'dialog-wide' : ''} ${className}`}
      aria-labelledby={id}
      onCancel={(event) => {
        if (locked) event.preventDefault();
        else onClose();
      }}
      onPointerDown={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const outside =
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom;
        backdropPointer.current =
          event.button === 0 && event.target === event.currentTarget && outside
            ? event.pointerId
            : null;
      }}
      onPointerUp={(event) => {
        const startedOutside = backdropPointer.current === event.pointerId;
        backdropPointer.current = null;
        const bounds = event.currentTarget.getBoundingClientRect();
        const outside =
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom;
        if (
          dismissOnBackdrop &&
          !locked &&
          startedOutside &&
          event.target === event.currentTarget &&
          outside
        ) {
          onClose();
        }
      }}
      onPointerCancel={() => {
        backdropPointer.current = null;
      }}
      onClose={onClose}
    >
      <div className="dialog-heading">
        <h2 id={id}>{title}</h2>
        <button
          type="button"
          className="icon-btn dialog-close"
          aria-label={`Close ${title}`}
          onClick={onClose}
          disabled={locked}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}

export function useParticipants(connection: DemoConnection | null) {
  const [participants, set] = useState(() => (connection ? readParticipants(connection) : []));
  useEffect(() => {
    if (!connection) return;
    const update = () => set(readParticipants(connection));
    update();
    connection.provider.awareness.on('change', update);
    return () => connection.provider.awareness.off('change', update);
  }, [connection]);
  return connection ? participants : [];
}

function connectionLabel(peer: PeerSummary, role?: 'host' | 'guest') {
  const path =
    peer.state !== 'connected'
      ? 'Connecting'
      : peer.path === 'direct'
        ? 'Direct'
        : peer.path === 'relay'
          ? 'Relayed'
          : 'Connecting';
  return role === 'guest' ? `${path} to host` : path;
}

export function PeoplePanel({
  connection,
  peers = [],
  role,
  onClose,
  invite,
  children,
}: {
  connection: DemoConnection;
  peers?: PeerSummary[];
  role?: 'host' | 'guest';
  onClose: () => void;
  invite?: ReactNode;
  children?: ReactNode;
}) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Narrow windows show People as a sheet; move focus into it when it opens there.
    if (matchMedia('(max-width: 900px)').matches) close.current?.focus();
  }, []);
  const participants = useParticipants(connection);
  return (
    <aside
      className="people-panel"
      id="people-panel"
      aria-label="People"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div className="panel-heading">
        <h2>
          People <span className="count">{participants.length}</span>
        </h2>
        <button
          ref={close}
          type="button"
          className="icon-btn icon-btn-sm"
          aria-label="Hide people"
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      {invite}
      <ul className="people-list" aria-label="Participants">
        {participants.map((person) => {
          const peer = peers.find((p) => p.clientId === person.id);
          return (
            <li key={person.id} data-participant-name={person.name}>
              <Avatar person={person} />
              <span className="participant-detail">
                <span className="participant-name" title={person.name}>
                  {person.name}
                  {person.local && person.name !== 'You' && (
                    <span className="you-label">(you)</span>
                  )}
                </span>
                <span className="participant-meta">
                  <span className="participant-activity">{activityLabels[person.activity]}</span>
                  {peer && <span className="connection-path">· {connectionLabel(peer, role)}</span>}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {peers
        .filter((peer) => !participants.some((person) => person.id === peer.clientId))
        .map((peer) => (
          <p key={peer.id} className="panel-hint">
            {peer.name} is connecting…
          </p>
        ))}
      {children}
    </aside>
  );
}

export function hasDocumentContent(connection: Pick<DemoConnection, 'doc'>) {
  if (connection.doc.getText(DOCUMENT_TITLE).toString().trim()) return true;
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
      <p>
        Developed by{' '}
        <a
          href="https://ahmadfatayerji.com"
          target="_blank"
          rel="noopener noreferrer"
          onClick={onVisit}
        >
          Ahmad Fatayerji
        </a>
        .
      </p>
    </div>
  );
}

export const appVersionNumber = appVersion;

export function AppVersion() {
  return <p>Version {appVersion}</p>;
}
