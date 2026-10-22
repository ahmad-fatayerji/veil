import { useEffect, useRef, useState, type ReactNode } from 'react';
import { listen } from '@tauri-apps/api/event';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { readParticipants, type DemoConnection, type Participant } from '@veil/collaboration';
import { SharedEditor, type EditorConnection } from '@veil/editor';
import { errorMessage, invoke } from './api';
import { useVisibilityMenu } from './VisibilityMenu';

type Message =
  | { kind: 'request' }
  | { kind: 'closed' }
  | { kind: 'session'; id: string; update: number[]; user: Record<string, unknown> }
  | { kind: 'update'; id: string; update: number[] }
  | { kind: 'participants'; id: string; participants: Participant[] }
  | { kind: 'awareness'; id: string; update: number[] }
  | { kind: 'presence'; id: string; cursor: unknown; activity: unknown };
const relayOrigin = Symbol('desktop document relay');
const send = (message: Message) => invoke('document_relay', { message });

export function DesktopEditor({
  connection,
  header,
  aside,
}: {
  connection: DemoConnection;
  header?: ReactNode;
  aside?: ReactNode;
}) {
  const [view, setView] = useState<EditorConnection | null>(null);
  const [menuError, setMenuError] = useState('');
  const visibilityMenu = useVisibilityMenu(true, setMenuError);
  useEffect(() => {
    // Cursor plugins clear their own cursor on blur and document updates. Keep the
    // main editor's local cursor separate from the network cursor owned by the overlay.
    const network = connection.provider.awareness;
    const awareness = new Awareness(connection.doc);
    awareness.setLocalState(network.getLocalState());
    const remote = ({
      added,
      updated,
      removed,
    }: {
      added: number[];
      updated: number[];
      removed: number[];
    }) => {
      const ids = [...added, ...updated, ...removed].filter((id) => id !== network.clientID);
      if (ids.length)
        applyAwarenessUpdate(awareness, encodeAwarenessUpdate(network, ids), relayOrigin);
    };
    remote({ added: [...network.getStates().keys()], updated: [], removed: [] });
    const local = ({ added, updated }: { added: number[]; updated: number[] }) => {
      if ([...added, ...updated].includes(awareness.clientID))
        network.setLocalState(awareness.getLocalState());
    };
    network.on('update', remote);
    awareness.on('change', local);
    // Awareness owns timers and listeners. Create it in the effect so discarded
    // Strict Mode renders cannot leak it, then publish the ready editor resource.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setView({ doc: connection.doc, provider: { awareness } });
    return () => {
      network.off('update', remote);
      awareness.off('change', local);
      awareness.destroy();
    };
  }, [connection]);
  return view ? (
    <div style={{ display: 'contents' }} onContextMenu={visibilityMenu.onContextMenu}>
      <SharedEditor connection={view} header={header} aside={aside} />
      {visibilityMenu.menu}
      {menuError && (
        <p className="error editor-menu-error" role="alert">
          Overlay menu: {menuError}
        </p>
      )}
    </div>
  ) : null;
}

// One network participant, two independent CRDT views. Incremental Yjs updates
// preserve concurrent edits; presence from either editor uses the same identity.
export function SessionBridge({ connection }: { connection: DemoConnection | null }) {
  const current = useRef(connection);
  const outgoing = useRef<Promise<unknown>>(Promise.resolve());
  const [error, setError] = useState('');
  useEffect(() => {
    current.current = connection;
    let active = true;
    const dispatch = (message: Message) => {
      outgoing.current = outgoing.current
        .then(() => send(message))
        .catch((failure: unknown) => {
          if (active) setError(errorMessage(failure));
        });
    };
    const initial = () => {
      if (connection) {
        dispatch({
          kind: 'session',
          id: String(connection.doc.clientID),
          update: Array.from(Y.encodeStateAsUpdate(connection.doc)),
          user: connection.provider.awareness.getLocalState()?.user ?? {},
        });
        participants();
        awareness({
          added: [...connection.provider.awareness.getStates().keys()],
          updated: [],
          removed: [],
        });
      } else dispatch({ kind: 'closed' });
    };
    const participants = () => {
      if (connection)
        dispatch({
          kind: 'participants',
          id: String(connection.doc.clientID),
          participants: readParticipants(connection),
        });
    };
    // Only remote identities belong in the overlay's awareness replica. Its own
    // cursor remains independent and publishes through the main network identity.
    // Forward update events (including heartbeats and removal tombstones), so
    // idle remote cursors do not expire while the network still considers them live.
    const awareness = ({
      added,
      updated,
      removed,
    }: {
      added: number[];
      updated: number[];
      removed: number[];
    }) => {
      if (!connection) return;
      const network = connection.provider.awareness;
      const ids = [...added, ...updated, ...removed].filter((id) => id !== network.clientID);
      if (ids.length)
        dispatch({
          kind: 'awareness',
          id: String(connection.doc.clientID),
          update: Array.from(encodeAwarenessUpdate(network, ids)),
        });
    };
    const update = (bytes: Uint8Array) => {
      if (connection)
        dispatch({
          kind: 'update',
          id: String(connection.doc.clientID),
          update: Array.from(bytes),
        });
    };
    connection?.doc.on('update', update);
    connection?.provider.awareness.on('change', participants);
    connection?.provider.awareness.on('update', awareness);
    const subscription = listen<Message>('desktop-document', ({ payload }) => {
      if (!active || current.current !== connection) return;
      if (payload.kind === 'request') initial();
      else if (connection && 'id' in payload && payload.id === String(connection.doc.clientID)) {
        if (payload.kind === 'update')
          Y.applyUpdate(connection.doc, new Uint8Array(payload.update), relayOrigin);
        else if (payload.kind === 'presence') {
          connection.provider.awareness.setLocalState({
            ...connection.provider.awareness.getLocalState(),
            cursor: payload.cursor,
            activity: payload.activity,
          });
        }
      }
    });
    void subscription
      .then(() => {
        if (active) initial();
      })
      .catch((failure: unknown) => {
        if (active) setError(errorMessage(failure));
      });
    return () => {
      active = false;
      connection?.doc.off('update', update);
      connection?.provider.awareness.off('change', participants);
      connection?.provider.awareness.off('update', awareness);
      if (connection) dispatch({ kind: 'closed' });
      void subscription.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [connection]);
  return error ? (
    <p className="overlay-error" role="alert">
      Overlay document: {error}
    </p>
  ) : null;
}

export function useOverlayDocument() {
  const [connection, setConnection] = useState<EditorConnection | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let outgoing: Promise<unknown> = Promise.resolve();
    let session: { id: string; connection: EditorConnection; destroy: () => void } | null = null;
    const dispatch = (message: Message) => {
      outgoing = outgoing
        .then(() => send(message))
        .catch((failure: unknown) => {
          if (active) setError(errorMessage(failure));
        });
    };
    const clear = () => {
      session?.destroy();
      session = null;
    };
    const subscription = listen<Message>('desktop-document', ({ payload }) => {
      if (!active) return;
      if (payload.kind === 'closed') {
        clear();
        setConnection(null);
        setParticipants([]);
      } else if (payload.kind === 'session') {
        if (session?.id === payload.id) {
          Y.applyUpdate(session.connection.doc, new Uint8Array(payload.update), relayOrigin);
          return;
        }
        clear();
        setParticipants([]);
        const doc = new Y.Doc();
        Y.applyUpdate(doc, new Uint8Array(payload.update), relayOrigin);
        const awareness = new Awareness(doc);
        awareness.setLocalState({ user: payload.user, activity: 'away' });
        const connection = { doc, provider: { awareness } };
        const update = (bytes: Uint8Array, origin: unknown) => {
          if (origin !== relayOrigin)
            dispatch({ kind: 'update', id: payload.id, update: Array.from(bytes) });
        };
        const presence = ({ added, updated }: { added: number[]; updated: number[] }) => {
          if (![...added, ...updated].includes(awareness.clientID)) return;
          const local = awareness.getLocalState();
          if (local)
            dispatch({
              kind: 'presence',
              id: payload.id,
              cursor: local.cursor ?? null,
              activity: local.activity ?? 'away',
            });
        };
        doc.on('update', update);
        awareness.on('change', presence);
        session = {
          id: payload.id,
          connection,
          destroy: () => {
            doc.off('update', update);
            awareness.off('change', presence);
            awareness.destroy();
            doc.destroy();
          },
        };
        setError('');
        setConnection(connection);
      } else if (payload.kind === 'update' && session?.id === payload.id) {
        Y.applyUpdate(session.connection.doc, new Uint8Array(payload.update), relayOrigin);
      } else if (payload.kind === 'participants' && session?.id === payload.id) {
        setParticipants(payload.participants);
      } else if (payload.kind === 'awareness' && session?.id === payload.id) {
        applyAwarenessUpdate(
          session.connection.provider.awareness,
          new Uint8Array(payload.update),
          relayOrigin,
        );
      }
    });
    void subscription
      .then(() => {
        if (active) dispatch({ kind: 'request' });
      })
      .catch((failure: unknown) => {
        if (active) setError(errorMessage(failure));
      });
    return () => {
      active = false;
      clear();
      void subscription.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);
  return { connection, participants, error };
}
