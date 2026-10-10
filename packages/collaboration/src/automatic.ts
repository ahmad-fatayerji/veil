import {
  DIRECT_TIMEOUT_MS,
  RELAY_TIMEOUT_MS,
  SignalCipher,
  invitationKeys,
  randomSecret,
  sha256,
  encodeServerInvitation,
  decodeServerInvitation,
  normalizeServer,
  type ServerInvitation,
  type SignalEnvelope,
  type PeerCode,
  createShareIdentity,
  createExchange,
  decodeShareLink,
  encodeShareLink,
  linkInvitation,
  shareAdmission,
  signHandshake,
  verifyHandshake,
  establishLink,
  newShareId,
  type ShareInvitation,
  type ShareHandshake,
} from '@veil/protocol';
import { createPeerSession, type PeerSession, type AutomaticCallbacks } from './peer';

export interface SignalingTransport {
  request: (
    server: string,
    path: string,
    method: string,
    body: unknown,
    ticket?: string,
  ) => Promise<unknown>;
  connect: (
    server: string,
    sessionId: string,
    ticket: string,
    receive: (message: unknown) => void,
  ) => Promise<void>;
  send: (message: SignalEnvelope) => Promise<void>;
  disconnect: () => Promise<void>;
}
interface RelayServer extends RTCIceServer {
  expiresAt: number;
}
interface Link {
  invite: ServerInvitation;
  cipher: SignalCipher;
  remoteId?: number;
  generation: number;
  connectionId?: string;
  previous?: string;
  phase: 'direct' | 'relay';
  ready: boolean;
  migrating: boolean;
  retryCount: number;
  lastMigration: number;
  timer?: ReturnType<typeof setTimeout>;
  refresh?: ReturnType<typeof setTimeout>;
  candidates: RTCIceCandidateInit[];
}
interface GroupBootstrap {
  group: ShareInvitation;
  cipher: SignalCipher;
  exchange: Awaited<ReturnType<typeof createExchange>>;
  remoteId: number;
  handshake?: ShareHandshake;
  signature?: string;
}
interface Signal {
  kind: 'offer' | 'answer' | 'candidate' | 'request' | 'cancel';
  phase?: 'direct' | 'relay';
  connectionId?: string;
  clientId?: number;
  sdp?: string;
  candidate?: RTCIceCandidateInit;
  migrate?: boolean;
  restart?: boolean;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid server response.');
  return value as Record<string, unknown>;
}
function token(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    throw new Error('Invalid server authorization.');
  return value;
}
function identity(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{32}$/.test(value))
    throw new Error('Invalid server identity.');
  return value;
}
function stunServers(value: unknown): RTCIceServer[] {
  if (
    !Array.isArray(value) ||
    value.length > 8 ||
    value.some((v) => typeof v !== 'string' || !/^stuns?:[^\s@/]+$/.test(v))
  )
    throw new Error('Invalid discovery configuration.');
  return value.length ? [{ urls: value as string[] }] : [];
}
function validateSdp(sdp: unknown): string {
  if (
    typeof sdp !== 'string' ||
    sdp.length > 64 * 1024 ||
    !sdp.startsWith('v=0\r\n') ||
    !/^a=fingerprint:sha-256 (?:[0-9A-F]{2}:){31}[0-9A-F]{2}\r?$/im.test(sdp) ||
    !sdp.includes('m=application ') ||
    !sdp.includes('a=sctp-port:')
  )
    throw new Error('Invalid authenticated WebRTC description.');
  return sdp;
}

/** One controller per document; each host/guest link negotiates independently. */
export class AutomaticSession {
  readonly session: PeerSession;
  private links = new Map<string, Link>();
  private groups = new Map<string, { invite: ShareInvitation; signingKey: CryptoKey }>();
  private bootstraps = new Map<string, GroupBootstrap>();
  private sharingLink = '';
  private groupGuestId?: string;
  get sharedLink() {
    return this.sharingLink;
  }
  get serviceOnline() {
    return this.socketOnline && !this.ended;
  }
  get sessionEnded() {
    return this.ended;
  }
  private ticket = '';
  private sessionId = '';
  private discovery: RTCIceServer[] = [];
  private stopped = false;
  private ended = false;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private socketAttempts = 0;
  private input = Promise.resolve();
  private output = Promise.resolve();
  private socketOnline = false;
  private connectivity?: EventTarget;
  private telemetry?: ReturnType<typeof setInterval>;
  constructor(
    readonly role: 'host' | 'guest',
    readonly server: string,
    name: string,
    private transport: SignalingTransport,
    private notice: (message: string) => void,
    existingSession?: PeerSession,
  ) {
    this.session = existingSession ?? createPeerSession(role, name);
    this.connectivity = (navigator as Navigator & { connection?: EventTarget }).connection;
    this.connectivity?.addEventListener('change', this.networkChanged);
    window.addEventListener('online', this.networkChanged);
    this.telemetry = setInterval(() => {
      void this.reportPaths();
    }, 30_000);
  }
  private async request(path: string, body: unknown = {}, method = 'POST') {
    return record(
      await this.transport.request(this.server, path, method, body, this.ticket || undefined),
    );
  }
  async startHost() {
    const data = await this.request('/v2/sessions', { clientId: this.session.doc.clientID });
    this.ticket = token(data.ticket);
    this.sessionId = identity(data.sessionId);
    this.session.provider.sessionId = this.sessionId;
    this.discovery = stunServers(data.stunUrls);
    await this.openSocket();
    this.session.provider.connect();
  }
  async startGuest(invite: ServerInvitation) {
    const keys = await invitationKeys(invite);
    const data = await this.request('/v2/join', {
      sessionId: invite.sessionId,
      inviteId: invite.inviteId,
      admission: keys.admission,
      clientId: this.session.doc.clientID,
    });
    if (data.hostClientId !== invite.hostClientId)
      throw new Error('Server substituted the invited host identity.');
    this.ticket = token(data.ticket);
    this.sessionId = invite.sessionId;
    this.session.provider.sessionId = this.sessionId;
    this.discovery = stunServers(data.stunUrls);
    this.links.set(invite.inviteId, this.link(invite, keys, invite.hostClientId));
    await this.openSocket();
    await this.send(this.links.get(invite.inviteId)!, {
      kind: 'request',
      clientId: this.session.doc.clientID,
    });
  }
  private link(
    invite: ServerInvitation,
    keys: Awaited<ReturnType<typeof invitationKeys>>,
    remoteId?: number,
  ): Link {
    return {
      invite,
      cipher: new SignalCipher(invite, keys),
      remoteId,
      generation: 0,
      phase: 'direct',
      ready: false,
      migrating: false,
      retryCount: 0,
      lastMigration: 0,
      candidates: [],
    };
  }
  async createInvitation(): Promise<string> {
    if (this.role !== 'host' || this.stopped || this.ended)
      throw new Error('Only an active host creates invitations.');
    const invite: ServerInvitation = {
      version: 2,
      server: this.server,
      sessionId: this.sessionId,
      inviteId: randomSecret(16),
      secret: randomSecret(),
      hostClientId: this.session.doc.clientID,
      expiresAt: Date.now() + 600_000,
    };
    const keys = await invitationKeys(invite);
    await this.request(`/v2/sessions/${this.sessionId}/invitations`, {
      inviteId: invite.inviteId,
      admissionHash: await sha256(keys.admission),
      expiresAt: invite.expiresAt,
    });
    this.links.set(invite.inviteId, this.link(invite, keys));
    // Bound unused local invitation state; connected participants have no count cap.
    for (const [id, link] of this.links)
      if (link.remoteId === undefined && link.invite.expiresAt < Date.now()) this.links.delete(id);
    return encodeServerInvitation(invite);
  }
  async enableSharing(reset = false): Promise<string> {
    if (this.role !== 'host' || this.stopped || this.ended)
      throw new Error('Only an active host can share.');
    if (this.sharingLink && !reset) return this.sharingLink;
    const capabilities = await this.request('/v2/capabilities', {}, 'GET');
    if (capabilities.groupSharing !== 1)
      throw new Error(
        'This server needs an update to support reusable sharing links. Update the server, then retry.',
      );
    const signing = await createShareIdentity();
    const invite: ShareInvitation = {
      version: 4,
      server: this.server,
      sessionId: this.sessionId,
      groupId: newShareId(),
      secret: randomSecret(),
      hostClientId: this.session.doc.clientID,
      hostPublic: signing.publicKey,
    };
    // Store before registration so an immediately admitted guest finds its key.
    this.groups.set(invite.groupId, { invite, signingKey: signing.privateKey });
    try {
      await this.request(`/v3/sessions/${this.sessionId}/sharing`, {
        groupId: invite.groupId,
        admissionHash: await sha256(await shareAdmission(invite)),
      });
    } catch (error) {
      this.groups.delete(invite.groupId);
      throw error;
    }
    this.sharingLink = encodeShareLink(invite);
    return this.sharingLink;
  }
  async stopSharing() {
    await this.request(`/v3/sessions/${this.sessionId}/sharing`, {}, 'DELETE');
    this.sharingLink = '';
  }
  async startGroupGuest(group: ShareInvitation) {
    const inviteId = newShareId();
    const exchange = await createExchange();
    const data = await this.request('/v3/join', {
      sessionId: group.sessionId,
      groupId: group.groupId,
      admission: await shareAdmission(group),
      inviteId,
      clientId: this.session.doc.clientID,
      guestPublic: exchange.publicKey,
    });
    if (data.hostClientId !== group.hostClientId)
      throw new Error('Server substituted the invited host identity.');
    this.ticket = token(data.ticket);
    this.sessionId = group.sessionId;
    this.session.provider.sessionId = this.sessionId;
    this.discovery = stunServers(data.stunUrls);
    const invite = linkInvitation(group, inviteId);
    this.bootstraps.set(inviteId, {
      group,
      cipher: new SignalCipher(invite, await invitationKeys(invite)),
      exchange,
      remoteId: group.hostClientId,
    });
    this.groupGuestId = inviteId;
    await this.openSocket();
  }
  private async bootstrapSend(id: string, payload: unknown) {
    const bootstrap = this.bootstraps.get(id);
    if (!bootstrap) return;
    const envelope = await bootstrap.cipher.seal(this.role, 0, payload);
    await this.transport.send({ ...envelope, bootstrap: true });
  }
  private async admitGroup(message: Record<string, unknown>) {
    const id = identity(message.inviteId),
      groupId = identity(message.groupId);
    if (this.bootstraps.has(id) || this.links.has(id)) return;
    const group = this.groups.get(groupId);
    if (
      !group ||
      !Number.isInteger(message.clientId) ||
      (message.clientId as number) < 0 ||
      (message.clientId as number) > 0xffffffff ||
      message.clientId === this.session.doc.clientID ||
      typeof message.guestPublic !== 'string'
    )
      throw new Error('Invalid group admission.');
    const exchange = await createExchange();
    const handshake: ShareHandshake = {
      version: 1,
      sessionId: this.sessionId,
      groupId,
      inviteId: id,
      hostClientId: this.session.doc.clientID,
      guestClientId: message.clientId as number,
      guestPublic: message.guestPublic,
      hostExchange: exchange.publicKey,
    };
    const established = await establishLink(
      group.invite,
      handshake,
      exchange.privateKey,
      handshake.guestPublic,
    );
    this.links.set(id, this.link(established.invite, established.keys, handshake.guestClientId));
    const invite = linkInvitation(group.invite, id);
    this.bootstraps.set(id, {
      group: group.invite,
      cipher: new SignalCipher(invite, await invitationKeys(invite)),
      exchange,
      remoteId: handshake.guestClientId,
      handshake,
      signature: await signHandshake(group.signingKey, handshake),
    });
    await this.bootstrapSend(id, { handshake, signature: this.bootstraps.get(id)!.signature });
  }
  private async receiveBootstrap(envelope: SignalEnvelope) {
    const bootstrap = this.bootstraps.get(envelope.inviteId);
    if (!bootstrap || envelope.generation !== 0) return;
    const payload = record(
      await bootstrap.cipher.open(envelope, this.role === 'host' ? 'guest' : 'host'),
    );
    if (this.role === 'host') {
      if (payload.clientId !== bootstrap.remoteId || payload.kind !== 'handshake')
        throw new Error('Invalid handshake request.');
      await this.bootstrapSend(envelope.inviteId, {
        handshake: bootstrap.handshake,
        signature: bootstrap.signature,
      });
      return;
    }
    if (this.links.has(envelope.inviteId)) return;
    const received = record(payload.handshake);
    if (typeof received.hostExchange !== 'string' || typeof payload.signature !== 'string')
      throw new Error('Invalid host handshake.');
    // Reconstruct the canonical transcript from locally expected identities/keys.
    const handshake: ShareHandshake = {
      version: 1,
      sessionId: this.sessionId,
      groupId: bootstrap.group.groupId,
      inviteId: envelope.inviteId,
      hostClientId: bootstrap.remoteId,
      guestClientId: this.session.doc.clientID,
      guestPublic: bootstrap.exchange.publicKey,
      hostExchange: received.hostExchange,
    };
    await verifyHandshake(bootstrap.group, handshake, payload.signature);
    const established = await establishLink(
      bootstrap.group,
      handshake,
      bootstrap.exchange.privateKey,
      handshake.hostExchange,
    );
    const link = this.link(established.invite, established.keys, bootstrap.remoteId);
    this.links.set(envelope.inviteId, link);
    await this.send(link, { kind: 'request', clientId: this.session.doc.clientID });
  }
  private async openSocket() {
    this.socketOnline = true;
    try {
      await this.transport.connect(this.server, this.sessionId, this.ticket, (message) => {
        this.input = this.input
          .then(() => this.receive(message))
          .catch((error: unknown) =>
            this.notice(error instanceof Error ? error.message : 'Invalid signaling.'),
          );
      });
    } catch (error) {
      this.socketOnline = false;
      throw error;
    }
    this.socketAttempts = 0;
  }
  private async send(link: Link, signal: Signal) {
    const generation = link.generation;
    const operation = this.output.then(async () => {
      if (this.stopped || this.ended) return;
      if (!this.socketOnline)
        throw new Error('Signaling is unavailable; pending document edits remain local.');
      await this.transport.send(await link.cipher.seal(this.role, generation, signal));
    });
    this.output = operation.catch(() => {});
    return operation;
  }
  private async receive(value: unknown) {
    if (this.stopped || this.ended) return;
    const message = record(value);
    if (message.kind === 'ended') {
      this.ended = true;
      this.stopTimers();
      this.session.provider.disconnect();
      this.notice(
        'The server session ended or restarted. Your local document remains available to copy.',
      );
      return;
    }
    if (message.kind === 'disconnected') {
      this.socketOnline = false;
      this.notice(
        'Signaling disconnected. Healthy peer connections continue; reconnecting automatically.',
      );
      this.scheduleSocket();
      return;
    }
    if (message.kind === 'ready') {
      if (this.groupGuestId && !this.links.has(this.groupGuestId))
        await this.bootstrapSend(this.groupGuestId, {
          kind: 'handshake',
          clientId: this.session.doc.clientID,
        });
      if (this.role === 'guest')
        for (const link of this.links.values())
          await this.send(link, { kind: 'request', clientId: this.session.doc.clientID });
      return;
    }
    if (message.kind === 'replaced') return;
    if (message.kind === 'left' && this.role === 'host') {
      const link = this.links.get(identity(message.inviteId));
      if (link) {
        clearTimeout(link.timer);
        clearTimeout(link.refresh);
        if (link.connectionId) this.session.provider.automaticClose(link.connectionId);
        if (link.previous) this.session.provider.automaticClose(link.previous);
        this.links.delete(link.invite.inviteId);
        this.bootstraps.delete(link.invite.inviteId);
      }
      return;
    }
    if (message.kind === 'admitted' && this.role === 'host') {
      if (message.groupId) {
        await this.admitGroup(message);
        return;
      }
      const link = this.links.get(identity(message.inviteId));
      if (!link) return;
      if (
        !Number.isSafeInteger(message.clientId) ||
        (message.clientId as number) < 0 ||
        (message.clientId as number) > 0xffffffff
      )
        throw new Error('Invalid guest identity.');
      if (link.remoteId !== undefined && link.remoteId !== message.clientId)
        throw new Error('Server substituted the admitted participant.');
      link.remoteId = message.clientId as number;
      return;
    }
    if (message.kind !== 'signal') return;
    const envelope = record(message.envelope) as unknown as SignalEnvelope;
    if (envelope.bootstrap) {
      await this.receiveBootstrap(envelope);
      return;
    }
    const link = this.links.get(envelope.inviteId);
    if (!link) return;
    const payload = record(
      await link.cipher.open(envelope, this.role === 'host' ? 'guest' : 'host'),
    ) as unknown as Signal;
    if (payload.kind === 'request' && this.role === 'host') {
      if (payload.restart && envelope.generation !== link.generation) return;
      if (payload.clientId !== link.remoteId)
        throw new Error('Guest identity does not match authenticated signaling.');
      if (payload.migrate) {
        await this.migrate(link);
      } else if (payload.restart || (!link.ready && !link.connectionId))
        await this.begin(link, 'direct');
      return;
    }
    if (payload.kind === 'offer' && this.role === 'guest') {
      if (
        envelope.generation <= link.generation ||
        payload.clientId !== link.invite.hostClientId ||
        !['direct', 'relay'].includes(payload.phase ?? '')
      )
        throw new Error('Obsolete or invalid peer negotiation.');
      const connectionId = identity(payload.connectionId),
        sdp = validateSdp(payload.sdp);
      clearTimeout(link.timer);
      clearTimeout(link.refresh);
      const previous = link.connectionId;
      if (previous && (!link.ready || !payload.migrate))
        this.session.provider.automaticClose(previous);
      link.previous = link.ready && payload.migrate ? previous : undefined;
      link.generation = envelope.generation;
      link.connectionId = connectionId;
      link.phase = payload.phase!;
      link.migrating = Boolean(payload.migrate);
      link.ready = false;
      this.notice(
        link.phase === 'relay' ? 'Trying a relay' + '\u2026' : 'Connecting to host' + '\u2026',
      );
      const servers = await this.servers(link);
      const pending: RTCIceCandidateInit[] = [];
      let announced = false;
      const callbacks = this.callbacks(link, connectionId, (candidate) => {
        if (announced) void this.sendCandidate(link, connectionId, candidate);
        else pending.push(candidate);
      });
      const answer = await this.session.provider.automaticAnswer(
        this.code(link, connectionId, sdp),
        link.remoteId!,
        servers,
        callbacks,
      );
      await this.send(link, {
        kind: 'answer',
        connectionId,
        clientId: this.session.doc.clientID,
        sdp: answer,
      });
      announced = true;
      for (const candidate of pending) await this.sendCandidate(link, connectionId, candidate);
      return;
    }
    if (envelope.generation !== link.generation || payload.connectionId !== link.connectionId)
      return;
    if (payload.kind === 'answer' && this.role === 'host') {
      if (payload.clientId !== link.remoteId)
        throw new Error('Authenticated guest identity changed.');
      await this.session.provider.automaticAccept(link.connectionId!, validateSdp(payload.sdp));
    } else if (payload.kind === 'candidate') {
      if (
        !payload.candidate ||
        typeof payload.candidate.candidate !== 'string' ||
        payload.candidate.candidate.length > 4096
      )
        throw new Error('Invalid ICE candidate.');
      await this.session.provider.automaticCandidate(link.connectionId!, payload.candidate);
    } else if (payload.kind === 'cancel') {
      this.cancelMigration(link);
    }
  }
  private code(link: Link, connectionId: string, sdp = ''): PeerCode {
    return {
      version: 1,
      kind: 'offer',
      sessionId: this.sessionId,
      connectionId,
      invite: link.invite.secret,
      clientId: link.invite.hostClientId,
      expiresAt: Date.now() + 600_000,
      sdp,
    };
  }
  private async servers(link: Link): Promise<RTCIceServer[]> {
    if (link.phase === 'direct') return this.discovery;
    const value = await this.request('/v2/relay', {
      sessionId: this.sessionId,
      inviteId: link.invite.inviteId,
    });
    if (
      !Array.isArray(value.urls) ||
      value.urls.length > 8 ||
      value.urls.some(
        (url) =>
          typeof url !== 'string' || !/^turns?:[^\s@/]+(?:\?transport=(?:udp|tcp))?$/.test(url),
      ) ||
      typeof value.username !== 'string' ||
      value.username.length > 256 ||
      typeof value.credential !== 'string' ||
      value.credential.length > 256 ||
      !Number.isSafeInteger(value.expiresAt) ||
      (value.expiresAt as number) <= Date.now()
    )
      throw new Error('Invalid relay configuration.');
    const relay = value as unknown as RelayServer;
    return [
      ...this.discovery,
      { urls: relay.urls, username: relay.username, credential: relay.credential },
    ];
  }
  private async begin(link: Link, phase: Link['phase'], migrate = false) {
    if (this.stopped || this.ended || this.role !== 'host' || link.remoteId === undefined) return;
    clearTimeout(link.timer);
    clearTimeout(link.refresh);
    const previous = link.connectionId;
    if (previous && (!link.ready || !migrate)) this.session.provider.automaticClose(previous);
    link.previous = link.ready && migrate ? previous : undefined;
    link.migrating = migrate;
    link.phase = phase;
    this.notice(phase === 'relay' ? 'Trying a relay' + '\u2026' : 'Connecting directly' + '\u2026');
    link.ready = false;
    link.generation++;
    const connectionId = randomSecret(16);
    link.connectionId = connectionId;
    const generation = link.generation;
    if (phase === 'relay')
      link.timer = setTimeout(() => {
        void this.failed(link, connectionId);
      }, RELAY_TIMEOUT_MS);
    try {
      const servers = await this.servers(link);
      if (this.stopped || link.generation !== generation || link.connectionId !== connectionId)
        return;
      const pending: RTCIceCandidateInit[] = [];
      let announced = false;
      const callbacks = this.callbacks(link, connectionId, (candidate) => {
        if (announced) void this.sendCandidate(link, connectionId, candidate);
        else pending.push(candidate);
      });
      // Start the direct deadline only after admission and configuration, at negotiation.
      if (phase === 'direct')
        link.timer = setTimeout(() => {
          void this.failed(link, connectionId);
        }, DIRECT_TIMEOUT_MS);
      const offer = await this.session.provider.automaticOffer(
        this.code(link, connectionId),
        link.remoteId,
        servers,
        callbacks,
      );
      await this.send(link, {
        kind: 'offer',
        phase,
        connectionId,
        clientId: this.session.doc.clientID,
        sdp: offer,
        migrate,
      });
      announced = true;
      for (const candidate of pending) await this.sendCandidate(link, connectionId, candidate);
    } catch (error) {
      if (link.generation !== generation || this.stopped) return;
      if (link.previous) {
        this.cancelMigration(link);
        this.notice('Replacement connection failed; the existing relay remains active.');
        return;
      }
      this.session.provider.automaticClose(connectionId);
      link.connectionId = undefined;
      this.notice(error instanceof Error ? error.message : 'Connection setup failed.');
      this.schedulePeer(link);
    }
  }
  private async sendCandidate(link: Link, connectionId: string, candidate: RTCIceCandidateInit) {
    if (link.connectionId !== connectionId || this.stopped) return;
    try {
      await this.send(link, { kind: 'candidate', connectionId, candidate });
    } catch {
      this.notice(
        'Signaling is unavailable. Connection recovery will resume when the server returns.',
      );
    }
  }
  private callbacks(
    link: Link,
    connectionId: string,
    candidate: AutomaticCallbacks['candidate'],
  ): AutomaticCallbacks {
    return {
      candidate,
      failed: () => {
        if (link.connectionId === connectionId) void this.failed(link, connectionId);
      },
      authenticated: () => {
        this.notice('Synchronizing' + '\u2026');
        if (link.connectionId === connectionId) {
          clearTimeout(link.timer);
          link.timer = setTimeout(() => {
            void this.failed(link, connectionId);
          }, 30_000);
        }
      },
      synced: () => {
        if (link.connectionId !== connectionId) return;
        clearTimeout(link.timer);
        link.timer = undefined;
        link.ready = true;
        link.retryCount = 0;
        if (link.previous) this.session.provider.automaticClose(link.previous);
        link.previous = undefined;
        link.migrating = false;
        this.refreshRelay(link);
        this.notice('Connected.');
        setTimeout(() => {
          void this.reportPaths();
        }, 1500);
      },
    };
  }
  private async failed(link: Link, connectionId: string) {
    if (this.stopped || this.ended || link.connectionId !== connectionId) return;
    clearTimeout(link.timer);
    if (this.role === 'guest') {
      if (link.migrating && link.previous) {
        try {
          await this.send(link, { kind: 'cancel', connectionId });
        } catch {
          this.notice('Signaling unavailable; the existing relay remains active.');
        } finally {
          this.cancelMigration(link);
        }
        return;
      }
      this.session.provider.automaticClose(connectionId);
      link.connectionId = undefined;
      link.ready = false;
      try {
        await this.send(link, {
          kind: 'request',
          clientId: this.session.doc.clientID,
          restart: true,
        });
      } catch {
        /* Socket recovery retries admission-bound negotiation. */
      }
      return;
    }
    if (link.migrating && link.previous) {
      try {
        await this.send(link, { kind: 'cancel', connectionId });
      } catch {
        this.notice('Signaling unavailable; the existing relay remains active.');
      } finally {
        this.cancelMigration(link);
      }
      return;
    }
    const wasReady = link.ready;
    link.ready = false;
    if (!wasReady && link.phase === 'direct') {
      await this.begin(link, 'relay');
      return;
    }
    this.session.provider.automaticClose(connectionId);
    link.connectionId = undefined;
    if (wasReady) await this.begin(link, 'direct');
    else {
      this.notice('No working connection or relay capacity available. Unsent edits remain local.');
      this.schedulePeer(link);
    }
  }
  private cancelMigration(link: Link) {
    if (link.connectionId) this.session.provider.automaticClose(link.connectionId);
    link.connectionId = link.previous;
    link.previous = undefined;
    link.ready = Boolean(link.connectionId);
    link.migrating = false;
    link.phase = 'relay';
    clearTimeout(link.timer);
    this.refreshRelay(link);
  }
  private schedulePeer(link: Link) {
    clearTimeout(link.timer);
    if (this.stopped || this.ended || ++link.retryCount > 5) return;
    link.timer = setTimeout(
      () => {
        if (this.socketOnline) void this.begin(link, 'direct');
      },
      Math.min(30_000, 1000 * 2 ** link.retryCount),
    );
  }
  private scheduleSocket() {
    if (this.stopped || this.ended || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(
      () => {
        this.reconnectTimer = undefined;
        void this.openSocket().catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          if (/authorization|rejected/i.test(message)) {
            this.ended = true;
            this.stopTimers();
            this.session.provider.disconnect();
            this.notice(
              'Session authorization is no longer valid. Keep this document open to copy unsaved content.',
            );
          } else {
            this.socketAttempts++;
            this.scheduleSocket();
          }
        });
      },
      Math.min(30_000, 1000 * 2 ** Math.min(this.socketAttempts, 5)),
    );
  }
  private refreshRelay(link: Link) {
    clearTimeout(link.refresh);
    if (!link.ready || link.phase !== 'relay' || this.stopped) return;
    link.refresh = setTimeout(() => {
      // Refresh credentials only if the actual selected path uses TURN.
      if (
        !this.session.provider
          .summaries()
          .some((p) => p.id === link.connectionId && p.path === 'relay')
      )
        return;
      // Renew with a new authenticated transport; setConfiguration alone does not
      // replace the credentials used by an existing TURN allocation.
      if (this.role !== 'host') return;
      void this.begin(link, 'relay', true).catch(() =>
        this.notice(
          'Relay credential renewal failed; existing allocations may continue until expiry.',
        ),
      );
    }, 480_000);
  }
  private async migrate(link: Link) {
    if (!link.ready || link.phase !== 'relay' || Date.now() - link.lastMigration < 300_000) return;
    link.lastMigration = Date.now();
    await this.begin(link, 'direct', true);
  }
  private networkChanged = () => {
    void this.reconnect().catch(() =>
      this.notice('Signaling unavailable; retrying when it returns.'),
    );
  };
  async reconnect() {
    if (this.stopped || this.ended) return;
    for (const link of this.links.values()) {
      if (this.role === 'host') {
        if (link.ready) await this.migrate(link);
        else if (link.remoteId !== undefined) {
          link.retryCount = 0;
          await this.begin(link, 'direct');
        }
      } else
        await this.send(link, {
          kind: 'request',
          clientId: this.session.doc.clientID,
          migrate: link.ready,
        });
    }
  }
  private stopTimers() {
    clearInterval(this.telemetry);
    clearTimeout(this.reconnectTimer);
    for (const link of this.links.values()) {
      clearTimeout(link.timer);
      clearTimeout(link.refresh);
    }
  }
  private async reportPaths() {
    if (this.role !== 'host' || this.stopped || this.ended || !this.socketOnline) return;
    const summaries = this.session.provider.summaries();
    for (const link of this.links.values()) {
      if (link.remoteId === undefined) continue;
      const path = summaries.find((peer) => peer.id === link.connectionId)?.path ?? 'checking';
      try {
        await this.request('/v2/path', {
          sessionId: this.sessionId,
          inviteId: link.invite.inviteId,
          path,
        });
      } catch {
        /* Optional operator telemetry cannot interrupt document links. */
      }
    }
  }
  async close(preserveDocument = false) {
    if (this.stopped) return;
    this.stopped = true;
    this.stopTimers();
    this.connectivity?.removeEventListener('change', this.networkChanged);
    window.removeEventListener('online', this.networkChanged);
    if (this.role === 'host' && this.sessionId && !this.ended) {
      try {
        await this.request(`/v2/sessions/${this.sessionId}`, {}, 'DELETE');
      } catch {
        /* Server expires abandoned session registrations. */
      }
    } else if (this.role === 'guest' && this.sessionId && !this.ended) {
      for (const inviteId of new Set([...this.links.keys(), ...this.bootstraps.keys()])) {
        try {
          await this.request('/v2/leave', {
            sessionId: this.sessionId,
            inviteId,
          });
        } catch {
          /* Closing local transports still releases allocations. */
        }
      }
    }
    try {
      await this.transport.disconnect();
    } finally {
      if (!preserveDocument) this.session.destroy();
      this.links.clear();
      this.bootstraps.clear();
      this.groups.clear();
    }
  }
}
export async function hostAutomatic(
  server: string,
  name: string,
  transport: SignalingTransport,
  notice: (message: string) => void,
  development = false,
) {
  const current = new AutomaticSession(
    'host',
    normalizeServer(server, development),
    name,
    transport,
    notice,
  );
  try {
    await current.startHost();
    return current;
  } catch (error) {
    await current.close();
    throw error;
  }
}
export async function joinAutomatic(
  code: string,
  name: string,
  transport: SignalingTransport,
  notice: (message: string) => void,
  development = false,
) {
  const invite = decodeServerInvitation(code.trim(), development);
  const current = new AutomaticSession('guest', invite.server, name, transport, notice);
  try {
    await current.startGuest(invite);
    return current;
  } catch (error) {
    await current.close();
    throw error;
  }
}

/** Attach sharing to a document that already exists. Failure does not own it. */
export async function shareDocument(
  session: PeerSession,
  server: string,
  name: string,
  transport: SignalingTransport,
  notice: (message: string) => void,
  development = false,
) {
  const current = new AutomaticSession(
    'host',
    normalizeServer(server, development),
    name,
    transport,
    notice,
    session,
  );
  try {
    const capabilities = record(
      await transport.request(current.server, '/v2/capabilities', 'GET', {}),
    );
    if (capabilities.groupSharing !== 1)
      throw new Error(
        'This server needs an update to support reusable sharing links. Update the server, then retry.',
      );
    await current.startHost();
    await current.enableSharing();
    return current;
  } catch (error) {
    await current.close(true);
    throw error;
  }
}
export async function joinShareLink(
  code: string,
  name: string,
  transport: SignalingTransport,
  notice: (message: string) => void,
  development = false,
) {
  if (!code.trim().startsWith('veil://'))
    return joinAutomatic(code, name, transport, notice, development);
  const invite = decodeShareLink(code, development);
  const current = new AutomaticSession('guest', invite.server, name, transport, notice);
  try {
    await current.startGroupGuest(invite);
    return current;
  } catch (error) {
    await current.close();
    throw error;
  }
}
