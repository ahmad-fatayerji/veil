import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import type { Awareness } from 'y-protocols/awareness';
import {
  HOST_URL,
  ROOM_NAME,
  validateBootstrap,
  websocketBaseUrl,
  type SessionTarget,
} from '@veil/protocol';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';
export interface CollaborationProvider {
  awareness: Awareness;
  shouldConnect: boolean;
  synced: boolean;
  connect(): void;
  disconnect(): void;
  on(event: 'status', listener: (event: { status: ConnectionStatus }) => void): unknown;
  on(event: 'sync', listener: (synced: boolean) => void): unknown;
  off(event: 'status', listener: (event: { status: ConnectionStatus }) => void): unknown;
  off(event: 'sync', listener: (synced: boolean) => void): unknown;
}
export interface DemoConnection {
  doc: Y.Doc;
  provider: CollaborationProvider;
  destroy(): void;
}

export async function connectDemo(
  name: string,
  signal?: AbortSignal,
  target?: SessionTarget,
): Promise<DemoConnection> {
  const fetchSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(5000)])
    : AbortSignal.timeout(5000);
  const hostUrl = target?.hostUrl ?? HOST_URL;
  const response = await fetch(`${hostUrl}/${target ? 'join' : 'bootstrap'}`, {
    signal: fetchSignal,
    cache: 'no-store',
    ...(target
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: target.sessionId, token: target.token }),
        }
      : {}),
  });
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? 'The invitation is invalid or the session has ended.'
        : 'The host refused the connection. Check the address and invitation.',
    );
  const bootstrap = validateBootstrap(await response.json());
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(
    websocketBaseUrl(hostUrl),
    target?.sessionId ?? ROOM_NAME,
    doc,
    {
      protocols: ['veil.v1', `veil.auth.${bootstrap.token}`],
      disableBc: true,
      connect: false,
      maxBackoffTime: 3000,
    },
  );
  provider.awareness.setLocalStateField('user', {
    name: name.trim().slice(0, 40) || 'Anonymous',
    color: ['#7560c9', '#287d69', '#c27635', '#387dc1', '#b54e78', '#a15ab9', '#71833a', '#bb5d44'][
      doc.clientID % 8
    ],
  });
  provider.awareness.setLocalStateField('activity', 'away');
  provider.on('status', ({ status }: { status: string }) => {
    // A reconnect must advance the local clock past the previous disconnect tombstone.
    if (status === 'connected')
      provider.awareness.setLocalState(provider.awareness.getLocalState());
  });
  return {
    doc,
    provider,
    destroy() {
      provider.destroy();
      provider.awareness.destroy();
      doc.destroy();
    },
  };
}

export { createPeerSession, type PeerSession, type PeerSummary } from './peer';

export type ParticipantActivity = 'typing' | 'selecting' | 'document' | 'away';
export interface Participant {
  id: number;
  name: string;
  color: string;
  activity: ParticipantActivity;
  local: boolean;
}

export function participantName(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 40) || 'Anonymous' : 'Anonymous';
}

export function participantColor(value: unknown): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : '#64748b';
}

export function readParticipants(connection: DemoConnection): Participant[] {
  return [...connection.provider.awareness.getStates()]
    .map(([id, state]) => ({
      id,
      name: participantName(state.user?.name),
      color: participantColor(state.user?.color),
      activity: ['typing', 'selecting', 'document', 'away'].includes(state.activity)
        ? (state.activity as ParticipantActivity)
        : 'away',
      local: id === connection.doc.clientID,
    }))
    .sort((a, b) => Number(b.local) - Number(a.local) || a.id - b.id);
}
export * from './automatic';
