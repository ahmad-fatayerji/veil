import * as Y from 'yjs';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import * as sync from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { ObservableV2 } from 'lib0/observable';
import {
  decodePeerCode,
  encodePeerCode,
  PEER_INVITE_LIFETIME,
  type PeerCode,
} from '@veil/protocol';
import type { ConnectionStatus, DemoConnection } from './index';

const CHUNK_SIZE = 16 * 1024;
const MAX_MESSAGE = 4 * 1024 * 1024;
const MAX_QUEUE = 8 * 1024 * 1024;
const MAX_BUFFER = 256 * 1024;
const networkOrigin = Symbol('peer network');
const randomHex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');

export interface PeerSummary {
  id: string;
  name: string;
  state: 'waiting' | 'connecting' | 'connected';
  path: 'direct' | 'relay' | 'checking';
}

interface Peer {
  id: string;
  pc: RTCPeerConnection;
  channel?: RTCDataChannel;
  code: PeerCode;
  clientId?: number;
  authenticated: boolean;
  closed: boolean;
  answerAccepted: boolean;
  path: PeerSummary['path'];
  queue: Uint8Array[];
  queuedBytes: number;
  sequence: number;
  incoming?: { id: number; total: number; chunks: Uint8Array[]; size: number };
  frames: number;
  window: number;
  deadline?: ReturnType<typeof setTimeout>;
  stalled?: ReturnType<typeof setTimeout>;
  disconnected?: ReturnType<typeof setTimeout>;
  receiving?: ReturnType<typeof setTimeout>;
}

async function gatherIce(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === 'complete') return;
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', changed);
      pc.removeEventListener('connectionstatechange', closed);
      if (error) reject(error);
      else resolve();
    };
    const changed = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };
    const closed = () => {
      if (pc.connectionState === 'closed') finish(new Error('Connection setup was cancelled.'));
    };
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            'Address discovery timed out. Check your network server settings and try again.',
          ),
        ),
      15_000,
    );
    pc.addEventListener('icegatheringstatechange', changed);
    pc.addEventListener('connectionstatechange', closed);
    changed();
  });
}

export class PeerProvider extends ObservableV2<{
  status: (event: { status: ConnectionStatus }) => void;
  sync: (synced: boolean) => void;
  peers: () => void;
  error: (message: string) => void;
}> {
  readonly awareness: Awareness;
  shouldConnect = true;
  synced: boolean;
  sessionId: string | null;
  private peers = new Map<string, Peer>();
  private destroyed = false;

  constructor(
    readonly doc: Y.Doc,
    readonly role: 'host' | 'guest',
    name: string,
    private iceServers: RTCIceServer[],
  ) {
    super();
    this.sessionId = role === 'host' ? randomHex(16) : null;
    this.synced = role === 'host';
    this.awareness = new Awareness(doc);
    this.awareness.setLocalState({
      user: {
        name: name.trim().slice(0, 40) || 'Anonymous',
        color: ['#7560c9', '#287d69', '#387dc1', '#b54e78'][doc.clientID % 4],
      },
      activity: 'away',
    });
    doc.on('update', this.documentChanged);
    this.awareness.on('update', this.awarenessChanged);
  }

  summaries(): PeerSummary[] {
    return [...this.peers.values()].map((peer) => ({
      id: peer.id,
      name:
        peer.clientId === undefined
          ? 'New participant'
          : String(
              this.awareness.getStates().get(peer.clientId)?.user?.name ?? 'Participant',
            ).slice(0, 40),
      state: peer.authenticated ? 'connected' : peer.answerAccepted ? 'connecting' : 'waiting',
      path: peer.path,
    }));
  }

  private changed() {
    this.emit('peers', []);
  }
  private status(value: ConnectionStatus) {
    this.emit('status', [{ status: value }]);
    if (value !== 'connected') {
      this.synced = false;
      this.emit('sync', [false]);
    }
  }

  private documentChanged = (update: Uint8Array, origin: unknown) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    sync.writeUpdate(encoder, update);
    this.broadcast(encoding.toUint8Array(encoder), origin);
  };

  private awarenessChanged = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    const ids = [...added, ...updated, ...removed];
    if (this.role === 'guest' && !ids.includes(this.doc.clientID)) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 1);
    encoding.writeVarUint8Array(
      encoder,
      encodeAwarenessUpdate(this.awareness, this.role === 'guest' ? [this.doc.clientID] : ids),
    );
    this.broadcast(encoding.toUint8Array(encoder), origin);
    this.changed();
  };

  private broadcast(data: Uint8Array, origin: unknown) {
    for (const peer of this.peers.values())
      if (peer.authenticated && peer !== origin) this.send(peer, data);
  }

  private drain(peer: Peer) {
    const channel = peer.channel;
    if (!channel || channel.readyState !== 'open' || peer.closed) return;
    try {
      while (peer.queue.length && channel.bufferedAmount < MAX_BUFFER) {
        const chunk = peer.queue.shift()!;
        peer.queuedBytes -= chunk.byteLength;
        channel.send(Uint8Array.from(chunk));
      }
      if (peer.queue.length || channel.bufferedAmount >= MAX_BUFFER) {
        peer.stalled ??= setTimeout(
          () =>
            this.closePeer(peer, 'A slow peer was disconnected. Rejoin with a fresh invitation.'),
          30_000,
        );
      } else {
        clearTimeout(peer.stalled);
        peer.stalled = undefined;
      }
    } catch {
      this.closePeer(peer, 'Could not send to a peer. Rejoin with a fresh invitation.');
    }
  }

  private send(peer: Peer, data: Uint8Array) {
    if (peer.closed) return;
    const total = Math.ceil(data.byteLength / CHUNK_SIZE);
    if (
      !total ||
      data.byteLength > MAX_MESSAGE ||
      peer.queuedBytes + data.byteLength + total * 13 > MAX_QUEUE
    ) {
      this.closePeer(peer, 'A connection exceeded the document-message or outgoing-queue limit.');
      return;
    }
    const id = peer.sequence++ >>> 0;
    for (let index = 0; index < total; index++) {
      const part = data.subarray(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE);
      const chunk = new Uint8Array(part.byteLength + 13);
      const header = new DataView(chunk.buffer);
      header.setUint8(0, 1);
      header.setUint32(1, id);
      header.setUint32(5, index);
      header.setUint32(9, total);
      chunk.set(part, 13);
      peer.queue.push(chunk);
      peer.queuedBytes += chunk.byteLength;
    }
    this.drain(peer);
  }

  private receive(peer: Peer, data: ArrayBuffer) {
    if (data.byteLength < 14 || data.byteLength > CHUNK_SIZE + 13) throw new Error();
    const header = new DataView(data);
    const id = header.getUint32(1),
      index = header.getUint32(5),
      total = header.getUint32(9);
    if (
      header.getUint8(0) !== 1 ||
      !total ||
      total > Math.ceil(MAX_MESSAGE / CHUNK_SIZE) ||
      index >= total
    )
      throw new Error();
    if (!peer.incoming) {
      if (index !== 0) throw new Error();
      peer.incoming = { id, total, chunks: [], size: 0 };
      peer.receiving = setTimeout(
        () => this.closePeer(peer, 'An incomplete peer message timed out.'),
        10_000,
      );
    }
    const incoming = peer.incoming;
    if (incoming.id !== id || incoming.total !== total || incoming.chunks.length !== index)
      throw new Error();
    const part = new Uint8Array(data, 13);
    incoming.chunks.push(part);
    incoming.size += part.byteLength;
    if (incoming.size > MAX_MESSAGE) throw new Error();
    if (incoming.chunks.length !== total) return;
    clearTimeout(peer.receiving);
    peer.receiving = undefined;
    peer.incoming = undefined;
    const packet = new Uint8Array(incoming.size);
    let offset = 0;
    for (const chunk of incoming.chunks) {
      packet.set(chunk, offset);
      offset += chunk.byteLength;
    }
    this.apply(peer, packet);
  }

  private apply(peer: Peer, packet: Uint8Array) {
    const decoder = decoding.createDecoder(packet);
    const type = decoding.readVarUint(decoder);
    if (type === 0) {
      const response = encoding.createEncoder();
      encoding.writeVarUint(response, 0);
      const message = sync.readSyncMessage(decoder, response, this.doc, peer, () => {
        throw new Error('Invalid document update.');
      });
      if (encoding.length(response) > 1) this.send(peer, encoding.toUint8Array(response));
      if (message === sync.messageYjsSyncStep2) {
        this.synced = true;
        this.emit('sync', [true]);
      }
    } else if (type === 1) {
      const update = decoding.readVarUint8Array(decoder);
      if (this.role === 'host') {
        const awareness = decoding.createDecoder(update);
        const count = decoding.readVarUint(awareness);
        if (count !== 1 || decoding.readVarUint(awareness) !== peer.clientId) throw new Error();
        decoding.readVarUint(awareness); // established y-awareness clock
        const state = JSON.parse(decoding.readVarString(awareness));
        if (state !== null && (typeof state !== 'object' || Array.isArray(state)))
          throw new Error();
        if (decoding.hasContent(awareness)) throw new Error();
      }
      applyAwarenessUpdate(this.awareness, update, peer);
    } else throw new Error();
    if (decoding.hasContent(decoder)) throw new Error();
  }

  private attach(peer: Peer, channel: RTCDataChannel) {
    if (
      peer.channel ||
      channel.label !== 'veil.v1' ||
      !channel.ordered ||
      channel.maxRetransmits !== null ||
      channel.maxPacketLifeTime !== null
    ) {
      channel.close();
      return;
    }
    peer.channel = channel;
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = MAX_BUFFER / 2;
    channel.onbufferedamountlow = () => this.drain(peer);
    channel.onclose = () => this.closePeer(peer);
    channel.onerror = () =>
      this.closePeer(peer, 'Peer transport failed. Rejoin with a fresh invitation.');
    channel.onopen = () => {
      if (peer.closed) return;
      channel.send(
        JSON.stringify({
          type: 'veil.peer.hello',
          version: 1,
          sessionId: peer.code.sessionId,
          connectionId: peer.id,
          invite: peer.code.invite,
          clientId: this.doc.clientID,
        }),
      );
    };
    channel.onmessage = ({ data }: MessageEvent<unknown>) => {
      if (peer.closed) return;
      if (Date.now() - peer.window >= 1000) {
        peer.window = Date.now();
        peer.frames = 0;
      }
      if (++peer.frames > 600) {
        this.closePeer(peer, 'A peer exceeded the message-rate limit.');
        return;
      }
      try {
        if (!peer.authenticated) {
          if (typeof data !== 'string' || data.length > 4096) throw new Error();
          const hello = JSON.parse(data);
          if (
            hello.type !== 'veil.peer.hello' ||
            hello.version !== 1 ||
            hello.sessionId !== peer.code.sessionId ||
            hello.connectionId !== peer.id ||
            hello.invite !== peer.code.invite ||
            hello.clientId !== peer.clientId ||
            hello.clientId === this.doc.clientID
          )
            throw new Error();
          if (
            this.role === 'host' &&
            [...this.peers.values()].some(
              (other) => other !== peer && other.authenticated && other.clientId === hello.clientId,
            )
          )
            throw new Error();
          peer.authenticated = true;
          clearTimeout(peer.deadline);
          peer.deadline = undefined;
          this.status('connected');
          // Advance beyond a previous host-side awareness removal clock on rejoin.
          this.awareness.setLocalState(this.awareness.getLocalState());
          this.awareness.setLocalState(this.awareness.getLocalState());
          const initial = encoding.createEncoder();
          encoding.writeVarUint(initial, 0);
          sync.writeSyncStep1(initial, this.doc);
          this.send(peer, encoding.toUint8Array(initial));
          const presence = encoding.createEncoder();
          encoding.writeVarUint(presence, 1);
          encoding.writeVarUint8Array(
            presence,
            encodeAwarenessUpdate(
              this.awareness,
              this.role === 'host' ? [...this.awareness.getStates().keys()] : [this.doc.clientID],
            ),
          );
          this.send(peer, encoding.toUint8Array(presence));
          void this.measurePath(peer);
          this.changed();
        } else {
          if (!(data instanceof ArrayBuffer)) throw new Error();
          this.receive(peer, data);
        }
      } catch {
        this.closePeer(peer, 'A peer sent invalid or unauthenticated connection data.');
      }
    };
  }

  private async measurePath(peer: Peer) {
    try {
      const stats = await peer.pc.getStats();
      let pairId: string | undefined;
      stats.forEach((entry) => {
        if (entry.type === 'transport') pairId = entry.selectedCandidatePairId;
      });
      const pair = pairId ? stats.get(pairId) : undefined;
      if (pair) {
        const local = stats.get(pair.localCandidateId),
          remote = stats.get(pair.remoteCandidateId);
        peer.path =
          local?.candidateType === 'relay' || remote?.candidateType === 'relay'
            ? 'relay'
            : 'direct';
        this.changed();
      }
    } catch {
      /* Keep path explicitly unknown if WebView stats are unavailable. */
    }
  }

  private newPeer(code: PeerCode): Peer {
    if (this.destroyed) throw new Error('This peer session has ended.');
    const pc = new RTCPeerConnection({ iceServers: this.iceServers, bundlePolicy: 'max-bundle' });
    const peer: Peer = {
      id: code.connectionId,
      pc,
      code,
      authenticated: false,
      closed: false,
      answerAccepted: false,
      path: 'checking',
      queue: [],
      queuedBytes: 0,
      sequence: 0,
      frames: 0,
      window: Date.now(),
    };
    this.peers.set(peer.id, peer);
    peer.deadline = setTimeout(
      () =>
        this.closePeer(
          peer,
          'An invitation expired before a peer joined. Generate a fresh invitation.',
        ),
      Math.max(0, code.expiresAt - Date.now()),
    );
    pc.ondatachannel = ({ channel }) => this.attach(peer, channel);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed')
        this.closePeer(
          peer,
          'No working peer connection. Try a fresh invitation, or configure your own STUN/TURN server under Network options.',
        );
      if (pc.connectionState === 'disconnected')
        peer.disconnected ??= setTimeout(
          () =>
            this.closePeer(peer, 'The peer connection was lost. Rejoin with a fresh invitation.'),
          10_000,
        );
      if (pc.connectionState === 'connected') {
        clearTimeout(peer.disconnected);
        peer.disconnected = undefined;
        void this.measurePath(peer);
      }
    };
    this.changed();
    return peer;
  }

  async createInvitation(): Promise<string> {
    if (this.role !== 'host' || !this.sessionId)
      throw new Error('Only the host creates invitations.');
    // A fresh pending code replaces unused invitations, without limiting connected peers.
    for (const peer of [...this.peers.values()])
      if (!peer.authenticated && !peer.answerAccepted) this.closePeer(peer);
    const code: PeerCode = {
      version: 1,
      kind: 'offer',
      sessionId: this.sessionId,
      connectionId: randomHex(16),
      invite: randomHex(32),
      clientId: this.doc.clientID,
      expiresAt: Date.now() + PEER_INVITE_LIFETIME,
      sdp: '',
    };
    const peer = this.newPeer(code);
    try {
      this.attach(peer, peer.pc.createDataChannel('veil.v1', { ordered: true }));
      await peer.pc.setLocalDescription(await peer.pc.createOffer());
      await gatherIce(peer.pc);
      if (peer.closed || !peer.pc.localDescription?.sdp.includes('a=candidate:'))
        throw new Error('No usable connection addresses were found.');
      code.sdp = peer.pc.localDescription.sdp;
      return encodePeerCode(code);
    } catch (error) {
      this.closePeer(peer);
      throw error;
    }
  }

  async answerInvitation(invitation: string): Promise<string> {
    if (this.role !== 'guest') throw new Error('Only a guest answers an invitation.');
    const code = decodePeerCode(invitation, 'offer');
    if (code.clientId === this.doc.clientID)
      throw new Error('Peer identities collided. Start a fresh guest session.');
    if (this.sessionId && this.sessionId !== code.sessionId)
      throw new Error('Leave this session before joining a different document.');
    for (const peer of [...this.peers.values()]) this.closePeer(peer);
    this.sessionId = code.sessionId;
    this.shouldConnect = true;
    this.status('connecting');
    const peer = this.newPeer(code);
    peer.clientId = code.clientId;
    peer.answerAccepted = true;
    try {
      await peer.pc.setRemoteDescription({ type: 'offer', sdp: code.sdp });
      await peer.pc.setLocalDescription(await peer.pc.createAnswer());
      await gatherIce(peer.pc);
      if (peer.closed || !peer.pc.localDescription?.sdp.includes('a=candidate:'))
        throw new Error('No usable connection addresses were found.');
      // The guest waits for the host to paste this answer; the offer expiry applies meanwhile.
      return encodePeerCode({
        ...code,
        kind: 'answer',
        clientId: this.doc.clientID,
        sdp: peer.pc.localDescription.sdp,
      });
    } catch (error) {
      this.closePeer(peer);
      throw error;
    }
  }

  async acceptResponse(response: string): Promise<void> {
    if (this.role !== 'host') throw new Error('Only the host accepts a guest response.');
    const code = decodePeerCode(response, 'answer');
    const peer = this.peers.get(code.connectionId);
    if (
      !peer ||
      peer.answerAccepted ||
      code.sessionId !== this.sessionId ||
      code.invite !== peer.code.invite ||
      code.expiresAt !== peer.code.expiresAt
    )
      throw new Error('This response does not match the current invitation.');
    if (
      code.clientId === this.doc.clientID ||
      [...this.peers.values()].some((other) => other.clientId === code.clientId)
    )
      throw new Error('This peer identity is already connected. Start a fresh guest session.');
    peer.clientId = code.clientId;
    peer.answerAccepted = true;
    try {
      await peer.pc.setRemoteDescription({ type: 'answer', sdp: code.sdp });
      clearTimeout(peer.deadline);
      peer.deadline = setTimeout(
        () =>
          this.closePeer(
            peer,
            'Connection timed out. Check both networks or configure a self-hosted relay.',
          ),
        30_000,
      );
      this.changed();
    } catch (error) {
      this.closePeer(peer);
      throw error;
    }
  }

  private closePeer(peer: Peer, message?: string) {
    if (peer.closed) return;
    peer.closed = true;
    this.peers.delete(peer.id);
    for (const timer of [peer.deadline, peer.stalled, peer.disconnected, peer.receiving])
      clearTimeout(timer);
    peer.queue = [];
    peer.queuedBytes = 0;
    peer.incoming = undefined;
    peer.channel?.close();
    peer.pc.close();
    if (peer.authenticated && peer.clientId !== undefined)
      removeAwarenessStates(this.awareness, [peer.clientId], networkOrigin);
    if (this.role === 'guest') {
      removeAwarenessStates(
        this.awareness,
        [...this.awareness.getStates().keys()].filter((id) => id !== this.doc.clientID),
        networkOrigin,
      );
      this.status('disconnected');
    }
    if (message && !this.destroyed) this.emit('error', [message]);
    this.changed();
  }

  connect() {
    this.shouldConnect = true;
    this.status(this.role === 'host' ? 'connected' : 'connecting');
    if (this.role === 'host') {
      this.synced = true;
      this.emit('sync', [true]);
    }
  }
  disconnect() {
    this.shouldConnect = false;
    for (const peer of [...this.peers.values()]) this.closePeer(peer);
    this.status('disconnected');
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.disconnect();
    this.doc.off('update', this.documentChanged);
    this.awareness.off('update', this.awarenessChanged);
    this.awareness.destroy();
    super.destroy();
  }
}

export interface PeerSession extends DemoConnection {
  provider: PeerProvider;
}
export function createPeerSession(
  role: 'host' | 'guest',
  name: string,
  iceServers: RTCIceServer[] = [],
): PeerSession {
  if (typeof RTCPeerConnection === 'undefined')
    throw new Error('This WebView does not support peer connections. Update WebView2.');
  const doc = new Y.Doc();
  const provider = new PeerProvider(doc, role, name, iceServers);
  return {
    doc,
    provider,
    destroy() {
      provider.destroy();
      doc.destroy();
    },
  };
}
