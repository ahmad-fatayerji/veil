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
  | { kind: 'flush'; requestId: string }
  | { kind: 'flushed'; requestId: string }
  | { kind: 'closed' }
  | { kind: 'session'; id: string; update: number[]; user: Record<string, unknown> }
  | { kind: 'update'; id: string; update: number[] }
  | { kind: 'participants'; id: string; participants: Participant[] }
  | { kind: 'awareness'; id: string; update: number[] }
  | { kind: 'presence'; id: string; cursor: unknown; activity: unknown }
  | { kind: 'tabs'; activeId: string; tabs: OverlayTab[] }
  | { kind: 'select'; tabId: string };

/** An open document as the overlay's switcher shows it. */
export interface OverlayTab {
  id: string;
  title: string;
  status: string;
  dirty: boolean;
}
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
      const changed = [...added, ...updated, ...removed];
      // Renames update the network presence. Copy the name here too, or the next cursor
      // move publishes the name this editor opened with.
      const user = network.getLocalState()?.user;
      if (
        changed.includes(network.clientID) &&
        user &&
        JSON.stringify(user) !== JSON.stringify(awareness.getLocalState()?.user)
      )
        awareness.setLocalStateField('user', user);
      const ids = changed.filter((id) => id !== network.clientID);
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
/** Drain overlay edits before saving, closing a tab, or quitting. */
export async function flushOverlay() {
  const requestId = crypto.randomUUID();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop: (() => void) | undefined;
  let finished = false;
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error('The overlay did not respond. Try again before closing or saving.')),
        5000,
      );
      void listen<Message>('desktop-document', ({ payload }) => {
        if (payload.kind === 'flushed' && payload.requestId === requestId) resolve();
      })
        .then((unlisten) => {
          if (finished) {
            unlisten();
            return;
          }
          stop = unlisten;
          return send({ kind: 'flush', requestId });
        })
        .catch(reject);
    });
  } finally {
    finished = true;
    clearTimeout(timer);
    stop?.();
  }
}

export function SessionBridge({
  connection,
  resolveDocument,
  tabs = [],
  activeId = '',
  onSelectTab,
}: {
  connection: DemoConnection | null;
  resolveDocument?: (id: string) => DemoConnection | null;
  /** Open documents offered by the overlay's switcher. */
  tabs?: OverlayTab[];
  activeId?: string;
  onSelectTab?: (id: string) => void;
}) {
  const current = useRef(connection);
  const resolver = useRef(resolveDocument);
  const selectTab = useRef(onSelectTab);
  const initial = useRef<() => void>(() => {});
  const publishTabs = useRef<() => void>(() => {});
  const outgoing = useRef<Promise<unknown>>(Promise.resolve());
  const [error, setError] = useState('');
  useEffect(() => {
    current.current = connection;
    resolver.current = resolveDocument;
    selectTab.current = onSelectTab;
  });
  // Republish only when the switcher's content changes, not on every render.
  const tabList = JSON.stringify({ activeId, tabs });
  useEffect(() => {
    const message = { kind: 'tabs', ...JSON.parse(tabList) } as Message;
    publishTabs.current = () => {
      outgoing.current = outgoing.current
        .then(() => send(message))
        .catch((cause: unknown) => setError(errorMessage(cause)));
    };
    publishTabs.current();
  }, [tabList]);
  useEffect(() => {
    let active = true;
    const subscription = listen<Message>('desktop-document', ({ payload }) => {
      if (!active) return;
      if (payload.kind === 'request') {
        initial.current();
        publishTabs.current();
      } else if (payload.kind === 'select') selectTab.current?.(payload.tabId);
      else if (payload.kind === 'update') {
        const target =
          resolver.current?.(payload.id) ??
          (String(current.current?.doc.clientID) === payload.id ? current.current : null);
        if (target) Y.applyUpdate(target.doc, new Uint8Array(payload.update), relayOrigin);
      } else if (
        payload.kind === 'presence' &&
        current.current &&
        payload.id === String(current.current.doc.clientID)
      ) {
        current.current.provider.awareness.setLocalState({
          ...current.current.provider.awareness.getLocalState(),
          cursor: payload.cursor,
          activity: payload.activity,
        });
      }
    });
    void subscription
      .then(() => {
        if (active) initial.current();
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      });
    return () => {
      active = false;
      void subscription.then((stop) => stop()).catch(() => {});
    };
  }, []);
  useEffect(() => {
    let active = true;
    const dispatch = (message: Message) => {
      outgoing.current = outgoing.current
        .then(() => send(message))
        .catch((cause: unknown) => {
          if (active) setError(errorMessage(cause));
        });
    };
    const participants = () => {
      if (connection)
        dispatch({
          kind: 'participants',
          id: String(connection.doc.clientID),
          participants: readParticipants(connection),
        });
    };
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
    const publish = () => {
      if (!connection) {
        dispatch({ kind: 'closed' });
        return;
      }
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
    };
    initial.current = publish;
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
    publish();
    return () => {
      active = false;
      connection?.doc.off('update', update);
      connection?.provider.awareness.off('change', participants);
      connection?.provider.awareness.off('update', awareness);
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
  const [tabs, setTabs] = useState<{ activeId: string; tabs: OverlayTab[] }>({
    activeId: '',
    tabs: [],
  });
  const [error, setError] = useState('');
  const select = useRef<(id: string) => void>(() => {});
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
    select.current = (tabId) => dispatch({ kind: 'select', tabId });
    const subscription = listen<Message>('desktop-document', ({ payload }) => {
      if (!active) return;
      if (payload.kind === 'tabs') {
        setTabs({ activeId: payload.activeId, tabs: payload.tabs });
      } else if (payload.kind === 'flush') {
        dispatch({ kind: 'flushed', requestId: payload.requestId });
      } else if (payload.kind === 'closed') {
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
  return {
    connection,
    participants,
    error,
    tabs: tabs.tabs,
    activeId: tabs.activeId,
    selectTab: (id: string) => select.current(id),
  };
}
